/**
 * Responsibility: mount the canvas shell.
 * Inputs: the #root element and the stored theme.
 * Outputs: the rendered application.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyTheme, readTheme } from "./modules/canvas/theme";
import "@xyflow/react/dist/style.css";
import "./index.css";

applyTheme(readTheme());

const root = document.getElementById("root");
if (!root) throw new Error("Root element missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
