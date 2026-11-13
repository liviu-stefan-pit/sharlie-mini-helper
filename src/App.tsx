/**
 * Responsibility: interactive pipeline canvas and its chrome.
 * Inputs: local skills, saved pipelines, and graph edits.
 * Outputs: the top bar, React Flow board, inspector, and settings modal.
 */
import { useCallback, useEffect, useRef, useState } from "react";
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
import type { NodeKind, PipelineDocument, PipelineSummary } from "./modules/graph/types";
import { fetchPipeline, fetchPipelines, fetchSkills, savePipeline } from "./modules/canvas/api";
import { AgentNode } from "./modules/canvas/AgentNode";
import { HumanNode } from "./modules/canvas/HumanNode";
import { SkillNode } from "./modules/canvas/SkillNode";
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
import { Inspector } from "./modules/canvas/Inspector";
import { PatchContext } from "./modules/canvas/patch";
import { SettingsModal } from "./modules/canvas/SettingsModal";
import { SkillsContext } from "./modules/canvas/skillsContext";
import type { SkillSummary } from "./modules/skills/parseSkill";
import { TopBar } from "./modules/canvas/TopBar";
import { applyTheme, readTheme, type Theme } from "./modules/canvas/theme";

const nodeTypes = {
  agent: AgentNode,
  skill: SkillNode,
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
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [pipelines, setPipelines] = useState<PipelineSummary[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const spawn = useRef(0);
  const { screenToFlowPosition, getNodes, fitView } = useReactFlow();

  useEffect(() => {
    void fetchSkills()
      .then(setSkills)
      .catch(() => setSkills([]));
    void fetchPipelines()
      .then(setPipelines)
      .catch(() => setPipelines([]));
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
      if (source.type === "skill" && target.type !== "agent") return false;
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
      if (source.type === "skill" && target.type !== "agent") return;
      const kind = source.type === "skill" && target.type === "agent" ? "attachment" : "execution";
      const edge: FlowEdge = {
        id: `e-${crypto.randomUUID()}`,
        source: connection.source,
        target: connection.target,
        data: { kind },
        style: kind === "attachment" ? { strokeDasharray: "6 4" } : undefined,
      };
      setEdges((current) => addEdge(edge, current));
    },
    [getNodes, setEdges],
  );

  async function onSave() {
    setSaving(true);
    const id = currentId ?? makePipelineId(name);
    const doc: PipelineDocument = {
      version: 1,
      id,
      name: name.trim() || "Untitled",
      nodes: nodes.map((node) => toPipelineNode(node)),
      edges: edges.map((edge) => toPipelineEdge(edge)),
      updatedAt: new Date().toISOString(),
    };
    try {
      const saved = await savePipeline(doc);
      setCurrentId(saved.id);
      setName(saved.name);
      setPipelines(await fetchPipelines());
      setNotice({ tone: "ok", text: "Saved" });
    } catch (error) {
      setNotice({ tone: "err", text: error instanceof Error ? error.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  async function onLoad(id: string) {
    try {
      const doc = await fetchPipeline(id);
      setCurrentId(doc.id);
      setName(doc.name);
      setNodes(doc.nodes.map((node) => toFlowNode(node)));
      setEdges(doc.edges.map((edge) => toFlowEdge(edge)));
      setSelectedId(null);
      window.setTimeout(() => fitView({ padding: 0.2 }), 0);
    } catch (error) {
      setNotice({ tone: "err", text: error instanceof Error ? error.message : "Load failed" });
    }
  }

  function closeInspector() {
    setSelectedId(null);
    setNodes((current) => current.map((node) => ({ ...node, selected: false })));
  }

  const selected = nodes.find((node) => node.id === selectedId) ?? null;

  return (
    <PatchContext.Provider value={patchNode}>
      <SkillsContext.Provider value={skills}>
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
            theme={theme}
            onToggleTheme={() => {
              const next = theme === "dark" ? "light" : "dark";
              applyTheme(next);
              setTheme(next);
            }}
            onOpenSettings={() => setSettingsOpen(true)}
            notice={notice}
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
                <p className="text-sm text-zinc-400">Add an Agent, Skill, or Human node to start a pipeline.</p>
              </div>
            )}
            {selected && <Inspector node={selected} onClose={closeInspector} />}
          </div>
        </div>
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </SkillsContext.Provider>
    </PatchContext.Provider>
  );
}
