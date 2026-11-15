/**
 * Responsibility: pure graph questions shared by the run engine and the canvas.
 * Inputs: node ids with their kind, and execution edges (source → target).
 * Outputs: the inputs of a node, the agents a human node reviews, and whether a new edge would close a cycle.
 */
import type { NodeKind } from "./types";

export type GraphShape = {
  kinds: ReadonlyMap<string, NodeKind>;
  /** Distinct sources of the edges that point into each node, in the order given. */
  inputs: ReadonlyMap<string, readonly string[]>;
};

/** Build a shape from canvas or document nodes and edges. Edges to unknown nodes are ignored. */
export function graphShape(
  nodes: readonly { id: string; type?: string }[],
  edges: readonly { source: string; target: string }[],
): GraphShape {
  const kinds = new Map<string, NodeKind>();
  for (const node of nodes) {
    if (node.type === "agent" || node.type === "human") kinds.set(node.id, node.type);
  }
  const inputs = new Map<string, string[]>();
  for (const id of kinds.keys()) inputs.set(id, []);
  for (const edge of edges) {
    if (!kinds.has(edge.source)) continue;
    const list = inputs.get(edge.target);
    if (!list || list.includes(edge.source)) continue;
    list.push(edge.source);
  }
  return { kinds, inputs };
}

/** Build a shape from resolved steps, which already carry their inputs. */
export function shapeFromSteps(
  steps: readonly { kind: NodeKind; nodeId: string; inputs: readonly string[] }[],
): GraphShape {
  const kinds = new Map<string, NodeKind>();
  const inputs = new Map<string, readonly string[]>();
  for (const step of steps) {
    kinds.set(step.nodeId, step.kind);
    inputs.set(step.nodeId, step.inputs);
  }
  return { kinds, inputs };
}

/**
 * The nearest agents behind a human node, walking back through other human nodes.
 * `A → H1 → H2` gives `[A]` for H2. Each agent appears once, in input order.
 */
export function reviewSources(shape: GraphShape, humanId: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>([humanId]);
  const visit = (id: string) => {
    for (const input of shape.inputs.get(id) ?? []) {
      if (seen.has(input)) continue;
      seen.add(input);
      const kind = shape.kinds.get(input);
      if (kind === "agent") found.push(input);
      else if (kind === "human") visit(input);
    }
  };
  visit(humanId);
  return found;
}

/** True when adding `source → target` would close a cycle (including a self-loop). */
export function wouldCreateCycle(
  edges: readonly { source: string; target: string }[],
  source: string,
  target: string,
): boolean {
  if (source === target) return true;
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.source);
    if (list) list.push(edge.target);
    else outgoing.set(edge.source, [edge.target]);
  }
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || seen.has(id)) continue;
    if (id === source) return true;
    seen.add(id);
    stack.push(...(outgoing.get(id) ?? []));
  }
  return false;
}
