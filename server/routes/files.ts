/**
 * Responsibility: read a file inside the selected workspace for the canvas preview.
 * Inputs: GET /api/files?path= and the workspace folder.
 * Outputs: utf8 text, or 400/403/404/409 when the path is missing, forbidden, or no workspace is selected. Refuses the workspace .env file, any .env or .env.* file, and data/library/mcp.json.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { sendJson } from "../http";
import type { RouteContext } from "./context";
import { requireWorkspace } from "./workspace";

const MAX_BYTES = 200_000;

export async function handleFiles(ctx: RouteContext): Promise<boolean> {
  if (ctx.url.pathname !== "/api/files") return false;
  if (ctx.req.method !== "GET") {
    sendJson(ctx.res, 405, { error: "Method not allowed" });
    return true;
  }
  const workspace = await requireWorkspace(ctx);
  if (!workspace) return true;

  const requested = ctx.url.searchParams.get("path");
  if (requested === null || requested.trim() === "") {
    sendJson(ctx.res, 400, { error: "path is required" });
    return true;
  }

  let root: string;
  try {
    root = await fs.realpath(workspace);
  } catch {
    sendJson(ctx.res, 400, { error: "Workspace is not available" });
    return true;
  }

  const resolved = path.resolve(root, requested.trim());
  if (escapes(root, resolved)) {
    sendJson(ctx.res, 400, { error: "Path is outside the workspace" });
    return true;
  }

  let real: string;
  try {
    real = await fs.realpath(resolved);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      sendJson(ctx.res, 404, { error: "File not found" });
      return true;
    }
    sendJson(ctx.res, 400, { error: "Could not read file" });
    return true;
  }

  if (escapes(root, real)) {
    sendJson(ctx.res, 400, { error: "Path is outside the workspace" });
    return true;
  }

  const relPosix = path.relative(root, real).split(/[/\\]/).join("/");
  if (
    (await isWorkspaceEnv(root, real, relPosix)) ||
    (await isLibraryMcp(root, real, relPosix)) ||
    isEnvFileName(path.basename(real))
  ) {
    sendJson(ctx.res, 403, { error: "Forbidden" });
    return true;
  }

  let stat;
  try {
    stat = await fs.stat(real);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      sendJson(ctx.res, 404, { error: "File not found" });
      return true;
    }
    sendJson(ctx.res, 400, { error: "Could not read file" });
    return true;
  }
  if (stat.isDirectory()) {
    sendJson(ctx.res, 400, { error: "Path is a directory" });
    return true;
  }

  try {
    const truncated = stat.size > MAX_BYTES;
    const buffer = truncated ? await readPrefix(real, MAX_BYTES) : await fs.readFile(real);
    let content = buffer.toString("utf8");
    const overChars = content.length > MAX_BYTES;
    if (overChars) content = content.slice(0, MAX_BYTES);
    sendJson(ctx.res, 200, { path: relPosix, content, truncated: truncated || overChars });
  } catch {
    sendJson(ctx.res, 400, { error: "Could not read file" });
  }
  return true;
}

function isEnvFileName(name: string): boolean {
  const fileName = process.platform === "win32" ? name.toLowerCase() : name;
  return fileName === ".env" || fileName.startsWith(".env.");
}

function escapes(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel.startsWith("..") || path.isAbsolute(rel);
}

async function isLibraryMcp(root: string, real: string, relPosix: string): Promise<boolean> {
  if (relPosix === "data/library/mcp.json") return true;
  try {
    const mcpReal = await fs.realpath(path.join(root, "data", "library", "mcp.json"));
    return sameFile(real, mcpReal);
  } catch {
    return false;
  }
}

function sameFile(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

async function isWorkspaceEnv(root: string, real: string, relPosix: string): Promise<boolean> {
  if (relPosix === ".env") return true;
  try {
    const envReal = await fs.realpath(path.join(root, ".env"));
    return real === envReal;
  } catch {
    return false;
  }
}

async function readPrefix(file: string, bytes: number): Promise<Buffer> {
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
