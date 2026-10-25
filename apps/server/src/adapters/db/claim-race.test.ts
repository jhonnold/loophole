import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./database.ts";
import { SqliteJobQueue } from "./job-queue.ts";

const WORKERS = 4;
const JOBS = 2000;
const SCRIPT = new URL("../../test-support/claim-child.ts", import.meta.url).pathname;

// Separate processes, as workers are in production (DECISIONS, "Concurrent-open tests use
// processes").
test("workers on separate connections never claim the same job", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loophole-claim-"));
  const running: { kill(): void }[] = [];
  try {
    const path = join(dir, "jobs.sqlite");
    const goFile = join(dir, "go");
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
    const children = Array.from({ length: WORKERS }, (_, i) =>
      Bun.spawn([process.execPath, SCRIPT, path, `w${i}`, goFile], {
        stdout: "pipe",
        stderr: "inherit",
      }),
    );
    running.push(...children);
    // Every worker connects first, then all start claiming at once.
    const readers = children.map((child) => child.stdout.getReader());
    const decoder = new TextDecoder();
    const output = children.map(() => "");
    await Promise.all(
      readers.map(async (reader, i) => {
        while (!output[i].includes("ready\n")) {
          const { value, done } = await reader.read();
          if (done) throw new Error(`worker ${i} exited before connecting`);
          output[i] += decoder.decode(value);
        }
      }),
    );
    writeFileSync(goFile, "");
    const claimed = await Promise.all(
      readers.map(async (reader, i) => {
        for (let r = await reader.read(); !r.done; r = await reader.read()) {
          output[i] += decoder.decode(r.value);
        }
        return JSON.parse(output[i].slice(output[i].indexOf("ready\n") + 6)) as string[];
      }),
    );
    const all = claimed.flat();
    expect(all.length).toBe(JOBS);
    expect(new Set(all).size).toBe(JOBS);
    expect(queue.countQueued()).toBe(0);
    db.close();
  } finally {
    // A worker still waiting for the go file (another failed early) must not outlive the test.
    for (const child of running) child.kill();
    rmSync(dir, { recursive: true });
  }
}, 30_000);
