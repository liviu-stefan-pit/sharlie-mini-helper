/**
 * Responsibility: export the current workflow as a .sharlie file.
 * Inputs: POST /api/sharlie/export with an id and includeFiles flag.
 * Outputs: a saved path, byte size, and warnings, or a cancelled flag. No secrets are written.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { defaultCursorHome, libraryRoot, scanLibrary } from "../../src/modules/library";
import { buildSharliePackage } from "../../src/modules/sharlie/pack";
import { LIMITS } from "../../src/modules/sharlie/format";
import { isSafePipelineId, readPipeline, workflowDir } from "../../src/modules/storage/pipelines";
import { readJson, sendJson } from "../http";
import { openNativeDialog } from "../nativeDialog";
import type { RouteContext } from "./context";
import { requireWorkspace } from "./workspace";

export async function handleSharlie(ctx: RouteContext): Promise<boolean> {
  if (ctx.url.pathname !== "/api/sharlie/export") return false;
  if (ctx.req.method !== "POST") {
    sendJson(ctx.res, 405, { error: "Method not allowed" });
    return true;
  }

  const workspace = await requireWorkspace(ctx);
  if (!workspace) return true;

  const body = await readJson(ctx.req);
  if (
    !isRecord(body) ||
    typeof body.id !== "string" ||
    !isSafePipelineId(body.id) ||
    typeof body.includeFiles !== "boolean"
  ) {
    sendJson(ctx.res, 400, { error: "id and includeFiles are required" });
    return true;
  }

  const id = body.id;
  const includeFiles = body.includeFiles;
  const doc = await readPipeline(workspace, id);
  if (!doc) {
    sendJson(ctx.res, 404, { error: "Save the workflow before exporting it" });
    return true;
  }

  const snapshot = await scanLibrary({
    cursorHome: defaultCursorHome(),
    appLibraryRoot: libraryRoot(ctx.appRoot),
  });
  const enabledSkills = snapshot.skills
    .filter((skill) => skill.enabled)
    .map((skill) => ({ title: skill.title, description: skill.description, path: skill.path }));
  const enabledRules = snapshot.rules
    .filter((rule) => rule.enabled)
    .map((rule) => ({ title: rule.title, description: rule.description, path: rule.path }));
  const enabledMcpNames = snapshot.mcps.filter((mcp) => mcp.enabled).map((mcp) => mcp.name);
  const { pkg, warnings } = await buildSharliePackage({
    doc,
    workflowDir: workflowDir(workspace, id),
    enabledSkills,
    enabledRules,
    enabledMcpNames,
    includeFiles,
    appVersion: await readAppVersion(ctx.appRoot),
  });
  const text = `${JSON.stringify(pkg, null, 2)}\n`;
  const bytes = Buffer.byteLength(text);
  if (bytes > LIMITS.maxPackageBytes) {
    sendJson(ctx.res, 413, {
      error: "The workflow package is larger than 20 MB. Export without files or remove large skills.",
    });
    return true;
  }

  let picked;
  try {
    picked = await openNativeDialog("sharlie-save", { defaultFileName: doc.name });
  } catch {
    sendJson(ctx.res, 500, { error: "Could not open the save dialog" });
    return true;
  }
  if ("cancelled" in picked) {
    sendJson(ctx.res, 200, { cancelled: true });
    return true;
  }

  const filePath = picked.path.toLowerCase().endsWith(".sharlie") ? picked.path : `${picked.path}.sharlie`;
  await fs.writeFile(filePath, text, "utf8");
  sendJson(ctx.res, 200, { path: filePath, bytes, warnings });
  return true;
}

async function readAppVersion(appRoot: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(appRoot, "package.json"), "utf8");
    const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/, ""));
    if (isRecord(parsed) && typeof parsed.version === "string") return parsed.version;
  } catch {
    return "0.0.0";
  }
  return "0.0.0";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
