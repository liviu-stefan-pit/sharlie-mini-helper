/**
 * Responsibility: map between React Flow nodes and plain pipeline JSON.
 * Inputs: flow nodes, flow edges, and pipeline documents.
 * Outputs: PipelineNode, PipelineEdge, flow nodes, new node ids, and agent defaults copied onto a new node.
 */
import type { Edge, Node } from "@xyflow/react";
import type { AgentNodeData, HumanNodeData, NodeKind, PipelineEdge, PipelineNode } from "../graph/types";

export type AgentDefaults = {
  modelId: string;
  effort: string;
  effortParamId: string;
  agentPath: string;
  agentName: string;
};

const blankAgentDefaults = (): AgentDefaults => ({
  modelId: "",
  effort: "",
  effortParamId: "",
  agentPath: "",
  agentName: "",
});

/**
 * Model and agent file are copied from separate nodes, walking from the end.
 * Human nodes are skipped. The nearest agent with a model supplies modelId, effort, and effortParamId.
 * The nearest agent with an agent file supplies agentPath and agentName.
 */
export function agentDefaultsFromNodes(nodes: readonly FlowNode[]): AgentDefaults {
  const defaults = blankAgentDefaults();
  let modelFound = false;
  let agentFound = false;
  for (let index = nodes.length - 1; index >= 0 && (!modelFound || !agentFound); index -= 1) {
    const node = nodes[index];
    if (!node || node.type !== "agent") continue;
    if (!modelFound && node.data.modelId !== "") {
      defaults.modelId = node.data.modelId;
      defaults.effort = node.data.effort;
      defaults.effortParamId = node.data.effortParamId;
      modelFound = true;
    }
    if (!agentFound && node.data.agentPath !== "") {
      defaults.agentPath = node.data.agentPath;
      defaults.agentName = node.data.agentName;
      agentFound = true;
    }
  }
  return defaults;
}

export type AgentPickerOption = { name: string; description: string; path: string };

/** Scan rows win on a shared path. Canvas-only paths are appended. Empty paths are dropped. */
export function mergeAgentOptions(
  scan: readonly { name: string; description?: string; path: string }[],
  canvas: readonly { name: string; path: string }[],
): AgentPickerOption[] {
  const byPath = new Map<string, AgentPickerOption>();
  for (const row of scan) {
    if (row.path === "" || byPath.has(row.path)) continue;
    byPath.set(row.path, { name: row.name, description: row.description ?? "", path: row.path });
  }
  for (const row of canvas) {
    if (row.path === "" || byPath.has(row.path)) continue;
    byPath.set(row.path, { name: row.name !== "" ? row.name : row.path, description: "", path: row.path });
  }
  return [...byPath.values()];
}

/** One picker row per agent path already stored on a canvas agent node. */
export function canvasAgentsFromNodes(nodes: readonly FlowNode[]): { name: string; path: string }[] {
  const byPath = new Map<string, string>();
  for (const node of nodes) {
    if (node.type !== "agent" || node.data.agentPath === "") continue;
    const label = node.data.agentName !== "" ? node.data.agentName : node.data.agentPath;
    const existing = byPath.get(node.data.agentPath);
    if (existing === undefined || existing === node.data.agentPath) byPath.set(node.data.agentPath, label);
  }
  return [...byPath.entries()].map(([path, name]) => ({ name, path }));
}

export type AgentFlowNode = Node<AgentNodeData, "agent">;
export type HumanFlowNode = Node<HumanNodeData, "human">;
export type FlowNode = AgentFlowNode | HumanFlowNode;
export type FlowEdge = Edge<{ kind: "execution" }>;

export function createNode(
  kind: NodeKind,
  position: { x: number; y: number },
  agentDefaults?: Partial<AgentDefaults>,
): FlowNode {
  const id = crypto.randomUUID();
  if (kind === "agent") {
    const copied = { ...blankAgentDefaults(), ...agentDefaults };
    return {
      id,
      type: "agent",
      position,
      data: {
        modelId: copied.modelId ?? "",
        effort: copied.effort ?? "",
        effortParamId: copied.effortParamId ?? "",
        agentPath: copied.agentPath ?? "",
        agentName: copied.agentName ?? "",
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
