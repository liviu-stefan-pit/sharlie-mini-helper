/**
 * Responsibility: ask whether a workflow export should include files.
 * Inputs: open state, busy state, and the export callback.
 * Outputs: Cancel, or Export with the include-files choice. It does not write the file.
 */
import { useEffect, useState } from "react";
import { ghostButtonClass, primaryButtonClass } from "./ui";

export function ExportModal({
  open,
  onClose,
  onExport,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onExport: (includeFiles: boolean) => void;
  busy: boolean;
}) {
  const [includeFiles, setIncludeFiles] = useState(true);

  useEffect(() => {
    if (open) setIncludeFiles(true);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-medium">Export workflow</h2>
        <label className="mb-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={includeFiles}
            disabled={busy}
            onChange={(event) => setIncludeFiles(event.target.checked)}
          />
          <span>Include skill, rule, and agent files (recommended)</span>
        </label>
        <p className="mb-4 text-xs leading-relaxed text-zinc-500">
          Without files, the person who imports it must already have the same skills, rules, and agents. MCP servers
          are always exported by name only, without secrets.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButtonClass} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={primaryButtonClass} onClick={() => onExport(includeFiles)} disabled={busy}>
            Export…
          </button>
        </div>
      </div>
    </div>
  );
}
