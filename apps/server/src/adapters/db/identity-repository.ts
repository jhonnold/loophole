import type { Database } from "bun:sqlite";
import type { IdentityRecord } from "../../domain.ts";
import type { IdentityRepository } from "../../ports.ts";

/** Single sign-on identities in SQLite. Deleting the user deletes them. */
export class SqliteIdentityRepository implements IdentityRepository {
  readonly #getUserId;
  readonly #insert;

  constructor(db: Database) {
    this.#getUserId = db.query<{ user_id: string }, { issuer: string; subject: string }>(
      "SELECT user_id FROM identities WHERE issuer = $issuer AND subject = $subject",
    );
    this.#insert = db.query<
      void,
      { issuer: string; subject: string; user_id: string; created_at: number }
    >(
      "INSERT INTO identities (issuer, subject, user_id, created_at) VALUES ($issuer, $subject, $user_id, $created_at) ON CONFLICT DO NOTHING",
    );
  }

  getUserId(issuer: string, subject: string): string | null {
    return this.#getUserId.get({ issuer, subject })?.user_id ?? null;
  }

  insert(identity: IdentityRecord): boolean {
    return (
      this.#insert.run({
        issuer: identity.issuer,
        subject: identity.subject,
        user_id: identity.userId,
        created_at: identity.createdAt,
      }).changes === 1
    );
  }
}
