import type { ApiClient, Schemas } from "@loophole/api-client";
import { parsePuzzle } from "@loophole/core";
import type { PuzzleSource, PuzzleSummary } from "./source.ts";

/** How many recent server puzzles the list shows. */
const LIST_LIMIT = 20;

function summary(p: Schemas["PuzzleSummary"]): PuzzleSummary {
  return {
    id: p.id,
    name: "Generated",
    subtitle: "Practice · 練習",
    width: p.width,
    height: p.height,
  };
}

/** Puzzles from the server's API: recent published puzzles, clues only. */
export function apiSource(client: ApiClient): PuzzleSource {
  return {
    async list() {
      const { data, response } = await client.GET("/api/puzzles", {
        params: { query: { limit: LIST_LIMIT } },
      });
      if (data === undefined) throw new Error(`Could not list puzzles (HTTP ${response.status})`);
      return data.items.map(summary);
    },
    async get(id) {
      const { data, response } = await client.GET("/api/puzzles/{id}", {
        params: { path: { id } },
      });
      if (response.status === 404) return null;
      if (data === undefined)
        throw new Error(`Could not load puzzle ${id} (HTTP ${response.status})`);
      const { width, height } = data.puzzle;
      return { ...summary({ ...data, width, height }), puzzle: parsePuzzle(data.puzzle) };
    },
  };
}
