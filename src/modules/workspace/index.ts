/**
 * Responsibility: workspace settings and path checks.
 * Inputs: app root, a candidate folder path, and an optional temp root.
 * Outputs: stored settings and the active workspace, or a temporary folder when none is stored.
 */
export { appSettingsPath, readAppSettings, writeAppSettings, type AppSettings } from "./settings";
export { validateWorkspacePath, type WorkspaceCheck } from "./validate";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readAppSettings } from "./settings";
import { validateWorkspacePath } from "./validate";

export const TEMP_WORKSPACE_DIRNAME = "sharlie-easy-flow";

export type ActiveWorkspace =
  | { path: string; valid: true; temporary: true }
  | { path: string; valid: true }
  | { path: string; valid: false; error: string }
  | { path: null; valid: false };

/** Reads settings and re-validates the stored folder (it may have been deleted since). No stored path uses <tempRoot>/sharlie-easy-flow. */
export async function getActiveWorkspace(appRoot: string, tempRoot = os.tmpdir()): Promise<ActiveWorkspace> {
  const settings = await readAppSettings(appRoot);
  if (settings.workspacePath !== null) {
    const storedPath = settings.workspacePath;
    const check = await validateWorkspacePath(storedPath, appRoot);
    if (check.ok) return { path: check.path, valid: true };
    return { path: storedPath, valid: false, error: check.error };
  }

  const folder = path.join(tempRoot, TEMP_WORKSPACE_DIRNAME);
  try {
    await fs.mkdir(folder, { recursive: true });
    const check = await validateWorkspacePath(folder, appRoot);
    if (!check.ok) return { path: null, valid: false };
    return { path: check.path, valid: true, temporary: true };
  } catch {
    return { path: null, valid: false };
  }
}
