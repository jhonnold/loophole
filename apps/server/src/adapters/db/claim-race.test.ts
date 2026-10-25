import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClaimThreadMessage } from "../../test-support/claim-thread.ts";
import { openDatabase } from "./database.ts";
import { SqliteJobQueue } from "./job-queue.ts";

const THREADS = 4;
const JOBS = 2000;
const THREAD_URL = new URL("../../test-support/claim-thread.ts", import.meta.url).href;

/** Sends `message` and resolves with the thread's next reply. */
function ask<T>(thread: Worker, message: ClaimThreadMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    thread.onmessage = (event: MessageEvent<T>) => resolve(event.data);
    thread.onerror = (event) => reject(new Error(event.message));
    thread.postMessage(message);
  });
}

test("workers on separate connections never claim the same job", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loophole-claim-"));
  const threads = Array.from({ length: THREADS }, () => new Worker(THREAD_URL));
  try {
    const path = join(dir, "jobs.sqlite");
    const db = openDatabase(path);
    const queue = new SqliteJobQueue(db);
    db.transaction(() => {
      for (let i = 0; i < JOBS; i++) {
        queue.enqueue({
          id: `job-${i}`,
          job: { kind: "generate", input: { width: 5, height: 5, seed: `s${i}` } },
          createdAt: i,
        });
      }
    })();
    // Every thread connects first, then all start claiming at once.
    await Promise.all(threads.map((t, i) => ask(t, { type: "open", path, worker: `w${i}` })));
    const claimed = await Promise.all(threads.map((t) => ask<string[]>(t, { type: "go" })));
    const all = claimed.flat();
    expect(all.length).toBe(JOBS);
    expect(new Set(all).size).toBe(JOBS);
    expect(queue.countQueued()).toBe(0);
    db.close();
  } finally {
    for (const t of threads) t.terminate();
    rmSync(dir, { recursive: true });
  }
});
