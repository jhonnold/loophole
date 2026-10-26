import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "./database.ts";

// Migrations that change rows already stored: each test builds the schema as it was before the
// migration from the numbered files, adds rows as the code of that time wrote them, then migrates
// to the latest schema.

const MIGRATIONS = join(import.meta.dir, "migrations");

/** A database with the migrations numbered below `version` applied, and `seed` run on it. */
function migratedFrom(version: number, seed: (db: Database) => void): Database {
  const dir = mkdtempSync(join(tmpdir(), "loophole-migrations-"));
  try {
    for (const f of readdirSync(MIGRATIONS).filter((f) => /^\d+_.+\.sql$/.test(f))) {
      if (Number.parseInt(f, 10) < version) copyFileSync(join(MIGRATIONS, f), join(dir, f));
    }
    const db = new Database(":memory:", { strict: true });
    db.run("PRAGMA foreign_keys = ON");
    migrate(db, dir);
    seed(db);
    migrate(db);
    return db;
  } finally {
    rmSync(dir, { recursive: true });
  }
}

describe("007: levels", () => {
  test("puzzles and attempts stored before levels (level 1) are hard", () => {
    const db = migratedFrom(7, (db) => {
      db.run(
        "INSERT INTO puzzles (id, width, height, clues, level, origin, status, solution_key, created_at) VALUES ('p1', 1, 1, '.', 1, 'generated', 'published', 'k', 1)",
      );
      db.run(
        "INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'a@example.com', 'h', 1)",
      );
      db.run(
        "INSERT INTO attempts (user_id, puzzle_id, day, area, level, started_at, finished_at, time_ms, assisted, ranked) VALUES ('u1', 'p1', '2026-10-26', 1, 1, 1, 2, 1, 0, 1)",
      );
    });
    expect(db.query("SELECT level FROM puzzles").all()).toEqual([{ level: "hard" }]);
    expect(db.query("SELECT level FROM attempts").all()).toEqual([{ level: "hard" }]);
    expect(() => db.run("UPDATE puzzles SET level = 'expert'")).toThrow(/CHECK constraint/);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
