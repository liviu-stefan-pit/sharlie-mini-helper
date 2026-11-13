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

export async function handlePipelines(ctx: RouteContext): Promise<boolean> {
  const { url, req, res, workspaceRoot } = ctx;
  if (url.pathname === "/api/pipelines") {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    const pipelines = await listPipelines(workspaceRoot);
    sendJson(res, 200, { pipelines });
    return true;
  }

  const match = url.pathname.match(/^\/api\/pipelines\/([^/]+)$/);
  if (!match) return false;
  const id = decodeURIComponent(match[1] ?? "");

  if (req.method === "GET") {
    try {
      const doc = await readPipeline(workspaceRoot, id);
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
      const saved = await writePipeline(workspaceRoot, body, id);
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
