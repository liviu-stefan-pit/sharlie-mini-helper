/**
 * Responsibility: read, browse, and save the workspace folder.
 * Inputs: GET /api/workspace, POST /api/workspace/browse, and PUT /api/workspace.
 * Outputs: ActiveWorkspace JSON, a picked path, or 409 when a route requires a workspace.
 */
import { getActiveWorkspace, validateWorkspacePath, writeAppSettings } from "../../src/modules/workspace";
import { readJson, sendJson } from "../http";
import { openNativeDialog } from "../nativeDialog";
import type { RouteContext } from "./context";

export async function handleWorkspace(ctx: RouteContext): Promise<boolean> {
  if (ctx.url.pathname === "/api/workspace/browse") {
    if (ctx.req.method !== "POST") {
      sendJson(ctx.res, 405, { error: "Method not allowed" });
      return true;
    }
    let picked;
    try {
      picked = await openNativeDialog("workspace");
    } catch {
      sendJson(ctx.res, 500, { error: "Could not open the folder dialog" });
      return true;
    }
    if ("cancelled" in picked) {
      sendJson(ctx.res, 200, { cancelled: true });
      return true;
    }
    sendJson(ctx.res, 200, { path: picked.path });
    return true;
  }

  if (ctx.url.pathname !== "/api/workspace") return false;

  if (ctx.req.method === "GET") {
    sendJson(ctx.res, 200, await getActiveWorkspace(ctx.appRoot));
    return true;
  }

  if (ctx.req.method !== "PUT") {
    sendJson(ctx.res, 405, { error: "Method not allowed" });
    return true;
  }

  const body = await readJson(ctx.req);
  if (!isRecord(body) || (typeof body.path !== "string" && body.path !== null)) {
    sendJson(ctx.res, 400, { error: "path must be a string or null" });
    return true;
  }
  if (body.path === null) {
    await writeAppSettings(ctx.appRoot, { version: 1, workspacePath: null });
    sendJson(ctx.res, 200, { path: null, valid: false });
    return true;
  }
  const check = await validateWorkspacePath(body.path, ctx.appRoot);
  if (!check.ok) {
    sendJson(ctx.res, 400, { error: check.error });
    return true;
  }
  await writeAppSettings(ctx.appRoot, { version: 1, workspacePath: check.path });
  sendJson(ctx.res, 200, { path: check.path, valid: true });
  return true;
}

/** For other routes: returns the workspace path, or sends 409 and returns null. */
export async function requireWorkspace(ctx: RouteContext): Promise<string | null> {
  const active = await getActiveWorkspace(ctx.appRoot);
  if (active.valid) return active.path;
  sendJson(ctx.res, 409, { error: "Select a workspace in Settings first" });
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
