import { analyzeBoard, decodeEdges, FormatError } from "@loophole/core";
import type { ProgressRecord, PuzzleRecord } from "../domain.ts";
import type { Clock, ProgressRepository } from "../ports.ts";
import { InvalidBoardError, PuzzleNotFoundError } from "./errors.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";

export interface ProgressManagerDeps {
  readonly progress: ProgressRepository;
  readonly puzzles: PuzzleManager;
  readonly clock: Clock;
}

/** What a client sends to save its board. Whether it is solved is worked out here. */
export interface ProgressInput {
  /** Edge states in the wire format's encoding. */
  readonly edges: string;
  readonly elapsedMs: number;
  readonly assisted: boolean;
  /** The version of the record this board continues from, or null if the client had none. */
  readonly baseVersion: number | null;
  /** Random id of the client's browser. */
  readonly device: string;
}

export interface SaveOutcome {
  /** The record stored after the save. */
  readonly record: ProgressRecord;
  /** False when the stored record was kept: it is solved, or the save was stale. */
  readonly accepted: boolean;
}

/** An unsolved record with its puzzle's size, for a "continue" list. */
export interface ProgressSummary {
  readonly record: ProgressRecord;
  readonly width: number;
  readonly height: number;
}

/**
 * Saved progress per player and puzzle, synced across devices (PRD FR-21). Two devices can save
 * different boards for one puzzle; `save` settles it the same way every time (DECISIONS,
 * "Progress conflicts"): a solved record stays until it is deleted; a save of the board already
 * stored only updates the play time; a solved board replaces an unsolved one; otherwise a save
 * replaces the record only if it continues from the stored version or comes from the device that
 * saved it, so a stale tab can't overwrite newer play from another device. `assisted` only ever
 * turns on.
 */
export class ProgressManager {
  readonly #deps: ProgressManagerDeps;

  constructor(deps: ProgressManagerDeps) {
    this.#deps = deps;
  }

  /** The user's record for a published puzzle, or null. Throws `PuzzleNotFoundError`. */
  get(userId: string, puzzleId: string): ProgressRecord | null {
    this.#puzzle(puzzleId);
    return this.#deps.progress.get(userId, puzzleId);
  }

  /**
   * Saves a board unless the stored record wins over it (see the class comment). Throws
   * `PuzzleNotFoundError`, or `InvalidBoardError` when `edges` does not fit the puzzle.
   */
  save(userId: string, puzzleId: string, input: ProgressInput): SaveOutcome {
    const { progress, clock } = this.#deps;
    const puzzle = this.#puzzle(puzzleId);
    let board: Uint8Array;
    try {
      board = decodeEdges(puzzle.puzzle.grid, input.edges);
    } catch (err) {
      if (err instanceof FormatError) throw new InvalidBoardError(err.message);
      throw err;
    }
    const solved = analyzeBoard(puzzle.puzzle, board).solved;
    const now = clock.now();
    const stored = progress.get(userId, puzzleId);
    if (stored === null) {
      const record: ProgressRecord = {
        userId,
        puzzleId,
        edges: input.edges,
        elapsedMs: input.elapsedMs,
        solved,
        assisted: input.assisted,
        version: 1,
        device: input.device,
        createdAt: now,
        updatedAt: now,
      };
      progress.put(record);
      return { record, accepted: true };
    }
    const assisted = stored.assisted || input.assisted;
    if (!stored.solved && input.edges === stored.edges) {
      // The same board (a tab hidden or left without a move): keep its version and device, so
      // the device that is playing doesn't find its next save stale. Play time never goes back.
      const record: ProgressRecord = {
        ...stored,
        elapsedMs: Math.max(stored.elapsedMs, input.elapsedMs),
        assisted,
        updatedAt: now,
      };
      progress.put(record);
      return { record, accepted: true };
    }
    const current = input.baseVersion === stored.version || input.device === stored.device;
    const accepted = !stored.solved && (solved || current);
    if (!accepted) {
      if (assisted === stored.assisted) return { record: stored, accepted: false };
      // Same version: the device whose board this is can carry on saving over it.
      const record = { ...stored, assisted, updatedAt: now };
      progress.put(record);
      return { record, accepted: false };
    }
    const record: ProgressRecord = {
      ...stored,
      edges: input.edges,
      elapsedMs: input.elapsedMs,
      solved,
      assisted,
      version: stored.version + 1,
      device: input.device,
      updatedAt: now,
    };
    progress.put(record);
    return { record, accepted: true };
  }

  /** Forgets the user's record for a puzzle ("Start over"). Unknown ids are ignored. */
  delete(userId: string, puzzleId: string): void {
    this.#deps.progress.delete(userId, puzzleId);
  }

  /** The user's unsolved records on published puzzles, most recently saved first. */
  listInProgress(userId: string, limit: number): ProgressSummary[] {
    const { progress, puzzles } = this.#deps;
    const summaries: ProgressSummary[] = [];
    for (const record of progress.listUnsolved(userId, limit)) {
      const puzzle = puzzles.get(record.puzzleId);
      if (puzzle === null) continue;
      const { width, height } = puzzle.puzzle.grid;
      summaries.push({ record, width, height });
    }
    return summaries;
  }

  #puzzle(id: string): PuzzleRecord {
    const puzzle = this.#deps.puzzles.get(id);
    if (puzzle === null) throw new PuzzleNotFoundError(id);
    return puzzle;
  }
}
