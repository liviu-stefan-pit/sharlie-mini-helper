/**
 * Responsibility: library snapshot, selection, import, browse, forget, and body routes.
 * Inputs: /api/library requests and the workspace root.
 * Outputs: library JSON without env or header values. Skill browse returns SKILL.md paths and skips. Rule browse returns rule file paths and skips. Enabled MCP env stays off this route.
 */
import {
  LibraryError,
  defaultCursorHome,
  filterSelection,
  forgetImport,
  importLibraryItem,
  importLibraryItems,
  libraryRoot,
  readLastBrowseDir,
  readLibraryBody,
  realFiles,
  rememberBrowseDirectory,
  scanLibrary,
  skillFilesInFolders,
  writeSelection,
  type LibraryRoots,
  type Selection,
} from "../../src/modules/library";
import { readJson, sendJson } from "../http";
import { openRuleFilesDialog, openSkillFoldersDialog, type NativeDialogPaths } from "../nativeDialog";
import type { RouteContext } from "./context";

export async function handleLibrary(ctx: RouteContext): Promise<boolean> {
  const { url, req, res, appRoot } = ctx;
  const roots = rootsFor(appRoot);

  if (url.pathname === "/api/library") {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    sendJson(res, 200, await scanLibrary(roots));
    return true;
  }

  if (url.pathname === "/api/library/selection") {
    if (req.method !== "PUT") {
      sendJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    const requested = selectionBody(await readJson(req));
    const snapshot = await scanLibrary(roots);
    const next = filterSelection(requested, snapshot);
    await writeSelection(roots.appLibraryRoot, next);
    sendJson(res, 200, next);
    return true;
  }

  if (url.pathname === "/api/library/browse") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    const body = recordBody(await readJson(req));
    const kind = stringField(body.kind, "kind");
    if (kind !== "skill" && kind !== "rule") throw new LibraryError("kind must be skill or rule");
    if (kind === "skill") {
      await browseSkills(res, roots.appLibraryRoot);
      return true;
    }
    await browseRule(res, roots.appLibraryRoot);
    return true;
  }

  if (url.pathname === "/api/library/import") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    const body = recordBody(await readJson(req));
    const kind = stringField(body.kind, "kind");
    if (kind !== "skill" && kind !== "rule") throw new LibraryError("kind must be skill or rule");
    if (Array.isArray(body.paths)) {
      const result = await importLibraryItems({
        appLibraryRoot: roots.appLibraryRoot,
        kind,
        paths: stringArray(body.paths, "paths"),
      });
      sendJson(res, 200, result);
      return true;
    }
    const item = await importLibraryItem({
      appLibraryRoot: roots.appLibraryRoot,
      kind,
      path: stringField(body.path, "path"),
    });
    if (kind === "skill") sendJson(res, 200, { skill: item });
    else sendJson(res, 200, { rule: item });
    return true;
  }

  if (url.pathname === "/api/library/delete") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    const body = recordBody(await readJson(req));
    await forgetImport({ appLibraryRoot: roots.appLibraryRoot, id: stringField(body.id, "id") });
    sendJson(res, 200, { deleted: true });
    return true;
  }

  if (url.pathname === "/api/library/body") {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    const id = url.searchParams.get("id");
    if (id === null || id.trim() === "") throw new LibraryError("id is required");
    sendJson(res, 200, await readLibraryBody({ ...roots, id }));
    return true;
  }

  return false;
}

async function browseSkills(res: RouteContext["res"], appLibraryRoot: string): Promise<void> {
  const initialDirectory = await readLastBrowseDir(appLibraryRoot, "skill");
  let picked: Awaited<ReturnType<typeof openSkillFoldersDialog>>;
  try {
    picked = await openSkillFoldersDialog(initialDirectory ?? undefined);
  } catch {
    sendJson(res, 500, { error: "Could not open the file dialog" });
    return;
  }
  if ("cancelled" in picked) {
    sendJson(res, 200, { cancelled: true });
    return;
  }
  await rememberChosenDirectory(appLibraryRoot, "skill", picked.paths);
  sendJson(res, 200, await skillFilesInFolders(picked.paths));
}

async function browseRule(res: RouteContext["res"], appLibraryRoot: string): Promise<void> {
  const initialDirectory = await readLastBrowseDir(appLibraryRoot, "rule");
  let picked: NativeDialogPaths;
  try {
    picked = await openRuleFilesDialog(initialDirectory ?? undefined);
  } catch {
    sendJson(res, 500, { error: "Could not open the file dialog" });
    return;
  }
  if ("cancelled" in picked) {
    sendJson(res, 200, { cancelled: true });
    return;
  }
  await rememberChosenDirectory(appLibraryRoot, "rule", picked.paths);
  sendJson(res, 200, await realFiles(picked.paths));
}

async function rememberChosenDirectory(
  appLibraryRoot: string,
  kind: "skill" | "rule",
  picks: string[],
): Promise<void> {
  try {
    await rememberBrowseDirectory(appLibraryRoot, kind, picks);
  } catch {
    /* A chosen folder still imports when the last directory cannot be saved. */
  }
}

function rootsFor(appRoot: string): LibraryRoots {
  return {
    cursorHome: defaultCursorHome(),
    appLibraryRoot: libraryRoot(appRoot),
  };
}

function selectionBody(value: unknown): Selection {
  const body = recordBody(value);
  return {
    skills: stringArray(body.skills, "skills"),
    rules: stringArray(body.rules, "rules"),
    mcps: stringArray(body.mcps, "mcps"),
  };
}

function recordBody(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new LibraryError("Invalid body");
  return value;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new LibraryError(`${field} must be an array of strings`);
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") throw new LibraryError(`${field} must be an array of strings`);
    out.push(item);
  }
  return out;
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string") throw new LibraryError(`${field} must be a string`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
