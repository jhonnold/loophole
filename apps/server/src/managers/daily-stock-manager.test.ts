import { describe, expect, spyOn, test } from "bun:test";
import { serializePuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { type GeneratedPuzzle, JOB_PRIORITY } from "../domain.ts";
import { SMALL_DAILY } from "../test-support/daily.ts";
import {
  FakeClock,
  FakeDailyRepository,
  FakeJobQueue,
  FakePuzzleRepository,
  fakeSeeds,
  sequentialIds,
} from "../test-support/fakes.ts";
import { DailyManager, dailyLevel } from "./daily-manager.ts";
import { DailyStockManager } from "./daily-stock-manager.ts";
import { JobManager } from "./job-manager.ts";
import { PuzzleManager } from "./puzzle-manager.ts";

const NOON = Date.UTC(2026, 9, 25, 12);

function setup(daysAhead = 2) {
  const clock = new FakeClock(NOON);
  const repo = new FakeDailyRepository();
  const queue = new FakeJobQueue();
  const puzzleRepo = new FakePuzzleRepository();
  const puzzles = new PuzzleManager({ puzzles: puzzleRepo, blobs: new MemoryBlobStore(), clock });
  // A tiny queue: the scheduler's jobs must get in even when players have filled it.
  const jobs = new JobManager({
    jobs: queue,
    clock,
    newId: sequentialIds("x"),
    maxQueued: 1,
    maxPendingPerRequester: 10,
  });
  /** Size classes counted as failed generations. */
  const failures: number[] = [];
  const stock = new DailyStockManager({
    dailies: repo,
    jobs,
    puzzles,
    seeds: fakeSeeds,
    clock,
    newId: sequentialIds("j"),
    settings: { daysAhead },
    metrics: { dailyFailure: (size) => failures.push(size) },
  });
  const dailies = new DailyManager({ dailies: repo, puzzles, clock });
  return { clock, repo, queue, puzzles, puzzleRepo, stock, dailies, failures };
}

/** What a generation job for size `size` makes: a puzzle of that width. */
function generated(size: number): GeneratedPuzzle {
  const clues = ".".repeat(size * size);
  return { ...SMALL_DAILY, puzzle: { ...SMALL_DAILY.puzzle, width: size, height: size, clues } };
}

/** Finishes a queued job as the worker would. */
function end(queue: FakeJobQueue, id: string, status: "done" | "failed" | "timeout") {
  queue.claimNext("w", 0);
  queue.finish(
    id,
    "w",
    status === "done"
      ? { status, result: { kind: "generate", puzzleId: id } }
      : { status, error: "boom" },
    0,
  );
}

describe("DailyStockManager.stock (FR-22)", () => {
  test("queues one generation per size class for each day ahead, with seeds from day, size and attempt", () => {
    const { repo, queue, stock } = setup();
    expect(stock.stock()).toEqual({ queued: 8, missingToday: [7, 10, 20, 40] });
    expect(queue.get("j-1")).toMatchObject({
      kind: "generate",
      status: "queued",
      input: { width: 7, height: 7, seed: "2026-10-25/7/0", day: "2026-10-25", level: "hard" },
      priority: JOB_PRIORITY.daily,
      requester: null,
    });
    // Each size class at its own level (one level per size, PRD FR-22).
    for (const job of queue.jobs.values()) {
      if (job.kind === "generate") expect(job.input.level).toBe(dailyLevel(job.input.width));
    }
    expect(queue.get("j-8")?.input).toMatchObject({ width: 40, day: "2026-10-26" });
    expect(repo.get("2026-10-26", 40)).toMatchObject({ attempt: 0, jobId: "j-8", puzzleId: null });
    // Running again while the jobs wait queues nothing more.
    expect(stock.stock()).toEqual({ queued: 0, missingToday: [7, 10, 20, 40] });
    expect(queue.jobs.size).toBe(8);
  });

  test("stores what a job made, hidden until its day, and counts the day as stocked", async () => {
    const { clock, repo, queue, puzzles, puzzleRepo, stock, dailies } = setup(2);
    stock.stock();
    end(queue, "j-1", "done");
    await stock.complete("j-1", "2026-10-25", generated(7));
    expect(repo.get("2026-10-25", 7)).toMatchObject({ puzzleId: "j-1", generatorVersion: "1" });
    expect(puzzleRepo.get("j-1")?.releaseAt).toBe(Date.UTC(2026, 9, 25));
    // The stored puzzle keeps no seed or generator version (FR-25).
    const stored = puzzleRepo.get("j-1");
    expect(stored && serializePuzzle(stored.puzzle)).toEqual({
      v: 1,
      width: 7,
      height: 7,
      clues: ".".repeat(49),
    });
    expect(stock.stock().missingToday).toEqual([10, 20, 40]);
    expect(dailies.forDay().puzzles[0]).toEqual({ size: 7, level: "hard", puzzleId: "j-1" });

    // Tomorrow's is stored the day before and stays hidden until midnight.
    await stock.complete("j-5", "2026-10-26", generated(7));
    expect(repo.get("2026-10-26", 7)?.puzzleId).toBe("j-5");
    expect(puzzles.get("j-5")).toBeNull();
    clock.time = Date.UTC(2026, 9, 26);
    expect(puzzles.get("j-5")?.id).toBe("j-5");
  });

  test("stocked counts, per size, the days in a row from today that are generated", async () => {
    const { stock } = setup(2);
    stock.stock();
    expect(stock.stocked()).toEqual([
      { size: 7, days: 0 },
      { size: 10, days: 0 },
      { size: 20, days: 0 },
      { size: 40, days: 0 },
    ]);
    await stock.complete("j-1", "2026-10-25", generated(7));
    await stock.complete("j-5", "2026-10-26", generated(7));
    // Tomorrow's 10×10 without today's doesn't count: players can't play today's.
    await stock.complete("j-6", "2026-10-26", generated(10));
    expect(stock.stocked().slice(0, 2)).toEqual([
      { size: 7, days: 2 },
      { size: 10, days: 0 },
    ]);
  });

  test("retries a failed, timed-out or lost generation with the next seed", () => {
    const { repo, queue, stock, failures } = setup(1);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    stock.stock();
    end(queue, "j-1", "failed");
    end(queue, "j-2", "timeout");
    queue.jobs.delete("j-3");
    expect(stock.stock()).toEqual({ queued: 3, missingToday: [7, 10, 20, 40] });
    expect(repo.get("2026-10-25", 7)).toMatchObject({ attempt: 1, jobId: "j-5" });
    expect(queue.get("j-5")?.input).toMatchObject({ seed: "2026-10-25/7/1" });
    expect(repo.get("2026-10-25", 10)).toMatchObject({ attempt: 1, jobId: "j-6" });
    expect(repo.get("2026-10-25", 20)).toMatchObject({ attempt: 1, jobId: "j-7" });
    expect(repo.get("2026-10-25", 40)).toMatchObject({ attempt: 0, jobId: "j-4" });
    expect(warn).toHaveBeenCalledTimes(3);
    expect(failures).toEqual([7, 10, 20]);
    warn.mockRestore();
  });

  test("a job that a retry replaced stores nothing", async () => {
    const { repo, queue, puzzleRepo, stock } = setup(1);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    stock.stock();
    end(queue, "j-1", "timeout");
    stock.stock();
    await stock.complete("j-1", "2026-10-25", generated(7));
    expect(puzzleRepo.get("j-1")).toBeNull();
    expect(repo.get("2026-10-25", 7)?.puzzleId).toBeNull();
    warn.mockRestore();
  });

  test("two workers stocking at once queue each day and size once", () => {
    const first = setup(1);
    const second = new DailyStockManager({
      dailies: first.repo,
      jobs: new JobManager({
        jobs: first.queue,
        clock: first.clock,
        newId: sequentialIds("y"),
        maxQueued: 1,
        maxPendingPerRequester: 10,
      }),
      puzzles: first.puzzles,
      seeds: fakeSeeds,
      clock: first.clock,
      newId: sequentialIds("k"),
      settings: { daysAhead: 1 },
    });
    first.stock.stock();
    expect(second.stock().queued).toBe(0);
    expect(first.queue.jobs.size).toBe(4);
  });

  test("rolls over at 00:00 UTC: the new day ahead gets queued", () => {
    const { clock, queue, stock } = setup(1);
    stock.stock();
    clock.time = Date.UTC(2026, 9, 26);
    expect(stock.stock().queued).toBe(4);
    expect(queue.get("j-5")?.input).toMatchObject({ day: "2026-10-26" });
  });
});
