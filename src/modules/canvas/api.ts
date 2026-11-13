/**
 * Responsibility: browser calls to the local /api server.
 * Inputs: pipeline documents, pipeline ids, an API key string, and library payloads.
 * Outputs: pipeline summaries, saved documents, settings status, workspace status, models, run ids, and library snapshots.
 */
import type { PipelineDocument, PipelineSummary } from "../graph/types";
import type { LibraryRule, LibrarySkill, LibrarySnapshot, Selection } from "../library/types";

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
  models: { id: string; label: string }[];
  error?: string;
}> {
  return requestJson<{ configured: boolean; models: { id: string; label: string }[]; error?: string }>("/api/models");
}

export async function startRun(doc: PipelineDocument): Promise<{ id: string }> {
  return requestJson<{ id: string }>("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(doc),
  });
}

export async function postDecision(id: string, decision: "approve" | "redo" | "decline"): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(`/api/runs/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision }),
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

export type WorkspaceStatus = { path: string | null; valid: boolean; error?: string };

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

export async function browseLibrary(kind: "skill" | "rule"): Promise<{ cancelled: true } | { path: string }> {
  return requestJson<{ cancelled: true } | { path: string }>("/api/library/browse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind }),
  });
}

export async function importLibraryItem(kind: "skill" | "rule", path: string): Promise<LibrarySkill | LibraryRule> {
  if (kind === "skill") {
    const body = await requestJson<{ skill: LibrarySkill }>("/api/library/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, path }),
    });
    return body.skill;
  }
  const body = await requestJson<{ rule: LibraryRule }>("/api/library/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, path }),
  });
  return body.rule;
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
