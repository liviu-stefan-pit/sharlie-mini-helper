/**
 * Responsibility: find SKILL.md files under a Cursor home skills folder.
 * Inputs: cursor home directory. Defaults to the user .cursor directory.
 * Outputs: skills sorted by title, deduplicated by real path.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseSkillMarkdown, type SkillSummary } from "./parseSkill";

export function defaultCursorHome(): string {
  return path.join(os.homedir(), ".cursor");
}

export async function scanSkills(cursorHome: string = defaultCursorHome()): Promise<SkillSummary[]> {
  const root = path.join(cursorHome, "skills");
  let rootReal: string;
  try {
    rootReal = await fs.realpath(root);
  } catch (error) {
    if (isSoft(error)) return [];
    throw error;
  }

  const files: string[] = [];
  await walk(root, rootReal, files, new Set());

  const seen = new Set<string>();
  const skills: SkillSummary[] = [];
  for (const file of files) {
    let real: string;
    try {
      real = await fs.realpath(file);
    } catch {
      continue;
    }
    if (!isInside(rootReal, real)) continue;
    const key = pathKey(real);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const markdown = await fs.readFile(real, "utf8");
      skills.push(parseSkillMarkdown(markdown, real));
    } catch {
      continue;
    }
  }

  skills.sort(
    (a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) ||
      a.skillPath.localeCompare(b.skillPath),
  );
  return skills;
}

async function walk(dir: string, rootReal: string, files: string[], seenDirs: Set<string>): Promise<void> {
  let realDir: string;
  try {
    realDir = await fs.realpath(dir);
  } catch (error) {
    if (isSoft(error)) return;
    throw error;
  }
  if (realDir !== rootReal && !isInside(rootReal, realDir)) return;
  const dirKey = pathKey(realDir);
  if (seenDirs.has(dirKey)) return;
  seenDirs.add(dirKey);

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isSoft(error)) return;
    throw error;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch (error) {
      if (isSoft(error)) continue;
      throw error;
    }
    if (stat.isDirectory()) {
      await walk(full, rootReal, files, seenDirs);
    } else if (stat.isFile() && entry.name === "SKILL.md") {
      files.push(full);
    }
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function pathKey(file: string): string {
  return process.platform === "win32" ? file.toLowerCase() : file;
}

function isSoft(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "EACCES" || code === "EPERM" || code === "ENOTDIR" || code === "ELOOP";
}
