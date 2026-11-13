/**
 * Responsibility: list Cursor agent files and browse for one markdown file.
 * Inputs: GET /api/agents and POST /api/agents/browse.
 * Outputs: agent name, description, and path. Browse does not copy the file.
 */
import { AgentFileError, describeAgentFile, scanAgents } from "../../src/modules/agents/agentFile";
import { defaultCursorHome } from "../../src/modules/skills/scanSkills";
import { sendJson } from "../http";
import { openNativeDialog } from "../nativeDialog";
import type { RouteContext } from "./context";

export async function handleAgents(ctx: RouteContext): Promise<boolean> {
  if (ctx.url.pathname === "/api/agents") {
    if (ctx.req.method !== "GET") {
      sendJson(ctx.res, 405, { error: "Method not allowed" });
      return true;
    }
    const agents = await scanAgents(defaultCursorHome());
    sendJson(ctx.res, 200, { agents });
    return true;
  }

  if (ctx.url.pathname !== "/api/agents/browse") return false;
  if (ctx.req.method !== "POST") {
    sendJson(ctx.res, 405, { error: "Method not allowed" });
    return true;
  }

  let picked;
  try {
    picked = await openNativeDialog("agent");
  } catch {
    sendJson(ctx.res, 500, { error: "Could not open the file dialog" });
    return true;
  }
  if ("cancelled" in picked) {
    sendJson(ctx.res, 200, { cancelled: true });
    return true;
  }
  try {
    const agent = await describeAgentFile(picked.path);
    sendJson(ctx.res, 200, { name: agent.name, description: agent.description, path: agent.path });
  } catch (error) {
    if (error instanceof AgentFileError) {
      sendJson(ctx.res, 400, { error: error.message });
      return true;
    }
    throw error;
  }
  return true;
}
