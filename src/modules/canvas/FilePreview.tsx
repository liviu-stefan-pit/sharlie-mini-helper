/**
 * Responsibility: slide-over preview of one workspace file.
 * Inputs: a stored artifact path and a close action.
 * Outputs: file text from GET /api/files, a truncated notice, or the error text.
 */
import { useEffect, useState } from "react";
import { fetchFilePreview } from "./api";

export function FilePreview({
  filePath,
  onClose,
  alongside,
}: {
  filePath: string;
  onClose: () => void;
  alongside: boolean;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setTruncated(false);
    setError(null);
    void fetchFilePreview(filePath)
      .then((body) => {
        if (cancelled) return;
        setContent(body.content);
        setTruncated(body.truncated);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "Preview failed");
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  return (
    <aside
      className={`absolute inset-y-0 z-30 flex w-96 max-w-full flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 ${alongside ? "right-80" : "right-0"}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <p className="min-w-0 truncate text-xs font-medium text-zinc-700 dark:text-zinc-200" title={filePath}>
          {filePath}
        </p>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {error && <p className="text-xs text-red-600">{error}</p>}
        {content !== null && (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-zinc-800 dark:text-zinc-100">
            {content}
          </pre>
        )}
        {truncated && <p className="mt-2 text-[11px] text-zinc-500">This preview is truncated.</p>}
      </div>
    </aside>
  );
}
