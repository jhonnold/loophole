import { describe, expect, test } from "bun:test";
import { createGrid } from "@loophole/core";
import { writable } from "svelte/store";
import type { AuthState } from "../auth/auth.ts";
import { createProgressStore, type Progress } from "../game/progress.ts";
import { memoryStorage } from "../test-support/memory-storage.ts";
import { openSaves, settled } from "./saves.ts";
import type { ProgressSync } from "./sync.ts";

const grid = createGrid(2, 2);
const progress: Progress = {
  edges: new Uint8Array(12).fill(1, 0, 1),
  elapsedMs: 1000,
  solved: false,
  assisted: false,
};

/** Records the calls a saves handle makes on the account's sync. */
function fakeSync() {
  const calls: string[] = [];
  const sync = {
    userId: "u1",
    load: async (id: string) => {
      calls.push(`load ${id}`);
      return progress;
    },
    save: (id: string) => calls.push(`save ${id}`),
    clear: (id: string) => calls.push(`clear ${id}`),
    flush: () => calls.push("flush"),
    refresh: async (id: string) => {
      calls.push(`refresh ${id}`);
    },
    watch: (id: string) => {
      calls.push(`watch ${id}`);
      return () => calls.push(`unwatch ${id}`);
    },
  } as unknown as ProgressSync;
  return { sync, calls };
}

function setup(loggedIn: boolean) {
  const storage = memoryStorage();
  const guest = createProgressStore(storage);
  const { sync, calls } = fakeSync();
  const deps = {
    account: async () => (loggedIn ? sync : null),
    guest,
    isBuiltIn: (id: string) => id === "small-7",
  };
  return { storage, guest, calls, deps };
}

describe("openSaves", () => {
  test("a logged-in player's server puzzle syncs with the account", async () => {
    const { deps, calls, storage } = setup(true);
    const saves = openSaves(deps, "p1", grid, () => {});
    saves.save(progress); // before load: ignored
    expect(await saves.load()).toEqual(progress);
    expect(saves.synced).toBe(true);
    saves.save(progress);
    saves.flush();
    saves.refresh();
    saves.clear();
    saves.close();
    expect(calls).toEqual([
      "watch p1",
      "load p1",
      "save p1",
      "flush",
      "refresh p1",
      "clear p1",
      "unwatch p1",
    ]);
    expect(storage.data.size).toBe(0);
  });

  test("guests and built-in puzzles use the guest store", async () => {
    for (const [loggedIn, id] of [
      [false, "p1"],
      [true, "small-7"],
    ] as const) {
      const { deps, calls, guest } = setup(loggedIn);
      guest.save(id, progress);
      const saves = openSaves(deps, id, grid, () => {});
      expect(await saves.load()).toEqual(progress);
      expect(saves.synced).toBe(false);
      saves.clear();
      expect(guest.load(id, grid)).toBeNull();
      expect(calls).toEqual([]);
    }
  });
});

describe("settled", () => {
  test("waits for the first answer that isn't loading", async () => {
    const store = writable<AuthState>({ status: "loading" });
    const result = settled(store);
    store.set({ status: "guest" });
    expect(await result).toEqual({ status: "guest" });
    expect(await settled(store)).toEqual({ status: "guest" });
  });
});
