/**
 * Responsibility: local JSON API for the library, skills, pipelines, settings, runs, models, and sharlie export.
 * Inputs: HTTP requests on 127.0.0.1:8787 and the workspace .env file.
 * Outputs: JSON responses, including workspace file previews. The process listens until stopped.
 */
import { createServer } from "node:http";
import { LibraryError } from "../src/modules/library";
import { PipelineValidationError } from "../src/modules/storage/pipelines";
import { loadApiKeyIntoEnv } from "./credentials";
import { JsonError, sendJson } from "./http";
import { loadEnv } from "./loadEnv";
import type { RouteContext } from "./routes/context";
import { handleAgents } from "./routes/agents";
import { handleFiles } from "./routes/files";
import { handleLibrary } from "./routes/library";
import { handlePipelines } from "./routes/pipelines";
import { handleModels, handleRuns } from "./routes/runs";
import { handleSettings } from "./routes/settings";
import { handleSharlie } from "./routes/sharlie";
import { handleSkills } from "./routes/skills";
import { handleWorkspace } from "./routes/workspace";

const appRoot = process.cwd();
const port = 8787;
const host = "127.0.0.1";

async function start(): Promise<void> {
  const shellHadKey = Boolean(process.env.CURSOR_API_KEY?.trim());
  loadEnv();
  await loadApiKeyIntoEnv(appRoot, { shellHadKey });

  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((error: unknown) => {
      if (res.headersSent) return;
      if (error instanceof LibraryError) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      if (error instanceof PipelineValidationError || error instanceof JsonError) {
        sendJson(res, 400, { error: error.message });
        return;
      }
      console.error("request failed");
      sendJson(res, 500, { error: "Internal error" });
    });
  });

  server.listen(port, host, () => {
    console.log(`Sharlie Easy Flow API listening on http://${host}:${port}`);
  });
}

async function handleRequest(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) {
  const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  const ctx: RouteContext = { req, res, url, appRoot };
  if (await handleLibrary(ctx)) return;
  if (await handleAgents(ctx)) return;
  if (await handleSkills(ctx)) return;
  if (await handleWorkspace(ctx)) return;
  if (await handleSettings(ctx)) return;
  if (await handleSharlie(ctx)) return;
  if (await handlePipelines(ctx)) return;
  if (await handleModels(ctx)) return;
  if (await handleFiles(ctx)) return;
  if (await handleRuns(ctx)) return;
  sendJson(res, 404, { error: "Not found" });
}

void start();
