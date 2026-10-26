import { describe, expect, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { JOB_PRIORITY } from "../domain.ts";
import { FakeClock, FakeJobQueue, sequentialIds } from "../test-support/fakes.ts";
import { QueueFullError, TooManyPendingJobsError } from "./errors.ts";
import { JobManager } from "./job-manager.ts";

function setup(maxQueued = 10, maxPendingPerRequester = 10) {
  const jobs = new FakeJobQueue();
  const manager = new JobManager({
    jobs,
    clock: new FakeClock(42),
    newId: sequentialIds("j"),
    maxQueued,
    maxPendingPerRequester,
  });
  return { jobs, manager };
}

describe("JobManager", () => {
  test("enqueueGenerate queues a player's generation with the given seed, at hard by default", () => {
    const { manager } = setup();
    const job = manager.enqueueGenerate({ width: 10, height: 7, seed: "abc" }, "ip:1.2.3.4");
    expect(job).toMatchObject({
      id: "j-1",
      kind: "generate",
      status: "queued",
      input: { width: 10, height: 7, seed: "abc", level: "hard" },
      priority: JOB_PRIORITY.player,
      requester: "ip:1.2.3.4",
      createdAt: 42,
    });
    expect(manager.get("j-1")).toEqual(job);
    expect(manager.get("nope")).toBeNull();
  });

  test("enqueueGenerate takes the level asked for (FR-7)", () => {
    const { manager } = setup();
    const job = manager.enqueueGenerate({ width: 5, height: 5, level: "easy" }, "user:u1");
    expect(job.kind === "generate" && job.input.level).toBe("easy");
  });

  test("enqueueGenerate picks a random seed when none is given", () => {
    const { manager } = setup();
    const job = manager.enqueueGenerate({ width: 5, height: 5 }, "user:u1");
    expect(job.kind === "generate" && job.input.seed).toBe("j-1");
    expect(job.id).toBe("j-2");
  });

  test("enqueueVerify queues a verification, claimed before everything else", () => {
    const { manager } = setup();
    const puzzle = serializePuzzle(createPuzzle(2, 2, [2, 2, 2, 2]));
    expect(manager.enqueueVerify(puzzle)).toMatchObject({
      kind: "verify",
      input: { puzzle },
      priority: JOB_PRIORITY.verify,
      requester: null,
    });
  });

  test("refuses new jobs while the queue is full", () => {
    const { manager } = setup(2);
    manager.enqueueGenerate({ width: 5, height: 5, seed: "a" }, "ip:1");
    manager.enqueueGenerate({ width: 5, height: 5, seed: "b" }, "ip:2");
    expect(() => manager.enqueueGenerate({ width: 5, height: 5, seed: "c" }, "ip:3")).toThrow(
      QueueFullError,
    );
  });

  test("refuses a requester's generation while they have the most allowed waiting or running", () => {
    const { jobs, manager } = setup(10, 2);
    const first = manager.enqueueGenerate({ width: 5, height: 5 }, "user:u1");
    manager.enqueueGenerate({ width: 5, height: 5 }, "user:u1");
    expect(() => manager.enqueueGenerate({ width: 5, height: 5 }, "user:u1")).toThrow(
      TooManyPendingJobsError,
    );
    // Someone else isn't held back.
    manager.enqueueGenerate({ width: 5, height: 5 }, "ip:1.2.3.4");
    // A running job still counts; once it has ended, the requester may queue another.
    jobs.claimNext("w", 50);
    expect(() => manager.enqueueGenerate({ width: 5, height: 5 }, "user:u1")).toThrow(
      TooManyPendingJobsError,
    );
    jobs.finish(first.id, "w", { status: "failed", error: "boom" }, 60);
    expect(manager.enqueueGenerate({ width: 5, height: 5 }, "user:u1").status).toBe("queued");
  });

  test("enqueueDaily queues a daily's generation under its id, even when the queue is full", () => {
    const { manager } = setup(1);
    manager.enqueueGenerate({ width: 5, height: 5, seed: "a" }, "ip:1");
    const input = { width: 7, height: 7, seed: "s", day: "2026-10-25", level: "hard" } as const;
    expect(manager.enqueueDaily("d-1", input)).toMatchObject({
      id: "d-1",
      kind: "generate",
      status: "queued",
      input,
      priority: JOB_PRIORITY.daily,
      requester: null,
    });
  });
});
