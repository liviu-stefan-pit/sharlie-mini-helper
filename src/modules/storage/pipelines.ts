/**
 * Responsibility: read and write one workflow.json per pipeline under the workspace.
 * Inputs: workspace folder, pipeline id, and pipeline documents.
 * Outputs: pipeline summaries, full documents, or null when a file is missing.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgentNodeData,
  AgentStatus,
  HumanNodeData,
  HumanStatus,
  PipelineDocument,
  PipelineEdge,
  PipelineNode,
  PipelineSummary,
} from "../graph/types";

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
const AGENT_STATUSES: readonly AgentStatus[] = ["idle", "running", "redoing", "done", "error"];
const HUMAN_STATUSES: readonly HumanStatus[] = ["idle", "waiting", "approved", "declined"];

export class PipelineValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineValidationError";
  }
}

export const WORKFLOW_META_DIR = ".sharlie";
export const WORKFLOW_FILE = "workflow.json";

export function isSafePipelineId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function workflowDir(workspace: string, id: string): string {
  if (!isSafePipelineId(id)) {
    throw new PipelineValidationError("Invalid pipeline id");
  }
  return path.join(workspace, id);
}

export function workflowFile(workspace: string, id: string): string {
  return path.join(workflowDir(workspace, id), WORKFLOW_META_DIR, WORKFLOW_FILE);
}

export function newPipelineId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
  return `${slug || "pipeline"}-${suffix}`.slice(0, 80);
}

export async function listPipelines(workspace: string): Promise<PipelineSummary[]> {
  let entries;
  try {
    entries = await fs.readdir(workspace, { withFileTypes: true });
  } catch (error) {
    if (isSoft(error)) return [];
    throw error;
  }
  const summaries: PipelineSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isSafePipelineId(entry.name)) continue;
    try {
      await fs.access(workflowFile(workspace, entry.name));
    } catch {
      continue;
    }
    try {
      const doc = await readPipeline(workspace, entry.name);
      if (!doc) continue;
      summaries.push({ id: doc.id, name: doc.name, updatedAt: doc.updatedAt });
    } catch {
      continue;
    }
  }
  summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return summaries;
}

export async function readPipeline(workspace: string, id: string): Promise<PipelineDocument | null> {
  if (!isSafePipelineId(id)) {
    throw new PipelineValidationError("Invalid pipeline id");
  }
  const file = workflowFile(workspace, id);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    throw new PipelineValidationError("Pipeline file is not valid JSON");
  }
  return normalizePipeline(parsed, id);
}

export async function writePipeline(workspace: string, input: unknown, id: string): Promise<PipelineDocument> {
  const doc = normalizePipeline(input, id);
  const next: PipelineDocument = {
    ...doc,
    updatedAt: new Date().toISOString(),
  };
  const dir = path.join(workflowDir(workspace, id), WORKFLOW_META_DIR);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `${WORKFLOW_FILE}.tmp`);
  const file = path.join(dir, WORKFLOW_FILE);
  await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await fs.rename(tmp, file);
  return next;
}

export function normalizePipeline(input: unknown, id: string): PipelineDocument {
  if (!isSafePipelineId(id)) {
    throw new PipelineValidationError("Invalid pipeline id");
  }
  if (!isRecord(input)) {
    throw new PipelineValidationError("Pipeline body must be an object");
  }
  if (input.version !== 1) {
    throw new PipelineValidationError("Pipeline version must be 1");
  }
  if (typeof input.name !== "string") {
    throw new PipelineValidationError("Pipeline name must be a string");
  }
  if (!Array.isArray(input.nodes) || !Array.isArray(input.edges)) {
    throw new PipelineValidationError("Pipeline nodes and edges must be arrays");
  }
  const name = input.name.trim() || "Untitled";
  const nodes = input.nodes
    .map((node, index) => parseNode(node, index))
    .filter((node): node is PipelineNode => node !== null);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = input.edges
    .map((edge, index) => parseEdge(edge, index))
    .filter((edge): edge is PipelineEdge => edge !== null)
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  return {
    version: 1,
    id,
    name,
    nodes,
    edges,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : new Date().toISOString(),
  };
}

function parseNode(value: unknown, index: number): PipelineNode | null {
  if (!isRecord(value)) {
    throw new PipelineValidationError(`Node ${index} must be an object`);
  }
  if (value.type === "skill") return null;
  const id = requiredString(value.id, `nodes[${index}].id`);
  const position = parsePosition(value.position, index);
  if (value.type === "agent") {
    return { id, type: "agent", position, data: parseAgentData(value.data, index) };
  }
  if (value.type === "human") {
    return { id, type: "human", position, data: parseHumanData(value.data, index) };
  }
  throw new PipelineValidationError(`Node ${index} has an unknown type`);
}

function parseEdge(value: unknown, index: number): PipelineEdge | null {
  if (!isRecord(value)) {
    throw new PipelineValidationError(`Edge ${index} must be an object`);
  }
  if (value.kind === "attachment") return null;
  if (value.kind !== "execution") {
    throw new PipelineValidationError(`Edge ${index} kind must be execution`);
  }
  return {
    id: requiredString(value.id, `edges[${index}].id`),
    source: requiredString(value.source, `edges[${index}].source`),
    target: requiredString(value.target, `edges[${index}].target`),
    kind: "execution",
  };
}

function parsePosition(value: unknown, index: number): { x: number; y: number } {
  if (!isRecord(value)) {
    throw new PipelineValidationError(`Node ${index} position must be an object`);
  }
  return {
    x: requiredNumber(value.x, `nodes[${index}].position.x`),
    y: requiredNumber(value.y, `nodes[${index}].position.y`),
  };
}

function parseAgentData(value: unknown, index: number): AgentNodeData {
  if (!isRecord(value)) throw new PipelineValidationError(`Node ${index} data must be an object`);
  if (!isRecord(value.tokens)) {
    throw new PipelineValidationError(`Node ${index} tokens must be an object`);
  }
  const data: AgentNodeData = {
    modelId: requiredString(value.modelId, `nodes[${index}].modelId`),
    agentPath: missingString(value.agentPath, `nodes[${index}].agentPath`),
    agentName: missingString(value.agentName, `nodes[${index}].agentName`),
    status: oneOf(value.status, AGENT_STATUSES, `nodes[${index}].status`),
    elapsedMs: requiredNumber(value.elapsedMs, `nodes[${index}].elapsedMs`),
    retryCount: requiredNumber(value.retryCount, `nodes[${index}].retryCount`),
    tokens: {
      input: optionalNumber(value.tokens.input, `nodes[${index}].tokens.input`),
      output: optionalNumber(value.tokens.output, `nodes[${index}].tokens.output`),
      total: optionalNumber(value.tokens.total, `nodes[${index}].tokens.total`),
    },
  };
  if (value.lastOutput !== undefined) {
    data.lastOutput = requiredString(value.lastOutput, `nodes[${index}].lastOutput`);
  }
  return data;
}

function parseHumanData(value: unknown, index: number): HumanNodeData {
  if (!isRecord(value)) throw new PipelineValidationError(`Node ${index} data must be an object`);
  if (!Array.isArray(value.artifactPaths)) {
    throw new PipelineValidationError(`Node ${index} artifactPaths must be an array`);
  }
  return {
    status: oneOf(value.status, HUMAN_STATUSES, `nodes[${index}].status`),
    artifactPaths: value.artifactPaths.map((item, pathIndex) =>
      requiredString(item, `nodes[${index}].artifactPaths[${pathIndex}]`),
    ),
  };
}

function missingString(value: unknown, label: string): string {
  if (value === undefined) return "";
  return requiredString(value, label);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new PipelineValidationError(`${label} must be a string`);
  }
  return value;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  return requiredNumber(value, label);
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PipelineValidationError(`${label} must be a finite number`);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new PipelineValidationError(`${label} is invalid`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSoft(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "EACCES" || code === "EPERM" || code === "ENOTDIR" || code === "ELOOP";
}
