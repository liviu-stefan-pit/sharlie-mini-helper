/**
 * Responsibility: show a list of export or import warnings.
 * Inputs: open state, title, optional intro, and warning strings.
 * Outputs: a modal the caller closes. It does not change files.
 */
import { ghostButtonClass } from "./ui";

export function WarningsModal({
  open,
  title,
  intro,
  warnings,
  onClose,
}: {
  open: boolean;
  title: string;
  intro?: string;
  warnings: string[];
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{title}</h2>
          <button type="button" className={ghostButtonClass} onClick={onClose}>
            Close
          </button>
        </div>
        {intro && <p className="mb-3 text-xs leading-relaxed text-zinc-500">{intro}</p>}
        <ul className="list-disc space-y-1 pl-4 text-xs text-amber-700 dark:text-amber-400">
          {warnings.map((warning, index) => (
            <li key={`${index}-${warning}`}>{warning}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
