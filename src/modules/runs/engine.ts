/**
 * Responsibility: run resolved pipeline steps and publish stream events.
 * Inputs: execution steps, a Cursor API key, the workspace directory, the library catalog, and enabled MCP configs.
 * Outputs: an in-memory run with status, outputs, artifacts, and SSE events.
 * The API key, catalog, and MCP configs stay on the run record. Secrets are never logged or returned.
 */
import { readAgentInstruction } from "../agents/agentFile";
import { diffSnapshots, snapshotFiles } from "../artifacts/track";
import { createCursorAgentRunner, type CursorAgentRunner, type RunnerEvent, type SendResult } from "../cursor/adapter";
import type { ExecutionStep } from "../graph/resolve";
import { applyCatalog } from "../library/catalog";
import type { EnabledMcpConfig } from "../library/types";
import {
  applyHumanDecision,
  enterHuman,
  type GateDecision,
  type GateSnapshot,
} from "./humanGate";

export type RunStatus = "running" | "paused" | "done" | "error" | "stopped";

export type RunStreamEvent = { event: string; data: unknown };

export type ActiveRun = {
  id: string;
  status: RunStatus;
  steps: ExecutionStep[];
  outputs: Record<string, string>;
  artifacts: { path: string; agentNodeId: string }[];
  artifactPaths: string[];
  humanStepIndex: number | null;
  events: RunStreamEvent[];
  runTotal: number;
};

type RunRecord = ActiveRun & {
  listeners: Set<(event: RunStreamEvent) => void>;
  runner: CursorAgentRunner | null;
  runnerNodeId: string | null;
  apiKey: string;
  cwd: string;
  catalog: string;
  mcpServers: EnabledMcpConfig[];
  stepIndex: number;
  retryCounts: Record<string, number>;
  humanStatus: GateSnapshot["humanStatus"];
};

const runs = new Map<string, RunRecord>();
let sessionTokens = 0;

export function startRun(options: {
  steps: ExecutionStep[];
  apiKey: string;
  cwd: string;
  catalog: string;
  mcpServers: readonly EnabledMcpConfig[];
}): string {
  const id = crypto.randomUUID();
  const run: RunRecord = {
    id,
    status: "running",
    steps: options.steps,
    outputs: {},
    artifacts: [],
    artifactPaths: [],
    humanStepIndex: null,
    events: [],
    runTotal: 0,
    listeners: new Set(),
    runner: null,
    runnerNodeId: null,
    apiKey: options.apiKey,
    cwd: options.cwd,
    catalog: options.catalog,
    mcpServers: options.mcpServers.map(copyMcpConfig),
    stepIndex: 0,
    retryCounts: {},
    humanStatus: "idle",
  };
  runs.set(id, run);
  void runSteps(run, 0).catch((error: unknown) => {
    void failRun(run, error);
  });
  return id;
}

export function runExists(id: string): boolean {
  return runs.has(id);
}

export function decideRun(id: string, decision: GateDecision): { ok: true } | { ok: false; error: string } {
  const run = runs.get(id);
  if (!run) return { ok: false, error: "Run not found" };
  const current = gateSnapshot(run);
  const outcome = applyHumanDecision(current, decision);
  if (outcome.effect.type === "reject") return { ok: false, error: outcome.effect.message };

  const humanId = current.steps[current.stepIndex]?.nodeId;
  run.retryCounts = outcome.snapshot.retryCounts;
  run.humanStatus = outcome.snapshot.humanStatus;
  run.stepIndex = outcome.snapshot.stepIndex;

  if (outcome.effect.type === "halt") {
    run.status = "stopped";
    if (humanId) emit(run, "node-status", { nodeId: humanId, status: "declined", elapsedMs: 0 });
    emit(run, "stopped", { nodeId: humanId ?? "" });
    void disposeRunner(run);
    return { ok: true };
  }

  if (outcome.effect.type === "resend") {
    const effect = outcome.effect;
    // Stay running while the same agent is re-sent so a reconnect is not closed by the earlier pause.
    run.status = "running";
    void resendUpstream(run, effect).catch((error: unknown) => {
      void failRun(run, error, effect.nodeId);
    });
    return { ok: true };
  }

  if (outcome.snapshot.status === "done" || outcome.snapshot.stepIndex >= run.steps.length) {
    if (humanId) emit(run, "node-status", { nodeId: humanId, status: "approved", elapsedMs: 0 });
    run.status = "done";
    emit(run, "done", { status: "done" });
    void disposeRunner(run);
    return { ok: true };
  }

  run.status = "running";
  if (humanId) emit(run, "node-status", { nodeId: humanId, status: "approved", elapsedMs: 0 });
  void runSteps(run, outcome.snapshot.stepIndex).catch((error: unknown) => {
    void failRun(run, error);
  });
  return { ok: true };
}

export function subscribeRun(
  id: string,
  listener: (event: RunStreamEvent) => void,
): { events: RunStreamEvent[]; status: RunStatus; unsubscribe: () => void } | undefined {
  const run = runs.get(id);
  if (!run) return undefined;
  run.listeners.add(listener);
  const events = run.events.slice();
  const status = run.status;
  return {
    events,
    status,
    unsubscribe: () => {
      run.listeners.delete(listener);
    },
  };
}

async function runSteps(run: RunRecord, startIndex: number): Promise<void> {
  for (let index = startIndex; index < run.steps.length; index += 1) {
    if (run.status !== "running") return;
    const step = run.steps[index];
    if (!step) continue;
    run.stepIndex = index;
    if (step.kind === "human") {
      enterHumanStep(run);
      return;
    }
    await runAgent(run, step, index);
    if (run.status !== "running") return;
  }
  if (run.status !== "running") return;
  await disposeRunner(run);
  if (run.status !== "running") return;
  run.status = "done";
  emit(run, "done", { status: "done" });
}

async function runAgent(
  run: RunRecord,
  step: Extract<ExecutionStep, { kind: "agent" }>,
  index: number,
): Promise<void> {
  emit(run, "node-status", { nodeId: step.nodeId, status: "running", elapsedMs: 0 });
  const instruction = await readAgentInstruction(step.agentPath);
  if (!instruction.ok) {
    await failAgentRead(run, step.nodeId, instruction.message);
    return;
  }
  const startedAt = Date.now();
  const before = await snapshotFiles(run.cwd);
  const runner = await ensureRunner(run, step.nodeId, step.modelId);
  const prompt = withUpstream(applyCatalog(instruction.text, run.catalog), upstreamTexts(run, index));
  const result = await runner.send(prompt, (event) => {
    forward(run, step.nodeId, event);
  });
  await finishSend(run, step.nodeId, startedAt, before, result);
}

async function resendUpstream(
  run: RunRecord,
  effect: { nodeId: string; retryCount: number },
): Promise<void> {
  const { nodeId, retryCount } = effect;
  const step = run.steps.find((item) => item.kind === "agent" && item.nodeId === nodeId);
  const instruction = await readAgentInstruction(step?.kind === "agent" ? step.agentPath : "");
  if (!instruction.ok) {
    await failAgentRead(run, nodeId, instruction.message, retryCount);
    return;
  }
  emit(run, "node-status", { nodeId, status: "redoing", retryCount, elapsedMs: 0 });
  const startedAt = Date.now();
  const before = await snapshotFiles(run.cwd);
  if (!run.runner || run.runnerNodeId !== nodeId) {
    run.status = "error";
    emit(run, "node-status", { nodeId, status: "error", retryCount, elapsedMs: 0 });
    emit(run, "error", { nodeId, message: "Runner is not available" });
    await disposeRunner(run);
    return;
  }
  // The runner already received the catalog on its first prompt. Redo sends the file body only.
  const result = await run.runner.send(instruction.text, (event) => {
    forward(run, nodeId, event);
  });
  const ok = await finishSend(run, nodeId, startedAt, before, result, retryCount);
  if (!ok || run.status !== "running") return;
  enterHumanStep(run);
}

async function failAgentRead(run: RunRecord, nodeId: string, message: string, retryCount?: number): Promise<void> {
  run.status = "error";
  emit(run, "node-status", statusPayload(nodeId, "error", 0, retryCount));
  emit(run, "error", { nodeId, message });
  await disposeRunner(run);
}

function enterHumanStep(run: RunRecord): void {
  const step = run.steps[run.stepIndex];
  if (!step || step.kind !== "human") return;
  const next = enterHuman(gateSnapshot(run));
  run.status = next.status;
  run.humanStatus = next.humanStatus;
  run.humanStepIndex = run.stepIndex;
  run.artifactPaths = run.artifacts.map((hit) => hit.path);
  emit(run, "node-status", { nodeId: step.nodeId, status: "waiting", elapsedMs: 0 });
  emit(run, "paused", { nodeId: step.nodeId });
}

async function ensureRunner(run: RunRecord, nodeId: string, modelId: string): Promise<CursorAgentRunner> {
  if (run.runner && run.runnerNodeId === nodeId) return run.runner;
  await disposeRunner(run);
  const runner = createCursorAgentRunner();
  run.runner = runner;
  run.runnerNodeId = nodeId;
  await runner.start({
    apiKey: run.apiKey,
    cwd: run.cwd,
    modelId,
    mcpServers: run.mcpServers,
  });
  return runner;
}

async function disposeRunner(run: RunRecord): Promise<void> {
  const runner = run.runner;
  run.runner = null;
  run.runnerNodeId = null;
  if (!runner) return;
  try {
    await runner.dispose();
  } catch {
    // The process is dropping the agent either way.
  }
}

async function finishSend(
  run: RunRecord,
  nodeId: string,
  startedAt: number,
  before: Map<string, number>,
  result: SendResult,
  retryCount?: number,
): Promise<boolean> {
  const after = await snapshotFiles(run.cwd);
  const hits = diffSnapshots(before, after, nodeId);
  for (const hit of hits) {
    run.artifacts.push(hit);
    emit(run, "artifact", { path: hit.path, agentNodeId: hit.agentNodeId });
  }
  run.artifactPaths = run.artifacts.map((hit) => hit.path);
  const elapsedMs = Date.now() - startedAt;
  if (result.failure !== "none" || result.status === "error") {
    const message = publicError(result.error || "Run failed", run);
    run.status = "error";
    emit(run, "node-status", statusPayload(nodeId, "error", elapsedMs, retryCount));
    emit(run, "error", { nodeId, message });
    await disposeRunner(run);
    return false;
  }
  run.outputs[nodeId] = result.text;
  emit(run, "node-status", statusPayload(nodeId, "done", elapsedMs, retryCount));
  return true;
}

async function failRun(run: RunRecord, error: unknown, nodeId?: string): Promise<void> {
  if (run.status === "paused" || run.status === "stopped" || run.status === "done" || run.status === "error") return;
  const message = publicError(error instanceof Error ? error.message : "Run failed", run);
  const current = nodeId ?? run.steps[run.stepIndex]?.nodeId;
  if (current) emit(run, "node-status", { nodeId: current, status: "error", elapsedMs: 0 });
  emit(run, "error", current ? { nodeId: current, message } : { message });
  run.status = "error";
  await disposeRunner(run);
}

function gateSnapshot(run: RunRecord): GateSnapshot {
  return {
    status: run.status,
    stepIndex: run.stepIndex,
    steps: run.steps.map((step) => ({ kind: step.kind, nodeId: step.nodeId })),
    retryCounts: { ...run.retryCounts },
    outputs: { ...run.outputs },
    humanStatus: run.humanStatus,
  };
}

function statusPayload(nodeId: string, status: string, elapsedMs: number, retryCount?: number) {
  const data: { nodeId: string; status: string; elapsedMs: number; retryCount?: number } = {
    nodeId,
    status,
    elapsedMs,
  };
  if (retryCount !== undefined) data.retryCount = retryCount;
  return data;
}

function upstreamTexts(run: RunRecord, beforeIndex: number): { nodeId: string; text: string }[] {
  const prior: { nodeId: string; text: string }[] = [];
  for (let index = 0; index < beforeIndex; index += 1) {
    const step = run.steps[index];
    if (!step || step.kind !== "agent") continue;
    const text = run.outputs[step.nodeId];
    if (text === undefined) continue;
    prior.push({ nodeId: step.nodeId, text });
  }
  return prior;
}

function forward(run: RunRecord, nodeId: string, event: RunnerEvent): void {
  if (event.type === "assistant") {
    emit(run, "assistant", { nodeId, text: event.text });
    return;
  }
  const data: {
    nodeId: string;
    input?: number;
    output?: number;
    total?: number;
    runTotal: number;
    sessionTotal: number;
  } = {
    nodeId,
    runTotal: run.runTotal,
    sessionTotal: sessionTokens,
  };
  if (typeof event.input === "number") data.input = event.input;
  if (typeof event.output === "number") data.output = event.output;
  if (typeof event.total === "number") {
    run.runTotal += event.total;
    sessionTokens += event.total;
    data.total = event.total;
    data.runTotal = run.runTotal;
    data.sessionTotal = sessionTokens;
  }
  emit(run, "token", data);
}

function withUpstream(prompt: string, prior: { nodeId: string; text: string }[]): string {
  if (prior.length === 0) return prompt;
  const blocks = prior.map((item) => `### ${item.nodeId}\n${item.text}`).join("\n\n");
  const section = `## Upstream\n\n${blocks}`;
  const trimmed = prompt.trimEnd();
  return trimmed ? `${trimmed}\n\n${section}` : section;
}

function emit(run: RunRecord, event: string, data: unknown): void {
  const item = { event, data };
  run.events.push(item);
  for (const listener of [...run.listeners]) {
    try {
      listener(item);
    } catch {
      // One client cannot stop the run.
    }
  }
}

function copyMcpConfig(config: EnabledMcpConfig): EnabledMcpConfig {
  const copy: EnabledMcpConfig = {
    id: config.id,
    name: config.name,
    source: config.source,
    type: config.type,
    env: { ...config.env },
  };
  if (config.command !== undefined) copy.command = config.command;
  if (config.args) copy.args = [...config.args];
  if (config.url !== undefined) copy.url = config.url;
  if (config.headers) copy.headers = { ...config.headers };
  return copy;
}

function publicError(message: string, run: RunRecord): string {
  const secrets = [run.apiKey];
  for (const config of run.mcpServers) {
    secrets.push(...Object.values(config.env));
    if (config.headers) secrets.push(...Object.values(config.headers));
  }
  secrets.sort((left, right) => right.length - left.length);
  let text = message;
  for (const secret of secrets) {
    if (!secret || !text.includes(secret)) continue;
    text = text.split(secret).join("[redacted]");
  }
  return text;
}
