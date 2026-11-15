/**
 * Responsibility: pure decisions about which nodes of a run may start, and what text an agent receives.
 * Inputs: resolved steps (each with its inputs), per-node status, and agent outputs.
 * Outputs: ready nodes, the overall run status, upstream text for one agent, and runner disposal checks.
 * No SDK, filesystem, timers, or server calls.
 */
import { reviewSources as shapeReviewSources, shapeFromSteps } from "../graph/topology";
import type { AgentStatus, HumanStatus, NodeKind } from "../graph/types";

export type NodeStatus = AgentStatus | HumanStatus;

export type ScheduleStep = { kind: NodeKind; nodeId: string; inputs: readonly string[] };

export type ScheduleState = {
  steps: readonly ScheduleStep[];
  nodeStatus: Readonly<Record<string, NodeStatus>>;
  retryCounts: Readonly<Record<string, number>>;
};

export type UpstreamItem = {
  nodeId: string;
  text: string;
  /** Set when the text reached this agent through a human node that approved it. */
  viaHumanId?: string;
};

export function initialSchedule(steps: readonly ScheduleStep[]): ScheduleState {
  const nodeStatus: Record<string, NodeStatus> = {};
  for (const step of steps) nodeStatus[step.nodeId] = "idle";
  return { steps, nodeStatus, retryCounts: {} };
}

export function withStatus(state: ScheduleState, nodeId: string, status: NodeStatus): ScheduleState {
  return { ...state, nodeStatus: { ...state.nodeStatus, [nodeId]: status } };
}

export function stepOf(state: ScheduleState, nodeId: string): ScheduleStep | undefined {
  return state.steps.find((step) => step.nodeId === nodeId);
}

/** An agent input is satisfied when done; a human input when approved. */
export function isSatisfied(state: ScheduleState, nodeId: string): boolean {
  const step = stepOf(state, nodeId);
  const status = state.nodeStatus[nodeId];
  if (!step) return false;
  return step.kind === "agent" ? status === "done" : status === "approved";
}

export function reviewSources(state: ScheduleState, humanId: string): string[] {
  return shapeReviewSources(shapeFromSteps(state.steps), humanId);
}

/**
 * Idle nodes whose inputs are all satisfied, in step order.
 * A human is also held back while any agent it reviews is not done (for example during a redo).
 */
export function readyNodes(state: ScheduleState): string[] {
  const ready: string[] = [];
  for (const step of state.steps) {
    if (state.nodeStatus[step.nodeId] !== "idle") continue;
    if (!step.inputs.every((input) => isSatisfied(state, input))) continue;
    if (step.kind === "human") {
      const sources = reviewSources(state, step.nodeId);
      if (!sources.every((id) => state.nodeStatus[id] === "done")) continue;
    }
    ready.push(step.nodeId);
  }
  return ready;
}

export function busyAgents(state: ScheduleState): string[] {
  return state.steps
    .filter((step) => step.kind === "agent")
    .map((step) => step.nodeId)
    .filter((id) => state.nodeStatus[id] === "running" || state.nodeStatus[id] === "redoing");
}

export function waitingHumans(state: ScheduleState): string[] {
  return state.steps
    .filter((step) => step.kind === "human" && state.nodeStatus[step.nodeId] === "waiting")
    .map((step) => step.nodeId);
}

/**
 * `running` while an agent is busy or a node is ready to start.
 * `paused` when nothing runs and at least one human waits.
 * `done` when every agent is done and every human approved.
 * `stalled` for anything else (a failed or declined node); the engine sets error or stopped itself.
 */
export function runStatus(state: ScheduleState): "running" | "paused" | "done" | "stalled" {
  if (busyAgents(state).length > 0 || readyNodes(state).length > 0) return "running";
  if (waitingHumans(state).length > 0) return "paused";
  if (state.steps.every((step) => isSatisfied(state, step.nodeId))) return "done";
  return "stalled";
}

/**
 * Upstream text for one agent: one item per direct input, in input order.
 * An agent input gives its own output. A human input gives the outputs of the agents it reviewed.
 * An agent reached by two paths appears once. Agents with no output yet are skipped.
 */
export function upstreamFor(
  state: ScheduleState,
  outputs: Readonly<Record<string, string>>,
  agentId: string,
): UpstreamItem[] {
  const step = stepOf(state, agentId);
  if (!step) return [];
  const items: UpstreamItem[] = [];
  const seen = new Set<string>();
  const add = (nodeId: string, viaHumanId?: string) => {
    if (seen.has(nodeId)) return;
    const text = outputs[nodeId];
    if (text === undefined) return;
    seen.add(nodeId);
    items.push(viaHumanId === undefined ? { nodeId, text } : { nodeId, text, viaHumanId });
  };
  for (const input of step.inputs) {
    const inputStep = stepOf(state, input);
    if (!inputStep) continue;
    if (inputStep.kind === "agent") add(input);
    else for (const source of reviewSources(state, input)) add(source, input);
  }
  return items;
}

/** Human nodes that review this agent and can therefore still ask for a redo of it. */
export function reviewersOf(state: ScheduleState, agentId: string): string[] {
  return state.steps
    .filter((step) => step.kind === "human" && reviewSources(state, step.nodeId).includes(agentId))
    .map((step) => step.nodeId);
}

/** An agent's runner may go once it is done and no reviewer of it is still open. */
export function canDispose(state: ScheduleState, agentId: string): boolean {
  if (state.nodeStatus[agentId] !== "done") return false;
  return reviewersOf(state, agentId).every((id) => {
    const status = state.nodeStatus[id];
    return status === "approved" || status === "declined";
  });
}
