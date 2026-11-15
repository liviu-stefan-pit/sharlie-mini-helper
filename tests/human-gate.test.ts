import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyHumanDecision, enterHuman } from "../src/modules/runs/humanGate";
import { initialSchedule, withStatus, type NodeStatus, type ScheduleState, type ScheduleStep } from "../src/modules/runs/schedule";

function stateWith(steps: ScheduleStep[], statuses: Record<string, NodeStatus>): ScheduleState {
  let state = initialSchedule(steps);
  for (const [id, status] of Object.entries(statuses)) state = withStatus(state, id, status);
  return state;
}

const single: ScheduleStep[] = [
  { kind: "agent", nodeId: "agent-1", inputs: [] },
  { kind: "human", nodeId: "human-1", inputs: ["agent-1"] },
];

// Two agents reviewed by one human.
const pair: ScheduleStep[] = [
  { kind: "agent", nodeId: "a", inputs: [] },
  { kind: "agent", nodeId: "b", inputs: [] },
  { kind: "human", nodeId: "h", inputs: ["a", "b"] },
];

function waitingSingle(): ScheduleState {
  return stateWith(single, { "agent-1": "done", "human-1": "waiting" });
}

function waitingPair(): ScheduleState {
  return stateWith(pair, { a: "done", b: "done", h: "waiting" });
}

describe("human gate", () => {
  test("enterHuman marks the human waiting", () => {
    const next = enterHuman(stateWith(single, { "agent-1": "done" }), "human-1");
    assert.equal(next.nodeStatus["human-1"], "waiting");
  });

  test("approve marks the human approved and resumes", () => {
    const result = applyHumanDecision(waitingSingle(), "human-1", "approve");
    assert.equal(result.state.nodeStatus["human-1"], "approved");
    assert.equal(result.effect.type, "resume");
  });

  test("decline marks the human declined and halts", () => {
    const result = applyHumanDecision(waitingSingle(), "human-1", "decline");
    assert.equal(result.state.nodeStatus["human-1"], "declined");
    assert.equal(result.effect.type, "halt");
  });

  test("a decision on a node that is not waiting is rejected", () => {
    const state = stateWith(single, { "agent-1": "running" });
    const result = applyHumanDecision(state, "human-1", "approve");
    assert.deepEqual(result.effect, { type: "reject", message: "Node is not waiting for review" });
    assert.equal(result.state, state);
  });

  test("redo without notes resends the reviewed agent, bumps its retry count, and idles the human", () => {
    const state = waitingSingle();
    const result = applyHumanDecision(state, "human-1", "redo");
    assert.deepEqual(result.effect, { type: "resend", nodes: [{ nodeId: "agent-1", retryCount: 1 }] });
    assert.equal(JSON.stringify(result.effect).includes("Human feedback"), false);
    assert.equal(result.state.retryCounts["agent-1"], 1);
    assert.equal(result.state.nodeStatus["agent-1"], "redoing");
    assert.equal(result.state.nodeStatus["human-1"], "idle");
    assert.deepEqual(state.retryCounts, {});
  });

  test("a second redo bumps the same agent retry count to 2", () => {
    const first = applyHumanDecision(waitingSingle(), "human-1", "redo");
    const again = withStatus(withStatus(first.state, "agent-1", "done"), "human-1", "waiting");
    const second = applyHumanDecision(again, "human-1", "redo");
    assert.deepEqual(second.effect, { type: "resend", nodes: [{ nodeId: "agent-1", retryCount: 2 }] });
  });

  test("redo all resends every reviewed agent and bumps both retry counts", () => {
    const result = applyHumanDecision(waitingPair(), "h", "redo");
    assert.deepEqual(result.effect, {
      type: "resend",
      nodes: [
        { nodeId: "a", retryCount: 1 },
        { nodeId: "b", retryCount: 1 },
      ],
    });
    assert.equal(result.state.nodeStatus.a, "redoing");
    assert.equal(result.state.nodeStatus.b, "redoing");
  });

  test("redo one resends only the picked agent and leaves the other done", () => {
    const result = applyHumanDecision(waitingPair(), "h", "redo", "b");
    assert.deepEqual(result.effect, { type: "resend", nodes: [{ nodeId: "b", retryCount: 1 }] });
    assert.equal(result.state.nodeStatus.a, "done");
    assert.equal(result.state.retryCounts.a, undefined);
  });

  test("redo one with an agent the human does not review is rejected", () => {
    const result = applyHumanDecision(waitingPair(), "h", "redo", "other");
    assert.deepEqual(result.effect, { type: "reject", message: "Agent is not reviewed by this node" });
  });

  test("an agent id with approve or decline is rejected", () => {
    const result = applyHumanDecision(waitingPair(), "h", "approve", "a");
    assert.deepEqual(result.effect, { type: "reject", message: "Only Redo takes an agent" });
  });

  test("approve and redo are rejected while a reviewed agent is still redoing", () => {
    // Two humans review the same agent; one of them already asked for a redo.
    const steps: ScheduleStep[] = [
      { kind: "agent", nodeId: "a", inputs: [] },
      { kind: "human", nodeId: "h1", inputs: ["a"] },
      { kind: "human", nodeId: "h2", inputs: ["a"] },
    ];
    const state = stateWith(steps, { a: "redoing", h1: "idle", h2: "waiting" });
    for (const decision of ["approve", "redo"] as const) {
      const result = applyHumanDecision(state, "h2", decision);
      assert.deepEqual(result.effect, { type: "reject", message: "Upstream agent is still running" });
    }
    assert.equal(applyHumanDecision(state, "h2", "decline").effect.type, "halt");
  });

  test("redo with no agent behind the human rejects", () => {
    const state = stateWith([{ kind: "human", nodeId: "human-1", inputs: [] }], { "human-1": "waiting" });
    const result = applyHumanDecision(state, "human-1", "redo");
    assert.deepEqual(result.effect, { type: "reject", message: "No upstream agent" });
    assert.deepEqual(result.state.retryCounts, {});
  });
});
