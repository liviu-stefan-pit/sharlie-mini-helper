/**
 * Responsibility: reject workspace folders that are missing, unsafe, or not writable.
 * Inputs: a candidate path and the app root.
 * Outputs: the real folder path, or the first failing error message.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { isInside, samePath } from "../library/paths";

export type WorkspaceCheck = { ok: true; path: string } | { ok: false; error: string };

export async function validateWorkspacePath(candidate: string, appRoot: string): Promise<WorkspaceCheck> {
  if (typeof candidate !== "string" || candidate.trim() === "") {
    return { ok: false, error: "Workspace path is empty" };
  }
  const trimmed = candidate.trim();
  if (!path.isAbsolute(trimmed)) {
    return { ok: false, error: "Workspace path must be absolute" };
  }

  let real: string;
  try {
    real = await fs.realpath(trimmed);
  } catch {
    return { ok: false, error: "Workspace folder does not exist" };
  }

  let stat;
  try {
    stat = await fs.stat(real);
  } catch {
    return { ok: false, error: "Workspace path is not a folder" };
  }
  if (!stat.isDirectory()) {
    return { ok: false, error: "Workspace path is not a folder" };
  }

  if (path.parse(real).root === real) {
    return { ok: false, error: "Pick a folder, not a whole drive" };
  }

  const appReal = await fs.realpath(appRoot);
  if (conflictsWithApp(real, appReal)) {
    return { ok: false, error: "The workspace cannot be the app folder, inside it, or contain it" };
  }

  const probe = path.join(real, ".sharlie-write-test");
  try {
    await fs.writeFile(probe, "ok", "utf8");
    await fs.unlink(probe);
  } catch {
    await fs.rm(probe, { force: true }).catch(() => undefined);
    return { ok: false, error: "Workspace folder is not writable" };
  }

  return { ok: true, path: real };
}

function conflictsWithApp(real: string, appReal: string): boolean {
  const folder = fold(real);
  const app = fold(appReal);
  return samePath(folder, app) || isInside(app, folder) || isInside(folder, app);
}

function fold(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}
