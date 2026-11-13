/**
 * Responsibility: GET /api/skills.
 * Inputs: HTTP request and workspace root.
 * Outputs: { skills } discovered from local SKILL.md files.
 */
import { scanSkills } from "../../src/modules/skills/scanSkills";
import { sendJson } from "../http";
import type { RouteContext } from "./context";

export async function handleSkills(ctx: RouteContext): Promise<boolean> {
  if (ctx.url.pathname !== "/api/skills") return false;
  if (ctx.req.method !== "GET") {
    sendJson(ctx.res, 405, { error: "Method not allowed" });
    return true;
  }
  const skills = await scanSkills(ctx.workspaceRoot);
  sendJson(ctx.res, 200, { skills });
  return true;
}
