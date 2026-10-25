import { describe, expect, spyOn, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import type { TaskOutcome } from "../domain.ts";
import {
  FakeClock,
  FakeJobQueue,
  FakePuzzleRepository,
  FakeSubmissionRepository,
  FakeTaskRunner,
  sequentialIds,
} from "../test-support/fakes.ts";
import { JobManager } from "./job-manager.ts";
import { JobRunManager, type JobRunSettings } from "./job-run-manager.ts";
import { PuzzleManager } from "./puzzle-manager.ts";
import { SubmissionManager } from "./submission-manager.ts";

const SETTINGS: JobRunSettings = {
  generateTimeoutMs: 60_000,
  verifyTimeoutMs: 45_000,
  progressIntervalMs: 500,
  heartbeatMs: 5_000,
  staleMs: 30_000,
  maxAttempts: 3,
};

const GENERATED: TaskOutcome = {
  status: "done",
  output: {
    kind: "generate",
    generated: {
      puzzle: serializePuzzle(
        createPuzzle(2, 2, [2, 2, 2, 2], { seed: "s", meta: { generator: "1" } }),
      ),
      solution: "112211121121",
      steps: [],
    },
  },
};

function setup(runner: FakeTaskRunner, settings = SETTINGS) {
  const clock = new FakeClock();
  const jobs = new FakeJobQueue();
  const puzzleRepo = new FakePuzzleRepository();
  const blobs = new MemoryBlobStore();
  const puzzles = new PuzzleManager({
    puzzles: puzzleRepo,
    blobs,
    clock,
  });
  const submissions = new SubmissionManager({
    submissions: new FakeSubmissionRepository(),
    puzzles,
    jobs: new JobManager({ jobs, clock, newId: sequentialIds("j"), maxQueued: 10 }),
    limiter: new MemoryRateLimiter(clock),
    clock,
    newId: sequentialIds("s"),
  });
  /** Daily generations handed to the scheduler, as `job:day`. */
  const dailies: string[] = [];
  /** Jobs counted as ended, as `kind:status:seconds`. */
  const finished: string[] = [];
  const manager = new JobRunManager({
    jobs,
    tasks: runner,
    puzzles,
    submissions,
    dailies: {
      async complete(jobId, day) {
        dailies.push(`${jobId}:${day}`);
      },
    },
    clock,
    settings,
    metrics: {
      jobFinished: (kind, status, seconds) => finished.push(`${kind}:${status}:${seconds}`),
    },
  });
  const enqueue = (id: string) =>
    jobs.enqueue({
      id,
      job: { kind: "generate", input: { width: 2, height: 2, seed: "s" } },
      createdAt: clock.now(),
    });
  return { clock, jobs, puzzleRepo, blobs, manager, enqueue, dailies, finished };
}

describe("JobRunManager.runNext", () => {
  test("resolves false when nothing is queued", async () => {
    const runner = new FakeTaskRunner(async () => GENERATED);
    expect(await setup(runner).manager.runNext("w")).toBe(false);
    expect(runner.calls.length).toBe(0);
  });

  test("a finished generation stores the puzzle and its id in the job", async () => {
    const runner = new FakeTaskRunner(async () => GENERATED);
    const { jobs, puzzleRepo, blobs, manager, enqueue } = setup(runner);
    enqueue("j1");
    expect(await manager.runNext("w")).toBe(true);
    expect(runner.calls[0].task).toEqual({
      kind: "generate",
      input: { width: 2, height: 2, seed: "s" },
    });
    expect(runner.calls[0].options.timeoutMs).toBe(60_000);
    expect(jobs.get("j1")).toMatchObject({
      status: "done",
      progress: 1,
      result: { kind: "generate", puzzleId: "j1" },
    });
    expect(puzzleRepo.get("j1")?.status).toBe("published");
    expect(await blobs.get("puzzles/j1/solution.txt")).toBe("112211121121");
  });

  test("a daily puzzle's generation goes to the daily scheduler, not the practice list", async () => {
    const runner = new FakeTaskRunner(async () => GENERATED);
    const { jobs, puzzleRepo, manager, dailies } = setup(runner);
    jobs.enqueue({
      id: "d1",
      job: { kind: "generate", input: { width: 2, height: 2, seed: "s", day: "2026-10-26" } },
      createdAt: 0,
    });
    expect(await manager.runNext("w")).toBe(true);
    expect(dailies).toEqual(["d1:2026-10-26"]);
    expect(puzzleRepo.get("d1")).toBeNull();
    expect(jobs.get("d1")).toMatchObject({ status: "done", result: { puzzleId: "d1" } });
  });

  test("a verification uses the verify time limit and records the status", async () => {
    const runner = new FakeTaskRunner(async () => ({
      status: "done",
      output: {
        kind: "verify",
        verified: { status: "multiple", solutions: ["1", "2"], steps: [] },
      },
    }));
    const { jobs, manager } = setup(runner);
    const puzzle = serializePuzzle(createPuzzle(2, 2));
    jobs.enqueue({ id: "v1", job: { kind: "verify", input: { puzzle } }, createdAt: 0 });
    await manager.runNext("w");
    expect(runner.calls[0].options.timeoutMs).toBe(45_000);
    expect(jobs.get("v1")).toMatchObject({
      status: "done",
      result: { kind: "verify", status: "multiple" },
    });
  });

  test("a timeout ends the job as timeout", async () => {
    const { jobs, manager, enqueue } = setup(
      new FakeTaskRunner(async () => ({ status: "timeout" })),
    );
    enqueue("j1");
    await manager.runNext("w");
    expect(jobs.get("j1")).toMatchObject({ status: "timeout", result: null });
    expect(jobs.get("j1")?.error).toContain("60 s");
  });

  test("counts each job's end with its kind, status and running time", async () => {
    let during = () => {};
    const runner = new FakeTaskRunner(async () => {
      during();
      return { status: "timeout" };
    });
    const { manager, enqueue, clock, finished } = setup(runner);
    during = () => clock.advance(2500);
    enqueue("j1");
    await manager.runNext("w");
    expect(finished).toEqual(["generate:timeout:2.5"]);
  });

  test("a task error, or a failure storing the result, ends the job as failed", async () => {
    const failing = setup(
      new FakeTaskRunner(async () => ({ status: "failed", error: "bad size" })),
    );
    failing.enqueue("j1");
    await failing.manager.runNext("w");
    expect(failing.jobs.get("j1")).toMatchObject({ status: "failed", error: "bad size" });

    const storing = setup(new FakeTaskRunner(async () => GENERATED));
    storing.blobs.put = async () => {
      throw new Error("bucket unavailable");
    };
    storing.enqueue("j2");
    await storing.manager.runNext("w");
    expect(storing.jobs.get("j2")).toMatchObject({ status: "failed", error: "bucket unavailable" });
  });

  test("progress writes are throttled to one per interval", async () => {
    let clock: FakeClock | undefined;
    const runner = new FakeTaskRunner(async (_task, { onProgress }) => {
      for (let i = 1; i <= 100; i++) {
        clock?.advance(20); // 100 updates over 2 s
        onProgress(i / 100);
      }
      return GENERATED;
    });
    const s = setup(runner);
    clock = s.clock;
    s.enqueue("j1");
    await s.manager.runNext("w");
    // At most one write per 500 ms of the 2 s run, the first one immediately.
    expect(s.jobs.progressWrites.map((w) => w.progress)).toEqual([0.01, 0.26, 0.51, 0.76]);
  });

  test("sends heartbeats while a task runs", async () => {
    let s: ReturnType<typeof setup> | undefined;
    const runner = new FakeTaskRunner(async () => {
      // Hold the task until two beats have arrived, however late the timer fires (capped).
      for (let waited = 0; (s?.jobs.heartbeats ?? 0) < 2 && waited < 5_000; waited += 5) {
        await Bun.sleep(5);
      }
      return GENERATED;
    });
    s = setup(runner, { ...SETTINGS, heartbeatMs: 10 });
    s.enqueue("j1");
    await s.manager.runNext("w");
    expect(s.jobs.heartbeats).toBeGreaterThanOrEqual(2);
  });

  test("a job taken back by recovery and run again stores one puzzle", async () => {
    let s: ReturnType<typeof setup> | undefined;
    let runs = 0;
    const runner = new FakeTaskRunner(async () => {
      // On the first run the job goes stale and is requeued while the task is still going.
      if (++runs === 1) {
        s?.clock.advance(SETTINGS.staleMs + 1);
        s?.manager.recoverStale();
      }
      return GENERATED;
    });
    s = setup(runner);
    s.enqueue("j1");
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    await s.manager.runNext("w");
    // The late result is stored but cannot finish the job, which is queued again, and is logged.
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    expect(s.jobs.get("j1")).toMatchObject({ status: "queued", result: null });
    expect(s.puzzleRepo.records.size).toBe(1);
    await s.manager.runNext("w2");
    expect(s.jobs.get("j1")).toMatchObject({
      status: "done",
      claimedBy: "w2",
      result: { kind: "generate", puzzleId: "j1" },
    });
    expect(s.puzzleRepo.records.size).toBe(1);
  });
});

describe("JobRunManager.recoverStale", () => {
  test("requeues jobs silent for longer than staleMs", async () => {
    const { clock, jobs, manager, enqueue } = setup(new FakeTaskRunner(async () => GENERATED));
    enqueue("j1");
    jobs.claimNext("dead-worker", clock.now());
    clock.advance(SETTINGS.staleMs);
    expect(manager.recoverStale()).toBe(0);
    clock.advance(1);
    expect(manager.recoverStale()).toBe(1);
    expect(jobs.get("j1")).toMatchObject({ status: "queued", claimedBy: null });
  });
});
