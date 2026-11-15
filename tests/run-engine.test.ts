import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { CursorAgentRunner, RunnerEvent, SendResult } from "../src/modules/cursor/adapter";
import type { ExecutionStep } from "../src/modules/graph/resolve";
import { pipelineFingerprint, readCheckpoint } from "../src/modules/runs/checkpoint";
import {
  decideRun,
  forgetStoppedRun,
  resumeFromCheckpoint,
  startRun,
  stopRun,
  subscribeRun,
  type RunStreamEvent,
} from "../src/modules/runs/engine";

type PendingSend = {
  runner: FakeRunner;
  prompt: string;
  resolve: (result: SendResult) => void;
};

/** A runner whose sends stay pending until the test finishes them. */
class FakeRunner implements CursorAgentRunner {
  disposed = false;
  cancelled = false;
  constructor(private readonly sends: PendingSend[]) {}
  async start(): Promise<void> {}
  send(prompt: string, _onEvent: (event: RunnerEvent) => void): Promise<SendResult> {
    return new Promise((resolve) => {
      this.sends.push({ runner: this, prompt, resolve });
    });
  }
  async cancel(): Promise<void> {
    this.cancelled = true;
  }
  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

let dir = "";

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-engine-"));
  for (const name of ["a", "b", "c", "d", "x", "y"]) {
    await fs.writeFile(path.join(dir, `${name}.md`), `Body of ${name.toUpperCase()}`);
  }
});

after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function agent(nodeId: string, inputs: string[] = []): ExecutionStep {
  return {
    kind: "agent",
    nodeId,
    inputs,
    modelId: "test-model",
    agentPath: `${nodeId}.md`,
    agentName: `Agent ${nodeId.toUpperCase()}`,
    effort: "medium",
    effortParamId: "effort",
  };
}

function human(nodeId: string, inputs: string[]): ExecutionStep {
  return { kind: "human", nodeId, inputs };
}

function launch(steps: ExecutionStep[], cwd = dir, artifactPrefix = "wf") {
  const sends: PendingSend[] = [];
  const runners: FakeRunner[] = [];
  const id = startRun({
    steps,
    apiKey: "test-key",
    cwd,
    artifactPrefix,
    catalog: "CATALOG",
    mcpServers: [],
    createRunner: () => {
      const runner = new FakeRunner(sends);
      runners.push(runner);
      return runner;
    },
  });
  const events: RunStreamEvent[] = [];
  const subscription = subscribeRun(id, (event) => events.push(event));
  assert.ok(subscription);
  events.push(...subscription.events);
  return { id, sends, runners, events };
}

async function until(check: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

/** Let pending work settle so a "nothing happened" check is meaningful. */
async function idle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setTimeout(resolve, 2));
}

function sendFor(sends: PendingSend[], name: string): PendingSend | undefined {
  return sends.find((send) => send.prompt.includes(`Body of ${name}`));
}

function sendsFor(sends: PendingSend[], name: string): PendingSend[] {
  return sends.filter((send) => send.prompt.includes(`Body of ${name}`));
}

function finish(send: PendingSend | undefined, text: string): void {
  assert.ok(send, "send exists");
  send.resolve({ status: "finished", text, failure: "none" });
}

function hasEvent(events: RunStreamEvent[], name: string): boolean {
  return events.some((event) => event.event === name);
}

function statusesOf(events: RunStreamEvent[], nodeId: string): string[] {
  return events
    .filter((event) => event.event === "node-status")
    .map((event) => event.data as { nodeId: string; status: string })
    .filter((data) => data.nodeId === nodeId)
    .map((data) => data.status);
}

describe("run engine with several inputs", () => {
  test("branches run together and a join waits for both, receiving only its inputs", async () => {
    const run = launch([agent("a"), agent("b", ["a"]), agent("c", ["a"]), agent("d", ["b", "c"])]);
    await until(() => sendFor(run.sends, "A") !== undefined, "A to start");
    assert.match(sendFor(run.sends, "A")?.prompt ?? "", /^CATALOG/);
    finish(sendFor(run.sends, "A"), "A out");

    await until(() => sendFor(run.sends, "B") !== undefined && sendFor(run.sends, "C") !== undefined, "B and C");
    finish(sendFor(run.sends, "B"), "B out");
    await idle();
    assert.equal(sendFor(run.sends, "D"), undefined, "D must wait for C");

    finish(sendFor(run.sends, "C"), "C out");
    await until(() => sendFor(run.sends, "D") !== undefined, "D to start");
    const prompt = sendFor(run.sends, "D")?.prompt ?? "";
    assert.match(prompt, /### Agent B \(node b\)\nB out/);
    assert.match(prompt, /### Agent C \(node c\)\nC out/);
    assert.doesNotMatch(prompt, /A out/);

    finish(sendFor(run.sends, "D"), "D out");
    await until(() => hasEvent(run.events, "done"), "done");
    assert.ok(run.runners.every((runner) => runner.disposed));
  });

  test("a waiting human does not block another branch, and Redo one goes to the right runner", async () => {
    const run = launch([agent("a"), agent("b"), agent("x"), human("h", ["a", "b"]), agent("y", ["h"])]);
    await until(() => run.sends.length === 3, "A, B and X");
    finish(sendFor(run.sends, "A"), "A out");
    finish(sendFor(run.sends, "B"), "B first");
    await until(() => statusesOf(run.events, "h").includes("waiting"), "H waiting");
    assert.equal(hasEvent(run.events, "paused"), false, "X is still running, so the run is not paused");

    const firstB = sendFor(run.sends, "B");
    assert.deepEqual(decideRun(run.id, "redo", "h", "b"), { ok: true });
    await until(() => sendsFor(run.sends, "B").length === 2, "B redo");
    const redo = sendsFor(run.sends, "B")[1];
    assert.equal(redo?.runner, firstB?.runner, "redo uses B's own runner");
    assert.equal(redo?.prompt, "Body of B", "redo sends the body only");
    assert.equal(sendsFor(run.sends, "A").length, 1, "A is not redone");
    assert.deepEqual(decideRun(run.id, "approve", "h"), { ok: false, error: "Node is not waiting for review" });

    finish(redo, "B second");
    await until(() => statusesOf(run.events, "h").filter((status) => status === "waiting").length === 2, "H again");
    assert.deepEqual(decideRun(run.id, "approve", "h"), { ok: true });

    await until(() => sendFor(run.sends, "Y") !== undefined, "Y to start");
    const prompt = sendFor(run.sends, "Y")?.prompt ?? "";
    assert.match(prompt, /approved in human review\)\nA out/);
    assert.match(prompt, /B second/);
    assert.doesNotMatch(prompt, /B first/);

    finish(sendFor(run.sends, "X"), "X out");
    finish(sendFor(run.sends, "Y"), "Y out");
    await until(() => hasEvent(run.events, "done"), "done");
  });

  test("paused is emitted only once nothing runs and a human waits", async () => {
    const run = launch([agent("a"), human("h", ["a"])]);
    await until(() => sendFor(run.sends, "A") !== undefined, "A");
    finish(sendFor(run.sends, "A"), "A out");
    await until(() => hasEvent(run.events, "paused"), "paused");
    assert.deepEqual(decideRun(run.id, "decline"), { ok: true });
    await until(() => hasEvent(run.events, "stopped"), "stopped");
    assert.ok(run.runners.every((runner) => runner.disposed));
  });

  test("an agent error disposes every runner and starts nothing new", async () => {
    const run = launch([agent("a"), agent("b"), agent("c", ["a"])]);
    await until(() => run.sends.length === 2, "A and B");
    sendFor(run.sends, "A")?.resolve({ status: "error", text: "", error: "boom test-key", failure: "run" });
    await until(() => hasEvent(run.events, "error"), "error");
    const error = run.events.find((event) => event.event === "error")?.data as { message: string };
    assert.equal(error.message, "boom [redacted]");
    await until(() => run.runners.every((runner) => runner.disposed), "dispose");
    finish(sendFor(run.sends, "B"), "late");
    await idle();
    assert.equal(sendFor(run.sends, "C"), undefined);
    assert.equal(statusesOf(run.events, "b").includes("done"), false, "late results are ignored");
  });

  test("no more than three agents run at once", async () => {
    const run = launch([agent("a"), agent("b"), agent("c"), agent("d")]);
    await until(() => run.sends.length === 3, "three sends");
    await idle();
    assert.equal(run.sends.length, 3);
    finish(run.sends[0], "out");
    await until(() => run.sends.length === 4, "fourth send");
  });
});

describe("stop and resume", () => {
  test("stop during a pending send keeps finished output and resume sends only the unfinished agent", async () => {
    const cwd = await workflowCopy();
    const steps = [agent("a"), agent("b", ["a"])];
    const run = launch(steps, cwd, "stop-ab");
    await until(() => sendFor(run.sends, "A") !== undefined, "A");
    finish(sendFor(run.sends, "A"), "A out");
    await until(() => sendFor(run.sends, "B") !== undefined, "B");
    const pending = sendFor(run.sends, "B");
    assert.deepEqual(await stopRun(run.id), { ok: true });
    assert.equal(pending?.runner.cancelled, true);
    assert.ok(run.runners.every((runner) => runner.disposed));
    assert.equal(hasEvent(run.events, "error"), false);
    assert.ok(statusesOf(run.events, "b").includes("idle"));
    finish(pending, "B late");
    await idle();
    assert.equal(hasEvent(run.events, "error"), false);
    assert.equal(statusesOf(run.events, "b").includes("done"), false);

    const saved = await readCheckpoint(cwd);
    assert.ok(saved);
    assert.equal(saved.version, 1);
    assert.equal(saved.pipelineId, "stop-ab");
    assert.equal(saved.nodeStatus.a, "done");
    assert.equal(saved.nodeStatus.b, "idle");
    assert.equal(saved.outputs.a, "A out");
    assert.equal(saved.outputs.b, undefined);
    const raw = await fs.readFile(path.join(cwd, ".sharlie", "run.json"), "utf8");
    assert.equal(raw.includes("test-key"), false);

    const resumed = resumeFromCheckpoint({
      steps,
      apiKey: "test-key",
      cwd,
      artifactPrefix: "stop-ab",
      catalog: "CATALOG",
      mcpServers: [],
      checkpoint: saved,
    });
    assert.equal(resumed.ok, true);
    if (!resumed.ok) return;
    assert.equal(resumed.id, run.id);
    const live = subscribeRun(run.id, () => {});
    assert.ok(live);
    assert.equal(live.events.some((event) => event.event === "stopped"), false);
    live.unsubscribe();

    await until(() => sendsFor(run.sends, "B").length === 2, "B resume");
    assert.equal(sendsFor(run.sends, "A").length, 1);
    assert.match(sendsFor(run.sends, "B")[1]?.prompt ?? "", /A out/);

    const again = resumeFromCheckpoint({
      steps,
      apiKey: "test-key",
      cwd,
      artifactPrefix: "stop-ab",
      catalog: "CATALOG",
      mcpServers: [],
      checkpoint: saved,
    });
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.id, run.id);
    await idle();
    assert.equal(sendsFor(run.sends, "B").length, 2);
    assert.equal(sendsFor(run.sends, "A").length, 1);
  });

  test("stop while a human waits, then resume does not re-send the finished agent", async () => {
    const cwd = await workflowCopy();
    const steps = [agent("a"), human("h", ["a"])];
    const run = launch(steps, cwd, "stop-human");
    await until(() => sendFor(run.sends, "A") !== undefined, "A");
    finish(sendFor(run.sends, "A"), "A out");
    await until(() => hasEvent(run.events, "paused"), "paused");
    assert.deepEqual(await stopRun(run.id), { ok: true });
    const saved = await readCheckpoint(cwd);
    assert.ok(saved);
    assert.equal(saved.nodeStatus.a, "done");
    assert.equal(saved.nodeStatus.h, "waiting");
    assert.equal(saved.outputs.a, "A out");

    forgetStoppedRun(run.id);
    const resumed = resumeFromCheckpoint({
      steps,
      apiKey: "test-key",
      cwd,
      artifactPrefix: "stop-human",
      catalog: "CATALOG",
      mcpServers: [],
      checkpoint: saved,
      createRunner: () => {
        const runner = new FakeRunner(run.sends);
        run.runners.push(runner);
        return runner;
      },
    });
    assert.equal(resumed.ok, true);
    if (!resumed.ok) return;
    const live = subscribeRun(resumed.id, () => {});
    assert.ok(live);
    assert.ok(statusesOf(live.events, "h").includes("waiting"));
    assert.ok(hasEvent(live.events, "paused"));
    assert.equal(live.events.some((event) => event.event === "stopped"), false);
    live.unsubscribe();
    await idle();
    assert.equal(sendsFor(run.sends, "A").length, 1);
  });

  test("decline removes a checkpoint and is not resumable", async () => {
    const cwd = await workflowCopy();
    const file = path.join(cwd, ".sharlie", "run.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{}\n");
    const run = launch([agent("a"), human("h", ["a"])], cwd, "decline-wf");
    await until(() => sendFor(run.sends, "A") !== undefined, "A");
    finish(sendFor(run.sends, "A"), "A out");
    await until(() => hasEvent(run.events, "paused"), "paused");
    assert.deepEqual(decideRun(run.id, "decline"), { ok: true });
    await until(() => hasEvent(run.events, "stopped"), "stopped");
    const stopped = run.events.find((event) => event.event === "stopped")?.data as { resumable?: boolean };
    assert.notEqual(stopped.resumable, true);
    await gone(file);
  });

  test("resume refuses a checkpoint when the graph fingerprint differs", async () => {
    const cwd = await workflowCopy();
    const steps = [agent("a")];
    const run = launch(steps, cwd, "stop-fp");
    await until(() => sendFor(run.sends, "A") !== undefined, "A");
    assert.equal(
      pipelineFingerprint([agent("b"), agent("a")]),
      pipelineFingerprint([agent("a"), agent("b")]),
    );
    await stopRun(run.id);
    const saved = await readCheckpoint(cwd);
    assert.ok(saved);
    const before = run.sends.length;
    let created = 0;
    const result = resumeFromCheckpoint({
      steps: [agent("a"), agent("z")],
      apiKey: "test-key",
      cwd,
      artifactPrefix: "stop-fp",
      catalog: "CATALOG",
      mcpServers: [],
      checkpoint: saved,
      createRunner: () => {
        created += 1;
        const runner = new FakeRunner(run.sends);
        run.runners.push(runner);
        return runner;
      },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.conflict, true);
    assert.match(result.error, /changed/i);
    await idle();
    assert.equal(created, 0);
    assert.equal(run.sends.length, before);
    assert.ok(await readCheckpoint(cwd));
  });
});

async function workflowCopy(): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(dir, "run-"));
  for (const name of ["a", "b", "c", "d", "x", "y", "z"]) {
    await fs.writeFile(path.join(cwd, `${name}.md`), `Body of ${name.toUpperCase()}`);
  }
  return cwd;
}

async function gone(file: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fs.access(file);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail("checkpoint file still exists");
}
