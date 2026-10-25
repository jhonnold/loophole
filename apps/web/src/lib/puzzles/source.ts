import type { Hint, Puzzle } from "@loophole/core";

export interface PuzzleSummary {
  /** Stable id; also the key for saved progress. */
  readonly id: string;
  /** Short display name, e.g. "Small". */
  readonly name: string;
  /** Second header line, e.g. "Practice". */
  readonly subtitle: string;
  readonly width: number;
  readonly height: number;
}

/** The header title, e.g. "Small · 7×7". */
export function puzzleTitle(p: PuzzleSummary): string {
  return `${p.name} · ${p.width}×${p.height}`;
}

export interface PuzzleEntry extends PuzzleSummary {
  readonly puzzle: Puzzle;
}

/**
 * Where the web app gets puzzles. The fixture source serves a few built-in puzzles; an API-backed
 * source replaces it once the server exists, without the screens changing.
 */
export interface PuzzleSource {
  list(): Promise<PuzzleSummary[]>;
  /** Resolves to null when there is no puzzle with this id. */
  get(id: string): Promise<PuzzleEntry | null>;
  /** The next hint for the player's board `edges` on puzzle `id` (PRD FR-12). */
  hint(id: string, puzzle: Puzzle, edges: Uint8Array): Promise<Hint>;
}
