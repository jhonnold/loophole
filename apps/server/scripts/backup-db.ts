// Writes a consistent copy of the SQLite database to the path given, while the API and the worker
// keep using it (VACUUM INTO), then checks the copy. scripts/backup-sqlite.sh runs it. Reads
// DATABASE_PATH like the server (default data/loophole.sqlite, from the repo root).
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

const target = process.argv[2];
if (target === undefined || existsSync(target)) {
  console.error("Usage: bun apps/server/scripts/backup-db.ts <new file>");
  process.exit(2);
}
const source = process.env.DATABASE_PATH ?? "data/loophole.sqlite";
if (!existsSync(source)) {
  console.error(`No database at ${source}.`);
  process.exit(1);
}

const db = new Database(source, { readonly: true });
db.run("PRAGMA busy_timeout = 5000");
db.query("VACUUM INTO ?").run(target);
db.close();

const copy = new Database(target, { readonly: true });
const check = copy.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get();
const migrations = copy
  .query<{ n: number }, []>("SELECT count(*) AS n FROM schema_migrations")
  .get();
copy.close();
if (check?.integrity_check !== "ok") {
  console.error(`The copy failed its integrity check: ${check?.integrity_check}`);
  process.exit(1);
}
console.error(`Copied ${source} to ${target} (${migrations?.n ?? 0} migrations applied).`);
