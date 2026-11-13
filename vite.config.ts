/**
 * Responsibility: Vite dev server and production build for the canvas.
 * Inputs: React plugin, dev-server port, /api proxy target.
 * Outputs: dev server on port 5173 with /api forwarded to the local Node server.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
