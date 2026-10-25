// A child process for the claim race test: `bun claim-child.ts <database> <worker id> <go file>`.
// It connects to the shared database, prints "ready", waits until the go file exists, then claims
// jobs until none are left and prints the ids it got as JSON.
import { existsSync } from "node:fs";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";

const [path, worker, goFile] = process.argv.slice(2);
const queue = new SqliteJobQueue(openDatabase(path));
console.log("ready");
while (!existsSync(goFile)) Bun.sleepSync(1);
const ids: string[] = [];
for (let job = queue.claimNext(worker, 0); job !== null; job = queue.claimNext(worker, 0)) {
  ids.push(job.id);
}
console.log(JSON.stringify(ids));
