/**
 * Responsibility: turn a run or health request body into a pipeline document.
 * Inputs: an unknown JSON value.
 * Outputs: a version 1 PipelineDocument, or GraphError when the body is not a pipeline.
 */
import type { PipelineDocument, PipelineEdge, PipelineNode } from "../../src/modules/graph/types";
import { GraphError } from "../../src/modules/graph/resolve";
import { parseDependencies } from "../../src/modules/storage/pipelines";

export function coercePipeline(input: unknown): PipelineDocument {
  if (!isRecord(input)) throw new GraphError("Pipeline body must be an object");
  if (input.version !== 1) throw new GraphError("Pipeline version must be 1");
  if (!Array.isArray(input.nodes) || !Array.isArray(input.edges)) {
    throw new GraphError("Pipeline nodes and edges must be arrays");
  }
  const doc: PipelineDocument = {
    version: 1,
    id: typeof input.id === "string" && input.id.trim() ? input.id : "pipeline",
    name: typeof input.name === "string" && input.name.trim() ? input.name.trim() : "Untitled",
    nodes: input.nodes.map((node, index) => coerceNode(node, index)),
    edges: input.edges.map((edge, index) => coerceEdge(edge, index)),
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : new Date().toISOString(),
  };
  if (input.dependencies !== undefined) {
    doc.dependencies = parseDependencies(input.dependencies);
  }
  return doc;
}

export function coerceNode(value: unknown, index: number): PipelineNode {
  if (!isRecord(value)) throw new GraphError(`Node ${index} must be an object`);
  if (typeof value.id !== "string" || !value.id.trim()) throw new GraphError(`Node ${index} id is required`);
  const position = nodePosition(value.position);
  const data = isRecord(value.data) ? value.data : undefined;
  if (!data) throw new GraphError(`Node ${index} data must be an object`);
  if (value.type === "agent") {
    return {
      id: value.id,
      type: "agent",
      position,
      data: {
        modelId: typeof data.modelId === "string" ? data.modelId : "",
        agentPath: typeof data.agentPath === "string" ? data.agentPath : "",
        agentName: typeof data.agentName === "string" ? data.agentName : "",
        status: "idle",
        elapsedMs: 0,
        retryCount: 0,
        tokens: {},
      },
    };
  }
  if (value.type === "human") {
    return {
      id: value.id,
      type: "human",
      position,
      data: {
        status: "idle",
        artifactPaths: [],
      },
    };
  }
  throw new GraphError(`Node ${index} has an unknown type`);
}

export function coerceEdge(value: unknown, index: number): PipelineEdge {
  if (!isRecord(value)) throw new GraphError(`Edge ${index} must be an object`);
  if (value.kind !== "execution") {
    throw new GraphError(`Edge ${index} kind must be execution`);
  }
  if (typeof value.id !== "string" || typeof value.source !== "string" || typeof value.target !== "string") {
    throw new GraphError(`Edge ${index} is incomplete`);
  }
  return { id: value.id, source: value.source, target: value.target, kind: "execution" };
}

export function nodePosition(value: unknown): { x: number; y: number } {
  if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number") {
    return { x: 0, y: 0 };
  }
  return { x: value.x, y: value.y };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
