import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { analyzeBoard } from "./analyze.ts";
import { countSolutions } from "./bruteforce.ts";
import { encodeEdges, parsePuzzleJson, serializePuzzleJson } from "./format.ts";
import {
  GENERATOR_VERSION,
  type GenerateProgress,
  type GenerateResult,
  generate,
} from "./generate.ts";
import { DEFAULT_LEVEL, LEVEL_SETTINGS, LEVELS, type Level, puzzleLevel } from "./level.ts";
import { LOOP_THRESHOLDS, type LoopThresholds, thresholdCount } from "./loop.ts";
import { deriveClues, NO_CLUE } from "./puzzle.ts";
import { hashSeed } from "./rng.ts";
import { solve } from "./solver.ts";
import { levelRuleIds } from "./test-support/levels.ts";
import { loopCoverage } from "./test-support/loops.ts";
import { verify } from "./verify.ts";

/** Everything FR-7 to FR-9 promise about one result, made at `level`. */
function checkResult(
  r: GenerateResult,
  seed: string,
  thresholds = LOOP_THRESHOLDS,
  level: Level = DEFAULT_LEVEL,
) {
  const { puzzle, solution } = r;
  const { grid } = puzzle;
  expect(puzzle.seed).toBe(seed);
  expect(puzzle.meta).toEqual(
    level === DEFAULT_LEVEL
      ? { generator: GENERATOR_VERSION }
      : { generator: GENERATOR_VERSION, level },
  );
  // The solution is one loop meeting the thresholds, and every clue agrees with it.
  expect(analyzeBoard(puzzle, solution).solved).toBe(true);
  const { area, rows, cols } = loopCoverage(grid, solution);
  expect(area).toBeGreaterThanOrEqual(thresholdCount(thresholds.minCoverage, grid.cellCount));
  expect(rows).toBeGreaterThanOrEqual(thresholdCount(thresholds.minSpan, grid.height));
  expect(cols).toBeGreaterThanOrEqual(thresholdCount(thresholds.minSpan, grid.width));
  const derived = deriveClues(grid, solution);
  let clueCount = 0;
  for (let i = 0; i < grid.cellCount; i++) {
    if (puzzle.clues[i] === NO_CLUE) continue;
    clueCount++;
    expect(puzzle.clues[i]).toBe(derived[i]);
  }
  expect(r.stats.clueCount).toBe(clueCount);
  // The level's rules alone solve it from an empty board, so it is unique (PRD §9), and the
  // verifier agrees.
  expect(r.solve.status).toBe("solved");
  const allowed = levelRuleIds(level);
  expect(r.solve.steps.map((s) => s.rule).filter((rule) => !allowed.has(rule))).toEqual([]);
  expect(encodeEdges(r.solve.edges)).toBe(encodeEdges(solution));
  const v = verify(puzzle, { timeLimitMs: Number.POSITIVE_INFINITY });
  expect(v.status).toBe("unique");
  expect(encodeEdges(v.solutions[0])).toBe(encodeEdges(solution));
}

describe("generate: golden values (FR-10)", () => {
  // Frozen output for GENERATOR_VERSION "6". If one changes, the generator's output changed: bump
  // GENERATOR_VERSION and update these (docs/DECISIONS.md, WT3).
  const cases: [number, number, string, string][] = [
    [1, 1, ".", "1111"],
    [1, 2, ".3", "1211111"],
    [2, 2, "2.2.", "112211121121"],
    [
      5,
      5,
      "..1.3.....3.3....3..1.21.",
      "222212111212112121222212221221222211212221121211212111211211",
    ],
    [
      6,
      4,
      "...13..22..12.......0.1.",
      "1111122112122222112221111222221222212112112211212211122222",
    ],
    [
      7,
      7,
      "00..3.....3..3.......122..32001..3...1....3......",
      "2222122221222111212121122112221121222222121111112111111122221122221111111222222122121211222221212222221112222221",
    ],
    [
      10,
      10,
      ".......1.12......3..2.233.....1.1....2............3121.11.23.122.11.2.11...11....2...02.11.3.......1",
      "1111111222221111221112121221222221221212221122222212222222221212222221222222221222121222222222221222212222111212222221222121222111212121111222121222121111211211211111212112111121211121122212111212122112222121221122212212",
    ],
  ];
  for (const [width, height, clues, solution] of cases) {
    test(`${width}x${height} seed "golden"`, () => {
      const r = generate({ width, height, seed: "golden" });
      expect(serializePuzzleJson(r.puzzle)).toBe(
        JSON.stringify({
          v: 1,
          width,
          height,
          clues,
          seed: "golden",
          meta: { generator: GENERATOR_VERSION },
        }),
      );
      expect(encodeEdges(r.solution)).toBe(solution);
    });
  }

  // Larger boards go through more levels of nested blocks; a digest of the serialized puzzle and its
  // solution keeps the test short.
  test('20x20 seed "golden" (digest)', () => {
    const r = generate({ width: 20, height: 20, seed: "golden" });
    expect(hashSeed(serializePuzzleJson(r.puzzle) + encodeEdges(r.solution))).toEqual([
      3351530125, 3105610422, 2737780750, 2198067262,
    ]);
  });
});

describe("generate: properties", () => {
  test("small boards: unique, consistent, deterministic (FR-7 to FR-10)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 10 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        (width, height, seed) => {
          const r = generate({ width, height, seed });
          checkResult(r, seed);
          const again = generate({ width, height, seed });
          expect(serializePuzzleJson(again.puzzle)).toBe(serializePuzzleJson(r.puzzle));
          expect(encodeEdges(again.solution)).toBe(encodeEdges(r.solution));
        },
      ),
      { numRuns: 60 },
    );
  });

  test("every board up to 4×4 has exactly one solution by brute force", () => {
    for (let width = 1; width <= 4; width++) {
      for (let height = 1; height <= 4; height++) {
        const r = generate({ width, height, seed: "brute" });
        expect(countSolutions(r.puzzle)).toBe(1);
      }
    }
  });

  test("medium and thin boards verify unique", () => {
    for (const [width, height] of [
      [20, 20],
      [30, 15],
      [1, 100],
      [100, 2],
    ]) {
      const seed = `medium-${width}x${height}`;
      checkResult(generate({ width, height, seed }), seed);
    }
  });

  test("custom thresholds are respected", () => {
    const thresholds: LoopThresholds = { minCoverage: 0.6, minSpan: 1 };
    checkResult(
      generate({ width: 12, height: 12, seed: "strict", thresholds }),
      "strict",
      thresholds,
    );
  });

  test("every clue is needed: without any one of them the rules get stuck", () => {
    for (let n = 0; n < 10; n++) {
      const { puzzle, stats } = generate({ width: 4 + n, height: 13 - n, seed: `needed-${n}` });
      // Removal tests reach what solving from scratch does, so the safeguard has nothing to restore.
      expect(stats.restored).toBe(0);
      const clues = puzzle.clues.slice();
      const without = { grid: puzzle.grid, clues };
      for (let i = 0; i < clues.length; i++) {
        const k = clues[i];
        if (k === NO_CLUE) continue;
        clues[i] = NO_CLUE;
        expect(solve(without).status).not.toBe("solved");
        clues[i] = k;
      }
    }
  });

  test("keeps about two clues in five (mean over 20 boards of 10×10)", () => {
    let clues = 0;
    for (let n = 0; n < 20; n++) {
      const { stats } = generate({ width: 10, height: 10, seed: `density-${n}` });
      expect(stats.restored).toBe(0);
      clues += stats.clueCount;
    }
    const mean = clues / (20 * 100);
    expect(mean).toBeGreaterThanOrEqual(0.35);
    expect(mean).toBeLessThanOrEqual(0.45);
  });
});

describe("generate: levels", () => {
  // Frozen output for GENERATOR_VERSION "6" below the default level, as digests of the serialized
  // puzzle and its solution (the default level's goldens are above).
  test('10x10 seed "golden" at easy and medium (digests)', () => {
    const digest = (level: Level) => {
      const r = generate({ width: 10, height: 10, seed: "golden", level });
      return hashSeed(serializePuzzleJson(r.puzzle) + encodeEdges(r.solution));
    };
    expect(digest("easy")).toEqual([886490681, 133261979, 733940933, 3331014347]);
    expect(digest("medium")).toEqual([3032055185, 730214522, 3796690882, 2962293742]);
  });

  test("small boards at every level: unique, solved by the level's rules, deterministic", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.constantFrom(...LEVELS),
        (width, height, seed, level) => {
          const r = generate({ width, height, seed, level });
          // A board too small for the level's rules gets a harder level, never an easier one.
          const made = puzzleLevel(r.puzzle);
          expect(LEVELS.indexOf(made)).toBeGreaterThanOrEqual(LEVELS.indexOf(level));
          checkResult(r, seed, LOOP_THRESHOLDS, made);
          const again = generate({ width, height, seed, level });
          expect(serializePuzzleJson(again.puzzle)).toBe(serializePuzzleJson(r.puzzle));
          expect(encodeEdges(again.solution)).toBe(encodeEdges(r.solution));
        },
      ),
      { numRuns: 40 },
    );
  });

  test("medium boards at every level verify unique", () => {
    for (const level of LEVELS) {
      const seed = `levels-${level}`;
      checkResult(generate({ width: 20, height: 20, seed, level }), seed, LOOP_THRESHOLDS, level);
    }
  });

  test("easier levels keep more clues (10 boards of 10×10)", () => {
    const sums: Record<Level, number> = { easy: 0, medium: 0, hard: 0 };
    for (let n = 0; n < 10; n++) {
      const count: Record<string, number> = {};
      for (const level of LEVELS) {
        const { puzzle, stats } = generate({ width: 10, height: 10, seed: `density-${n}`, level });
        expect(puzzleLevel(puzzle)).toBe(level);
        expect(stats.restored).toBe(0);
        const share = LEVEL_SETTINGS[level].minClueShare;
        if (share > 0) expect(stats.clueCount).toBeGreaterThanOrEqual(thresholdCount(share, 100));
        count[level] = stats.clueCount;
        sums[level] += stats.clueCount;
      }
      expect(count.easy).toBeGreaterThan(count.medium);
    }
    expect(sums.easy).toBeGreaterThan(sums.medium);
    expect(sums.medium).toBeGreaterThan(sums.hard);
    expect(sums.easy / 1000).toBeLessThanOrEqual(0.6);
    expect(sums.medium / 1000).toBeLessThanOrEqual(0.5);
  });

  test("the default level is hard, and its puzzles have no meta.level", () => {
    const plain = generate({ width: 8, height: 6, seed: "default-level" });
    const hard = generate({ width: 8, height: 6, seed: "default-level", level: "hard" });
    expect(plain.puzzle.meta).toEqual({ generator: GENERATOR_VERSION });
    expect(serializePuzzleJson(hard.puzzle)).toBe(serializePuzzleJson(plain.puzzle));
    expect(encodeEdges(hard.solution)).toBe(encodeEdges(plain.solution));
    expect(hard.solve).toEqual(plain.solve);
  });

  test("meta.level survives the wire format", () => {
    for (const level of LEVELS) {
      const { puzzle } = generate({ width: 6, height: 6, seed: "wire", level });
      const back = parsePuzzleJson(serializePuzzleJson(puzzle));
      expect(back.meta).toEqual(puzzle.meta);
      expect(puzzleLevel(back)).toBe(level);
    }
  });

  test("a board too small for a level's rules gets the next level up", () => {
    // A 1×1 needs lookahead (no rule says the loop exists); the 2×2 square, all 2s, needs a corner
    // rule. Each falls back to the next level, so it is the puzzle that level makes.
    const at = (width: number, height: number, level?: Level) =>
      generate({ width, height, seed: "golden", level });
    for (const level of ["easy", "medium"] as const) {
      expect(serializePuzzleJson(at(1, 1, level).puzzle)).toBe(
        serializePuzzleJson(at(1, 1).puzzle),
      );
    }
    const small = at(2, 2, "easy");
    expect(puzzleLevel(small.puzzle)).toBe("medium");
    expect(serializePuzzleJson(small.puzzle)).toBe(serializePuzzleJson(at(2, 2, "medium").puzzle));
  });
});

describe("generate: options", () => {
  test("rejects a bad size, seed, thresholds or level before doing any work", () => {
    const bad: Parameters<typeof generate>[0][] = [
      { width: 0, height: 5, seed: "s" },
      { width: 5, height: 101, seed: "s" },
      { width: 5, height: 5, seed: "" },
      { width: 5, height: 5, seed: "x".repeat(129) },
      { width: 5, height: 5, seed: "s", thresholds: { minCoverage: 1.5, minSpan: 0.8 } },
      { width: 5, height: 5, seed: "s", thresholds: { minCoverage: 0.4, minSpan: Number.NaN } },
      { width: 5, height: 5, seed: "s", thresholds: { minCoverage: 0.4 } as LoopThresholds },
      { width: 5, height: 5, seed: "s", level: "expert" as Level },
    ];
    for (const options of bad) {
      let calls = 0;
      expect(() => generate({ ...options, onProgress: () => calls++ })).toThrow(RangeError);
      expect(calls).toBe(0);
    }
  });

  test("reports progress once per removal test, without changing the result", () => {
    const seen: GenerateProgress[] = [];
    const r = generate({ width: 8, height: 6, seed: "progress", onProgress: (p) => seen.push(p) });
    expect(seen.length).toBe(r.stats.checks);
    expect(seen).toEqual(seen.map((_, n) => ({ done: n + 1, total: r.stats.checks })));
    const plain = generate({ width: 8, height: 6, seed: "progress" });
    expect(serializePuzzleJson(plain.puzzle)).toBe(serializePuzzleJson(r.puzzle));
  });

  test("an error thrown from onProgress stops generation", () => {
    let calls = 0;
    const onProgress = () => {
      if (++calls === 3) throw new Error("cancelled");
    };
    expect(() => generate({ width: 10, height: 10, seed: "stop", onProgress })).toThrow(
      "cancelled",
    );
    expect(calls).toBe(3);
  });
});
