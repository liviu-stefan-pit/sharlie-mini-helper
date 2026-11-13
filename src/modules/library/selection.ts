/**
 * Responsibility: read, write, and filter data/library/selection.json.
 * Inputs: app library root, selection arrays, and a library snapshot.
 * Outputs: { skills, rules, mcps }. Ids missing from a snapshot are dropped by filterSelection.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { isRecord, isSoftFsError } from "./json";
import { LibraryError, type LibrarySnapshot, type Selection } from "./types";

export async function readSelection(appLibraryRoot: string): Promise<Selection> {
  const file = path.join(appLibraryRoot, "selection.json");
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if (isSoftFsError(error)) return emptySelection();
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    throw new LibraryError("selection.json is not valid JSON");
  }
  return normalizeSelection(parsed);
}

export async function writeSelection(appLibraryRoot: string, selection: Selection): Promise<void> {
  const file = path.join(appLibraryRoot, "selection.json");
  await fs.mkdir(appLibraryRoot, { recursive: true });
  const body = normalizeSelection(selection);
  await fs.writeFile(file, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

export function filterSelection(requested: Selection, snapshot: LibrarySnapshot): Selection {
  return {
    skills: pickKnown(requested.skills, snapshot.skills.map((item) => item.id)),
    rules: pickKnown(requested.rules, snapshot.rules.map((item) => item.id)),
    mcps: pickKnown(requested.mcps, snapshot.mcps.map((item) => item.id)),
  };
}

export function emptySelection(): Selection {
  return { skills: [], rules: [], mcps: [] };
}

function normalizeSelection(value: unknown): Selection {
  if (!isRecord(value)) return emptySelection();
  return {
    skills: onlyStrings(value.skills),
    rules: onlyStrings(value.rules),
    mcps: onlyStrings(value.mcps),
  };
}

function onlyStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || out.includes(item)) continue;
    out.push(item);
  }
  return out;
}

function pickKnown(requested: string[] | undefined, known: string[]): string[] {
  const allowed = new Set(known);
  const out: string[] = [];
  for (const id of requested ?? []) {
    if (typeof id !== "string" || !allowed.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}
