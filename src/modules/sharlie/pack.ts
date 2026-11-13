/**
 * Responsibility: bundle files into a .sharlie package.
 * Inputs: a workflow document, workflow folder, enabled skills, rules, and MCP names.
 * Outputs: a SharliePackage and warnings. MCP entries are names only.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describeAgentFile } from "../agents/agentFile";
import type { PipelineDocument } from "../graph/types";
import type { CatalogEntry } from "../library/types";
import { samePath, toPosixRelative } from "../library/paths";
import { LIMITS, SHARLIE_FORMAT, SHARLIE_FORMAT_VERSION, type SharlieFile, type SharlieItem, type SharliePackage } from "./format";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".sharlie"]);

function foldName(name: string): string {
  return process.platform === "win32" ? name.toLowerCase() : name;
}

type NamedFile = { name: string; description: string; path?: string };

export async function readBundleFiles(
  rootDir: string,
  options: { maxFiles: number; maxTotalBytes: number; maxFileBytes: number },
): Promise<{ files: SharlieFile[]; warnings: string[]; truncated: boolean }> {
  const found: { rel: string; full: string; size: number }[] = [];
  const warnings: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      if (current === rootDir) return { files: [], warnings, truncated: false };
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(foldName(entry.name))) continue;
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const foldedName = foldName(entry.name);
      if (foldedName === ".env" || foldedName.startsWith(".env.")) continue;
      const rel = path.relative(rootDir, full).split(path.sep).join("/");
      let size = 0;
      try {
        const stat = await fs.stat(full);
        if (!stat.isFile()) continue;
        size = stat.size;
      } catch {
        continue;
      }
      if (size > options.maxFileBytes) {
        warnings.push(`Skipped ${rel}: larger than 1 MB`);
        continue;
      }
      found.push({ rel, full, size });
    }
  }

  found.sort((left, right) => (left.rel < right.rel ? -1 : left.rel > right.rel ? 1 : 0));
  const files: SharlieFile[] = [];
  let total = 0;
  let truncated = false;
  for (const item of found) {
    if (files.length >= options.maxFiles || total + item.size > options.maxTotalBytes) {
      truncated = true;
      break;
    }
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(item.full);
    } catch {
      continue;
    }
    if (buffer.length > options.maxFileBytes) {
      warnings.push(`Skipped ${item.rel}: larger than 1 MB`);
      continue;
    }
    if (files.length >= options.maxFiles || total + buffer.length > options.maxTotalBytes) {
      truncated = true;
      break;
    }
    files.push(encodeBuffer(buffer, item.rel));
    total += buffer.length;
  }
  return { files, warnings, truncated };
}

export async function buildSharliePackage(input: {
  doc: PipelineDocument;
  workflowDir: string;
  enabledSkills: CatalogEntry[];
  enabledRules: CatalogEntry[];
  enabledMcpNames: string[];
  includeFiles: boolean;
  appVersion: string;
}): Promise<{ pkg: SharliePackage; warnings: string[] }> {
  const warnings: string[] = [];
  const workflow = resetWorkflow(input.doc);
  const { items: agentItems, nodeAgents } = await packAgents(input.doc, input.workflowDir, input.includeFiles, warnings);
  const skills = dedupeByName([
    ...input.enabledSkills.map((skill) => ({ name: skill.title, description: skill.description, path: skill.path })),
    ...skillDependencies(input.doc, input.workflowDir),
  ]);
  const rules = dedupeByName([
    ...input.enabledRules.map((rule) => ({ name: rule.title, description: rule.description, path: rule.path })),
    ...ruleDependencies(input.doc, input.workflowDir),
  ]);
  const skillItems: SharlieItem[] = [];
  for (let index = 0; index < skills.length; index += 1) {
    const skill = skills[index];
    if (!skill) continue;
    skillItems.push(await packSkill(skill, index + 1, input.includeFiles, warnings));
  }
  const ruleItems: SharlieItem[] = [];
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (!rule) continue;
    ruleItems.push(await packRule(rule, index + 1, input.includeFiles, warnings));
  }
  const pkg: SharliePackage = {
    format: SHARLIE_FORMAT,
    formatVersion: SHARLIE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    app: { name: "Sharlie Easy Flow", version: input.appVersion },
    workflow,
    nodeAgents,
    items: [...agentItems, ...skillItems, ...ruleItems],
    mcps: mcpNames(input.enabledMcpNames, input.doc),
  };
  return { pkg, warnings };
}

function resetWorkflow(doc: PipelineDocument): PipelineDocument {
  const workflow = structuredClone(doc);
  delete workflow.dependencies;
  for (const node of workflow.nodes) {
    if (node.type === "agent") {
      node.data.status = "idle";
      node.data.elapsedMs = 0;
      node.data.retryCount = 0;
      node.data.tokens = {};
      node.data.agentPath = "";
      delete node.data.lastOutput;
      continue;
    }
    node.data.status = "idle";
    node.data.artifactPaths = [];
  }
  return workflow;
}

async function packAgents(
  doc: PipelineDocument,
  workflowDir: string,
  includeFiles: boolean,
  warnings: string[],
): Promise<{ items: SharlieItem[]; nodeAgents: Record<string, string> }> {
  const items: SharlieItem[] = [];
  const nodeAgents: Record<string, string> = {};
  const shared: { resolved: string; ref: string }[] = [];
  for (const node of doc.nodes) {
    if (node.type !== "agent" || node.data.agentPath === "") continue;
    const resolved = path.isAbsolute(node.data.agentPath)
      ? node.data.agentPath
      : path.resolve(workflowDir, node.data.agentPath);
    const existing = shared.find((item) => samePath(item.resolved, resolved));
    if (existing) {
      nodeAgents[node.id] = existing.ref;
      continue;
    }
    const ref = `agent-${shared.length + 1}`;
    const stem = fileStem(resolved);
    const name = node.data.agentName || stem;
    let description = "";
    let content: string | null = null;
    try {
      content = await fs.readFile(resolved, "utf8");
      try {
        description = (await describeAgentFile(resolved)).description;
      } catch {
        description = "";
      }
    } catch {
      content = null;
    }
    if (content === null) {
      warnings.push(`Agent "${name}" could not be read and was exported as a name only`);
    }
    const entry = path.basename(resolved);
    items.push({
      kind: "agent",
      ref,
      name,
      description,
      entry,
      files: includeFiles && content !== null ? [{ path: entry, encoding: "utf8", content }] : null,
    });
    shared.push({ resolved, ref });
    nodeAgents[node.id] = ref;
  }
  return { items, nodeAgents };
}

function skillDependencies(doc: PipelineDocument, workflowDir: string): NamedFile[] {
  const entries: NamedFile[] = [];
  for (const dependency of doc.dependencies ?? []) {
    if (dependency.kind !== "skill") continue;
    entries.push({
      name: dependency.name,
      description: dependency.description,
      path: dependency.bundledPath ? path.resolve(workflowDir, dependency.bundledPath) : undefined,
    });
  }
  return entries;
}

function ruleDependencies(doc: PipelineDocument, workflowDir: string): NamedFile[] {
  const entries: NamedFile[] = [];
  for (const dependency of doc.dependencies ?? []) {
    if (dependency.kind !== "rule") continue;
    entries.push({
      name: dependency.name,
      description: dependency.description,
      path: dependency.bundledPath ? path.resolve(workflowDir, dependency.bundledPath) : undefined,
    });
  }
  return entries;
}

function dedupeByName(entries: NamedFile[]): NamedFile[] {
  const seen = new Set<string>();
  const unique: NamedFile[] = [];
  for (const entry of entries) {
    const key = entry.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ name: entry.name.trim(), description: entry.description, path: entry.path });
  }
  return unique;
}

async function packSkill(skill: NamedFile, index: number, includeFiles: boolean, warnings: string[]): Promise<SharlieItem> {
  let entry = "SKILL.md";
  let files: SharlieFile[] | null = null;
  const filePath = skill.path;
  const readable = filePath !== undefined && (await isReadableFile(filePath));
  if (includeFiles && filePath && readable) {
    const rootDir = path.dirname(filePath);
    const relative = toPosixRelative(rootDir, filePath);
    if (relative !== "") entry = relative;
    const bundled = await readBundleFiles(rootDir, {
      maxFiles: LIMITS.maxSkillFiles,
      maxTotalBytes: LIMITS.maxSkillBytes,
      maxFileBytes: LIMITS.maxFileBytes,
    });
    warnings.push(...bundled.warnings);
    if (!bundled.files.some((file) => samePath(file.path, entry))) {
      const main = await readEncodedFile(filePath, entry);
      if (main) {
        files = [main];
        warnings.push(`Skill "${skill.name}" is too large; only its main file was exported`);
      } else {
        warnings.push(`Skill "${skill.name}" could not be read and was exported as a name only`);
      }
    } else {
      files = bundled.files;
      if (bundled.truncated) {
        warnings.push(`Skill "${skill.name}" was cut to the first 100 files / 5 MB`);
      }
    }
  } else if (includeFiles) {
    warnings.push(`Skill "${skill.name}" could not be read and was exported as a name only`);
  }
  return { kind: "skill", ref: `skill-${index}`, name: skill.name, description: skill.description, entry, files };
}

async function packRule(rule: NamedFile, index: number, includeFiles: boolean, warnings: string[]): Promise<SharlieItem> {
  const entry = rule.path ? path.basename(rule.path) : "rule.md";
  let files: SharlieFile[] | null = null;
  if (includeFiles) {
    if (rule.path && (await isReadableFile(rule.path))) {
      const file = await readEncodedFile(rule.path, entry);
      if (file) files = [file];
    }
    if (!files) {
      warnings.push(`Rule "${rule.name}" could not be read and was exported as a name only`);
    }
  }
  return { kind: "rule", ref: `rule-${index}`, name: rule.name, description: rule.description, entry, files };
}

function mcpNames(enabledMcpNames: string[], doc: PipelineDocument): { name: string }[] {
  const seen = new Set<string>();
  const names: string[] = [];
  const add = (name: string) => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(trimmed);
  };
  for (const name of enabledMcpNames) add(name);
  for (const dependency of doc.dependencies ?? []) {
    if (dependency.kind === "mcp") add(dependency.name);
  }
  names.sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
  return names.map((name) => ({ name }));
}

async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function readEncodedFile(filePath: string, entry: string): Promise<SharlieFile | null> {
  try {
    return encodeBuffer(await fs.readFile(filePath), entry);
  } catch {
    return null;
  }
}

function encodeBuffer(buffer: Buffer, relPath: string): SharlieFile {
  const sample = buffer.subarray(0, 8000);
  for (let index = 0; index < sample.length; index += 1) {
    if (sample[index] === 0) {
      return { path: relPath, encoding: "base64", content: buffer.toString("base64") };
    }
  }
  const text = buffer.toString("utf8");
  if (Buffer.from(text, "utf8").equals(buffer)) {
    return { path: relPath, encoding: "utf8", content: text };
  }
  return { path: relPath, encoding: "base64", content: buffer.toString("base64") };
}

function fileStem(filePath: string): string {
  const base = path.basename(filePath);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  return stem || base;
}
