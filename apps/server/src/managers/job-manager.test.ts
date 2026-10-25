import { describe, expect, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { FakeClock, FakeJobQueue, sequentialIds } from "../test-support/fakes.ts";
import { QueueFullError } from "./errors.ts";
import { JobManager } from "./job-manager.ts";

function setup(maxQueued = 10) {
  const jobs = new FakeJobQueue();
  const manager = new JobManager({
    jobs,
    clock: new FakeClock(42),
    newId: sequentialIds("j"),
    maxQueued,
  });
  return { jobs, manager };
}

describe("JobManager", () => {
  test("enqueueGenerate queues a generation with the given seed", () => {
    const { manager } = setup();
    const job = manager.enqueueGenerate({ width: 10, height: 7, seed: "abc" });
    expect(job).toMatchObject({
      id: "j-1",
      kind: "generate",
      status: "queued",
      input: { width: 10, height: 7, seed: "abc" },
      createdAt: 42,
    });
    expect(manager.get("j-1")).toEqual(job);
    expect(manager.get("nope")).toBeNull();
  });

  test("enqueueGenerate picks a random seed when none is given", () => {
    const { manager } = setup();
    const job = manager.enqueueGenerate({ width: 5, height: 5 });
    expect(job.kind === "generate" && job.input.seed).toBe("j-1");
    expect(job.id).toBe("j-2");
  });

  test("enqueueVerify queues a verification", () => {
    const { manager } = setup();
    const puzzle = serializePuzzle(createPuzzle(2, 2, [2, 2, 2, 2]));
    expect(manager.enqueueVerify(puzzle)).toMatchObject({ kind: "verify", input: { puzzle } });
  });

  test("refuses new jobs while the queue is full", () => {
    const { manager } = setup(2);
    manager.enqueueGenerate({ width: 5, height: 5, seed: "a" });
    manager.enqueueGenerate({ width: 5, height: 5, seed: "b" });
    expect(() => manager.enqueueGenerate({ width: 5, height: 5, seed: "c" })).toThrow(
      QueueFullError,
    );
  });
});
