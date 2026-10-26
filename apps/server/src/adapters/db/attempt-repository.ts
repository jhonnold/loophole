import type { Database } from "bun:sqlite";
import type { Level } from "@loophole/core";
import type { AttemptRecord, LeaderboardSlice } from "../../domain.ts";
import type { AttemptRepository } from "../../ports.ts";

// A type alias, not an interface, so it satisfies bun:sqlite's binding type.
type AttemptRow = {
  user_id: string;
  puzzle_id: string;
  day: string;
  area: number;
  level: Level;
  started_at: number;
  finished_at: number | null;
  time_ms: number | null;
  assisted: number;
  ranked: number;
};

type BoardRow = {
  user_id: string;
  time_ms: number;
  name: string | null;
  rank: number;
  total: number;
};

const COLUMNS =
  "user_id, puzzle_id, day, area, level, started_at, finished_at, time_ms, assisted, ranked";

/**
 * Picks the top `$limit` rows of a ranked `board` (user_id, time_ms, name, rank) and the rows
 * next to `$viewer`'s, with the board's size on every row.
 */
const SLICE = `
  mine AS (SELECT rank FROM board WHERE user_id = $viewer)
  SELECT user_id, time_ms, name, rank, (SELECT count(*) FROM board) AS total
  FROM board
  WHERE rank <= $limit
     OR rank BETWEEN (SELECT rank FROM mine) - 1 AND (SELECT rank FROM mine) + 1
  ORDER BY rank`;

/** Ranked attempts in SQLite, and leaderboards ranked with window functions. */
export class SqliteAttemptRepository implements AttemptRepository {
  readonly #get;
  readonly #insert;
  readonly #markAssisted;
  readonly #finish;
  readonly #listForDay;
  readonly #finishedDays;
  readonly #bests;
  readonly #puzzleBoard;
  readonly #bucketBoard;

  constructor(db: Database) {
    this.#get = db.query<AttemptRow, { user: string; puzzle: string }>(
      `SELECT ${COLUMNS} FROM attempts WHERE user_id = $user AND puzzle_id = $puzzle`,
    );
    this.#insert = db.query<void, AttemptRow>(
      `INSERT INTO attempts (${COLUMNS}) VALUES ($user_id, $puzzle_id, $day, $area, $level, $started_at, $finished_at, $time_ms, $assisted, $ranked)
       ON CONFLICT (user_id, puzzle_id) DO NOTHING`,
    );
    this.#markAssisted = db.query<void, { user: string; puzzle: string }>(
      "UPDATE attempts SET assisted = 1 WHERE user_id = $user AND puzzle_id = $puzzle AND finished_at IS NULL",
    );
    this.#finish = db.query<
      void,
      { user: string; puzzle: string; at: number; time: number; ranked: number }
    >(
      `UPDATE attempts SET finished_at = $at, time_ms = $time, ranked = $ranked
       WHERE user_id = $user AND puzzle_id = $puzzle AND finished_at IS NULL`,
    );
    this.#listForDay = db.query<AttemptRow, { user: string; day: string }>(
      `SELECT ${COLUMNS} FROM attempts WHERE user_id = $user AND day = $day ORDER BY area`,
    );
    this.#finishedDays = db.query<{ day: string }, { user: string }>(
      "SELECT DISTINCT day FROM attempts WHERE user_id = $user AND finished_at IS NOT NULL",
    );
    this.#bests = db.query<{ area: number; level: Level; time_ms: number }, { user: string }>(
      `SELECT area, level, MIN(time_ms) AS time_ms FROM attempts
       WHERE user_id = $user AND ranked = 1 GROUP BY area, level ORDER BY area, level`,
    );
    this.#puzzleBoard = db.query<
      BoardRow,
      { puzzle: string; viewer: string | null; limit: number }
    >(
      `WITH board AS (
         SELECT a.user_id, a.time_ms, d.name,
                ROW_NUMBER() OVER (ORDER BY a.time_ms, a.finished_at, a.user_id) AS rank
         FROM attempts a LEFT JOIN display_names d ON d.user_id = a.user_id
         WHERE a.puzzle_id = $puzzle AND a.ranked = 1
       ), ${SLICE}`,
    );
    // SQLite takes a bare column next to MIN() from the row that has the minimum, so
    // `finished_at` is when the player set their best time.
    this.#bucketBoard = db.query<
      BoardRow,
      { area: number; level: Level; viewer: string | null; limit: number }
    >(
      `WITH best AS (
         SELECT user_id, MIN(time_ms) AS time_ms, finished_at FROM attempts
         WHERE area = $area AND level = $level AND ranked = 1
         GROUP BY user_id
       ), board AS (
         SELECT b.user_id, b.time_ms, d.name,
                ROW_NUMBER() OVER (ORDER BY b.time_ms, b.finished_at, b.user_id) AS rank
         FROM best b LEFT JOIN display_names d ON d.user_id = b.user_id
       ), ${SLICE}`,
    );
  }

  get(userId: string, puzzleId: string): AttemptRecord | null {
    const row = this.#get.get({ user: userId, puzzle: puzzleId });
    return row === null ? null : fromRow(row);
  }

  insert(r: AttemptRecord): void {
    this.#insert.run({
      user_id: r.userId,
      puzzle_id: r.puzzleId,
      day: r.day,
      area: r.area,
      level: r.level,
      started_at: r.startedAt,
      finished_at: r.finishedAt,
      time_ms: r.timeMs,
      assisted: r.assisted ? 1 : 0,
      ranked: r.ranked ? 1 : 0,
    });
  }

  markAssisted(userId: string, puzzleId: string): void {
    this.#markAssisted.run({ user: userId, puzzle: puzzleId });
  }

  finish(
    userId: string,
    puzzleId: string,
    result: { finishedAt: number; timeMs: number; ranked: boolean },
  ): boolean {
    const { changes } = this.#finish.run({
      user: userId,
      puzzle: puzzleId,
      at: result.finishedAt,
      time: result.timeMs,
      ranked: result.ranked ? 1 : 0,
    });
    return changes === 1;
  }

  listForDay(userId: string, day: string): AttemptRecord[] {
    return this.#listForDay.all({ user: userId, day }).map(fromRow);
  }

  finishedDays(userId: string): string[] {
    return this.#finishedDays.all({ user: userId }).map((r) => r.day);
  }

  bests(userId: string): { area: number; level: Level; timeMs: number }[] {
    return this.#bests
      .all({ user: userId })
      .map((r) => ({ area: r.area, level: r.level, timeMs: r.time_ms }));
  }

  puzzleBoard(puzzleId: string, viewerId: string | null, limit: number): LeaderboardSlice {
    return toSlice(this.#puzzleBoard.all({ puzzle: puzzleId, viewer: viewerId, limit }));
  }

  bucketBoard(
    area: number,
    level: Level,
    viewerId: string | null,
    limit: number,
  ): LeaderboardSlice {
    return toSlice(this.#bucketBoard.all({ area, level, viewer: viewerId, limit }));
  }
}

function toSlice(rows: BoardRow[]): LeaderboardSlice {
  return {
    total: rows[0]?.total ?? 0,
    entries: rows.map((r) => ({
      rank: r.rank,
      userId: r.user_id,
      name: r.name,
      timeMs: r.time_ms,
    })),
  };
}

function fromRow(row: AttemptRow): AttemptRecord {
  return {
    userId: row.user_id,
    puzzleId: row.puzzle_id,
    day: row.day,
    area: row.area,
    level: row.level,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    timeMs: row.time_ms,
    assisted: row.assisted === 1,
    ranked: row.ranked === 1,
  };
}
