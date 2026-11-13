/**
 * Responsibility: library browser for skills, rules, and MCP servers.
 * Inputs: open state, and the library snapshot from /api/library.
 * Outputs: enable checkboxes, native browse import for skills and rules, and remove for imported rows.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryMcp, LibrarySnapshot, LibrarySource, Selection } from "../library/types";
import { browseLibrary, deleteLibraryItem, fetchLibrary, importLibraryItem, saveLibrarySelection } from "./api";
import { ghostButtonClass, primaryButtonClass } from "./ui";

type LibraryKind = "skills" | "rules" | "mcps";

const emptySnapshot = (): LibrarySnapshot => ({ skills: [], rules: [], mcps: [] });

export function LibraryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const snapshotRef = useRef<LibrarySnapshot>(emptySnapshot());
  const chainRef = useRef(Promise.resolve());
  const viewRef = useRef(0);

  const publish = useCallback((next: LibrarySnapshot, view: number) => {
    if (view !== viewRef.current) return;
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const enqueue = useCallback((task: () => Promise<void>) => {
    const run = chainRef.current.catch(() => undefined).then(task);
    chainRef.current = run;
    return run;
  }, []);

  useEffect(() => {
    if (!open) return;
    const view = ++viewRef.current;
    setBanner(null);
    setLoading(true);
    void fetchLibrary()
      .then((next) => publish(next, view))
      .catch((error: unknown) => {
        publish(emptySnapshot(), view);
        if (view === viewRef.current) setBanner(errorMessage(error, "Could not load the library."));
      })
      .finally(() => {
        if (view === viewRef.current) setLoading(false);
      });
  }, [open, publish]);

  function toggle(kind: LibraryKind, id: string, enabled: boolean) {
    const view = viewRef.current;
    const next = withEnabled(snapshotRef.current, kind, id, enabled);
    snapshotRef.current = next;
    setSnapshot(next);
    const selection = selectionFrom(next);
    void enqueue(async () => {
      if (view !== viewRef.current) return;
      try {
        await saveLibrarySelection(selection);
      } catch (error) {
        if (view !== viewRef.current) return;
        setBanner(errorMessage(error, "Could not update the selection."));
        try {
          const fresh = await fetchLibrary();
          publish(fresh, view);
        } catch (reloadError) {
          if (view === viewRef.current) setBanner(errorMessage(reloadError, "Could not reload the library."));
        }
      }
    });
  }

  async function remove(id: string) {
    const view = viewRef.current;
    setBanner(null);
    try {
      await deleteLibraryItem(id);
      await enqueue(async () => {
        const fresh = await fetchLibrary();
        publish(fresh, view);
      });
    } catch (error) {
      if (view !== viewRef.current) return;
      setBanner(errorMessage(error, "Could not remove the item."));
      try {
        const fresh = await fetchLibrary();
        publish(fresh, view);
      } catch (reloadError) {
        if (view === viewRef.current) setBanner(errorMessage(reloadError, "Could not reload the library."));
      }
    }
  }

  async function reload() {
    const view = viewRef.current;
    setBanner(null);
    await enqueue(async () => {
      try {
        const fresh = await fetchLibrary();
        publish(fresh, view);
      } catch (error) {
        if (view === viewRef.current) setBanner(errorMessage(error, "Could not reload the library."));
      }
    });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Library"
        className="flex max-h-[min(900px,calc(100vh-2rem))] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-medium">Library</h2>
          <button type="button" className={ghostButtonClass} onClick={onClose}>
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {banner && (
            <p className="mb-3 text-xs text-red-600" role="alert">
              {banner}
            </p>
          )}
          {loading && <p className="mb-3 text-xs text-zinc-500">Loading library.</p>}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <section aria-label="Skills">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">Skills</h3>
              <ul className="mb-3 flex max-h-56 flex-col gap-1.5 overflow-y-auto">
                {snapshot.skills.length === 0 && <EmptyRow />}
                {snapshot.skills.map((item) => (
                  <LibraryRow
                    key={item.id}
                    title={item.title}
                    detail={item.description}
                    source={item.source}
                    enabled={item.enabled}
                    enableLabel={`Enable skill ${item.title}`}
                    onToggle={(enabled) => toggle("skills", item.id, enabled)}
                    onRemove={item.source === "import" ? () => void remove(item.id) : undefined}
                  />
                ))}
              </ul>
              <BrowseImport
                kind="skill"
                hint="The folder must contain SKILL.md."
                onImport={async (filePath) => {
                  await importLibraryItem("skill", filePath);
                  await reload();
                }}
              />
            </section>
            <section aria-label="Rules">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">Rules</h3>
              <ul className="mb-3 flex max-h-56 flex-col gap-1.5 overflow-y-auto">
                {snapshot.rules.length === 0 && <EmptyRow />}
                {snapshot.rules.map((item) => (
                  <LibraryRow
                    key={item.id}
                    title={item.title}
                    detail={item.description}
                    source={item.source}
                    enabled={item.enabled}
                    enableLabel={`Enable rule ${item.title}`}
                    onToggle={(enabled) => toggle("rules", item.id, enabled)}
                    onRemove={item.source === "import" ? () => void remove(item.id) : undefined}
                  />
                ))}
              </ul>
              <BrowseImport
                kind="rule"
                hint="Choose a .mdc or .md file."
                onImport={async (filePath) => {
                  await importLibraryItem("rule", filePath);
                  await reload();
                }}
              />
            </section>
            <section aria-label="MCP">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">MCP</h3>
              <ul className="mb-3 flex max-h-56 flex-col gap-1.5 overflow-y-auto">
                {snapshot.mcps.length === 0 && <EmptyRow />}
                {snapshot.mcps.map((item) => (
                  <LibraryRow
                    key={item.id}
                    title={item.name}
                    detail={transportSummary(item)}
                    source={item.source}
                    enabled={item.enabled}
                    enableLabel={`Enable MCP ${item.name}`}
                    onToggle={(enabled) => toggle("mcps", item.id, enabled)}
                  />
                ))}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyRow() {
  return <li className="px-1 py-2 text-xs text-zinc-400">Nothing was found.</li>;
}

function LibraryRow({
  title,
  detail,
  source,
  enabled,
  enableLabel,
  onToggle,
  onRemove,
}: {
  title: string;
  detail: string;
  source: LibrarySource;
  enabled: boolean;
  enableLabel: string;
  onToggle: (enabled: boolean) => void;
  onRemove?: () => void;
}) {
  return (
    <li className="flex items-start gap-2 rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={enabled}
        aria-label={enableLabel}
        onChange={(event) => onToggle(event.target.checked)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="break-words font-medium text-zinc-800 dark:text-zinc-100">{title}</span>
          <span className="rounded-full border border-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:border-zinc-700">
            {sourceLabel(source)}
          </span>
        </div>
        {detail.trim() !== "" && (
          <p className="mt-0.5 break-words text-[11px] leading-relaxed text-zinc-500">{detail}</p>
        )}
      </div>
      {onRemove && (
        <button type="button" className={ghostButtonClass} aria-label={`Remove ${title}`} onClick={onRemove}>
          Remove
        </button>
      )}
    </li>
  );
}

function BrowseImport({
  kind,
  hint,
  onImport,
}: {
  kind: "skill" | "rule";
  hint: string;
  onImport: (filePath: string) => Promise<void>;
}) {
  const [waiting, setWaiting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function browse() {
    setWaiting(true);
    setMessage(null);
    try {
      const picked = await browseLibrary(kind);
      if ("cancelled" in picked) return;
      await onImport(picked.path);
    } catch (error) {
      setMessage(errorMessage(error, `Could not import the ${kind}.`));
    } finally {
      setWaiting(false);
    }
  }

  return (
    <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <button
        type="button"
        className={primaryButtonClass}
        aria-label={kind === "skill" ? "Browse for a skill folder" : "Browse for a rule file"}
        disabled={waiting}
        onClick={() => void browse()}
      >
        {waiting ? "Waiting" : "Browse"}
      </button>
      <p className="mt-2 text-xs text-zinc-500">{hint}</p>
      {message && (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}

function sourceLabel(source: LibrarySource): string {
  if (source === "import") return "Imported";
  if (source === "cursor") return "Cursor";
  return "This app";
}

function withEnabled(snapshot: LibrarySnapshot, kind: LibraryKind, id: string, enabled: boolean): LibrarySnapshot {
  if (kind === "skills") {
    return { ...snapshot, skills: snapshot.skills.map((item) => (item.id === id ? { ...item, enabled } : item)) };
  }
  if (kind === "rules") {
    return { ...snapshot, rules: snapshot.rules.map((item) => (item.id === id ? { ...item, enabled } : item)) };
  }
  return { ...snapshot, mcps: snapshot.mcps.map((item) => (item.id === id ? { ...item, enabled } : item)) };
}

function selectionFrom(snapshot: LibrarySnapshot): Selection {
  return {
    skills: snapshot.skills.filter((item) => item.enabled).map((item) => item.id),
    rules: snapshot.rules.filter((item) => item.enabled).map((item) => item.id),
    mcps: snapshot.mcps.filter((item) => item.enabled).map((item) => item.id),
  };
}

function transportSummary(mcp: LibraryMcp): string {
  const envNote = mcp.hasEnv || mcp.transport.hasEnv ? " · env configured" : "";
  if (mcp.transport.type === "stdio") {
    const args = mcp.transport.args.length > 0 ? ` ${mcp.transport.args.join(" ")}` : "";
    return `stdio · ${mcp.transport.command}${args}${envNote}`;
  }
  return `http · ${mcp.transport.url}${envNote}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== "" ? error.message : fallback;
}
