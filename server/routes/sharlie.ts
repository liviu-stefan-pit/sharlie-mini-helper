/**
 * Responsibility: export and import a workflow as a .sharlie file, and report workflow health.
 * Inputs: POST /api/sharlie/export, POST /api/sharlie/import, or POST /api/workflow/health with a pipeline body.
 * Outputs: a saved path, an imported id plus warnings, a cancelled flag, or workflow health. No secrets are written.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { scanAgents } from "../../src/modules/agents/agentFile";
import { GraphError } from "../../src/modules/graph/resolve";
import { defaultCursorHome, libraryRoot, scanLibrary } from "../../src/modules/library";
import { SharlieFormatError, LIMITS } from "../../src/modules/sharlie/format";
import { buildSharliePackage } from "../../src/modules/sharlie/pack";
import { parseSharliePackage } from "../../src/modules/sharlie/parse";
import { importSharliePackage } from "../../src/modules/sharlie/unpack";
import { isSafePipelineId, newPipelineId, readPipeline, workflowDir } from "../../src/modules/storage/pipelines";
import { checkWorkflowHealth } from "../../src/modules/workflow/health";
import { readJson, sendJson } from "../http";
import { openNativeDialog } from "../nativeDialog";
import { coercePipeline } from "./coerce";
import type { RouteContext } from "./context";
import { requireWorkspace } from "./workspace";

export async function handleSharlie(ctx: RouteContext): Promise<boolean> {
  if (ctx.url.pathname === "/api/workflow/health") return handleHealth(ctx);
  if (ctx.url.pathname === "/api/sharlie/export") return handleExport(ctx);
  if (ctx.url.pathname === "/api/sharlie/import") return handleImport(ctx);
  return false;
}

async function handleHealth(ctx: RouteContext): Promise<boolean> {
  if (ctx.req.method !== "POST") {
    sendJson(ctx.res, 405, { error: "Method not allowed" });
    return true;
  }
  const workspace = await requireWorkspace(ctx);
  if (!workspace) return true;
  let doc;
  try {
    doc = coercePipeline(await readJson(ctx.req));
  } catch (error) {
    if (error instanceof GraphError) {
      sendJson(ctx.res, 400, { error: error.message });
      return true;
    }
    throw error;
  }
  const dir = isSafePipelineId(doc.id) ? workflowDir(workspace, doc.id) : path.join(workspace, "__unsaved__");
  const library = await scanLibrary({
    cursorHome: defaultCursorHome(),
    appLibraryRoot: libraryRoot(ctx.appRoot),
  });
  const health = await checkWorkflowHealth({ doc, workflowDir: dir, library });
  sendJson(ctx.res, 200, health);
  return true;
}

async function handleExport(ctx: RouteContext): Promise<boolean> {
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

async function handleImport(ctx: RouteContext): Promise<boolean> {
  if (ctx.req.method !== "POST") {
    sendJson(ctx.res, 405, { error: "Method not allowed" });
    return true;
  }

  const workspace = await requireWorkspace(ctx);
  if (!workspace) return true;

  let picked;
  try {
    picked = await openNativeDialog("sharlie-open");
  } catch {
    sendJson(ctx.res, 500, { error: "Could not open the file dialog" });
    return true;
  }
  if ("cancelled" in picked) {
    sendJson(ctx.res, 200, { cancelled: true });
    return true;
  }

  const stat = await fs.stat(picked.path);
  if (stat.size > LIMITS.maxPackageBytes) {
    sendJson(ctx.res, 413, { error: "This .sharlie file is larger than 20 MB" });
    return true;
  }

  const text = await fs.readFile(picked.path, "utf8");
  let parsed: ReturnType<typeof parseSharliePackage>;
  try {
    parsed = parseSharliePackage(text);
  } catch (error) {
    if (error instanceof SharlieFormatError) {
      sendJson(ctx.res, 400, { error: error.message });
      return true;
    }
    throw error;
  }

  const newId = newPipelineId(parsed.pkg.workflow.name);
  const libraryAgents = await scanAgents(defaultCursorHome());
  const dir = workflowDir(workspace, newId);
  try {
    const imported = await importSharliePackage({
      pkg: parsed.pkg,
      workspace,
      newId,
      libraryAgents,
    });
    sendJson(ctx.res, 200, {
      id: imported.doc.id,
      name: imported.doc.name,
      warnings: [...parsed.warnings, ...imported.warnings],
    });
    return true;
  } catch (error) {
    const alreadyThere =
      error instanceof SharlieFormatError && error.message === "A workflow folder with this id already exists";
    if (!alreadyThere) await fs.rm(dir, { recursive: true, force: true });
    if (error instanceof SharlieFormatError) {
      sendJson(ctx.res, 400, { error: error.message });
      return true;
    }
    throw error;
  }
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
