/**
 * Responsibility: start pipeline runs and stream their events.
 * Inputs: POST /api/runs, POST /api/runs/:id/decision, GET /api/runs/:id/events, GET /api/models.
 * Outputs: a run id, a decision acknowledgement, a server-sent event stream, and the model list.
 */
import type { ServerResponse } from "node:http";
import { listModels } from "../../src/modules/cursor/adapter";
import type { PipelineDocument, PipelineEdge, PipelineNode } from "../../src/modules/graph/types";
import { GraphError, resolvePipeline } from "../../src/modules/graph/resolve";
import {
  buildCatalogPrompt,
  defaultCursorHome,
  libraryRoot,
  loadEnabledMcpConfigs,
  scanLibrary,
} from "../../src/modules/library";
import { decideRun, runExists, startRun, subscribeRun, type RunStreamEvent } from "../../src/modules/runs/engine";
import { readJson, sendJson } from "../http";
import { loadEnv } from "../loadEnv";
import type { RouteContext } from "./context";

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
    try {
      const doc = coercePipeline(await readJson(ctx.req));
      const steps = resolvePipeline(doc);
      loadEnv();
      const apiKey = process.env.CURSOR_API_KEY?.trim() ?? "";
      if (!apiKey) {
        sendJson(ctx.res, 400, { error: "CURSOR_API_KEY is not configured" });
        return true;
      }
      const library = await loadEnabledLibrary(ctx.workspaceRoot);
      const id = startRun({
        steps,
        apiKey,
        cwd: ctx.workspaceRoot,
        catalog: library.catalog,
        mcpServers: library.mcpServers,
      });
      sendJson(ctx.res, 201, { id });
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

async function loadEnabledLibrary(workspaceRoot: string): Promise<{
  catalog: string;
  mcpServers: Awaited<ReturnType<typeof loadEnabledMcpConfigs>>;
}> {
  const roots = {
    cursorHome: defaultCursorHome(),
    appLibraryRoot: libraryRoot(workspaceRoot),
  };
  const [snapshot, mcpServers] = await Promise.all([scanLibrary(roots), loadEnabledMcpConfigs(roots)]);
  const catalog = buildCatalogPrompt(
    snapshot.skills.filter((skill) => skill.enabled),
    snapshot.rules.filter((rule) => rule.enabled),
  );
  return { catalog, mcpServers };
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

function coercePipeline(input: unknown): PipelineDocument {
  if (!isRecord(input)) throw new GraphError("Pipeline body must be an object");
  if (input.version !== 1) throw new GraphError("Pipeline version must be 1");
  if (!Array.isArray(input.nodes) || !Array.isArray(input.edges)) {
    throw new GraphError("Pipeline nodes and edges must be arrays");
  }
  return {
    version: 1,
    id: typeof input.id === "string" && input.id.trim() ? input.id : "pipeline",
    name: typeof input.name === "string" && input.name.trim() ? input.name.trim() : "Untitled",
    nodes: input.nodes.map((node, index) => coerceNode(node, index)),
    edges: input.edges.map((edge, index) => coerceEdge(edge, index)),
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : new Date().toISOString(),
  };
}

function coerceNode(value: unknown, index: number): PipelineNode {
  if (!isRecord(value)) throw new GraphError(`Node ${index} must be an object`);
  if (typeof value.id !== "string" || !value.id.trim()) throw new GraphError(`Node ${index} id is required`);
  const position = nodePosition(value.position);
  const data = isRecord(value.data) ? value.data : undefined;
  if (!data) throw new GraphError(`Node ${index} data must be an object`);
  if (value.type === "agent") {
    return {
      id: value.id,
      type: "agent",
      position,
      data: {
        modelId: typeof data.modelId === "string" ? data.modelId : "",
        agentPath: typeof data.agentPath === "string" ? data.agentPath : "",
        agentName: typeof data.agentName === "string" ? data.agentName : "",
        status: "idle",
        elapsedMs: 0,
        retryCount: 0,
        tokens: {},
      },
    };
  }
  if (value.type === "human") {
    return {
      id: value.id,
      type: "human",
      position,
      data: {
        status: "idle",
        artifactPaths: [],
      },
    };
  }
  throw new GraphError(`Node ${index} has an unknown type`);
}

function coerceEdge(value: unknown, index: number): PipelineEdge {
  if (!isRecord(value)) throw new GraphError(`Edge ${index} must be an object`);
  if (value.kind !== "execution") {
    throw new GraphError(`Edge ${index} kind must be execution`);
  }
  if (typeof value.id !== "string" || typeof value.source !== "string" || typeof value.target !== "string") {
    throw new GraphError(`Edge ${index} is incomplete`);
  }
  return { id: value.id, source: value.source, target: value.target, kind: "execution" };
}

function nodePosition(value: unknown): { x: number; y: number } {
  if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number") {
    return { x: 0, y: 0 };
  }
  return { x: value.x, y: value.y };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
