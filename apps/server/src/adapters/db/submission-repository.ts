import type { Database } from "bun:sqlite";
import { parsePuzzle, serializePuzzle } from "@loophole/core";
import type { SubmissionRecord, SubmissionStatus, SubmissionVerdict } from "../../domain.ts";
import type { SubmissionDecision, SubmissionRepository } from "../../ports.ts";

// A type alias, not an interface, so it satisfies bun:sqlite's binding type.
type SubmissionRow = {
  id: string;
  user_id: string;
  width: number;
  height: number;
  clues: string;
  status: SubmissionStatus;
  verdict: SubmissionVerdict | null;
  puzzle_id: string | null;
  job_id: string | null;
  created_at: number;
  decided_at: number | null;
};

const COLUMNS =
  "id, user_id, width, height, clues, status, verdict, puzzle_id, job_id, created_at, decided_at";

/** Players' submissions in SQLite, with the clues as the wire format's clue string. */
export class SqliteSubmissionRepository implements SubmissionRepository {
  readonly #insert;
  readonly #get;
  readonly #listForUser;
  readonly #decide;
  readonly #countByVerdict;

  constructor(db: Database) {
    this.#insert = db.query<void, SubmissionRow>(
      `INSERT INTO submissions (${COLUMNS}) VALUES ($id, $user_id, $width, $height, $clues, $status, $verdict, $puzzle_id, $job_id, $created_at, $decided_at)`,
    );
    this.#get = db.query<SubmissionRow, { id: string }>(
      `SELECT ${COLUMNS} FROM submissions WHERE id = $id`,
    );
    this.#listForUser = db.query<SubmissionRow, { user: string; limit: number }>(
      `SELECT ${COLUMNS} FROM submissions WHERE user_id = $user ORDER BY created_at DESC, id LIMIT $limit`,
    );
    this.#decide = db.query<
      void,
      {
        id: string;
        status: SubmissionStatus;
        verdict: SubmissionVerdict;
        puzzle: string | null;
        at: number;
      }
    >(
      `UPDATE submissions SET status = $status, verdict = $verdict, puzzle_id = $puzzle, decided_at = $at
       WHERE id = $id AND status = 'pending'`,
    );
    this.#countByVerdict = db.query<{ verdict: SubmissionVerdict; n: number }, []>(
      "SELECT verdict, count(*) AS n FROM submissions WHERE status <> 'pending' GROUP BY verdict",
    );
  }

  insert(record: SubmissionRecord): void {
    this.#insert.run(toRow(record));
  }

  get(id: string): SubmissionRecord | null {
    const row = this.#get.get({ id });
    return row === null ? null : fromRow(row);
  }

  listForUser(userId: string, limit: number): SubmissionRecord[] {
    return this.#listForUser.all({ user: userId, limit }).map(fromRow);
  }

  decide(id: string, d: SubmissionDecision): boolean {
    const result = this.#decide.run({
      id,
      status: d.status,
      verdict: d.verdict,
      puzzle: d.puzzleId,
      at: d.decidedAt,
    });
    return result.changes === 1;
  }

  countByVerdict(): Partial<Record<SubmissionVerdict, number>> {
    return Object.fromEntries(this.#countByVerdict.all().map((r) => [r.verdict, r.n]));
  }
}

function toRow(r: SubmissionRecord): SubmissionRow {
  const { width, height, clues } = serializePuzzle(r.puzzle);
  return {
    id: r.id,
    user_id: r.userId,
    width,
    height,
    clues,
    status: r.status,
    verdict: r.verdict,
    puzzle_id: r.puzzleId,
    job_id: r.jobId,
    created_at: r.createdAt,
    decided_at: r.decidedAt,
  };
}

function fromRow(row: SubmissionRow): SubmissionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    puzzle: parsePuzzle({ v: 1, width: row.width, height: row.height, clues: row.clues }),
    status: row.status,
    verdict: row.verdict,
    puzzleId: row.puzzle_id,
    jobId: row.job_id,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}
