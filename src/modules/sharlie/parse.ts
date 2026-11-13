/**
 * Responsibility: parse a .sharlie package leniently.
 * Inputs: package text.
 * Outputs: a SharliePackage and warnings, or SharlieFormatError for a hard failure.
 */
import type { PipelineDocument } from "../graph/types";
import { samePath } from "../library/paths";
import { isSafePipelineId, isSafeRelativePath, normalizePipeline } from "../storage/pipelines";
import {
  SHARLIE_FORMAT,
  SHARLIE_FORMAT_VERSION,
  SharlieFormatError,
  type SharlieFile,
  type SharlieItem,
  type SharliePackage,
} from "./format";

export function parseSharliePackage(text: string): { pkg: SharliePackage; warnings: string[] } {
  const warnings: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new SharlieFormatError("This is not a .sharlie file (invalid JSON)");
  }
  if (!isRecord(parsed) || parsed.format !== SHARLIE_FORMAT) {
    throw new SharlieFormatError("This is not a .sharlie file");
  }
  if (typeof parsed.formatVersion !== "number") {
    throw new SharlieFormatError("This .sharlie file has no format version");
  }
  if (parsed.formatVersion > SHARLIE_FORMAT_VERSION) {
    throw new SharlieFormatError(
      "This .sharlie file was made by a newer Sharlie Easy Flow. Update the app to import it.",
    );
  }

  let workflow: PipelineDocument;
  try {
    workflow = normalizePipeline(parsed.workflow, "import-check");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid workflow";
    throw new SharlieFormatError(`The workflow inside this .sharlie file is damaged: ${message}`);
  }
  if (isRecord(parsed.workflow) && typeof parsed.workflow.id === "string" && isSafePipelineId(parsed.workflow.id)) {
    workflow = { ...workflow, id: parsed.workflow.id };
  }

  const items = parseItems(parsed.items, warnings);
  const pkg: SharliePackage = {
    format: SHARLIE_FORMAT,
    formatVersion: SHARLIE_FORMAT_VERSION,
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : "",
    app: parseApp(parsed.app),
    workflow,
    nodeAgents: parseNodeAgents(parsed.nodeAgents, items),
    items,
    mcps: parseMcps(parsed.mcps),
  };
  return { pkg, warnings };
}

function parseItems(value: unknown, warnings: string[]): SharlieItem[] {
  if (!Array.isArray(value)) return [];
  const items: SharlieItem[] = [];
  const usedRefs = new Set<string>();
  let generated = 0;
  for (const entry of value) {
    if (!isRecord(entry) || !isItemKind(entry.kind) || typeof entry.name !== "string" || entry.name.trim() === "") {
      warnings.push("Dropped an unreadable item from the file");
      continue;
    }
    const kind = entry.kind;
    const name = entry.name;
    let ref = typeof entry.ref === "string" && entry.ref !== "" ? entry.ref : "";
    if (ref === "" || usedRefs.has(ref)) {
      do {
        generated += 1;
        ref = `${kind}-x${generated}`;
      } while (usedRefs.has(ref));
    }
    usedRefs.add(ref);
    const description = typeof entry.description === "string" ? entry.description : "";
    const itemEntry = typeof entry.entry === "string" ? entry.entry : "";
    const files = parseFiles(entry.files, kind, name, itemEntry, warnings);
    items.push({ kind, ref, name, description, entry: itemEntry, files });
  }
  return items;
}

function parseFiles(
  value: unknown,
  kind: SharlieItem["kind"],
  name: string,
  entry: string,
  warnings: string[],
): SharlieFile[] | null {
  if (!Array.isArray(value)) return null;
  const files: SharlieFile[] = [];
  for (const file of value) {
    if (
      !isRecord(file) ||
      typeof file.path !== "string" ||
      !isSafeRelativePath(file.path) ||
      (file.encoding !== "utf8" && file.encoding !== "base64") ||
      typeof file.content !== "string"
    ) {
      const shown = isRecord(file) && typeof file.path === "string" ? file.path : "";
      warnings.push(`Dropped unsafe file "${shown}" from ${kind} "${name}"`);
      continue;
    }
    files.push({ path: file.path, encoding: file.encoding, content: file.content });
  }
  if (!files.some((file) => samePath(file.path, entry))) {
    const label = kind === "skill" ? "Skill" : kind === "rule" ? "Rule" : "Agent";
    warnings.push(`${label} "${name}" has no main file and will be treated as missing`);
    return null;
  }
  return files;
}

function parseNodeAgents(value: unknown, items: SharlieItem[]): Record<string, string> {
  if (!isRecord(value)) return {};
  const agentRefs = new Set(items.filter((item) => item.kind === "agent").map((item) => item.ref));
  const nodeAgents: Record<string, string> = {};
  for (const [nodeId, ref] of Object.entries(value)) {
    if (typeof ref === "string" && agentRefs.has(ref)) nodeAgents[nodeId] = ref;
  }
  return nodeAgents;
}

function parseMcps(value: unknown): { name: string }[] {
  if (!Array.isArray(value)) return [];
  const mcps: { name: string }[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.name !== "string" || entry.name.trim() === "") continue;
    mcps.push({ name: entry.name.trim() });
  }
  return mcps;
}

function parseApp(value: unknown): { name: "Sharlie Easy Flow"; version: string } {
  const version = isRecord(value) && typeof value.version === "string" ? value.version : "0.0.0";
  return { name: "Sharlie Easy Flow", version };
}

function isItemKind(value: unknown): value is SharlieItem["kind"] {
  return value === "skill" || value === "rule" || value === "agent";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
