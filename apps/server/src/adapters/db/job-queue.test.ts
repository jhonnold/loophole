import { describe, expect, test } from "bun:test";
import { JOB_PRIORITY, type JobInput } from "../../domain.ts";
import { openDatabase } from "./database.ts";
import { SqliteJobQueue } from "./job-queue.ts";

const generate = (seed: string): JobInput => ({
  kind: "generate",
  input: { width: 5, height: 5, seed },
});

function queueWith(...seeds: string[]) {
  const queue = new SqliteJobQueue(openDatabase(":memory:"));
  seeds.forEach((seed, i) => {
    queue.enqueue({ id: seed, job: generate(seed), createdAt: 100 + i });
  });
  return queue;
}

describe("SqliteJobQueue", () => {
  test("enqueue stores a queued job with its input", () => {
    const queue = queueWith();
    const job = queue.enqueue({ id: "j1", job: generate("s"), createdAt: 5 });
    expect(job).toEqual({
      id: "j1",
      kind: "generate",
      input: { width: 5, height: 5, seed: "s" },
      status: "queued",
      progress: 0,
      result: null,
      error: null,
      attempts: 0,
      priority: JOB_PRIORITY.player,
      requester: null,
      claimedBy: null,
      createdAt: 5,
      startedAt: null,
      heartbeatAt: null,
      finishedAt: null,
    });
    expect(queue.get("j1")).toEqual(job);
    expect(queue.get("nope")).toBeNull();
    expect(queue.countQueued()).toBe(1);
  });

  test("claimNext takes the oldest queued job once, then returns null", () => {
    const queue = queueWith("a", "b");
    const first = queue.claimNext("w1", 1000);
    expect(first).toMatchObject({
      id: "a",
      status: "running",
      claimedBy: "w1",
      attempts: 1,
      startedAt: 1000,
      heartbeatAt: 1000,
    });
    expect(queue.claimNext("w2", 1001)?.id).toBe("b");
    expect(queue.claimNext("w1", 1002)).toBeNull();
    expect(queue.countQueued()).toBe(0);
  });

  test("progress, heartbeat and finish apply only for the claiming worker", () => {
    const queue = queueWith("a");
    queue.claimNext("w1", 1000);
    queue.setProgress("a", "w2", 0.9, 1500);
    queue.heartbeat("a", "w2", 1500);
    expect(queue.get("a")).toMatchObject({ progress: 0, heartbeatAt: 1000 });
    queue.setProgress("a", "w1", 0.5, 2000);
    expect(queue.get("a")).toMatchObject({ progress: 0.5, heartbeatAt: 2000 });
    queue.heartbeat("a", "w1", 2500);
    expect(queue.get("a")?.heartbeatAt).toBe(2500);
    const result = { kind: "generate", puzzleId: "p1" } as const;
    expect(queue.finish("a", "w2", { status: "done", result }, 3000)).toBe(false);
    expect(queue.finish("a", "w1", { status: "done", result }, 3000)).toBe(true);
    expect(queue.get("a")).toMatchObject({
      status: "done",
      progress: 1,
      result,
      error: null,
      finishedAt: 3000,
    });
    expect(queue.finish("a", "w1", { status: "failed", error: "late" }, 4000)).toBe(false);
  });

  test("finish records failures and timeouts with their message and last progress", () => {
    const queue = queueWith("a", "b");
    queue.claimNext("w", 1);
    queue.claimNext("w", 1);
    queue.setProgress("b", "w", 0.3, 2);
    queue.finish("a", "w", { status: "failed", error: "boom" }, 2);
    queue.finish("b", "w", { status: "timeout", error: "too slow" }, 3);
    expect(queue.get("a")).toMatchObject({ status: "failed", error: "boom", result: null });
    expect(queue.get("b")).toMatchObject({
      status: "timeout",
      error: "too slow",
      progress: 0.3,
      finishedAt: 3,
    });
  });

  test("recoverStale requeues silent jobs, and fails them after the last attempt", () => {
    const queue = queueWith("a", "b");
    queue.claimNext("w1", 1000);
    queue.claimNext("w1", 1000);
    queue.heartbeat("b", "w1", 5000);
    // "a" went silent at 1000; "b" is still beating.
    expect(queue.recoverStale(2000, 2, 6000)).toEqual({ requeued: 1, lost: 0 });
    expect(queue.get("a")).toMatchObject({ status: "queued", claimedBy: null, attempts: 1 });
    expect(queue.get("b")?.status).toBe("running");
    // The old worker can no longer report on "a".
    expect(queue.finish("a", "w1", { status: "failed", error: "x" }, 6000)).toBe(false);
    // Second attempt goes silent too: with maxAttempts 2 it fails for good.
    expect(queue.claimNext("w2", 7000)?.id).toBe("a");
    expect(queue.recoverStale(8000, 2, 9000)).toEqual({ requeued: 1, lost: 1 });
    expect(queue.get("a")).toMatchObject({ status: "failed", attempts: 2, finishedAt: 9000 });
    expect(queue.get("a")?.error).toContain("stopped responding");
    expect(queue.get("b")?.status).toBe("queued");
  });

  test("countActive counts waiting and running jobs; listFailed is newest first", () => {
    const queue = queueWith("a", "b", "c", "d");
    expect(queue.countActive()).toEqual({ queued: 4, running: 0, oldestQueuedAt: 100 });
    queue.claimNext("w", 1);
    queue.claimNext("w", 1);
    queue.claimNext("w", 1);
    expect(queue.countActive()).toEqual({ queued: 1, running: 3, oldestQueuedAt: 103 });
    queue.finish("a", "w", { status: "failed", error: "boom" }, 5);
    queue.finish("b", "w", { status: "timeout", error: "too slow" }, 6);
    queue.finish("c", "w", { status: "done", result: { kind: "generate", puzzleId: "c" } }, 7);
    expect(queue.countActive()).toEqual({ queued: 1, running: 0, oldestQueuedAt: 103 });
    expect(queue.listFailed(10).map((j) => j.id)).toEqual(["b", "a"]);
    expect(queue.listFailed(1).map((j) => j.id)).toEqual(["b"]);
    queue.claimNext("w", 8);
    expect(queue.countActive()).toEqual({ queued: 0, running: 1, oldestQueuedAt: null });
  });

  test("claimNext takes verifications, then daily puzzles, then players' jobs, oldest first in each", () => {
    const queue = queueWith();
    const add = (id: string, priority: number, createdAt: number) =>
      queue.enqueue({ id, job: generate(id), createdAt, priority });
    add("player-old", JOB_PRIORITY.player, 1);
    add("daily", JOB_PRIORITY.daily, 2);
    add("verify-new", JOB_PRIORITY.verify, 4);
    add("verify-old", JOB_PRIORITY.verify, 3);
    add("player-new", JOB_PRIORITY.player, 5);
    const order = [1, 2, 3, 4, 5].map(() => queue.claimNext("w", 10)?.id);
    expect(order).toEqual(["verify-old", "verify-new", "daily", "player-old", "player-new"]);
  });

  test("claimNext with maxPriority leaves lower-priority jobs queued", () => {
    const queue = queueWith("a");
    queue.enqueue({ id: "v", job: generate("v"), createdAt: 200, priority: JOB_PRIORITY.verify });
    expect(queue.claimNext("w", 1, JOB_PRIORITY.verify)?.id).toBe("v");
    expect(queue.claimNext("w", 1, JOB_PRIORITY.verify)).toBeNull();
    expect(queue.get("a")?.status).toBe("queued");
  });

  test("countPending counts a requester's waiting and running jobs; an ended job forgets its requester", () => {
    const queue = queueWith();
    const add = (id: string, requester: string) =>
      queue.enqueue({ id, job: generate(id), createdAt: 1, requester });
    add("a", "ip:1.2.3.4");
    add("b", "ip:1.2.3.4");
    add("c", "user:u1");
    expect(queue.countPending("ip:1.2.3.4")).toBe(2);
    queue.claimNext("w", 2);
    expect(queue.countPending("ip:1.2.3.4")).toBe(2);
    queue.finish("a", "w", { status: "done", result: { kind: "generate", puzzleId: "a" } }, 3);
    expect(queue.countPending("ip:1.2.3.4")).toBe(1);
    expect(queue.get("a")?.requester).toBeNull();
    expect(queue.get("b")?.requester).toBe("ip:1.2.3.4");
    expect(queue.countPending("user:u1")).toBe(1);
    expect(queue.countPending("user:nobody")).toBe(0);
  });

  test("release gives a running job back to the queue without counting the claim", () => {
    const queue = queueWith("a");
    queue.claimNext("w1", 1000);
    expect(queue.release("a", "w2")).toBe(false);
    expect(queue.release("a", "w1")).toBe(true);
    expect(queue.get("a")).toMatchObject({ status: "queued", claimedBy: null, attempts: 0 });
    expect(queue.release("a", "w1")).toBe(false);
    // The old worker can no longer finish it; the next claim does.
    expect(queue.finish("a", "w1", { status: "failed", error: "x" }, 1001)).toBe(false);
    expect(queue.claimNext("w2", 1002)).toMatchObject({ id: "a", claimedBy: "w2", attempts: 1 });
  });
});
