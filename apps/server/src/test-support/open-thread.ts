// A thread for the concurrent-open test: opens the database at the path it is sent and answers
// with its journal mode, or with the error message if opening failed.
import { openDatabase } from "../adapters/db/database.ts";

declare const self: Worker;

self.onmessage = (event: MessageEvent<string>) => {
  try {
    const db = openDatabase(event.data);
    const row = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get();
    db.close();
    self.postMessage(row?.journal_mode ?? "none");
  } catch (err) {
    self.postMessage(`error: ${err instanceof Error ? err.message : String(err)}`);
  }
};
