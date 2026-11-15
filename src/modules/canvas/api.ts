/**
 * Responsibility: browser calls to the local /api server.
 * Inputs: pipeline documents, pipeline ids, an API key string, and library payloads.
 * Outputs: pipeline summaries, saved documents, settings status, workspace status, models, run ids, workflow health, and library snapshots.
 */
import type { PipelineDocument, PipelineSummary } from "../graph/types";
import type { ModelChoice } from "./modelsContext";
import type { LibraryRule, LibrarySkill, LibrarySnapshot, Selection } from "../library/types";
import type { WorkflowHealth } from "../workflow/health";

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

export async function fetchModels(): Promise<{
  configured: boolean;
  models: ModelChoice[];
  error?: string;
}> {
  return requestJson<{ configured: boolean; models: ModelChoice[]; error?: string }>("/api/models");
}

export async function startRun(doc: PipelineDocument): Promise<{ id: string; warnings?: string[] }> {
  return requestJson<{ id: string; warnings?: string[] }>("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(doc),
  });
}

export async function resumeRun(doc: PipelineDocument): Promise<{ id: string; warnings?: string[] }> {
  return requestJson<{ id: string; warnings?: string[] }>("/api/runs/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(doc),
  });
}

export async function stopRun(id: string): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(`/api/runs/${encodeURIComponent(id)}/stop`, { method: "POST" });
}

export async function fetchCheckpoint(id: string): Promise<{ resumable: boolean }> {
  return requestJson<{ resumable: boolean }>(`/api/pipelines/${encodeURIComponent(id)}/checkpoint`);
}

export async function deleteCheckpoint(id: string): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(`/api/pipelines/${encodeURIComponent(id)}/checkpoint`, { method: "DELETE" });
}

export async function fetchWorkflowHealth(doc: PipelineDocument): Promise<WorkflowHealth> {
  return requestJson<WorkflowHealth>("/api/workflow/health", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(doc),
  });
}

/** `redoNodeId` is only for Redo one. Without it, Redo re-sends every agent the human reviews. */
export async function postDecision(
  id: string,
  nodeId: string,
  decision: "approve" | "redo" | "decline",
  redoNodeId?: string,
): Promise<{ ok: true }> {
  const body: { decision: string; nodeId: string; redoNodeId?: string } = { decision, nodeId };
  if (redoNodeId !== undefined) body.redoNodeId = redoNodeId;
  return requestJson<{ ok: true }>(`/api/runs/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type AgentChoice = { name: string; description: string; path: string };

export async function fetchAgents(): Promise<AgentChoice[]> {
  const body = await requestJson<{ agents: AgentChoice[] }>("/api/agents");
  return Array.isArray(body.agents) ? body.agents : [];
}

export async function browseAgent(): Promise<{ cancelled: true } | AgentChoice> {
  return requestJson<{ cancelled: true } | AgentChoice>("/api/agents/browse", { method: "POST" });
}

export async function fetchFilePreview(filePath: string): Promise<{ path: string; content: string; truncated: boolean }> {
  return requestJson<{ path: string; content: string; truncated: boolean }>(
    `/api/files?path=${encodeURIComponent(filePath)}`,
  );
}

export async function saveSettings(apiKey: string): Promise<{ configured: boolean }> {
  return requestJson<{ configured: boolean }>("/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
}

export type WorkspaceStatus = { path: string | null; valid: boolean; error?: string; temporary?: boolean };

export async function fetchWorkspace(): Promise<WorkspaceStatus> {
  return requestJson<WorkspaceStatus>("/api/workspace");
}

export async function browseWorkspace(): Promise<{ cancelled: true } | { path: string }> {
  return requestJson<{ cancelled: true } | { path: string }>("/api/workspace/browse", { method: "POST" });
}

export async function exportWorkflow(
  id: string,
  includeFiles: boolean,
): Promise<{ cancelled: true } | { path: string; bytes: number; warnings: string[] }> {
  return requestJson<{ cancelled: true } | { path: string; bytes: number; warnings: string[] }>("/api/sharlie/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, includeFiles }),
  });
}

export async function importWorkflow(): Promise<
  { cancelled: true } | { id: string; name: string; warnings: string[] }
> {
  return requestJson<{ cancelled: true } | { id: string; name: string; warnings: string[] }>("/api/sharlie/import", {
    method: "POST",
  });
}

export async function saveWorkspace(path: string | null): Promise<WorkspaceStatus> {
  return requestJson<WorkspaceStatus>("/api/workspace", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

export async function fetchLibrary(): Promise<LibrarySnapshot> {
  return requestJson<LibrarySnapshot>("/api/library");
}

export async function saveLibrarySelection(selection: Selection): Promise<Selection> {
  return requestJson<Selection>("/api/library/selection", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(selection),
  });
}

export type LibraryPathProblem = { path: string; error: string };

export async function browseLibrary(
  kind: "skill" | "rule",
): Promise<{ cancelled: true } | { paths: string[]; skipped: LibraryPathProblem[] }> {
  return requestJson("/api/library/browse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind }),
  });
}

export async function importLibrarySkills(
  paths: string[],
): Promise<{ skills: LibrarySkill[]; errors: LibraryPathProblem[] }> {
  return requestJson<{ skills: LibrarySkill[]; errors: LibraryPathProblem[] }>("/api/library/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "skill", paths }),
  });
}

export async function importLibraryRules(
  paths: string[],
): Promise<{ rules: LibraryRule[]; errors: LibraryPathProblem[] }> {
  return requestJson<{ rules: LibraryRule[]; errors: LibraryPathProblem[] }>("/api/library/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "rule", paths }),
  });
}

export async function deleteLibraryItem(id: string): Promise<{ deleted: true }> {
  return requestJson<{ deleted: true }>("/api/library/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
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
