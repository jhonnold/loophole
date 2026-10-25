import type { Database } from "bun:sqlite";
import type { DisplayNameRepository } from "../../ports.ts";

/** Leaderboard names in SQLite; unique ignoring ASCII case. */
export class SqliteDisplayNameRepository implements DisplayNameRepository {
  readonly #get;
  readonly #upsert;
  readonly #delete;

  constructor(db: Database) {
    this.#get = db.query<{ name: string }, { user: string }>(
      "SELECT name FROM display_names WHERE user_id = $user",
    );
    this.#upsert = db.query<void, { user: string; name: string; now: number }>(
      `INSERT INTO display_names (user_id, name, updated_at) VALUES ($user, $name, $now)
       ON CONFLICT (user_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
    );
    this.#delete = db.query<void, { user: string }>(
      "DELETE FROM display_names WHERE user_id = $user",
    );
  }

  get(userId: string): string | null {
    return this.#get.get({ user: userId })?.name ?? null;
  }

  set(userId: string, name: string | null, now: number): boolean {
    if (name === null) {
      this.#delete.run({ user: userId });
      return true;
    }
    try {
      this.#upsert.run({ user: userId, name, now });
      return true;
    } catch (err) {
      // The unique index on the name: another player has it.
      if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) return false;
      throw err;
    }
  }
}
