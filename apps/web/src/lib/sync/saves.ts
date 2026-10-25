import type { Grid } from "@loophole/core";
import type { Readable } from "svelte/store";
import type { AuthState } from "../auth/auth.ts";
import type { Progress, ProgressStore } from "../game/progress.ts";
import type { ProgressSync, RemoteListener } from "./sync.ts";

/** Resolves with the auth state once it is known (not "loading"). */
export function settled(auth: Readable<AuthState>): Promise<AuthState> {
  return new Promise((resolve) => {
    let done = false;
    let unsubscribe: (() => void) | undefined;
    unsubscribe = auth.subscribe((state) => {
      if (done || state.status === "loading") return;
      done = true;
      resolve(state);
      unsubscribe?.();
    });
    if (done) unsubscribe();
  });
}

/** Saving and restoring one puzzle's progress for the play screen. */
export interface PuzzleSaves {
  /** After `load`: true when saves go to the account, false when they stay on this device. */
  readonly synced: boolean;
  load(): Promise<Progress | null>;
  save(progress: Progress): void;
  clear(): void;
  /** The page is going away or out of sight: send unsent saves now. */
  flush(): void;
  /** The page is back in sight: pick up a newer board from another device. */
  refresh(): void;
  close(): void;
}

export interface SavesDeps {
  /** The logged-in account's sync once auth is known, or null for a guest. */
  readonly account: () => Promise<ProgressSync | null>;
  readonly guest: ProgressStore;
  readonly isBuiltIn: (id: string) => boolean;
}

/**
 * Where a puzzle's progress goes: built-in puzzles and guests use this device's guest store, as
 * before; a logged-in player's server puzzles sync with the account. Nothing is saved until
 * `load` has resolved, so a screen left early can't write an empty board anywhere.
 */
export function openSaves(
  deps: SavesDeps,
  puzzleId: string,
  grid: Grid,
  onremote: RemoteListener,
): PuzzleSaves {
  let sync: ProgressSync | null = null;
  let loaded = false;
  let closed = false;
  let unwatch = () => {};
  return {
    get synced() {
      return sync !== null;
    },
    async load() {
      if (!deps.isBuiltIn(puzzleId)) sync = await deps.account();
      loaded = true;
      if (sync === null) return deps.guest.load(puzzleId, grid);
      if (!closed) unwatch = sync.watch(puzzleId, grid, onremote);
      return sync.load(puzzleId, grid);
    },
    save(progress) {
      if (!loaded) return;
      if (sync === null) deps.guest.save(puzzleId, progress);
      else sync.save(puzzleId, progress);
    },
    clear() {
      if (!loaded) return;
      if (sync === null) deps.guest.clear(puzzleId);
      else sync.clear(puzzleId);
    },
    flush() {
      if (loaded) sync?.flush();
    },
    refresh() {
      if (loaded && !closed) void sync?.refresh(puzzleId);
    },
    close() {
      closed = true;
      unwatch();
    },
  };
}
