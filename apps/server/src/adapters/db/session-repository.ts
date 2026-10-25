import type { Database } from "bun:sqlite";
import type { SessionRecord } from "../../domain.ts";
import type { SessionRepository } from "../../ports.ts";

// A type alias, not an interface, so it satisfies bun:sqlite's binding type.
type SessionRow = {
  token_hash: string;
  user_id: string;
  created_at: number;
  expires_at: number;
};

const COLUMNS = "token_hash, user_id, created_at, expires_at";

/** Login sessions in SQLite, keyed by the hash of the cookie's token. */
export class SqliteSessionRepository implements SessionRepository {
  readonly #insert;
  readonly #get;
  readonly #delete;
  readonly #deleteForUser;
  readonly #deleteExpired;

  constructor(db: Database) {
    this.#insert = db.query<void, SessionRow>(
      `INSERT INTO sessions (${COLUMNS}) VALUES ($token_hash, $user_id, $created_at, $expires_at)`,
    );
    this.#get = db.query<SessionRow, { hash: string }>(
      `SELECT ${COLUMNS} FROM sessions WHERE token_hash = $hash`,
    );
    this.#delete = db.query<void, { hash: string }>(
      "DELETE FROM sessions WHERE token_hash = $hash",
    );
    this.#deleteForUser = db.query<void, { userId: string }>(
      "DELETE FROM sessions WHERE user_id = $userId",
    );
    this.#deleteExpired = db.query<void, { now: number }>(
      "DELETE FROM sessions WHERE expires_at <= $now",
    );
  }

  insert(s: SessionRecord): void {
    this.#insert.run({
      token_hash: s.tokenHash,
      user_id: s.userId,
      created_at: s.createdAt,
      expires_at: s.expiresAt,
    });
  }

  get(tokenHash: string): SessionRecord | null {
    const row = this.#get.get({ hash: tokenHash });
    return row === null
      ? null
      : {
          tokenHash: row.token_hash,
          userId: row.user_id,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
        };
  }

  delete(tokenHash: string): void {
    this.#delete.run({ hash: tokenHash });
  }

  deleteForUser(userId: string): void {
    this.#deleteForUser.run({ userId });
  }

  deleteExpired(now: number): void {
    this.#deleteExpired.run({ now });
  }
}
