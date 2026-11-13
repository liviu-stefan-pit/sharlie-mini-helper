/**
 * Responsibility: local JSON API for skills, pipelines, and settings.
 * Inputs: HTTP requests on 127.0.0.1:8787 and the workspace .env file.
 * Outputs: JSON responses. The process listens until stopped.
 */
import { createServer } from "node:http";
import { PipelineValidationError } from "../src/modules/storage/pipelines";
import { JsonError, sendJson } from "./http";
import { loadEnv } from "./loadEnv";
import type { RouteContext } from "./routes/context";
import { handlePipelines } from "./routes/pipelines";
import { handleSettings } from "./routes/settings";
import { handleSkills } from "./routes/skills";

loadEnv();

const workspaceRoot = process.cwd();
const port = 8787;
const host = "127.0.0.1";

const server = createServer((req, res) => {
  void handleRequest(req, res).catch((error: unknown) => {
    if (res.headersSent) return;
    if (error instanceof PipelineValidationError || error instanceof JsonError) {
      sendJson(res, 400, { error: error.message });
      return;
    }
    console.error("request failed");
    sendJson(res, 500, { error: "Internal error" });
  });
});

async function handleRequest(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) {
  const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  const ctx: RouteContext = { req, res, url, workspaceRoot };
  if (await handleSkills(ctx)) return;
  if (await handleSettings(ctx)) return;
  if (await handlePipelines(ctx)) return;
  sendJson(res, 404, { error: "Not found" });
}

server.listen(port, host, () => {
  console.log(`sharlie-mini-helper API listening on http://${host}:${port}`);
});
