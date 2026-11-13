/**
 * Responsibility: report and update the local Cursor API key flag.
 * Inputs: GET or POST /api/settings. POST body is { apiKey }.
 * Outputs: { configured } only. The key itself is never returned.
 */
import path from "node:path";
import { JsonError, readJson, sendJson } from "../http";
import { upsertEnvValue } from "../loadEnv";
import type { RouteContext } from "./context";

export async function handleSettings(ctx: RouteContext): Promise<boolean> {
  if (ctx.url.pathname !== "/api/settings") return false;
  if (ctx.req.method === "GET") {
    sendJson(ctx.res, 200, { configured: isConfigured() });
    return true;
  }
  if (ctx.req.method !== "POST") {
    sendJson(ctx.res, 405, { error: "Method not allowed" });
    return true;
  }

  try {
    const body = await readJson(ctx.req);
    if (!isRecord(body) || typeof body.apiKey !== "string") {
      sendJson(ctx.res, 400, { error: "apiKey must be a string" });
      return true;
    }
    const apiKey = body.apiKey.trim();
    if (/[\r\n]/.test(apiKey)) {
      sendJson(ctx.res, 400, { error: "apiKey must be a single line" });
      return true;
    }
    const envPath = path.join(ctx.appRoot, ".env");
    await upsertEnvValue(envPath, "CURSOR_API_KEY", apiKey);
    process.env.CURSOR_API_KEY = apiKey;
    sendJson(ctx.res, 200, { configured: apiKey.length > 0 });
  } catch (error) {
    if (error instanceof JsonError) {
      sendJson(ctx.res, 400, { error: error.message });
      return true;
    }
    sendJson(ctx.res, 500, { error: "Could not update settings" });
  }
  return true;
}

function isConfigured(): boolean {
  return Boolean(process.env.CURSOR_API_KEY?.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
