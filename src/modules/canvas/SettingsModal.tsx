/**
 * Responsibility: local Cursor API key form and workspace folder picker.
 * Inputs: open state, the key typed into the password field, and a folder from the native dialog.
 * Outputs: POST /api/settings, PUT /api/workspace, and a configured flag. The saved key is not shown again.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { browseWorkspace, fetchSettings, fetchWorkspace, saveSettings, saveWorkspace, type WorkspaceStatus } from "./api";
import { fieldClass, ghostButtonClass, primaryButtonClass } from "./ui";

export function SettingsModal({
  open,
  onClose,
  onKeySaved,
  onWorkspaceChanged,
}: {
  open: boolean;
  onClose: () => void;
  onKeySaved?: () => void;
  onWorkspaceChanged?: (status: WorkspaceStatus) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceStatus>({ path: null, valid: false });
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    savedRef.current = false;
    let cancelled = false;
    setMessage(null);
    fetchSettings()
      .then((status) => {
        if (!cancelled) setConfigured(status.configured);
      })
      .catch(() => {
        if (!cancelled) setConfigured(null);
      });
    fetchWorkspace()
      .then((status) => {
        if (!cancelled) setWorkspace(status);
      })
      .catch(() => {
        if (!cancelled) setWorkspace({ path: null, valid: false });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  function requestClose() {
    const saved = savedRef.current;
    savedRef.current = false;
    onClose();
    if (saved) onKeySaved?.();
  }

  async function onBrowseWorkspace() {
    setMessage(null);
    try {
      const picked = await browseWorkspace();
      if ("cancelled" in picked) return;
      const status = await saveWorkspace(picked.path);
      setWorkspace(status);
      onWorkspaceChanged?.(status);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the workspace.");
    }
  }

  async function onClearWorkspace() {
    setMessage(null);
    try {
      const status = await saveWorkspace(null);
      setWorkspace(status);
      onWorkspaceChanged?.(status);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not clear the workspace.");
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const status = await saveSettings(apiKey);
      setConfigured(status.configured);
      setApiKey("");
      savedRef.current = true;
      setMessage(status.configured ? "Key saved in .env." : "Key cleared.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the key.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={requestClose}>
      <form
        className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(event) => event.stopPropagation()}
        onSubmit={onSubmit}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Settings</h2>
          <button type="button" className={ghostButtonClass} onClick={requestClose}>
            Close
          </button>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-zinc-500">
          {configured === null && "Checking whether a key is configured."}
          {configured === true && "A key is already configured on this machine."}
          {configured === false && "No key configured yet."} The key stays in the local .env file and is never sent
          back to the browser.
        </p>
        <div className="mb-3">
          <label className="block text-[10px] font-medium uppercase tracking-wide text-zinc-400">WORKSPACE</label>
          <p className="mt-1 font-mono text-[11px] break-all">{workspace.path ?? "No workspace selected."}</p>
          {workspace.path !== null && !workspace.valid && (
            <p className="text-red-600 text-[11px]">{workspace.error}</p>
          )}
          <p className="mt-1 text-xs text-zinc-500">
            Each workflow gets its own folder in the workspace. Agents save their files there.
          </p>
          <div className="mt-2 flex gap-1">
            <button type="button" className={ghostButtonClass} onClick={() => void onBrowseWorkspace()}>
              Browse…
            </button>
            <button
              type="button"
              className={ghostButtonClass}
              disabled={workspace.path === null}
              onClick={() => void onClearWorkspace()}
            >
              Clear
            </button>
          </div>
        </div>
        <label className="mb-3 block text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          CURSOR_API_KEY
          <input
            className={`${fieldClass} mt-1`}
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        {message && <p className="mb-3 text-xs text-zinc-500">{message}</p>}
        <button type="submit" className={primaryButtonClass} disabled={saving}>
          {saving ? "Saving" : "Save"}
        </button>
      </form>
    </div>
  );
}
