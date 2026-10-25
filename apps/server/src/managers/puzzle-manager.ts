import { decodeEdges, type Puzzle, parsePuzzle, type Step } from "@loophole/core";
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
   * nothing, so a job that runs twice stores one puzzle. Returns `id`.
   */
  async saveGenerated(id: string, generated: GeneratedPuzzle): Promise<string> {
    const { puzzle, solution, steps } = generated;
    return this.#save(id, parsePuzzle(puzzle), solution, steps, "generated", null);
  }

  /**
   * Stores a player's verified puzzle under `id` as published, with `creatorId` as its creator
   * (PRD FR-27). Like `saveGenerated`: blobs first, and saving the same id again changes nothing.
   */
  async saveSubmitted(
    id: string,
    puzzle: Puzzle,
    solution: string,
    steps: readonly Step[],
    creatorId: string,
  ): Promise<string> {
    return this.#save(id, puzzle, solution, steps, "submitted", creatorId);
  }

  async #save(
    id: string,
    puzzle: Puzzle,
    solution: string,
    steps: readonly Step[],
    origin: PuzzleOrigin,
    creatorId: string | null,
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
      level: 1,
      solutionKey,
      traceKey,
      createdAt: clock.now(),
      creatorId,
    });
    return id;
  }

  /** A published puzzle, or null when there is none with this id. */
  get(id: string): PuzzleRecord | null {
    const record = this.#deps.puzzles.get(id);
    return record?.status === "published" ? record : null;
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
