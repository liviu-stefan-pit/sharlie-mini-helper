/**
 * Responsibility: pure pause/resume decisions for a human step.
 * Inputs: a gate snapshot and a decision.
 * Outputs: the next snapshot and one effect. No SDK, filesystem, or server calls.
 */

export type GateDecision = "approve" | "redo" | "decline";

export type GateStep = { kind: "agent" | "human"; nodeId: string };

export type GateSnapshot = {
  status: "running" | "paused" | "done" | "error" | "stopped";
  stepIndex: number;
  steps: GateStep[];
  retryCounts: Record<string, number>;
  outputs: Record<string, string>;
  humanStatus: "idle" | "waiting" | "approved" | "declined";
};

export type GateEffect =
  | { type: "resume" }
  | { type: "halt" }
  | { type: "resend"; nodeId: string; retryCount: number }
  | { type: "reject"; message: string };

export function enterHuman(snapshot: GateSnapshot): GateSnapshot {
  return {
    status: "paused",
    stepIndex: snapshot.stepIndex,
    steps: snapshot.steps,
    retryCounts: snapshot.retryCounts,
    outputs: snapshot.outputs,
    humanStatus: "waiting",
  };
}

export function applyHumanDecision(
  snapshot: GateSnapshot,
  decision: GateDecision,
): { snapshot: GateSnapshot; effect: GateEffect } {
  const step = snapshot.steps[snapshot.stepIndex];
  if (snapshot.status !== "paused" || !step || step.kind !== "human") {
    return { snapshot, effect: { type: "reject", message: "Run is not paused" } };
  }
  if (decision === "approve") {
    const stepIndex = snapshot.stepIndex + 1;
    const pastEnd = stepIndex >= snapshot.steps.length;
    return {
      snapshot: {
        ...snapshot,
        humanStatus: "approved",
        status: pastEnd ? "done" : "running",
        stepIndex,
      },
      effect: { type: "resume" },
    };
  }
  if (decision === "decline") {
    return {
      snapshot: { ...snapshot, humanStatus: "declined", status: "stopped" },
      effect: { type: "halt" },
    };
  }
  const upstream = earlierAgent(snapshot.steps, snapshot.stepIndex);
  if (!upstream) {
    return { snapshot, effect: { type: "reject", message: "No upstream agent" } };
  }
  const retryCount = (snapshot.retryCounts[upstream.nodeId] ?? 0) + 1;
  return {
    snapshot: {
      ...snapshot,
      status: "paused",
      humanStatus: "waiting",
      retryCounts: { ...snapshot.retryCounts, [upstream.nodeId]: retryCount },
    },
    effect: {
      type: "resend",
      nodeId: upstream.nodeId,
      retryCount,
    },
  };
}

function earlierAgent(steps: GateStep[], stepIndex: number): GateStep | undefined {
  for (let index = stepIndex - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step?.kind === "agent") return step;
  }
  return undefined;
}
