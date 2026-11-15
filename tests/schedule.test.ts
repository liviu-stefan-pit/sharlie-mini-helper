import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  canDispose,
  initialSchedule,
  readyNodes,
  runStatus,
  upstreamFor,
  withStatus,
  type NodeStatus,
  type ScheduleState,
  type ScheduleStep,
} from "../src/modules/runs/schedule";

function agent(nodeId: string, inputs: string[] = []): ScheduleStep {
  return { kind: "agent", nodeId, inputs };
}

function human(nodeId: string, inputs: string[] = []): ScheduleStep {
  return { kind: "human", nodeId, inputs };
}

function stateWith(steps: ScheduleStep[], statuses: Record<string, NodeStatus> = {}): ScheduleState {
  let state = initialSchedule(steps);
  for (const [id, status] of Object.entries(statuses)) state = withStatus(state, id, status);
  return state;
}

// A → B ─────────┐
// │              ▼
// └─► C ─► H ──► D
const diamond = [agent("a"), agent("b", ["a"]), agent("c", ["a"]), human("h", ["c"]), agent("d", ["b", "h"])];

describe("schedule readiness", () => {
  test("only nodes with no inputs are ready at the start", () => {
    assert.deepEqual(readyNodes(stateWith(diamond)), ["a"]);
  });

  test("both branches become ready together after their shared input is done", () => {
    assert.deepEqual(readyNodes(stateWith(diamond, { a: "done" })), ["b", "c"]);
  });

  test("a join waits until every input is satisfied", () => {
    assert.deepEqual(readyNodes(stateWith(diamond, { a: "done", b: "done", c: "running" })), []);
    assert.deepEqual(readyNodes(stateWith(diamond, { a: "done", b: "done", c: "done" })), ["h"]);
    assert.deepEqual(readyNodes(stateWith(diamond, { a: "done", b: "done", c: "done", h: "waiting" })), []);
    assert.deepEqual(readyNodes(stateWith(diamond, { a: "done", b: "done", c: "done", h: "approved" })), ["d"]);
  });

  test("a human input counts only when approved", () => {
    const state = stateWith(diamond, { a: "done", b: "done", c: "done", h: "declined" });
    assert.deepEqual(readyNodes(state), []);
  });

  test("a waiting human does not block an unrelated branch", () => {
    const state = stateWith(diamond, { a: "done", c: "done", h: "waiting" });
    assert.deepEqual(readyNodes(state), ["b"]);
    assert.equal(runStatus(state), "running");
  });

  test("a human is held back while an agent it reviews redoes", () => {
    const steps = [agent("a"), human("h1", ["a"]), human("h2", ["h1"])];
    assert.deepEqual(readyNodes(stateWith(steps, { a: "redoing", h1: "approved" })), []);
    assert.deepEqual(readyNodes(stateWith(steps, { a: "done", h1: "approved" })), ["h2"]);
  });
});

describe("schedule run status", () => {
  test("paused only when nothing runs and a human waits", () => {
    assert.equal(runStatus(stateWith(diamond, { a: "done", b: "running", c: "done", h: "waiting" })), "running");
    assert.equal(runStatus(stateWith(diamond, { a: "done", b: "done", c: "done", h: "waiting" })), "paused");
  });

  test("done when every agent is done and every human approved", () => {
    const state = stateWith(diamond, { a: "done", b: "done", c: "done", h: "approved", d: "done" });
    assert.equal(runStatus(state), "done");
  });

  test("stalled after a decline with nothing else to do", () => {
    assert.equal(runStatus(stateWith(diamond, { a: "done", b: "done", c: "done", h: "declined" })), "stalled");
  });
});

describe("schedule upstream text", () => {
  test("only direct inputs are included, not earlier unconnected agents", () => {
    const steps = [agent("a"), agent("b", ["a"]), agent("c", ["b"])];
    const items = upstreamFor(stateWith(steps), { a: "from a", b: "from b" }, "c");
    assert.deepEqual(items, [{ nodeId: "b", text: "from b" }]);
  });

  test("a join receives one block per input in input order", () => {
    const items = upstreamFor(stateWith(diamond), { a: "A", b: "B", c: "C" }, "d");
    assert.deepEqual(items, [
      { nodeId: "b", text: "B" },
      { nodeId: "c", text: "C", viaHumanId: "h" },
    ]);
  });

  test("an agent reached by two paths appears once", () => {
    const steps = [agent("a"), human("h", ["a"]), agent("d", ["a", "h"])];
    assert.deepEqual(upstreamFor(stateWith(steps), { a: "A" }, "d"), [{ nodeId: "a", text: "A" }]);
  });

  test("the latest output is used, so redo text replaces the first text", () => {
    const steps = [agent("a"), agent("b", ["a"])];
    const outputs: Record<string, string> = { a: "first" };
    outputs.a = "after redo";
    assert.deepEqual(upstreamFor(stateWith(steps), outputs, "b"), [{ nodeId: "a", text: "after redo" }]);
  });

  test("a human input carries every agent it reviewed, through other humans", () => {
    const steps = [agent("a"), agent("b"), human("h1", ["a"]), human("h2", ["h1", "b"]), agent("d", ["h2"])];
    const items = upstreamFor(stateWith(steps), { a: "A", b: "B" }, "d");
    assert.deepEqual(items, [
      { nodeId: "a", text: "A", viaHumanId: "h2" },
      { nodeId: "b", text: "B", viaHumanId: "h2" },
    ]);
  });
});

describe("schedule runner disposal", () => {
  test("a reviewed agent keeps its runner until every reviewer is decided", () => {
    const steps = [agent("a"), human("h1", ["a"]), human("h2", ["a"])];
    assert.equal(canDispose(stateWith(steps, { a: "done", h1: "approved", h2: "waiting" }), "a"), false);
    assert.equal(canDispose(stateWith(steps, { a: "done", h1: "approved", h2: "approved" }), "a"), true);
  });

  test("an agent nobody reviews can go as soon as it is done", () => {
    assert.equal(canDispose(stateWith(diamond, { a: "done" }), "a"), true);
    assert.equal(canDispose(stateWith(diamond, { a: "running" }), "a"), false);
  });
});
