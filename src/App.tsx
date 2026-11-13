/**
 * Responsibility: interactive pipeline canvas and its chrome.
 * Inputs: saved pipelines and graph edits.
 * Outputs: the top bar, React Flow board, inspector, settings modal, and library modal.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from "@xyflow/react";
import type { AgentStatus, HumanStatus, NodeKind, PipelineDocument, PipelineSummary, WorkflowDependency } from "./modules/graph/types";
import {
  exportWorkflow,
  fetchModels,
  fetchPipeline,
  fetchPipelines,
  fetchWorkspace,
  postDecision,
  savePipeline,
  startRun,
  type WorkspaceStatus,
} from "./modules/canvas/api";
import { AgentNode } from "./modules/canvas/AgentNode";
import { HumanNode } from "./modules/canvas/HumanNode";
import {
  createNode,
  makePipelineId,
  toFlowEdge,
  toFlowNode,
  toPipelineEdge,
  toPipelineNode,
  type FlowEdge,
  type FlowNode,
} from "./modules/canvas/flow";
import { FilePreview } from "./modules/canvas/FilePreview";
import { Inspector } from "./modules/canvas/Inspector";
import { ModelsContext, type ModelChoice } from "./modules/canvas/modelsContext";
import { PatchContext } from "./modules/canvas/patch";
import { RunContext, type ReviewDecision } from "./modules/canvas/runContext";
import { ExportModal } from "./modules/canvas/ExportModal";
import { LibraryModal } from "./modules/canvas/LibraryModal";
import { SettingsModal } from "./modules/canvas/SettingsModal";
import { TopBar } from "./modules/canvas/TopBar";
import { WarningsModal } from "./modules/canvas/WarningsModal";
import { applyTheme, readTheme, type Theme } from "./modules/canvas/theme";

const nodeTypes = {
  agent: AgentNode,
  human: HumanNode,
};

export function App() {
  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  );
}

function Editor() {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);
  const [name, setName] = useState("Untitled");
  const [dependencies, setDependencies] = useState<WorkflowDependency[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [pipelines, setPipelines] = useState<PipelineSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [runPhase, setRunPhase] = useState<RunPhase>("idle");
  const [runId, setRunId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [tokenPill, setTokenPill] = useState({ run: 0, session: 0 });
  const [workspace, setWorkspace] = useState<WorkspaceStatus>({ path: null, valid: false });
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [warningLines, setWarningLines] = useState<string[]>([]);
  const workspaceReady = workspace.valid;
  const canExport = workspaceReady && runPhase === "idle";
  const spawn = useRef(0);
  const pinnedId = useRef<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const generationRef = useRef(0);
  const { screenToFlowPosition, getNodes, fitView } = useReactFlow();

  const loadModels = useCallback(() => {
    void fetchModels()
      .then((body) => {
        setModels(Array.isArray(body.models) ? body.models : []);
      })
      .catch(() => {
        setModels([]);
      });
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  useEffect(() => {
    return () => sourceRef.current?.close();
  }, []);

  const agentBusy = nodes.some(
    (node) => node.type === "agent" && (node.data.status === "running" || node.data.status === "redoing"),
  );
  useEffect(() => {
    if (!agentBusy) return;
    const timer = window.setInterval(() => {
      setNodes((current) => {
        let changed = false;
        const next = current.map((node) => {
          if (node.type !== "agent") return node;
          if (node.data.status !== "running" && node.data.status !== "redoing") return node;
          changed = true;
          return { ...node, data: { ...node.data, elapsedMs: node.data.elapsedMs + 1000 } };
        });
        return changed ? next : current;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [agentBusy, setNodes]);

  useEffect(() => {
    if (!workspaceReady) {
      setPipelines([]);
      return;
    }
    void fetchPipelines()
      .then(setPipelines)
      .catch(() => setPipelines([]));
  }, [workspaceReady, workspace.path]);

  useEffect(() => {
    void fetchWorkspace()
      .then(setWorkspace)
      .catch(() => {
        /* keep the default */
      });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const patchNode = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      setNodes((current) =>
        current.map((node) => (node.id === id ? ({ ...node, data: { ...node.data, ...patch } } as FlowNode) : node)),
      );
    },
    [setNodes],
  );

  const addNode = useCallback(
    (kind: NodeKind) => {
      const step = spawn.current;
      spawn.current += 1;
      const center = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      const offset = (step % 6) * 28;
      setNodes((current) => [...current, createNode(kind, { x: center.x + offset, y: center.y + offset })]);
    },
    [screenToFlowPosition, setNodes],
  );

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      if (!connection.source || !connection.target) return false;
      const all = getNodes();
      const source = all.find((node) => node.id === connection.source);
      const target = all.find((node) => node.id === connection.target);
      if (!source || !target) return false;
      return true;
    },
    [getNodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const all = getNodes();
      const source = all.find((node) => node.id === connection.source);
      const target = all.find((node) => node.id === connection.target);
      if (!source || !target) return;
      const edge: FlowEdge = {
        id: `e-${crypto.randomUUID()}`,
        source: connection.source,
        target: connection.target,
        data: { kind: "execution" },
      };
      setEdges((current) => addEdge(edge, current));
    },
    [getNodes, setEdges],
  );

  function onWorkspaceChanged(status: WorkspaceStatus) {
    setWorkspace(status);
    pinnedId.current = null;
    setCurrentId(null);
    setName("Untitled");
    setDependencies([]);
    setNodes([]);
    setEdges([]);
    setSelectedId(null);
    setPreviewFile(null);
    generationRef.current += 1;
    sourceRef.current?.close();
    sourceRef.current = null;
    setRunPhase("idle");
    setRunId(null);
  }

  function pipelineDocument(): PipelineDocument {
    const id = currentId ?? pinnedId.current ?? makePipelineId(name);
    if (!currentId) {
      pinnedId.current = id;
      setCurrentId(id);
    }
    return {
      version: 1,
      id,
      name: name.trim() || "Untitled",
      nodes: nodes.map((node) => toPipelineNode(node)),
      edges: edges.map((edge) => toPipelineEdge(edge)),
      updatedAt: new Date().toISOString(),
      dependencies,
    };
  }

  async function onSave(): Promise<string | null> {
    setSaving(true);
    const doc = pipelineDocument();
    try {
      const saved = await savePipeline(doc);
      setCurrentId(saved.id);
      setName(saved.name);
      setPipelines(await fetchPipelines());
      setNotice({ tone: "ok", text: "Saved" });
      return saved.id;
    } catch (error) {
      setNotice({ tone: "err", text: error instanceof Error ? error.message : "Save failed" });
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function onExport(includeFiles: boolean) {
    setExportBusy(true);
    try {
      const savedId = await onSave();
      if (!savedId) return;
      const result = await exportWorkflow(savedId, includeFiles);
      if ("cancelled" in result) return;
      const fileName = result.path.split(/[/\\]/).filter(Boolean).pop() ?? result.path;
      setNotice({ tone: "ok", text: `Exported to ${fileName}` });
      if (result.warnings.length > 0) {
        setWarningLines(result.warnings);
        setWarningsOpen(true);
      }
    } catch (error) {
      setNotice({ tone: "err", text: error instanceof Error ? error.message : "Export failed" });
    } finally {
      setExportBusy(false);
      setExportOpen(false);
    }
  }

  async function onLoad(id: string) {
    try {
      const doc = await fetchPipeline(id);
      pinnedId.current = null;
      setCurrentId(doc.id);
      setName(doc.name);
      setDependencies(doc.dependencies ?? []);
      setNodes(doc.nodes.map((node) => toFlowNode(node)));
      setEdges(doc.edges.map((edge) => toFlowEdge(edge)));
      setSelectedId(null);
      window.setTimeout(() => fitView({ padding: 0.2 }), 0);
    } catch (error) {
      setNotice({ tone: "err", text: error instanceof Error ? error.message : "Load failed" });
    }
  }

  function onRun() {
    if (runPhase !== "idle") return;
    setRunPhase("connecting");
    setNodes((current) =>
      current.map((node) => {
        if (node.type === "agent") {
          return {
            ...node,
            data: { ...node.data, status: "idle", elapsedMs: 0, retryCount: 0, lastOutput: "", tokens: {} },
          };
        }
        if (node.type === "human") {
          return { ...node, data: { ...node.data, status: "idle", artifactPaths: [] } };
        }
        return node;
      }),
    );
    setEdges((current) => current.map((edge) => (edge.animated ? { ...edge, animated: false } : edge)));
    const doc = pipelineDocument();
    void startRun(doc)
      .then(({ id }) => {
        setRunId(id);
        openRunStream(id, streamDeps());
      })
      .catch((error: unknown) => {
        setRunPhase("idle");
        setNotice({ tone: "err", text: error instanceof Error ? error.message : "Run failed" });
      });
  }

  const streamDeps = useCallback(
    (): StreamDeps => ({
      setNodes,
      setEdges,
      setNotice,
      setRunPhase,
      setTokenPill,
      sourceRef,
      generationRef,
    }),
    [setEdges, setNodes],
  );

  const submitDecision = useCallback(
    (decision: ReviewDecision) => {
      if (!runId) return;
      const id = runId;
      void postDecision(id, decision)
        .then(() => {
          openRunStream(id, streamDeps());
        })
        .catch((error: unknown) => {
          setNotice({ tone: "err", text: error instanceof Error ? error.message : "Decision failed" });
        });
    },
    [runId, streamDeps],
  );

  const openPreview = useCallback((filePath: string) => {
    setPreviewFile(filePath);
  }, []);

  const runActions = useMemo(
    () => ({ runId, decide: submitDecision, previewPath: openPreview }),
    [openPreview, runId, submitDecision],
  );

  function closeInspector() {
    setSelectedId(null);
    setNodes((current) => current.map((node) => ({ ...node, selected: false })));
  }

  const selected = nodes.find((node) => node.id === selectedId) ?? null;

  return (
    <PatchContext.Provider value={patchNode}>
      <RunContext.Provider value={runActions}>
      <ModelsContext.Provider value={models}>
        <div className="flex h-screen flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
          <TopBar
            name={name}
            onNameChange={setName}
            onAdd={addNode}
            onSave={() => void onSave()}
            saving={saving}
            pipelines={pipelines}
            currentId={currentId}
            onLoad={(id) => void onLoad(id)}
            onExport={() => setExportOpen(true)}
            canExport={canExport}
            theme={theme}
            onToggleTheme={() => {
              const next = theme === "dark" ? "light" : "dark";
              applyTheme(next);
              setTheme(next);
            }}
            onOpenLibrary={() => setLibraryOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            workspaceName={workspaceFolderName(workspace.path)}
            workspaceValid={workspace.valid}
            workspacePath={workspace.path}
            workspaceError={workspace.error}
            workspaceReady={workspaceReady}
            notice={notice}
            runPhase={runPhase}
            onRun={onRun}
            runTotal={tokenPill.run}
            sessionTotal={tokenPill.session}
          />
          <div className="relative min-h-0 flex-1">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onNodeClick={(_, node) => setSelectedId(node.id)}
              onPaneClick={() => setSelectedId(null)}
              onSelectionChange={({ nodes: selectedNodes }) => {
                setSelectedId(selectedNodes.length ? (selectedNodes[selectedNodes.length - 1]?.id ?? null) : null);
              }}
              fitView
              fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
              colorMode={theme}
              proOptions={{ hideAttribution: false }}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
            {nodes.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p className="text-sm text-zinc-400">
                  {workspaceReady
                    ? "Add an Agent or Human node to start a pipeline."
                    : "Select a workspace in Settings to start."}
                </p>
              </div>
            )}
            {selected && <Inspector node={selected} onClose={closeInspector} />}
            {previewFile && (
              <FilePreview filePath={previewFile} alongside={Boolean(selected)} onClose={() => setPreviewFile(null)} />
            )}
          </div>
        </div>
        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onKeySaved={loadModels}
          onWorkspaceChanged={onWorkspaceChanged}
        />
        <LibraryModal open={libraryOpen} onClose={() => setLibraryOpen(false)} />
        <ExportModal open={exportOpen} busy={exportBusy} onClose={() => setExportOpen(false)} onExport={(includeFiles) => void onExport(includeFiles)} />
        <WarningsModal open={warningsOpen} title="Exported with warnings" warnings={warningLines} onClose={() => setWarningsOpen(false)} />
      </ModelsContext.Provider>
      </RunContext.Provider>
    </PatchContext.Provider>
  );
}

type RunPhase = "idle" | "connecting" | "running" | "paused";

const AGENT_STATUSES = new Set<AgentStatus>(["idle", "running", "redoing", "done", "error"]);
const HUMAN_STATUSES = new Set<HumanStatus>(["idle", "waiting", "approved", "declined"]);

type StreamDeps = {
  setNodes: Dispatch<SetStateAction<FlowNode[]>>;
  setEdges: Dispatch<SetStateAction<FlowEdge[]>>;
  setNotice: Dispatch<SetStateAction<{ tone: "ok" | "err"; text: string } | null>>;
  setRunPhase: Dispatch<SetStateAction<RunPhase>>;
  setTokenPill: Dispatch<SetStateAction<{ run: number; session: number }>>;
  sourceRef: { current: EventSource | null };
  generationRef: { current: number };
};

function openRunStream(id: string, deps: StreamDeps) {
  const generation = deps.generationRef.current + 1;
  deps.generationRef.current = generation;
  deps.sourceRef.current?.close();
  const source = new EventSource(`/api/runs/${encodeURIComponent(id)}/events`);
  deps.sourceRef.current = source;
  deps.setRunPhase("running");
  let phase: "live" | "paused" | "idle" = "live";
  const active = () => generation === deps.generationRef.current;

  const release = () => {
    source.close();
    if (deps.sourceRef.current === source) deps.sourceRef.current = null;
  };

  deps.setNodes((current) =>
    current.map((node) => (node.type === "agent" ? { ...node, data: { ...node.data, lastOutput: "" } } : node)),
  );

  source.addEventListener("node-status", (event) => {
    if (!active()) return;
    const payload = readPayload<{ nodeId?: string; status?: string; elapsedMs?: number; retryCount?: number }>(event);
    if (!payload?.nodeId || !payload.status) return;
    const status = payload.status;
    const elapsedMs = typeof payload.elapsedMs === "number" ? payload.elapsedMs : 0;
    if (status === "running" || status === "redoing") {
      phase = "live";
      deps.setRunPhase("running");
    }
    deps.setNodes((current) =>
      current.map((node) => {
        if (node.id !== payload.nodeId) return node;
        if (node.type === "agent" && isAgentStatus(status)) {
          const retryCount = typeof payload.retryCount === "number" ? payload.retryCount : node.data.retryCount;
          const lastOutput = status === "redoing" ? "" : node.data.lastOutput;
          return { ...node, data: { ...node.data, status, elapsedMs, retryCount, lastOutput } };
        }
        if (node.type === "human" && isHumanStatus(status)) {
          return { ...node, data: { ...node.data, status } };
        }
        return node;
      }),
    );
    deps.setEdges((current) => {
      let changed = false;
      const next = current.map((edge) => {
        const animated =
          edge.data?.kind === "execution" &&
          edge.target === payload.nodeId &&
          (status === "running" || status === "redoing");
        if (Boolean(edge.animated) === animated) return edge;
        changed = true;
        return { ...edge, animated };
      });
      return changed ? next : current;
    });
  });

  source.addEventListener("token", (event) => {
    if (!active()) return;
    const payload = readPayload<{
      nodeId?: string;
      input?: number;
      output?: number;
      total?: number;
      runTotal?: number;
      sessionTotal?: number;
    }>(event);
    if (!payload?.nodeId) return;
    if (typeof payload.runTotal === "number" && typeof payload.sessionTotal === "number") {
      deps.setTokenPill({ run: payload.runTotal, session: payload.sessionTotal });
    }
    deps.setNodes((current) =>
      current.map((node) => {
        if (node.type !== "agent" || node.id !== payload.nodeId) return node;
        const tokens = { ...node.data.tokens };
        if (typeof payload.input === "number") tokens.input = payload.input;
        if (typeof payload.output === "number") tokens.output = payload.output;
        if (typeof payload.total === "number") tokens.total = payload.total;
        return { ...node, data: { ...node.data, tokens } };
      }),
    );
  });

  source.addEventListener("assistant", (event) => {
    if (!active()) return;
    const payload = readPayload<{ nodeId?: string; text?: string }>(event);
    if (!payload?.nodeId || typeof payload.text !== "string") return;
    deps.setNodes((current) =>
      current.map((node) => {
        if (node.type !== "agent" || node.id !== payload.nodeId) return node;
        return { ...node, data: { ...node.data, lastOutput: `${node.data.lastOutput ?? ""}${payload.text}` } };
      }),
    );
  });

  source.addEventListener("artifact", (event) => {
    if (!active()) return;
    const payload = readPayload<{ path?: string }>(event);
    if (!payload?.path) return;
    const artifactPath = payload.path;
    deps.setNodes((current) =>
      current.map((node) => {
        if (node.type !== "human" || node.data.artifactPaths.includes(artifactPath)) return node;
        return { ...node, data: { ...node.data, artifactPaths: [...node.data.artifactPaths, artifactPath] } };
      }),
    );
  });

  source.addEventListener("paused", () => {
    if (!active()) return;
    phase = "paused";
    deps.setRunPhase("paused");
  });
  source.addEventListener("done", () => {
    if (!active()) return;
    phase = "idle";
    deps.setRunPhase("idle");
    release();
  });
  source.addEventListener("stopped", () => {
    if (!active()) return;
    phase = "idle";
    deps.setRunPhase("idle");
    release();
  });
  source.addEventListener("error", (event) => {
    if (!active()) return;
    if (event instanceof MessageEvent && typeof event.data === "string") {
      const payload = parseJson<{ message?: string }>(event.data);
      deps.setNotice({ tone: "err", text: payload?.message || "Run failed" });
      phase = "idle";
      deps.setRunPhase("idle");
      release();
      return;
    }
    if (phase === "paused" || phase === "idle") {
      release();
      return;
    }
    deps.setNotice({ tone: "err", text: "Run stream closed" });
    phase = "idle";
    deps.setRunPhase("idle");
    release();
  });
}

function isAgentStatus(status: string): status is AgentStatus {
  return AGENT_STATUSES.has(status as AgentStatus);
}

function isHumanStatus(status: string): status is HumanStatus {
  return HUMAN_STATUSES.has(status as HumanStatus);
}

function readPayload<T>(event: Event): T | null {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string") return null;
  return parseJson<T>(event.data);
}

function workspaceFolderName(filePath: string | null): string | null {
  if (!filePath) return null;
  const parts = filePath.split(/[/\\]/);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part) return part;
  }
  return null;
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
