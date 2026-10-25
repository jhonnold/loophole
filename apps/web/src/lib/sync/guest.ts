import { progressKey } from "../game/progress.ts";
import { type ImportOutcome, type ListableStorage, readSaved, type SavedBoard } from "./sync.ts";

const GUEST_PREFIX = progressKey("");

export interface GuestSave {
  readonly puzzleId: string;
  readonly saved: SavedBoard;
}

/**
 * Guest saves in this browser that an account could take: readable ones with at least one mark,
 * for puzzles the server may hold (not the built-in ones, whose progress stays on the device).
 */
export function guestSaves(
  storage: ListableStorage | null,
  isBuiltIn: (id: string) => boolean,
): GuestSave[] {
  if (storage === null) return [];
  const found: GuestSave[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key === null || !key.startsWith(GUEST_PREFIX)) continue;
      const puzzleId = key.slice(GUEST_PREFIX.length);
      if (puzzleId === "" || isBuiltIn(puzzleId)) continue;
      const saved = readSaved(storage, key);
      if (saved !== null && /[12]/.test(saved.edges)) found.push({ puzzleId, saved });
    }
  } catch {
    return [];
  }
  return found.sort((a, b) => a.puzzleId.localeCompare(b.puzzleId));
}

export interface ImportSummary {
  /** The guest's board is now the account's. */
  readonly imported: number;
  /** The account already had a board for the puzzle, and kept it (the guest's wasn't solved). */
  readonly kept: number;
  /** The server no longer has the puzzle, or refused the board. */
  readonly skipped: number;
  /** Stopped early because the server couldn't be reached; the rest stay for another try. */
  readonly failed: boolean;
}

/**
 * Brings this browser's guest saves into the account, one at a time, after the player asked to.
 * Each save leaves guest storage once the server has decided on it, so running this again only
 * sends what is left; the server's rules make a repeat harmless anyway.
 */
export async function importGuestSaves(
  importOne: (puzzleId: string, saved: SavedBoard) => Promise<ImportOutcome>,
  storage: ListableStorage | null,
  isBuiltIn: (id: string) => boolean,
): Promise<ImportSummary> {
  const counts = { imported: 0, kept: 0, skipped: 0 };
  for (const { puzzleId, saved } of guestSaves(storage, isBuiltIn)) {
    const outcome = await importOne(puzzleId, saved);
    if (outcome === "failed") return { ...counts, failed: true };
    counts[outcome]++;
    try {
      storage?.removeItem(progressKey(puzzleId));
    } catch {
      // Left behind; the next import sends it again, harmlessly.
    }
  }
  return { ...counts, failed: false };
}
