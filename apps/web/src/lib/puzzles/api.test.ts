import { describe, expect, test } from "bun:test";
import { createApiClient, type Schemas } from "@loophole/api-client";
import { serializePuzzle } from "@loophole/core";
import { apiSource } from "./api.ts";

const PUZZLE: Schemas["Puzzle"] = {
  id: "p1",
  puzzle: { v: 1, width: 2, height: 2, clues: "2222", seed: "s", meta: { generator: "1" } },
  origin: "generated",
  createdAt: "2026-10-25T12:00:00.000Z",
};

/** A client whose fetch answers from `routes` (path → [status, body]) and records the URLs. */
function clientFor(routes: Record<string, [number, unknown]>) {
  const urls: string[] = [];
  const fetch = (async (input: Request) => {
    const url = new URL(input.url);
    urls.push(url.pathname + url.search);
    const [status, body] = routes[url.pathname] ?? [404, { title: "Not found" }];
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": status < 400 ? "application/json" : "application/problem+json" },
    });
  }) as typeof globalThis.fetch;
  return { client: createApiClient({ baseUrl: "http://api.test", fetch }), urls };
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
      { id: "p1", name: "Generated", subtitle: "Practice · 練習", width: 10, height: 7 },
    ]);
    expect(urls).toEqual(["/api/puzzles?limit=20"]);
  });

  test("get parses the wire puzzle, and is null on 404", async () => {
    const { client } = clientFor({ "/api/puzzles/p1": [200, PUZZLE] });
    const entry = await apiSource(client).get("p1");
    expect(entry).toMatchObject({ id: "p1", name: "Generated", width: 2, height: 2 });
    expect(entry && serializePuzzle(entry.puzzle)).toEqual(PUZZLE.puzzle);
    expect(await apiSource(client).get("nope")).toBeNull();
  });

  test("other failures throw", async () => {
    const error: [number, unknown] = [500, { title: "Internal server error" }];
    const { client } = clientFor({ "/api/puzzles": error, "/api/puzzles/p1": error });
    await expect(apiSource(client).list()).rejects.toThrow("HTTP 500");
    await expect(apiSource(client).get("p1")).rejects.toThrow("HTTP 500");
  });
});
