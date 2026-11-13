/**
 * Responsibility: map between React Flow nodes and plain pipeline JSON.
 * Inputs: flow nodes, flow edges, and pipeline documents.
 * Outputs: PipelineNode, PipelineEdge, flow nodes, and new node ids.
 */
import type { Edge, Node } from "@xyflow/react";
import type { AgentNodeData, HumanNodeData, NodeKind, PipelineEdge, PipelineNode } from "../graph/types";

export type AgentFlowNode = Node<AgentNodeData, "agent">;
export type HumanFlowNode = Node<HumanNodeData, "human">;
export type FlowNode = AgentFlowNode | HumanFlowNode;
export type FlowEdge = Edge<{ kind: "execution" }>;

export function createNode(kind: NodeKind, position: { x: number; y: number }): FlowNode {
  const id = crypto.randomUUID();
  if (kind === "agent") {
    return {
      id,
      type: "agent",
      position,
      data: {
        modelId: "",
        agentPath: "",
        agentName: "",
        status: "idle",
        elapsedMs: 0,
        retryCount: 0,
        tokens: {},
      },
    };
  }
  return {
    id,
    type: "human",
    position,
    data: {
      status: "idle",
      artifactPaths: [],
    },
  };
}

export function makePipelineId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${slug || "pipeline"}-${suffix}`.slice(0, 80);
}

export function toPipelineNode(node: FlowNode): PipelineNode {
  const position = { x: node.position.x, y: node.position.y };
  if (node.type === "agent") {
    return { id: node.id, type: "agent", position, data: node.data };
  }
  return { id: node.id, type: "human", position, data: node.data };
}

export function toFlowNode(node: PipelineNode): FlowNode {
  if (node.type === "agent") {
    return { id: node.id, type: "agent", position: node.position, data: node.data };
  }
  return { id: node.id, type: "human", position: node.position, data: node.data };
}

export function toPipelineEdge(edge: FlowEdge): PipelineEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    kind: "execution",
  };
}

export function toFlowEdge(edge: PipelineEdge): FlowEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    data: { kind: "execution" },
  };
}
