/**
 * Responsibility: discovered-skill list for skill nodes and the inspector.
 * Inputs: skills returned by GET /api/skills.
 * Outputs: SkillsContext.
 */
import { createContext } from "react";
import type { SkillSummary } from "../skills/parseSkill";

export const SkillsContext = createContext<SkillSummary[]>([]);
