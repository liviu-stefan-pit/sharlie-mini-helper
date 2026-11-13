/**
 * Responsibility: read one skill or rule markdown file by library id.
 * Inputs: cursor home, app library root, and a cursor: or app: file id.
 * Outputs: utf8 markdown. Refuses mcp.json. Cursor files must sit in the skill or rule roots.
 * Imported ids must match a path recorded in imports.json.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { readImports } from "./imports";
import { isSoftFsError } from "./json";
import { isInside, samePath } from "./paths";
import { LibraryError, type LibraryRoots } from "./types";

const MAX_BYTES = 1_000_000;

export async function readLibraryBody(input: LibraryRoots & { id: string }): Promise<{ id: string; path: string; content: string }> {
  const id = input.id.trim();
  if (id.startsWith("app:mcp:")) throw new LibraryError("Only skill and rule files can be read");
  const located = id.startsWith("cursor:")
    ? await locateCursor(input, id)
    : id.startsWith("app:")
      ? await locateApp(input.appLibraryRoot, id)
      : null;
  if (!located) throw new LibraryError("Invalid id");
  if (path.basename(located).toLowerCase() === "mcp.json") throw new LibraryError("mcp.json cannot be read", 403);

  let stat;
  try {
    stat = await fs.stat(located);
  } catch (error) {
    if (isSoftFsError(error)) throw new LibraryError("File not found", 404);
    throw error;
  }
  if (!stat.isFile()) throw new LibraryError("File not found", 404);
  if (stat.size > MAX_BYTES) throw new LibraryError("File is too large");
  const content = await fs.readFile(located, "utf8");
  return { id, path: located, content };
}

async function locateCursor(input: LibraryRoots, id: string): Promise<string> {
  const requested = id.slice("cursor:".length);
  if (requested === "" || requested.includes("#")) throw new LibraryError("Only skill and rule files can be read");
  const skillsRoot = await tryReal(path.join(input.cursorHome, "skills"));
  const rulesRoot = await tryReal(path.join(input.cursorHome, "rules"));
  let real: string;
  try {
    real = await fs.realpath(requested);
  } catch (error) {
    if (isSoftFsError(error)) throw new LibraryError("File not found", 404);
    throw error;
  }
  if (path.basename(real).toLowerCase() === "mcp.json") throw new LibraryError("mcp.json cannot be read", 403);
  const inSkills = skillsRoot !== null && isInside(skillsRoot, real) && path.basename(real).toLowerCase() === "skill.md";
  const inRules = rulesRoot !== null && isInside(rulesRoot, real) && isRuleFile(real);
  if (inSkills || inRules) return real;
  if (await isImportedFile(input.appLibraryRoot, real)) return real;
  throw new LibraryError("Path is not a library skill or rule", 403);
}

async function isImportedFile(appLibraryRoot: string, real: string): Promise<boolean> {
  const imports = await readImports(appLibraryRoot);
  const skill = await pathListed(imports.skills, real);
  const rule = await pathListed(imports.rules, real);
  if (!skill && !rule) return false;
  const lower = path.basename(real).toLowerCase();
  if (lower === "mcp.json") return false;
  if (skill && lower.endsWith(".md")) return true;
  if (rule && isRuleFile(real)) return true;
  return false;
}

async function pathListed(paths: string[], real: string): Promise<boolean> {
  for (const item of paths) {
    if (samePath(item, real)) return true;
    try {
      const itemReal = await fs.realpath(item);
      if (samePath(itemReal, real)) return true;
    } catch (error) {
      if (isSoftFsError(error)) continue;
      throw error;
    }
  }
  return false;
}

async function locateApp(appLibraryRoot: string, id: string): Promise<string> {
  const rel = id.slice("app:".length);
  if (!isSafeRelative(rel)) throw new LibraryError("Invalid id");
  const rootReal = await tryReal(appLibraryRoot);
  if (!rootReal) throw new LibraryError("File not found", 404);
  const skillsRoot = await tryReal(path.join(rootReal, "skills"));
  const rulesRoot = await tryReal(path.join(rootReal, "rules"));
  return resolveAllowed(path.resolve(rootReal, rel), skillsRoot, rulesRoot);
}

async function resolveAllowed(candidate: string, skillsRoot: string | null, rulesRoot: string | null): Promise<string> {
  let real: string;
  try {
    real = await fs.realpath(candidate);
  } catch (error) {
    if (isSoftFsError(error)) throw new LibraryError("File not found", 404);
    throw error;
  }
  const inSkills = skillsRoot !== null && isInside(skillsRoot, real) && path.basename(real).toLowerCase() === "skill.md";
  const inRules = rulesRoot !== null && isInside(rulesRoot, real) && isRuleFile(real);
  if (!inSkills && !inRules) throw new LibraryError("Path is not a library skill or rule", 403);
  return real;
}

async function tryReal(file: string): Promise<string | null> {
  try {
    return await fs.realpath(file);
  } catch (error) {
    if (isSoftFsError(error)) return null;
    throw error;
  }
}

function isSafeRelative(rel: string): boolean {
  if (rel === "" || path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return false;
  const parts = rel.split(/[/\\]/);
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

function isRuleFile(file: string): boolean {
  const lower = path.basename(file).toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".mdc");
}
