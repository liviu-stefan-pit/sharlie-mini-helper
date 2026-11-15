/**
 * Responsibility: shared helpers for the real end-to-end workflow tests.
 * Inputs: the Cursor API key (environment, then Windows Credential Manager), the test kit, and workflow specs.
 * Outputs: a suite setup or skip reason, pipeline documents, recording runners, and a run watcher.
 * The key is never printed. These helpers use real tokens, so they run only through `npm run test:e2e`.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readApiKey } from "../../server/credentials";
import { describeAgentFile } from "../../src/modules/agents/agentFile";
import {
  createCursorAgentRunner,
  listModels,
  type CursorAgentRunner,
  type RunnerEvent,
  type RunnerStartOptions,
  type SendResult,
} from "../../src/modules/cursor/adapter";
import { resolvePipeline, type ExecutionStep } from "../../src/modules/graph/resolve";
import type { PipelineDocument, PipelineEdge, PipelineNode } from "../../src/modules/graph/types";
import { buildCatalogPrompt, scanLibrary } from "../../src/modules/library";
import { startRun, subscribeRun, type RunStatus, type RunStreamEvent } from "../../src/modules/runs/engine";

export const KIT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "kit");
export const DEFAULT_MODEL = "composer-2.5";
/** Per-test limit. A real agent send usually takes well under a minute. */
export const TEST_TIMEOUT_MS = 10 * 60_000;
const WAIT_MS = 5 * 60_000;

export type Suite = { apiKey: string; modelId: string; catalog: string };

/** Find the key and model and build the catalog from the kit. Returns a skip reason when there is no key. */
export async function prepareSuite(): Promise<{ suite: Suite } | { skip: string }> {
  const apiKey = await findApiKey();
  if (!apiKey) {
    return { skip: "No Cursor API key. Save one in the app settings or set CURSOR_API_KEY." };
  }
  const modelId = process.env.SHARLIE_E2E_MODEL?.trim() || DEFAULT_MODEL;
  const models = await listModels(apiKey);
  if (!models.some((model) => model.id === modelId)) {
    const ids = models.map((model) => model.id).join(", ");
    throw new Error(`Model "${modelId}" is not on this account. Set SHARLIE_E2E_MODEL to one of: ${ids}`);
  }
  const catalog = await kitCatalog();
  return { suite: { apiKey, modelId, catalog } };
}

async function findApiKey(): Promise<string> {
  const fromEnv = process.env.CURSOR_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    return (await readApiKey())?.trim() ?? "";
  } catch {
    return "";
  }
}

/** Scan the kit as a Cursor home with the real library scan, and enable every skill and rule. */
async function kitCatalog(): Promise<string> {
  const appLibraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-e2e-lib-"));
  try {
    const snapshot = await scanLibrary({ cursorHome: KIT_DIR, appLibraryRoot });
    assert.ok(snapshot.skills.length >= 5, "the kit skills were not scanned");
    assert.ok(snapshot.rules.length >= 4, "the kit rules were not scanned");
    const entry = (item: { title: string; description: string; path: string }) => ({
      title: item.title,
      description: item.description,
      path: item.path,
    });
    return buildCatalogPrompt(snapshot.skills.map(entry), snapshot.rules.map(entry));
  } finally {
    await fs.rm(appLibraryRoot, { recursive: true, force: true });
  }
}

export function kitAgentPath(file: string): string {
  return path.join(KIT_DIR, "agents", file);
}

export type NodeSpec = { id: string; agent: string } | { id: string; human: true };

/** Build a version 1 document like the canvas saves, with absolute agent paths into the kit. */
export async function buildWorkflow(
  id: string,
  modelId: string,
  nodes: NodeSpec[],
  edges: [string, string][],
): Promise<PipelineDocument> {
  const built: PipelineNode[] = [];
  for (const [index, spec] of nodes.entries()) {
    const position = { x: index * 260, y: 0 };
    if ("human" in spec) {
      built.push({ id: spec.id, type: "human", position, data: { status: "idle", artifactPaths: [] } });
      continue;
    }
    const agentPath = kitAgentPath(spec.agent);
    const described = await describeAgentFile(agentPath);
    built.push({
      id: spec.id,
      type: "agent",
      position,
      data: {
        modelId,
        effort: "",
        effortParamId: "",
        agentPath,
        agentName: described.name,
        status: "idle",
        elapsedMs: 0,
        retryCount: 0,
        tokens: {},
      },
    });
  }
  const builtEdges: PipelineEdge[] = edges.map(([source, target]) => ({
    id: `${source}->${target}`,
    source,
    target,
    kind: "execution",
  }));
  return { version: 1, id, name: id, nodes: built, edges: builtEdges, updatedAt: new Date().toISOString() };
}

type Gate = { promise: Promise<void>; release: () => void };

/** Wraps a real runner: records each prompt, and can hold a send until the test releases it. */
export class RecordingRunner implements CursorAgentRunner {
  readonly prompts: string[] = [];
  /** Prompts that actually reached the SDK. A held send that was disposed never gets here. */
  readonly delivered: string[] = [];
  private disposed = false;
  private readonly pending: Promise<unknown>[] = [];

  constructor(
    readonly nodeId: string,
    private readonly inner: CursorAgentRunner,
    private readonly gateFor: () => Gate | undefined,
  ) {}

  start(options: RunnerStartOptions): Promise<void> {
    return this.inner.start(options);
  }

  send(prompt: string, onEvent: (event: RunnerEvent) => void): Promise<SendResult> {
    this.prompts.push(prompt);
    const task = this.sendAfterGate(prompt, onEvent);
    this.pending.push(task);
    return task;
  }

  private async sendAfterGate(prompt: string, onEvent: (event: RunnerEvent) => void): Promise<SendResult> {
    const gate = this.gateFor();
    if (gate) await gate.promise;
    if (this.disposed) return { status: "error", text: "", error: "Runner disposed", failure: "startup" };
    this.delivered.push(prompt);
    return this.inner.send(prompt, onEvent);
  }

  cancel(): Promise<void> {
    return this.inner.cancel();
  }

  dispose(): Promise<void> {
    this.disposed = true;
    return this.inner.dispose();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Wait for every send this runner started to settle. */
  async settled(): Promise<void> {
    await Promise.allSettled(this.pending);
  }
}

/** Creates one recording runner per agent node and holds the gates. */
export class RunnerPool {
  private readonly runners = new Map<string, RecordingRunner>();
  private readonly gates = new Map<string, Gate>();

  readonly create = (nodeId: string): CursorAgentRunner => {
    const runner = new RecordingRunner(nodeId, createCursorAgentRunner(), () => this.gates.get(nodeId));
    this.runners.set(nodeId, runner);
    return runner;
  };

  /** Hold every send to this node until `release`. Call before the run starts. */
  hold(nodeId: string): void {
    let release = () => {};
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.gates.set(nodeId, { promise, release });
  }

  release(nodeId: string): void {
    this.gates.get(nodeId)?.release();
    this.gates.delete(nodeId);
  }

  releaseAll(): void {
    for (const nodeId of [...this.gates.keys()]) this.release(nodeId);
  }

  runner(nodeId: string): RecordingRunner {
    const runner = this.runners.get(nodeId);
    assert.ok(runner, `no runner was created for ${nodeId}`);
    return runner;
  }

  prompts(nodeId: string): string[] {
    return this.runners.get(nodeId)?.prompts ?? [];
  }

  async settled(): Promise<void> {
    await Promise.all([...this.runners.values()].map((runner) => runner.settled()));
  }
}

type StatusEvent = { nodeId: string; status: string; retryCount?: number };

/** Follows one run's events. Every wait fails fast when the run reports an error. */
export class RunWatch {
  readonly events: RunStreamEvent[] = [];
  private readonly wakers = new Set<() => void>();
  private readonly unsubscribe: () => void;

  constructor(readonly id: string) {
    const subscription = subscribeRun(id, (event) => this.push(event));
    assert.ok(subscription, "run not found");
    this.events.push(...subscription.events);
    this.unsubscribe = subscription.unsubscribe;
  }

  private push(event: RunStreamEvent): void {
    this.events.push(event);
    for (const wake of [...this.wakers]) wake();
  }

  close(): void {
    this.unsubscribe();
  }

  /** Current engine status of the run. */
  status(): RunStatus {
    const subscription = subscribeRun(this.id, () => {});
    assert.ok(subscription, "run not found");
    subscription.unsubscribe();
    return subscription.status;
  }

  /** Index of the first status event that matches, or -1. */
  indexOf(nodeId: string, status: string, from = 0): number {
    return this.events.findIndex(
      (event, index) => index >= from && isStatus(event) && event.data.nodeId === nodeId && event.data.status === status,
    );
  }

  count(nodeId: string, status: string): number {
    return this.statusEvents().filter((event) => event.nodeId === nodeId && event.status === status).length;
  }

  statusEvents(): StatusEvent[] {
    return this.events.filter(isStatus).map((event) => event.data);
  }

  has(event: string): boolean {
    return this.events.some((item) => item.event === event);
  }

  eventIndex(event: string): number {
    return this.events.findIndex((item) => item.event === event);
  }

  tokens(): number {
    let total = 0;
    for (const event of this.events) {
      if (event.event !== "token") continue;
      const data = event.data as { total?: unknown };
      if (typeof data.total === "number") total += data.total;
    }
    return total;
  }

  /** Wait until `check` holds. Rejects at once on a run error, and after the timeout. */
  async until(check: () => boolean, label: string, timeoutMs = WAIT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const failure = this.events.find((event) => event.event === "error");
      if (failure) assert.fail(`Run failed while waiting for ${label}: ${JSON.stringify(failure.data)}`);
      if (check()) return;
      const left = deadline - Date.now();
      if (left <= 0) assert.fail(`Timed out waiting for ${label}`);
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          this.wakers.delete(done);
          resolve();
        };
        const timer = setTimeout(done, Math.min(left, 1000));
        this.wakers.add(done);
      });
    }
  }
}

function isStatus(event: RunStreamEvent): event is { event: "node-status"; data: StatusEvent } {
  return event.event === "node-status";
}

export type Launched = { watch: RunWatch; pool: RunnerPool; cwd: string; steps: ExecutionStep[] };

/**
 * Resolve the document, then start it with the real runner in `<workspace>/<id>/`.
 * `prepare` runs before the start, so the test can hold nodes.
 */
export async function launch(
  suite: Suite,
  workspace: string,
  doc: PipelineDocument,
  prepare?: (pool: RunnerPool) => void,
): Promise<Launched> {
  const steps = resolvePipeline(doc);
  const cwd = path.join(workspace, doc.id);
  await fs.mkdir(cwd, { recursive: true });
  const pool = new RunnerPool();
  prepare?.(pool);
  const id = startRun({
    steps,
    apiKey: suite.apiKey,
    cwd,
    artifactPrefix: doc.id,
    catalog: suite.catalog,
    mcpServers: [],
    createRunner: pool.create,
  });
  return { watch: new RunWatch(id), pool, cwd, steps };
}

/**
 * Give each test its own temporary workspace. It is removed after a pass, and kept with its path
 * printed after a failure or when SHARLIE_E2E_KEEP=1.
 */
export async function withWorkspace(
  log: (message: string) => void,
  body: (workspace: string) => Promise<void>,
): Promise<void> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-e2e-"));
  let passed = false;
  try {
    await body(workspace);
    passed = true;
  } finally {
    if (passed && process.env.SHARLIE_E2E_KEEP !== "1") {
      // Disposed SDK agents can hold the folder open for a moment on Windows (EBUSY).
      try {
        await fs.rm(workspace, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
      } catch {
        log(`could not remove ${workspace}`);
      }
    } else {
      log(`workspace kept at ${workspace}`);
    }
  }
}

export async function readText(cwd: string, file: string): Promise<string> {
  try {
    return await fs.readFile(path.join(cwd, file), "utf8");
  } catch {
    assert.fail(`${file} was not written`);
  }
}

export async function exists(cwd: string, file: string): Promise<boolean> {
  try {
    await fs.access(path.join(cwd, file));
    return true;
  } catch {
    return false;
  }
}

/** The first non-empty line, without a BOM or markdown emphasis. */
export function firstLine(text: string): string {
  const line = text.replace(/^﻿/, "").split(/\r?\n/).find((item) => item.trim() !== "") ?? "";
  return line.replace(/[*_`#]/g, "").trim();
}

export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
