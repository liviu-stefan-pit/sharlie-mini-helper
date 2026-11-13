/**
 * Responsibility: workspace settings and path checks.
 * Inputs: app root and a candidate folder path.
 * Outputs: stored settings and the active workspace status.
 */
export { appSettingsPath, readAppSettings, writeAppSettings, type AppSettings } from "./settings";
export { validateWorkspacePath, type WorkspaceCheck } from "./validate";

import { readAppSettings } from "./settings";
import { validateWorkspacePath } from "./validate";

export type ActiveWorkspace =
  | { path: string; valid: true }
  | { path: string; valid: false; error: string }
  | { path: null; valid: false };

/** Reads settings and re-validates the stored folder (it may have been deleted since). */
export async function getActiveWorkspace(appRoot: string): Promise<ActiveWorkspace> {
  const settings = await readAppSettings(appRoot);
  if (settings.workspacePath === null) return { path: null, valid: false };
  const storedPath = settings.workspacePath;
  const check = await validateWorkspacePath(storedPath, appRoot);
  if (check.ok) return { path: check.path, valid: true };
  return { path: storedPath, valid: false, error: check.error };
}
