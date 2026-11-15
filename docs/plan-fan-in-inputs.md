# Plan: Agent nodes with several inputs (fan-in) and a dependency-driven run

Status: implemented. Decisions recorded in section 4. One refinement during implementation: Decline is always accepted, even while a reviewed agent is still running, because it stops the whole run anyway.

## 0. Why this is needed

The canvas already lets you draw several edges into one agent node, and `resolvePipeline` already accepts it (it is a plain topological sort). The trouble is in what happens at run time:

| Today | Problem with several inputs |
| --- | --- |
| The engine walks one flat list (`steps`) in topological order, one node at a time. | Two independent branches never run at the same time. A branch waiting on a human blocks every other branch, even ones that do not depend on that human. |
| `upstreamTexts` appends the output of **every earlier agent in the list**. | An agent receives text from branches it is not connected to, and nothing at all "from" a human input. It does not get "the info from the connected nodes". |
| Redo uses `earlierAgent`, the agent just before the human **in the flat list**. | With branches, that can be an agent on a different branch, not the one the human reviewed. With a human that has two inputs, it redoes only one. |
| One runner at a time (`run.runner`), disposed as soon as another node starts. | Redo needs the reviewed agent's runner to still exist. With branches it may already be gone (`Runner is not available`). |
| Every artifact is added to **every** human node on the canvas. | A human sees files from branches it is not reviewing. |
| `POST /api/runs/:id/decision` has no node id. | With branches, two humans can be waiting at once. |

So the work is: make readiness, inputs, redo, and artifacts follow the edges, not the flat order.

## 1. Target behaviour

### 1.1 Inputs and readiness

- The **inputs** of a node are the distinct sources of the edges that point into it. Duplicate edges between the same two nodes count once.
- A node is **satisfied** when:
  - agent: status `done`;
  - human: status `approved`.
- A node is **ready** when it has not started yet and every input is satisfied. A node with no inputs is ready at the start.
- An agent starts only when it is ready. That is the "waits for all connected nodes" rule. There is no partial start.
- A ready human node goes to `waiting` immediately. It does not stop other branches.

Example (diamond with a review):

```
A ──► B ──────────────┐
│                     ▼
└───► C ──► H(review) ──► D
```

A starts. When A is done, B and C start (in parallel, see 1.3). H waits once C is done. D starts only when B is `done` **and** H is `approved`. While H waits, B keeps running.

### 1.2 What text an agent receives

The first send is still `catalog + agent file body + upstream section`. Only the upstream section changes:

- One block per **direct input**, in a stable order (the inputs' topological order, ties by id).
- Agent input `A`: A's latest output (after any redo, the redo output).
- Human input `H`: the latest outputs of the agents H reviewed ("review sources", see 1.4), labelled as approved by that human. If the same agent reaches D through two paths, it appears once.
- Agents that are not connected (directly, or directly through a human) are **not** included. In `A → B → C`, C gets only B (today it also gets A).
- The block heading uses the agent name instead of the raw node id, e.g. `### Writer (agent 3f2a…)`. Today it is only the UUID, which tells the model nothing once there are several blocks.

### 1.3 Scheduling: parallel branches

Independent ready agents run **at the same time**, up to a fixed cap (`MAX_PARALLEL_AGENTS = 3`, a constant in the engine, not a setting). Start order among ready nodes is the topological order with ties by id, so runs stay deterministic.

Consequences that the plan handles:

- **One runner per agent node** (`runners: Map<nodeId, CursorAgentRunner>`) instead of a single `run.runner`.
- A runner is disposed when its agent is done **and** no human that reviews it can still ask for a redo (every such human is `approved` or `declined`, or there is none). Everything is disposed when the run ends.
- **Shared folder.** All agents still use the workflow folder as `cwd`. Agents on parallel branches are expected to work on **different files**. Two parallel agents editing the same file is a user error in the workflow design. The app does not lock or detect it. The docs say so.
- **Artifacts while agents overlap.** Each agent still diffs the folder before and after its own send. Because parallel agents touch different files, a changed file is attributed by matching it to the agent whose send window contains the change. If two agents' windows overlap, a file changed in the overlap is listed under both (we cannot tell which wrote it). The docs say so.

### 1.4 Human nodes with several inputs, and Redo

- A human may also have several inputs. It waits until all are satisfied, same rule as an agent.
- **Review sources** of a human = the nearest agents behind it, walking back through other human nodes. `A → H1 → H2`: H2's review source is A.
- **Approve**: the human becomes `approved`; its successors are re-checked for readiness.
- **Redo** has two forms. Both re-send the agent file body only (no catalog, no feedback wrapper — unchanged rule) on that agent's own runner, bump its retry count, put the human to `idle` while the agents redo, and back to `waiting` when they are all done.
  - **Redo all**: re-sends every review source of the human, in parallel.
  - **Redo one**: re-sends only the review source the user picked, because that one did not perform well. The others keep their current output.
  - A human with exactly one review source shows a single **Redo** button (the two forms are the same).
- A decision is **rejected** while any review source of that human is `running` or `redoing` (`Upstream agent is still running`). That also prevents one agent being re-sent twice at once when two humans review it.
- **Decline**: stops the whole run (`stopped`), disposes all runners, cancels in-flight sends. Same as today.
- A human with no agent behind it: Redo rejects `No upstream agent` (same message as today). Approve works.
- Redo one with an agent that is not a review source of that human rejects `Agent is not reviewed by this node`.

Known edge case, documented and allowed: `A → B` and `A → H → C`. B may consume A's output before H asks for a redo of A. B is not re-run. B depended on A directly, not on H's approval.

### 1.5 Run status

| Run status | Meaning now |
| --- | --- |
| `running` | At least one agent is running or redoing. Humans may also be waiting. |
| `paused` | Nothing is running and at least one human is waiting. `paused` is emitted only then. |
| `done` | Every agent is `done` and every human is `approved`. |
| `stopped` | A human declined. |
| `error` | An agent failed. No new node starts; in-flight sends are cancelled by disposing their runners. |

Node status sets do not change: agent `idle | running | redoing | done | error`, human `idle | waiting | approved | declined`.

### 1.6 Canvas

- `isValidConnection` refuses a self-loop, a duplicate edge, and an edge that would create a cycle (today the cycle is only caught when you press Run).
- Decisions send the human node's id: `POST /api/runs/:id/decision` body `{ decision, nodeId, redoNodeId? }`. `redoNodeId` is only for Redo one; without it, Redo means Redo all.
- Human card with two or more review sources: **Approve**, **Redo all**, **Redo one ▾**, **Decline**. Redo one opens a small list of the reviewed agents by name (the same names used in the upstream headings); picking one sends the decision. With one review source the card keeps today's three buttons.
- An artifact event is added only to human nodes whose review sources include the event's `agentNodeId` (the event already carries it).
- A human can be decided while the run is still `running` (another branch busy). The Approve / Redo / Decline buttons already key off the node's own `waiting` status, so they work as they are.
- Small hint on an agent card while a run is active and the agent is `idle`: "Waiting for 2 of 3 inputs", computed on the client from the edges and the node statuses already in the canvas. No new server event.

## 2. Design of the code

### 2.1 `src/modules/graph/resolve.ts` (pure, still no file reads)

- Every `ExecutionStep` gains `inputs: string[]` (distinct source ids, sorted by the step order).
- The agent step gains `agentName: string` (for upstream headings).
- Order, cycle check, duplicate-id check, attachment-edge check, and `Model id is empty` stay as they are.
- New pure helper in the graph module, used by both the engine and the canvas:
  - `reviewSources(steps, humanId): string[]` — nearest agents behind a human, through other humans.
  - `wouldCreateCycle(edges, source, target): boolean` — for the canvas.

### 2.2 New pure module `src/modules/runs/schedule.ts`

All decisions about "what can start now" live here, with no SDK, no files, no timers — so they are fully unit-testable.

```ts
type NodeState = AgentStatus | HumanStatus;            // per node id
type ScheduleState = {
  steps: ExecutionStep[];                               // from resolvePipeline
  nodeStatus: Record<string, NodeState>;
  retryCounts: Record<string, number>;
};

readyNodes(state): string[]                            // in step order
runStatus(state): "running" | "paused" | "done"        // ignores error/stopped, which the engine sets
upstreamFor(state, outputs, agentId): { nodeId; label; text; viaHumanId? }[]
reviewersOf(state, agentId): string[]                  // humans whose review sources include agentId
canDispose(state, agentId): boolean
```

### 2.3 `src/modules/runs/humanGate.ts` (still pure)

Re-shaped to work on `ScheduleState` and a human node id instead of a `stepIndex`:

```ts
enterHuman(state, humanId): ScheduleState              // human -> waiting
applyHumanDecision(state, humanId, decision, redoNodeId?):   // redoNodeId only for Redo one
  { state, effect:
      | { type: "resume" }                             // approved; engine re-checks readiness
      | { type: "halt" }                               // declined
      | { type: "resend"; nodes: { nodeId; retryCount }[] }
      | { type: "reject"; message } }
```

Rejections: human not `waiting` (`Run is not paused` → renamed to `Node is not waiting for review`), a review source still running (`Upstream agent is still running`), no agent behind it (`No upstream agent`), `redoNodeId` not among its review sources (`Agent is not reviewed by this node`).

### 2.4 `src/modules/runs/engine.ts`

- `RunRecord` drops `stepIndex`, `runner`, `runnerNodeId`, `humanStatus`, `humanStepIndex`; gains the `ScheduleState`, `runners: Map`, and an in-flight count. `ActiveRun.humanStepIndex` becomes `waitingHumans: string[]`.
- One `pump(run)` function replaces `runSteps`: while the run is `running`/`paused` and fewer than `MAX_PARALLEL_AGENTS` agents are busy, start each ready node (`readyNodes`). Agents start via `runAgent` (not awaited inside the loop); humans go through `enterHuman`. After every node finishes, and after every decision, `pump` runs again, then `settle` emits `paused` or `done` from `runStatus`.
- `runAgent` builds its upstream section from `upstreamFor` instead of `upstreamTexts`. Catalog on first send only, file body on redo only, `resolveAgentPath` before the SDK, unreadable file fails the step — all unchanged.
- `decideRun(id, nodeId, decision, redoNodeId?)`; when `nodeId` is missing and exactly one human is waiting, that one is used (keeps an old client working).
- `startRun` takes an optional `createRunner` (defaults to `createCursorAgentRunner`) so the engine can be tested with a fake runner. `adapter.ts` stays the only file that imports `@cursor/sdk`.
- Failure: first failing agent sets `error`, emits as today, disposes **all** runners (cancels the other branches' sends), and no new node starts. Late results from cancelled sends are ignored.

### 2.5 Server

- `server/routes/runs.ts`: decision body accepts `nodeId` (string, optional as above) and `redoNodeId` (string, only with `decision: "redo"`). `400` when either is present and not a string, or when `redoNodeId` comes with approve or decline. Run start unchanged except the new step shape.
- The SSE stream still closes on `paused` / `done` / `error` / `stopped`. Because `paused` now means "everything is blocked on humans", closing there stays correct; while some branch runs, the stream stays open and the waiting human can be decided live.

### 2.6 Canvas files

- `src/App.tsx`: `isValidConnection` with `wouldCreateCycle` + duplicate check; artifact listener filtered by `reviewSources`; decision passes the node id.
- `src/modules/canvas/runContext.tsx`: `decide(nodeId, decision, redoNodeId?)`.
- `src/modules/canvas/HumanNode.tsx`: passes its own `id`; shows Redo all / Redo one ▾ when it has two or more review sources (computed with `reviewSources` from the canvas edges, names from the agent nodes).
- `src/modules/canvas/api.ts`: `postDecision(id, nodeId, decision, redoNodeId?)`.
- `src/modules/canvas/AgentNode.tsx`: the "Waiting for N of M inputs" hint.

No change to the pipeline JSON (still version 1), `normalizePipeline`, the `.sharlie` format, or workflow health.

## 3. Phases

Each phase ends with `npm test` and `npx tsc --noEmit` green.

### Phase 1 — Graph: inputs, names, helpers
- `resolve.ts`: `inputs`, `agentName`, dedupe duplicate edges.
- `reviewSources`, `wouldCreateCycle` in `src/modules/graph/`.
- Tests in `tests/graph.test.ts`: diamond inputs; duplicate edge counted once; `agentName` on the step; review sources through two humans; cycle detection helper; existing ordering and error tests unchanged.

### Phase 2 — Pure scheduler and human gate
- New `src/modules/runs/schedule.ts`; re-shape `humanGate.ts`.
- New `tests/schedule.test.ts` (added to the `npm test` list), rewrite `tests/human-gate.test.ts`:
  - join waits for all inputs (B done, C not done → D not ready);
  - human input counts only when approved;
  - a waiting human does not block an unrelated branch;
  - `runStatus` is `paused` only when nothing runs and a human waits; `done` when all are finished;
  - upstream text: only direct inputs; through a human it carries the reviewed agent's output; the same agent via two paths appears once; redo output replaces the first output;
  - Redo all on a human with two inputs re-sends both and bumps both retry counts;
  - Redo one re-sends only the picked agent, bumps only its retry count, and keeps the other agent's output;
  - Redo one with an agent that is not a review source rejects;
  - decision rejected while a review source is redoing;
  - decline halts; human with no agent behind it rejects redo.

### Phase 3 — Engine
- Rewrite the step loop as `pump`/`settle`, one runner per node, `MAX_PARALLEL_AGENTS`, injected `createRunner`.
- New `tests/run-engine.test.ts` with a fake runner (resolves `send` on demand): two branches start together; join starts only after both finish and receives both upstream blocks; redo goes to the right runner while another branch is running; an error disposes all runners and starts nothing new.

### Phase 4 — Server and canvas
- Decision route with `nodeId` and `redoNodeId`; canvas changes in 2.6.
- Manual check in the app (`/run`): a diamond workflow, a human on one branch, decide while the other branch is still running; a human with two agents behind it, use Redo one, then Redo all.

### Phase 5 — Docs
- `AGENTS.md`, `ARCHITECTURE.md`, `.cursor/rules/project-guide.mdc`: data flow ("upstream text from direct inputs"), state machine (new `paused` meaning, decision by node id), engine section (runner per node, parallel cap, artifact overlap note), human gate section (review sources, redo of all sources), test list.

## 4. Decisions (from review)

1. **Branches run in parallel**, up to 3 agents at once. Parallel agents must work on different files. Two parallel agents editing the same file is a user error; the app does not prevent it.
2. **Upstream text comes only from connected nodes**: direct inputs, seeing through human nodes to the agents they reviewed.
3. **Decline stops the whole run**, same as today.
4. **Redo offers both**: Redo all (every reviewed agent) and Redo one (the user picks the agent that did not perform well). With a single reviewed agent the card shows one Redo button.
