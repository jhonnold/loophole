import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, openDatabase } from "./database.ts";

describe("openDatabase and migrate", () => {
  test("creates the tables and records each migration once", () => {
    const db = openDatabase(":memory:");
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    expect(tables).toEqual([
      "account_tokens",
      "jobs",
      "puzzles",
      "schema_migrations",
      "sessions",
      "users",
    ]);
    migrate(db);
    const versions = db
      .query<{ version: number }, []>("SELECT version FROM schema_migrations")
      .all();
    expect(versions).toEqual([{ version: 1 }, { version: 2 }]);
  });

  test("applies new numbered files in numeric order and skips applied ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "loophole-migrations-"));
    try {
      writeFileSync(join(dir, "2_second.sql"), "INSERT INTO t (v) VALUES ('second');");
      writeFileSync(join(dir, "10_third.sql"), "INSERT INTO t (v) VALUES ('third');");
      writeFileSync(
        join(dir, "1_first.sql"),
        "CREATE TABLE t (v TEXT); INSERT INTO t (v) VALUES ('first');",
      );
      writeFileSync(join(dir, "notes.txt"), "not a migration");
      const db = new Database(":memory:", { strict: true });
      migrate(db, dir);
      migrate(db, dir);
      const rows = db.query<{ v: string }, []>("SELECT v FROM t ORDER BY rowid").all();
      expect(rows.map((r) => r.v)).toEqual(["first", "second", "third"]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("refuses two migrations with the same number, before running either", () => {
    const dir = mkdtempSync(join(tmpdir(), "loophole-migrations-"));
    try {
      writeFileSync(join(dir, "002_users.sql"), "CREATE TABLE users (id INTEGER) STRICT;");
      writeFileSync(join(dir, "002_progress.sql"), "CREATE TABLE progress (id INTEGER) STRICT;");
      const db = new Database(":memory:", { strict: true });
      expect(() => migrate(db, dir)).toThrow(
        /Duplicate migration number 2: 002_\w+\.sql, 002_\w+\.sql/,
      );
      const tables = db
        .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all();
      expect(tables.map((r) => r.name)).toEqual(["schema_migrations"]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("a file database uses write-ahead logging", () => {
    const dir = mkdtempSync(join(tmpdir(), "loophole-db-"));
    try {
      const db = openDatabase(join(dir, "nested", "test.sqlite"));
      const mode = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get();
      expect(mode?.journal_mode).toBe("wal");
      db.close();
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("several connections opening a new file at once all succeed in WAL mode", async () => {
    const url = new URL("../../test-support/open-thread.ts", import.meta.url).href;
    for (let trial = 0; trial < 5; trial++) {
      const dir = mkdtempSync(join(tmpdir(), "loophole-open-"));
      const threads = Array.from({ length: 4 }, () => new Worker(url));
      try {
        const path = join(dir, "new.sqlite");
        const modes = await Promise.all(
          threads.map(
            (thread) =>
              new Promise<string>((resolve) => {
                thread.onmessage = (event: MessageEvent<string>) => resolve(event.data);
                thread.postMessage(path);
              }),
          ),
        );
        expect(modes).toEqual(["wal", "wal", "wal", "wal"]);
      } finally {
        for (const thread of threads) thread.terminate();
        rmSync(dir, { recursive: true });
      }
    }
  });
});
