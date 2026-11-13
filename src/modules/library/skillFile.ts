/**
 * Responsibility: resolve the SKILL.md file directly inside a chosen folder.
 * Inputs: a directory path from the native folder dialog.
 * Outputs: the absolute real path of that SKILL.md file. The file is not copied.
 */
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { isSoftFsError } from "./json";
import { LibraryError } from "./types";

export async function skillFileInFolder(dir: string): Promise<string> {
  if (typeof dir !== "string" || dir.trim() === "") throw new LibraryError("Folder not found");
  const folder = await realDirectory(dir.trim());
  const entries = await readEntries(folder);
  const entry = entries.find((item) => item.name.toLowerCase() === "skill.md");
  if (!entry || entry.isDirectory()) throw new LibraryError("That folder has no SKILL.md");
  try {
    return await absoluteRealFile(path.join(folder, entry.name));
  } catch (error) {
    if (error instanceof LibraryError) throw new LibraryError("That folder has no SKILL.md");
    throw error;
  }
}

export async function absoluteRealFile(filePath: string): Promise<string> {
  if (typeof filePath !== "string" || filePath.trim() === "") throw new LibraryError("Path not found");
  const real = await realPath(filePath.trim(), "Path not found");
  const stat = await readStat(real, "Path not found");
  if (!stat.isFile()) throw new LibraryError("Path is not a file");
  return real;
}

async function realDirectory(dir: string): Promise<string> {
  const real = await realPath(dir, "Folder not found");
  const stat = await readStat(real, "Folder not found");
  if (!stat.isDirectory()) throw new LibraryError("Path is not a folder");
  return real;
}

async function readEntries(folder: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(folder, { withFileTypes: true });
  } catch (error) {
    if (isSoftFsError(error)) throw new LibraryError("Folder not found");
    throw error;
  }
}

async function realPath(filePath: string, message: string): Promise<string> {
  try {
    return await fs.realpath(filePath);
  } catch (error) {
    if (isSoftFsError(error)) throw new LibraryError(message);
    throw error;
  }
}

async function readStat(filePath: string, message: string): Promise<Awaited<ReturnType<typeof fs.stat>>> {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (isSoftFsError(error)) throw new LibraryError(message);
    throw error;
  }
}
