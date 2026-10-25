import { describe, expect, test } from "bun:test";
import { createApiClient, type Schemas } from "@loophole/api-client";
import { createPuzzle, EdgeState, serializePuzzle } from "@loophole/core";
import { apiSource } from "./api.ts";

const PUZZLE: Schemas["Puzzle"] = {
  id: "p1",
  puzzle: { v: 1, width: 2, height: 2, clues: "2222", seed: "s", meta: { generator: "1" } },
  origin: "generated",
  createdAt: "2026-10-25T12:00:00.000Z",
};

/**
 * A client whose fetch answers from `routes` (path → [status, body]) and records the URLs and the
 * request bodies.
 */
function clientFor(routes: Record<string, [number, unknown]>) {
  const urls: string[] = [];
  const bodies: unknown[] = [];
  const fetch = (async (input: Request) => {
    const url = new URL(input.url);
    urls.push(url.pathname + url.search);
    if (input.method === "POST") bodies.push(await input.json());
    const [status, body] = routes[url.pathname] ?? [404, { title: "Not found" }];
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": status < 400 ? "application/json" : "application/problem+json" },
    });
  }) as typeof globalThis.fetch;
  return { client: createApiClient({ baseUrl: "http://api.test", fetch }), urls, bodies };
}

describe("apiSource", () => {
  test("list maps the server's recent puzzles to summaries", async () => {
    const { client, urls } = clientFor({
      "/api/puzzles": [
        200,
        { items: [{ id: "p1", width: 10, height: 7, origin: "generated", createdAt: "x" }] },
      ],
    });
    expect(await apiSource(client).list()).toEqual([
      {
        id: "p1",
        name: "Generated",
        subtitle: "Practice · 練習",
        width: 10,
        height: 7,
        origin: "generated",
      },
    ]);
    expect(urls).toEqual(["/api/puzzles?limit=20"]);
  });

  test("a submitted puzzle is listed as player-made", async () => {
    const { client } = clientFor({
      "/api/puzzles": [
        200,
        { items: [{ id: "s1", width: 5, height: 5, origin: "submitted", createdAt: "x" }] },
      ],
    });
    expect(await apiSource(client).list()).toMatchObject([
      { id: "s1", name: "Player-made", origin: "submitted" },
    ]);
  });

  test("get parses the wire puzzle, and is null on 404", async () => {
    const { client } = clientFor({ "/api/puzzles/p1": [200, PUZZLE] });
    const entry = await apiSource(client).get("p1");
    expect(entry).toMatchObject({ id: "p1", name: "Generated", width: 2, height: 2 });
    expect(entry && serializePuzzle(entry.puzzle)).toEqual(PUZZLE.puzzle);
    expect(await apiSource(client).get("nope")).toBeNull();
  });

  test("an id the API rejects as malformed is not found", async () => {
    const { client } = clientFor({ "/api/puzzles/p1": [400, { title: "Invalid request" }] });
    expect(await apiSource(client).get("p1")).toBeNull();
  });

  test("other failures throw", async () => {
    const error: [number, unknown] = [500, { title: "Internal server error" }];
    const { client } = clientFor({ "/api/puzzles": error, "/api/puzzles/p1": error });
    await expect(apiSource(client).list()).rejects.toThrow("HTTP 500");
    await expect(apiSource(client).get("p1")).rejects.toThrow("HTTP 500");
  });

  test("hint posts the board and maps a step to core's shape", async () => {
    const step = {
      kind: "step",
      rule: "clue-zero",
      changes: [
        { edge: 0, state: "cross" },
        { edge: 7, state: "line" },
      ],
      cells: [0],
      dots: [],
    };
    const { client, bodies } = clientFor({ "/api/puzzles/p1/hint": [200, step] });
    const puzzle = createPuzzle(2, 2);
    const edges = new Uint8Array(puzzle.grid.edgeCount);
    edges[3] = EdgeState.Line;
    expect(await apiSource(client).hint("p1", puzzle, edges)).toEqual({
      kind: "step",
      step: {
        rule: "clue-zero",
        changes: [
          { edge: 0, state: EdgeState.Cross },
          { edge: 7, state: EdgeState.Line },
        ],
        cells: [0],
        dots: [],
      },
    });
    expect(bodies).toEqual([{ edges: "000100000000" }]);
  });

  test("hint passes other kinds through and throws on failure", async () => {
    const { client } = clientFor({
      "/api/puzzles/p1/hint": [200, { kind: "mistake", edge: 4, count: 2 }],
      "/api/puzzles/p2/hint": [404, { title: "Puzzle not found" }],
    });
    const puzzle = createPuzzle(2, 2);
    const edges = new Uint8Array(puzzle.grid.edgeCount);
    expect(await apiSource(client).hint("p1", puzzle, edges)).toEqual({
      kind: "mistake",
      edge: 4,
      count: 2,
    });
    await expect(apiSource(client).hint("p2", puzzle, edges)).rejects.toThrow("HTTP 404");
  });
});
