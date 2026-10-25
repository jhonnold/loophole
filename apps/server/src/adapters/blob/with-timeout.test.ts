import { describe, expect, test } from "bun:test";
import { withTimeout } from "./with-timeout.ts";

describe("withTimeout", () => {
  test("passes through an answer that comes in time", async () => {
    expect(await withTimeout(Promise.resolve("blob"), 1_000, "read")).toBe("blob");
  });

  test("rejects a request that never answers, naming the request", async () => {
    const stalled = new Promise<string>(() => {});
    await expect(withTimeout(stalled, 10, "Writing puzzles/p1/solution.txt")).rejects.toThrow(
      "Writing puzzles/p1/solution.txt timed out after 0.01 s",
    );
  });

  test("a failing request keeps its own error", async () => {
    const failed = Promise.reject(new Error("connection refused"));
    await expect(withTimeout(failed, 1_000, "read")).rejects.toThrow("connection refused");
  });
});
