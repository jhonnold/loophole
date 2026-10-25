import { describe, expect, spyOn, test } from "bun:test";
import { createPuzzle } from "@loophole/core";
import { withServer } from "./combined.ts";
import type { PuzzleEntry, PuzzleSource } from "./source.ts";

function entry(id: string): PuzzleEntry {
  return { id, name: id, subtitle: "", width: 1, height: 1, puzzle: createPuzzle(1, 1) };
}

function sourceOf(...ids: string[]): PuzzleSource {
  return {
    list: async () => ids.map((id) => ({ ...entry(id) })),
    get: async (id) => (ids.includes(id) ? entry(id) : null),
  };
}

const down: PuzzleSource = {
  list: async () => {
    throw new Error("offline");
  },
  get: async () => {
    throw new Error("offline");
  },
};

describe("withServer", () => {
  test("lists local puzzles first, then the server's", async () => {
    const ids = (await withServer(sourceOf("a", "b"), sourceOf("c")).list()).map((s) => s.id);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  test("an unreachable server leaves the local list", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const ids = (await withServer(sourceOf("a"), down).list()).map((s) => s.id);
    expect(ids).toEqual(["a"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test("get finds local ids without asking the server, then asks the server", async () => {
    const source = withServer(sourceOf("a"), down);
    expect((await source.get("a"))?.id).toBe("a");
    await expect(source.get("z")).rejects.toThrow("offline");
    expect((await withServer(sourceOf("a"), sourceOf("z")).get("z"))?.id).toBe("z");
    expect(await withServer(sourceOf("a"), sourceOf("z")).get("y")).toBeNull();
  });
});
