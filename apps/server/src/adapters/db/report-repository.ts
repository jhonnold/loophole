import type { Database } from "bun:sqlite";
import type { ReportRecord } from "../../domain.ts";
import type { ReportRepository } from "../../ports.ts";

// A type alias, not an interface, so it satisfies bun:sqlite's binding type.
type ReportRow = {
  puzzle_id: string;
  reporter_id: string;
  reason: string;
  created_at: number;
};

/** Players' reports of puzzles in SQLite: one row per reporter and puzzle. */
export class SqliteReportRepository implements ReportRepository {
  readonly #upsert;
  readonly #listForPublished;
  readonly #deleteForPuzzle;

  constructor(db: Database) {
    this.#upsert = db.query<void, ReportRow>(
      `INSERT INTO reports (puzzle_id, reporter_id, reason, created_at)
       VALUES ($puzzle_id, $reporter_id, $reason, $created_at)
       ON CONFLICT (puzzle_id, reporter_id) DO UPDATE SET reason = excluded.reason, created_at = excluded.created_at`,
    );
    this.#listForPublished = db.query<ReportRow, { limit: number }>(
      `SELECT r.puzzle_id, r.reporter_id, r.reason, r.created_at
       FROM reports r JOIN puzzles p ON p.id = r.puzzle_id
       WHERE p.status = 'published'
       ORDER BY r.created_at DESC, r.puzzle_id, r.reporter_id LIMIT $limit`,
    );
    this.#deleteForPuzzle = db.query<void, { puzzle: string }>(
      "DELETE FROM reports WHERE puzzle_id = $puzzle",
    );
  }

  upsert(report: ReportRecord): void {
    this.#upsert.run({
      puzzle_id: report.puzzleId,
      reporter_id: report.reporterId,
      reason: report.reason,
      created_at: report.createdAt,
    });
  }

  listForPublished(limit: number): ReportRecord[] {
    return this.#listForPublished.all({ limit }).map((row) => ({
      puzzleId: row.puzzle_id,
      reporterId: row.reporter_id,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  }

  deleteForPuzzle(puzzleId: string): void {
    this.#deleteForPuzzle.run({ puzzle: puzzleId });
  }
}
