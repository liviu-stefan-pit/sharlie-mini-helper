/**
 * Responsibility: notice files a local agent created or updated.
 * Inputs: a working directory, and two mtime snapshots from that directory.
 * Outputs: relative posix paths mapped to mtime, and artifact hits for changes.
 * The .sharlie meta folder is skipped.
 */
import fs from "node:fs/promises";
import path from "node:path";

export type ArtifactHit = { path: string; agentNodeId: string };

const SKIP_SEGMENTS = new Set(["node_modules", "dist", ".git", ".sharlie"]);
const FILE_CAP = 8000;

export async function snapshotFiles(cwd: string): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  await walk(cwd, "", found);
  return found;
}

export function diffSnapshots(
  before: Map<string, number>,
  after: Map<string, number>,
  agentNodeId: string,
): ArtifactHit[] {
  const hits: ArtifactHit[] = [];
  for (const [filePath, mtime] of after) {
    const previous = before.get(filePath);
    if (previous === undefined || previous !== mtime) {
      hits.push({ path: filePath, agentNodeId });
    }
  }
  hits.sort((a, b) => byPath(a.path, b.path));
  return hits;
}

async function walk(root: string, relativeDir: string, found: Map<string, number>): Promise<void> {
  if (found.size >= FILE_CAP) return;
  const dir = relativeDir ? path.join(root, ...relativeDir.split("/")) : root;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (found.size >= FILE_CAP) return;
    const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (relative.split("/").some((segment) => SKIP_SEGMENTS.has(segment))) continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await walk(root, relative, found);
      continue;
    }
    if (!entry.isFile()) continue;
    if (isEnvFile(entry.name)) continue;
    try {
      const stat = await fs.stat(path.join(dir, entry.name));
      found.set(relative, stat.mtimeMs);
    } catch {
      continue;
    }
  }
}

function isEnvFile(name: string): boolean {
  return name === ".env" || name.startsWith(".env.");
}

function byPath(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
