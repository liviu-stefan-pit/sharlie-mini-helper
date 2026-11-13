/**
 * Responsibility: library locations, containment checks, and stable ids.
 * Inputs: workspace root, cursor home, and real file paths.
 * Outputs: directory paths and cursor:/app: ids.
 */
import path from "node:path";

export { defaultCursorHome } from "../skills/scanSkills";

export function libraryRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, "data", "library");
}

export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function toPosixRelative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

export function cursorFileId(realPath: string): string {
  return `cursor:${realPath}`;
}

export function appFileId(relativePosix: string): string {
  return `app:${relativePosix}`;
}

export function cursorMcpId(mcpRealPath: string, serverName: string): string {
  return `cursor:${mcpRealPath}#${serverName}`;
}

export function appMcpId(serverName: string): string {
  return `app:mcp:${serverName}`;
}

export function isCursorSourceId(id: string): boolean {
  return id.startsWith("cursor:");
}

export function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
