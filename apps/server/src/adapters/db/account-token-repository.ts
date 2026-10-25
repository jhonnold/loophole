import type { Database } from "bun:sqlite";
import type { AccountTokenPurpose, AccountTokenRecord } from "../../domain.ts";
import type { AccountTokenRepository } from "../../ports.ts";

// A type alias, not an interface, so it satisfies bun:sqlite's binding type.
type TokenRow = {
  token_hash: string;
  user_id: string;
  purpose: AccountTokenPurpose;
  created_at: number;
  expires_at: number;
};

const COLUMNS = "token_hash, user_id, purpose, created_at, expires_at";

/** Email verification and password reset tokens in SQLite, keyed by the token's hash. */
export class SqliteAccountTokenRepository implements AccountTokenRepository {
  readonly #replace;
  readonly #take;
  readonly #deleteExpired;

  constructor(db: Database) {
    const dropOthers = db.query<void, { user_id: string; purpose: AccountTokenPurpose }>(
      "DELETE FROM account_tokens WHERE user_id = $user_id AND purpose = $purpose",
    );
    const insert = db.query<void, TokenRow>(
      `INSERT INTO account_tokens (${COLUMNS}) VALUES ($token_hash, $user_id, $purpose, $created_at, $expires_at)`,
    );
    this.#replace = db.transaction((row: TokenRow) => {
      dropOthers.run({ user_id: row.user_id, purpose: row.purpose });
      insert.run(row);
    });
    this.#take = db.query<TokenRow, { hash: string; purpose: AccountTokenPurpose }>(
      `DELETE FROM account_tokens WHERE token_hash = $hash AND purpose = $purpose RETURNING ${COLUMNS}`,
    );
    this.#deleteExpired = db.query<void, { now: number }>(
      "DELETE FROM account_tokens WHERE expires_at <= $now",
    );
  }

  replace(t: AccountTokenRecord): void {
    this.#replace({
      token_hash: t.tokenHash,
      user_id: t.userId,
      purpose: t.purpose,
      created_at: t.createdAt,
      expires_at: t.expiresAt,
    });
  }

  take(tokenHash: string, purpose: AccountTokenPurpose): AccountTokenRecord | null {
    const row = this.#take.get({ hash: tokenHash, purpose });
    return row === null
      ? null
      : {
          tokenHash: row.token_hash,
          userId: row.user_id,
          purpose: row.purpose,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
        };
  }

  deleteExpired(now: number): void {
    this.#deleteExpired.run({ now });
  }
}
