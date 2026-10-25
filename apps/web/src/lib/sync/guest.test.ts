import { describe, expect, test } from "bun:test";
import { memoryStorage } from "../test-support/memory-storage.ts";
import { guestSaves, importGuestSaves } from "./guest.ts";
import type { ImportOutcome, SavedBoard } from "./sync.ts";

const isBuiltIn = (id: string) => id === "small-7";

function storageWith(entries: Record<string, unknown>) {
  const storage = memoryStorage();
  for (const [key, value] of Object.entries(entries)) {
    storage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  return storage;
}

const save = (edges: string, elapsedMs = 1000) => ({ v: 1, edges, elapsedMs, solved: false });

describe("guest saves", () => {
  test("lists readable guest saves with marks, of server puzzles only", () => {
    const storage = storageWith({
      "loophole:progress:b": save("1000", 2000),
      "loophole:progress:a": { ...save("2000"), assisted: true },
      "loophole:progress:small-7": save("1000"),
      "loophole:progress:broken": "not json",
      "loophole:progress:blank": save("0000"),
      "loophole:user:u1:progress:c": save("1000"),
      "loophole:theme": "dark",
    });
    expect(guestSaves(storage, isBuiltIn)).toEqual([
      {
        puzzleId: "a",
        saved: { edges: "2000", elapsedMs: 1000, solved: false, assisted: true, version: null },
      },
      {
        puzzleId: "b",
        saved: { edges: "1000", elapsedMs: 2000, solved: false, assisted: false, version: null },
      },
    ]);
    expect(guestSaves(null, isBuiltIn)).toEqual([]);
  });

  test("import sends each save once and removes it from guest storage", async () => {
    const storage = storageWith({
      "loophole:progress:a": save("1000"),
      "loophole:progress:b": save("2000"),
      "loophole:progress:c": save("0001"),
      "loophole:progress:small-7": save("1000"),
    });
    const outcomes: Record<string, ImportOutcome> = { a: "imported", b: "kept", c: "skipped" };
    const sent: string[] = [];
    const importOne = async (id: string, _saved: SavedBoard) => {
      sent.push(id);
      return outcomes[id];
    };
    expect(await importGuestSaves(importOne, storage, isBuiltIn)).toEqual({
      imported: 1,
      kept: 1,
      skipped: 1,
      failed: false,
    });
    expect(sent).toEqual(["a", "b", "c"]);
    expect([...storage.data.keys()]).toEqual(["loophole:progress:small-7"]);
    // Running it again has nothing left to send.
    expect(await importGuestSaves(importOne, storage, isBuiltIn)).toMatchObject({ imported: 0 });
    expect(sent).toHaveLength(3);
  });

  test("stops at the first failure and keeps the rest for another try", async () => {
    const storage = storageWith({
      "loophole:progress:a": save("1000"),
      "loophole:progress:b": save("2000"),
    });
    const importOne = async (id: string) => (id === "a" ? "imported" : "failed") as ImportOutcome;
    expect(await importGuestSaves(importOne, storage, isBuiltIn)).toEqual({
      imported: 1,
      kept: 0,
      skipped: 0,
      failed: true,
    });
    expect([...storage.data.keys()]).toEqual(["loophole:progress:b"]);
  });
});
