import { describe, expect, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import { FakeClock, FakePuzzleRepository, FakeReportRepository } from "../test-support/fakes.ts";
import { RateLimitedError } from "./errors.ts";
import { PuzzleManager } from "./puzzle-manager.ts";
import { REPORTS_PER_ACCOUNT, ReportManager } from "./report-manager.ts";

async function setup() {
  const clock = new FakeClock(1_000);
  const puzzleRepo = new FakePuzzleRepository();
  const puzzles = new PuzzleManager({ puzzles: puzzleRepo, blobs: new MemoryBlobStore(), clock });
  for (const [id, clues] of [
    ["p1", [2, 2, 2, 2]],
    ["p2", [2, 2, 2, -1]],
  ] as const) {
    await puzzles.saveGenerated(id, {
      puzzle: serializePuzzle(createPuzzle(2, 2, clues)),
      solution: "112211121121",
      steps: [],
    });
  }
  const reports = new FakeReportRepository((id) => puzzleRepo.get(id)?.status === "published");
  const manager = new ReportManager({
    reports,
    puzzles,
    limiter: new MemoryRateLimiter(clock),
    clock,
  });
  return { clock, puzzles, reports, manager };
}

describe("ReportManager", () => {
  test("a report of a published puzzle is stored; reporting again replaces the reason", async () => {
    const { clock, reports, manager } = await setup();
    expect(manager.report("u1", "p1", "spells a rude word")).toBe(true);
    clock.advance(10);
    expect(manager.report("u1", "p1", "actually two rude words")).toBe(true);
    expect(reports.reports).toEqual([
      { puzzleId: "p1", reporterId: "u1", reason: "actually two rude words", createdAt: 1_010 },
    ]);
  });

  test("an unknown or unpublished puzzle can't be reported", async () => {
    const { puzzles, manager } = await setup();
    puzzles.unpublish("p2");
    expect(manager.report("u1", "nope", "x")).toBe(false);
    expect(manager.report("u1", "p2", "x")).toBe(false);
  });

  test("an account gets a limited number of reports per hour", async () => {
    const { manager } = await setup();
    for (let i = 0; i < REPORTS_PER_ACCOUNT.limit; i++) manager.report("u1", "p1", `r${i}`);
    expect(() => manager.report("u1", "p1", "again")).toThrow(RateLimitedError);
  });

  test("listReported groups by puzzle, most recently reported first, and skips unpublished ones", async () => {
    const { clock, puzzles, manager } = await setup();
    manager.report("u1", "p1", "first");
    clock.advance(1);
    manager.report("u2", "p2", "second");
    clock.advance(1);
    manager.report("u3", "p1", "third");
    const list = manager.listReported();
    expect(list.map((r) => [r.puzzle.id, r.count, r.reports.map((x) => x.reason)])).toEqual([
      ["p1", 2, ["third", "first"]],
      ["p2", 1, ["second"]],
    ]);
    puzzles.unpublish("p1");
    expect(manager.listReported().map((r) => r.puzzle.id)).toEqual(["p2"]);
  });

  test("dismiss clears a puzzle's reports and keeps it published", async () => {
    const { puzzles, manager } = await setup();
    manager.report("u1", "p1", "meh");
    manager.dismiss("p1");
    expect(manager.listReported()).toEqual([]);
    expect(puzzles.get("p1")).not.toBeNull();
  });
});
