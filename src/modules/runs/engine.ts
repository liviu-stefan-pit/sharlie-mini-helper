/**
 * Responsibility: run resolved pipeline steps by their dependencies and publish stream events.
 * Inputs: execution steps (with inputs), a Cursor API key, the workflow directory, the library catalog, and enabled MCP configs.
 * Outputs: an in-memory run with status, outputs, artifacts, and SSE events.
 * A node starts once every input is satisfied. Independent agents run in parallel, up to MAX_PARALLEL_AGENTS.
 * The API key, catalog, and MCP configs stay on the run record. Secrets are never logged or returned.
 */
import { readAgentInstruction, resolveAgentPath } from "../agents/agentFile";
import { diffSnapshots, snapshotFiles } from "../artifacts/track";
import {
  createCursorAgentRunner,
  listModels,
  type CursorAgentRunner,
  type ListedModel,
  type RunnerEvent,
  type SendResult,
} from "../cursor/adapter";
import { defaultEffort } from "../cursor/models";
import type { ExecutionStep } from "../graph/resolve";
import { applyCatalog } from "../library/catalog";
import type { EnabledMcpConfig } from "../library/types";
import {
  deleteCheckpoint,
  pipelineFingerprint,
  writeCheckpoint,
  type RunCheckpoint,
} from "./checkpoint";
import { applyHumanDecision, enterHuman, type GateDecision } from "./humanGate";
import {
  busyAgents,
  canDispose,
  initialSchedule,
  readyNodes,
  reviewSources,
  runStatus,
  upstreamFor,
  waitingHumans,
  withStatus,
  type NodeStatus,
  type ScheduleState,
} from "./schedule";

export const MAX_PARALLEL_AGENTS = 3;

export type RunStatus = "running" | "paused" | "done" | "error" | "stopped";

export type RunStreamEvent = { event: string; data: unknown };

type AgentStep = Extract<ExecutionStep, { kind: "agent" }>;

export type ActiveRun = {
  id: string;
  status: RunStatus;
  steps: ExecutionStep[];
  outputs: Record<string, string>;
  artifacts: { path: string; agentNodeId: string }[];
  artifactPaths: string[];
  waitingHumans: string[];
  events: RunStreamEvent[];
  runTotal: number;
};

type RunRecord = ActiveRun & {
  listeners: Set<(event: RunStreamEvent) => void>;
  schedule: ScheduleState;
  runners: Map<string, CursorAgentRunner>;
  createRunner: () => CursorAgentRunner;
  apiKey: string;
  cwd: string;
  catalog: string;
  mcpServers: EnabledMcpConfig[];
  artifactPrefix: string;
  /** True only after a user stop. Decline stays stopped without this flag. */
  resumable: boolean;
  modelCatalog?: ListedModel[];
  modelCatalogTask?: Promise<ListedModel[]>;
};

type RunRestore = {
  nodeStatus: Record<string, NodeStatus>;
  retryCounts: Record<string, number>;
  outputs: Record<string, string>;
  artifacts: { path: string; agentNodeId: string }[];
};

type RunLaunch = {
  steps: ExecutionStep[];
  apiKey: string;
  cwd: string;
  artifactPrefix: string;
  catalog: string;
  mcpServers: readonly EnabledMcpConfig[];
  /** Tests pass a fake runner. Defaults to the Cursor runner. */
  createRunner?: () => CursorAgentRunner;
};

const runs = new Map<string, RunRecord>();
let sessionTokens = 0;

export function startRun(options: RunLaunch & { restore?: RunRestore }): string {
  retireResumable(options.artifactPrefix);
  const id = crypto.randomUUID();
  const run: RunRecord = {
    id,
    status: "running",
    steps: options.steps,
    outputs: {},
    artifacts: [],
    artifactPaths: [],
    waitingHumans: [],
    events: [],
    runTotal: 0,
    listeners: new Set(),
    schedule: initialSchedule(options.steps),
    runners: new Map(),
    createRunner: options.createRunner ?? createCursorAgentRunner,
    apiKey: options.apiKey,
    cwd: options.cwd,
    catalog: options.catalog,
    mcpServers: options.mcpServers.map(copyMcpConfig),
    artifactPrefix: options.artifactPrefix,
    resumable: false,
  };
  if (options.restore) applyRestore(run, options.restore);
  runs.set(id, run);
  if (options.restore) emitSnapshot(run);
  pump(run);
  return id;
}

/**
 * Cancel an active run. Status becomes `stopped` before any await, so a late send cannot finish it.
 * Running and redoing nodes return to idle. The checkpoint file is resumable.
 */
export async function stopRun(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const run = runs.get(id);
  if (!run) return { ok: false, error: "Run not found" };
  if (!isActive(run)) return { ok: false, error: "Run is not active" };
  run.status = "stopped";
  run.resumable = true;
  const rewound: string[] = [];
  for (const step of run.steps) {
    const status = run.schedule.nodeStatus[step.nodeId];
    if (status === "running" || status === "redoing") {
      setNodeStatus(run, step.nodeId, "idle");
      rewound.push(step.nodeId);
    }
  }
  for (const nodeId of rewound) {
    emit(run, "node-status", { nodeId, status: "idle", elapsedMs: 0 });
  }
  emit(run, "stopped", { resumable: true });
  await Promise.all([writeCheckpoint(run.cwd, checkpointFrom(run)), cancelRunners(run)]);
  return { ok: true };
}

/**
 * Continue a user stop. A live run for this workflow is returned as-is.
 * Same-session keeps the in-memory stopped run. Otherwise the checkpoint seeds a new one.
 * A graph change (node ids or execution edges) is refused and does not start agents.
 */
export function resumeFromCheckpoint(
  options: RunLaunch & { checkpoint: RunCheckpoint },
): { ok: true; id: string } | { ok: false; error: string; conflict: boolean } {
  if (options.checkpoint.version !== 1 || options.checkpoint.pipelineId !== options.artifactPrefix) {
    return { ok: false, error: "Checkpoint does not match this workflow", conflict: true };
  }
  if (pipelineFingerprint(options.steps) !== options.checkpoint.fingerprint) {
    return {
      ok: false,
      error: "The workflow changed after it was stopped. Start over to run it from the beginning.",
      conflict: true,
    };
  }
  const live = findLive(options.artifactPrefix);
  if (live) return { ok: true, id: live.id };
  const existing = findResumable(options.artifactPrefix);
  if (existing) {
    continueRun(existing, options);
    return { ok: true, id: existing.id };
  }
  const id = startRun({
    ...options,
    restore: {
      nodeStatus: options.checkpoint.nodeStatus,
      retryCounts: options.checkpoint.retryCounts,
      outputs: options.checkpoint.outputs,
      artifacts: options.checkpoint.artifacts,
    },
  });
  return { ok: true, id };
}

/** Drop a stopped run from memory. Used to simulate a process restart. The checkpoint file stays. */
export function forgetStoppedRun(id: string): void {
  const run = runs.get(id);
  if (!run || run.status !== "stopped") return;
  runs.delete(id);
}

export function runExists(id: string): boolean {
  return runs.has(id);
}

/**
 * Apply a review decision to one human node. `nodeId` may be omitted when exactly one human waits.
 * `redoNodeId` picks one reviewed agent for Redo one; without it Redo re-sends every reviewed agent.
 */
export function decideRun(
  id: string,
  decision: GateDecision,
  nodeId?: string,
  redoNodeId?: string,
): { ok: true } | { ok: false; error: string } {
  const run = runs.get(id);
  if (!run) return { ok: false, error: "Run not found" };
  if (!isActive(run)) return { ok: false, error: "Run is not active" };
  const waiting = waitingHumans(run.schedule);
  const humanId = nodeId ?? (waiting.length === 1 ? waiting[0] : undefined);
  if (!humanId) return { ok: false, error: "Choose which review node to decide" };

  const outcome = applyHumanDecision(run.schedule, humanId, decision, redoNodeId);
  if (outcome.effect.type === "reject") return { ok: false, error: outcome.effect.message };
  setSchedule(run, outcome.state);

  if (outcome.effect.type === "halt") {
    run.status = "stopped";
    run.resumable = false;
    emit(run, "node-status", { nodeId: humanId, status: "declined", elapsedMs: 0 });
    emit(run, "stopped", { nodeId: humanId });
    void deleteCheckpoint(run.cwd).catch(() => {});
    void disposeAll(run);
    return { ok: true };
  }

  if (outcome.effect.type === "resend") {
    run.status = "running";
    emit(run, "node-status", { nodeId: humanId, status: "idle", elapsedMs: 0 });
    for (const target of outcome.effect.nodes) {
      void resendAgent(run, target.nodeId, target.retryCount).catch((error: unknown) => {
        void failRun(run, error, target.nodeId);
      });
    }
    return { ok: true };
  }

  emit(run, "node-status", { nodeId: humanId, status: "approved", elapsedMs: 0 });
  for (const agentId of reviewSources(run.schedule, humanId)) releaseRunnerIfIdle(run, agentId);
  run.status = "running";
  pump(run);
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

function isActive(run: RunRecord): boolean {
  return run.status === "running" || run.status === "paused";
}

function setSchedule(run: RunRecord, next: ScheduleState): void {
  run.schedule = next;
  run.waitingHumans = waitingHumans(next);
}

function setNodeStatus(run: RunRecord, nodeId: string, status: NodeStatus): void {
  setSchedule(run, withStatus(run.schedule, nodeId, status));
}

/** Start every ready node the cap allows, then settle the run status. */
function pump(run: RunRecord): void {
  if (!isActive(run)) return;
  let busy = busyAgents(run.schedule).length;
  for (const nodeId of readyNodes(run.schedule)) {
    const step = run.steps.find((item) => item.nodeId === nodeId);
    if (!step) continue;
    if (step.kind === "human") {
      enterHumanNode(run, nodeId);
      continue;
    }
    if (busy >= MAX_PARALLEL_AGENTS) continue;
    busy += 1;
    setNodeStatus(run, nodeId, "running");
    void runAgent(run, step).catch((error: unknown) => {
      void failRun(run, error, nodeId);
    });
  }
  settle(run);
}

/** Emit `paused` or `done` when the schedule says so. `paused` means nothing runs and a human waits. */
function settle(run: RunRecord): void {
  if (!isActive(run)) return;
  const status = runStatus(run.schedule);
  if (status === "running") {
    run.status = "running";
    return;
  }
  if (status === "paused") {
    if (run.status === "paused") return;
    run.status = "paused";
    run.artifactPaths = run.artifacts.map((hit) => hit.path);
    emit(run, "paused", { nodeIds: run.waitingHumans });
    return;
  }
  if (status === "done") {
    run.status = "done";
    run.resumable = false;
    emit(run, "done", { status: "done" });
    void deleteCheckpoint(run.cwd).catch(() => {});
    void disposeAll(run);
    return;
  }
  void failRun(run, new Error("Run cannot continue"));
}

function enterHumanNode(run: RunRecord, nodeId: string): void {
  setSchedule(run, enterHuman(run.schedule, nodeId));
  run.artifactPaths = run.artifacts.map((hit) => hit.path);
  emit(run, "node-status", { nodeId, status: "waiting", elapsedMs: 0 });
}

async function runAgent(run: RunRecord, step: AgentStep): Promise<void> {
  const nodeId = step.nodeId;
  emit(run, "node-status", { nodeId, status: "running", elapsedMs: 0 });
  const instruction = await readAgentInstruction(resolveAgentPath(run.cwd, step.agentPath));
  if (!isActive(run)) return;
  if (!instruction.ok) {
    await failNode(run, nodeId, instruction.message);
    return;
  }
  const startedAt = Date.now();
  const before = await snapshotFiles(run.cwd);
  const runner = await ensureRunner(run, step);
  if (!isActive(run)) return;
  const prompt = withUpstream(applyCatalog(instruction.text, run.catalog), upstreamBlocks(run, nodeId));
  const result = await runner.send(prompt, (event) => {
    if (isActive(run)) forward(run, nodeId, event);
  });
  const ok = await finishSend(run, nodeId, startedAt, before, result);
  if (!ok) return;
  releaseRunnerIfIdle(run, nodeId);
  pump(run);
}

async function resendAgent(run: RunRecord, nodeId: string, retryCount: number): Promise<void> {
  const step = run.steps.find((item): item is AgentStep => item.kind === "agent" && item.nodeId === nodeId);
  const instruction = await readAgentInstruction(resolveAgentPath(run.cwd, step?.agentPath ?? ""));
  if (!isActive(run)) return;
  if (!instruction.ok) {
    await failNode(run, nodeId, instruction.message, retryCount);
    return;
  }
  emit(run, "node-status", { nodeId, status: "redoing", retryCount, elapsedMs: 0 });
  const startedAt = Date.now();
  const before = await snapshotFiles(run.cwd);
  const runner = run.runners.get(nodeId);
  if (!runner) {
    await failNode(run, nodeId, "Runner is not available", retryCount);
    return;
  }
  // The runner already received the catalog on its first prompt. Redo sends the file body only.
  const result = await runner.send(instruction.text, (event) => {
    if (isActive(run)) forward(run, nodeId, event);
  });
  const ok = await finishSend(run, nodeId, startedAt, before, result, retryCount);
  if (!ok) return;
  pump(run);
}

async function failNode(run: RunRecord, nodeId: string, message: string, retryCount?: number): Promise<void> {
  if (!isActive(run)) return;
  run.status = "error";
  setNodeStatus(run, nodeId, "error");
  emit(run, "node-status", statusPayload(nodeId, "error", 0, retryCount));
  emit(run, "error", { nodeId, message: publicError(message, run) });
  await disposeAll(run);
}

async function ensureRunner(run: RunRecord, step: AgentStep): Promise<CursorAgentRunner> {
  const existing = run.runners.get(step.nodeId);
  if (existing) return existing;
  const runner = run.createRunner();
  run.runners.set(step.nodeId, runner);
  const selection = await resolveRunSelection(run, step);
  await runner.start({
    apiKey: run.apiKey,
    cwd: run.cwd,
    modelId: step.modelId,
    effort: selection.effort,
    effortParamId: selection.effortParamId,
    mcpServers: run.mcpServers,
  });
  // The run may have failed or stopped while this runner was starting.
  if (!isActive(run)) await disposeOne(run, step.nodeId);
  return runner;
}

async function resolveRunSelection(
  run: RunRecord,
  step: AgentStep,
): Promise<{ effort: string; effortParamId: string }> {
  const chosen = step.effort.trim();
  const storedParam = step.effortParamId.trim();
  if (chosen && storedParam) return { effort: chosen, effortParamId: storedParam };
  const catalog = await modelCatalogForRun(run);
  const match = catalog.find((model) => model.id === step.modelId);
  const catalogParam = match?.effortParamId.trim() ?? "";
  if (chosen) return { effort: chosen, effortParamId: storedParam || catalogParam || "effort" };
  if (!match || match.effort.length === 0) return { effort: "", effortParamId: "" };
  return {
    effort: defaultEffort(match.effort),
    effortParamId: storedParam || catalogParam || "effort",
  };
}

async function modelCatalogForRun(run: RunRecord): Promise<ListedModel[]> {
  if (run.modelCatalog) return run.modelCatalog;
  if (!run.modelCatalogTask) {
    run.modelCatalogTask = listModels(run.apiKey)
      .then((models) => {
        run.modelCatalog = models;
        return models;
      })
      .catch(() => {
        const empty: ListedModel[] = [];
        run.modelCatalog = empty;
        return empty;
      });
  }
  return run.modelCatalogTask;
}

/** Drop an agent's runner once no human can still ask it for a redo. */
function releaseRunnerIfIdle(run: RunRecord, nodeId: string): void {
  if (canDispose(run.schedule, nodeId)) void disposeOne(run, nodeId);
}

async function disposeOne(run: RunRecord, nodeId: string): Promise<void> {
  const runner = run.runners.get(nodeId);
  if (!runner) return;
  run.runners.delete(nodeId);
  try {
    await runner.dispose();
  } catch {
    // The process is dropping the agent either way.
  }
}

/** Cancel in-flight SDK runs, then dispose. Does not wait for send() to settle. */
async function cancelRunners(run: RunRecord): Promise<void> {
  const runners = [...run.runners.values()];
  await Promise.all(
    runners.map(async (runner) => {
      try {
        await runner.cancel();
      } catch {
        // dispose still drops the agent
      }
    }),
  );
  await disposeAll(run);
}

/** Dispose every runner. In-flight sends end and their late results are ignored. */
async function disposeAll(run: RunRecord): Promise<void> {
  await Promise.all([...run.runners.keys()].map((nodeId) => disposeOne(run, nodeId)));
}

async function finishSend(
  run: RunRecord,
  nodeId: string,
  startedAt: number,
  before: Map<string, number>,
  result: SendResult,
  retryCount?: number,
): Promise<boolean> {
  if (!isActive(run)) return false;
  const after = await snapshotFiles(run.cwd);
  if (!isActive(run)) return false;
  const hits = diffSnapshots(before, after, nodeId);
  for (const hit of hits) {
    const prefixed = { path: `${run.artifactPrefix}/${hit.path}`, agentNodeId: hit.agentNodeId };
    run.artifacts.push(prefixed);
    emit(run, "artifact", { path: prefixed.path, agentNodeId: prefixed.agentNodeId });
  }
  run.artifactPaths = run.artifacts.map((hit) => hit.path);
  const elapsedMs = Date.now() - startedAt;
  if (result.failure !== "none" || result.status === "error") {
    run.status = "error";
    setNodeStatus(run, nodeId, "error");
    emit(run, "node-status", statusPayload(nodeId, "error", elapsedMs, retryCount));
    emit(run, "error", { nodeId, message: publicError(result.error || "Run failed", run) });
    await disposeAll(run);
    return false;
  }
  run.outputs[nodeId] = result.text;
  setNodeStatus(run, nodeId, "done");
  emit(run, "node-status", statusPayload(nodeId, "done", elapsedMs, retryCount));
  return true;
}

async function failRun(run: RunRecord, error: unknown, nodeId?: string): Promise<void> {
  if (!isActive(run)) return;
  const message = publicError(error instanceof Error ? error.message : "Run failed", run);
  run.status = "error";
  if (nodeId) {
    setNodeStatus(run, nodeId, "error");
    emit(run, "node-status", { nodeId, status: "error", elapsedMs: 0 });
  }
  emit(run, "error", nodeId ? { nodeId, message } : { message });
  await disposeAll(run);
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

/** One block per connected input: agent name and id, and whether a human approved it. */
function upstreamBlocks(run: RunRecord, agentId: string): { heading: string; text: string }[] {
  return upstreamFor(run.schedule, run.outputs, agentId).map((item) => {
    const step = run.steps.find((candidate) => candidate.nodeId === item.nodeId);
    const name = step?.kind === "agent" && step.agentName ? step.agentName : "Agent";
    const approved = item.viaHumanId ? ", approved in human review" : "";
    return { heading: `${name} (node ${item.nodeId}${approved})`, text: item.text };
  });
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

function withUpstream(prompt: string, prior: { heading: string; text: string }[]): string {
  if (prior.length === 0) return prompt;
  const blocks = prior.map((item) => `### ${item.heading}\n${item.text}`).join("\n\n");
  const section = `## Upstream\n\n${blocks}`;
  const trimmed = prompt.trimEnd();
  return trimmed ? `${trimmed}\n\n${section}` : section;
}

function retireResumable(pipelineId: string): void {
  for (const run of runs.values()) {
    if (run.artifactPrefix === pipelineId && run.status === "stopped" && run.resumable) {
      run.resumable = false;
    }
  }
}

function findLive(pipelineId: string): RunRecord | undefined {
  for (const run of runs.values()) {
    if (run.artifactPrefix === pipelineId && isActive(run)) return run;
  }
  return undefined;
}

function findResumable(pipelineId: string): RunRecord | undefined {
  for (const run of runs.values()) {
    if (run.artifactPrefix === pipelineId && run.status === "stopped" && run.resumable) return run;
  }
  return undefined;
}

function continueRun(run: RunRecord, options: RunLaunch): void {
  run.steps = options.steps;
  setSchedule(run, {
    steps: options.steps.map((step) => ({ kind: step.kind, nodeId: step.nodeId, inputs: step.inputs })),
    nodeStatus: run.schedule.nodeStatus,
    retryCounts: run.schedule.retryCounts,
  });
  run.apiKey = options.apiKey;
  run.cwd = options.cwd;
  run.catalog = options.catalog;
  run.mcpServers = options.mcpServers.map(copyMcpConfig);
  if (options.createRunner) run.createRunner = options.createRunner;
  run.resumable = false;
  run.status = "running";
  // Fresh log so a reopened stream does not replay the old stopped event.
  run.events = [];
  emitSnapshot(run);
  pump(run);
}

function applyRestore(run: RunRecord, restore: RunRestore): void {
  const nodeStatus: Record<string, NodeStatus> = {};
  for (const step of run.steps) nodeStatus[step.nodeId] = parkedStatus(restore.nodeStatus[step.nodeId]);
  const retryCounts: Record<string, number> = {};
  for (const [id, count] of Object.entries(restore.retryCounts)) {
    if (typeof count === "number" && Number.isFinite(count)) retryCounts[id] = count;
  }
  setSchedule(run, { ...run.schedule, nodeStatus, retryCounts });
  const outputs: Record<string, string> = {};
  for (const step of run.steps) {
    if (nodeStatus[step.nodeId] !== "done") continue;
    const text = restore.outputs[step.nodeId];
    if (typeof text === "string") outputs[step.nodeId] = text;
  }
  run.outputs = outputs;
  run.artifacts = restore.artifacts.map((hit) => ({ path: hit.path, agentNodeId: hit.agentNodeId }));
  run.artifactPaths = run.artifacts.map((hit) => hit.path);
}

function parkedStatus(status: NodeStatus | undefined): NodeStatus {
  if (status === undefined || status === "running" || status === "redoing") return "idle";
  return status;
}

function emitSnapshot(run: RunRecord): void {
  for (const step of run.steps) {
    const status = run.schedule.nodeStatus[step.nodeId] ?? "idle";
    emit(run, "node-status", statusPayload(step.nodeId, status, 0, run.schedule.retryCounts[step.nodeId]));
  }
  for (const hit of run.artifacts) {
    emit(run, "artifact", { path: hit.path, agentNodeId: hit.agentNodeId });
  }
  for (const step of run.steps) {
    if (run.schedule.nodeStatus[step.nodeId] !== "done") continue;
    const text = run.outputs[step.nodeId];
    if (!text) continue;
    emit(run, "assistant", { nodeId: step.nodeId, text });
  }
}

function checkpointFrom(run: RunRecord): RunCheckpoint {
  const nodeStatus: Record<string, NodeStatus> = {};
  for (const step of run.steps) {
    nodeStatus[step.nodeId] = parkedStatus(run.schedule.nodeStatus[step.nodeId]);
  }
  const outputs: Record<string, string> = {};
  for (const step of run.steps) {
    if (nodeStatus[step.nodeId] !== "done") continue;
    const text = run.outputs[step.nodeId];
    if (typeof text === "string") outputs[step.nodeId] = text;
  }
  const retryCounts: Record<string, number> = {};
  for (const [id, count] of Object.entries(run.schedule.retryCounts)) {
    if (typeof count === "number" && Number.isFinite(count)) retryCounts[id] = count;
  }
  return {
    version: 1,
    pipelineId: run.artifactPrefix,
    stoppedAt: new Date().toISOString(),
    nodeStatus,
    retryCounts,
    outputs,
    artifacts: run.artifacts.map((hit) => ({ path: hit.path, agentNodeId: hit.agentNodeId })),
    fingerprint: pipelineFingerprint(run.steps),
  };
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
