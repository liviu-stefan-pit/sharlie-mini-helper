/**
 * Responsibility: persist and apply the light or dark theme.
 * Inputs: "light" or "dark", and the localStorage key sharlie-theme.
 * Outputs: the dark class on documentElement, plus the stored preference.
 */

export type Theme = "light" | "dark";

const STORAGE_KEY = "sharlie-theme";

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    /* private mode */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode */
  }
}
