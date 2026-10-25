import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/adapters/db/database.ts";

// The backup and restore scripts, run as the backup script runs them: as separate processes, on a
// database another connection holds open.

const BACKUP = new URL("./backup-db.ts", import.meta.url).pathname;
const RESTORE = new URL("./restore-db.ts", import.meta.url).pathname;

async function run(script: string, args: string[], databasePath: string): Promise<number> {
  const child = Bun.spawn([process.execPath, script, ...args], {
    env: { ...process.env, DATABASE_PATH: databasePath },
    stdout: "ignore",
    stderr: "ignore",
  });
  return await child.exited;
}

test("a backup of an open database keeps rows still in its WAL, and restores over a stale WAL", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loophole-backup-"));
  try {
    const live = join(dir, "live.sqlite");
    const db = openDatabase(live);
    // No checkpoints: the new rows stay in the write-ahead log, as between a server's checkpoints.
    db.run("PRAGMA wal_autocheckpoint = 0");
    const insert = db.query(
      "INSERT INTO jobs (id, kind, payload, status, created_at) VALUES ($id, 'generate', '{}', 'queued', 0)",
    );
    for (let i = 0; i < 50; i++) insert.run({ id: `j${i}` });
    expect(statSync(`${live}-wal`).size).toBeGreaterThan(0);

    const copy = join(dir, "copy.sqlite");
    expect(await run(BACKUP, [copy], live)).toBe(0);
    // It never overwrites a file.
    expect(await run(BACKUP, [copy], live)).toBe(2);

    // Another database, with a write-ahead log left beside it, gets the gzipped backup.
    const target = join(dir, "target.sqlite");
    openDatabase(target).close();
    writeFileSync(`${target}-wal`, "stale");
    writeFileSync(`${copy}.gz`, Bun.gzipSync(readFileSync(copy)));
    expect(await run(RESTORE, [`${copy}.gz`], target)).toBe(0);
    expect(existsSync(`${target}-wal`)).toBe(false);

    const restored = new Database(target, { readonly: true });
    expect(restored.query("SELECT count(*) AS n FROM jobs").get()).toEqual({ n: 50 });
    expect(restored.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    restored.close();
    db.close();
  } finally {
    rmSync(dir, { recursive: true });
  }
}, 30_000);
