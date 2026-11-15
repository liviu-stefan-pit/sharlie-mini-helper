/**
 * Responsibility: turn a pipeline document into ordered agent and human steps.
 * Inputs: a PipelineDocument.
 * Outputs: ExecutionStep list, or GraphError when the graph is invalid.
 */
import { resolveModelId } from "../cursor/models";
import type { PipelineDocument, PipelineNode } from "./types";

export class GraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphError";
  }
}

/** `inputs` are the distinct sources of edges into the node, in step order. */
export type ExecutionStep =
  | {
      kind: "agent";
      nodeId: string;
      inputs: string[];
      modelId: string;
      agentPath: string;
      agentName: string;
      effort: string;
      effortParamId: string;
    }
  | { kind: "human"; nodeId: string; inputs: string[] };

export function resolvePipeline(doc: PipelineDocument): ExecutionStep[] {
  const nodes = new Map<string, PipelineNode>();
  for (const node of doc.nodes) {
    if (nodes.has(node.id)) {
      throw new GraphError(`Duplicate node id ${node.id}`);
    }
    const type = node.type as string;
    if (type !== "agent" && type !== "human") {
      throw new GraphError("Unknown node type");
    }
    nodes.set(node.id, node);
  }

  const executionIds = doc.nodes.map((node) => node.id);
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const sources = new Map<string, Set<string>>();
  for (const id of executionIds) {
    indegree.set(id, 0);
    outgoing.set(id, []);
    sources.set(id, new Set());
  }
  for (const edge of doc.edges) {
    const kind = edge.kind as string;
    if (kind !== "execution") {
      throw new GraphError("Attachment edges are not supported");
    }
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) {
      throw new GraphError("Execution edge must connect agent or human nodes");
    }
    const targetSources = sources.get(edge.target);
    // A duplicate edge between the same two nodes counts once.
    if (targetSources?.has(edge.source)) continue;
    targetSources?.add(edge.source);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }

  const ready = executionIds.filter((id) => indegree.get(id) === 0).sort(byId);
  const ordered: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift();
    if (!id) break;
    ordered.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const degree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, degree);
      if (degree === 0) {
        ready.push(next);
        ready.sort(byId);
      }
    }
  }
  if (ordered.length !== executionIds.length) {
    throw new GraphError("Cycle in pipeline");
  }

  const position = new Map(ordered.map((id, index) => [id, index]));
  const inputsOf = (id: string): string[] =>
    [...(sources.get(id) ?? [])].sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));

  return ordered.map((id) => {
    const node = nodes.get(id);
    if (!node) {
      throw new GraphError("Execution node is missing");
    }
    if (node.type === "human") {
      return { kind: "human", nodeId: node.id, inputs: inputsOf(node.id) };
    }
    const modelId = resolveModelId(node.data);
    if (!modelId) {
      throw new GraphError("Model id is empty");
    }
    return {
      kind: "agent",
      nodeId: node.id,
      inputs: inputsOf(node.id),
      modelId,
      agentPath: node.data.agentPath,
      agentName: node.data.agentName.trim(),
      effort: node.data.effort.trim(),
      effortParamId: node.data.effortParamId.trim(),
    };
  });
}

function byId(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
