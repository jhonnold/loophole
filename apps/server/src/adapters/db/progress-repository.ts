import type { Database } from "bun:sqlite";
import type { ProgressRecord } from "../../domain.ts";
import type { ProgressRepository } from "../../ports.ts";

// A type alias, not an interface, so it satisfies bun:sqlite's binding type.
type ProgressRow = {
  user_id: string;
  puzzle_id: string;
  edges: string;
  elapsed_ms: number;
  solved: number;
  assisted: number;
  version: number;
  device: string;
  created_at: number;
  updated_at: number;
};

const COLUMNS =
  "user_id, puzzle_id, edges, elapsed_ms, solved, assisted, version, device, created_at, updated_at";

/** Saved progress in SQLite, keyed by user and puzzle. */
export class SqliteProgressRepository implements ProgressRepository {
  readonly #get;
  readonly #put;
  readonly #delete;
  readonly #listUnsolved;

  constructor(db: Database) {
    this.#get = db.query<ProgressRow, { userId: string; puzzleId: string }>(
      `SELECT ${COLUMNS} FROM progress WHERE user_id = $userId AND puzzle_id = $puzzleId`,
    );
    this.#put = db.query<void, ProgressRow>(
      `INSERT OR REPLACE INTO progress (${COLUMNS}) VALUES ($user_id, $puzzle_id, $edges, $elapsed_ms, $solved, $assisted, $version, $device, $created_at, $updated_at)`,
    );
    this.#delete = db.query<void, { userId: string; puzzleId: string }>(
      "DELETE FROM progress WHERE user_id = $userId AND puzzle_id = $puzzleId",
    );
    this.#listUnsolved = db.query<ProgressRow, { userId: string; limit: number }>(
      `SELECT ${COLUMNS} FROM progress WHERE user_id = $userId AND solved = 0 ORDER BY updated_at DESC, puzzle_id LIMIT $limit`,
    );
  }

  get(userId: string, puzzleId: string): ProgressRecord | null {
    const row = this.#get.get({ userId, puzzleId });
    return row === null ? null : fromRow(row);
  }

  put(record: ProgressRecord): void {
    this.#put.run({
      user_id: record.userId,
      puzzle_id: record.puzzleId,
      edges: record.edges,
      elapsed_ms: record.elapsedMs,
      solved: record.solved ? 1 : 0,
      assisted: record.assisted ? 1 : 0,
      version: record.version,
      device: record.device,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    });
  }

  delete(userId: string, puzzleId: string): void {
    this.#delete.run({ userId, puzzleId });
  }

  listUnsolved(userId: string, limit: number): ProgressRecord[] {
    return this.#listUnsolved.all({ userId, limit }).map(fromRow);
  }
}

function fromRow(row: ProgressRow): ProgressRecord {
  return {
    userId: row.user_id,
    puzzleId: row.puzzle_id,
    edges: row.edges,
    elapsedMs: row.elapsed_ms,
    solved: row.solved === 1,
    assisted: row.assisted === 1,
    version: row.version,
    device: row.device,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
