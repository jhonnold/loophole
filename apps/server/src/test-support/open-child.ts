// A child process for the concurrent-open test: opens the database at the path it is given and
// prints its journal mode, or the error message if opening failed.
import { openDatabase } from "../adapters/db/database.ts";

try {
  const db = openDatabase(process.argv[2]);
  const row = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get();
  db.close();
  console.log(row?.journal_mode ?? "none");
} catch (err) {
  console.log(`error: ${err instanceof Error ? err.message : String(err)}`);
}
