/**
 * Responsibility: share the active run and review actions with human cards.
 * Inputs: the run id, a decision callback, and a file preview callback.
 * Outputs: RunContext used by the human node and the inspector.
 */
import { createContext, useContext } from "react";

export type ReviewDecision = "approve" | "redo" | "decline";

export type RunActions = {
  runId: string | null;
  /** `redoNodeId` picks one reviewed agent for Redo one. */
  decide: (nodeId: string, decision: ReviewDecision, redoNodeId?: string) => void;
  previewPath: (filePath: string) => void;
};

export const RunContext = createContext<RunActions>({
  runId: null,
  decide: () => {},
  previewPath: () => {},
});

export function useRunActions(): RunActions {
  return useContext(RunContext);
}
