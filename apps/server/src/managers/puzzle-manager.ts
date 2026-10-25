import { decodeEdges, parsePuzzle } from "@loophole/core";
import type { GeneratedPuzzle, PuzzleRecord } from "../domain.ts";
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
    const { puzzles, blobs, clock } = this.#deps;
    if (puzzles.get(id) !== null) return id;
    const solutionKey = `puzzles/${id}/solution.txt`;
    const traceKey = `puzzles/${id}/trace.json`;
    await blobs.put(solutionKey, generated.solution, "text/plain");
    await blobs.put(traceKey, JSON.stringify({ v: 1, steps: generated.steps }), "application/json");
    puzzles.insert({
      id,
      puzzle: parsePuzzle(generated.puzzle),
      origin: "generated",
      status: "published",
      level: 1,
      solutionKey,
      traceKey,
      createdAt: clock.now(),
    });
    return id;
  }

  /** A published puzzle, or null when there is none with this id. */
  get(id: string): PuzzleRecord | null {
    const record = this.#deps.puzzles.get(id);
    return record?.status === "published" ? record : null;
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
