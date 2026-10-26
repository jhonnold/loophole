import type { ApiClient, Schemas } from "@loophole/api-client";
import { EdgeState, encodeEdges, type Hint, parsePuzzle } from "@loophole/core";
import type { PuzzleSource, PuzzleSummary } from "./source.ts";

/** How many recent server puzzles the list shows. */
const LIST_LIMIT = 20;

function summary(p: Schemas["PuzzleSummary"]): PuzzleSummary {
  return {
    id: p.id,
    name: p.origin === "submitted" ? "Player-made" : "Generated",
    subtitle: "Practice · 練習",
    width: p.width,
    height: p.height,
    origin: p.origin,
    // Player-made puzzles count as hard on the server, but weren't made at a level.
    level: p.origin === "generated" ? p.level : undefined,
  };
}

function toHint(h: Schemas["Hint"]): Hint {
  switch (h.kind) {
    case "solved":
    case "mistake":
    case "reveal":
      return h;
    case "step":
      return {
        kind: "step",
        step: {
          rule: h.rule,
          changes: h.changes.map((c) => ({
            edge: c.edge,
            state: c.state === "line" ? EdgeState.Line : EdgeState.Cross,
          })),
          cells: h.cells,
          dots: h.dots,
        },
      };
  }
}

/** Puzzles from the server's API: recent published puzzles, clues only, and hints. */
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
      // A 400 means the id is malformed (say, over 64 characters), so no puzzle has it.
      if (response.status === 404 || response.status === 400) return null;
      if (data === undefined)
        throw new Error(`Could not load puzzle ${id} (HTTP ${response.status})`);
      const { width, height } = data.puzzle;
      return { ...summary({ ...data, width, height }), puzzle: parsePuzzle(data.puzzle) };
    },
    async hint(id, _puzzle, edges) {
      const { data, response } = await client.POST("/api/puzzles/{id}/hint", {
        params: { path: { id } },
        body: { edges: encodeEdges(edges) },
      });
      if (data === undefined) throw new Error(`Could not get a hint (HTTP ${response.status})`);
      return toHint(data);
    },
  };
}
