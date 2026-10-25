import type { PuzzleSource } from "./source.ts";

/**
 * The built-in puzzles first, then the server's. Built-in ids are looked up locally, so they keep
 * working (and the end-to-end and frame-time tests keep their boards) with no server running. If
 * the server can't be reached, the list holds just the built-in puzzles.
 */
export function withServer(local: PuzzleSource, server: PuzzleSource): PuzzleSource {
  return {
    async list() {
      const remote = await server.list().catch((err: unknown) => {
        console.warn("Server puzzles unavailable:", err);
        return [];
      });
      return [...(await local.list()), ...remote];
    },
    async get(id) {
      return (await local.get(id)) ?? (await server.get(id));
    },
  };
}
