import type { Database } from "bun:sqlite";
import {
  DEFAULT_LEVEL,
  type Level,
  type Puzzle,
  type PuzzleWireV1,
  parsePuzzle,
  serializePuzzle,
} from "@loophole/core";
import type { PuzzleOrigin, PuzzleRecord, PuzzleStatus } from "../../domain.ts";
import type { PuzzleRepository } from "../../ports.ts";

// A type alias, not an interface, so it satisfies bun:sqlite's binding type.
type PuzzleRow = {
  id: string;
  width: number;
  height: number;
  clues: string;
  seed: string | null;
  generator_version: string | null;
  level: Level;
  origin: PuzzleOrigin;
  status: PuzzleStatus;
  solution_key: string;
  trace_key: string | null;
  created_at: number;
  creator_id: string | null;
  release_at: number | null;
};

const COLUMNS =
  "id, width, height, clues, seed, generator_version, level, origin, status, solution_key, trace_key, created_at, creator_id, release_at";

/**
 * Puzzles in SQLite. Clues are stored as the wire format's clue string; of `meta`, only the
 * generator version is kept, in its own column. The level has its own column too, and a loaded
 * puzzle gets `meta.level` back from it (left out at hard, as the generator does), so hints use
 * the puzzle's level.
 */
export class SqlitePuzzleRepository implements PuzzleRepository {
  readonly #insert;
  readonly #get;
  readonly #listPublished;
  readonly #findByClues;
  readonly #setStatus;

  constructor(db: Database) {
    this.#insert = db.query<void, PuzzleRow>(
      `INSERT INTO puzzles (${COLUMNS}) VALUES ($id, $width, $height, $clues, $seed, $generator_version, $level, $origin, $status, $solution_key, $trace_key, $created_at, $creator_id, $release_at) ON CONFLICT (id) DO NOTHING`,
    );
    this.#get = db.query<PuzzleRow, { id: string }>(
      `SELECT ${COLUMNS} FROM puzzles WHERE id = $id`,
    );
    // Daily puzzles (the only ones with a release time) are listed on their own.
    this.#listPublished = db.query<PuzzleRow, { limit: number }>(
      `SELECT ${COLUMNS} FROM puzzles WHERE status = 'published' AND release_at IS NULL ORDER BY created_at DESC, id LIMIT $limit`,
    );
    this.#findByClues = db.query<PuzzleRow, { width: number; height: number; clues: string }>(
      `SELECT ${COLUMNS} FROM puzzles WHERE width = $width AND height = $height AND clues = $clues ORDER BY created_at, id LIMIT 1`,
    );
    this.#setStatus = db.query<void, { id: string; status: PuzzleStatus }>(
      "UPDATE puzzles SET status = $status WHERE id = $id",
    );
  }

  insert(record: PuzzleRecord): void {
    this.#insert.run(toRow(record));
  }

  get(id: string): PuzzleRecord | null {
    const row = this.#get.get({ id });
    return row === null ? null : fromRow(row);
  }

  listPublished(limit: number): PuzzleRecord[] {
    return this.#listPublished.all({ limit }).map(fromRow);
  }

  findByClues(puzzle: Puzzle): PuzzleRecord | null {
    const { width, height, clues } = serializePuzzle(puzzle);
    const row = this.#findByClues.get({ width, height, clues });
    return row === null ? null : fromRow(row);
  }

  setStatus(id: string, status: PuzzleStatus): boolean {
    return this.#setStatus.run({ id, status }).changes === 1;
  }
}

function toRow(r: PuzzleRecord): PuzzleRow {
  const wire = serializePuzzle(r.puzzle);
  return {
    id: r.id,
    width: wire.width,
    height: wire.height,
    clues: wire.clues,
    seed: wire.seed ?? null,
    generator_version: wire.meta?.generator ?? null,
    level: r.level,
    origin: r.origin,
    status: r.status,
    solution_key: r.solutionKey,
    trace_key: r.traceKey,
    created_at: r.createdAt,
    creator_id: r.creatorId,
    release_at: r.releaseAt,
  };
}

function fromRow(row: PuzzleRow): PuzzleRecord {
  const wire: PuzzleWireV1 = { v: 1, width: row.width, height: row.height, clues: row.clues };
  if (row.seed !== null) wire.seed = row.seed;
  const meta: Record<string, string> = {};
  if (row.generator_version !== null) meta.generator = row.generator_version;
  if (row.level !== DEFAULT_LEVEL) meta.level = row.level;
  if (Object.keys(meta).length > 0) wire.meta = meta;
  return {
    id: row.id,
    puzzle: parsePuzzle(wire),
    origin: row.origin,
    status: row.status,
    level: row.level,
    solutionKey: row.solution_key,
    traceKey: row.trace_key,
    createdAt: row.created_at,
    creatorId: row.creator_id,
    releaseAt: row.release_at,
  };
}
