import { describe, expect, test } from "bun:test";
import { analyzeBoard } from "./analyze.ts";
import { encodeEdges, parsePuzzle } from "./format.ts";
import { createGrid } from "./grid.ts";
import { createPuzzle } from "./puzzle.ts";
import { createRng } from "./rng.ts";
import { FIXTURES } from "./test-support/fixtures.ts";
import { puzzleFromLoop, randomLoop } from "./test-support/loops.ts";
import { DEFAULT_VERIFY_TIME_LIMIT_MS, verify } from "./verify.ts";

function puzzle(width: number, height: number, clues: string) {
  return parsePuzzle({ v: 1, width, height, clues });
}

describe("verify", () => {
  for (const f of FIXTURES) {
    test(`fixture ${f.name}`, () => {
      const p = puzzle(f.width, f.height, f.clues);
      const result = verify(p);
      expect(result.status).toBe(f.count === 0 ? "none" : f.count === 1 ? "unique" : "multiple");
      expect(result.solutions.length).toBe(Math.min(f.count, 2));
      const found = result.solutions.map(encodeEdges);
      expect(new Set(found).size).toBe(found.length);
      if (f.solutions !== undefined) for (const s of found) expect(f.solutions).toContain(s);
      for (const s of result.solutions) expect(analyzeBoard(p, s).solved).toBe(true);
    });
  }

  test("proves uniqueness without search when the rules solve it", () => {
    const result = verify(puzzle(2, 2, "2222"));
    expect(result.status).toBe("unique");
    expect(result.stats.nodes).toBe(0);
  });

  test("searches when the rules get stuck", () => {
    // Unique (checked by brute force), but the rules alone get stuck.
    const result = verify(puzzle(2, 3, ".2222."));
    expect(result.status).toBe("unique");
    expect(result.stats.nodes).toBeGreaterThan(0);
  });

  test("finds two different solutions of an empty board", () => {
    const p = createPuzzle(3, 3);
    const result = verify(p);
    expect(result.status).toBe("multiple");
    expect(encodeEdges(result.solutions[0])).not.toBe(encodeEdges(result.solutions[1]));
    for (const s of result.solutions) expect(analyzeBoard(p, s).solved).toBe(true);
  });

  test("returns unknown when the node budget runs out", () => {
    const result = verify(createPuzzle(3, 3), { maxNodes: 1 });
    expect(result.status).toBe("unknown");
    expect(result.solutions).toEqual([]);
  });

  test("returns unknown when the time budget runs out, using the injected clock", () => {
    let t = 1000;
    const result = verify(createPuzzle(4, 4), { timeLimitMs: 5, now: () => t++ });
    expect(result.status).toBe("unknown");
    expect(result.stats.elapsedMs).toBe(7);
  });

  test("defaults to a 30 second limit", () => {
    expect(DEFAULT_VERIFY_TIME_LIMIT_MS).toBe(30_000);
  });

  for (const size of [10, 30, 100]) {
    test(`a ${size}×${size} puzzle with every clue of a random loop is unique`, () => {
      const grid = createGrid(size, size);
      const rng = createRng(`verify-${size}`);
      const loop = randomLoop(grid, rng);
      const result = verify(puzzleFromLoop(grid, loop, rng));
      expect(result.status).toBe("unique");
      expect(result.stats.nodes).toBe(0);
      expect(encodeEdges(result.solutions[0])).toBe(encodeEdges(loop));
    });
  }
});

describe("randomLoop", () => {
  test("is always one closed loop", () => {
    for (let n = 0; n < 50; n++) {
      const rng = createRng(`loop-${n}`);
      const w = 1 + rng.int(12);
      const h = 1 + rng.int(12);
      const p = createPuzzle(w, h);
      expect(analyzeBoard(p, randomLoop(p.grid, rng, rng.float())).solved).toBe(true);
    }
  });
});
