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

  test("stops a long generation at the time limit", async () => {
    const started = performance.now();
    const outcome = await runner.run(
      { kind: "generate", input: { width: 100, height: 100, seed: "too-slow" } },
      { timeoutMs: 300, onProgress: () => {} },
    );
    expect(outcome).toEqual({ status: "timeout" });
    expect(performance.now() - started).toBeLessThan(2_000);
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
