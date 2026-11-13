/**
 * Responsibility: library snapshot, selection, import, browse, forget, and body routes.
 * Inputs: /api/library requests and the workspace root.
 * Outputs: library JSON without env or header values. Browse returns a real path or cancelled. Enabled MCP env stays off this route.
 */
import {
  LibraryError,
  absoluteRealFile,
  defaultCursorHome,
  filterSelection,
  forgetImport,
  importLibraryItem,
  libraryRoot,
  readLibraryBody,
  scanLibrary,
  skillFileInFolder,
  writeSelection,
  type LibraryRoots,
  type Selection,
} from "../../src/modules/library";
import { readJson, sendJson } from "../http";
import { openNativeDialog, type NativeDialogPick } from "../nativeDialog";
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
    let picked: NativeDialogPick;
    try {
      picked = await openNativeDialog(kind);
    } catch {
      sendJson(res, 500, { error: "Could not open the file dialog" });
      return true;
    }
    if ("cancelled" in picked) {
      sendJson(res, 200, { cancelled: true });
      return true;
    }
    const chosen = kind === "skill" ? await skillFileInFolder(picked.path) : await absoluteRealFile(picked.path);
    sendJson(res, 200, { path: chosen });
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
