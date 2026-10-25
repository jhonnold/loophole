import {
  createPuzzle,
  MAX_SIZE,
  MIN_SIZE,
  NO_CLUE,
  type Puzzle,
  parsePuzzle,
  serializePuzzle,
} from "@loophole/core";
import type { KeyValueStorage } from "../game/progress.ts";
import type { CellEdit } from "./keyboard.ts";

/** The puzzle being made in the editor (PRD FR-26): a size and a clue per cell. */
export interface Draft {
  readonly width: number;
  readonly height: number;
  /** One entry per cell, row-major: 0–3, or `NO_CLUE`. */
  readonly clues: Int8Array;
}

/** Where the editor keeps its one draft, in the wire format (docs/FORMAT.md). */
export const DRAFT_KEY = "loophole:editor-draft";

/** A new draft's size, as on the Editor artboard. */
export const DEFAULT_SIZE = 7;

export function createDraft(width = DEFAULT_SIZE, height = DEFAULT_SIZE): Draft {
  return { width, height, clues: new Int8Array(width * height).fill(NO_CLUE) };
}

/** A whole number from 1 to 100 typed into a size field, or null for anything else. */
export function parseSize(text: string): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null;
  const n = Number(text);
  return n >= MIN_SIZE && n <= MAX_SIZE ? n : null;
}

/** The draft at a new size. Clues in the part both sizes share stay where they were. */
export function resizeDraft(d: Draft, width: number, height: number): Draft {
  if (width === d.width && height === d.height) return d;
  const next = createDraft(width, height);
  for (let r = 0; r < Math.min(height, d.height); r++) {
    for (let c = 0; c < Math.min(width, d.width); c++) {
      next.clues[r * width + c] = d.clues[r * d.width + c];
    }
  }
  return next;
}

/** Sets one cell's clue (0–3, or `NO_CLUE` to erase). Returns `d` itself when nothing changes. */
export function setClue(d: Draft, cell: number, clue: number): Draft {
  if (d.clues[cell] === clue) return d;
  const clues = d.clues.slice();
  clues[cell] = clue;
  return { ...d, clues };
}

/** A tap on a cell: empty → 0 → 1 → 2 → 3 → empty. */
export function cycleClue(d: Draft, cell: number): Draft {
  const clue = d.clues[cell];
  return setClue(d, cell, clue === 3 ? NO_CLUE : clue + 1);
}

/** What a tap does: place the picked clue, erase, or (with nothing picked) cycle. */
export type Brush = 0 | 1 | 2 | 3 | "erase" | null;

export function brushEdit(brush: Brush): CellEdit {
  if (brush === null) return { type: "cycle" };
  if (brush === "erase") return { type: "erase" };
  return { type: "set", clue: brush };
}

/** Applies a key's or a tap's edit to one cell. */
export function editCell(d: Draft, cell: number, edit: CellEdit): Draft {
  switch (edit.type) {
    case "set":
      return setClue(d, cell, edit.clue);
    case "erase":
      return setClue(d, cell, NO_CLUE);
    case "cycle":
      return cycleClue(d, cell);
  }
}

export function clearClues(d: Draft): Draft {
  return createDraft(d.width, d.height);
}

export function clueCount(d: Draft): number {
  let n = 0;
  for (const clue of d.clues) if (clue !== NO_CLUE) n++;
  return n;
}

export function draftPuzzle(d: Draft): Puzzle {
  return createPuzzle(d.width, d.height, d.clues);
}

/** The saved draft, or null when there is none or it can't be read. */
export function loadDraft(storage: KeyValueStorage | null): Draft | null {
  try {
    const text = storage?.getItem(DRAFT_KEY);
    if (!text) return null;
    const puzzle = parsePuzzle(JSON.parse(text));
    return { width: puzzle.grid.width, height: puzzle.grid.height, clues: puzzle.clues };
  } catch {
    return null;
  }
}

/** Saves the draft. Storage errors (private mode, quota) are ignored. */
export function saveDraft(storage: KeyValueStorage | null, d: Draft): void {
  try {
    storage?.setItem(DRAFT_KEY, JSON.stringify(serializePuzzle(draftPuzzle(d))));
  } catch {
    // Losing a draft save must never break the editor.
  }
}
