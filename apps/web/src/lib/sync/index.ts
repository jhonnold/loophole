import { createApiClient, type Schemas } from "@loophole/api-client";
import type { Grid } from "@loophole/core";
import type { AuthState } from "../auth/auth.ts";
import { auth } from "../auth/index.ts";
import { browserStorage, createProgressStore, type Progress } from "../game/progress.ts";
import { isBuiltIn } from "../puzzles/fixtures.ts";
import { guestSaves, type ImportSummary, importGuestSaves } from "./guest.ts";
import { openSaves as open, type PuzzleSaves, settled } from "./saves.ts";
import {
  createProgressSync,
  forgetSynced,
  forgetUser,
  type ProgressSync,
  type RemoteListener,
} from "./sync.ts";

export type { PuzzleSaves } from "./saves.ts";

// The app's saved progress: guest storage for guests and built-in puzzles, and for a logged-in
// player one ProgressSync, replaced whenever the logged-in account changes.

const client = createApiClient();
const storage = browserStorage();
const guest = createProgressStore(storage);
let current: ProgressSync | null = null;

/** A random id for this browser, kept in storage (a new one per page if storage is blocked). */
function deviceId(): string {
  const key = "loophole:device";
  try {
    const id = storage?.getItem(key);
    if (id) return id;
    const fresh = crypto.randomUUID();
    storage?.setItem(key, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}
const device = deviceId();

function syncFor(state: AuthState): ProgressSync | null {
  if (state.status !== "user") {
    current?.close();
    current = null;
    return null;
  }
  if (current?.userId !== state.user.id) {
    current?.close();
    current = createProgressSync({
      client,
      storage,
      userId: state.user.id,
      device,
      // The session ended or changed in another tab: find out who is logged in now.
      onAuthLost: () => void auth.refresh(),
    });
  }
  return current;
}

// Saves made offline, or before a page closed, go out once the account is known again.
auth.subscribe((state) => {
  if (state.status !== "loading") void syncFor(state)?.pushPending();
});
if (typeof window !== "undefined") {
  window.addEventListener("online", () => void current?.pushPending());
}

async function account(): Promise<ProgressSync | null> {
  return syncFor(await settled(auth));
}

/** Saving and restoring one puzzle for the play screen. */
export function openSaves(puzzleId: string, grid: Grid, onremote: RemoteListener): PuzzleSaves {
  return open({ account, guest, isBuiltIn }, puzzleId, grid, onremote);
}

/** The progress on this device for the puzzle list: the account's copy, or the guest's. */
export async function localProgress(puzzleId: string, grid: Grid): Promise<Progress | null> {
  const sync = isBuiltIn(puzzleId) ? null : await account();
  return sync === null ? guest.load(puzzleId, grid) : sync.peek(puzzleId, grid);
}

/** The logged-in account's unsolved puzzles from the server; empty for guests or offline. */
export async function inProgress(): Promise<Schemas["ProgressSummary"][]> {
  return (await account())?.list() ?? [];
}

/** How many guest saves in this browser could be brought into an account. */
export function importableGuestSaves(): number {
  return guestSaves(storage, isBuiltIn).length;
}

/**
 * Brings this browser's guest saves into the account logged in as `userId`, only when the player
 * asks. Refuses if that is no longer who is logged in.
 */
export async function importGuestProgress(userId: string): Promise<ImportSummary> {
  const sync = await account();
  if (sync === null || sync.userId !== userId) {
    return { imported: 0, kept: 0, skipped: 0, failed: true };
  }
  return importGuestSaves((id, saved) => sync.importGuest(id, saved), storage, isBuiltIn);
}

/** After logout: drops this browser's copy of the account's synced boards, keeping unsent saves. */
export function forgetSyncedProgress(userId: string): void {
  if (current?.userId === userId) {
    current.close();
    current = null;
  }
  forgetSynced(storage, userId);
}

/** Removes this device's copy of a deleted account's progress (NFR-6). */
export function forgetAccount(userId: string): void {
  if (current?.userId === userId) {
    current.close();
    current = null;
  }
  forgetUser(storage, userId);
}
