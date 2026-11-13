/**
 * Responsibility: find SKILL.md files under the user and workspace skill folders.
 * Inputs: workspace root directory.
 * Outputs: skills sorted by title, deduplicated by real path.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseSkillMarkdown, type SkillSummary } from "./parseSkill";

export async function scanSkills(workspaceRoot: string): Promise<SkillSummary[]> {
  const roots = [
    path.join(os.homedir(), ".cursor", "skills"),
    path.join(workspaceRoot, ".cursor", "skills"),
  ];
  const files: string[] = [];
  for (const root of roots) {
    await walk(root, files, new Set());
  }

  const seen = new Set<string>();
  const skills: SkillSummary[] = [];
  for (const file of files) {
    let real: string;
    try {
      real = await fs.realpath(file);
    } catch {
      continue;
    }
    const key = process.platform === "win32" ? real.toLowerCase() : real;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const markdown = await fs.readFile(file, "utf8");
      skills.push(parseSkillMarkdown(markdown, file));
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

async function walk(dir: string, files: string[], seenDirs: Set<string>): Promise<void> {
  let realDir: string;
  try {
    realDir = await fs.realpath(dir);
  } catch (error) {
    if (isMissing(error) || isAccess(error)) return;
    throw error;
  }
  const dirKey = process.platform === "win32" ? realDir.toLowerCase() : realDir;
  if (seenDirs.has(dirKey)) return;
  seenDirs.add(dirKey);

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error) || isAccess(error)) return;
    throw error;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch (error) {
      if (isMissing(error) || isAccess(error)) continue;
      throw error;
    }
    if (stat.isDirectory()) {
      await walk(full, files, seenDirs);
    } else if (stat.isFile() && entry.name === "SKILL.md") {
      files.push(full);
    }
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function isAccess(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EACCES" || code === "EPERM";
}
