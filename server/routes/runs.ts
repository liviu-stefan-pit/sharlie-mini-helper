/**
 * Responsibility: start pipeline runs and stream their events.
 * Inputs: POST /api/runs, POST /api/runs/:id/decision, GET /api/runs/:id/events, GET /api/models.
 * Outputs: a run id and warnings, a decision acknowledgement, a server-sent event stream, and the model list.
 */
import fs from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { listModels } from "../../src/modules/cursor/adapter";
import { GraphError, resolvePipeline } from "../../src/modules/graph/resolve";
import type { PipelineNode } from "../../src/modules/graph/types";
import {
  buildCatalogPrompt,
  defaultCursorHome,
  libraryRoot,
  loadEnabledMcpConfigs,
  scanLibrary,
  type CatalogEntry,
} from "../../src/modules/library";
import { samePath } from "../../src/modules/library/paths";
import { decideRun, runExists, startRun, subscribeRun, type RunStreamEvent } from "../../src/modules/runs/engine";
import { isSafePipelineId, workflowDir } from "../../src/modules/storage/pipelines";
import { checkWorkflowHealth, healthCatalogEntries } from "../../src/modules/workflow/health";
import { readJson, sendJson } from "../http";
import { loadEnv } from "../loadEnv";
import { coercePipeline, isRecord } from "./coerce";
import type { RouteContext } from "./context";
import { requireWorkspace } from "./workspace";

const TERMINAL = new Set(["paused", "done", "error", "stopped"]);

export async function handleModels(ctx: RouteContext): Promise<boolean> {
  if (ctx.url.pathname !== "/api/models") return false;
  if (ctx.req.method !== "GET") {
    sendJson(ctx.res, 405, { error: "Method not allowed" });
    return true;
  }
  loadEnv();
  const apiKey = process.env.CURSOR_API_KEY?.trim() ?? "";
  if (!apiKey) {
    sendJson(ctx.res, 200, { configured: false, models: [] });
    return true;
  }
  try {
    const models = await listModels(apiKey);
    sendJson(ctx.res, 200, { configured: true, models });
  } catch (error) {
    sendJson(ctx.res, 200, { configured: true, models: [], error: shortModelError(error, apiKey) });
  }
  return true;
}

export async function handleRuns(ctx: RouteContext): Promise<boolean> {
  if (ctx.url.pathname === "/api/runs") {
    if (ctx.req.method !== "POST") {
      sendJson(ctx.res, 405, { error: "Method not allowed" });
      return true;
    }
    const workspace = await requireWorkspace(ctx);
    if (!workspace) return true;
    try {
      const doc = coercePipeline(await readJson(ctx.req));
      if (!isSafePipelineId(doc.id)) {
        sendJson(ctx.res, 400, { error: "Save the workflow before running it" });
        return true;
      }
      const steps = resolvePipeline(doc);
      loadEnv();
      const apiKey = process.env.CURSOR_API_KEY?.trim() ?? "";
      if (!apiKey) {
        sendJson(ctx.res, 400, { error: "CURSOR_API_KEY is not configured" });
        return true;
      }
      const library = await loadEnabledLibrary(ctx.appRoot);
      const cwd = workflowDir(workspace, doc.id);
      const health = await checkWorkflowHealth({ doc, workflowDir: cwd, library: library.snapshot });
      const missingAgents = doc.nodes
        .filter((node): node is Extract<PipelineNode, { type: "agent" }> => node.type === "agent")
        .filter((node) => health.agents[node.id]?.status === "missing")
        .map((node) => node.data.agentName || node.id);
      if (missingAgents.length > 0) {
        sendJson(ctx.res, 400, { error: `Fix the red agent nodes before running: ${missingAgents.join(", ")}` });
        return true;
      }
      const extra = healthCatalogEntries(health);
      const catalog = buildCatalogPrompt(
        mergeEntries(enabledEntries(library.snapshot.skills), extra.skills),
        mergeEntries(enabledEntries(library.snapshot.rules), extra.rules),
      );
      const warnings = health.dependencies
        .filter((item) => item.status === "missing" || item.status === "disabled")
        .map((item) => `${kindLabel(item.kind)} "${item.name}"`);
      await fs.mkdir(cwd, { recursive: true });
      const id = startRun({
        steps,
        apiKey,
        cwd,
        artifactPrefix: doc.id,
        catalog,
        mcpServers: library.mcpServers,
      });
      sendJson(ctx.res, 201, { id, warnings });
    } catch (error) {
      if (error instanceof GraphError) {
        sendJson(ctx.res, 400, { error: error.message });
        return true;
      }
      throw error;
    }
    return true;
  }

  const decisionMatch = ctx.url.pathname.match(/^\/api\/runs\/([^/]+)\/decision$/);
  if (decisionMatch) {
    if (ctx.req.method !== "POST") {
      sendJson(ctx.res, 405, { error: "Method not allowed" });
      return true;
    }
    const id = decodeURIComponent(decisionMatch[1] ?? "");
    if (!runExists(id)) {
      sendJson(ctx.res, 404, { error: "Run not found" });
      return true;
    }
    const body = await readJson(ctx.req);
    if (!isRecord(body)) {
      sendJson(ctx.res, 400, { error: "Decision body must be an object" });
      return true;
    }
    const decision = body.decision;
    if (decision !== "approve" && decision !== "redo" && decision !== "decline") {
      sendJson(ctx.res, 400, { error: "decision must be approve, redo, or decline" });
      return true;
    }
    const result = decideRun(id, decision);
    if (!result.ok) {
      sendJson(ctx.res, 400, { error: result.error });
      return true;
    }
    sendJson(ctx.res, 202, { ok: true });
    return true;
  }

  const match = ctx.url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
  if (!match) return false;
  if (ctx.req.method !== "GET") {
    sendJson(ctx.res, 405, { error: "Method not allowed" });
    return true;
  }
  const id = decodeURIComponent(match[1] ?? "");
  streamRun(ctx, id);
  return true;
}

async function loadEnabledLibrary(appRoot: string): Promise<{
  snapshot: Awaited<ReturnType<typeof scanLibrary>>;
  mcpServers: Awaited<ReturnType<typeof loadEnabledMcpConfigs>>;
}> {
  const roots = {
    cursorHome: defaultCursorHome(),
    appLibraryRoot: libraryRoot(appRoot),
  };
  const [snapshot, mcpServers] = await Promise.all([scanLibrary(roots), loadEnabledMcpConfigs(roots)]);
  return { snapshot, mcpServers };
}

function enabledEntries(items: readonly { title: string; description: string; path: string; enabled: boolean }[]): CatalogEntry[] {
  return items.filter((item) => item.enabled).map((item) => ({ title: item.title, description: item.description, path: item.path }));
}

function mergeEntries(primary: readonly CatalogEntry[], extra: readonly CatalogEntry[]): CatalogEntry[] {
  const merged: CatalogEntry[] = [];
  for (const entry of [...primary, ...extra]) {
    if (merged.some((kept) => samePath(kept.path, entry.path))) continue;
    merged.push(entry);
  }
  return merged;
}

function kindLabel(kind: "skill" | "rule" | "mcp"): string {
  if (kind === "skill") return "Skill";
  if (kind === "rule") return "Rule";
  return "MCP server";
}

function streamRun(ctx: RouteContext, id: string): void {
  let closed = false;
  let ready = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let unsubscribe = () => {};
  const queued: RunStreamEvent[] = [];

  function finish() {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    unsubscribe();
    if (!ctx.res.writableEnded) ctx.res.end();
  }

  function writeLive(event: RunStreamEvent) {
    if (closed) return;
    writeEvent(ctx.res, event);
    if (TERMINAL.has(event.event)) finish();
  }

  const subscription = subscribeRun(id, (event) => {
    if (closed) return;
    if (!ready) {
      queued.push(event);
      return;
    }
    writeLive(event);
  });
  if (!subscription) {
    sendJson(ctx.res, 404, { error: "Run not found" });
    return;
  }
  unsubscribe = subscription.unsubscribe;

  ctx.res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  for (const event of subscription.events) writeEvent(ctx.res, event);
  ready = true;
  for (const event of queued) {
    writeLive(event);
    if (closed) return;
  }
  if (closed || subscription.status !== "running") {
    finish();
    return;
  }
  timer = setInterval(() => {
    if (!closed) ctx.res.write(": heartbeat\n\n");
  }, 15_000);
  ctx.req.on("close", finish);
}

function writeEvent(res: ServerResponse, event: RunStreamEvent): void {
  res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
}

function shortModelError(error: unknown, apiKey: string): string {
  let message = error instanceof Error ? error.message.trim() : "";
  if (apiKey) message = message.split(apiKey).join("[redacted]");
  const line = message.split(/\r?\n/, 1)[0] ?? "";
  if (!line) return "Could not list models";
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}
