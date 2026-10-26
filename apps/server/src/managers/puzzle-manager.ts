import {
  DEFAULT_LEVEL,
  decodeEdges,
  type Level,
  type Puzzle,
  type PuzzleWireV1,
  parsePuzzle,
  puzzleLevel,
  type Step,
  serializePuzzle,
} from "@loophole/core";
import type { GeneratedPuzzle, PuzzleOrigin, PuzzleRecord } from "../domain.ts";
import type { BlobStore, Clock, PuzzleRepository } from "../ports.ts";

export interface PuzzleManagerDeps {
  readonly puzzles: PuzzleRepository;
  readonly blobs: BlobStore;
  readonly clock: Clock;
}

/**
 * Stores and serves puzzles. Players only ever get clues: solutions stay in the blob store and
 * are read back only through `getSolution`, for server-side checks (PRD FR-25).
 */
export class PuzzleManager {
  readonly #deps: PuzzleManagerDeps;

  constructor(deps: PuzzleManagerDeps) {
    this.#deps = deps;
  }

  /**
   * Stores a generated puzzle under `id` as published: solution and trace go to the blob store
   * first, so a stored row never points at a missing blob. Saving the same id again changes
   * nothing, so a job that runs twice stores one puzzle. Its level is the one the generator put in
   * `meta.level` (PRD FR-7), which may be above the level asked for on a tiny board. Returns `id`.
   */
  async saveGenerated(id: string, generated: GeneratedPuzzle): Promise<string> {
    const { solution, steps } = generated;
    const puzzle = parsePuzzle(generated.puzzle);
    return this.#save(id, puzzle, puzzleLevel(puzzle), solution, steps, "generated", null, null);
  }

  /**
   * Stores a generated daily puzzle (PRD FR-22) that players can't see before `releaseAt`. Its
   * seed and generator version are left out, since with them anyone could rebuild the solution
   * (DECISIONS, WT6 "Puzzle storage"); the daily's own record keeps them. Its level is kept. Like
   * `saveGenerated` otherwise. Returns `id`.
   */
  async saveDaily(id: string, generated: GeneratedPuzzle, releaseAt: number): Promise<string> {
    const { solution, steps } = generated;
    const level = puzzleLevel(parsePuzzle(generated.puzzle));
    const puzzle = cluesOnly(generated.puzzle, level);
    return this.#save(id, puzzle, level, solution, steps, "generated", null, releaseAt);
  }

  /**
   * Stores a player's verified puzzle under `id` as published, with `creatorId` as its creator
   * (PRD FR-27). Like `saveGenerated`: blobs first, and saving the same id again changes nothing.
   * Only its clues are kept, and its level is hard whatever its `meta` says: the level of a
   * submitted puzzle is never taken from the player.
   */
  async saveSubmitted(
    id: string,
    puzzle: Puzzle,
    solution: string,
    steps: readonly Step[],
    creatorId: string,
  ): Promise<string> {
    const clues = cluesOnly(serializePuzzle(puzzle), DEFAULT_LEVEL);
    return this.#save(id, clues, DEFAULT_LEVEL, solution, steps, "submitted", creatorId, null);
  }

  async #save(
    id: string,
    puzzle: Puzzle,
    level: Level,
    solution: string,
    steps: readonly Step[],
    origin: PuzzleOrigin,
    creatorId: string | null,
    releaseAt: number | null,
  ): Promise<string> {
    const { puzzles, blobs, clock } = this.#deps;
    if (puzzles.get(id) !== null) return id;
    const solutionKey = `puzzles/${id}/solution.txt`;
    const traceKey = `puzzles/${id}/trace.json`;
    await blobs.put(solutionKey, solution, "text/plain");
    await blobs.put(traceKey, JSON.stringify({ v: 1, steps }), "application/json");
    puzzles.insert({
      id,
      puzzle,
      origin,
      status: "published",
      level,
      solutionKey,
      traceKey,
      createdAt: clock.now(),
      creatorId,
      releaseAt,
    });
    return id;
  }

  /**
   * A published puzzle that players may see, or null when there is none with this id. A daily
   * puzzle stays hidden until its release time (00:00 UTC on its day).
   */
  get(id: string): PuzzleRecord | null {
    const record = this.#deps.puzzles.get(id);
    if (record?.status !== "published") return null;
    if (record.releaseAt !== null && record.releaseAt > this.#deps.clock.now()) return null;
    return record;
  }

  /** A puzzle whether published or not, for admins; null when there is none with this id. */
  getAny(id: string): PuzzleRecord | null {
    return this.#deps.puzzles.get(id);
  }

  /** A stored puzzle, published or not, with the same size and clues; null if none. */
  findByClues(puzzle: Puzzle): PuzzleRecord | null {
    return this.#deps.puzzles.findByClues(puzzle);
  }

  /**
   * Takes a puzzle out of lists and out of reach of players (PRD FR-28). Returns false when there
   * is no puzzle with this id.
   */
  unpublish(id: string): boolean {
    return this.#deps.puzzles.setStatus(id, "unpublished");
  }

  /** The newest published puzzles, newest first. */
  listRecent(limit: number): PuzzleRecord[] {
    return this.#deps.puzzles.listPublished(limit);
  }

  /**
   * The stored solution of any puzzle, published or not, as edge states. For server-side use
   * only (ranked validation, hints); never send it to a client for a ranked puzzle.
   */
  async getSolution(id: string): Promise<Uint8Array | null> {
    const record = this.#deps.puzzles.get(id);
    if (record === null) return null;
    const text = await this.#deps.blobs.get(record.solutionKey);
    return text === null ? null : decodeEdges(record.puzzle.grid, text);
  }
}

/**
 * The puzzle's clues, with `meta.level` when `level` is below the default (as `generate` writes
 * it), and no seed or other metadata.
 */
function cluesOnly({ width, height, clues }: PuzzleWireV1, level: Level): Puzzle {
  const wire: PuzzleWireV1 = { v: 1, width, height, clues };
  if (level !== DEFAULT_LEVEL) wire.meta = { level };
  return parsePuzzle(wire);
}
