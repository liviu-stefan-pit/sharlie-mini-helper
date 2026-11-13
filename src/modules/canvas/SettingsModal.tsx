/**
 * Responsibility: local Cursor API key form.
 * Inputs: open state, and the key typed into the password field.
 * Outputs: POST /api/settings and a configured flag. The saved key is not shown again.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { fetchSettings, saveSettings } from "./api";
import { fieldClass, ghostButtonClass, primaryButtonClass } from "./ui";

export function SettingsModal({
  open,
  onClose,
  onKeySaved,
}: {
  open: boolean;
  onClose: () => void;
  onKeySaved?: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
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
