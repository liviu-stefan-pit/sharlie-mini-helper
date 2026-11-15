/**
 * Responsibility: remember the last directory used by the library browse dialogs.
 * Inputs: app library root, skill or rule kind, and chosen paths.
 * Outputs: data/library/browse.json. A missing directory does not throw. Cancel does not write.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { browseDirectoryFromPicks } from "./dialogPaths";
import { isRecord, isSoftFsError } from "./json";

type BrowseKind = "skill" | "rule";

type BrowseMemory = {
  skill?: string;
  rule?: string;
};

export async function readLastBrowseDir(appLibraryRoot: string, kind: BrowseKind): Promise<string | null> {
  const memory = await readBrowseMemory(appLibraryRoot);
  const dir = memory[kind];
  if (dir === undefined) return null;
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) return null;
    return dir;
  } catch {
    return null;
  }
}

export async function rememberBrowseDirectory(
  appLibraryRoot: string,
  kind: BrowseKind,
  picks: string[],
): Promise<void> {
  const dir = browseDirectoryFromPicks(picks);
  if (dir === null) return;
  const memory = await readBrowseMemory(appLibraryRoot);
  memory[kind] = dir;
  const file = path.join(appLibraryRoot, "browse.json");
  await fs.mkdir(appLibraryRoot, { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
}

async function readBrowseMemory(appLibraryRoot: string): Promise<BrowseMemory> {
  const file = path.join(appLibraryRoot, "browse.json");
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if (isSoftFsError(error)) return {};
    throw error;
  }
  try {
    return normalizeBrowseMemory(JSON.parse(raw.replace(/^\uFEFF/, "")));
  } catch {
    return {};
  }
}

function normalizeBrowseMemory(value: unknown): BrowseMemory {
  if (!isRecord(value)) return {};
  const memory: BrowseMemory = {};
  if (typeof value.skill === "string" && value.skill.trim() !== "") memory.skill = value.skill.trim();
  if (typeof value.rule === "string" && value.rule.trim() !== "") memory.rule = value.rule.trim();
  return memory;
}
