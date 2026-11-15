/**
 * Responsibility: shared control classes for the top bar and node fields.
 * Inputs: none.
 * Outputs: Tailwind class strings.
 */

export const fieldClass =
  "nodrag nopan nowheel w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

export const cardClass =
  "node-card w-[260px] rounded-md border border-zinc-200 bg-white p-2.5 text-xs text-zinc-800 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100";

export const labelClass = "mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-400";

export const ghostButtonClass =
  "rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900";

export const primaryButtonClass =
  "rounded-md border border-zinc-900 bg-zinc-900 px-2 py-1 text-xs text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white";

export const inputHandleClass =
  "!h-2.5 !w-2.5 !border-sky-600 !bg-sky-400 dark:!border-sky-300 dark:!bg-sky-500";

export const outputHandleClass =
  "!h-2.5 !w-2.5 !border-amber-600 !bg-amber-400 dark:!border-amber-300 dark:!bg-amber-500";
