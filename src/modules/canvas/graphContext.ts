/**
 * Responsibility: share edge-derived facts with node cards without each card reading the whole graph.
 * Inputs: canvas nodes, edges, and whether a run is active.
 * Outputs: the agents each human reviews (with names), and per-agent input progress.
 */
import { createContext, useContext } from "react";
import { graphShape, reviewSources } from "../graph/topology";
import type { FlowEdge, FlowNode } from "./flow";

export type ReviewSourceOption = { nodeId: string; name: string };

export type CanvasGraph = {
  running: boolean;
  /** Human node id → the agents it reviews. */
  reviewSources: Record<string, ReviewSourceOption[]>;
  /** Agent node id → how many of its inputs are satisfied. Only agents with inputs are listed. */
  inputs: Record<string, { satisfied: number; total: number }>;
};

export function agentLabel(node: FlowNode | undefined, nodeId: string): string {
  if (node?.type === "agent" && node.data.agentName.trim()) return node.data.agentName.trim();
  return `Agent ${nodeId.slice(0, 6)}`;
}

export function buildCanvasGraph(nodes: readonly FlowNode[], edges: readonly FlowEdge[], running: boolean): CanvasGraph {
  const shape = graphShape(nodes, edges);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const sources: CanvasGraph["reviewSources"] = {};
  const inputs: CanvasGraph["inputs"] = {};
  for (const node of nodes) {
    if (node.type === "human") {
      sources[node.id] = reviewSources(shape, node.id).map((id) => ({ nodeId: id, name: agentLabel(byId.get(id), id) }));
      continue;
    }
    const list = shape.inputs.get(node.id) ?? [];
    if (list.length === 0) continue;
    const satisfied = list.filter((id) => {
      const input = byId.get(id);
      if (input?.type === "agent") return input.data.status === "done";
      return input?.type === "human" && input.data.status === "approved";
    }).length;
    inputs[node.id] = { satisfied, total: list.length };
  }
  return { running, reviewSources: sources, inputs };
}

export const GraphContext = createContext<CanvasGraph>({ running: false, reviewSources: {}, inputs: {} });

export function useCanvasGraph(): CanvasGraph {
  return useContext(GraphContext);
}
