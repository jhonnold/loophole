import { describe, expect, test } from "bun:test";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { storeDaily } from "../test-support/daily.ts";
import {
  FakeAttemptRepository,
  FakeClock,
  FakeDailyRepository,
  FakePuzzleRepository,
} from "../test-support/fakes.ts";
import { AttemptManager, minRankedMs, rankedGraceMs } from "./attempt-manager.ts";
import { DailyManager } from "./daily-manager.ts";
import {
  AttemptNotFoundError,
  DailyEndedError,
  DailyNotFoundError,
  InvalidBoardError,
  WrongSolutionError,
} from "./errors.ts";
import { PuzzleManager } from "./puzzle-manager.ts";

// The test daily is 2×2 all 2s; its only loop runs around the outside. Area 4, so a ranked solve
// takes at least minRankedMs(4) = 5 s.
const SOLVED = "112211121121";
const SOLVED_WITHOUT_CROSSES = "110011101101";
const WRONG = "100000000000";
const MIDNIGHT = Date.UTC(2026, 9, 26);
const T0 = MIDNIGHT - 60 * 60 * 1000;

async function setup(blobs = new MemoryBlobStore()) {
  const clock = new FakeClock(T0);
  const dailyRepo = new FakeDailyRepository();
  const repo = new FakeAttemptRepository();
  const puzzles = new PuzzleManager({
    puzzles: new FakePuzzleRepository(),
    blobs,
    clock,
  });
  await storeDaily(dailyRepo, puzzles, "2026-10-24", "d24");
  await storeDaily(dailyRepo, puzzles, "2026-10-25", "d25");
  await storeDaily(dailyRepo, puzzles, "2026-10-25", "d25-big", 10);
  await storeDaily(dailyRepo, puzzles, "2026-10-26", "d26");
  await puzzles.saveGenerated("practice", {
    puzzle: { v: 1, width: 2, height: 2, clues: "2222" },
    solution: SOLVED,
    steps: [],
  });
  const dailies = new DailyManager({ dailies: dailyRepo, puzzles, clock });
  const manager = new AttemptManager({ attempts: repo, dailies, puzzles, clock });
  return { clock, repo, manager };
}

describe("AttemptManager.start", () => {
  test("starts one attempt per player and daily, on the server's clock (FR-25)", async () => {
    const { clock, manager } = await setup();
    expect(manager.get("u1", "d25")).toBeNull();
    const started = manager.start("u1", "d25");
    expect(started).toEqual({
      attempt: {
        userId: "u1",
        puzzleId: "d25",
        day: "2026-10-25",
        area: 4,
        level: 1,
        startedAt: T0,
        finishedAt: null,
        timeMs: null,
        assisted: false,
        ranked: false,
      },
      elapsedMs: 0,
      rank: null,
    });
    clock.advance(30_000);
    // Starting again (another tab, a reload) gives back the same attempt and its running clock.
    expect(manager.start("u1", "d25")).toMatchObject({
      attempt: { startedAt: T0 },
      elapsedMs: 30_000,
    });
    expect(manager.get("u1", "d25")?.elapsedMs).toBe(30_000);
    expect(manager.start("u2", "d25").attempt.startedAt).toBe(T0 + 30_000);
  });

  test("only today's daily can be started; tomorrow's and practice puzzles are not dailies", async () => {
    const { manager } = await setup();
    expect(() => manager.start("u1", "d24")).toThrow(DailyEndedError);
    expect(() => manager.start("u1", "d26")).toThrow(DailyNotFoundError);
    expect(() => manager.start("u1", "practice")).toThrow(DailyNotFoundError);
    expect(() => manager.get("u1", "nope")).toThrow(DailyNotFoundError);
  });

  test("at 00:00 UTC yesterday's daily can no longer be started", async () => {
    const { clock, manager } = await setup();
    clock.time = MIDNIGHT - 1;
    manager.start("u1", "d25");
    clock.time = MIDNIGHT;
    expect(() => manager.start("u2", "d25")).toThrow(DailyEndedError);
    expect(manager.start("u1", "d25").attempt.startedAt).toBe(MIDNIGHT - 1);
    expect(manager.start("u2", "d26").attempt.day).toBe("2026-10-26");
  });
});

describe("AttemptManager.finish", () => {
  test("a correct board finishes the attempt with the server's time and a rank (FR-17, FR-23)", async () => {
    const { clock, manager } = await setup();
    manager.start("u1", "d25");
    clock.advance(42_000);
    const done = await manager.finish("u1", "d25", { edges: SOLVED, elapsedMs: 41_500 });
    expect(done).toEqual({
      attempt: expect.objectContaining({ finishedAt: T0 + 42_000, timeMs: 41_500, ranked: true }),
      elapsedMs: 41_500,
      rank: 1,
    });
    // Crosses and empty edges are the same thing to the check: only lines matter.
    manager.start("u2", "d25");
    clock.advance(50_000);
    const second = await manager.finish("u2", "d25", {
      edges: SOLVED_WITHOUT_CROSSES,
      elapsedMs: 50_000,
    });
    expect(second.rank).toBe(2);
  });

  test("a wrong or malformed board is refused and the attempt carries on", async () => {
    const { clock, manager } = await setup();
    manager.start("u1", "d25");
    clock.advance(10_000);
    await expect(manager.finish("u1", "d25", { edges: WRONG, elapsedMs: 1 })).rejects.toThrow(
      WrongSolutionError,
    );
    await expect(manager.finish("u1", "d25", { edges: "12", elapsedMs: 1 })).rejects.toThrow(
      InvalidBoardError,
    );
    expect(manager.get("u1", "d25")?.attempt.finishedAt).toBeNull();
  });

  test("finishing without an attempt, or a practice puzzle, is refused", async () => {
    const { manager } = await setup();
    await expect(manager.finish("u1", "d25", { edges: SOLVED, elapsedMs: 1 })).rejects.toThrow(
      AttemptNotFoundError,
    );
    await expect(manager.finish("u1", "practice", { edges: SOLVED, elapsedMs: 1 })).rejects.toThrow(
      DailyNotFoundError,
    );
  });

  test("the player's time counts only within the grace period of the server's", async () => {
    const { clock, manager } = await setup();
    manager.start("u1", "d25");
    clock.advance(100_000);
    // Claims to have taken 1 s: the server allows at most a tenth of its own time less (10 s here).
    expect([rankedGraceMs(5_000), rankedGraceMs(100_000), rankedGraceMs(600_000)]).toEqual([
      3_000, 10_000, 15_000,
    ]);
    const cheat = await manager.finish("u1", "d25", { edges: SOLVED, elapsedMs: 1_000 });
    expect(cheat.attempt.timeMs).toBe(90_000);
    // Claims more than the server measured: the server's time wins.
    manager.start("u2", "d25");
    clock.advance(20_000);
    const slow = await manager.finish("u2", "d25", { edges: SOLVED, elapsedMs: 90_000 });
    expect(slow.attempt.timeMs).toBe(20_000);
  });

  test("a solve faster than anyone can draw the loop is kept but not ranked", async () => {
    const { clock, manager } = await setup();
    expect(minRankedMs(4)).toBe(5_000);
    expect(minRankedMs(1600)).toBe(160_000);
    manager.start("u1", "d25");
    clock.advance(4_999);
    const fast = await manager.finish("u1", "d25", { edges: SOLVED, elapsedMs: 4_999 });
    expect(fast).toMatchObject({ attempt: { timeMs: 4_999, ranked: false }, rank: null });
  });

  test("a hint during the attempt keeps it off the leaderboard (FR-12, FR-23)", async () => {
    const { clock, manager } = await setup();
    manager.start("u1", "d25");
    expect(manager.recordHint("u1", "d25")).toBe(true);
    clock.advance(60_000);
    const done = await manager.finish("u1", "d25", { edges: SOLVED, elapsedMs: 60_000 });
    expect(done).toMatchObject({ attempt: { assisted: true, ranked: false }, rank: null });
    // A hint after finishing changes nothing.
    manager.start("u2", "d25");
    clock.advance(60_000);
    await manager.finish("u2", "d25", { edges: SOLVED, elapsedMs: 60_000 });
    manager.recordHint("u2", "d25");
    expect(manager.get("u2", "d25")).toMatchObject({ attempt: { assisted: false }, rank: 1 });
  });

  test("a hint that lands while finish reads the solution still marks the solve assisted", async () => {
    const blobs = new MemoryBlobStore();
    const { clock, manager } = await setup(blobs);
    manager.start("u1", "d25");
    clock.advance(60_000);
    // Hold the solution's read, so the hint is recorded while finish is waiting on it.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = blobs.get.bind(blobs);
    blobs.get = async (key) => {
      await held;
      return read(key);
    };
    const finishing = manager.finish("u1", "d25", { edges: SOLVED, elapsedMs: 60_000 });
    expect(manager.recordHint("u1", "d25")).toBe(true);
    release();
    const done = await finishing;
    expect(done).toMatchObject({ attempt: { assisted: true, ranked: false }, rank: null });
  });

  test("sending the solution again, as a retry does, returns the finished attempt unchanged", async () => {
    const { clock, manager } = await setup();
    manager.start("u1", "d25");
    clock.advance(30_000);
    const first = await manager.finish("u1", "d25", { edges: SOLVED, elapsedMs: 30_000 });
    clock.advance(60_000);
    expect(await manager.finish("u1", "d25", { edges: WRONG, elapsedMs: 5 })).toEqual(first);
  });

  test("an attempt started before 00:00 UTC can be finished after it", async () => {
    const { clock, manager } = await setup();
    clock.time = MIDNIGHT - 20_000;
    manager.start("u1", "d25");
    clock.time = MIDNIGHT + 10_000;
    const done = await manager.finish("u1", "d25", { edges: SOLVED, elapsedMs: 30_000 });
    expect(done).toMatchObject({ attempt: { day: "2026-10-25", timeMs: 30_000, ranked: true } });
  });
});

describe("AttemptManager.recordHint", () => {
  test("says whether the puzzle is today's daily", async () => {
    const { manager } = await setup();
    expect(manager.recordHint(null, "d25")).toBe(true);
    expect(manager.recordHint(null, "d24")).toBe(false);
    expect(manager.recordHint("u1", "practice")).toBe(false);
    expect(manager.recordHint("u1", "d26")).toBe(false);
  });
});

describe("AttemptManager.summary (FR-24)", () => {
  /** Plays and finishes `puzzleId` for u1 at `at`, taking a minute. */
  async function solveAt(
    clock: FakeClock,
    manager: AttemptManager,
    puzzleId: string,
    at: number,
    hint = false,
  ) {
    clock.time = at;
    manager.start("u1", puzzleId);
    if (hint) manager.recordHint("u1", puzzleId);
    clock.advance(60_000);
    await manager.finish("u1", puzzleId, { edges: SOLVED, elapsedMs: 60_000 });
  }

  test("counts consecutive days with a finished daily, hinted or not, and keeps it until midnight", async () => {
    const { clock, manager } = await setup();
    await solveAt(clock, manager, "d24", Date.UTC(2026, 9, 24, 9), true);
    clock.time = T0;
    const today = manager.summary("u1");
    expect(today.streak).toBe(1);
    expect(today.week.map((d) => d.finished)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      false,
    ]);
    expect(today.week.at(-1)?.day).toBe("2026-10-25");
    expect(today.attempts).toEqual([]);
    expect(today.bests).toEqual([]);

    await solveAt(clock, manager, "d25", T0);
    const both = manager.summary("u1");
    expect(both.streak).toBe(2);
    expect(both.attempts.map((a) => a.attempt.puzzleId)).toEqual(["d25"]);
    expect(both.bests).toEqual([{ area: 4, level: 1, timeMs: 60_000 }]);

    // Two days later without playing, the streak is gone.
    clock.time = MIDNIGHT + 86_400_000;
    expect(manager.summary("u1").streak).toBe(0);
  });

  test("an unfinished attempt doesn't count toward the streak", async () => {
    const { clock, manager } = await setup();
    clock.time = T0;
    manager.start("u1", "d25");
    expect(manager.summary("u1")).toMatchObject({ streak: 0, attempts: [{ rank: null }] });
  });
});
