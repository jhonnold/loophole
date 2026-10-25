import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  // In development the API (`bun run dev:api`, port 3000) is reached through Vite. `vite preview`
  // gets no proxy, so the end-to-end tests see only the built-in puzzles.
  server: { proxy: { "/api": "http://localhost:3000" } },
  preview: { proxy: {} },
});
