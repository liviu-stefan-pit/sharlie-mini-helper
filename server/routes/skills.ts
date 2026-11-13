/**
 * Responsibility: GET /api/skills.
 * Inputs: HTTP request and workspace root.
 * Outputs: { skills } with title, description, and skillPath from the user Cursor skills folder and app library skills.
 */
import { libraryRoot } from "../../src/modules/library/paths";
import type { SkillSummary } from "../../src/modules/skills/parseSkill";
import { scanSkills } from "../../src/modules/skills/scanSkills";
import { sendJson } from "../http";
import type { RouteContext } from "./context";

export async function handleSkills(ctx: RouteContext): Promise<boolean> {
  if (ctx.url.pathname !== "/api/skills") return false;
  if (ctx.req.method !== "GET") {
    sendJson(ctx.res, 405, { error: "Method not allowed" });
    return true;
  }
  const skills = mergeSkills([
    await scanSkills(),
    await scanSkills(libraryRoot(ctx.appRoot)),
  ]);
  sendJson(ctx.res, 200, { skills });
  return true;
}

function mergeSkills(groups: SkillSummary[][]): SkillSummary[] {
  const seen = new Set<string>();
  const skills: SkillSummary[] = [];
  for (const group of groups) {
    for (const skill of group) {
      const key = process.platform === "win32" ? skill.skillPath.toLowerCase() : skill.skillPath;
      if (seen.has(key)) continue;
      seen.add(key);
      skills.push(skill);
    }
  }
  skills.sort(
    (a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) ||
      a.skillPath.localeCompare(b.skillPath),
  );
  return skills;
}
