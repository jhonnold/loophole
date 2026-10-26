import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { analyzeBoard } from "./analyze.ts";
import { encodeEdges } from "./format.ts";
import { createGrid, EdgeState, type Grid, NONE } from "./grid.ts";
import {
  generateLoop,
  LOOP_SHAPE_TARGET,
  LOOP_THRESHOLDS,
  type LoopShape,
  type LoopThresholds,
  loopShape,
  thresholdCount,
} from "./loop.ts";
import { createPuzzle } from "./puzzle.ts";
import { createRng } from "./rng.ts";
import { loopCoverage } from "./test-support/loops.ts";

/** Generates a loop and checks it is one closed loop meeting `thresholds`. */
function checkLoop(width: number, height: number, seed: string, thresholds = LOOP_THRESHOLDS) {
  const grid = createGrid(width, height);
  const loop = generateLoop(grid, createRng(seed), thresholds);
  for (const s of loop) expect(s === EdgeState.Line || s === EdgeState.Cross).toBe(true);
  expect(analyzeBoard(createPuzzle(width, height), loop).solved).toBe(true);
  const { area, rows, cols } = loopCoverage(grid, loop);
  expect(area).toBeGreaterThanOrEqual(thresholdCount(thresholds.minCoverage, width * height));
  expect(rows).toBeGreaterThanOrEqual(thresholdCount(thresholds.minSpan, height));
  expect(cols).toBeGreaterThanOrEqual(thresholdCount(thresholds.minSpan, width));
  return loop;
}

/** The boundary of the cells marked `#` in `rows` (one string per row), as edge states. */
function loopAround(rows: string[]): { grid: Grid; edges: Uint8Array } {
  const grid = createGrid(rows[0].length, rows.length);
  const inside = (cell: number) =>
    cell !== NONE && rows[Math.floor(cell / grid.width)][cell % grid.width] === "#";
  const edges = new Uint8Array(grid.edgeCount);
  for (let e = 0; e < grid.edgeCount; e++) {
    const a = inside(grid.edgeCells[e * 2]);
    const b = inside(grid.edgeCells[e * 2 + 1]);
    edges[e] = a !== b ? EdgeState.Line : EdgeState.Cross;
  }
  return { grid, edges };
}

describe("loop thresholds", () => {
  test("defaults are 40% coverage and 80% span, and frozen", () => {
    expect(LOOP_THRESHOLDS).toEqual({ minCoverage: 0.4, minSpan: 0.8 });
    expect(Object.isFrozen(LOOP_THRESHOLDS)).toBe(true);
  });

  test("the shape target is half the area, 75% of the dots, at most 20% solid, and frozen", () => {
    expect(LOOP_SHAPE_TARGET).toEqual({ area: 0.5, dots: 0.75, solid: 0.2 });
    expect(Object.isFrozen(LOOP_SHAPE_TARGET)).toBe(true);
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

describe("loopShape", () => {
  test("measures hand-drawn loops", () => {
    const cases: [string[], LoopShape][] = [
      [["#"], { area: 1, dots: 1, solid: 0 }],
      [["###"], { area: 1, dots: 1, solid: 0 }],
      [["##", "##"], { area: 1, dots: 8 / 9, solid: 1 }],
      [["#.", "##"], { area: 3 / 4, dots: 8 / 9, solid: 0 }],
      [["###", "#.#", "#.#"], { area: 7 / 9, dots: 1, solid: 0 }],
      [["...", ".#.", "..."], { area: 1 / 9, dots: 4 / 16, solid: 0 }],
      [["###", "###", "..."], { area: 6 / 9, dots: 10 / 16, solid: 2 / 4 }],
    ];
    for (const [rows, want] of cases) {
      const { grid, edges } = loopAround(rows);
      const got = loopShape(grid, edges);
      expect(got.area).toBeCloseTo(want.area, 12);
      expect(got.dots).toBeCloseTo(want.dots, 12);
      expect(got.solid).toBeCloseTo(want.solid, 12);
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
          const loop = checkLoop(width, height, seed);
          // loopShape agrees with the independent coverage scan, and with a count of the dots
          // that have a line.
          const grid = createGrid(width, height);
          const shape = loopShape(grid, loop);
          expect(shape.area * grid.cellCount).toBeCloseTo(loopCoverage(grid, loop).area, 6);
          let dots = 0;
          for (let d = 0; d < grid.dotCount; d++) {
            for (let j = 0; j < 4; j++) {
              const e = grid.dotEdges[d * 4 + j];
              if (e !== NONE && loop[e] === EdgeState.Line) {
                dots++;
                break;
              }
            }
          }
          expect(shape.dots * grid.dotCount).toBeCloseTo(dots, 6);
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
    for (const seed of ["x", "y", "z"]) {
      expect(loopCoverage(createGrid(1, 1), checkLoop(1, 1, seed)).area).toBe(1);
      expect(loopCoverage(createGrid(1, 2), checkLoop(1, 2, seed)).area).toBe(2);
      expect(loopCoverage(createGrid(2, 2), checkLoop(2, 2, seed)).area).toBe(3);
      const grown = generateLoop(createGrid(2, 2), createRng(seed), LOOP_THRESHOLDS, 1);
      expect(encodeEdges(grown)).toBe("112211121121");
    }
  });

  test("extra adds that many cells to the same loop", () => {
    const grid = createGrid(10, 10);
    const base = loopCoverage(grid, generateLoop(grid, createRng("extra"))).area;
    const grown = generateLoop(grid, createRng("extra"), LOOP_THRESHOLDS, 3);
    expect(analyzeBoard(createPuzzle(10, 10), grown).solved).toBe(true);
    expect(loopCoverage(grid, grown).area).toBe(base + 3);
  });

  test("custom thresholds are respected", () => {
    const strict: LoopThresholds = { minCoverage: 0.7, minSpan: 1 };
    for (const seed of ["a", "b", "c"]) checkLoop(20, 20, seed, strict);
  });

  test("the same seed gives the same loop, another seed another loop", () => {
    const grid = createGrid(15, 9);
    const a = encodeEdges(generateLoop(grid, createRng("same")));
    expect(encodeEdges(generateLoop(grid, createRng("same")))).toBe(a);
    expect(encodeEdges(generateLoop(grid, createRng("other")))).not.toBe(a);
  });

  // The shape bands (DECISIONS, WT13): mean inside area 45–55%, loop through 70–80% of the dots,
  // at most 30% of 2×2 blocks solid. 30 loops per size take about 0.1 s in all.
  for (const size of [10, 20, 40]) {
    test(`${size}×${size} loops are long and winding on average`, () => {
      const grid = createGrid(size, size);
      const seeds = 30;
      let area = 0;
      let dots = 0;
      let solid = 0;
      for (let n = 0; n < seeds; n++) {
        const shape = loopShape(grid, generateLoop(grid, createRng(`shape-${n}`)));
        area += shape.area / seeds;
        dots += shape.dots / seeds;
        solid += shape.solid / seeds;
      }
      expect(area).toBeGreaterThanOrEqual(0.45);
      expect(area).toBeLessThanOrEqual(0.55);
      expect(dots).toBeGreaterThanOrEqual(0.7);
      expect(dots).toBeLessThanOrEqual(0.8);
      expect(solid).toBeLessThanOrEqual(0.3);
    });
  }
});
