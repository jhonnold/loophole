import { describe, expect, test } from "bun:test";
import { createPuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { FakeClock, FakeProgressRepository, FakePuzzleRepository } from "../test-support/fakes.ts";
import { InvalidBoardError, PuzzleNotFoundError } from "./errors.ts";
import { ProgressManager } from "./progress-manager.ts";
import { PuzzleManager } from "./puzzle-manager.ts";

// 2×2 all 2s; its only loop runs around the outside.
const SOLVED = "112211121121";
const EMPTY = "000000000000";
const ONE_LINE = "100000000000";
const OTHER_LINE = "010000000000";
// A new record's first version is the clock's time (see ProgressManager); setup() starts at 1000.
const FIRST = 1000;

function setup() {
  const clock = new FakeClock(1000);
  const repo = new FakePuzzleRepository();
  for (const [id, status] of [
    ["p1", "published"],
    ["p2", "published"],
    ["hidden", "unpublished"],
  ] as const) {
    repo.insert({
      id,
      puzzle: createPuzzle(2, 2, [2, 2, 2, 2]),
      origin: "generated",
      status,
      level: 1,
      solutionKey: `puzzles/${id}/solution.txt`,
      traceKey: null,
      createdAt: 0,
      creatorId: null,
      releaseAt: null,
    });
  }
  const progress = new FakeProgressRepository();
  const puzzles = new PuzzleManager({ puzzles: repo, blobs: new MemoryBlobStore(), clock });
  const manager = new ProgressManager({ progress, puzzles, clock });
  return { clock, progress, manager };
}

/** A save from device `device` continuing from `baseVersion`. */
const input = (
  edges: string,
  baseVersion: number | null,
  device = "a",
  options: { elapsedMs?: number; assisted?: boolean } = {},
) => ({
  edges,
  elapsedMs: options.elapsedMs ?? 1000,
  assisted: options.assisted ?? false,
  baseVersion,
  device,
});

describe("ProgressManager", () => {
  test("stores a first save as version 1 and works out whether it is solved", () => {
    const { manager } = setup();
    expect(manager.get("u1", "p1")).toBeNull();
    const first = manager.save("u1", "p1", input(ONE_LINE, null, "a", { assisted: true }));
    expect(first).toEqual({
      accepted: true,
      record: {
        userId: "u1",
        puzzleId: "p1",
        edges: ONE_LINE,
        elapsedMs: 1000,
        solved: false,
        assisted: true,
        version: FIRST,
        device: "a",
        createdAt: 1000,
        updatedAt: 1000,
      },
    });
    expect(manager.get("u1", "p1")).toEqual(first.record);
    expect(manager.save("u1", "p2", input(SOLVED, null)).record.solved).toBe(true);
    expect(manager.get("u2", "p1")).toBeNull();
  });

  test("a save that continues from the stored version replaces it", () => {
    const { manager, clock } = setup();
    manager.save("u1", "p1", input(ONE_LINE, null, "a"));
    clock.advance(500);
    const next = manager.save("u1", "p1", input(EMPTY, FIRST, "b", { elapsedMs: 10 }));
    expect(next.accepted).toBe(true);
    expect(next.record).toMatchObject({
      edges: EMPTY,
      elapsedMs: 10,
      version: FIRST + 1,
      device: "b",
      createdAt: 1000,
      updatedAt: 1500,
    });
  });

  test("a stale save from another device is refused and gets the stored record", () => {
    const { manager, clock } = setup();
    manager.save("u1", "p1", input(ONE_LINE, null, "a"));
    const stored = manager.save("u1", "p1", input(OTHER_LINE, FIRST, "b")).record;
    clock.advance(500);
    // Device a still thinks version 1 is current, even with far more time on its clock.
    expect(manager.save("u1", "p1", input(ONE_LINE, FIRST, "a", { elapsedMs: 99_000 }))).toEqual({
      accepted: false,
      record: stored,
    });
    // A device that never loaded the record doesn't overwrite it either.
    expect(manager.save("u1", "p1", input(ONE_LINE, null, "c")).accepted).toBe(false);
    expect(manager.get("u1", "p1")).toEqual(stored);
  });

  test("a save of the stored board keeps its version and device", () => {
    const { manager, clock } = setup();
    manager.save("u1", "p1", input(ONE_LINE, null, "a", { elapsedMs: 5000 }));
    clock.advance(100);
    // Device b opens the puzzle and is hidden without a move.
    const glance = manager.save("u1", "p1", input(ONE_LINE, FIRST, "b", { elapsedMs: 4000 }));
    expect(glance).toMatchObject({
      accepted: true,
      record: { version: FIRST, device: "a", elapsedMs: 5000, updatedAt: 1100 },
    });
    expect(
      manager.save("u1", "p1", input(ONE_LINE, FIRST, "b", { elapsedMs: 6000 })).record,
    ).toMatchObject({ version: FIRST, device: "a", elapsedMs: 6000 });
    // So device a, still on version 1, carries on.
    expect(manager.save("u1", "p1", input(OTHER_LINE, FIRST, "a"))).toMatchObject({
      accepted: true,
      record: { edges: OTHER_LINE, version: FIRST + 1 },
    });
  });

  test("a device's own save is never refused as stale", () => {
    const { manager } = setup();
    manager.save("u1", "p1", input(ONE_LINE, null, "a"));
    manager.save("u1", "p1", input(OTHER_LINE, FIRST, "a"));
    // A save whose answer was lost (the page closed) is sent again with the old version. The
    // client sends one save per puzzle at a time, so its saves can't arrive out of order.
    const resent = manager.save("u1", "p1", input(EMPTY, FIRST, "a"));
    expect(resent).toMatchObject({ accepted: true, record: { edges: EMPTY, version: FIRST + 2 } });
  });

  test("a cleared board is a real move: a stale device doesn't overwrite it", () => {
    const { manager } = setup();
    manager.save("u1", "p1", input(ONE_LINE, null, "a"));
    manager.save("u1", "p1", input(EMPTY, FIRST, "a"));
    expect(manager.save("u1", "p1", input(OTHER_LINE, FIRST, "b")).accepted).toBe(false);
  });

  test("a solved board wins even when stale, and stays until it is deleted", () => {
    const { manager } = setup();
    manager.save("u1", "p1", input(ONE_LINE, null, "a"));
    manager.save("u1", "p1", input(EMPTY, FIRST, "a"));
    const solved = manager.save("u1", "p1", input(SOLVED, FIRST, "b"));
    expect(solved).toMatchObject({ accepted: true, record: { solved: true, version: FIRST + 2 } });
    for (const late of [input(ONE_LINE, FIRST + 2, "b"), input(SOLVED, FIRST + 2, "a")]) {
      expect(manager.save("u1", "p1", late)).toEqual({ accepted: false, record: solved.record });
    }
    manager.delete("u1", "p1");
    expect(manager.get("u1", "p1")).toBeNull();
    expect(manager.save("u1", "p1", input(ONE_LINE, FIRST + 2, "b")).record.version).toBe(FIRST);
  });

  test("a new attempt after Start over never reuses a version a stale device holds", () => {
    const { manager, clock } = setup();
    manager.save("u1", "p1", input(ONE_LINE, null, "a"));
    manager.save("u1", "p1", input(EMPTY, FIRST, "a"));
    const old = manager.save("u1", "p1", input(ONE_LINE, FIRST + 1, "a")).record;
    expect(old.version).toBe(FIRST + 2);
    manager.delete("u1", "p1");
    clock.advance(10);
    // Another device plays three moves on the new attempt: its versions are the clock's, not 1, 2, 3.
    manager.save("u1", "p1", input(OTHER_LINE, null, "b"));
    manager.save("u1", "p1", input(EMPTY, 1010, "b"));
    const current = manager.save("u1", "p1", input(OTHER_LINE, 1011, "b")).record;
    expect(current.version).toBe(1012);
    // The first device still holds the old attempt's version 3 and can't overwrite the new one.
    const stale = manager.save("u1", "p1", input(ONE_LINE, FIRST + 2, "a"));
    expect(stale).toEqual({ accepted: false, record: current });
  });

  test("assisted only turns on, whichever board wins", () => {
    const { manager, clock } = setup();
    manager.save("u1", "p1", input(ONE_LINE, null, "a", { assisted: true }));
    expect(manager.save("u1", "p1", input(EMPTY, FIRST, "a")).record.assisted).toBe(true);
    clock.advance(100);
    // A refused save that saw a hint still marks the record, without taking its version.
    manager.save("u1", "p2", input(ONE_LINE, null, "a"));
    const refused = manager.save("u1", "p2", input(EMPTY, null, "b", { assisted: true }));
    expect(refused.accepted).toBe(false);
    expect(refused.record).toMatchObject({
      edges: ONE_LINE,
      assisted: true,
      version: 1100,
      device: "a",
      updatedAt: 1100,
    });
  });

  test("a board that does not fit the puzzle is refused", () => {
    const { manager } = setup();
    expect(() => manager.save("u1", "p1", input("000", null))).toThrow(InvalidBoardError);
    expect(() => manager.save("u1", "p1", input("00000000000x", null))).toThrow(InvalidBoardError);
  });

  test("unknown and unpublished puzzles are not found", () => {
    const { manager } = setup();
    for (const id of ["nope", "hidden"]) {
      expect(() => manager.get("u1", id)).toThrow(PuzzleNotFoundError);
      expect(() => manager.save("u1", id, input(EMPTY, null))).toThrow(PuzzleNotFoundError);
    }
  });

  test("lists unsolved records newest first, with the puzzle's size", () => {
    const { manager, clock, progress } = setup();
    manager.save("u1", "p1", input(ONE_LINE, null));
    clock.advance(10);
    manager.save("u1", "p2", input(ONE_LINE, null));
    clock.advance(10);
    manager.save("u2", "p1", input(ONE_LINE, null));
    // A record left on a puzzle that was unpublished later is skipped.
    progress.put({ ...manager.save("u1", "p1", input(EMPTY, 1)).record, puzzleId: "hidden" });
    const list = manager.listInProgress("u1", 10);
    expect(list.map((s) => [s.record.puzzleId, s.width, s.height])).toEqual([
      ["p1", 2, 2],
      ["p2", 2, 2],
    ]);
    manager.save("u1", "p1", input(SOLVED, 2));
    expect(manager.listInProgress("u1", 10).map((s) => s.record.puzzleId)).toEqual(["p2"]);
  });
});
