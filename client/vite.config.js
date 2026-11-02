import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const shared = fileURLToPath(new URL("../shared", import.meta.url));

export default defineConfig(({ command }) => ({
  // GitHub Pages serves the site from /PseudocodePractice/ (and the preview branch from
  // /PseudocodePractice/preview/, set through BASE_PATH by the deploy workflow).
  // Local dev stays at /.
  base: command === "build" ? process.env.BASE_PATH || "/PseudocodePractice/" : "/",
  plugins: [react()],
  resolve: {
    alias: { "@shared": shared },
  },
  worker: {
    format: "es",
  },
  server: {
    port: 5173,
    // The interpreter lives in ../shared so the server can use it too.
    fs: { allow: [".", shared] },
    proxy: {
      "/api": "http://localhost:5000",
    },
  },
}));
