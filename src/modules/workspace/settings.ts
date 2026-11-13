/**
 * Responsibility: read and write data/app/settings.json.
 * Inputs: app root and an AppSettings value.
 * Outputs: { version: 1, workspacePath }. A bad file becomes a null path.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { isRecord, isSoftFsError } from "../library/json";

export type AppSettings = { version: 1; workspacePath: string | null };

export function appSettingsPath(appRoot: string): string {
  return path.join(appRoot, "data", "app", "settings.json");
}

export async function readAppSettings(appRoot: string): Promise<AppSettings> {
  let raw: string;
  try {
    raw = await fs.readFile(appSettingsPath(appRoot), "utf8");
  } catch (error) {
    if (isSoftFsError(error)) return emptySettings();
    return emptySettings();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return emptySettings();
  }
  if (!isRecord(parsed) || typeof parsed.workspacePath !== "string" || parsed.workspacePath.trim() === "") {
    return emptySettings();
  }
  return { version: 1, workspacePath: parsed.workspacePath };
}

export async function writeAppSettings(appRoot: string, settings: AppSettings): Promise<void> {
  const file = appSettingsPath(appRoot);
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, "settings.json.tmp");
  await fs.writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await fs.rename(tmp, file);
}

function emptySettings(): AppSettings {
  return { version: 1, workspacePath: null };
}
