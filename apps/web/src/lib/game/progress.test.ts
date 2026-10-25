import { describe, expect, test } from "bun:test";
import { createGrid } from "@loophole/core";
import { memoryStorage } from "../test-support/memory-storage.ts";
import { createProgressStore, type KeyValueStorage, progressKey } from "./progress.ts";

const grid = createGrid(2, 2);

describe("progress store", () => {
  test("round-trips edges, time and solved flag per puzzle", () => {
    const storage = memoryStorage();
    const store = createProgressStore(storage);
    const edges = new Uint8Array([1, 1, 2, 2, 1, 1, 1, 2, 1, 1, 2, 1]);
    store.save("a", { edges, elapsedMs: 4200.4, solved: true });
    expect(store.load("a", grid)).toEqual({ edges, elapsedMs: 4200, solved: true });
    expect(store.load("b", grid)).toBeNull();
    expect(JSON.parse(storage.data.get(progressKey("a")) ?? "")).toEqual({
      v: 1,
      edges: "112211121121",
      elapsedMs: 4200,
      solved: true,
    });
  });

  test("clear forgets a puzzle", () => {
    const store = createProgressStore(memoryStorage());
    store.save("a", { edges: new Uint8Array(12), elapsedMs: 0, solved: false });
    store.clear("a");
    expect(store.load("a", grid)).toBeNull();
  });

  test("ignores broken, foreign or wrong-sized data", () => {
    const storage = memoryStorage();
    const store = createProgressStore(storage);
    for (const text of [
      "not json",
      "{}",
      JSON.stringify({ v: 2, edges: "000000000000" }),
      JSON.stringify({ v: 1, edges: "000" }),
      JSON.stringify({ v: 1, edges: "00000000000x" }),
    ]) {
      storage.data.set(progressKey("a"), text);
      expect(store.load("a", grid)).toBeNull();
    }
    storage.data.set(progressKey("a"), JSON.stringify({ v: 1, edges: "000000000000" }));
    expect(store.load("a", grid)).toEqual({
      edges: new Uint8Array(12),
      elapsedMs: 0,
      solved: false,
    });
  });

  test("keeps working when storage throws or is missing", () => {
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    for (const store of [createProgressStore(throwing), createProgressStore(null)]) {
      expect(() =>
        store.save("a", { edges: new Uint8Array(12), elapsedMs: 1, solved: false }),
      ).not.toThrow();
      expect(store.load("a", grid)).toBeNull();
      expect(() => store.clear("a")).not.toThrow();
    }
  });
});
