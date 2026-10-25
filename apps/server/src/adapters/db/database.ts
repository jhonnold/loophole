import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

/**
 * Opens (creating if needed) the SQLite database at `path`, or an in-memory one for ":memory:",
 * and applies any pending migrations.
 */
export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA busy_timeout = 5000");
  enableWal(db);
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

/**
 * Switches to write-ahead logging. The switch needs an exclusive lock and SQLite does not wait
 * for it (no busy handler), so when several processes open a new file at once some get "database
 * is locked": retry those for up to about a second.
 */
function enableWal(db: Database): void {
  for (let attempt = 1; ; attempt++) {
    try {
      db.run("PRAGMA journal_mode = WAL");
      return;
    } catch (err) {
      const locked = err instanceof Error && err.message.includes("database is locked");
      if (!locked || attempt >= 50) throw err;
      Bun.sleepSync(20);
    }
  }
}

/**
 * Applies the numbered `.sql` files in `migrations/` that have not run yet, in order, each in its
 * own transaction. Safe when several processes start at once: the check runs under a write lock.
 */
export function migrate(db: Database, dir = MIGRATIONS_DIR): void {
  db.run(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL) STRICT",
  );
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
  const applied = db.query<{ version: number }, []>("SELECT version FROM schema_migrations");
  const record = db.query(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES ($version, $name, $now)",
  );
  for (const file of files) {
    const version = Number.parseInt(file, 10);
    db.transaction(() => {
      if (applied.all().some((row) => row.version === version)) return;
      db.run(readFileSync(join(dir, file), "utf8"));
      record.run({ version, name: file, now: Date.now() });
    }).immediate();
  }
}
