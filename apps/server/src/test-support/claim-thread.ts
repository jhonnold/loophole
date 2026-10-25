// A thread for the claim race test. On "open" it connects to the shared database file and
// answers "ready"; on "go" it claims jobs until none are left and posts the ids it got.
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";

declare const self: Worker;

export type ClaimThreadMessage =
  | { readonly type: "open"; readonly path: string; readonly worker: string }
  | { readonly type: "go" };

let queue: SqliteJobQueue | null = null;
let worker = "";

self.onmessage = (event: MessageEvent<ClaimThreadMessage>) => {
  const message = event.data;
  if (message.type === "open") {
    queue = new SqliteJobQueue(openDatabase(message.path));
    worker = message.worker;
    self.postMessage("ready");
    return;
  }
  if (queue === null) throw new Error("go before open");
  const ids: string[] = [];
  for (let job = queue.claimNext(worker, 0); job !== null; job = queue.claimNext(worker, 0)) {
    ids.push(job.id);
  }
  self.postMessage(ids);
};
