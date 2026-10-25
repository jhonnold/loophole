import type { Database } from "bun:sqlite";
import type { UserRecord } from "../../domain.ts";
import type { UserRepository } from "../../ports.ts";

// A type alias, not an interface, so it satisfies bun:sqlite's binding type.
type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  email_verified_at: number | null;
  is_admin: number;
  created_at: number;
};

const COLUMNS = "id, email, password_hash, email_verified_at, is_admin, created_at";

/** Users in SQLite. Deleting a user cascades to their sessions, tokens and gameplay rows. */
export class SqliteUserRepository implements UserRepository {
  readonly #insert;
  readonly #get;
  readonly #getByEmail;
  readonly #setPasswordHash;
  readonly #markEmailVerified;
  readonly #setAdmin;
  readonly #delete;

  constructor(db: Database) {
    this.#insert = db.query<void, UserRow>(
      `INSERT INTO users (${COLUMNS}) VALUES ($id, $email, $password_hash, $email_verified_at, $is_admin, $created_at) ON CONFLICT (email) DO NOTHING`,
    );
    this.#get = db.query<UserRow, { id: string }>(`SELECT ${COLUMNS} FROM users WHERE id = $id`);
    this.#getByEmail = db.query<UserRow, { email: string }>(
      `SELECT ${COLUMNS} FROM users WHERE email = $email`,
    );
    this.#setPasswordHash = db.query<void, { id: string; hash: string }>(
      "UPDATE users SET password_hash = $hash WHERE id = $id",
    );
    this.#markEmailVerified = db.query<void, { id: string; at: number }>(
      "UPDATE users SET email_verified_at = $at WHERE id = $id AND email_verified_at IS NULL",
    );
    this.#setAdmin = db.query<void, { email: string; admin: number }>(
      "UPDATE users SET is_admin = $admin WHERE email = $email",
    );
    this.#delete = db.query<void, { id: string }>("DELETE FROM users WHERE id = $id");
  }

  insert(user: UserRecord): boolean {
    return this.#insert.run(toRow(user)).changes === 1;
  }

  get(id: string): UserRecord | null {
    const row = this.#get.get({ id });
    return row === null ? null : fromRow(row);
  }

  getByEmail(email: string): UserRecord | null {
    const row = this.#getByEmail.get({ email });
    return row === null ? null : fromRow(row);
  }

  setPasswordHash(id: string, passwordHash: string): void {
    this.#setPasswordHash.run({ id, hash: passwordHash });
  }

  markEmailVerified(id: string, at: number): void {
    this.#markEmailVerified.run({ id, at });
  }

  setAdmin(email: string, isAdmin: boolean): boolean {
    return this.#setAdmin.run({ email, admin: isAdmin ? 1 : 0 }).changes === 1;
  }

  delete(id: string): void {
    this.#delete.run({ id });
  }
}

function toRow(u: UserRecord): UserRow {
  return {
    id: u.id,
    email: u.email,
    password_hash: u.passwordHash,
    email_verified_at: u.emailVerifiedAt,
    is_admin: u.isAdmin ? 1 : 0,
    created_at: u.createdAt,
  };
}

function fromRow(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    emailVerifiedAt: row.email_verified_at,
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
  };
}
