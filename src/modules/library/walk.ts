/**
 * Responsibility: list matching files under one directory, without leaving it.
 * Inputs: directory path and a file-name predicate.
 * Outputs: real paths inside that directory. A missing directory yields an empty list.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { isSoftFsError } from "./json";
import { isInside, samePath } from "./paths";

export async function walkFiles(dir: string, accept: (name: string) => boolean): Promise<string[]> {
  let rootReal: string;
  try {
    rootReal = await fs.realpath(dir);
  } catch (error) {
    if (isSoftFsError(error)) return [];
    throw error;
  }
  const files: string[] = [];
  await walk(dir, rootReal, accept, files, new Set());
  return files;
}

async function walk(
  dir: string,
  rootReal: string,
  accept: (name: string) => boolean,
  files: string[],
  seenDirs: Set<string>,
): Promise<void> {
  let realDir: string;
  try {
    realDir = await fs.realpath(dir);
  } catch (error) {
    if (isSoftFsError(error)) return;
    throw error;
  }
  if (!samePath(realDir, rootReal) && !isInside(rootReal, realDir)) return;
  const dirKey = pathKey(realDir);
  if (seenDirs.has(dirKey)) return;
  seenDirs.add(dirKey);

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isSoftFsError(error)) return;
    throw error;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch (error) {
      if (isSoftFsError(error)) continue;
      throw error;
    }
    if (stat.isDirectory()) {
      await walk(full, rootReal, accept, files, seenDirs);
      continue;
    }
    if (!stat.isFile() || !accept(entry.name)) continue;
    let real: string;
    try {
      real = await fs.realpath(full);
    } catch (error) {
      if (isSoftFsError(error)) continue;
      throw error;
    }
    if (isInside(rootReal, real)) files.push(real);
  }
}

function pathKey(file: string): string {
  return process.platform === "win32" ? file.toLowerCase() : file;
}
