/**
 * Responsibility: connect an existing skill or rule file, and forget that connection.
 * Inputs: app library root, kind, absolute or relative path, and an imported id.
 * Outputs: the imported summary. The file on disk is not copied, edited, or deleted.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parseSkillMarkdown } from "../skills/parseSkill";
import { readImports, writeImports, type LibraryImports } from "./imports";
import { isSoftFsError } from "./json";
import { cursorFileId, samePath } from "./paths";
import { readSelection, writeSelection } from "./selection";
import { LibraryError, type LibraryRule, type LibrarySkill } from "./types";

export async function importLibraryItem(input: {
  appLibraryRoot: string;
  kind: string;
  path: string;
}): Promise<LibrarySkill | LibraryRule> {
  const kind = input.kind;
  if (kind !== "skill" && kind !== "rule") throw new LibraryError("kind must be skill or rule");
  const requested = requirePath(input.path);
  assertExtension(kind, requested);
  const real = await resolveFile(requested);
  assertExtension(kind, real);
  let markdown: string;
  try {
    markdown = await fs.readFile(real, "utf8");
  } catch (error) {
    if (isSoftFsError(error)) throw new LibraryError("Path cannot be read");
    throw error;
  }
  const parsed = parseSkillMarkdown(markdown, real);
  const imports = await readImports(input.appLibraryRoot);
  const key = kind === "skill" ? "skills" : "rules";
  imports[key] = upsertPath(imports[key], real);
  await writeImports(input.appLibraryRoot, imports);
  const id = cursorFileId(real);
  await remember(input.appLibraryRoot, key, id);
  return {
    id,
    source: "import",
    title: parsed.title,
    description: parsed.description,
    path: real,
    enabled: true,
  };
}

export async function forgetImport(input: { appLibraryRoot: string; id: string }): Promise<void> {
  const id = requireText(input.id, "id");
  if (id.trim() === "") throw new LibraryError("id is required");
  const imports = await readImports(input.appLibraryRoot);
  const skills = dropImported(imports.skills, id);
  const rules = dropImported(imports.rules, id);
  if (!skills.removed && !rules.removed) throw new LibraryError("Only imported items can be removed");
  const next: LibraryImports = { skills: skills.paths, rules: rules.paths };
  await writeImports(input.appLibraryRoot, next);
  const selection = await readSelection(input.appLibraryRoot);
  selection.skills = selection.skills.filter((item) => !samePath(item, id));
  selection.rules = selection.rules.filter((item) => !samePath(item, id));
  selection.mcps = selection.mcps.filter((item) => !samePath(item, id));
  await writeSelection(input.appLibraryRoot, selection);
}

async function remember(appLibraryRoot: string, kind: "skills" | "rules", id: string): Promise<void> {
  const selection = await readSelection(appLibraryRoot);
  if (!selection[kind].some((item) => samePath(item, id))) selection[kind].push(id);
  await writeSelection(appLibraryRoot, selection);
}

async function resolveFile(filePath: string): Promise<string> {
  let real: string;
  try {
    real = await fs.realpath(filePath);
  } catch (error) {
    if (isSoftFsError(error)) throw new LibraryError("Path not found");
    throw error;
  }
  let stat;
  try {
    stat = await fs.stat(real);
  } catch (error) {
    if (isSoftFsError(error)) throw new LibraryError("Path not found");
    throw error;
  }
  if (stat.isDirectory()) throw new LibraryError("Path is a directory");
  if (!stat.isFile()) throw new LibraryError("Path is not a file");
  return real;
}

function upsertPath(paths: string[], real: string): string[] {
  const next = paths.filter((item) => !samePath(item, real));
  next.push(real);
  return next;
}

function dropImported(paths: string[], id: string): { paths: string[]; removed: boolean } {
  let removed = false;
  const next = paths.filter((item) => {
    if (!samePath(cursorFileId(item), id)) return true;
    removed = true;
    return false;
  });
  return { paths: next, removed };
}

function requirePath(value: string): string {
  const requested = requireText(value, "path").trim();
  if (requested === "") throw new LibraryError("path is required");
  return requested;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string") throw new LibraryError(`${field} must be a string`);
  return value;
}

function assertExtension(kind: "skill" | "rule", filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  if (kind === "skill") {
    if (ext !== ".md") throw new LibraryError("Skill path must be a .md file");
    return;
  }
  if (ext !== ".md" && ext !== ".mdc") throw new LibraryError("Rule path must be a .md or .mdc file");
}
