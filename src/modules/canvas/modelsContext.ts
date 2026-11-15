/**
 * Responsibility: share the live model list with agent fields.
 * Inputs: models from GET /api/models.
 * Outputs: ModelsContext and CanvasAgentsContext.
 */
import { createContext } from "react";

export type ModelChoice = {
  id: string;
  label: string;
  effort: { value: string; label: string }[];
  /** "" when the model has no effort parameter. */
  effortParamId: string;
};

export const ModelsContext = createContext<readonly ModelChoice[]>([]);

/** Agent files already chosen on canvas nodes, including paths outside the Cursor agents folder. */
export type CanvasAgentChoice = { name: string; path: string };

export const CanvasAgentsContext = createContext<readonly CanvasAgentChoice[]>([]);
