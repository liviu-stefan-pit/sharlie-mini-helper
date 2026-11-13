/**
 * Responsibility: let node cards and the inspector update the same node data.
 * Inputs: a node id and a partial data patch.
 * Outputs: PatchContext used inside the React Flow provider.
 */
import { createContext, useContext } from "react";

export type PatchNode = (id: string, patch: Record<string, unknown>) => void;

export const PatchContext = createContext<PatchNode>(() => {});

export function usePatchNode(id: string): (patch: Record<string, unknown>) => void {
  const patchNode = useContext(PatchContext);
  return (patch) => patchNode(id, patch);
}
