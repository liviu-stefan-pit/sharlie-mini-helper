/**
 * Responsibility: turn native dialog text into paths and the directory to reopen.
 * Inputs: dialog stdout and the paths the user chose.
 * Outputs: path lines, or the common parent to open next time. No dialog is opened.
 */
import path from "node:path";

export function parseDialogPaths(text: string): string[] {
  const paths: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== "") paths.push(trimmed);
  }
  return paths;
}

/** Parent of one chosen path, or the shared parent when several were chosen. */
export function browseDirectoryFromPicks(picks: string[]): string | null {
  const parents: string[] = [];
  for (const pick of picks) {
    if (typeof pick !== "string") continue;
    const trimmed = pick.trim();
    if (trimmed === "") continue;
    parents.push(path.dirname(path.resolve(trimmed)));
  }
  if (parents.length === 0) return null;
  return commonDirectory(parents);
}

function commonDirectory(dirs: string[]): string {
  const parts = dirs.map(directoryParts);
  const first = parts[0] ?? [];
  let count = 0;
  for (let i = 0; i < first.length; i += 1) {
    const part = first[i] ?? "";
    const same = parts.every((item) => sameSegment(part, item[i]));
    if (!same) break;
    count += 1;
  }
  if (count === 0) return dirs[0] ?? "";
  return joinParts(first.slice(0, count));
}

function directoryParts(dir: string): string[] {
  const resolved = path.resolve(dir);
  const root = path.parse(resolved).root;
  const rest = path.relative(root, resolved);
  if (rest === "") return [root];
  return [root, ...rest.split(path.sep).filter((part) => part !== "")];
}

function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return path.join(...parts);
}

function sameSegment(left: string, right: string | undefined): boolean {
  if (right === undefined) return false;
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
