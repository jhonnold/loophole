import { describe, expect, test } from "bun:test";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import type { AttemptRecord } from "../domain.ts";
import { storeDaily } from "../test-support/daily.ts";
import {
  FakeAttemptRepository,
  FakeClock,
  FakeDailyRepository,
  FakeDisplayNameRepository,
  FakePuzzleRepository,
} from "../test-support/fakes.ts";
import { DailyManager } from "./daily-manager.ts";
import { DailyNotFoundError } from "./errors.ts";
import { LeaderboardManager } from "./leaderboard-manager.ts";
import { PuzzleManager } from "./puzzle-manager.ts";

async function setup() {
  const clock = new FakeClock(Date.UTC(2026, 9, 25, 12));
  const dailyRepo = new FakeDailyRepository();
  const names = new FakeDisplayNameRepository();
  const repo = new FakeAttemptRepository(names);
  const puzzles = new PuzzleManager({
    puzzles: new FakePuzzleRepository(),
    blobs: new MemoryBlobStore(),
    clock,
  });
  await storeDaily(dailyRepo, puzzles, "2026-10-24", "d24");
  await storeDaily(dailyRepo, puzzles, "2026-10-25", "d25");
  await storeDaily(dailyRepo, puzzles, "2026-10-26", "d26");
  const dailies = new DailyManager({ dailies: dailyRepo, puzzles, clock });
  const manager = new LeaderboardManager({ attempts: repo, dailies, puzzles });
  /** A finished attempt at the 2×2 daily `puzzleId`. */
  const solve = (userId: string, puzzleId: string, timeMs: number, ranked = true) => {
    const a: AttemptRecord = {
      userId,
      puzzleId,
      day: puzzleId === "d24" ? "2026-10-24" : "2026-10-25",
      area: 4,
      level: 1,
      startedAt: 0,
      finishedAt: timeMs,
      timeMs,
      assisted: !ranked,
      ranked,
    };
    repo.insertOver(a);
  };
  return { names, manager, solve };
}

describe("LeaderboardManager (FR-23)", () => {
  test("a daily's board ranks ranked solves by time and leaves hinted ones out", async () => {
    const { names, manager, solve } = await setup();
    solve("u1", "d25", 9000);
    solve("u2", "d25", 7000);
    solve("u3", "d25", 1000, false);
    names.set("u2", "tsuru", 0);
    expect(manager.forPuzzle("d25", "u1", 10)).toEqual({
      area: 4,
      level: 1,
      total: 2,
      entries: [
        { rank: 1, userId: "u2", name: "tsuru", timeMs: 7000 },
        { rank: 2, userId: "u1", name: null, timeMs: 9000 },
      ],
      me: { rank: 2, userId: "u1", name: null, timeMs: 9000 },
    });
    expect(manager.forPuzzle("d25", "u3", 10).me).toBeNull();
    expect(manager.forPuzzle("d25", null, 1).entries.map((e) => e.rank)).toEqual([1]);
  });

  test("shows the viewer's rank even outside the top", async () => {
    const { manager, solve } = await setup();
    for (let i = 1; i <= 30; i++) solve(`u${i}`, "d25", i * 1000);
    const board = manager.forPuzzle("d25", "u20", 3);
    expect(board.total).toBe(30);
    expect(board.entries.map((e) => e.rank)).toEqual([1, 2, 3, 19, 20, 21]);
    expect(board.me?.rank).toBe(20);
  });

  test("the bucket's all-time board takes each player's best across dailies of that area", async () => {
    const { manager, solve } = await setup();
    solve("u1", "d24", 5000);
    solve("u1", "d25", 3000);
    solve("u2", "d24", 4000);
    expect(manager.forBucket(4, 1, null, 10).entries).toEqual([
      { rank: 1, userId: "u1", name: null, timeMs: 3000 },
      { rank: 2, userId: "u2", name: null, timeMs: 4000 },
    ]);
    expect(manager.forBucket(49, 1, "u1", 10)).toEqual({
      area: 49,
      level: 1,
      total: 0,
      entries: [],
      me: null,
    });
  });

  test("tomorrow's daily and unknown puzzles have no board", async () => {
    const { manager } = await setup();
    expect(() => manager.forPuzzle("d26", null, 10)).toThrow(DailyNotFoundError);
    expect(() => manager.forPuzzle("nope", null, 10)).toThrow(DailyNotFoundError);
  });
});
