import { decodeEdges, encodeEdges, type Grid } from "@loophole/core";

/** The parts of the Web Storage API the progress store uses; `localStorage` fits. */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A guest's in-progress or finished attempt at one puzzle (FR-21, guest part). */
export interface Progress {
  readonly edges: Uint8Array;
  readonly elapsedMs: number;
  readonly solved: boolean;
  /** A hint was shown during this attempt (PRD FR-12). */
  readonly assisted: boolean;
}

interface StoredProgressV1 {
  v: 1;
  edges: string;
  elapsedMs: number;
  solved: boolean;
  /** Missing in saves from before hints, which had none. */
  assisted?: boolean;
}

const PREFIX = "loophole:progress:";

export function progressKey(puzzleId: string): string {
  return PREFIX + puzzleId;
}

/**
 * `localStorage`, or null when the browser refuses it. Reading the global can itself throw (Chromium
 * does so when site data is blocked), so components must go through this rather than touch it.
 */
export function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Saves and restores progress per puzzle id in browser storage. Storage errors (private mode, quota)
 * are swallowed: losing a save must never break play. Anything unreadable loads as null.
 */
export interface ProgressStore {
  load(puzzleId: string, grid: Grid): Progress | null;
  save(puzzleId: string, progress: Progress): void;
  clear(puzzleId: string): void;
}

export function createProgressStore(storage: KeyValueStorage | null): ProgressStore {
  return {
    load(puzzleId, grid) {
      try {
        const text = storage?.getItem(progressKey(puzzleId));
        if (!text) return null;
        const data = JSON.parse(text) as Partial<StoredProgressV1>;
        if (data.v !== 1 || typeof data.edges !== "string") return null;
        const elapsedMs =
          typeof data.elapsedMs === "number" &&
          Number.isFinite(data.elapsedMs) &&
          data.elapsedMs > 0
            ? data.elapsedMs
            : 0;
        return {
          edges: decodeEdges(grid, data.edges),
          elapsedMs,
          solved: data.solved === true,
          assisted: data.assisted === true,
        };
      } catch {
        return null;
      }
    },
    save(puzzleId, progress) {
      const data: StoredProgressV1 = {
        v: 1,
        edges: encodeEdges(progress.edges),
        elapsedMs: Math.round(progress.elapsedMs),
        solved: progress.solved,
        assisted: progress.assisted,
      };
      try {
        storage?.setItem(progressKey(puzzleId), JSON.stringify(data));
      } catch {
        // Quota or private mode: keep playing without saving.
      }
    },
    clear(puzzleId) {
      try {
        storage?.removeItem(progressKey(puzzleId));
      } catch {
        // Nothing to do.
      }
    },
  };
}
