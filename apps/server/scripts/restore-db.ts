// Replaces the SQLite database with a backup made by scripts/backup-sqlite.sh (README, "Backups").
// Stop the API and the worker first. Reads DATABASE_PATH like the server.
//   bun apps/server/scripts/restore-db.ts <backup.sqlite.gz>
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

const backup = process.argv[2];
if (backup === undefined || !existsSync(backup)) {
  console.error("Usage: bun apps/server/scripts/restore-db.ts <backup.sqlite.gz>");
  process.exit(2);
}
const target = process.env.DATABASE_PATH ?? "data/loophole.sqlite";
const bytes = readFileSync(backup);
const temp = `${target}.restoring`;
writeFileSync(temp, backup.endsWith(".gz") ? Bun.gunzipSync(bytes) : bytes);

const copy = new Database(temp, { readonly: true });
const check = copy.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get();
copy.close();
if (check?.integrity_check !== "ok") {
  rmSync(temp, { force: true });
  console.error(`The backup failed its integrity check: ${check?.integrity_check}`);
  process.exit(1);
}
// The old database's write-ahead log would be replayed onto the restored file: remove it first.
rmSync(`${target}-wal`, { force: true });
rmSync(`${target}-shm`, { force: true });
renameSync(temp, target);
console.error(`Restored ${target} from ${backup}. Start the API and the worker again.`);
