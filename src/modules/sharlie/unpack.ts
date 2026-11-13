/**
 * Responsibility: unpack a .sharlie package into a new workflow folder.
 * Inputs: a parsed package, workspace path, new pipeline id, and library agents.
 * Outputs: the saved pipeline document and warnings. Missing items stay warnings.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentFile } from "../agents/agentFile";
import type { PipelineDocument, WorkflowDependency } from "../graph/types";
import { isSafeRelativePath, workflowDir, writePipeline } from "../storage/pipelines";
import { SharlieFormatError, type SharlieItem, type SharliePackage } from "./format";

export async function importSharliePackage(input: {
  pkg: SharliePackage;
  workspace: string;
  newId: string;
  libraryAgents: AgentFile[];
}): Promise<{ doc: PipelineDocument; warnings: string[] }> {
  const warnings: string[] = [];
  const dir = workflowDir(input.workspace, input.newId);
  try {
    await fs.stat(dir);
    throw new SharlieFormatError("A workflow folder with this id already exists");
  } catch (error) {
    if (error instanceof SharlieFormatError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await fs.mkdir(path.join(dir, ".sharlie", "bundle"), { recursive: true });

  const bundled = new Map<string, string>();
  for (const item of input.pkg.items) {
    if (item.files === null) continue;
    try {
      bundled.set(item.ref, await extractItem(dir, item));
    } catch {
      warnings.push(`Could not unpack ${item.kind} "${item.name}"; it is marked as missing`);
    }
  }

  const doc = structuredClone(input.pkg.workflow);
  doc.id = input.newId;
  for (const node of doc.nodes) {
    if (node.type !== "agent") continue;
    const ref = input.pkg.nodeAgents[node.id];
    const item =
      ref === undefined ? undefined : input.pkg.items.find((entry) => entry.kind === "agent" && entry.ref === ref);
    const bundledPath = item ? bundled.get(item.ref) : undefined;
    if (item && bundledPath) {
      node.data.agentPath = bundledPath;
      node.data.agentName = node.data.agentName || item.name;
      continue;
    }
    if (item) {
      const wanted = item.name.trim().toLowerCase();
      const match = input.libraryAgents.find((agent) => agent.name.trim().toLowerCase() === wanted);
      if (match) {
        node.data.agentPath = match.path;
        warnings.push(`Agent "${item.name}" was not in the file; using your local agent with the same name`);
      } else {
        node.data.agentPath = "";
        node.data.agentName = node.data.agentName || item.name;
        warnings.push(`Agent "${item.name}" is missing. Pick an agent file on the red node.`);
      }
      continue;
    }
    if ((ref === undefined || ref === "") && node.data.agentName.trim() === "") continue;
  }

  const dependencies: WorkflowDependency[] = [];
  for (const item of input.pkg.items) {
    if (item.kind !== "skill" && item.kind !== "rule") continue;
    const dependency: WorkflowDependency = {
      kind: item.kind,
      name: item.name,
      description: item.description,
    };
    const bundledPath = bundled.get(item.ref);
    if (bundledPath) {
      dependency.bundledPath = bundledPath;
    } else {
      const label = item.kind === "skill" ? "Skill" : "Rule";
      warnings.push(
        `${label} "${item.name}" was not in the file. It works only if you have a ${item.kind} with the same name.`,
      );
    }
    dependencies.push(dependency);
  }
  for (const mcp of input.pkg.mcps) {
    dependencies.push({ kind: "mcp", name: mcp.name, description: "" });
    warnings.push(
      `MCP server "${mcp.name}" is used by this workflow. Add it to your ~/.cursor/mcp.json and enable it in Library if you do not have it.`,
    );
  }
  doc.dependencies = dependencies;

  const saved = await writePipeline(input.workspace, doc, input.newId);
  return { doc: saved, warnings };
}

async function extractItem(workflowDirectory: string, item: SharlieItem): Promise<string> {
  const files = item.files;
  if (files === null) throw new Error("nothing to unpack");
  const kind = kindDir(item.kind);
  const kindRoot = path.join(workflowDirectory, ".sharlie", "bundle", kind);
  const { slug, itemDir } = await claimSlug(kindRoot, slugFor(item.name, item.ref));
  for (const file of files) {
    if (!isSafeRelativePath(file.path)) throw new Error("unsafe relative path");
    const target = path.join(itemDir, ...file.path.split("/"));
    const relative = path.relative(itemDir, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("path escapes the item folder");
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (file.encoding === "utf8") {
      await fs.writeFile(target, file.content, { encoding: "utf8", flag: "wx" });
    } else {
      await fs.writeFile(target, Buffer.from(file.content, "base64"), { flag: "wx" });
    }
  }
  const entry = item.entry.replace(/\\/g, "/");
  return `.sharlie/bundle/${kind}/${slug}/${entry}`;
}

function kindDir(kind: SharlieItem["kind"]): "skills" | "rules" | "agents" {
  if (kind === "skill") return "skills";
  if (kind === "rule") return "rules";
  return "agents";
}

function slugFor(name: string, ref: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug === "" ? ref : slug;
}

async function claimSlug(kindRoot: string, base: string): Promise<{ slug: string; itemDir: string }> {
  let slug = base;
  let taken = 1;
  for (;;) {
    assertDirectChild(kindRoot, slug);
    const itemDir = path.join(kindRoot, slug);
    try {
      await fs.stat(itemDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { slug, itemDir };
      throw error;
    }
    taken += 1;
    slug = `${base}-${taken}`;
  }
}

function assertDirectChild(kindRoot: string, slug: string): void {
  if (slug === "" || slug.includes("/") || slug.includes("\\")) throw new Error("unsafe slug");
  const itemDir = path.join(kindRoot, slug);
  const relative = path.relative(kindRoot, itemDir);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative) || relative.includes(path.sep)) {
    throw new Error("unsafe slug");
  }
}
