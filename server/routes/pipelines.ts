/**
 * Responsibility: list, read, and save pipeline documents.
 * Inputs: /api/pipelines and /api/pipelines/:id requests.
 * Outputs: pipeline summaries or a full PipelineDocument.
 */
import {
  listPipelines,
  PipelineValidationError,
  readPipeline,
  writePipeline,
} from "../../src/modules/storage/pipelines";
import { JsonError, readJson, sendJson } from "../http";
import type { RouteContext } from "./context";
import { requireWorkspace } from "./workspace";

export async function handlePipelines(ctx: RouteContext): Promise<boolean> {
  const { url, req, res } = ctx;
  const listed = url.pathname === "/api/pipelines";
  const match = url.pathname.match(/^\/api\/pipelines\/([^/]+)$/);
  if (!listed && !match) return false;

  const workspace = await requireWorkspace(ctx);
  if (!workspace) return true;

  if (listed) {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    const pipelines = await listPipelines(workspace);
    sendJson(res, 200, { pipelines });
    return true;
  }

  if (!match) return false;
  const id = decodeURIComponent(match[1] ?? "");

  if (req.method === "GET") {
    try {
      const doc = await readPipeline(workspace, id);
      if (!doc) {
        sendJson(res, 404, { error: "Pipeline not found" });
        return true;
      }
      sendJson(res, 200, doc);
    } catch (error) {
      if (error instanceof PipelineValidationError) {
        sendJson(res, 400, { error: error.message });
        return true;
      }
      throw error;
    }
    return true;
  }

  if (req.method === "PUT") {
    try {
      const body = await readJson(req);
      const saved = await writePipeline(workspace, body, id);
      sendJson(res, 200, saved);
    } catch (error) {
      if (error instanceof PipelineValidationError || error instanceof JsonError) {
        sendJson(res, 400, { error: error.message });
        return true;
      }
      throw error;
    }
    return true;
  }

  sendJson(res, 405, { error: "Method not allowed" });
  return true;
}
