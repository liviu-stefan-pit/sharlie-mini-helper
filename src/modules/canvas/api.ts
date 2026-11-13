/**
 * Responsibility: browser calls to the local /api server.
 * Inputs: pipeline documents, pipeline ids, and an API key string.
 * Outputs: skills, pipeline summaries, saved documents, and settings status.
 */
import type { PipelineDocument, PipelineSummary } from "../graph/types";
import type { SkillSummary } from "../skills/parseSkill";

export async function fetchSkills(): Promise<SkillSummary[]> {
  const body = await requestJson<{ skills: SkillSummary[] }>("/api/skills");
  return body.skills;
}

export async function fetchPipelines(): Promise<PipelineSummary[]> {
  const body = await requestJson<{ pipelines: PipelineSummary[] }>("/api/pipelines");
  return body.pipelines;
}

export async function fetchPipeline(id: string): Promise<PipelineDocument> {
  return requestJson<PipelineDocument>(`/api/pipelines/${encodeURIComponent(id)}`);
}

export async function savePipeline(doc: PipelineDocument): Promise<PipelineDocument> {
  return requestJson<PipelineDocument>(`/api/pipelines/${encodeURIComponent(doc.id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(doc),
  });
}

export async function fetchSettings(): Promise<{ configured: boolean }> {
  return requestJson<{ configured: boolean }>("/api/settings");
}

export async function saveSettings(apiKey: string): Promise<{ configured: boolean }> {
  return requestJson<{ configured: boolean }>("/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : response.statusText || "Request failed";
    throw new Error(message);
  }
  return body as T;
}
