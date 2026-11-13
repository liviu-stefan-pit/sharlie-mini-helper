/**
 * Responsibility: share workflow health with agent cards and the inspector.
 * Inputs: the latest WorkflowHealth from POST /api/workflow/health.
 * Outputs: HealthContext.
 */
import { createContext } from "react";
import type { WorkflowHealth } from "../workflow/health";

export const HealthContext = createContext<WorkflowHealth | null>(null);
