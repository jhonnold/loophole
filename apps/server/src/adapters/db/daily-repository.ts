import type { Database } from "bun:sqlite";
import type { DailyRecord } from "../../domain.ts";
import type { DailyRepository } from "../../ports.ts";

// A type alias, not an interface, so it satisfies bun:sqlite's binding type.
type DailyRow = {
  day: string;
  size: number;
  attempt: number;
  job_id: string;
  puzzle_id: string | null;
  generator_version: string | null;
  created_at: number;
};

const COLUMNS = "day, size, attempt, job_id, puzzle_id, generator_version, created_at";

/** Daily puzzles in SQLite, one row per UTC day and size class. */
export class SqliteDailyRepository implements DailyRepository {
  readonly #db: Database;
  readonly #get;
  readonly #getByPuzzle;
  readonly #listDay;
  readonly #insert;
  readonly #retry;
  readonly #setPuzzle;

  constructor(db: Database) {
    this.#db = db;
    this.#get = db.query<DailyRow, { day: string; size: number }>(
      `SELECT ${COLUMNS} FROM dailies WHERE day = $day AND size = $size`,
    );
    this.#getByPuzzle = db.query<DailyRow, { puzzle: string }>(
      `SELECT ${COLUMNS} FROM dailies WHERE puzzle_id = $puzzle`,
    );
    this.#listDay = db.query<DailyRow, { day: string }>(
      `SELECT ${COLUMNS} FROM dailies WHERE day = $day ORDER BY size`,
    );
    this.#insert = db.query<void, DailyRow>(
      `INSERT INTO dailies (${COLUMNS}) VALUES ($day, $size, $attempt, $job_id, $puzzle_id, $generator_version, $created_at) ON CONFLICT (day, size) DO NOTHING`,
    );
    this.#retry = db.query<void, { day: string; size: number; from: number; job: string }>(
      `UPDATE dailies SET attempt = $from + 1, job_id = $job
       WHERE day = $day AND size = $size AND attempt = $from AND puzzle_id IS NULL`,
    );
    this.#setPuzzle = db.query<
      void,
      { day: string; size: number; job: string; puzzle: string; version: string | null }
    >(
      `UPDATE dailies SET puzzle_id = $puzzle, generator_version = $version
       WHERE day = $day AND size = $size AND job_id = $job AND puzzle_id IS NULL`,
    );
  }

  get(day: string, size: number): DailyRecord | null {
    const row = this.#get.get({ day, size });
    return row === null ? null : fromRow(row);
  }

  getByPuzzle(puzzleId: string): DailyRecord | null {
    const row = this.#getByPuzzle.get({ puzzle: puzzleId });
    return row === null ? null : fromRow(row);
  }

  listDay(day: string): DailyRecord[] {
    return this.#listDay.all({ day }).map(fromRow);
  }

  insert(record: DailyRecord): boolean {
    return (
      this.#insert.run({
        day: record.day,
        size: record.size,
        attempt: record.attempt,
        job_id: record.jobId,
        puzzle_id: record.puzzleId,
        generator_version: record.generatorVersion,
        created_at: record.createdAt,
      }).changes === 1
    );
  }

  retry(day: string, size: number, fromAttempt: number, jobId: string): boolean {
    return this.#retry.run({ day, size, from: fromAttempt, job: jobId }).changes === 1;
  }

  setPuzzle(
    day: string,
    size: number,
    jobId: string,
    puzzleId: string,
    generatorVersion: string | null,
  ): boolean {
    const result = this.#setPuzzle.run({
      day,
      size,
      job: jobId,
      puzzle: puzzleId,
      version: generatorVersion,
    });
    return result.changes === 1;
  }

  atomically<T>(fn: () => T): T {
    return this.#db.transaction(fn).immediate();
  }
}

function fromRow(row: DailyRow): DailyRecord {
  return {
    day: row.day,
    size: row.size,
    attempt: row.attempt,
    jobId: row.job_id,
    puzzleId: row.puzzle_id,
    generatorVersion: row.generator_version,
    createdAt: row.created_at,
  };
}
