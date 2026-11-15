/**
 * Responsibility: pure review decisions for one human node of a run.
 * Inputs: the schedule state, the human node id, a decision, and for Redo one the agent to redo.
 * Outputs: the next schedule state and one effect. No SDK, filesystem, or server calls.
 */
import { reviewSources, stepOf, withStatus, type NodeStatus, type ScheduleState } from "./schedule";

export type GateDecision = "approve" | "redo" | "decline";

export type GateEffect =
  | { type: "resume" }
  | { type: "halt" }
  | { type: "resend"; nodes: { nodeId: string; retryCount: number }[] }
  | { type: "reject"; message: string };

export function enterHuman(state: ScheduleState, humanId: string): ScheduleState {
  return withStatus(state, humanId, "waiting");
}

/**
 * Approve marks the human approved. Decline marks it declined and halts the run.
 * Redo re-sends every agent the human reviews, or only `redoNodeId` when given,
 * marks those agents `redoing`, bumps their retry counts, and puts the human back to `idle`
 * until they are done. Approve and Redo are rejected while a reviewed agent is still running.
 */
export function applyHumanDecision(
  state: ScheduleState,
  humanId: string,
  decision: GateDecision,
  redoNodeId?: string,
): { state: ScheduleState; effect: GateEffect } {
  const reject = (message: string) => ({ state, effect: { type: "reject" as const, message } });
  const step = stepOf(state, humanId);
  if (!step || step.kind !== "human" || state.nodeStatus[humanId] !== "waiting") {
    return reject("Node is not waiting for review");
  }
  if (redoNodeId !== undefined && decision !== "redo") {
    return reject("Only Redo takes an agent");
  }
  if (decision === "decline") {
    return { state: withStatus(state, humanId, "declined"), effect: { type: "halt" } };
  }

  const sources = reviewSources(state, humanId);
  const busy = sources.some((id) => {
    const status = state.nodeStatus[id];
    return status === "running" || status === "redoing";
  });

  if (decision === "approve") {
    if (busy) return reject("Upstream agent is still running");
    return { state: withStatus(state, humanId, "approved"), effect: { type: "resume" } };
  }

  if (sources.length === 0) return reject("No upstream agent");
  if (redoNodeId !== undefined && !sources.includes(redoNodeId)) {
    return reject("Agent is not reviewed by this node");
  }
  if (busy) return reject("Upstream agent is still running");

  const targets = redoNodeId === undefined ? sources : [redoNodeId];
  const nodeStatus: Record<string, NodeStatus> = { ...state.nodeStatus, [humanId]: "idle" };
  const retryCounts: Record<string, number> = { ...state.retryCounts };
  const nodes: { nodeId: string; retryCount: number }[] = [];
  for (const nodeId of targets) {
    const retryCount = (retryCounts[nodeId] ?? 0) + 1;
    retryCounts[nodeId] = retryCount;
    nodeStatus[nodeId] = "redoing";
    nodes.push({ nodeId, retryCount });
  }
  return { state: { ...state, nodeStatus, retryCounts }, effect: { type: "resend", nodes } };
}
