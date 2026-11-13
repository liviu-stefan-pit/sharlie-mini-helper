/**
 * Responsibility: share the live model list with agent fields.
 * Inputs: models from GET /api/models.
 * Outputs: ModelsContext.
 */
import { createContext } from "react";

export type ModelChoice = { id: string; label: string };

export const ModelsContext = createContext<readonly ModelChoice[]>([]);
