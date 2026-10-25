# WT3 `core-generator` — implementation plan

Branch `feat/core-generator`, worktree `/home/jhonnold/projects/loophole-wt/core-generator`. PRD: FR-7 (inputs and outputs), FR-8 (random loop with coverage thresholds in config, with tests), FR-9 (clues derived, then removed while uniqueness holds), FR-10 (deterministic per seed and version), FR-11 (background-job friendly: progress, cancellation), NFR-1 (p95 under 5 s up to 30×30), NFR-3 (unit and property tests), §9 (rule-solvable ⇒ unique), §10 (≥ 95% loop acceptance).

## Goal

Add to `packages/core` (pure TypeScript, no dependencies):

- **`generateLoop(grid, rng, thresholds?, extra?)`**: a random single loop meeting `LOOP_THRESHOLDS` (≥ 40% of cells enclosed, bounding box ≥ 80% of rows and of columns), exported config object, with tests.
- **`generate({ width, height, seed, thresholds?, onProgress? })`**: puzzle (with `seed` and `meta.generator` = `GENERATOR_VERSION`), its only solution, the from-scratch `SolveResult` (step log for hints) and stats. Deterministic: only `createRng(seed)`, no clock, no time limits (DECISIONS, WT2 "Deterministic generation must not depend on wall-clock budgets").
- **Tests** in the gate (about 0.5 s added): golden values, determinism, thresholds, clue consistency, `verify` = `unique`, brute force on every board up to 4×4, option validation, progress and cancellation.
- **A benchmark** `bun run --cwd packages/core bench:generate` (not in the gate): loop acceptance per size, generation p50/p95/max for 7, 10, 20, 30, 40, 100, first-attempt rate, clue density, clues put back, `verify` status.

Out of scope: job runner, Worker, hard timeout and seed picking (WT6); daily scheduling (WT11); hint API (WT8); difficulty levels (PRD §14). The follow-up "web large fixtures verify `unique`" is handled by WT5, not here.

## How later worktrees use this

- **WT6 worker**: runs `generate({ width, height, seed, onProgress })` inside a Bun `Worker`. Picks a random seed when the user gives none (core never invents one). Writes `done / total` from `onProgress` to the job row (throttle in the worker; the callback fires once per clue, 10 000 times on 100×100). To cancel cooperatively, throw from `onProgress`; `terminate()` stays the hard limit. Store `serializePuzzleJson(result.puzzle)` (carries `seed` and `meta.generator`), `encodeEdges(result.solution)` and, if wanted, `result.solve.steps` in blob storage. Generation is never in the request path (FR-11); sizes ≤ 30×30 take < 0.2 s, 100×100 about 13 s.
- **WT11 daily**: pre-generates 7/10/20/40 (≤ 0.5 s each). Reproducible from `(seed, size, meta.generator)` on any machine.
- **WT8 hints**: `result.solve` is a full from-scratch solve (status `solved`), so the rule solver reaches the end from an empty board; from a player's board use `solve(puzzle, { initial, maxSteps: 1 })` as WT2 documented.

## Design

### Files

| File | Exported from `index.ts` | Contents |
|---|---|---|
| `packages/core/src/loop.ts` (new) | yes | `LoopThresholds`, `LOOP_THRESHOLDS`, `thresholdCount`, `generateLoop` |
| `packages/core/src/generate.ts` (new) | yes | `GENERATOR_VERSION`, `GenerateOptions`, `GenerateProgress`, `GenerateStats`, `GenerateResult`, `generate` |
| `packages/core/src/test-support/loops.ts` (append) | no | `LoopCoverage`, `loopCoverage(grid, edges)` (independent measurement for tests) |
| `packages/core/src/loop.test.ts`, `generate.test.ts` (new) | — | tests |
| `packages/core/bench/generate.ts` (new) | no | benchmark |
| `packages/core/package.json` | — | `bench:generate` script |
| `README.md`, `packages/core/AGENTS.md`, `docs/DECISIONS.md` | — | docs |

The engine, solver and verifier are **not** changed. `test-support/loops.ts`'s existing `randomLoop` stays as it is (other tests and `bench/verify.ts` use it); its doc comment says "the real loop generator is WT3's", which is now true. Leave `bench/verify.ts` alone.

### Public API

```ts
// loop.ts
export interface LoopThresholds { readonly minCoverage: number; readonly minSpan: number } // shares, 0–1
export const LOOP_THRESHOLDS: LoopThresholds; // frozen { minCoverage: 0.4, minSpan: 0.8 }
export function thresholdCount(share: number, n: number): number; // max(1, ceil(share·n − 1e-9))
export function generateLoop(grid: Grid, rng: Rng, thresholds?: LoopThresholds, extra?: number): Uint8Array | null;

// generate.ts
export const GENERATOR_VERSION = "1";
export interface GenerateProgress { readonly done: number; readonly total: number }
export interface GenerateOptions {
  readonly width: number;
  readonly height: number;
  readonly seed: string;                 // required, 1–128 chars
  readonly thresholds?: LoopThresholds;  // default LOOP_THRESHOLDS
  readonly onProgress?: (progress: GenerateProgress) => void; // throw to cancel
}
export interface GenerateStats { readonly attempts: number; readonly clueCount: number; readonly checks: number; readonly restored: number }
export interface GenerateResult {
  readonly puzzle: Puzzle;        // seed + meta { generator: GENERATOR_VERSION }
  readonly solution: Uint8Array;  // Line/Cross per edge
  readonly solve: SolveResult;    // solve(puzzle) from empty board, status "solved"
  readonly stats: GenerateStats;
}
export function generate(options: GenerateOptions): GenerateResult;
```

Errors: `RangeError` (from `createPuzzle`) for a bad size or seed, and for a threshold outside 0–1 or NaN, all before any work or progress call. `Error("no usable loop after 100 attempts")` is unreachable in practice (never seen) and only bounds the retry loop.

### Algorithm

**Loop (FR-8).** Same growth rule as `test-support/loops.ts` and WT5's fixture script, which is known to keep the boundary one simple loop: a cell joins the region only if its 8-neighbour ring (off-board = outside) has exactly one run of region cells and that run contains a side neighbour. Differences: start cell uniform in the middle half (rows `[⌊H/4⌋, H−⌊H/4⌋)`, same for columns); stop as soon as area ≥ `thresholdCount(minCoverage, W·H)` and bbox rows ≥ `thresholdCount(minSpan, H)` and cols ≥ `thresholdCount(minSpan, W)`; then grow `extra` more cells. Returns `null` only if the frontier empties first (never observed; the whole board always qualifies). Thresholds are a stopping rule, so acceptance is 100% in every size measured. Tiny boards: 1×1 → loop around the cell (no clue: a 4 is not a clue); 1×2 → both cells; 2×2 → an L (3 cells), which `generate` rejects (see below) and regrows to the full square.

**Clues (FR-9).** Per attempt `a = 1, 2, …`:
1. `solution = generateLoop(grid, rng, thresholds, a − 1)`; derive all clues (4 → none).
2. If `solve(full)` is not `solved`, next attempt. Needed because two loops can share every clue: every L on a 2×2 has the same clues as its mirror (`2,3 / 3,2`), and about 4% of 3×3 loops. Never seen on larger boards (bench: first-attempt 100% for 7×7 to 100×100). The one extra cell per retry makes 2×2 terminate at the full square (`"22.."` golden).
3. **Local removal**: clue cells in shuffled order; remove clue `i` if `solve(puzzle, { initial })` is `solved`, where `initial` = solution with every edge of the cells within 3 rows and 3 columns of `i` (7×7 window) set Unknown. The solve is sound for any start state consistent with the solution, so this is a *necessary* condition only; it is generous because the window's surroundings are given. Cost ≈ 1 ms per test on 100×100 (O(edges) for engine setup, load and parity passes). `onProgress({ done, total })` after each test.
4. **Restore**: `solve(puzzle)` from an empty board; while not `solved`, candidates = cells whose clue was removed (and is not "none") touching an Unknown edge of the stuck state (if none, all removed cells); shuffle; restore greedily, skipping any candidate within 2 rows and 2 columns of one restored this round; repeat. Terminates: each round restores ≥ 1 clue and the full set solves (step 2). Usually 1–4 rounds.
5. Return the last from-scratch `SolveResult` (status `solved` ⇒ unique, PRD §9) with `createPuzzle(width, height, clues, { seed, meta })`.

RNG draw order (part of the frozen output): start row, start column, frontier picks…, [per attempt], removal shuffle, restore shuffles. Never call `rng` from anywhere else; never read the clock.

### Measured performance (this machine, prototype = the code below)

`bun run --cwd packages/core bench:generate` (16-core host, Bun 1.3.13):

```
loops 1×1 … 100×100, 100×10, 1×100 (200–1000 seeds each): accepted=100.0%
generate 7×7:     n=20 median=3ms     p95=6ms     max=12ms    first-attempt=100% clues=41.6% restored=6.5%  verify={"unique":20}
generate 10×10:   n=20 median=6ms     p95=9ms     max=10ms    first-attempt=100% clues=36.5% restored=8.1%  verify={"unique":20}
generate 20×20:   n=20 median=38ms    p95=46ms    max=50ms    first-attempt=100% clues=34.0% restored=15.7% verify={"unique":20}
generate 30×30:   n=20 median=138ms   p95=164ms   max=170ms   first-attempt=100% clues=34.5% restored=19.1% verify={"unique":20}
generate 40×40:   n=10 median=373ms   p95=394ms   max=394ms   first-attempt=100% clues=32.5% restored=19.6% verify={"unique":10}
generate 100×100: n=3  median=12797ms p95=13855ms max=13855ms first-attempt=100% clues=34.6% restored=25.6% verify={"unique":3}
```

(`restored` = clues put back, as a share of cells.) NFR-1: 30×30 p95 164 ms ≪ 5 s. 100×100 ≈ 13–14 s (target was < 60–120 s). Gate: 255 → 276 tests; `bun test` stayed at about 4 s (3.5–4.3 s across runs; the two new files take ~0.5 s on their own).

Also every size 1..8 × 1..8 plus 1×100, 100×1, 2×50, 50×2, 3×40 with 5 seeds each (345 puzzles) verified `unique` with `verify`'s solution equal to the generator's (0.5 s).

### Alternatives measured and rejected (details in DECISIONS)

| Strategy | 30×30 | 100×100 | clues |
|---|---|---|---|
| Greedy, whole-board `solve` per clue | a few s (WT2 bench note); 0.2–0.4 s at 20×20 | ~30 min (WT2) | ~22–30% |
| Tiles: base = `solve(P − clues in tile)`, each clue checked from that base (sound per step) | 0.4 s | 114 s | ~15–17% |
| Chosen + second pass retrying restored clues with whole-board `solve` | 0.6 s | ~700 s (est.) | ~18% |
| Chosen + iterating the local pass on restored clues (any window size) | — | — | no gain: the local test removes nearly all of them again |
| **Chosen: local 7×7 test + spaced restore** | **0.16 s** | **13 s** | **32–42%** |

## Rules for the implementer

- Run `export PATH="$HOME/.bun/bin:$PATH"` in every shell. Work in `/home/jhonnold/projects/loophole-wt/core-generator`.
- Copy code blocks **exactly** (they were formatted with Biome and the golden values come from them). Golden strings depend on every rng call and on the solver; if a golden test fails, you did not copy something exactly — fix the code, never the goldens.
- Do not touch `engine.ts`, `solver.ts`, `verify.ts`, `rng.ts` or anything in `apps/`.
- No `console`, `Date`, `performance` or Bun APIs in `src/` (typecheck enforces it). The benchmark may use `performance.now()` and `console`.
- `bun run check` must pass after every step; commit after each step with the given message. Do not push.

## Step 1 — Loop generation (FR-8)

### 1.1 `packages/core/src/loop.ts` (new)

```ts
import { EdgeState, type Grid, NONE } from "./grid.ts";
import type { Rng } from "./rng.ts";

/** How big a generated loop must be (PRD FR-8). Shares are fractions from 0 to 1. */
export interface LoopThresholds {
  /** Smallest share of the cells the loop must enclose. */
  readonly minCoverage: number;
  /** Smallest share of the rows, and of the columns, that the loop's bounding box must span. */
  readonly minSpan: number;
}

/** Default loop thresholds (PRD FR-8, §14 question 5). */
export const LOOP_THRESHOLDS: LoopThresholds = Object.freeze({ minCoverage: 0.4, minSpan: 0.8 });

/** Side and corner neighbours in ring order: N, NE, E, SE, S, SW, W, NW. Even slots are sides. */
const RING = [
  [-1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
] as const;

/**
 * The smallest whole number of cells (or rows, or columns) that is at least `share` of `n`, and at
 * least 1. The small epsilon keeps a product like 0.8 × 10 from rounding up past 8.
 */
export function thresholdCount(share: number, n: number): number {
  return Math.max(1, Math.ceil(share * n - 1e-9));
}

/**
 * A random single loop on `grid` that meets `thresholds`, as edge states (`Line` on the loop,
 * `Cross` elsewhere), or `null` when growth got stuck first.
 *
 * Grows a region of cells from a random cell in the middle half of the board, adding random cells
 * next to it, and stops as soon as the region covers `minCoverage` of the cells and its bounding
 * box spans `minSpan` of the rows and of the columns. The loop is the region's boundary. A cell
 * joins only when its 8 neighbours (off the board counts as outside), read around the ring, hold
 * exactly one run of region cells and that run includes a side neighbour. That keeps the region and
 * the outside each in one piece with no two cells meeting only at a corner, so the boundary is
 * always one simple loop. The whole board always meets the thresholds, so tiny boards end up with
 * the loop around the edge. `extra` grows that many more cells after the thresholds are met (fewer
 * if the region runs out of room); `generate` uses it when it has to retry.
 */
export function generateLoop(
  grid: Grid,
  rng: Rng,
  thresholds: LoopThresholds = LOOP_THRESHOLDS,
  extra = 0,
): Uint8Array | null {
  const W = grid.width;
  const H = grid.height;
  const minArea = thresholdCount(thresholds.minCoverage, grid.cellCount);
  const minRows = thresholdCount(thresholds.minSpan, H);
  const minCols = thresholdCount(thresholds.minSpan, W);
  const inside = new Uint8Array(grid.cellCount);
  const at = (r: number, c: number) => (r >= 0 && r < H && c >= 0 && c < W ? inside[r * W + c] : 0);
  const canAdd = (r: number, c: number): boolean => {
    let runs = 0;
    let side = false;
    for (let k = 0; k < 8; k++) {
      const [dr, dc] = RING[k];
      const [pr, pc] = RING[(k + 7) % 8];
      const cur = at(r + dr, c + dc);
      if (cur && !at(r + pr, c + pc)) runs++;
      if (cur && k % 2 === 0) side = true;
    }
    return runs === 1 && side;
  };

  let area = 0;
  let top = H;
  let bottom = -1;
  let left = W;
  let right = -1;
  const frontier: number[] = [];
  const add = (i: number) => {
    inside[i] = 1;
    area++;
    const r = Math.floor(i / W);
    const c = i % W;
    top = Math.min(top, r);
    bottom = Math.max(bottom, r);
    left = Math.min(left, c);
    right = Math.max(right, c);
    if (r > 0 && !inside[i - W]) frontier.push(i - W);
    if (r < H - 1 && !inside[i + W]) frontier.push(i + W);
    if (c > 0 && !inside[i - 1]) frontier.push(i - 1);
    if (c < W - 1 && !inside[i + 1]) frontier.push(i + 1);
  };
  const done = () => area >= minArea && bottom - top + 1 >= minRows && right - left + 1 >= minCols;

  const qr = Math.floor(H / 4);
  const qc = Math.floor(W / 4);
  add((qr + rng.int(H - 2 * qr)) * W + qc + rng.int(W - 2 * qc));
  // A cell that cannot join yet is dropped; it comes back when another side neighbour joins.
  let more = extra;
  while (frontier.length > 0 && (more > 0 || !done())) {
    const k = rng.int(frontier.length);
    const i = frontier[k];
    frontier[k] = frontier[frontier.length - 1];
    frontier.pop();
    if (inside[i] || !canAdd(Math.floor(i / W), i % W)) continue;
    if (done()) more--;
    add(i);
  }
  if (!done()) return null;

  const edges = new Uint8Array(grid.edgeCount);
  for (let e = 0; e < grid.edgeCount; e++) {
    const a = grid.edgeCells[e * 2];
    const b = grid.edgeCells[e * 2 + 1];
    const inA = a === NONE ? 0 : inside[a];
    const inB = b === NONE ? 0 : inside[b];
    edges[e] = inA !== inB ? EdgeState.Line : EdgeState.Cross;
  }
  return edges;
}
```

### 1.2 `packages/core/src/test-support/loops.ts` — append at the end of the file

Add one blank line after the current last line (`}` of `puzzleFromLoop`), then:

```ts
/** How much of the board a loop covers: enclosed cells, and the rows and columns its inside spans. */
export interface LoopCoverage {
  readonly area: number;
  readonly rows: number;
  readonly cols: number;
}

/**
 * Measures a loop by scanning each row left to right: a cell is inside when an odd number of
 * vertical line edges lie to its left. Independent of the generator's own bookkeeping.
 */
export function loopCoverage(grid: Grid, edges: Uint8Array): LoopCoverage {
  const W = grid.width;
  let area = 0;
  let top = grid.height;
  let bottom = -1;
  let left = W;
  let right = -1;
  for (let r = 0; r < grid.height; r++) {
    let inside = false;
    for (let c = 0; c < W; c++) {
      if (edges[grid.hEdgeCount + r * (W + 1) + c] === EdgeState.Line) inside = !inside;
      if (!inside) continue;
      area++;
      top = Math.min(top, r);
      bottom = Math.max(bottom, r);
      left = Math.min(left, c);
      right = Math.max(right, c);
    }
  }
  return { area, rows: bottom - top + 1, cols: right - left + 1 };
}
```

(`EdgeState` and `Grid` are already imported in that file.)

### 1.3 `packages/core/src/loop.test.ts` (new)

```ts
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
```

### 1.4 `packages/core/src/index.ts`

Insert `export * from "./loop.ts";` on its own line directly after `export * from "./grid.ts";` (exports stay alphabetical).

### Verify

```sh
bun test packages/core/src/loop.test.ts   # 7 pass, ~0.1 s
bun run check                             # 262 pass
```

Commit: `feat(core): grow random loops that meet coverage thresholds`

## Step 2 — Generator (FR-7, FR-9, FR-10, FR-11 hooks)

### 2.1 `packages/core/src/generate.ts` (new)

```ts
import { EdgeState, type Grid } from "./grid.ts";
import { generateLoop, LOOP_THRESHOLDS, type LoopThresholds } from "./loop.ts";
import { createPuzzle, deriveClues, NO_CLUE, type Puzzle } from "./puzzle.ts";
import { createRng, type Rng } from "./rng.ts";
import { type SolveResult, solve } from "./solver.ts";

/**
 * Version of the generator's output. The same seed, size and options give the same puzzle for the
 * same version (PRD FR-10). Bump it whenever any output changes, including through a change to the
 * solver's rules, which decide which clues can go.
 */
export const GENERATOR_VERSION = "1";

/** A clue's removal is tested with the edges this many cells around it unknown, the rest given. */
const WINDOW_RADIUS = 3;
/** Clues put back in one round are more than this many cells apart (in rows and columns). */
const RESTORE_SPACING = 2;
/** Loops tried before giving up. Only 2×2 and rare small boards need a second; this bounds the loop. */
const MAX_ATTEMPTS = 100;

export interface GenerateProgress {
  /** Clue removal tests done so far. */
  readonly done: number;
  /** Clue removal tests this attempt makes in all. */
  readonly total: number;
}

export interface GenerateOptions {
  readonly width: number;
  readonly height: number;
  /** Any string from 1 to 128 characters. The core never picks one itself. */
  readonly seed: string;
  /** Default `LOOP_THRESHOLDS`. */
  readonly thresholds?: LoopThresholds;
  /**
   * Called after every clue removal test. Purely informational: it does not change the result.
   * Throw from it to stop generation; the error propagates out of `generate`.
   */
  readonly onProgress?: (progress: GenerateProgress) => void;
}

export interface GenerateStats {
  /** Loops grown, counting rejected ones. 1 unless a loop was rejected. */
  readonly attempts: number;
  readonly clueCount: number;
  /** Clue removal tests made. */
  readonly checks: number;
  /** Clues put back because the whole puzzle got stuck without them. */
  readonly restored: number;
}

export interface GenerateResult {
  /** Has `seed` and `meta.generator` = `GENERATOR_VERSION`. */
  readonly puzzle: Puzzle;
  /** The only solution, as edge states (`Line` and `Cross`). */
  readonly solution: Uint8Array;
  /** `solve(puzzle)` from an empty board: status `solved`, steps for hints (FR-6). */
  readonly solve: SolveResult;
  readonly stats: GenerateStats;
}

/**
 * Generates a puzzle with exactly one solution (PRD FR-7 to FR-10).
 *
 * 1. Grow a random loop that meets the thresholds (`generateLoop`).
 * 2. Give every cell its clue (a cell with 4 lines, only on a 1×1 board, gets none). If the rule
 *    solver cannot solve that (two loops can share every clue, as the L shapes on a 2×2 board do),
 *    try a new loop, grown one cell further past the thresholds than the last.
 * 3. In random order, remove each clue if the solver can still decide the 7×7 window of cells
 *    around it with every edge outside the window given. This local test is cheap but generous.
 * 4. Solve the whole puzzle from scratch. While it gets stuck, put back removed clues next to the
 *    open edges, spread out, and solve again.
 *
 * The result is solved by the rules alone, which proves it has one solution (PRD §9). Uses only the
 * seeded generator and no clock, so it is deterministic. Throws `RangeError` for a bad size, seed or
 * thresholds.
 */
export function generate(options: GenerateOptions): GenerateResult {
  const { width, height, seed, onProgress } = options;
  const thresholds = options.thresholds ?? LOOP_THRESHOLDS;
  for (const [name, share] of Object.entries(thresholds)) {
    if (!(share >= 0 && share <= 1)) {
      throw new RangeError(`thresholds.${name} must be from 0 to 1, got ${share}`);
    }
  }
  const meta = { generator: GENERATOR_VERSION };
  // Checks the size and seed before any work.
  const grid = createPuzzle(width, height, undefined, { seed, meta }).grid;
  const rng = createRng(seed);
  for (let attempts = 1; attempts <= MAX_ATTEMPTS; attempts++) {
    const solution = generateLoop(grid, rng, thresholds, attempts - 1);
    if (solution === null) continue;
    const full = deriveClues(grid, solution).map((k) => (k === 4 ? NO_CLUE : k));
    const clues = full.slice();
    const work: Puzzle = { grid, clues };
    if (solve(work).status !== "solved") continue;
    const checks = removeClues(work, solution, rng, onProgress);
    const { result, restored } = restoreClues(work, full, rng);
    let clueCount = 0;
    for (const k of clues) if (k !== NO_CLUE) clueCount++;
    return {
      puzzle: createPuzzle(width, height, clues, { seed, meta }),
      solution,
      solve: result,
      stats: { attempts, clueCount, checks, restored },
    };
  }
  throw new Error(`no usable loop after ${MAX_ATTEMPTS} attempts`);
}

/** Step 3: the local removal test, in random order. Changes `puzzle.clues`; returns the tests made. */
function removeClues(
  puzzle: Puzzle,
  solution: Uint8Array,
  rng: Rng,
  onProgress: GenerateOptions["onProgress"],
): number {
  const { grid, clues } = puzzle;
  const order: number[] = [];
  for (let i = 0; i < grid.cellCount; i++) if (clues[i] !== NO_CLUE) order.push(i);
  shuffle(order, rng);
  const initial = new Uint8Array(grid.edgeCount);
  for (let n = 0; n < order.length; n++) {
    const i = order[n];
    const k = clues[i];
    clues[i] = NO_CLUE;
    initial.set(solution);
    forEachNear(grid, i, WINDOW_RADIUS, (x) => {
      for (let j = 0; j < 4; j++) initial[grid.cellEdges[x * 4 + j]] = EdgeState.Unknown;
    });
    if (solve(puzzle, { initial }).status !== "solved") clues[i] = k;
    onProgress?.({ done: n + 1, total: order.length });
  }
  return order.length;
}

/**
 * Step 4: solve from scratch; while stuck, put back removed clues of cells next to an open edge
 * (or, if there are none, any removed clues), keeping each round's picks spread out. Terminates
 * because each round puts back at least one clue and the full clue set solves.
 */
function restoreClues(
  puzzle: Puzzle,
  full: Int8Array,
  rng: Rng,
): { result: SolveResult; restored: number } {
  const { grid, clues } = puzzle;
  let restored = 0;
  for (;;) {
    const result = solve(puzzle);
    if (result.status === "solved") return { result, restored };
    const removed: number[] = [];
    const nearOpen: number[] = [];
    for (let i = 0; i < grid.cellCount; i++) {
      if (clues[i] !== NO_CLUE || full[i] === NO_CLUE) continue;
      removed.push(i);
      for (let j = 0; j < 4; j++) {
        if (result.edges[grid.cellEdges[i * 4 + j]] === EdgeState.Unknown) {
          nearOpen.push(i);
          break;
        }
      }
    }
    const candidates = nearOpen.length > 0 ? nearOpen : removed;
    shuffle(candidates, rng);
    const blocked = new Uint8Array(grid.cellCount);
    for (const i of candidates) {
      if (blocked[i]) continue;
      clues[i] = full[i];
      restored++;
      forEachNear(grid, i, RESTORE_SPACING, (x) => {
        blocked[x] = 1;
      });
    }
  }
}

/** Calls `visit` with every cell at most `radius` rows and `radius` columns away from cell `i`. */
function forEachNear(grid: Grid, i: number, radius: number, visit: (cell: number) => void): void {
  const W = grid.width;
  const r = Math.floor(i / W);
  const c = i % W;
  const rowEnd = Math.min(grid.height - 1, r + radius);
  const colEnd = Math.min(W - 1, c + radius);
  for (let rr = Math.max(0, r - radius); rr <= rowEnd; rr++) {
    for (let cc = Math.max(0, c - radius); cc <= colEnd; cc++) visit(rr * W + cc);
  }
}

/** Fisher–Yates shuffle in place with the seeded generator. */
function shuffle(items: number[], rng: Rng): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = items[i];
    items[i] = items[j];
    items[j] = t;
  }
}
```

Notes on the subtle parts (already in the code; do not "improve" them):
- `work` is a plain `{ grid, clues }` object reusing one grid and one mutable `clues` array; `createPuzzle` (which rebuilds the grid tables) is called only twice. The engine reads `puzzle.clues` by reference, which is why mutating `clues` between `solve` calls works.
- `initial.set(solution)` then blanking the window: the window test is `solve(puzzle, { initial })`, never `verify` and never with `timeLimitMs`.
- The candidate list in `restoreClues` is shuffled, then filtered greedily with the `blocked` mask; the order of `rng` calls must stay exactly as written.
- The retry passes `attempts - 1` as `extra`.

### 2.2 `packages/core/src/generate.test.ts` (new)

The golden strings below were produced by running this exact code.

```ts
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { analyzeBoard } from "./analyze.ts";
import { countSolutions } from "./bruteforce.ts";
import { encodeEdges, serializePuzzleJson } from "./format.ts";
import {
  GENERATOR_VERSION,
  type GenerateProgress,
  type GenerateResult,
  generate,
} from "./generate.ts";
import { LOOP_THRESHOLDS, type LoopThresholds, thresholdCount } from "./loop.ts";
import { deriveClues, NO_CLUE } from "./puzzle.ts";
import { loopCoverage } from "./test-support/loops.ts";
import { verify } from "./verify.ts";

/** Everything FR-7 to FR-9 promise about one result. */
function checkResult(r: GenerateResult, seed: string, thresholds = LOOP_THRESHOLDS) {
  const { puzzle, solution } = r;
  const { grid } = puzzle;
  expect(puzzle.seed).toBe(seed);
  expect(puzzle.meta).toEqual({ generator: GENERATOR_VERSION });
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
  // The rules alone solve it from an empty board, so it is unique (PRD §9), and the verifier agrees.
  expect(r.solve.status).toBe("solved");
  expect(encodeEdges(r.solve.edges)).toBe(encodeEdges(solution));
  const v = verify(puzzle, { timeLimitMs: Number.POSITIVE_INFINITY });
  expect(v.status).toBe("unique");
  expect(encodeEdges(v.solutions[0])).toBe(encodeEdges(solution));
}

describe("generate: golden values (FR-10)", () => {
  // Frozen output for GENERATOR_VERSION "1". If one changes, the generator's output changed: bump
  // GENERATOR_VERSION and update these (docs/DECISIONS.md, WT3).
  const cases: [number, number, string, string][] = [
    [1, 1, ".", "1111"],
    [1, 2, "3.", "1211111"],
    [2, 2, "22..", "112211121121"],
    [
      5,
      5,
      "22..1..0.1...2..2.0..0...",
      "211121222222212211221222222222212212122212122122112222222222",
    ],
    [
      6,
      4,
      "...132...3...3.2..0..222",
      "2222122212212121222111222222112222112221112121222212222121",
    ],
    [
      7,
      7,
      ".....0.0...02........01.21.3.3.00....2.0.1..1.2.2",
      "2222222222222122222122221121211222121222222211222222211122222222222222112222212122212212212222212212222122221221",
    ],
    [
      10,
      10,
      ".32..31.0...3..3...01.....20...0.0.0........0.1.0.1.0..0.....000.0.3....00..2.002.0...2...1.21.200..",
      "2121112222122221222222122122222222221222222222222222222222222222222122222222212222222212221122212222221112222221112212222121121222221222221222212222221222122222212221222222122212222222122122222212221222221222222122122222",
    ],
  ];
  for (const [width, height, clues, solution] of cases) {
    test(`${width}x${height} seed "golden"`, () => {
      const r = generate({ width, height, seed: "golden" });
      expect(serializePuzzleJson(r.puzzle)).toBe(
        JSON.stringify({ v: 1, width, height, clues, seed: "golden", meta: { generator: "1" } }),
      );
      expect(encodeEdges(r.solution)).toBe(solution);
    });
  }
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
});

describe("generate: options", () => {
  test("rejects a bad size, seed or thresholds before doing any work", () => {
    const bad: Parameters<typeof generate>[0][] = [
      { width: 0, height: 5, seed: "s" },
      { width: 5, height: 101, seed: "s" },
      { width: 5, height: 5, seed: "" },
      { width: 5, height: 5, seed: "x".repeat(129) },
      { width: 5, height: 5, seed: "s", thresholds: { minCoverage: 1.5, minSpan: 0.8 } },
      { width: 5, height: 5, seed: "s", thresholds: { minCoverage: 0.4, minSpan: Number.NaN } },
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
```

### 2.3 `packages/core/src/index.ts`

Insert `export * from "./generate.ts";` on its own line directly after `export * from "./format.ts";`.

### Verify

```sh
bun test packages/core/src/generate.test.ts   # 14 pass, ~0.4 s
bun run check                                 # 276 pass
```

Commit: `feat(core): generate unique puzzles from a seed`

## Step 3 — Benchmark (not in the gate)

### 3.1 `packages/core/bench/generate.ts` (new)

`tsconfig.test.json` already includes `bench`, so it is type-checked by the gate.

```ts
/**
 * Generator benchmark (not part of `bun run check`). Run: `bun run --cwd packages/core bench:generate`.
 *
 * 1. Loop acceptance (PRD §10, target ≥ 95%): the share of grown loops that meet the default
 *    thresholds, over many seeds per size.
 * 2. Generation time per size (NFR-1: p95 under 5 s up to 30×30), first-attempt rate (loops whose
 *    full clue set the rules solve), clue density, clues put back, and `verify` on every result.
 * Pass `--quick` to skip 100×100.
 */
import { generate } from "../src/generate.ts";
import { createGrid } from "../src/grid.ts";
import { generateLoop } from "../src/loop.ts";
import { createRng } from "../src/rng.ts";
import { verify } from "../src/verify.ts";

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

const quick = process.argv.includes("--quick");

const LOOP_SIZES: [number, number, number][] = [
  [1, 1, 200],
  [2, 2, 200],
  [3, 3, 1000],
  [5, 5, 1000],
  [7, 7, 1000],
  [10, 10, 1000],
  [20, 20, 1000],
  [30, 30, 1000],
  [40, 40, 500],
  [100, 100, 200],
  [100, 10, 200],
  [1, 100, 200],
];
for (const [w, h, count] of LOOP_SIZES) {
  const grid = createGrid(w, h);
  let ok = 0;
  for (let n = 0; n < count; n++) if (generateLoop(grid, createRng(`loop-${n}`)) !== null) ok++;
  console.log(`loops ${w}×${h}: n=${count} accepted=${((100 * ok) / count).toFixed(1)}%`);
}

const GEN_SIZES: [number, number][] = [
  [7, 20],
  [10, 20],
  [20, 20],
  [30, 20],
  [40, 10],
  [100, 3],
];
for (const [size, count] of GEN_SIZES) {
  if (quick && size > 40) continue;
  const times: number[] = [];
  const statuses: Record<string, number> = {};
  let firstAttempt = 0;
  let clues = 0;
  let restored = 0;
  for (let n = 0; n < count; n++) {
    const t0 = performance.now();
    const r = generate({ width: size, height: size, seed: `bench-${n}` });
    times.push(performance.now() - t0);
    if (r.stats.attempts === 1) firstAttempt++;
    clues += r.stats.clueCount;
    restored += r.stats.restored;
    const status = verify(r.puzzle).status;
    statuses[status] = (statuses[status] ?? 0) + 1;
  }
  times.sort((a, b) => a - b);
  const cells = count * size * size;
  console.log(
    `generate ${size}×${size}: n=${count} median=${percentile(times, 0.5).toFixed(0)}ms ` +
      `p95=${percentile(times, 0.95).toFixed(0)}ms max=${times[times.length - 1].toFixed(0)}ms ` +
      `first-attempt=${((100 * firstAttempt) / count).toFixed(0)}% clues=${((100 * clues) / cells).toFixed(1)}% ` +
      `restored=${((100 * restored) / cells).toFixed(1)}% verify=${JSON.stringify(statuses)}`,
  );
}
```

### 3.2 `packages/core/package.json`

Replace the line `"bench": "bun bench/verify.ts"` with:

```json
    "bench": "bun bench/verify.ts",
    "bench:generate": "bun bench/generate.ts"
```

### Verify

```sh
bun run check                                              # 276 pass
bun run --cwd packages/core bench:generate --quick         # ~10 s; skips 100×100
bun run --cwd packages/core bench:generate                 # ~50 s; full table
```

Expect every `loops` line at `accepted=100.0%`, every `verify` at all `unique`, 30×30 p95 well under 5000 ms and 100×100 under ~30 s (numbers vary with the machine; the table above is the reference). Put the measured full-run numbers in the final report.

Commit: `chore(core): add generator benchmark`

## Step 4 — Docs

### 4.1 `README.md` — three exact edits

1. Replace `and a verifier that says whether a puzzle has one solution, none, several, or could not be decided in time) and a first web app.` with `a verifier that says whether a puzzle has one solution, none, several, or could not be decided in time, and a generator that makes a puzzle with exactly one solution from a seed) and a first web app.`
2. Replace `The generator and server are being built in phases;` with `The server is being built in phases;`
3. In the Scripts table, add after the `bench` row:

```
| `bun run --cwd packages/core bench:generate` | Time puzzle generation on 7×7 to 100×100 boards and measure loop acceptance (not part of the check) |
```

### 4.2 `packages/core/AGENTS.md` — append one bullet at the end

```
- The generator's output for a seed is frozen per `GENERATOR_VERSION`. A change that alters generated puzzles, including a change to the solver's rules or to the seeded generator, needs a version bump and new golden values in the generator tests. Generation never depends on the clock or a time limit. `bench:generate` shows its speed.
```

### 4.3 `docs/DECISIONS.md` — append at the end (after a blank line)

If your full benchmark numbers differ noticeably from the ones in the second entry, use yours.

```markdown
## 2026-10-25 · WT3 `core-generator` · Loop thresholds and how loops grow
- **Question:** How does the generator build a loop that is big enough (FR-8), and what happens on boards too small for the thresholds?
- **Decision:** `LOOP_THRESHOLDS` is 40% of the cells enclosed and a bounding box spanning 80% of the rows and 80% of the columns, each rounded up to a whole count and at least 1. `generateLoop` grows one region of cells from a random cell in the middle half of the board, adding random neighbouring cells only when the region and the outside both stay in one piece with no cells meeting only at a corner, and stops as soon as all three thresholds hold. The loop is the region's boundary. The whole board always qualifies, so every size works: 1×1 and 1×2 get the loop around the edge, 2×2 an L shape.
- **Reason:** Growing until the thresholds hold makes them a stopping rule instead of a filter. In the benchmark 100% of loops met them on every size measured (1×1 to 100×100, 100×10 and 1×100); PRD §10 asks for 95%. Coverage lands between 40% and about 65%.

## 2026-10-25 · WT3 `core-generator` · Clue removal: a local test, then put clues back where the solver gets stuck
- **Question:** How are clues removed (FR-9) fast enough for 100×100, where removing one clue at a time and re-solving the whole board took about 30 minutes?
- **Decision:** In random order, a clue is removed if the rule solver can still decide the 7×7 window of cells around it with every edge outside the window taken from the solution. Then the whole puzzle is solved from an empty board; while it gets stuck, removed clues in cells next to open edges are put back (each round's picks at least 3 cells apart) and it is solved again. If the rules cannot solve a loop's full clue set (two loops can share every clue, as the L shapes on a 2×2 board do), the loop is dropped and the next one grows one more cell past the thresholds.
- **Reason:** The local test costs about 1 ms on a 100×100 board instead of hundreds, and putting clues back takes 1 to 4 whole-board solves. Measured with `bench:generate`: p95 6 ms at 7×7, 9 ms at 10×10, 46 ms at 20×20, 164 ms at 30×30 (NFR-1 allows 5 s), 394 ms at 40×40, and about 13 s at 100×100; 32–42% of cells keep a clue; every result verified `unique`. Also measured: a whole-board solve per clue (about 30 minutes at 100×100); whole-board checks started from a per-tile base state (proven at every step, about 15% clues, but 114 s at 100×100); and a second pass retrying the put-back clues with whole-board solves (about 18% clues at 30×30 for 4 times the time, and far too slow at 100×100). Fewer clues make harder puzzles and difficulty is deferred (PRD §14), so the fast, moderately clued version was chosen. The final puzzle is solved by the rules from an empty board, which proves it has one solution (PRD §9) and gives hints a complete step log.

## 2026-10-25 · WT3 `core-generator` · Generator version and determinism
- **Question:** What makes generation reproducible (FR-10), and how is the version recorded?
- **Decision:** `generate` takes a required seed (the server picks one when a user gives none) and draws only from `createRng(seed)`, with no clock and no time limit. The puzzle carries `seed` and `meta.generator` set to `GENERATOR_VERSION`, a whole number as a string, now `"1"`. The version goes up whenever any output changes, including through a change to the solver's rules or to `createRng`; golden-value tests catch such changes. Custom thresholds are not recorded in the puzzle; the server uses the defaults.
- **Reason:** The same seed, size and version give the same puzzle on every machine, so a daily puzzle can be regenerated or checked later. The solver decides which clues can go, so changing its rules changes puzzles.

## 2026-10-25 · WT3 `core-generator` · Generation progress and cancellation
- **Question:** How does a background job (FR-11, WT6) report progress and stop a generation early?
- **Decision:** `onProgress({ done, total })` is called after every clue removal test; `total` is the number of clues in the full puzzle. It never affects the result. Throwing from it stops `generate`, and the error propagates. The worker's `terminate()` stays the hard time limit.
- **Reason:** Removal tests are nearly all of the work, so their count makes an honest progress bar. A throwing callback gives cooperative cancellation without an `AbortSignal` type, which core's typecheck (no DOM types) does not have.
```

### Verify

```sh
bun run check   # 276 pass
```

Commit: `docs: describe the generator`

## Final checks

```sh
bun run check
git log --oneline main..HEAD    # 4 commits above (plus the plan commit)
git status                      # clean
```

## Acceptance criteria

| Id | Criterion | Where checked |
|---|---|---|
| FR-7 | `generate({width, height, seed})` returns clue grid, solution, solver result | `generate.test.ts` `checkResult`; API above |
| FR-8 | Loop encloses ≥ 40% of cells and spans ≥ 80% of rows and columns; thresholds in exported `LOOP_THRESHOLDS`, overridable, tested | `loop.test.ts` (property over 1–30 × 1–30, large/thin boards, custom thresholds, defaults test); `checkResult` uses independent `loopCoverage` |
| FR-9 | Clues derived from the loop and agree with the solution; final puzzle `unique` with the same solution | `checkResult` (clue = derived count, `solve` solved, `verify` unique with identical solution); brute force on all sizes ≤ 4×4 |
| FR-10 | Same seed + version ⇒ identical serialized puzzle; version in `meta.generator`; no clock | golden tests; determinism property; `onProgress` doesn't change output; no `Date`/time limits in `generate.ts` |
| FR-11 | Progress callback and cooperative cancel for background jobs | `generate.test.ts` "options" tests; DECISIONS entry |
| NFR-1 | Generation p95 ≤ 30×30 under 5 s | bench: 30×30 p95 ≈ 0.16 s; 100×100 ≈ 13 s |
| NFR-3 | Unit + property tests in the gate | 21 new tests, ~0.5 s |
| §9 | Generated puzzles are rule-solvable without guessing | `result.solve.status === "solved"` from an empty board |
| §10 | ≥ 95% of loops meet thresholds | bench: 100% for all sizes measured |

## Unresolved questions

- Clue density ~32–42% (moderate; near-minimal ~15–18% would be harder and 4–10× slower). Default: keep moderate; revisit with difficulty levels (PRD §14).
- Custom `thresholds` are not recorded in `meta`, so only default-threshold puzzles are reproducible from seed + version. Default: fine, server always uses defaults.
- `onProgress` fires per clue (10 000×/puzzle at 100×100). Default: WT6 throttles writes.
