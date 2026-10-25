import { describe, expect, test } from "bun:test";
import { analyzeBoard, createPuzzle, GENERATOR_VERSION, parsePuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { systemClock } from "../adapters/clock.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { ThreadTaskRunner } from "../adapters/tasks/thread-task-runner.ts";
import { createApp } from "../api/app.ts";
import { HintManager } from "../managers/hint-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { JobRunManager } from "../managers/job-run-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { submissionDeps } from "../test-support/submissions.ts";

// The whole path in one process: the API queues a generation or a submission's check, the
// worker's manager runs it in a real thread, and the API serves the stored puzzle.
function setup(verifyTimeoutMs = 10_000) {
  const db = openDatabase(":memory:");
  const queue = new SqliteJobQueue(db);
  const blobs = new MemoryBlobStore();
  const puzzles = new PuzzleManager({
    puzzles: new SqlitePuzzleRepository(db),
    blobs,
    clock: systemClock,
  });
  const jobs = new JobManager({
    jobs: queue,
    clock: systemClock,
    newId: () => crypto.randomUUID(),
    maxQueued: 10,
  });
  const { submissions } = submissionDeps(db, systemClock, puzzles, jobs);
  const runs = new JobRunManager({
    jobs: queue,
    tasks: new ThreadTaskRunner(),
    puzzles,
    submissions,
    clock: systemClock,
    settings: {
      generateTimeoutMs: 10_000,
      verifyTimeoutMs,
      progressIntervalMs: 0,
      heartbeatMs: 1_000,
      staleMs: 30_000,
      maxAttempts: 3,
    },
  });
  const hints = new HintManager({ puzzles });
  const accounts = accountDeps(db, systemClock);
  accounts.users.insert({
    id: "u1",
    email: "ann@example.com",
    passwordHash: "x",
    emailVerifiedAt: 1,
    isAdmin: false,
    createdAt: 1,
  });
  return {
    app: createApp({ puzzles, jobs, hints, ...accounts }),
    runs,
    puzzles,
    submissions,
  };
}

async function generateViaApi(
  app: ReturnType<typeof setup>["app"],
  runs: JobRunManager,
  seed: string,
) {
  const res = await app.request("/api/jobs/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ width: 7, height: 7, seed }),
  });
  const { id } = (await res.json()) as { id: string };
  expect(await runs.runNext("w")).toBe(true);
  const job = (await (await app.request(`/api/jobs/${id}`)).json()) as {
    status: string;
    progress: number;
    result: { puzzleId: string } | null;
  };
  expect(job).toMatchObject({ status: "done", progress: 1 });
  if (job.result === null) throw new Error("no result");
  return job.result.puzzleId;
}

describe("generation from request to stored puzzle", () => {
  test("a queued generation is run, stored and served without its solution", async () => {
    const { app, runs, puzzles } = setup();
    const puzzleId = await generateViaApi(app, runs, "flow");
    const body = (await (await app.request(`/api/puzzles/${puzzleId}`)).json()) as {
      puzzle: unknown;
    };
    const puzzle = parsePuzzle(body.puzzle);
    expect(puzzle.seed).toBe("flow");
    expect(puzzle.meta).toEqual({ generator: GENERATOR_VERSION });
    const solution = await puzzles.getSolution(puzzleId);
    if (solution === null) throw new Error("no solution");
    expect(analyzeBoard(puzzle, solution).solved).toBe(true);
  });

  test("the same seed and size give the same puzzle (FR-10)", async () => {
    const { app, runs, puzzles } = setup();
    const a = puzzles.get(await generateViaApi(app, runs, "same"));
    const b = puzzles.get(await generateViaApi(app, runs, "same"));
    if (a === null || b === null) throw new Error("missing");
    expect(a.id).not.toBe(b.id);
    expect(Array.from(a.puzzle.clues)).toEqual(Array.from(b.puzzle.clues));
  });
});

describe("a submission from queue to verdict (PRD FR-27)", () => {
  test("a unique puzzle is published as submitted and served without its solution", async () => {
    const { app, runs, puzzles, submissions } = setup();
    const { id } = submissions.submit("u1", createPuzzle(2, 2, [2, 2, 2, 2]));
    expect(await runs.runNext("w")).toBe(true);
    expect(submissions.get(id, "u1")).toMatchObject({
      status: "published",
      verdict: "unique",
      puzzleId: id,
    });
    const res = await app.request(`/api/puzzles/${id}`);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({
      id,
      origin: "submitted",
      puzzle: { v: 1, width: 2, height: 2, clues: "2222" },
    });
    expect(text).not.toContain("112211121121");
    expect(Array.from((await puzzles.getSolution(id)) ?? [])).toEqual(
      Array.from("112211121121", Number),
    );
  });

  test("a puzzle with several solutions is rejected as multiple, and none as none", async () => {
    const { runs, puzzles, submissions } = setup();
    const open = submissions.submit("u1", createPuzzle(3, 3));
    const impossible = submissions.submit("u1", createPuzzle(1, 1, [0]));
    await runs.runNext("w");
    await runs.runNext("w");
    expect(submissions.get(open.id, "u1")).toMatchObject({
      status: "rejected",
      verdict: "multiple",
    });
    expect(submissions.get(impossible.id, "u1")).toMatchObject({ verdict: "none" });
    expect(puzzles.listRecent(10)).toEqual([]);
  });

  test("a check stopped at the job's time limit is rejected as unknown", async () => {
    const { runs, submissions } = setup(1);
    const { id } = submissions.submit("u1", createPuzzle(2, 2, [2, 2, 2, 2]));
    await runs.runNext("w");
    expect(submissions.get(id, "u1")).toMatchObject({ status: "rejected", verdict: "unknown" });
  });
});
