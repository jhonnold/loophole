import { describe, expect, test } from "bun:test";
import { ThreadTaskRunner } from "./thread-task-runner.ts";

describe("ThreadTaskRunner", () => {
  const runner = new ThreadTaskRunner();

  test("runs a generation in a thread and passes progress on", async () => {
    const seen: number[] = [];
    const outcome = await runner.run(
      { kind: "generate", input: { width: 6, height: 6, seed: "thread" } },
      { timeoutMs: 10_000, onProgress: (p) => seen.push(p) },
    );
    expect(outcome.status).toBe("done");
    expect(seen.length).toBeGreaterThan(0);
  });

  test("a thread that exits without a result fails the task without waiting for the limit", async () => {
    const silent = new ThreadTaskRunner(
      new URL("../../test-support/silent-thread.ts", import.meta.url).href,
    );
    const started = performance.now();
    const outcome = await silent.run(
      { kind: "generate", input: { width: 5, height: 5, seed: "silent" } },
      { timeoutMs: 60_000, onProgress: () => {} },
    );
    expect(outcome).toEqual({ status: "failed", error: "Task thread exited without a result" });
    expect(performance.now() - started).toBeLessThan(10_000);
  });

  test("stops a long generation at the time limit", async () => {
    const started = performance.now();
    const outcome = await runner.run(
      { kind: "generate", input: { width: 100, height: 100, seed: "too-slow" } },
      { timeoutMs: 300, onProgress: () => {} },
    );
    expect(outcome).toEqual({ status: "timeout" });
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  test("stops a long generation when its signal aborts (worker shutdown)", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const started = performance.now();
    const outcome = await runner.run(
      { kind: "generate", input: { width: 100, height: 100, seed: "shutdown" } },
      { timeoutMs: 60_000, onProgress: () => {}, signal: controller.signal },
    );
    expect(outcome).toEqual({ status: "cancelled" });
    expect(performance.now() - started).toBeLessThan(2_000);
    // A signal that has already aborted starts nothing.
    expect(
      await runner.run(
        { kind: "generate", input: { width: 5, height: 5, seed: "s" } },
        { timeoutMs: 60_000, onProgress: () => {}, signal: controller.signal },
      ),
    ).toEqual({ status: "cancelled" });
  });

  test("reports the core's error as failed", async () => {
    const outcome = await runner.run(
      { kind: "generate", input: { width: 0, height: 5, seed: "s" } },
      { timeoutMs: 10_000, onProgress: () => {} },
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.status === "failed" && outcome.error).toContain("grid size");
  });
});
