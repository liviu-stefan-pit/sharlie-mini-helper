import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyHumanDecision, enterHuman, type GateSnapshot } from "../src/modules/runs/humanGate";

function pausedSnapshot(): GateSnapshot {
  return {
    status: "paused",
    stepIndex: 1,
    steps: [
      { kind: "agent", nodeId: "agent-1" },
      { kind: "human", nodeId: "human-1" },
    ],
    humanStatus: "waiting",
    outputs: { "agent-1": "draft text" },
    retryCounts: {},
  };
}

describe("human gate", () => {
  test("enterHuman pauses a running snapshot on the same human step", () => {
    const running: GateSnapshot = { ...pausedSnapshot(), status: "running" };
    const next = enterHuman(running);
    assert.equal(next.status, "paused");
    assert.equal(next.humanStatus, "waiting");
    assert.equal(next.stepIndex, running.stepIndex);
  });

  test("approve moves past the last step and resumes", () => {
    const result = applyHumanDecision(pausedSnapshot(), "approve");
    assert.equal(result.snapshot.stepIndex, 2);
    assert.equal(result.snapshot.status, "done");
    assert.equal(result.effect.type, "resume");
  });

  test("decline stops the run and does not resend", () => {
    const result = applyHumanDecision(pausedSnapshot(), "decline");
    assert.equal(result.snapshot.status, "stopped");
    assert.equal(result.snapshot.humanStatus, "declined");
    assert.equal(result.effect.type, "halt");
    assert.equal("prompt" in result.effect, false);
  });

  test("redo without notes resends the upstream agent and increments its retry count", () => {
    const snapshot = pausedSnapshot();
    const result = applyHumanDecision(snapshot, "redo");
    assert.equal(result.effect.type, "resend");
    if (result.effect.type !== "resend") return;
    assert.equal(result.effect.nodeId, "agent-1");
    assert.equal(result.effect.retryCount, 1);
    assert.equal("prompt" in result.effect, false);
    assert.equal(JSON.stringify(result.effect).includes("Human feedback"), false);
    assert.equal(JSON.stringify(result.effect).includes("draft text"), false);
    assert.equal(result.snapshot.retryCounts["agent-1"], 1);
    assert.equal(result.snapshot.status, "paused");
    assert.equal(result.snapshot.stepIndex, 1);
    assert.deepEqual(snapshot.retryCounts, {});
  });

  test("a second redo bumps the same agent retry count to 2", () => {
    const first = applyHumanDecision(pausedSnapshot(), "redo");
    const second = applyHumanDecision(first.snapshot, "redo");
    assert.equal(second.effect.type, "resend");
    if (second.effect.type !== "resend") return;
    assert.equal(second.effect.nodeId, "agent-1");
    assert.equal(second.effect.retryCount, 2);
    assert.equal(second.snapshot.retryCounts["agent-1"], 2);
    assert.equal("prompt" in second.effect, false);
  });

  test("redo with no earlier agent rejects", () => {
    const snapshot: GateSnapshot = {
      status: "paused",
      stepIndex: 0,
      steps: [{ kind: "human", nodeId: "human-1" }],
      humanStatus: "waiting",
      outputs: {},
      retryCounts: {},
    };
    const result = applyHumanDecision(snapshot, "redo");
    assert.equal(result.effect.type, "reject");
    if (result.effect.type === "reject") {
      assert.equal(result.effect.message, "No upstream agent");
    }
    assert.deepEqual(result.snapshot.retryCounts, {});
  });
});
