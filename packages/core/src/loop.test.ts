import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { analyzeBoard } from "./analyze.ts";
import { encodeEdges } from "./format.ts";
import { createGrid, EdgeState } from "./grid.ts";
import { generateLoop, LOOP_THRESHOLDS, type LoopThresholds, thresholdCount } from "./loop.ts";
import { createPuzzle } from "./puzzle.ts";
import { createRng } from "./rng.ts";
import { loopCoverage } from "./test-support/loops.ts";

/** Grows a loop and checks it is one closed loop meeting `thresholds`. */
function checkLoop(width: number, height: number, seed: string, thresholds = LOOP_THRESHOLDS) {
  const grid = createGrid(width, height);
  const loop = generateLoop(grid, createRng(seed), thresholds);
  if (loop === null) throw new Error(`no loop for ${width}x${height} ${seed}`);
  for (const s of loop) expect(s === EdgeState.Line || s === EdgeState.Cross).toBe(true);
  expect(analyzeBoard(createPuzzle(width, height), loop).solved).toBe(true);
  const { area, rows, cols } = loopCoverage(grid, loop);
  expect(area).toBeGreaterThanOrEqual(thresholdCount(thresholds.minCoverage, width * height));
  expect(rows).toBeGreaterThanOrEqual(thresholdCount(thresholds.minSpan, height));
  expect(cols).toBeGreaterThanOrEqual(thresholdCount(thresholds.minSpan, width));
  return loop;
}

describe("loop thresholds", () => {
  test("defaults are 40% coverage and 80% span, and frozen", () => {
    expect(LOOP_THRESHOLDS).toEqual({ minCoverage: 0.4, minSpan: 0.8 });
    expect(Object.isFrozen(LOOP_THRESHOLDS)).toBe(true);
  });

  test("thresholdCount rounds up, never below 1", () => {
    const cases: [number, number, number][] = [
      [0.4, 25, 10],
      [0.4, 100, 40],
      [0.4, 10000, 4000],
      [0.8, 10, 8],
      [0.8, 7, 6],
      [0.8, 100, 80],
      [0.8, 1, 1],
      [0.4, 1, 1],
      [0, 5, 1],
      [1, 7, 7],
    ];
    for (const [share, n, want] of cases) expect(thresholdCount(share, n)).toBe(want);
    for (const share of [0.4, 0.8]) {
      for (let n = 1; n <= 100; n++) {
        const k = thresholdCount(share, n);
        expect(k).toBeGreaterThanOrEqual(1);
        expect(k >= share * n - 1e-6 && (k === 1 || k - 1 < share * n)).toBe(true);
      }
    }
  });
});

describe("generateLoop", () => {
  test("every loop is one closed loop meeting the default thresholds (FR-8)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 1, max: 30 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        (width, height, seed) => {
          checkLoop(width, height, seed);
        },
      ),
      { numRuns: 200 },
    );
  });

  test("large and thin boards meet the thresholds", () => {
    for (const [w, h] of [
      [100, 100],
      [100, 1],
      [1, 100],
      [100, 3],
    ]) {
      for (const seed of ["a", "b", "c"]) checkLoop(w, h, seed);
    }
  });

  test("tiny boards: 1×1 and 1×2 take the whole board, 2×2 an L unless grown one more", () => {
    expect(loopCoverage(createGrid(1, 1), checkLoop(1, 1, "x")).area).toBe(1);
    expect(loopCoverage(createGrid(1, 2), checkLoop(1, 2, "x")).area).toBe(2);
    expect(loopCoverage(createGrid(2, 2), checkLoop(2, 2, "x")).area).toBe(3);
    const grown = generateLoop(createGrid(2, 2), createRng("x"), LOOP_THRESHOLDS, 1);
    expect(encodeEdges(grown as Uint8Array)).toBe("112211121121");
  });

  test("custom thresholds are respected", () => {
    const strict: LoopThresholds = { minCoverage: 0.7, minSpan: 1 };
    for (const seed of ["a", "b", "c"]) checkLoop(20, 20, seed, strict);
  });

  test("the same seed gives the same loop", () => {
    const grid = createGrid(15, 9);
    const a = generateLoop(grid, createRng("same")) as Uint8Array;
    const b = generateLoop(grid, createRng("same")) as Uint8Array;
    expect(encodeEdges(a)).toBe(encodeEdges(b));
  });
});
