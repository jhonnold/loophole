import { describe, expect, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import type { TaskOutcome, VerifyOutcome } from "../domain.ts";
import {
  FakeClock,
  FakeJobQueue,
  FakePuzzleRepository,
  FakeSubmissionRepository,
  FakeTaskRunner,
  noDailies,
  sequentialIds,
} from "../test-support/fakes.ts";
import { RateLimitedError } from "./errors.ts";
import { JobManager } from "./job-manager.ts";
import { JobRunManager } from "./job-run-manager.ts";
import { PuzzleManager } from "./puzzle-manager.ts";
import { SUBMISSIONS_PER_ACCOUNT, SubmissionManager } from "./submission-manager.ts";

// 2×2 puzzles: "2222" has one solution (the outer square), an empty grid several.
const UNIQUE = createPuzzle(2, 2, [2, 2, 2, 2]);
const OPEN = createPuzzle(2, 2);
const SOLUTION = "112211121121";

const UNIQUE_OUTCOME: VerifyOutcome = {
  status: "unique",
  solutions: [SOLUTION],
  steps: [{ rule: "clue-satisfied", changes: [{ edge: 0, state: 1 }], cells: [0], dots: [] }],
};

function setup() {
  const clock = new FakeClock(1_000);
  const queue = new FakeJobQueue();
  const puzzleRepo = new FakePuzzleRepository();
  const blobs = new MemoryBlobStore();
  const repo = new FakeSubmissionRepository();
  const puzzles = new PuzzleManager({ puzzles: puzzleRepo, blobs, clock });
  const jobs = new JobManager({
    jobs: queue,
    clock,
    newId: sequentialIds("j"),
    maxQueued: 100,
    maxPendingPerRequester: 10,
  });
  const manager = new SubmissionManager({
    submissions: repo,
    puzzles,
    jobs,
    limiter: new MemoryRateLimiter(clock),
    clock,
    newId: sequentialIds("s"),
  });
  return { clock, queue, puzzleRepo, blobs, repo, puzzles, manager };
}

describe("SubmissionManager.submit", () => {
  test("queues a verification for the submission and stores it as pending", () => {
    const { queue, manager } = setup();
    const record = manager.submit("u1", UNIQUE);
    expect(record).toMatchObject({
      id: "s-1",
      userId: "u1",
      status: "pending",
      verdict: null,
      puzzleId: null,
      jobId: "j-1",
      createdAt: 1_000,
      decidedAt: null,
    });
    expect(queue.get("j-1")).toMatchObject({
      kind: "verify",
      input: { puzzle: serializePuzzle(UNIQUE), submissionId: "s-1" },
    });
    expect(manager.get("s-1", "u1")?.status).toBe("pending");
  });

  test("clues already published are decided at once as a duplicate of that puzzle", async () => {
    const { queue, puzzles, manager } = setup();
    await puzzles.saveGenerated("p1", {
      puzzle: serializePuzzle(UNIQUE),
      solution: SOLUTION,
      steps: [],
    });
    expect(manager.submit("u1", UNIQUE)).toMatchObject({
      status: "published",
      verdict: "duplicate",
      puzzleId: "p1",
      jobId: null,
      decidedAt: 1_000,
    });
    expect(queue.jobs.size).toBe(0);
  });

  test("clues of an unpublished puzzle are rejected as removed", async () => {
    const { puzzles, manager } = setup();
    await puzzles.saveGenerated("p1", {
      puzzle: serializePuzzle(UNIQUE),
      solution: SOLUTION,
      steps: [],
    });
    puzzles.unpublish("p1");
    expect(manager.submit("u1", UNIQUE)).toMatchObject({
      status: "rejected",
      verdict: "removed",
      puzzleId: null,
    });
  });

  test("an account gets a limited number of submissions per hour", () => {
    const { clock, manager } = setup();
    for (let i = 0; i < SUBMISSIONS_PER_ACCOUNT.limit; i++) manager.submit("u1", OPEN);
    expect(() => manager.submit("u1", OPEN)).toThrow(RateLimitedError);
    manager.submit("u2", OPEN); // another account is not affected
    clock.advance(SUBMISSIONS_PER_ACCOUNT.windowMs);
    manager.submit("u1", OPEN);
  });
});

describe("SubmissionManager.get and listMine", () => {
  test("only the creator sees a submission, newest first", () => {
    const { clock, manager } = setup();
    manager.submit("u1", UNIQUE);
    clock.advance(10);
    manager.submit("u1", OPEN);
    manager.submit("u2", OPEN);
    expect(manager.get("s-1", "u2")).toBeNull();
    expect(manager.get("nope", "u1")).toBeNull();
    expect(manager.listMine("u1", 10).map((r) => r.id)).toEqual(["s-2", "s-1"]);
  });

  test("a job that finished without deciding its submission reads as error", () => {
    const { clock, queue, manager } = setup();
    manager.submit("u1", UNIQUE);
    // As if a worker had run the job before the submission row existed.
    queue.claimNext("w", clock.now());
    queue.finish("j-1", "w", { status: "done", result: { kind: "verify", status: "unique" } }, 0);
    expect(manager.get("s-1", "u1")).toMatchObject({ status: "rejected", verdict: "error" });
  });

  test("a submission whose job timed out reads as unknown, and a failed one as error", () => {
    const { clock, queue, manager } = setup();
    manager.submit("u1", UNIQUE);
    manager.submit("u1", OPEN);
    for (const [id, status] of [
      ["j-1", "timeout"],
      ["j-2", "failed"],
    ] as const) {
      queue.claimNext("w", clock.now());
      queue.finish(id, "w", { status, error: "stopped" }, clock.now());
    }
    clock.advance(5);
    expect(manager.get("s-1", "u1")).toMatchObject({
      status: "rejected",
      verdict: "unknown",
      decidedAt: 1_005,
    });
    expect(manager.listMine("u1", 10).find((r) => r.id === "s-2")).toMatchObject({
      status: "rejected",
      verdict: "error",
    });
  });
});

describe("SubmissionManager.complete", () => {
  test("a unique puzzle is published under the submission's id with its creator", async () => {
    const { clock, puzzleRepo, blobs, manager } = setup();
    manager.submit("u1", UNIQUE);
    clock.advance(100);
    await manager.complete("s-1", UNIQUE_OUTCOME);
    expect(manager.get("s-1", "u1")).toMatchObject({
      status: "published",
      verdict: "unique",
      puzzleId: "s-1",
      decidedAt: 1_100,
    });
    expect(puzzleRepo.get("s-1")).toMatchObject({
      origin: "submitted",
      status: "published",
      creatorId: "u1",
    });
    expect(await blobs.get("puzzles/s-1/solution.txt")).toBe(SOLUTION);
    expect(JSON.parse((await blobs.get("puzzles/s-1/trace.json")) ?? "")).toEqual({
      v: 1,
      steps: UNIQUE_OUTCOME.steps,
    });
  });

  test("none, multiple and unknown are rejected with that verdict, and nothing is published", async () => {
    for (const status of ["none", "multiple", "unknown"] as const) {
      const { puzzleRepo, manager } = setup();
      manager.submit("u1", OPEN);
      await manager.complete("s-1", { status, solutions: [], steps: [] });
      expect(manager.get("s-1", "u1")).toMatchObject({ status: "rejected", verdict: status });
      expect(puzzleRepo.records.size).toBe(0);
    }
  });

  test("the same clues published while it waited make it a duplicate", async () => {
    const { manager } = setup();
    manager.submit("u1", UNIQUE);
    manager.submit("u2", UNIQUE);
    await manager.complete("s-1", UNIQUE_OUTCOME);
    await manager.complete("s-2", UNIQUE_OUTCOME);
    expect(manager.get("s-2", "u2")).toMatchObject({ verdict: "duplicate", puzzleId: "s-1" });
  });

  test("a deleted or already decided submission is left alone", async () => {
    const { repo, puzzleRepo, manager } = setup();
    await manager.complete("gone", UNIQUE_OUTCOME);
    manager.submit("u1", UNIQUE);
    await manager.complete("s-1", { status: "multiple", solutions: [], steps: [] });
    await manager.complete("s-1", UNIQUE_OUTCOME);
    expect(repo.get("s-1")?.verdict).toBe("multiple");
    expect(puzzleRepo.records.size).toBe(0);
  });

  test("the worker decides the submission when its verification job ends", async () => {
    const { clock, queue, puzzles, manager } = setup();
    const outcome: TaskOutcome = {
      status: "done",
      output: { kind: "verify", verified: UNIQUE_OUTCOME },
    };
    const runs = new JobRunManager({
      jobs: queue,
      tasks: new FakeTaskRunner(async () => outcome),
      puzzles,
      submissions: manager,
      dailies: noDailies,
      clock,
      settings: {
        generateTimeoutMs: 60_000,
        verifyTimeoutMs: 45_000,
        progressIntervalMs: 500,
        heartbeatMs: 5_000,
        staleMs: 30_000,
        maxAttempts: 3,
      },
    });
    manager.submit("u1", UNIQUE);
    expect(await runs.runNext("w")).toBe(true);
    expect(queue.get("j-1")).toMatchObject({
      status: "done",
      result: { kind: "verify", status: "unique" },
    });
    expect(manager.get("s-1", "u1")?.status).toBe("published");
  });

  test("a retry after a crash between saving the puzzle and deciding publishes it, not a duplicate of itself", async () => {
    const { puzzles, manager } = setup();
    manager.submit("u1", UNIQUE);
    await puzzles.saveSubmitted("s-1", UNIQUE, SOLUTION, UNIQUE_OUTCOME.steps, "u1");
    await manager.complete("s-1", UNIQUE_OUTCOME);
    expect(manager.get("s-1", "u1")).toMatchObject({
      status: "published",
      verdict: "unique",
      puzzleId: "s-1",
    });
  });

  test("a published submission reads as removed, with no link, once its puzzle is unpublished", async () => {
    const { puzzles, manager } = setup();
    manager.submit("u1", UNIQUE);
    await manager.complete("s-1", UNIQUE_OUTCOME);
    expect(puzzles.unpublish("s-1")).toBe(true);
    const removed = { status: "rejected", verdict: "removed", puzzleId: null };
    expect(manager.get("s-1", "u1")).toMatchObject(removed);
    expect(manager.listMine("u1", 50)).toEqual([expect.objectContaining(removed)]);
  });
});
