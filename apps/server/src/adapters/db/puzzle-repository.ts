import type { Database } from "bun:sqlite";
import { type PuzzleWireV1, parsePuzzle, serializePuzzle } from "@loophole/core";
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
  level: number;
  origin: PuzzleOrigin;
  status: PuzzleStatus;
  solution_key: string;
  trace_key: string | null;
  created_at: number;
};

const COLUMNS =
  "id, width, height, clues, seed, generator_version, level, origin, status, solution_key, trace_key, created_at";

/** Puzzles in SQLite. Clues are stored as the wire format's clue string; only `meta.generator` is kept. */
export class SqlitePuzzleRepository implements PuzzleRepository {
  readonly #insert;
  readonly #get;
  readonly #listPublished;

  constructor(db: Database) {
    this.#insert = db.query<void, PuzzleRow>(
      `INSERT INTO puzzles (${COLUMNS}) VALUES ($id, $width, $height, $clues, $seed, $generator_version, $level, $origin, $status, $solution_key, $trace_key, $created_at) ON CONFLICT (id) DO NOTHING`,
    );
    this.#get = db.query<PuzzleRow, { id: string }>(
      `SELECT ${COLUMNS} FROM puzzles WHERE id = $id`,
    );
    this.#listPublished = db.query<PuzzleRow, { limit: number }>(
      `SELECT ${COLUMNS} FROM puzzles WHERE status = 'published' ORDER BY created_at DESC, id LIMIT $limit`,
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
  };
}

function fromRow(row: PuzzleRow): PuzzleRecord {
  const wire: PuzzleWireV1 = { v: 1, width: row.width, height: row.height, clues: row.clues };
  if (row.seed !== null) wire.seed = row.seed;
  if (row.generator_version !== null) wire.meta = { generator: row.generator_version };
  return {
    id: row.id,
    puzzle: parsePuzzle(wire),
    origin: row.origin,
    status: row.status,
    level: row.level,
    solutionKey: row.solution_key,
    traceKey: row.trace_key,
    createdAt: row.created_at,
  };
}
