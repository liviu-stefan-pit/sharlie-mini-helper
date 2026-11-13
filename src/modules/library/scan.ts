/**
 * Responsibility: scan Cursor home skills, rules, and mcp.json, and merge imported paths.
 * Inputs: cursorHome and appLibraryRoot. Both are required so tests never touch the real home.
 * Outputs: a snapshot with enabled flags. Env values and header values are omitted.
 * The app library root is read for selection.json and imports.json only.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parseSkillMarkdown } from "../skills/parseSkill";
import { scanSkills } from "../skills/scanSkills";
import { readImports } from "./imports";
import { isSoftFsError } from "./json";
import { readMcpServers, type ParsedMcp } from "./mcpFile";
import { cursorFileId, cursorMcpId } from "./paths";
import { readSelection } from "./selection";
import type { LibraryMcp, LibraryRoots, LibraryRule, LibrarySkill, LibrarySnapshot, LibrarySource } from "./types";
import { walkFiles } from "./walk";

export async function scanLibrary(roots: LibraryRoots): Promise<LibrarySnapshot> {
  const [cursorSkills, cursorRules, imported, mcps, selection] = await Promise.all([
    loadSkills(roots.cursorHome),
    loadRules(path.join(roots.cursorHome, "rules")),
    loadImportRows(roots.appLibraryRoot),
    loadMcps(roots.cursorHome),
    readSelection(roots.appLibraryRoot),
  ]);
  return {
    skills: markEnabled(sortByTitle(mergeByPath(cursorSkills, imported.skills)), selection.skills),
    rules: markEnabled(sortByTitle(mergeByPath(cursorRules, imported.rules)), selection.rules),
    mcps: markEnabled(sortByName(mcps), selection.mcps),
  };
}

async function loadSkills(cursorHome: string): Promise<LibrarySkill[]> {
  const found = await scanSkills(cursorHome);
  const skills: LibrarySkill[] = [];
  const seen = new Set<string>();
  for (const skill of found) {
    const key = pathKey(skill.skillPath);
    if (seen.has(key)) continue;
    seen.add(key);
    skills.push({
      id: cursorFileId(skill.skillPath),
      source: "cursor",
      title: skill.title,
      description: skill.description,
      path: skill.skillPath,
      enabled: false,
    });
  }
  return skills;
}

async function loadRules(dir: string): Promise<LibraryRule[]> {
  const files = await walkFiles(dir, isRuleName);
  const rules: LibraryRule[] = [];
  for (const file of files) {
    let markdown: string;
    try {
      markdown = await fs.readFile(file, "utf8");
    } catch (error) {
      if (isSoftFsError(error)) continue;
      throw error;
    }
    const parsed = parseSkillMarkdown(markdown, file);
    rules.push({
      id: cursorFileId(file),
      source: "cursor",
      title: parsed.title,
      description: parsed.description,
      path: file,
      enabled: false,
    });
  }
  return rules;
}

async function loadImportRows(appLibraryRoot: string): Promise<{ skills: LibrarySkill[]; rules: LibraryRule[] }> {
  const imported = await readImports(appLibraryRoot);
  const [skills, rules] = await Promise.all([loadImported(imported.skills), loadImported(imported.rules)]);
  return { skills, rules };
}

async function loadImported(storedPaths: string[]): Promise<LibrarySkill[]> {
  const items: LibrarySkill[] = [];
  const seen = new Set<string>();
  for (const stored of storedPaths) {
    const located = await locateStored(stored);
    const key = pathKey(located.path);
    if (seen.has(key)) continue;
    seen.add(key);
    if (located.markdown === null) {
      items.push({
        id: cursorFileId(located.path),
        source: "import",
        title: located.path,
        description: "",
        path: located.path,
        enabled: false,
      });
      continue;
    }
    const parsed = parseSkillMarkdown(located.markdown, located.path);
    items.push({
      id: cursorFileId(located.path),
      source: "import",
      title: parsed.title,
      description: parsed.description,
      path: located.path,
      enabled: false,
    });
  }
  return items;
}

async function locateStored(stored: string): Promise<{ path: string; markdown: string | null }> {
  let real: string;
  try {
    real = await fs.realpath(stored);
  } catch (error) {
    if (isSoftFsError(error)) return { path: stored, markdown: null };
    throw error;
  }
  try {
    const stat = await fs.stat(real);
    if (!stat.isFile()) return { path: stored, markdown: null };
    const markdown = await fs.readFile(real, "utf8");
    return { path: real, markdown };
  } catch (error) {
    if (isSoftFsError(error)) return { path: real, markdown: null };
    throw error;
  }
}

async function loadMcps(cursorHome: string): Promise<LibraryMcp[]> {
  const cursorFile = await readMcpServers(path.join(cursorHome, "mcp.json"));
  const realPath = cursorFile.realPath;
  if (!realPath) return [];
  return cursorFile.servers.map((server) => toMcp(server, "cursor", cursorMcpId(realPath, server.name)));
}

function toMcp(server: ParsedMcp, source: LibrarySource, id: string): LibraryMcp {
  const transport =
    server.type === "stdio"
      ? { type: "stdio" as const, command: server.command ?? "", args: [...server.args], hasEnv: server.hasEnv }
      : { type: "http" as const, url: server.url ?? "", hasEnv: server.hasEnv };
  return {
    id,
    source,
    name: server.name,
    hasEnv: server.hasEnv,
    transport,
    enabled: false,
  };
}

function mergeByPath<T extends { path: string }>(cursor: T[], imported: T[]): T[] {
  const seen = new Set(cursor.map((item) => pathKey(item.path)));
  const extra: T[] = [];
  for (const item of imported) {
    const key = pathKey(item.path);
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push(item);
  }
  return [...cursor, ...extra];
}

function markEnabled<T extends { id: string }>(items: T[], selected: string[]): Array<T & { enabled: boolean }> {
  const known = new Set(items.map((item) => item.id));
  const enabled = new Set(selected.filter((id) => known.has(id)));
  return items.map((item) => ({ ...item, enabled: enabled.has(item.id) }));
}

function sortByTitle<T extends { title: string; path: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || a.path.localeCompare(b.path),
  );
}

function sortByName(items: LibraryMcp[]): LibraryMcp[] {
  return [...items].sort(
    (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id),
  );
}

function isRuleName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".mdc") || (lower.endsWith(".md") && !lower.endsWith(".mdc"));
}

function pathKey(file: string): string {
  return process.platform === "win32" ? file.toLowerCase() : file;
}
