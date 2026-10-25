import { describe, expect, test } from "bun:test";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { storeDaily } from "../test-support/daily.ts";
import { FakeClock, FakeDailyRepository, FakePuzzleRepository } from "../test-support/fakes.ts";
import { DAILY_SIZES, DailyManager } from "./daily-manager.ts";
import { DailyNotFoundError } from "./errors.ts";
import { PuzzleManager } from "./puzzle-manager.ts";

const MIDNIGHT = Date.UTC(2026, 9, 26);

function setup(now = MIDNIGHT - 1) {
  const clock = new FakeClock(now);
  const repo = new FakeDailyRepository();
  const puzzleRepo = new FakePuzzleRepository();
  const puzzles = new PuzzleManager({ puzzles: puzzleRepo, blobs: new MemoryBlobStore(), clock });
  const manager = new DailyManager({ dailies: repo, puzzles, clock });
  return { clock, repo, puzzles, puzzleRepo, manager };
}

describe("DailyManager (FR-22)", () => {
  test("today's set has every size class, with null for puzzles not ready", async () => {
    const { repo, puzzles, manager } = setup();
    await storeDaily(repo, puzzles, "2026-10-25", "d7", 7);
    expect(manager.forDay()).toEqual({
      day: "2026-10-25",
      live: true,
      nextAt: MIDNIGHT,
      puzzles: DAILY_SIZES.map((size) => ({ size, puzzleId: size === 7 ? "d7" : null })),
    });
  });

  test("switches at 00:00 UTC: tomorrow's puzzle appears and today's stops being live", async () => {
    const { clock, repo, puzzles, manager } = setup();
    await storeDaily(repo, puzzles, "2026-10-25", "today", 7);
    await storeDaily(repo, puzzles, "2026-10-26", "tomorrow", 7);
    expect(manager.byPuzzle("tomorrow")).toBeNull();
    expect(() => manager.forDay("2026-10-26")).toThrow(DailyNotFoundError);
    clock.time = MIDNIGHT;
    expect(manager.today()).toBe("2026-10-26");
    expect(manager.forDay().puzzles[0]).toEqual({ size: 7, puzzleId: "tomorrow" });
    expect(manager.forDay("2026-10-25")).toMatchObject({
      live: false,
      nextAt: MIDNIGHT + 86_400_000,
    });
    const yesterday = manager.byPuzzle("today");
    expect(yesterday?.day).toBe("2026-10-25");
    expect(yesterday && manager.isLive(yesterday)).toBe(false);
  });

  test("an unpublished daily and a practice puzzle are not dailies", async () => {
    const { repo, puzzles, manager } = setup();
    await storeDaily(repo, puzzles, "2026-10-25", "d7", 7);
    await puzzles.saveGenerated("practice", {
      puzzle: { v: 1, width: 1, height: 1, clues: "." },
      solution: "1111",
      steps: [],
    });
    expect(manager.byPuzzle("practice")).toBeNull();
    puzzles.unpublish("d7");
    expect(manager.byPuzzle("d7")).toBeNull();
    expect(manager.forDay().puzzles[0].puzzleId).toBeNull();
  });
});
