/**
 * Responsibility: list agent markdown files, resolve an agent path, and read one file's instruction.
 * Inputs: a cursor home directory, a workflow folder plus an agent path, or a path to a markdown file.
 * Outputs: agent name, description, and path, a resolved path, or the trimmed markdown body.
 * Scan reads only the top level of <root>/agents. It does not copy files.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parseSkillMarkdown } from "../skills/parseSkill";

export type AgentFile = {
  name: string;
  description: string;
  path: string;
};

export class AgentFileError extends Error {
  constructor(message = "Agent file must be an existing .md file") {
    super(message);
    this.name = "AgentFileError";
  }
}

export async function scanAgents(root: string): Promise<AgentFile[]> {
  const dir = path.join(root, "agents");
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if (isSoft(error)) return [];
    throw error;
  }

  const agents: AgentFile[] = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".md")) continue;
    const full = path.join(dir, name);
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile()) continue;
      const real = await fs.realpath(full);
      const markdown = await fs.readFile(real, "utf8");
      agents.push(summarizeAgent(markdown, real));
    } catch {
      continue;
    }
  }

  agents.sort(
    (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.path.localeCompare(b.path),
  );
  return agents;
}

/** "" stays "". Absolute stays as is. Relative is resolved against the workflow folder. */
export function resolveAgentPath(workflowDir: string, agentPath: string): string {
  if (agentPath === "") return "";
  if (path.isAbsolute(agentPath)) return agentPath;
  return path.resolve(workflowDir, agentPath);
}

export function agentBody(markdown: string): string {
  const text = markdown.replace(/^\uFEFF/, "");
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  const body = match ? text.slice(match[0].length) : text;
  return body.trim();
}

export async function readAgentInstruction(
  agentPath: string,
): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  if (agentPath.trim() === "") return { ok: false, message: "Agent file is missing" };
  try {
    const file = await requireMarkdownFile(agentPath);
    const markdown = await fs.readFile(file, "utf8");
    return { ok: true, text: agentBody(markdown) };
  } catch (error) {
    if (error instanceof AgentFileError) return { ok: false, message: error.message };
    return { ok: false, message: "Could not read the agent file" };
  }
}

export async function describeAgentFile(filePath: string): Promise<AgentFile> {
  const file = await requireMarkdownFile(filePath);
  const markdown = await fs.readFile(file, "utf8");
  return summarizeAgent(markdown, file);
}

async function requireMarkdownFile(filePath: string): Promise<string> {
  if (path.extname(filePath).toLowerCase() !== ".md") {
    throw new AgentFileError();
  }
  let real: string;
  try {
    real = await fs.realpath(filePath);
  } catch {
    throw new AgentFileError();
  }
  let stat;
  try {
    stat = await fs.stat(real);
  } catch {
    throw new AgentFileError();
  }
  if (!stat.isFile() || path.extname(real).toLowerCase() !== ".md") {
    throw new AgentFileError();
  }
  return real;
}

function summarizeAgent(markdown: string, filePath: string): AgentFile {
  const parsed = parseSkillMarkdown(markdown, filePath);
  const fileName = path.basename(filePath);
  const stem = path.basename(filePath, path.extname(filePath)) || fileName;
  const name = parsed.title.trim() === fileName ? stem : parsed.title.trim() || stem;
  return {
    name,
    description: parsed.description,
    path: filePath,
  };
}

function isSoft(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "EACCES" || code === "EPERM" || code === "ENOTDIR";
}
