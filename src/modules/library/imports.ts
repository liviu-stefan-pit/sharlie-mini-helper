/**
 * Responsibility: read and write data/library/imports.json.
 * Inputs: app library root and absolute skill or rule paths.
 * Outputs: { skills, rules }. File bodies are not stored.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { isRecord, isSoftFsError } from "./json";
import { samePath } from "./paths";
import { LibraryError } from "./types";

export type LibraryImports = {
  skills: string[];
  rules: string[];
};

export async function readImports(appLibraryRoot: string): Promise<LibraryImports> {
  const file = path.join(appLibraryRoot, "imports.json");
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if (isSoftFsError(error)) return emptyImports();
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    throw new LibraryError("imports.json is not valid JSON");
  }
  return normalizeImports(parsed);
}

export async function writeImports(appLibraryRoot: string, imports: LibraryImports): Promise<void> {
  const file = path.join(appLibraryRoot, "imports.json");
  await fs.mkdir(appLibraryRoot, { recursive: true });
  const body = normalizeImports(imports);
  await fs.writeFile(file, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

export function emptyImports(): LibraryImports {
  return { skills: [], rules: [] };
}

function normalizeImports(value: unknown): LibraryImports {
  if (!isRecord(value)) return emptyImports();
  return {
    skills: onlyPaths(value.skills),
    rules: onlyPaths(value.rules),
  };
}

function onlyPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") continue;
    if (out.some((existing) => samePath(existing, item))) continue;
    out.push(item);
  }
  return out;
}
