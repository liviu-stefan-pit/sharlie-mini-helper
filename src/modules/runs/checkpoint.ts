/**
 * Responsibility: read and write a resumable stop checkpoint for one workflow folder.
 * Inputs: the run working directory and a version 1 checkpoint object.
 * Outputs: `<cwd>/.sharlie/run.json`, or null when the file is missing or not a checkpoint.
 * The file has no API key, MCP env, or headers.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { NodeStatus } from "./schedule";

export type RunCheckpoint = {
  version: 1;
  pipelineId: string;
  stoppedAt: string;
  nodeStatus: Record<string, NodeStatus>;
  retryCounts: Record<string, number>;
  outputs: Record<string, string>;
  artifacts: { path: string; agentNodeId: string }[];
  fingerprint: string;
};

const NODE_STATUSES = new Set<NodeStatus>([
  "idle",
  "running",
  "redoing",
  "done",
  "error",
  "waiting",
  "approved",
  "declined",
]);

export function checkpointFile(cwd: string): string {
  return path.join(cwd, ".sharlie", "run.json");
}

/** Stable id of node kinds and execution edges. Input order does not change the result. */
export function pipelineFingerprint(
  steps: readonly { kind: string; nodeId: string; inputs: readonly string[] }[],
): string {
  const nodes = steps.map((step) => `${step.kind}:${step.nodeId}`).sort();
  const edges: string[] = [];
  for (const step of steps) {
    for (const source of step.inputs) edges.push(`${source}->${step.nodeId}`);
  }
  edges.sort();
  return `${nodes.join("\n")}\n${edges.join("\n")}`;
}

export async function writeCheckpoint(cwd: string, checkpoint: RunCheckpoint): Promise<void> {
  const file = checkpointFile(cwd);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
}

export async function readCheckpoint(cwd: string): Promise<RunCheckpoint | null> {
  let text: string;
  try {
    text = await fs.readFile(checkpointFile(cwd), "utf8");
  } catch {
    return null;
  }
  try {
    return parseCheckpoint(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

export async function deleteCheckpoint(cwd: string): Promise<void> {
  await fs.rm(checkpointFile(cwd), { force: true });
}

function parseCheckpoint(value: unknown): RunCheckpoint | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (typeof value.pipelineId !== "string" || value.pipelineId.length === 0) return null;
  if (typeof value.stoppedAt !== "string") return null;
  if (typeof value.fingerprint !== "string" || value.fingerprint.length === 0) return null;
  const nodeStatus = parseNodeStatus(value.nodeStatus);
  const retryCounts = parseRetryCounts(value.retryCounts);
  const outputs = parseOutputs(value.outputs);
  const artifacts = parseArtifacts(value.artifacts);
  if (!nodeStatus || !retryCounts || !outputs || !artifacts) return null;
  return {
    version: 1,
    pipelineId: value.pipelineId,
    stoppedAt: value.stoppedAt,
    nodeStatus,
    retryCounts,
    outputs,
    artifacts,
    fingerprint: value.fingerprint,
  };
}

function parseNodeStatus(value: unknown): Record<string, NodeStatus> | null {
  if (!isRecord(value)) return null;
  const nodeStatus: Record<string, NodeStatus> = {};
  for (const [id, status] of Object.entries(value)) {
    if (typeof status !== "string" || !NODE_STATUSES.has(status as NodeStatus)) return null;
    nodeStatus[id] = status as NodeStatus;
  }
  return nodeStatus;
}

function parseRetryCounts(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const retryCounts: Record<string, number> = {};
  for (const [id, count] of Object.entries(value)) {
    if (typeof count !== "number" || !Number.isFinite(count)) return null;
    retryCounts[id] = count;
  }
  return retryCounts;
}

function parseOutputs(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const outputs: Record<string, string> = {};
  for (const [id, text] of Object.entries(value)) {
    if (typeof text !== "string") return null;
    outputs[id] = text;
  }
  return outputs;
}

function parseArtifacts(value: unknown): { path: string; agentNodeId: string }[] | null {
  if (!Array.isArray(value)) return null;
  const artifacts: { path: string; agentNodeId: string }[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.path !== "string" || typeof item.agentNodeId !== "string") return null;
    artifacts.push({ path: item.path, agentNodeId: item.agentNodeId });
  }
  return artifacts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
