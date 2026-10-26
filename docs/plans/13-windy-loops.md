# WT13 `windy-loops` — implementation plan

Branch `feat/windy-loops`, worktree `/home/jhonnold/projects/loophole-wt/windy-loops`. PRD: FR-8 (random loop, coverage thresholds in config, with tests), FR-9 (clues derived then removed; unchanged here), FR-10 (deterministic per seed and version), NFR-1 (p95 under 5 s up to 30×30), NFR-3 (unit and property tests), §10 (≥ 95% loop acceptance). Roadmap: WT13 is the first of WT13–19 ("windy loops + fewer clues"); WT14–18 bring clue density down, WT18 retunes the generator.

## Goal

Replace how `generateLoop` (`packages/core/src/loop.ts`) builds loops. Today it grows a compact blob from one cell. Book (Nikoli) puzzles have long winding loops that fill the board. New method:

1. **Carve**: every cell starts inside; one-cell-wide tunnels of outside wind in from the border, until the loop passes through 65% of the dots.
2. **Climb**: a seeded hill climb flips random cells either way when that brings inside area, dot share and solid 2×2 share no further from a fixed target (area 0.5, dots 0.75, solid ≤ 0.2).

Also:

- **`loopShape(grid, edges)`**: exported metrics `{ area, dots, solid }` for tests and the benchmark, and **`LOOP_SHAPE_TARGET`** next to `LOOP_THRESHOLDS`. The target is a fixed core constant, the same for every puzzle (the user decided shape is not a difficulty knob).
- FR-8 floors (`minCoverage` 0.4, `minSpan` 0.8) stay hard guarantees. Every board size works, 1×1 to 100×100, thin boards included.
- Deterministic: only the seeded `Rng`, no clock, every loop bounded by a draw count (DECISIONS, WT2 "Deterministic generation must not depend on wall-clock budgets").
- `GENERATOR_VERSION` "1" → "2", new golden values.
- `bench:generate` prints shape metrics; DECISIONS entry with the measured numbers; README script row.

Out of scope: solver/engine changes, clue removal (`WINDOW_RADIUS`, `RESTORE_SPACING`), difficulty levels, server and web changes. Clue density rises (measured below). That is expected, and WT14–18 deal with it.

## Measured (this machine, 16 cores, Bun 1.3.13, idle; the code in this plan)

Shape, mean over seeds (`loopShape`). Before = today's growth, 30 seeds; after = `bench:generate`, 1000 seeds (500 at 40×40, 200 at 100×100), [min–max]:

| Size | Before area / dots / solid | After area | After dots | After solid |
|---|---|---|---|---|
| 10×10 | 0.446 / 0.339 / 0.635 | 0.500 [0.50–0.50] | 0.754 [0.74–0.79] | 0.188 [0.10–0.31] |
| 20×20 | 0.448 / 0.214 / 0.786 | 0.500 [0.50–0.50] | 0.761 [0.75–0.81] | 0.213 [0.19–0.28] |
| 30×30 | — | 0.500 [0.50–0.50] | 0.764 [0.75–0.80] | 0.225 [0.20–0.27] |
| 40×40 | 0.462 / 0.162 / 0.843 | 0.500 [0.50–0.50] | 0.764 [0.75–0.80] | 0.232 [0.20–0.27] |
| 100×100 | — | 0.500 [0.50–0.50] | 0.754 [0.75–0.78] | 0.248 [0.22–0.26] |

Targets (20×20 mean over ≥ 30 seeds): area 0.45–0.55 ✓, dots 0.70–0.80 ✓, solid ≤ 0.30 ✓; 10×10 and 40×40 are inside the same bands. Small boards: 3×3 0.556/0.750/0.048, 5×5 0.510/0.738/0.086, 7×7 0.512/0.750/0.160; 2×2 is always an L (0.75/0.889/0); 1×100 0.901/0.902/0 (only the two end cells can move and the 80% span floor holds). Loop acceptance (FR-8 thresholds met) is 100.0% on every size (1×1 … 100×100, 100×10, 1×100). A loop takes 0.3 ms at 10×10, 0.5 ms at 20×20, 1.5 ms at 40×40, 11 ms at 100×100.

`bench:generate` generation (n = 20, 10 at 40×40, 3 at 100×100). Before (today's code, same run conditions) → after:

| Size | p95 before → after | clues before → after | restored after | verify |
|---|---|---|---|---|
| 7×7 | 7 → 8 ms | 41.6% → 48.9% | 10.7% | all unique |
| 10×10 | 8 → 13 ms | 36.5% → 50.8% | 14.2% | all unique |
| 20×20 | 52 → 89 ms | 34.0% → 56.0% | 19.9% | all unique |
| 30×30 | 172 → 332 ms | 34.5% → 56.7% | 20.4% | all unique |
| 40×40 | 492 → 975 ms | 32.5% → 57.9% | 22.0% | all unique |
| 100×100 | ~13 s (DECISIONS) → 31.0 s median, 31.5 s max | 34.6% → 59.1% | 23.0% | all unique |

NFR-1 holds: 30×30 p95 0.33 s, well under 5 s. 100×100 roughly doubles, to about 31 s; the worker's `GENERATE_TIMEOUT_MS` default is 60 s (`apps/server/src/config.ts:38`), so the margin is now about 2×. First-attempt rate is 100% at 7×7 and up. Of 432 generations over every size 1..12 × 1..12 × 3 seeds, 3 needed a second loop and all verified `unique`. 4500 loops (every size 1..30 × 1..30 × 5 seeds) were all one simple loop and met the thresholds.

Sample 20×20 (`loop-0`; `#` inside, area 0.50, dots 0.75, solid 0.22):

```
................##..
.....#.#.###....#..#
#.######.#....####.#
#.###..####......#.#
#.......###.#..###.#
#..#################
#.....######.......#
#.###.#..#.###.....#
#.#...#......#..#..#
#.#.#######.###.##..
#.#.##.......##.#..#
#.#..#.......#######
###..#...#########..
#.#..#......######..
#.#..#.#.##########.
#.#.####.#.....#####
#...#.##.#.#.###.##.
#...#....#.###....#.
#.###....#..........
###.....###########.
```

### Alternatives measured and rejected (20×20 means unless noted)

| Variant | area | dots | solid | Why not |
|---|---|---|---|---|
| Today's growth | 0.45 | 0.21 | 0.79 | compact blob |
| Carve 1-wide tunnels to exhaustion (WT13 prototype) | 0.56 | 0.98 | — | a maze: the loop through nearly every dot |
| Carve, stop at 75% of dots, no climb | 0.69 | 0.75 | 0.30 | too much inside; 1-wide tunnels cannot thin the inside without overshooting dots (10×10 0.74, 40×40 0.66 area) |
| Carve to 75% + simulated annealing (temperature 0.02 → 0.0005, 30 sweeps) | 0.50 | 0.75 | 0.20 | hits the numbers exactly but turns the tunnels into speckled noise when drawn |
| Annealing alone (no carve) | 0.50 | 0.75 | 0.19 | the same noise |
| Carve to 60/65/70% + strict hill climb (5 sweeps) | 0.50 | 0.757 / 0.761 / 0.767 | 0.214 / 0.215 / 0.209 | all pass; **65% chosen**: 40×40 dots 0.756 / 0.766 / 0.778, so 70% sits near the 0.80 ceiling and 60% gives a higher 40×40 solid (0.240) |

A temperature of 0.002 changed nothing measurable against a strict climb, so the climb has no temperature: accept when the cost does not go up. That is simpler, and the tunnels survive.

## Design

### Files

| File | Change |
|---|---|
| `packages/core/src/loop.ts` | add `LoopShape`, `LOOP_SHAPE_TARGET`, `loopShape`; rewrite `generateLoop` (return type `Uint8Array`, never `null`) |
| `packages/core/src/loop.test.ts` | rewrite: shape metrics, property up to 30×30, shape bands at 10/20/40, tiny boards, `extra`, determinism |
| `packages/core/src/generate.ts` | `GENERATOR_VERSION = "2"`; drop the `null` check; three doc-comment words |
| `packages/core/src/generate.test.ts` | new golden values; golden test uses `GENERATOR_VERSION` instead of a hard-coded `"1"` |
| `packages/core/bench/generate.ts` | loop section prints shape metrics and acceptance |
| `docs/DECISIONS.md` | new WT13 entry at the bottom; a "Superseded" bullet on the WT3 loop-growth entry |
| `README.md` | Scripts table: `bench:generate` row wording |

`index.ts` already has `export * from "./loop.ts"`, so the new exports need no edit. Not touched: `engine.ts`, `solver.ts`, `verify.ts`, `rng.ts`, `test-support/loops.ts` (`randomLoop` keeps the old blob growth for verifier tests and `bench/verify.ts`; leave it), anything in `apps/`. The `generator: "1"` strings in `apps/` tests are fixture data for hand-built puzzles, not generator output, so leave them. Server tests that check `meta` already use the `GENERATOR_VERSION` constant.

### Public API (additions and changes in `loop.ts`)

```ts
export interface LoopShape {
  readonly area: number;  // share of cells inside
  readonly dots: number;  // share of dots on the loop
  readonly solid: number; // share of 2×2 cell blocks all inside or all outside; 0 with no blocks
}
export const LOOP_SHAPE_TARGET: LoopShape; // frozen { area: 0.5, dots: 0.75, solid: 0.2 } (solid is a ceiling)
export function loopShape(grid: Grid, edges: Uint8Array): LoopShape; // edges must be one loop
export function generateLoop(grid: Grid, rng: Rng, thresholds?: LoopThresholds, extra?: number): Uint8Array; // was Uint8Array | null
```

`LoopThresholds`, `LOOP_THRESHOLDS` and `thresholdCount` are unchanged. `extra` keeps its meaning for `generate`'s retry: after shaping, that many random outside cells join the inside (fewer if none can).

### Algorithm

State: `inside` (1 per cell, all 1 at the start), `rowCount`/`colCount` (inside cells per row and column), and running counts `area`, `lines` (line edges; on one loop this equals the number of dots on it) and `solid` (solid 2×2 blocks). Start: `area = W·H`, `lines = 2(W+H)`, `solid = (W−1)(H−1)`. Off the board counts as outside everywhere.

**Topology test `flippable(r, c)`** (the existing `canAdd` ring test, generalised to both directions): let `to` = the colour the cell would become. Read the 8 neighbours in ring order N, NE, E, SE, S, SW, W, NW, and count the runs of `to`-coloured cells and the side neighbours of colour `to`. The flip is safe iff there is exactly one run and it holds a side neighbour. Return the side count when safe and 0 otherwise. For `to` = inside this is exactly today's `canAdd`; for `to` = outside it is the mirror. The rule is symmetric in the two colours (a corner-only touch, the 2×2 checkerboard, looks the same either way), so inside and outside each stay in one 4-connected piece with no corner-only contacts, and the boundary stays one simple loop. An all-`to` ring (an interior cell) and an all-other ring (the last cell of a colour) both give 0 runs, so neither can flip, and the inside is never emptied.

**Floors `canLeave(r, c)`** (only for inside → outside): `area − 1 ≥ minArea`, and if the cell is the last inside cell in its row (or column), the row (or column) span of the rest must still be ≥ `minRows` (`minCols`). Span = last non-zero index − first + 1 over `rowCount`/`colCount`, O(H) or O(W), and only computed when a count would reach 0. Joining the inside can only grow area and spans, so it needs no check. The start (whole board inside) meets every threshold, and every flip keeps them, so the thresholds always hold: no rejection path and no `null`.

**Flip bookkeeping `flip(r, c, sides)`**: `solid += solidAround(after) − solidAround(before)` (the up to 4 blocks holding the cell), `area ± 1`, `rowCount/colCount ± 1`, `lines += 4 − 2·sides` (the cell's line edges go from `sides` to `4 − sides`). Flipping straight back is `flip(r, c, 4 − sides)`.

**1. Carve.** `canCarve(r, c)` = cell on the board and inside, `flippable(r, c) === 1` (safe, and touching the outside on exactly one side: "skinny"), and `canLeave(r, c)`. Goal `lines ≥ 0.65·dotCount`. Up to `20·cells` times, while under the goal: draw `r = rng.int(H)`, `c = rng.int(W)`; skip unless `canCarve`. Heading `d` (0 N, 1 E, 2 S, 3 W, the side slots `RING[2d]`) points away from the one outside side. Tunnel length `steps = 2 + rng.int(max(3, ⌊(W+H)/2⌋))`. Each step: `flip(r, c, 1)`; stop when `steps` cells are carved or the goal is reached; draw `turn = rng.int(2) === 0 ? 1 : 3` (right or left) and `rng.float() < 0.3` (try turning first). Try the order [turn side, straight, other side] or [straight, turn side, other side], and move to the first side neighbour that `canCarve`; stop the tunnel if none can. A cell straight ahead whose only outside side is the cell just carved is skinny, so tunnels stay one cell wide and never touch another tunnel side-on.

**2. Climb.** `cost = |area/cells − 0.5| + |lines/dotCount − 0.75| + max(0, solid/blocks − 0.2)` (`solid` term 0 when `blocks = 0`). Exactly `5·cells` proposals: draw `r`, `c`; skip if `flippable` is 0, or the cell is inside and `!canLeave`. Otherwise flip, recompute the cost; keep it if `next <= current`, else flip back. Accepting equal cost lets the boundary drift sideways. ECMAScript doubles are IEEE-754, so the comparisons give the same result on every engine.

**3. Extra.** Up to `20·cells` draws while `extra` cells remain: an outside cell with `flippable > 0` joins.

Then edges = `Line` where the two cells on either side of an edge differ (off-board = outside), `Cross` elsewhere, as today.

**Termination and determinism:** every loop is bounded by a draw count (`20·cells` carve starts × at most `max(3, ⌊(W+H)/2⌋) + 1` steps, `5·cells` climb proposals, `20·cells` extra draws). Only `rng` is used. RNG draw order (part of the frozen output): carve start (r, c), tunnel length, per step (turn side, turn-first); climb (r, c) per proposal; extra (r, c) per draw.

**Tiny boards.** 1×1: no flip is ever safe, so the loop runs around the cell. 1×2: removing either cell breaks the column span (2 needed), so both cells stay. 2×2: carving never starts (8 lines ≥ 0.65 × 9 dots), the first climb proposal removes a corner (cost drops: area 1 → 0.75, solid 1 → 0), and nothing else is allowed (a domino breaks the span), so it is always an L. `generate` rejects the L (ambiguous clues) and retries with `extra = 1`, which gives the full square: golden `"2.2."`, solution `"112211121121"`. Thin boards (1×n, 2×n) only move end and edge cells and stay above the floors (1×100 area about 0.90).

### Gate cost

Core tests 224 → 230 (step 1: 226). `loop.test.ts` 0.13 s → 0.30 s, `generate.test.ts` 0.52 s → 0.71 s. The shape-band tests run 30 loops at each of 10, 20 and 40 with `loopShape`, about 70 ms in all (loops are 0.3–1.5 ms), so they stay in the gate.

## Rules for the implementer

- Run `export PATH="$HOME/.bun/bin:$PATH"` in every shell. Work in `/home/jhonnold/projects/loophole-wt/windy-loops`. The worktree has no `node_modules` yet: run `bun install --frozen-lockfile` once first. Do not clone the repo anywhere (`/tmp` is a small tmpfs).
- Copy code blocks **exactly**. They were formatted with Biome, and the golden values come from them. Golden strings depend on every rng call; if a golden test fails, you did not copy something exactly, so fix the code, never the goldens. If you have to change the algorithm, regenerate all goldens and the digest, and redo every measured number in DECISIONS.
- No `console`, `Date`, `performance` or Bun APIs in `src/` (the typecheck enforces it). The benchmark may use them.
- `bun run check` must pass after every step; commit after each step with the given message. Do not push.

## Step 1 — Loop shape metrics (no output change)

### 1.1 `packages/core/src/loop.ts`

Copy two pieces **verbatim from the Step 2.1 listing below** into the current file (leave `generateLoop` as it is for now):

1. The `LoopShape` interface and `LOOP_SHAPE_TARGET`, from the line starting ``/** The shape of a loop (`loopShape`).`` through the `LOOP_SHAPE_TARGET` line. Put them right after the `LOOP_THRESHOLDS` line (one blank line around them).
2. The `loopShape` function with its doc comment, from the `/**` above ` * Measures one loop given as edge states.` through the function's closing `}`. Put it right after `thresholdCount`.

Do not copy the `CARVE_DOTS` … `CLIMB_SWEEPS` constants yet; Biome would flag them as unused.

### 1.2 `packages/core/src/loop.test.ts`

From the Step 2.2 listing, copy verbatim:

1. The whole import block (it replaces the current one).
2. The `loopAround` helper with its doc comment. Put it after `checkLoop`.
3. The test `"the shape target is half the area, 75% of the dots, at most 20% solid, and frozen"`. Put it inside `describe("loop thresholds")` after the defaults test.
4. The whole `describe("loopShape", …)` block. Put it before `describe("generateLoop", …)`.

Keep the existing `checkLoop` (its `null` check stays until step 2) and the existing `describe("generateLoop")`.

Hand-checked expectations in the `loopShape` cases (W×H boards, dots = (W+1)(H+1), blocks = (W−1)(H−1)): `#` 1×1, 4 lines / 4 dots; `###` 3×1, 8/8, no blocks; full 2×2, 8/9, 1 of 1 block solid; L, 8/9, 0 solid; the U `### #.# #.#`, 16 lines / 16 dots (outer 11 + 5 around the notch), 0 solid; a lone centre cell, 4/16; a 3×2 band over an empty row, 10/16 with 2 of 4 blocks solid.

### Verify

```sh
bun run check   # core: 226 pass
```

Commit: `feat(core): measure a loop's area, dot share and solid 2×2 blocks`

## Step 2 — Windy loops (FR-8, FR-10)

### 2.1 `packages/core/src/loop.ts` — replace the whole file with

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

/** The shape of a loop (`loopShape`). Shares are fractions from 0 to 1. */
export interface LoopShape {
  /** Share of the cells inside the loop. */
  readonly area: number;
  /** Share of the dots the loop passes through. */
  readonly dots: number;
  /** Share of the 2×2 blocks of cells that are all inside or all outside; 0 with no blocks. */
  readonly solid: number;
}

/**
 * The shape `generateLoop` aims for, the same for every puzzle: half the cells inside, the loop
 * through three quarters of the dots, and at most a fifth of the 2×2 blocks solid (`solid` is a
 * ceiling; below it costs nothing). `LOOP_THRESHOLDS` stay hard floors.
 */
export const LOOP_SHAPE_TARGET: LoopShape = Object.freeze({ area: 0.5, dots: 0.75, solid: 0.2 });

/** Tunnels are carved until the loop passes through this share of the dots. */
const CARVE_DOTS = 0.65;
/** Chance that a tunnel tries to turn before it tries to go straight on. */
const TURN_CHANCE = 0.3;
/** Tunnel starts drawn per cell at most, which bounds carving when no tunnel fits. */
const CARVE_TRIES = 20;
/** Flips the hill climb tries per cell. */
const CLIMB_SWEEPS = 5;

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
 * Measures one loop given as edge states. A cell is inside when an odd number of vertical line
 * edges lie to its left. Each dot on a single loop has two of its edges on it, so the loop passes
 * through as many dots as it has line edges.
 */
export function loopShape(grid: Grid, edges: Uint8Array): LoopShape {
  const W = grid.width;
  const H = grid.height;
  const inside = new Uint8Array(grid.cellCount);
  let area = 0;
  for (let r = 0; r < H; r++) {
    let v = 0;
    for (let c = 0; c < W; c++) {
      if (edges[grid.hEdgeCount + r * (W + 1) + c] === EdgeState.Line) v ^= 1;
      inside[r * W + c] = v;
      area += v;
    }
  }
  let lines = 0;
  for (const s of edges) if (s === EdgeState.Line) lines++;
  let solid = 0;
  for (let r = 0; r < H - 1; r++) {
    for (let c = 0; c < W - 1; c++) {
      const i = r * W + c;
      const n = inside[i] + inside[i + 1] + inside[i + W] + inside[i + W + 1];
      if (n === 0 || n === 4) solid++;
    }
  }
  const blocks = (W - 1) * (H - 1);
  return {
    area: area / grid.cellCount,
    dots: lines / grid.dotCount,
    solid: blocks > 0 ? solid / blocks : 0,
  };
}

/**
 * A random single loop on `grid` that meets `thresholds`, as edge states (`Line` on the loop,
 * `Cross` elsewhere), shaped towards `LOOP_SHAPE_TARGET`.
 *
 * Every cell starts inside, so the loop starts around the edge of the board. A cell may change
 * sides only when its 8 neighbours (off the board counts as outside), read around the ring, hold
 * exactly one run of cells on the side it moves to and that run includes a side neighbour. That
 * keeps the inside and the outside each in one piece with no two cells meeting only at a corner,
 * so the boundary is always one simple loop. A cell leaves the inside only if the inside still
 * meets `thresholds` afterwards.
 *
 * 1. Carve: tunnels of outside one cell wide wind in from the border. A tunnel starts at an inside
 *    cell that touches the outside on exactly one side, and each step moves to a side neighbour
 *    that touches the outside only through the cell just carved, often straight on and sometimes
 *    turning. Carving stops when the loop passes through `CARVE_DOTS` of the dots.
 * 2. Climb: random cells change sides when that brings the loop's inside area, share of dots and
 *    share of solid 2×2 blocks no further from `LOOP_SHAPE_TARGET`.
 * 3. `extra` random outside cells join the inside (fewer if none can); `generate` uses it when it
 *    has to retry.
 *
 * Each step draws a bounded number of times, so this always finishes. Every board works: 1×1 and
 * 1×2 keep the loop around the edge, and 2×2 always ends as an L.
 */
export function generateLoop(
  grid: Grid,
  rng: Rng,
  thresholds: LoopThresholds = LOOP_THRESHOLDS,
  extra = 0,
): Uint8Array {
  const W = grid.width;
  const H = grid.height;
  const cells = grid.cellCount;
  const blocks = (W - 1) * (H - 1);
  const minArea = thresholdCount(thresholds.minCoverage, cells);
  const minRows = thresholdCount(thresholds.minSpan, H);
  const minCols = thresholdCount(thresholds.minSpan, W);
  const inside = new Uint8Array(cells).fill(1);
  const rowCount = new Int32Array(H).fill(W);
  const colCount = new Int32Array(W).fill(H);
  let area = cells;
  let lines = 2 * (W + H);
  let solid = blocks;
  const at = (r: number, c: number) => (r >= 0 && r < H && c >= 0 && c < W ? inside[r * W + c] : 0);

  /** How many side neighbours are on the other side from cell (r, c), or 0 if it cannot change. */
  const flippable = (r: number, c: number): number => {
    const to = inside[r * W + c] ^ 1;
    let runs = 0;
    let sides = 0;
    for (let k = 0; k < 8; k++) {
      const [dr, dc] = RING[k];
      const [pr, pc] = RING[(k + 7) % 8];
      const cur = at(r + dr, c + dc) === to;
      if (cur && at(r + pr, c + pc) !== to) runs++;
      if (cur && k % 2 === 0) sides++;
    }
    return runs === 1 ? sides : 0;
  };
  /** Solid 2×2 blocks among the (up to) four that hold cell (r, c). */
  const solidAround = (r: number, c: number): number => {
    let n = 0;
    for (let br = Math.max(0, r - 1); br <= Math.min(r, H - 2); br++) {
      for (let bc = Math.max(0, c - 1); bc <= Math.min(c, W - 2); bc++) {
        const i = br * W + bc;
        const k = inside[i] + inside[i + 1] + inside[i + W] + inside[i + W + 1];
        if (k === 0 || k === 4) n++;
      }
    }
    return n;
  };
  const span = (counts: Int32Array): number => {
    let first = -1;
    let last = -1;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] === 0) continue;
      if (first < 0) first = i;
      last = i;
    }
    return last - first + 1;
  };
  /** Whether the inside still meets `thresholds` without inside cell (r, c). */
  const canLeave = (r: number, c: number): boolean => {
    if (area - 1 < minArea) return false;
    rowCount[r]--;
    colCount[c]--;
    const ok =
      (rowCount[r] > 0 || span(rowCount) >= minRows) &&
      (colCount[c] > 0 || span(colCount) >= minCols);
    rowCount[r]++;
    colCount[c]++;
    return ok;
  };
  /** Moves cell (r, c) to the other side; `sides` is `flippable(r, c)`. */
  const flip = (r: number, c: number, sides: number): void => {
    const i = r * W + c;
    const before = solidAround(r, c);
    const d = inside[i] ? -1 : 1;
    inside[i] ^= 1;
    solid += solidAround(r, c) - before;
    area += d;
    rowCount[r] += d;
    colCount[c] += d;
    lines += 4 - 2 * sides;
  };
  const cost = (): number =>
    Math.abs(area / cells - LOOP_SHAPE_TARGET.area) +
    Math.abs(lines / grid.dotCount - LOOP_SHAPE_TARGET.dots) +
    Math.max(0, (blocks > 0 ? solid / blocks : 0) - LOOP_SHAPE_TARGET.solid);

  // 1. Carve. A cell can join a tunnel when it is inside, touches the outside on exactly one side,
  // and can leave.
  const canCarve = (r: number, c: number) =>
    at(r, c) === 1 && flippable(r, c) === 1 && canLeave(r, c);
  const carveGoal = CARVE_DOTS * grid.dotCount;
  const maxSteps = Math.max(3, Math.floor((W + H) / 2));
  for (let t = 0; t < CARVE_TRIES * cells && lines < carveGoal; t++) {
    let r = rng.int(H);
    let c = rng.int(W);
    if (!canCarve(r, c)) continue;
    // Head away from the one outside side.
    let d = 0;
    for (let k = 0; k < 4; k++) if (!at(r + RING[2 * k][0], c + RING[2 * k][1])) d = (k + 2) % 4;
    const steps = 2 + rng.int(maxSteps);
    for (let n = 1; ; n++) {
      flip(r, c, 1);
      if (n >= steps || lines >= carveGoal) break;
      const turn = rng.int(2) === 0 ? 1 : 3;
      const order =
        rng.float() < TURN_CHANCE
          ? [(d + turn) % 4, d, (d + 4 - turn) % 4]
          : [d, (d + turn) % 4, (d + 4 - turn) % 4];
      const next = order.find((k) => canCarve(r + RING[2 * k][0], c + RING[2 * k][1]));
      if (next === undefined) break;
      r += RING[2 * next][0];
      c += RING[2 * next][1];
      d = next;
    }
  }

  // 2. Climb. A change that makes the cost worse is undone; moving the cell back has the other
  // `4 − sides` side neighbours on the far side.
  let current = cost();
  for (let t = 0; t < CLIMB_SWEEPS * cells; t++) {
    const r = rng.int(H);
    const c = rng.int(W);
    const sides = flippable(r, c);
    if (sides === 0 || (at(r, c) === 1 && !canLeave(r, c))) continue;
    flip(r, c, sides);
    const next = cost();
    if (next <= current) current = next;
    else flip(r, c, 4 - sides);
  }

  // 3. Extra cells.
  for (let t = 0, left = extra; left > 0 && t < CARVE_TRIES * cells; t++) {
    const r = rng.int(H);
    const c = rng.int(W);
    if (at(r, c) === 1) continue;
    const sides = flippable(r, c);
    if (sides === 0) continue;
    flip(r, c, sides);
    left--;
  }

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

### 2.2 `packages/core/src/loop.test.ts` — replace the whole file with

```ts
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
```

What changed from today's file, so a reviewer can check it: `checkLoop` no longer handles `null`; the FR-8 property also checks `loopShape` against `loopCoverage` and against an independent count of dots that touch a line; tiny boards run 3 seeds (2×2 is an L for every seed, and `extra = 1` gives the square); new tests for `extra` (same loop plus exactly 3 cells), "another seed, another loop", and the three shape-band tests.

### 2.3 `packages/core/src/generate.ts` — four exact edits

1. `export const GENERATOR_VERSION = "1";` → `export const GENERATOR_VERSION = "2";`
2. `  /** Loops grown, counting rejected ones. 1 unless a loop was rejected. */` → `  /** Loops made, counting rejected ones. 1 unless a loop was rejected. */`
3. In `generate`'s doc comment: `` * 1. Grow a random loop that meets the thresholds (`generateLoop`). `` → `` * 1. Make a random winding loop that meets the thresholds (`generateLoop`). ``, and `try a new loop, grown one cell further past the thresholds than the last.` → `try a new loop, with one more cell added after shaping than the last.`
4. Delete the line `    if (solution === null) continue;` (right after `const solution = generateLoop(…)`).

### 2.4 `packages/core/src/generate.test.ts` — replace the whole `describe("generate: golden values (FR-10)", …)` block with

```ts
describe("generate: golden values (FR-10)", () => {
  // Frozen output for GENERATOR_VERSION "2". If one changes, the generator's output changed: bump
  // GENERATOR_VERSION and update these (docs/DECISIONS.md, WT3).
  const cases: [number, number, string, string][] = [
    [1, 1, ".", "1111"],
    [1, 2, ".3", "1211111"],
    [2, 2, "2.2.", "112211121121"],
    [
      5,
      5,
      "0.12....21.1..2.13.21.2.3",
      "222212111212112121222212221221222211212221121211212111211211",
    ],
    [
      6,
      4,
      ".....1..2.31..1....10.1.",
      "1111122112122222112221111222221222212112112211212211122222",
    ],
    [
      7,
      7,
      "....3.11.3.2.33201......22..0..11.1..1.1..3222...",
      "2222122221222111212121122112221121222222121111112111111122221122221111111222222122121211222221212222221112222221",
    ],
    [
      10,
      10,
      "212.2.2.1121...2232.212.3.21.11..2112.32..2.21..223.2..1122..12....22.11..3..12..220..2.11.3..0.31.1",
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

  // Larger boards go through several restore rounds and clipped windows; a digest of the serialized
  // puzzle and its solution keeps the test short.
  test('20x20 seed "golden" (digest)', () => {
    const r = generate({ width: 20, height: 20, seed: "golden" });
    expect(hashSeed(serializePuzzleJson(r.puzzle) + encodeEdges(r.solution))).toEqual([
      1637745618, 2430984644, 1904902262, 590195424,
    ]);
  });
});
```

(The 1×1 and 2×2 solutions happen to be the same as in version 1: the cell's border, and the full square after the L retry.)

### Verify

```sh
bun run check   # core: 230 pass; whole repo green
bun test packages/core/src/loop.test.ts packages/core/src/generate.test.ts   # 28 pass, ~1 s
```

Commit: `feat(core): carve winding loops and climb towards a fixed shape target`

Body (one paragraph): every cell starts inside, one-cell-wide tunnels are carved from the border to 65% of the dots, then a hill climb aims for area 0.5, dots 0.75, solid ≤ 0.2; FR-8 thresholds stay hard floors; GENERATOR_VERSION 2.

## Step 3 — Benchmark (not in the gate)

### 3.1 `packages/core/bench/generate.ts` — replace the whole file with

```ts
/**
 * Generator benchmark (not part of `bun run check`). Run: `bun run --cwd packages/core bench:generate`.
 *
 * 1. Loop shape over many seeds per size: the mean, smallest and largest inside area, share of dots
 *    on the loop and share of 2×2 blocks all one colour (`loopShape`; targets in DECISIONS, WT13),
 *    and the share of loops that meet the default thresholds (PRD §10, target ≥ 95%).
 * 2. Generation time per size (NFR-1: p95 under 5 s up to 30×30), first-attempt rate (loops whose
 *    full clue set the rules solve), clue density, clues put back, and `verify` on every result.
 * Pass `--quick` to skip 100×100.
 */
import { generate } from "../src/generate.ts";
import { createGrid } from "../src/grid.ts";
import { generateLoop, LOOP_THRESHOLDS, loopShape, thresholdCount } from "../src/loop.ts";
import { createRng } from "../src/rng.ts";
import { loopCoverage } from "../src/test-support/loops.ts";
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
const SHAPE_KEYS = ["area", "dots", "solid"] as const;
for (const [w, h, count] of LOOP_SIZES) {
  const grid = createGrid(w, h);
  const minArea = thresholdCount(LOOP_THRESHOLDS.minCoverage, w * h);
  const minRows = thresholdCount(LOOP_THRESHOLDS.minSpan, h);
  const minCols = thresholdCount(LOOP_THRESHOLDS.minSpan, w);
  const sum = { area: 0, dots: 0, solid: 0 };
  const lo = { area: 1, dots: 1, solid: 1 };
  const hi = { area: 0, dots: 0, solid: 0 };
  let ok = 0;
  for (let n = 0; n < count; n++) {
    const loop = generateLoop(grid, createRng(`loop-${n}`));
    const { area, rows, cols } = loopCoverage(grid, loop);
    if (area >= minArea && rows >= minRows && cols >= minCols) ok++;
    const shape = loopShape(grid, loop);
    for (const k of SHAPE_KEYS) {
      sum[k] += shape[k];
      lo[k] = Math.min(lo[k], shape[k]);
      hi[k] = Math.max(hi[k], shape[k]);
    }
  }
  const stats = SHAPE_KEYS.map(
    (k) => `${k}=${(sum[k] / count).toFixed(3)} [${lo[k].toFixed(2)}–${hi[k].toFixed(2)}]`,
  );
  console.log(
    `loops ${w}×${h}: n=${count} ${stats.join(" ")} accepted=${((100 * ok) / count).toFixed(1)}%`,
  );
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

### Verify

```sh
bun run check                                         # still green (bench is type-checked)
bun run --cwd packages/core bench:generate --quick    # ~20 s
bun run --cwd packages/core bench:generate            # ~2 min (3 × 100×100 at ~31 s)
```

Expect `accepted=100.0%` on every `loops` line, means near the "Measured" table (10/20/40: area 0.500, dots 0.75–0.77, solid 0.19–0.24), every `verify` all `unique`, 30×30 p95 well under 5000 ms. Optional: `bun run bench:jobs` (server, real worker threads, NFR-1 budgets; it also generates one 100×100 up front, ~31 s). Put the full-run output in the final report.

Commit: `chore(core): print loop shape in the generator benchmark`

## Step 4 — Docs

### 4.1 `README.md` — one exact edit

In the Scripts table, replace `| Time puzzle generation on 7×7 to 100×100 boards and measure loop acceptance (not part of the check) |` with `| Time puzzle generation on 7×7 to 100×100 boards and measure loop shape and acceptance (not part of the check) |`.

The status paragraph only says "a generator that makes a puzzle with exactly one solution from a seed", so it needs no change.

### 4.2 `docs/DECISIONS.md`

1. In the entry headed ``## 2026-10-25 · WT3 `core-generator` · Loop thresholds and how loops grow``, add a fourth bullet after its **Reason** line:

```
- **Superseded:** how loops are built is replaced by WT13 "Windy loops: carve tunnels, then climb towards a fixed shape" (below). The thresholds still hold, as hard floors.
```

2. Append at the end of the file (after a blank line). If your full benchmark numbers differ noticeably, use yours:

```markdown
## 2026-10-26 · WT13 `windy-loops` · Windy loops: carve tunnels, then climb towards a fixed shape
- **Question:** Generated loops were compact blobs (20×20: 45% of the cells inside, the loop through 21% of the dots, 79% of the 2×2 blocks of cells all one colour), while book puzzles have long winding loops that fill the board. How should `generateLoop` build loops, and what shape should it aim for?
- **Decision:** Every cell starts inside. Tunnels of outside one cell wide wind in from the border (each tunnel cell touches the outside on exactly one side) until the loop passes through 65% of the dots. Then a hill climb tries 5 flips per cell, moving random cells either way, and keeps a flip when the cost does not go up. The cost is the sum of the gaps from `LOOP_SHAPE_TARGET`: inside area 0.5, dots on the loop 0.75, and solid 2×2 blocks 0.2, which counts only above it. Both moves use the old ring test (mirrored for carving), so the boundary is always one simple loop. A cell leaves the inside only if `LOOP_THRESHOLDS` still hold, so FR-8's floors are guaranteed and every size works: 1×1 and 1×2 keep the loop around the edge, and 2×2 is an L, which `generate` turns into the square on its retry. The target is a fixed core constant, the same for every puzzle; shape is not a difficulty knob (user, 2026-10-26). `loopShape(grid, edges)` measures any loop. `GENERATOR_VERSION` is now `"2"`. Acceptance bands, checked in the gate at 10×10, 20×20 and 40×40 as means over 30 seeds: area 0.45–0.55, dots 0.70–0.80, solid at most 0.30.
- **Reason:** Measured with `bench:generate` (1000 loops per size): area 0.500 at every size from 10×10 up; dots 0.754, 0.761, 0.764 and 0.754, and solid 0.19, 0.21, 0.23 and 0.25, at 10×10, 20×20, 40×40 and 100×100. 100% of loops met the thresholds on every size, and a loop takes at most 2 ms up to 40×40 and 11 ms at 100×100. Alternatives tried: carving alone leaves too much inside (area 0.66–0.74, because one-cell tunnels cannot thin the inside without overshooting the dots; carving until no tunnel fits gives a maze through 98% of the dots); simulated annealing with a temperature, with or without carving, hits the numbers but turns the tunnels into speckled noise; carving to 60% or 70% before the climb also passes, but 70% puts 40×40 dots near the 0.80 ceiling and 60% gives more solid blocks. Generation got slower and kept more clues, because today's rules need more of them on winding loops: p95 13 ms at 10×10, 89 ms at 20×20, 332 ms at 30×30 (NFR-1 allows 5 s) and 975 ms at 40×40, about 31 s at 100×100 (was 13 s; the worker's limit is 60 s); 49–59% of cells keep a clue (was 32–42%); every result verified `unique`. WT14–18 add rules to bring clue density down.
```

### Verify

```sh
bun run check
```

Commit: `docs: record how windy loops are built and what they cost`

## Final checks

```sh
bun run check
git log --oneline main..HEAD    # 4 commits (plus the plan commit, if the orchestrator commits it)
git status                      # clean
```

## Acceptance criteria

| Id | Criterion | Where checked |
|---|---|---|
| FR-8 | Every loop is one simple loop enclosing ≥ 40% of cells with a bounding box ≥ 80% of rows and columns, on every size including 1×1, 1×2, 2×2 and thin boards; thresholds still exported and overridable | `loop.test.ts`: fast-check 200 runs over 1–30 × 1–30; large/thin boards (100×100, 100×1, 1×100, 100×3); tiny boards; custom thresholds; `generate.test.ts` `checkResult` (independent `loopCoverage`) |
| FR-8 (shape) | 10/20/40 means over 30 seeds: area 0.45–0.55, dots 0.70–0.80, solid ≤ 0.30; target is a fixed exported constant | `loop.test.ts` shape-band tests; `LOOP_SHAPE_TARGET` frozen test; bench table |
| FR-9 | Unchanged: clues agree with the solution, result `unique` | `generate.test.ts` properties and brute force ≤ 4×4 pass with the new loops |
| FR-10 | Same seed ⇒ same loop and puzzle; no clock; version bumped to "2"; goldens updated | `loop.test.ts` determinism; `generate.test.ts` goldens (using `GENERATOR_VERSION`) and determinism property; no `Date`/`performance` in `src/` (typecheck) |
| NFR-1 | Generation p95 ≤ 30×30 under 5 s | bench: 30×30 p95 ≈ 0.33 s |
| NFR-3 | Unit + property tests in the gate | +6 tests, about 0.35 s added |
| §10 | ≥ 95% of loops meet thresholds | bench: 100% on all sizes (by construction) |
| `loopShape` | Exported and correct | hand-drawn cases; agreement with `loopCoverage` and a dot count in the property |

## Unresolved questions (resolved by assumption; the orchestrator may override)

- Area is pinned at exactly 0.500 from 10×10 up: the climb drives it to the target, so puzzles vary in shape, not in how much is inside. Assumed fine (the targets are means). A later WT could aim each loop at a seeded area in 0.45–0.55.
- 100×100 generation goes from ~13 s to ~31 s (more clues to test on winding loops). That is inside the worker's 60 s limit, with about 2× margin; WT18's retune should look at it. No server change here.
- Clue density rises to 49–59% (the prototype predicted ~62%). Expected; WT14–18 address it.
- Annealing became a strict hill climb (no temperature): measured simpler, and it keeps the tunnels.
- `generateLoop` returns `Uint8Array` (never `null`) now that the thresholds hold by construction; the `extra` parameter keeps its retry meaning.
- Field name `solid` for "2×2 blocks all one colour".
- Daily puzzles already stocked as version "1" stay as they are; new ones are "2". Nothing to migrate: `meta.generator` is stored per puzzle.
