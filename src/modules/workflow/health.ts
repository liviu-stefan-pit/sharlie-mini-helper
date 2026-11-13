/**
 * Responsibility: check whether a workflow's agents and dependencies exist on this machine.
 * Inputs: a pipeline document, its workflow folder, and a library snapshot.
 * Outputs: per-agent health, dependency health, a problem count, and catalog entries for resolved skills and rules.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { resolveAgentPath } from "../agents/agentFile";
import type { PipelineDocument, WorkflowDependency } from "../graph/types";
import type { CatalogEntry, LibraryRule, LibrarySkill, LibrarySnapshot } from "../library/types";

export type AgentHealth =
  | { status: "ok" }
  | { status: "unset" }
  | { status: "missing"; message: string };

export type DependencyHealth = {
  kind: "skill" | "rule" | "mcp";
  name: string;
  /** Copied from the WorkflowDependency. May be "". */
  description: string;
  status: "bundled" | "library" | "disabled" | "missing";
  /** Absolute path for bundled/library skills and rules. */
  path?: string;
  message: string;
};

export type WorkflowHealth = {
  agents: Record<string, AgentHealth>;
  dependencies: DependencyHealth[];
  problemCount: number;
};

export async function checkWorkflowHealth(input: {
  doc: PipelineDocument;
  workflowDir: string;
  library: LibrarySnapshot;
}): Promise<WorkflowHealth> {
  const agents: Record<string, AgentHealth> = {};
  for (const node of input.doc.nodes) {
    if (node.type !== "agent") continue;
    agents[node.id] = await checkAgent(input.workflowDir, node.data.agentPath, node.data.agentName);
  }
  const dependencies: DependencyHealth[] = [];
  for (const dependency of input.doc.dependencies ?? []) {
    dependencies.push(await checkDependency(input.workflowDir, dependency, input.library));
  }
  let problemCount = 0;
  for (const agent of Object.values(agents)) {
    if (agent.status === "missing") problemCount += 1;
  }
  for (const dependency of dependencies) {
    if (dependency.status === "missing" || dependency.status === "disabled") problemCount += 1;
  }
  return { agents, dependencies, problemCount };
}

/** Skills and rules that resolved, as catalog entries for the run. */
export function healthCatalogEntries(health: WorkflowHealth): { skills: CatalogEntry[]; rules: CatalogEntry[] } {
  const skills: CatalogEntry[] = [];
  const rules: CatalogEntry[] = [];
  for (const item of health.dependencies) {
    if (item.status !== "bundled" && item.status !== "library") continue;
    if ((item.kind !== "skill" && item.kind !== "rule") || !item.path) continue;
    const entry: CatalogEntry = { title: item.name, description: item.description, path: item.path };
    if (item.kind === "skill") skills.push(entry);
    else rules.push(entry);
  }
  return { skills, rules };
}

async function checkAgent(workflowDir: string, agentPath: string, agentName: string): Promise<AgentHealth> {
  if (agentPath === "" && agentName === "") return { status: "unset" };
  if (agentPath === "") {
    return {
      status: "missing",
      message: `Agent "${agentName}" is not on this machine. Use Browse or pick another agent.`,
    };
  }
  const file = resolveAgentPath(workflowDir, agentPath);
  if (await isMarkdownFile(file)) return { status: "ok" };
  return {
    status: "missing",
    message: `Agent file not found: ${file}. Use Browse or pick another agent.`,
  };
}

async function checkDependency(
  workflowDir: string,
  dependency: WorkflowDependency,
  library: LibrarySnapshot,
): Promise<DependencyHealth> {
  if (dependency.kind === "mcp") return checkMcp(dependency, library);
  return checkFileDependency(workflowDir, dependency, library);
}

async function checkFileDependency(
  workflowDir: string,
  dependency: WorkflowDependency,
  library: LibrarySnapshot,
): Promise<DependencyHealth> {
  const listed = dependency.kind === "skill" ? library.skills : library.rules;
  if (dependency.bundledPath) {
    const absolute = path.resolve(workflowDir, dependency.bundledPath);
    if (await isFile(absolute)) {
      return {
        kind: dependency.kind,
        name: dependency.name,
        description: dependency.description,
        status: "bundled",
        path: absolute,
        message: "Bundled with this workflow",
      };
    }
  }
  const match = listed.find((item) => titlesMatch(item.title, dependency.name));
  if (match) {
    return {
      kind: dependency.kind,
      name: dependency.name,
      description: libraryDescription(dependency.description, match),
      status: "library",
      path: match.path,
      message: `Found in your library: ${match.path}`,
    };
  }
  const message =
    dependency.kind === "skill"
      ? `Skill "${dependency.name}" is missing. Add it to ~/.cursor/skills or import it in Library.`
      : `Rule "${dependency.name}" is missing. Add it to ~/.cursor/rules or import it in Library.`;
  return {
    kind: dependency.kind,
    name: dependency.name,
    description: dependency.description,
    status: "missing",
    message,
  };
}

function checkMcp(dependency: WorkflowDependency, library: LibrarySnapshot): DependencyHealth {
  const name = dependency.name.toLowerCase();
  const matches = library.mcps.filter((mcp) => mcp.name.toLowerCase() === name);
  if (matches.some((mcp) => mcp.enabled)) {
    return {
      kind: "mcp",
      name: dependency.name,
      description: dependency.description,
      status: "library",
      message: "Enabled in your library",
    };
  }
  if (matches.length > 0) {
    return {
      kind: "mcp",
      name: dependency.name,
      description: dependency.description,
      status: "disabled",
      message: `MCP server "${dependency.name}" exists but is turned off. Enable it in Library.`,
    };
  }
  return {
    kind: "mcp",
    name: dependency.name,
    description: dependency.description,
    status: "missing",
    message: `MCP server "${dependency.name}" is not in ~/.cursor/mcp.json. Add it there, then enable it in Library.`,
  };
}

/** An empty workflow description is filled from the library so the run catalog can name the file. */
function libraryDescription(description: string, match: LibrarySkill | LibraryRule): string {
  return description === "" ? match.description : description;
}

function titlesMatch(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

async function isMarkdownFile(file: string): Promise<boolean> {
  if (path.extname(file).toLowerCase() !== ".md") return false;
  return isFile(file);
}

async function isFile(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}
