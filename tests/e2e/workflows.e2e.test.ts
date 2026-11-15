/**
 * Real end-to-end workflow runs against the Cursor SDK with the user's own key.
 * Run with `npm run test:e2e`. They use real tokens and are not part of `npm test`.
 * App behaviour is checked strictly. What the model wrote is checked loosely.
 */
import assert from "node:assert/strict";
import { describe, test, type TestContext } from "node:test";
import { readAgentInstruction } from "../../src/modules/agents/agentFile";
import { decideRun } from "../../src/modules/runs/engine";
import {
  TEST_TIMEOUT_MS,
  buildWorkflow,
  exists,
  firstLine,
  kitAgentPath,
  launch,
  pause,
  prepareSuite,
  readText,
  withWorkspace,
  type Launched,
  type NodeSpec,
  type Suite,
} from "./harness";

const prepared = await prepareSuite();
const skip = "skip" in prepared ? prepared.skip : false;
const suite = "suite" in prepared ? prepared.suite : undefined;

/** Headings of the upstream blocks in a prompt, such as `Facts writer (node facts)`, sorted. */
function upstreamHeadings(prompt: string): string[] {
  return [...prompt.matchAll(/^### (.+ \(node [^)]+\))$/gm)].map((match) => match[1] ?? "").sort();
}

async function agentBody(file: string): Promise<string> {
  const read = await readAgentInstruction(kitAgentPath(file));
  assert.ok(read.ok, `could not read ${file}`);
  return read.text;
}

function decide(run: Launched, decision: "approve" | "redo" | "decline", redoNodeId?: string) {
  return decideRun(run.watch.id, decision, "review", redoNodeId);
}

/** Run one test in its own workspace, and report the tokens it used. */
function e2e(name: string, body: (suite: Suite, workspace: string, t: TestContext) => Promise<Launched>) {
  test(name, { timeout: TEST_TIMEOUT_MS }, async (t) => {
    assert.ok(suite);
    await withWorkspace(
      (message) => t.diagnostic(message),
      async (workspace) => {
        const run = await body(suite, workspace, t);
        t.diagnostic(`${run.watch.tokens()} tokens`);
        run.watch.close();
      },
    );
  });
}

const reviewGraph: NodeSpec[] = [
  { id: "planner", agent: "topic-planner.md" },
  { id: "facts", agent: "facts-writer.md" },
  { id: "review", human: true },
  { id: "counter", agent: "slow-counter.md" },
  { id: "merger", agent: "report-merger.md" },
];
const reviewEdges: [string, string][] = [
  ["planner", "facts"],
  ["facts", "review"],
  ["review", "merger"],
  ["counter", "merger"],
];

describe("real workflow runs", { skip }, () => {
  e2e("a simple chain passes the first agent's reply to the second", async (suite, workspace) => {
    const doc = await buildWorkflow(
      "e2e-chain",
      suite.modelId,
      [
        { id: "brief", agent: "brief-writer.md" },
        { id: "checker", agent: "note-checker.md" },
      ],
      [["brief", "checker"]],
    );
    const run = await launch(suite, workspace, doc);
    const { watch, pool, cwd } = run;
    await watch.until(() => watch.has("done"), "the run to finish");

    assert.ok(watch.indexOf("checker", "running") > watch.indexOf("brief", "done"));
    assert.match(pool.prompts("brief")[0] ?? "", /^## Skills/, "the catalog leads the first send");
    assert.deepEqual(upstreamHeadings(pool.prompts("brief")[0] ?? ""), []);
    const checkerPrompt = pool.prompts("checker")[0] ?? "";
    assert.match(checkerPrompt, /^## Skills/);
    assert.deepEqual(upstreamHeadings(checkerPrompt), ["Brief writer (node brief)"]);

    assert.ok(await exists(cwd, "status-note.md"), "status-note.md was not written");
    assert.match(firstLine(await readText(cwd, "check-result.md")), /^PASS/);
    return run;
  });

  e2e("fan-in: two branches run together and the join waits for both", async (suite, workspace) => {
    const doc = await buildWorkflow(
      "e2e-fan-in",
      suite.modelId,
      [
        { id: "planner", agent: "topic-planner.md" },
        { id: "facts", agent: "facts-writer.md" },
        { id: "risks", agent: "risks-writer.md" },
        { id: "merger", agent: "report-merger.md" },
        { id: "checker", agent: "report-checker.md" },
      ],
      [
        ["planner", "facts"],
        ["planner", "risks"],
        ["facts", "merger"],
        ["risks", "merger"],
        ["merger", "checker"],
      ],
    );
    const run = await launch(suite, workspace, doc);
    const { watch, pool, cwd } = run;
    await watch.until(() => watch.has("done"), "the run to finish");

    const factsDone = watch.indexOf("facts", "done");
    const risksDone = watch.indexOf("risks", "done");
    assert.ok(watch.indexOf("facts", "running") < risksDone, "facts started before risks finished");
    assert.ok(watch.indexOf("risks", "running") < factsDone, "risks started before facts finished");
    const mergerStart = watch.indexOf("merger", "running");
    assert.ok(mergerStart > factsDone && mergerStart > risksDone, "the join waited for both branches");

    assert.deepEqual(upstreamHeadings(pool.prompts("facts")[0] ?? ""), ["Topic planner (node planner)"]);
    assert.deepEqual(upstreamHeadings(pool.prompts("merger")[0] ?? ""), [
      "Facts writer (node facts)",
      "Risks writer (node risks)",
    ]);
    assert.deepEqual(upstreamHeadings(pool.prompts("checker")[0] ?? ""), ["Report merger (node merger)"]);

    for (const file of ["plan.md", "facts.md", "risks.md"]) {
      assert.ok(await exists(cwd, file), `${file} was not written`);
    }
    assert.match(await readText(cwd, "report.md"), /^# Report/m);
    assert.match(firstLine(await readText(cwd, "report-check.md")), /^PASS/);
    return run;
  });

  e2e("a human reviewing two agents: Redo one, Redo all, then Approve", async (suite, workspace) => {
    const doc = await buildWorkflow(
      "e2e-review",
      suite.modelId,
      [
        { id: "planner", agent: "topic-planner.md" },
        { id: "facts", agent: "facts-writer.md" },
        { id: "risks", agent: "risks-writer.md" },
        { id: "review", human: true },
        { id: "merger", agent: "report-merger.md" },
      ],
      [
        ["planner", "facts"],
        ["planner", "risks"],
        ["facts", "review"],
        ["risks", "review"],
        ["review", "merger"],
      ],
    );
    const run = await launch(suite, workspace, doc);
    const { watch, pool, cwd } = run;
    const risksBody = await agentBody("risks-writer.md");
    const factsBody = await agentBody("facts-writer.md");

    await watch.until(() => watch.has("paused"), "the review to pause the run");
    assert.equal(watch.count("review", "waiting"), 1);
    assert.equal(watch.status(), "paused");

    // Redo one: only Risks writer, on its own runner, with the bare agent body.
    assert.deepEqual(decide(run, "redo", "risks"), { ok: true });
    assert.deepEqual(decide(run, "approve"), { ok: false, error: "Node is not waiting for review" });
    await watch.until(
      () => watch.count("risks", "done") >= 2 && watch.count("review", "waiting") >= 2,
      "Risks writer to redo and the review to wait again",
    );
    assert.ok(
      watch.statusEvents().some((event) => event.nodeId === "risks" && event.status === "redoing" && event.retryCount === 1),
    );
    assert.equal(pool.prompts("facts").length, 1, "Redo one left Facts writer alone");
    assert.equal(pool.prompts("risks").length, 2, "Redo one re-sent on the same runner");
    assert.equal(pool.prompts("risks")[1], risksBody, "a redo sends only the agent body");

    // Redo all: both writers again.
    assert.deepEqual(decide(run, "redo"), { ok: true });
    await watch.until(
      () => watch.count("facts", "done") >= 2 && watch.count("risks", "done") >= 3 && watch.count("review", "waiting") >= 3,
      "both writers to redo and the review to wait again",
    );
    assert.equal(pool.prompts("facts")[1], factsBody);
    assert.equal(pool.prompts("risks")[2], risksBody);
    assert.ok(
      watch.statusEvents().some((event) => event.nodeId === "risks" && event.status === "done" && event.retryCount === 2),
    );
    assert.equal(watch.count("merger", "running"), 0, "the merger waits for Approve");

    assert.deepEqual(decide(run, "approve"), { ok: true });
    await watch.until(() => watch.has("done"), "the run to finish");
    assert.ok(watch.indexOf("merger", "running") > watch.indexOf("review", "approved"));
    assert.deepEqual(upstreamHeadings(pool.prompts("merger")[0] ?? ""), [
      "Facts writer (node facts, approved in human review)",
      "Risks writer (node risks, approved in human review)",
    ]);
    assert.match(await readText(cwd, "report.md"), /^# Report/m);
    return run;
  });

  e2e("a review can be approved while another branch still runs", async (suite, workspace) => {
    const doc = await buildWorkflow("e2e-side-branch", suite.modelId, reviewGraph, reviewEdges);
    const run = await launch(suite, workspace, doc, (pool) => pool.hold("counter"));
    const { watch, pool, cwd } = run;
    try {
      await watch.until(() => watch.count("review", "waiting") >= 1, "the review to wait");
      assert.equal(watch.has("paused"), false, "a running branch keeps the run from pausing");
      assert.equal(watch.status(), "running");

      assert.deepEqual(decide(run, "approve"), { ok: true });
      await pause(1500);
      assert.equal(watch.count("merger", "running"), 0, "the merger still waits for Slow counter");

      pool.release("counter");
      await watch.until(() => watch.has("done"), "the run to finish");
      const mergerStart = watch.indexOf("merger", "running");
      assert.ok(mergerStart > watch.indexOf("counter", "done"));
      assert.ok(mergerStart > watch.indexOf("review", "approved"));
      assert.deepEqual(upstreamHeadings(pool.prompts("merger")[0] ?? ""), [
        "Facts writer (node facts, approved in human review)",
        "Slow counter (node counter)",
      ]);
      assert.ok(await exists(cwd, "count.md"), "count.md was not written");
    } finally {
      pool.releaseAll();
    }
    return run;
  });

  e2e("Decline stops the whole run, including a branch that is still running", async (suite, workspace) => {
    const doc = await buildWorkflow("e2e-decline", suite.modelId, reviewGraph, reviewEdges);
    const run = await launch(suite, workspace, doc, (pool) => pool.hold("counter"));
    const { watch, pool, cwd } = run;
    try {
      await watch.until(() => watch.count("review", "waiting") >= 1, "the review to wait");
      assert.deepEqual(decide(run, "decline"), { ok: true });
      await watch.until(() => watch.has("stopped"), "the run to stop");
      assert.equal(watch.status(), "stopped");
      await watch.until(() => pool.runner("counter").isDisposed, "Slow counter's runner to be disposed", 30_000);

      const eventsAtStop = watch.events.length;
      pool.release("counter");
      await pool.settled();
      await pause(500);
      assert.equal(watch.events.length, eventsAtStop, "nothing happens after Decline");
      assert.equal(pool.runner("counter").delivered.length, 0, "the held send never reached the SDK");
      assert.equal(watch.count("merger", "running"), 0);
      assert.equal(await exists(cwd, "count.md"), false);
      assert.equal(await exists(cwd, "report.md"), false);
    } finally {
      pool.releaseAll();
    }
    return run;
  });
});
