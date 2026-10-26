# WT15 `clue-removal` — implementation plan

Branch `feat/clue-removal`, worktree `/home/jhonnold/projects/loophole-wt/clue-removal`. PRD: FR-9 (clues removed while the puzzle stays unique), FR-10 (deterministic per seed and version), FR-11 (large grids are background jobs with progress and a timeout), NFR-1 (generation time; relaxed here by user decision), NFR-3 (unit and property tests). Roadmap: WT15 row and Decisions in `~/.claude/plans/read-through-the-prd-noble-squirrel.md` (targets: generated clue density at 20×20 ≤ 0.45, ideally the whole-board solver floor of about 0.42).

## Goal

Generated puzzles keep 51–57% of cells clued, while today's rules allow about 40–42% (WT14, `bench:clue-gaps`). The cause is `generate`'s removal step: the 7×7-window test over-removes, then the restore step puts back far too much. Replace it with a removal that keeps exactly the clues the rules need over the whole board, fast enough for 100×100:

1. **Removal judged by the whole board, from nested block bases.** A clue goes when the rules still solve the *whole* puzzle without it. Each test starts from a sound *base* (the edges the rules decide with every clue of its 2×2 block hidden) instead of an empty board, and bases nest (board halved, longer side first), so the tests reach exactly what solving from scratch would, at a fraction of the cost.
2. **Engine fix that makes (1) exact.** The premature-loop check was not re-run at a path's far ends when a line joined two paths. That made lookahead depend on the order of deductions, so a test from a base could solve a puzzle that the solver from scratch cannot. One `if` in `Engine.set`.
3. **The rule solver is a parameter.** Removal, the first full-clue check and the restore safeguard all take one `RuleSolver` function, so a difficulty level can later pass a solver limited to its rules (roadmap WT20). No levels are built.
4. **Generation time relaxed (user decision, 2026-10-26).** PRD NFR-1 text, `GENERATE_TIMEOUT_MS` default 60 s → 30 min, job-duration histogram buckets, `bench:jobs` budgets, the auth end-to-end config.
5. `GENERATOR_VERSION` "2" → "3", goldens, new tests (every kept clue is needed; density band), DECISIONS entries with before/after numbers.

Out of scope: new rules (WT16–18), `verify` speed (WT19; this WT must not slow it, and doesn't), difficulty levels (WT20–21), a per-user limit on generation jobs (see "Consequences").

## Measured (this machine, 16 cores, Bun 1.3.13; the code in this plan)

### `bench:generate`, before (main) → after

n = 20 (10 at 40×40, 3 at 100×100), seeds `bench-<n>`. Every result verified `unique` before and after; first attempt 100% everywhere.

| Size | p95 before → after | median after | clues before → after | restored before → after |
|---|---|---|---|---|
| 7×7 | 11 ms → 18 ms | 7 ms | 48.9% → 40.1% | 10.7% → 0.0% |
| 10×10 | 14 ms → 39 ms | 24 ms | 50.8% → 40.3% | 14.2% → 0.0% |
| 20×20 | 98 ms → 593 ms | 345 ms | 56.0% → **40.5%** | 19.9% → 0.0% |
| 30×30 | 346 ms → 2.75 s (max 3.6 s) | 2.09 s | 56.7% → 40.9% | 20.4% → 0.0% |
| 40×40 | 964 ms → 10.0 s | 6.6 s | 57.9% → 41.2% | 22.0% → 0.0% |
| 100×100 | 34.1 s → 1133 s (max of 3) | 345 s | 59.1% → 42.3% | 23.0% → 0.0% |

(The "after" 30×30 and 40×40 lines ran next to `bench:clue-gaps`, so they are slightly pessimistic.) 100×100 has a long tail: `bench-0`/`bench-1` took 327–359 s in separate runs (4 at a time) and `bench-2` 1133 s (19 min); six more seeds (`bench-3`…`bench-8`, 7 runs at a time) took 351–545 s, 41.5–42.8% clued. So about 6–9 minutes, 1 in 9 near 19 minutes. `bench-2` is slower on every test, not on one (its trace is evenly slow from the first 10% on): its bases leave larger regions open (see "Why tests cost what they cost"). With block size 4 it took 789 s (other seeds 445–522 s), so the loop is the hard part, not the block size; a re-run with block 2 took 1150 s next to other jobs. Thin boards (test seeds `medium-<w>x<h>`): 1×100 32 ms, 100×2 136 ms, 30×15 292 ms, 100×10 1.7 s.

Target met: 20×20 mean 0.405 (≤ 0.45), at the whole-board solver floor (WT14: 0.422 on other seeds; here the floor *is* the result, see next table).

### `bench:clue-gaps`, before (WT14 baseline, re-run on main) → after

| Size | clues | restored | removable | gap | needed | unknown | solver floor | verifier floor |
|---|---|---|---|---|---|---|---|---|
| 5×5 (100) | 52.3% → 41.3% | 10.5% → 0.0% | 49.9% → **0.0%** | 1.4% → 1.2% | 48.7% → 98.8% | 0 → 0 | 41.2% → 41.3% | 40.7% → 40.9% |
| 7×7 (100) | 51.2% → 40.3% | 12.5% → 0.0% | 51.2% → 0.0% | 3.9% → 2.4% | 44.9% → 97.6% | 0 → 0 | 40.3% → 40.3% | 39.0% → 39.6% |
| 10×10 (50) | 54.3% → 40.2% | 16.3% → 0.0% | 68.2% → 0.0% | 3.6% → 5.0% | 28.1% → 94.3% | 0 → 15 | 40.2% → 40.2% | 39.0% → 38.8% |
| 15×15 (10) | 55.0% → 39.2% | 18.2% → 0.0% | 76.8% → 0.0% | 1.9% → 1.8% | 21.3% → 88.4% | 0 → 86 | 40.7% → 39.2% | 40.1% → 38.5% |
| 20×20 (10) | 56.5% → 41.7% | 19.1% → 0.0% | 74.8% → 0.0% | 4.8% → 2.8% | 20.4% → 75.6% | 0 → 359 | 42.2% → 41.7% | – |

`removable` 0.0% everywhere: no kept clue can go with the rules still solving the puzzle, so generated density equals the solver floor. The verifier floor stays about 1–1.5 points lower (rules gaps, WT16–18's job). Sparser puzzles make the verifier's 10 000-node budget run out more often when classifying (`unknown`), and the run takes about 3 minutes (20×20 line 110 s, was 18 s).

### Engine fix: effect and cost

- Corpus (`clue-gaps.json`, 36 boards the solver was stuck on): the solver now solves 3 (`clue-gaps-5-81#5`, `clue-gaps-10-8#26`, `clue-gaps-10-8#27`); the verifier needs 669 search nodes for the corpus instead of 703.
- `verify` time, same puzzles both engines, median of 30 alternating runs: corpus 17.1 → 16.3 ms; 30 windy 8×8 boards with 60% of clues (many solutions, 1950 nodes) 4.9 → 5.0 ms; 10 windy 12×12 with 65% (1450 nodes) 5.7 → 5.7 ms; v2-generated 20×20 (10) 21.1 → 20.4 ms, 40×40 (3) 49.1 → 46.0 ms. No slowdown. (`bench` itself prints sub-millisecond medians that vary ±20% run to run, and its "minimal" puzzles depend on `solve`, so they change with the fix; its numbers are not comparable before/after.)
- A broader first version (queue both new path ends after every line) cost about 10% on the corpus; the version here queues them only when they are neighbours, which is the only case the rule can fire.
- Hint traces of generated puzzles: 20×20 662 → 693 steps (58 → 59 KB), 40×40 2599 → 2642 steps; the share of `lookahead` steps rises from 7% to 12–13% (sparser puzzles are harder).
- Step logs of the web fixtures (`tiny-5`, `small-7`, `medium-10`): same status, step count and set of rules; `tiny-5` identical, `small-7` differs from step 85 of 91, `medium-10` from step 35 (order of two equivalent deductions). `apps/web/tests/hint.e2e.ts` only checks the set of rules `small-7` uses, which is unchanged.

### Exactness checks (scratch, all passed)

- Removal tests from bases vs from scratch, run side by side on every test (with the engine fix): 20×20 30 seeds × blocks 4 and 8 (24 000 tests), 30×30 6 seeds × blocks 4 and 8 (10 800): 0 disagreements. 40×40 seeds 0–5 (block 4), including the seed that broke without the fix: all solved from scratch at the end, 41.0–43.1% clued, nothing restored.
- Every kept clue is needed (taking it out leaves the rules stuck): 400 generated boards from 1×1 to 15×15, 9684 kept clues, 0 removable, 0 restored.
- The window prefilter (below) gave the same puzzles as the plain version (hash-compared, 20×20, 40×40, 60×60), which it can only do if the tests are exact.
- The broad and the final (neighbours-only) engine fix give identical generated puzzles (128 boards, 5×5 to 30×30).

### Alternatives measured and rejected

| Variant | Result |
|---|---|
| Whole-board greedy, solve from scratch per clue (WT14 floor) | 20×20: 42.0%, 1.2 s median. 30×30 ~7 s; 100×100 hours. |
| Nested bases **without** the engine fix | 20×20 and 30×30 exact, but at 40×40 seed `bench-2` (block 4) one test from a base solved a board the solver from scratch could not; every later test then failed and the puzzle kept **70.6%** of its clues (final solve stuck, restore needed). Root cause: the premature-loop check (below). |
| Block size 1 / 2 / 4 / 8 / 12 (largest block side before halving stops) | Density the same (exact tests; only the order differs). Time at 40×40 (n=6, median/p95): 1 → 7.1/8.4 s, 2 → 5.8/7.5 s, 4 → 6.0/10.7 s. An earlier run, 4 processes at once, 30×30 n=10: 4 → 1.9/3.6 s, 8 → 3.3/5.1 s, 12 → 3.4/5.0 s; 40×40 median 4 → 6.8 s, 8 → 8.0 s, 12 → 19.6 s. 100×100: block 2 327–359 s, block 4 445–522 s, block 8 > 11 min (stopped). **2 chosen.** |
| Flat 8×8 tiles, each base solved from scratch | 40×40 7.1 s median, same density; slower than nesting, and 100×100 would need ~150 whole-board solves for bases alone. |
| Window prefilter: before each test, run the old 7×7-window test (edges outside from the solution); if even that gets stuck, keep the clue without the whole-board test | Exact (identical output) and skips 50–70% of failing tests, but saves only 3% (60×60: 36.8 → 35.6 s): failing tests are not where the time goes. Not worth the code. |
| Why tests cost what they cost | Profile (40×40): 29% `parity`, 12% `connected` (both O(edges) per pass), the rest tier-1 rules inside lookahead probes. On a finished sparse puzzle, hiding one 2×2 block leaves 180–850 edges open, and re-deriving them takes 50–90 lookahead deductions, each followed by a full parity pass. Faster engine passes (WT19: incremental parity) would speed generation up directly. |

## What was found (for the DECISIONS entries)

**Why removal was slow and over-generous.** The old test solved a 7×7 window with every edge outside taken from the solution, which assumes knowledge the solver does not have; the whole-board solve then got stuck and the restore step put back clues near open edges in bulk (16–23% of cells). Testing against the whole board instead keeps exactly the clues the rules need.

**Why the whole-board test can start from a base.** Let *Q* be the current clues minus every clue of a block *B*, and *E* the edges the rules decide on *Q*. The rules are sound, so *E* holds in every solution of *Q*, hence in every solution of any puzzle with more clues, in particular the current puzzle minus one clue *c* of *B*. Starting `solve` from *E* is therefore sound (a `solved` result still proves uniqueness), and because the rules only add to what they know (they are monotone), the fixpoint reached from *E* is the one reached from an empty board. So the test is exact, and the restore step becomes a safeguard. Nesting: a half's base is solved from its parent's base, which hid a superset of its clues; clues only change inside the part being processed, so the parent's base stays sound for every later child.

**The engine bug the bases exposed.** `Engine.set` keeps, for each end of a line path, the dot at its other end (`mate`). When a line joins two paths, the joined path's ends are the far ends of the two old paths, dots that no change touched, so they are not queued. If those two ends are neighbours, the edge between them would close the loop early and the premature-loop rule should cross it, but it only runs at queued dots. At the root this is harmless (`load` queues everything), but inside a lookahead probe it means a contradiction goes unseen, depending on the order deductions came in. The fix queues both new ends when they are neighbours.

## Design

### Files

| File | Change |
|---|---|
| `packages/core/src/engine.ts` | `set`: queue the new path ends when they are neighbours (one `if`) |
| `packages/core/src/solver.test.ts` | regression test for the engine fix |
| `packages/core/src/clue-gaps.test.ts` | `SOLVED` gets the 3 newly solved ids |
| `packages/core/src/generate.ts` | `RuleSolver` seam; nested-block removal; restore takes the solver; version "3" |
| `packages/core/src/generate.test.ts` | goldens; "every clue is needed" test; density band test |
| `packages/core/bench/generate.ts`, `packages/core/bench/clue-gaps.ts` | doc comments only |
| `apps/server/src/config.ts`, `apps/server/src/config.test.ts` | `GENERATE_TIMEOUT_MS` default 1 800 000 (30 min) |
| `apps/server/src/adapters/metrics/prometheus.ts` | job-duration buckets up to 1800 s |
| `apps/server/scripts/bench-jobs.ts` | new NFR-1 budgets, 30-minute limit, one 100×100 generation reused for the verification |
| `apps/web/playwright.auth.config.ts` | `DAILY_DAYS_AHEAD` "1" |
| `docs/PRD.md` | NFR-1 text |
| `docs/DECISIONS.md` | 3 new WT15 entries; notes on the WT3 clue-removal and WT6 limits entries |
| `docs/TESTING.md` | `bench:jobs` line; auth e2e `DAILY_DAYS_AHEAD` |
| `README.md` | `bench:clue-gaps` row unchanged; `bench:jobs` row: duration hint (one exact edit) |

`index.ts`, `solver.ts`, `verify.ts`, `rules.ts`, `run-task.ts`, `daily-stock-manager.ts`, the API and the web app do not change. `GenerateOptions`, `GenerateProgress`, `GenerateStats` and `GenerateResult` keep their shapes.

### Algorithm (`removeClues`)

```
total = number of clues in the full set; done = 0
visit(region = whole board, base = all edges unknown)

visit(region, base):
  if region.height <= BLOCK_SIZE and region.width <= BLOCK_SIZE:        # a block (BLOCK_SIZE = 2)
    order = the region's cells that have a clue, row by row, then shuffled (seeded)
    for each cell i in order:
      hide clue i; if rules(puzzle, base) is not "solved": put it back
      done++, onProgress({done, total})
    return
  split region in half: rows if height >= width (top half = rows top..mid-1, mid = (top+bottom) >> 1), else columns
  if rng.int(2) == 1: swap the two halves' order
  for each half, in that order (the second only after the first is fully processed):
    childBase = rules(puzzle with every clue of the half hidden, starting from base).edges
    visit(half, childBase)
```

- `rules(puzzle, initial)` is the `RuleSolver`; `generate` passes `ALL_RULES = (p, initial) => solve(p, { initial })`.
- The child base is computed when its turn comes, after the earlier half's removals, from the parent's base (still sound, see above). Contradiction is impossible (the puzzle with fewer clues still has the solution), so the status of a base solve is ignored.
- Randomness: one `rng.int(2)` per split and one shuffle per block, all from the generate seed, no clock (DECISIONS WT2).
- A board up to 2×2 is a single block, so its tests start from an empty board: plain whole-board greedy.
- Progress: one call per test, `total` = clues in the full set = `stats.checks`, as before. Bases make no calls; they interleave with the tests (depth first), so the bar moves steadily, though not at an even pace (one 100×100 run with block 4 spent 40% of its time on the last 10% of tests; the slow seed `bench-2` with block 2 was evenly slow throughout). `done === total` is followed by one whole-board solve (about 1 s at 100×100), as before; `run-task.ts`'s 0.9 share is unchanged.
- The restore step (step 4) is kept unchanged apart from taking `rules`: it is the safeguard if the rules ever turn out not to be monotone. It put back nothing in any run above.

### Gate cost

Core tests: +3 (regression, needed, density). `generate.test.ts` gets slower because 10×10 and 20×20 generation does (property test 60 runs ×2 up to 10×10; 20×20 golden digest ~0.7 s; 30×15 0.3 s; 100×2 0.14 s); "every clue is needed" ~0.2 s; density band ~0.5 s. Whole `bun run check`: see Final checks (measured when validating this plan: all green, `bun test` about 11 s for 821 tests).

### Consequences to record (not changed here)

- One worker runs one job at a time. A 100×100 generation now holds it for 6–19 minutes (was about 30 s), so verifications for submissions and other jobs wait behind it; anyone may queue generations (cap 100 queued jobs), so the queue could be held for hours. A per-user or per-size limit, or a second worker, is left for later (orchestrator to decide).
- When the worker starts with an empty stock it generates 3 days × (7, 10, 20, 40): about 30–45 s before other jobs (was a few seconds). Daily stocking itself depends on no generation time: `stock()` runs every minute and skips queued and running jobs. Nothing in `daily-stock-manager.ts` changes.

## Rules for the implementer

- Run `export PATH="$HOME/.bun/bin:$PATH"` in every shell. Work in `/home/jhonnold/projects/loophole-wt/clue-removal`. Run `bun install --frozen-lockfile` once first if `node_modules` is missing. Do not clone the repo anywhere (`/tmp` is a small tmpfs).
- Copy code blocks **exactly**: they were formatted with Biome and produced the golden values and numbers above. If a golden value differs, you did not copy something exactly; fix the code, never the golden.
- No `console`, `Date`, `performance` or Bun APIs in `packages/core/src/` outside tests and `test-support`.
- `bun run check` must pass after every step; commit after each step with the given message (conventional commits). Do not push.
- Benchmarks are not part of the gate. Step 2 says which to run; the 100×100 part of `bench:generate` (3 puzzles) takes 20–40 minutes; run it in the background.

## Step 1 — Engine: check for an early loop at a joined path's far ends

### 1.1 `packages/core/src/engine.ts` — one exact edit in `set`

Replace

```ts
    mate[ea] = eb;
    mate[eb] = ea;
    plen[ea] = len;
    plen[eb] = len;
    return true;
  }
```

with

```ts
    mate[ea] = eb;
    mate[eb] = ea;
    plen[ea] = len;
    plen[eb] = len;
    // The path's ends may be dots no change touched. If they are next to each other, the edge
    // between them would close the path early: queue them for the premature-loop check.
    const gap = Math.abs(ea - eb);
    const W1 = grid.width + 1;
    if (gap === W1 || (gap === 1 && Math.floor(ea / W1) === Math.floor(eb / W1))) {
      this.enqueue(grid.cellCount + ea);
      this.enqueue(grid.cellCount + eb);
    }
    return true;
  }
```

(`grid` is already destructured at the top of `set`. Dots are numbered row by row with `width + 1` per row, docs/FORMAT.md; two dots are neighbours when they differ by one row, or by one column in the same row.)

### 1.2 `packages/core/src/solver.test.ts` — add one test

In `describe("solve", …)`, directly after the test `"without lookahead it can get stuck where lookahead solves"`, insert:

```ts
  test("checks for an early loop at both ends of a path that a line joined", () => {
    // clue-gaps-5-81#5 from the WT14 corpus. Joining two paths makes their far ends the new path's
    // ends without queueing them; lookahead then missed a loop closing there too early, and the
    // solver got stuck.
    expect(solve(puzzle(5, 5, ".3.22.1.1.3..2..222132.10")).status).toBe("solved");
  });
```

### 1.3 `packages/core/src/clue-gaps.test.ts` — one exact edit

Replace

```ts
/**
 * Ids of the corpus entries the rule solver solves. Empty when the corpus was made (WT14): every
 * entry was stuck. A solver change that solves more adds their ids, like a golden value; a missing
 * id means a rule got weaker.
 */
const SOLVED: string[] = [];
```

with

```ts
/**
 * Ids of the corpus entries the rule solver solves. Empty when the corpus was made (WT14): every
 * entry was stuck. A solver change that solves more adds their ids, like a golden value; a missing
 * id means a rule got weaker. WT15's premature-loop fix solves the first three.
 */
const SOLVED: string[] = ["clue-gaps-5-81#5", "clue-gaps-10-8#26", "clue-gaps-10-8#27"];
```

### 1.4 Generator version and goldens (the fix changes which clues the generator keeps)

`packages/core/src/generate.ts`: replace `export const GENERATOR_VERSION = "2";` with `export const GENERATOR_VERSION = "3";`.

`packages/core/src/generate.test.ts`:

- Replace `// Frozen output for GENERATOR_VERSION "2". If one changes, the generator's output changed: bump` with `// Frozen output for GENERATOR_VERSION "3". If one changes, the generator's output changed: bump`.
- In the 20×20 digest test replace the line

```ts
      1637745618, 2430984644, 1904902262, 590195424,
```

with

```ts
      3043905915, 124454878, 3022035990, 3169070646,
```

The 1×1 … 10×10 cases do not change in this step (checked). Step 2 changes them all; version "3" covers both steps, since nothing is released in between.

### Verify

`bun run check` green. `bun test packages/core/src/clue-gaps.test.ts packages/core/src/solver.test.ts` passes.

Commit: `fix(core): check for an early loop at both ends of a joined path`

## Step 2 — Generator: whole-board removal from nested block bases (FR-9, FR-10)

### 2.1 `packages/core/src/generate.ts` — replace the whole file with

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
export const GENERATOR_VERSION = "3";

/**
 * Clue removal tests run block by block; a block is at most this many cells on a side. Each block's
 * tests start from the edges the rules decide with every clue in the block hidden.
 */
const BLOCK_SIZE = 2;
/** Clues put back in one round are more than this many rows or columns apart. */
const RESTORE_SPACING = 2;
/** Loops tried before giving up. Only 2×2 and rare small boards need a second; this bounds the loop. */
const MAX_ATTEMPTS = 100;

/**
 * Solves `puzzle` from `initial` (every edge unknown when left out). Generation judges every clue
 * removal by one of these, so the rules it allows decide which clues can go.
 */
type RuleSolver = (puzzle: Puzzle, initial?: Uint8Array) => SolveResult;

/** Every rule, lookahead included. */
const ALL_RULES: RuleSolver = (puzzle, initial) => solve(puzzle, { initial });

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
  /** Loops made, counting rejected ones. 1 unless a loop was rejected. */
  readonly attempts: number;
  readonly clueCount: number;
  /** Clue removal tests made. */
  readonly checks: number;
  /** Clues put back because the whole puzzle got stuck without them (a safeguard; normally 0). */
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
 * 1. Make a random winding loop that meets the thresholds (`generateLoop`).
 * 2. Give every cell its clue (a cell with 4 lines gets none). If the rule
 *    solver cannot solve that (two loops can share every clue, as the L shapes on a 2×2 board do),
 *    try a new loop, with one more cell added after shaping than the last.
 * 3. In a seeded order, block by block, remove each clue if the rules still solve the whole puzzle
 *    without it (`removeClues`).
 * 4. Solve the whole puzzle from scratch. While it gets stuck, put back removed clues next to the
 *    open edges, spread out, and solve again. A safeguard: step 3's tests reach the same end as
 *    solving from scratch, so this has not been needed in the benchmarks.
 *
 * The result is solved by the rules alone, which proves it has one solution (PRD §9). Uses only the
 * seeded generator and no clock, so it is deterministic. Throws `RangeError` for a bad size, seed or
 * thresholds.
 */
export function generate(options: GenerateOptions): GenerateResult {
  const { width, height, seed, onProgress } = options;
  const thresholds = options.thresholds ?? LOOP_THRESHOLDS;
  // Each field by name, so a partial object (say, parsed JSON) fails here too.
  for (const name of ["minCoverage", "minSpan"] as const) {
    const share = thresholds[name];
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
    const full = deriveClues(grid, solution).map((k) => (k === 4 ? NO_CLUE : k));
    const clues = full.slice();
    const work: Puzzle = { grid, clues };
    if (ALL_RULES(work).status !== "solved") continue;
    const checks = removeClues(work, rng, ALL_RULES, onProgress);
    const { result, restored } = restoreClues(work, full, rng, ALL_RULES);
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

/**
 * Step 3. Removes each clue whose removal leaves the puzzle solved by `rules`, in a seeded order,
 * block by block. Changes `puzzle.clues`; returns the tests made, one per clue of the full set.
 *
 * Solving the whole board from scratch for every test costs too much on large boards, so a test
 * starts from its block's base: the edges `rules` decide with every clue of the block hidden. Every
 * puzzle that has all the clues outside the block has those edges in all its solutions, so starting
 * there is sound, and since the rules only add to what they know, a test ends where solving from
 * scratch would. Bases nest: the board is halved, the longer side first, down to blocks, and each
 * half's base is solved from its parent's once the halves before it are done, so it only has to work
 * out what the parent's base left open.
 */
function removeClues(
  puzzle: Puzzle,
  rng: Rng,
  rules: RuleSolver,
  onProgress: GenerateOptions["onProgress"],
): number {
  const { grid, clues } = puzzle;
  let total = 0;
  for (const k of clues) if (k !== NO_CLUE) total++;
  let done = 0;
  const visit = (top: number, left: number, bottom: number, right: number, base: Uint8Array) => {
    if (bottom - top <= BLOCK_SIZE && right - left <= BLOCK_SIZE) {
      const order = cellsIn(grid, top, left, bottom, right).filter((i) => clues[i] !== NO_CLUE);
      shuffle(order, rng);
      for (const i of order) {
        const k = clues[i];
        clues[i] = NO_CLUE;
        if (rules(puzzle, base).status !== "solved") clues[i] = k;
        done++;
        onProgress?.({ done, total });
      }
      return;
    }
    const parts: [number, number, number, number][] = [];
    if (bottom - top >= right - left) {
      const mid = (top + bottom) >> 1;
      parts.push([top, left, mid, right], [mid, left, bottom, right]);
    } else {
      const mid = (left + right) >> 1;
      parts.push([top, left, bottom, mid], [top, mid, bottom, right]);
    }
    if (rng.int(2) === 1) parts.reverse();
    for (const [t, l, b, r] of parts) {
      visit(t, l, b, r, hiddenBase(puzzle, rules, cellsIn(grid, t, l, b, r), base));
    }
  };
  visit(0, 0, grid.height, grid.width, new Uint8Array(grid.edgeCount));
  return done;
}

/** The edges `rules` decide from `initial` with the clues of `cells` hidden. Restores the clues. */
function hiddenBase(
  puzzle: Puzzle,
  rules: RuleSolver,
  cells: number[],
  initial: Uint8Array,
): Uint8Array {
  const { clues } = puzzle;
  const kept = cells.map((i) => clues[i]);
  for (const i of cells) clues[i] = NO_CLUE;
  const { edges } = rules(puzzle, initial);
  cells.forEach((i, n) => {
    clues[i] = kept[n];
  });
  return edges;
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
  rules: RuleSolver,
): { result: SolveResult; restored: number } {
  const { grid, clues } = puzzle;
  let restored = 0;
  for (;;) {
    const result = rules(puzzle);
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

/** Cells in rows `top` to `bottom - 1` and columns `left` to `right - 1`, row by row. */
function cellsIn(grid: Grid, top: number, left: number, bottom: number, right: number): number[] {
  const cells: number[] = [];
  for (let r = top; r < bottom; r++) {
    for (let c = left; c < right; c++) cells.push(r * grid.width + c);
  }
  return cells;
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

### 2.2 `packages/core/src/generate.test.ts` — exact edits

**(a) Imports.** Add `import { solve } from "./solver.ts";` on its own line directly after `import { hashSeed } from "./rng.ts";` (Biome keeps imports sorted by path: `./rng.ts`, `./solver.ts`, `./test-support/loops.ts`, `./verify.ts`).

**(b) Golden cases.** Replace the four entries `[5, 5, …]`, `[6, 4, …]`, `[7, 7, …]`, `[10, 10, …]` of `cases` (keep the 1×1, 1×2, 2×2 entries, which do not change) with:

```ts
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
      ".......1.12......3..2.233.....1.1....2............3.21.11.232122.11.2.11...11....2...02.11.3.......1",
      "1111111222221111221112121221222221221212221122222212222222221212222221222222221222121222222222221222212222111212222221222121222111212121111222121222121111211211211111212112111121211121122212111212122112222121221122212212",
    ],
```

(The solutions are the same as version "2": the loop step did not change, only which clues stay.)

**(c) Digest.** Replace the comment

```ts
  // Larger boards go through several restore rounds and clipped windows; a digest of the serialized
  // puzzle and its solution keeps the test short.
```

with

```ts
  // Larger boards go through more levels of nested blocks; a digest of the serialized puzzle and its
  // solution keeps the test short.
```

and the digest values `3043905915, 124454878, 3022035990, 3169070646,` (from step 1) with

```ts
      2668647316, 1055507470, 2136871833, 3334050716,
```

**(d) Two new tests.** In `describe("generate: properties", …)`, after the test `"custom thresholds are respected"`, insert:

```ts
  test("every clue is needed: without any one of them the rules get stuck", () => {
    for (let n = 0; n < 10; n++) {
      const { puzzle } = generate({ width: 4 + n, height: 13 - n, seed: `needed-${n}` });
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
      clues += generate({ width: 10, height: 10, seed: `density-${n}` }).stats.clueCount;
    }
    const mean = clues / (20 * 100);
    expect(mean).toBeGreaterThanOrEqual(0.35);
    expect(mean).toBeLessThanOrEqual(0.45);
  });
```

Measured: the needed test checks 265 kept clues in 0.2 s, none removable; the density mean is 0.402 (boards 0.35–0.46) in 0.5 s. The existing tests (uniqueness by the rules and by `verify`, brute force up to 4×4, determinism, progress once per test with `total` = `checks`, cancellation from `onProgress`) stay as they are and pass.

### 2.3 Benchmarks — doc comments only

`packages/core/bench/generate.ts`: replace

```ts
 * 2. Generation time per size (NFR-1: p95 under 5 s up to 30×30), first-attempt rate (loops whose
 *    full clue set the rules solve), clue density, clues put back, and `verify` on every result.
 * Pass `--quick` to skip 100×100.
```

with

```ts
 * 2. Generation time per size (NFR-1: p95 under 10 s up to 30×30 and under 30 s at 40×40),
 *    first-attempt rate (loops whose full clue set the rules solve), clue density, clues put back
 *    by the safeguard, and `verify` on every result. 100×100 takes 6 to 19 minutes a puzzle.
 * Pass `--quick` to skip 100×100.
```

`packages/core/bench/clue-gaps.ts`: replace

```ts
 * - `clues`: share of cells that keep a clue. `restored`: share of cells whose clue `generate`
 *   put back after its window pass (`stats.restored`).
```

with

```ts
 * - `clues`: share of cells that keep a clue. `restored`: share of cells whose clue `generate`
 *   put back in its safeguard step (`stats.restored`; 0 since WT15).
```

and

```ts
 * apart from the times. Takes about a minute.
```

with

```ts
 * apart from the times. Takes about 3 minutes.
```

### Verify

1. `bun run check` green.
2. `bun run --cwd packages/core bench:clue-gaps` (about 3 minutes): the `clues`, `removable`, floors and `unknown` columns equal the "after" table above exactly (they are seeded); `removable=0.0%` and `restored=0.0%` on every line.
3. `bun run --cwd packages/core bench:generate --quick` (about 2 minutes): clue shares and `restored=0.0%` as in the table; times within about 1.5× of it. Then, in the background, the full `bun run --cwd packages/core bench:generate` (about 20 minutes) for the 100×100 line; keep all printed lines for step 5.

Commit: `feat(core): judge each clue removal by the whole board, from nested block bases`

## Step 3 — Server: a 30-minute generation limit

### 3.1 `apps/server/src/config.ts`

Replace `  GENERATE_TIMEOUT_MS: Ms.default(60_000),` with `  GENERATE_TIMEOUT_MS: Ms.default(1_800_000),`.

### 3.2 `apps/server/src/config.test.ts`

Replace `      jobs: { generateTimeoutMs: 60_000, verifyTimeoutMs: 45_000 },` with `      jobs: { generateTimeoutMs: 1_800_000, verifyTimeoutMs: 45_000 },`. (Other `60_000`s in that file are `stockMs` and stay.)

### 3.3 `apps/server/src/adapters/metrics/prometheus.ts`

Replace `      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 45, 60],` with `      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 45, 60, 120, 300, 600, 1200, 1800],`.

### 3.4 `apps/server/scripts/bench-jobs.ts` — exact edits

(a) Header and imports. Replace

```ts
//   bun run bench:jobs            all sizes, about a minute
//   bun run bench:jobs --quick    up to 30×30 and one 100×100 verification
import { availableParallelism, loadavg } from "node:os";
import { generate, serializePuzzle } from "@loophole/core";
import { ThreadTaskRunner } from "../src/adapters/tasks/thread-task-runner.ts";
import type { Task } from "../src/domain.ts";

/** NFR-1: generation up to 30×30 has a p95 under 5 s. */
const GENERATE_P95_MS = 5_000;
/** The worker's limits (GENERATE_TIMEOUT_MS, VERIFY_TIMEOUT_MS defaults). */
const GENERATE_TIMEOUT_MS = 60_000;
```

with

```ts
//   bun run bench:jobs            all sizes, 10 to 25 minutes (one 100×100 generation takes 6 to 19)
//   bun run bench:jobs --quick    up to 30×30 and one 100×100 verification
import { availableParallelism, loadavg } from "node:os";
import type { PuzzleWireV1 } from "@loophole/core";
import { ThreadTaskRunner } from "../src/adapters/tasks/thread-task-runner.ts";
import type { Task } from "../src/domain.ts";

/** NFR-1: generation p95 under 10 s up to 30×30 and under 30 s at 40×40, the largest daily. */
function generateBudgetMs(size: number): number | null {
  if (size <= 30) return 10_000;
  return size <= 40 ? 30_000 : null;
}
/** The worker's limits (GENERATE_TIMEOUT_MS, VERIFY_TIMEOUT_MS defaults). */
const GENERATE_TIMEOUT_MS = 1_800_000;
```

(b) Sizes. Replace `        [100, 2],` with `        [100, 1],`.

(c) Keep the 100×100 puzzle. Replace

```ts
for (const [size, count] of sizes) {
  const times: number[] = [];
```

with

```ts
/** The generated 100×100, verified below as a submission. */
let generated100: PuzzleWireV1 | undefined;
for (const [size, count] of sizes) {
  const times: number[] = [];
```

and

```ts
    if (outcome.status !== "done")
      failures.push(`generate ${size}×${size} #${n}: ${outcome.status}`);
    times.push(ms);
```

with

```ts
    if (outcome.status !== "done")
      failures.push(`generate ${size}×${size} #${n}: ${outcome.status}`);
    else if (size === 100 && outcome.output.kind === "generate")
      generated100 = outcome.output.generated.puzzle;
    times.push(ms);
```

(d) Budget check. Replace

```ts
  if (size <= 30 && p >= GENERATE_P95_MS) {
    failures.push(`generate ${size}×${size}: p95 ${p.toFixed(0)} ms is over ${GENERATE_P95_MS} ms`);
  }
```

with

```ts
  const budget = generateBudgetMs(size);
  if (budget !== null && p >= budget) {
    failures.push(`generate ${size}×${size}: p95 ${p.toFixed(0)} ms is over ${budget} ms`);
  }
```

(e) Verification inputs. Replace

```ts
// A generated 100×100 (the rules solve it) and an empty 100×100 grid (many solutions: the search
// must find two and stop) as submissions.
const puzzles = [
  [
    "generated 100×100",
    serializePuzzle(generate({ width: 100, height: 100, seed: "bench-v" }).puzzle),
  ],
  ["empty 100×100", { v: 1 as const, width: 100, height: 100, clues: ".".repeat(10_000) }],
] as const;
for (const [label, puzzle] of quick ? puzzles.slice(1) : puzzles) {
```

with

```ts
// The generated 100×100 (the rules solve it; not with --quick) and an empty 100×100 grid (many
// solutions: the search must find two and stop) as submissions.
const puzzles: [string, PuzzleWireV1][] = [];
if (generated100 !== undefined) puzzles.push(["generated 100×100", generated100]);
puzzles.push(["empty 100×100", { v: 1, width: 100, height: 100, clues: ".".repeat(10_000) }]);
for (const [label, puzzle] of puzzles) {
```

Check: `bun run typecheck` (the server's tsconfig includes `scripts/`) and `bun run lint`. Optionally run `bun run bench:jobs --quick` (about 1 minute): it must end with "All within NFR-1's budgets." Measured with this plan: p95 40 ms at 7×7, 73 ms at 10×10, 571 ms at 20×20, 2.4 s at 30×30; empty 100×100 verified `multiple` in 1.6 s.

### 3.5 Verify

`bun run check` green (config and metrics tests included).

Commit: `feat(server): give generation jobs 30 minutes`

## Step 4 — Auth end-to-end config: only today's dailies

`apps/web/playwright.auth.config.ts`: replace

```ts
  // Today's and tomorrow's daily puzzles only, so the worker is soon free for the tests' own jobs.
  DAILY_DAYS_AHEAD: "2",
```

with

```ts
  // Today's daily puzzles only (a 40×40 takes several seconds), so the worker is soon free for the
  // tests' own jobs.
  DAILY_DAYS_AHEAD: "1",
```

Why: jobs run one at a time, oldest first. With 2 days the 5×5 jobs of the progress and story tests waited behind two 40×40s (about 6–10 s each now) within a 30 s poll. No test uses tomorrow's puzzles (checked: the tests read today's 7×7 and 10×10). These suites are not in the gate; if Mailpit and Garage are running, run `bun run test:e2e:auth` and `bun run test:e2e:stories` once; otherwise note in the commit body that they were not run.

Commit: `test(web): stock only today's dailies in the auth end-to-end runs`

## Step 5 — Docs

### 5.1 `docs/PRD.md` — one exact edit

Replace

```
- NFR-1 Performance: generation p95 for ≤ 30×30 under 5 s; larger sizes are asynchronous with progress. Verification of a submitted 100×100 puzzle completes or returns `unknown` within a fixed time budget (default 30 s).
```

with

```
- NFR-1 Performance: generation runs as a background job with progress (FR-11), so it may take longer than a request (decided 2026-10-26): p95 under 10 s for ≤ 30×30 and under 30 s at 40×40, and a 100×100 finishes within the worker's generation time limit (default 30 min). Verification of a submitted 100×100 puzzle completes or returns `unknown` within a fixed time budget (default 30 s).
```

### 5.2 `docs/DECISIONS.md`

(a) At the end of the entry "2026-10-25 · WT3 `core-generator` · Clue removal: a local test, then put clues back where the solver gets stuck", add a line after its `- **Reason:**` paragraph:

```
- **Superseded:** replaced by WT15 "Clue removal: every test judged by the whole board, from nested block bases" (below).
```

(b) In the WT6 entry whose decision starts "Each task runs in a fresh Bun `Worker`", replace

```
Limits: 60 s for generation (100×100 took about 13 s; about 31 s since WT13's winding loops, see "WT13 `windy-loops`" below)
```

with

```
Limits: 60 s for generation (100×100 took about 13 s; about 31 s since WT13's winding loops, see "WT13 `windy-loops`" below; 30 minutes since WT15, see "Generation may take minutes")
```

(c) Append three entries at the end of the file. Fill the `<…>` placeholders with the lines you measured in step 2 (they should match this plan's tables; if a number differs, use yours and say so in the review):

```
## 2026-10-26 · WT15 `clue-removal` · Generation may take minutes (user decision)
- **Question:** NFR-1 asked for a generation p95 under 5 s up to 30×30. Removing clues against the whole board, which gets generated puzzles down to what the rules need, costs more. Is that allowed?
- **Decision:** Yes (user, 2026-10-26): generation runs asynchronously in the worker, so it may take longer than 5 s; 100×100 must stay practical (minutes, not hours); uniqueness verification should get faster (WT19) and must never get slower. NFR-1 now reads: p95 under 10 s up to 30×30 and under 30 s at 40×40 (the largest daily), and a 100×100 within the worker's generation limit. `GENERATE_TIMEOUT_MS` defaults to 30 minutes (was 60 s), the job-duration histogram gets buckets up to 1800 s, `bench:jobs` checks the new budgets with the new limit (one 100×100 generation, whose puzzle it then verifies), and the auth end-to-end runs stock only today's dailies so their own jobs don't wait behind two 40×40s.
- **Reason:** Measured after WT15 (`bench:generate`): p95 0.6 s at 20×20, 2.8 s at 30×30, 10 s at 40×40, and a median of 345 s at 100×100 (9 seeds: 327–545 s, one at 1133 s); 30 minutes leaves room for that tail on a slower host. Consequences, not addressed here: one worker runs one job at a time, so a 100×100 now holds it for 6–19 minutes, and since anyone may queue generations (up to 100 queued jobs) the queue could be held for hours; a worker starting with no stock spends about 30–45 s on the 12 dailies before other jobs. Nothing in daily stocking depends on generation time (`stock()` runs every minute and skips queued and running jobs).

## 2026-10-26 · WT15 `clue-removal` · The premature-loop check runs at both ends of a joined path
- **Question:** Removal tests started from a partial board sometimes solved puzzles that the solver from an empty board could not (40×40 seed `bench-2`: one such test, then every later one failed and the puzzle kept 70.6% of its clues). Why?
- **Decision:** When a line joins two paths, the joined path's ends are the old paths' far ends, dots no change touched, so they were not queued, and the premature-loop rule (which only runs at queued dots) never saw that the edge between them would close the loop early. At the root `load` queues everything, but inside a lookahead probe the contradiction went unseen depending on the order deductions came in, so the rules were not monotone. `Engine.set` now queues both new ends when they are neighbours, the only case the rule can fire. The solver now solves 3 of the 36 WT14 corpus boards (`SOLVED` in `clue-gaps.test.ts`); a solver test keeps the 5×5 one.
- **Reason:** It makes solving from a sound partial board end where solving from scratch does (no disagreement in 34 800 removal tests at 20×20 and 30×30), which WT15's removal relies on. `verify` is not slower on the same puzzles (median of 30 runs: corpus 17.1 → 16.3 ms, many-solution windy boards 4.9 → 5.0 and 5.7 → 5.7 ms, generated 20×20 21.1 → 20.4 ms); queueing both ends after every line cost about 10% on the corpus. Hint step order changes in places (same rules, same counts on the web fixtures).

## 2026-10-26 · WT15 `clue-removal` · Clue removal: every test judged by the whole board, from nested block bases
- **Question:** Generated puzzles kept 51–57% of cells clued against a whole-board solver floor of about 40–42% (WT14). How should `generate` remove clues so it reaches the floor, fast enough for 100×100?
- **Decision:** A clue is removed when the rules still solve the whole puzzle without it. Tests run 2×2 block by block, in a seeded order; each test starts from its block's base, the edges the rules decide with every clue of the block hidden, which is sound for every removal in the block and, the rules being monotone, gives the same answer as solving from scratch. Bases nest: the board is halved (the longer side, the order of the halves seeded) down to blocks, and each half's base is solved from its parent's when its turn comes. The full-clue check, the removal tests and the restore step all take one rule-solver function (`RuleSolver`, today every rule), the seam a difficulty level will use to pass its own rule set. The restore step stays as a safeguard and put back nothing in any benchmark. Progress is still one call per test with `total` = the full clue count. `GENERATOR_VERSION` is now `"3"`. Gate tests: no kept clue can go with the rules still solving (10 boards), and the mean density of 20 10×10 boards is 0.35–0.45.
- **Reason:** Measured (`bench:generate`, before → after): clues 48.9% → 40.1% at 7×7, 50.8% → 40.3% at 10×10, 56.0% → 40.5% at 20×20, 56.7% → 40.9% at 30×30, 57.9% → 41.2% at 40×40, 59.1% → 42.3% at 100×100; put back 11–23% → 0%; p95 11 ms → 18 ms, 14 → 39 ms, 98 → 593 ms, 346 ms → 2.8 s, 964 ms → 10 s, 34 s → 345 s median (one seed in 9 took 19 minutes); every result verified `unique`. `bench:clue-gaps` after (clues / removable / gap / needed / solver floor / verifier floor): 5×5 41.3% / 0.0% / 1.2% / 98.8% / 41.3% / 40.9%; 7×7 40.3% / 0.0% / 2.4% / 97.6% / 40.3% / 39.6%; 10×10 40.2% / 0.0% / 5.0% / 94.3% / 40.2% / 38.8% (15 unknown); 15×15 39.2% / 0.0% / 1.8% / 88.4% / 39.2% / 38.5% (86 unknown); 20×20 41.7% / 0.0% / 2.8% / 75.6% / 41.7% / – (359 unknown); about 3 minutes now, since the verifier works harder on sparser puzzles. Hint traces grow little (40×40: 2599 → 2642 steps) but 12–13% of their steps are lookahead (was 7%). Alternatives measured: whole-board greedy from scratch (same density, 1.2 s at 20×20, about 7 s at 30×30, hours at 100×100); block sizes 1, 4, 8 and 12 (same density; 4 took 445–522 s at 100×100 against 327–359 s for 2, 8 over 11 minutes); flat 8×8 tiles with bases solved from scratch (slower); a 7×7-window prefilter that keeps a clue without the whole-board test when even the window test fails (identical output, 3% faster: the time goes into re-deriving each base's open edges, 29% of it in parity passes, not into failing tests). WT19's faster engine passes would speed generation up directly.
```

### 5.3 `docs/TESTING.md` — two exact edits

Replace

```
- `bun run bench:jobs` is the server-side performance check (NFR-1): generations up to 30×30 and two 100×100 verifications through the real thread runner, failing when a budget is missed. It is not part of the check, since its timings depend on the machine.
```

with

```
- `bun run bench:jobs` is the server-side performance check (NFR-1): generations up to 100×100 (30×30 with `--quick`) and two 100×100 verifications through the real thread runner, failing when a budget is missed. It takes 10 to 25 minutes (one 100×100 generation takes 6 to 19) and is not part of the check, since its timings depend on the machine.
```

and, in the paragraph on the auth end-to-end tests, replace

```
(the config keeps `DAILY_DAYS_AHEAD` at 2)
```

with

```
(the config keeps `DAILY_DAYS_AHEAD` at 1)
```

### 5.4 `README.md` — one exact edit

Replace

```
| `bun run bench:jobs` | Time generations and verifications as the worker runs them and fail if NFR-1's budgets are missed (`--quick` for a shorter run; not part of the check) |
```

with

```
| `bun run bench:jobs` | Time generations and verifications as the worker runs them and fail if NFR-1's budgets are missed (10 to 25 minutes; `--quick` for a shorter run; not part of the check) |
```

No other README claim changes (the status section names no clue density or generation time; `bench:generate` and `bench:clue-gaps` rows stay true).

### Verify

`bun run check` green.

Commit: `docs: record the clue-removal rework and the relaxed generation time`

## Final checks

- `bun run check` green after every commit (5 commits).
- `git status` clean apart from the 5 commits; nothing pushed.
- `grep -rn "WINDOW_RADIUS\|window pass" packages/core` finds nothing outside DECISIONS/plans.
- `GENERATOR_VERSION` is `"3"` and appears in no test as a literal.

Validated while writing this plan: steps 1–3 and 5's code applied to the worktree, `bun run check` green (lint, typecheck, `check:api`, tests), then reverted.

## Acceptance criteria

1. `bench:generate` 20×20 clue share ≤ 45% (measured 40.5%), with `restored=0.0%` on every size and every result `unique`.
2. `bench:clue-gaps`: `removable=0.0%` on every size; generated density equals the solver floor.
3. 100×100 generation completes (measured 327–545 s on 8 seeds and 1133 s on one, ≈ 42% clued), inside the new 30-minute `GENERATE_TIMEOUT_MS`.
4. Golden values and the new gate tests pass; determinism (same seed → same puzzle) and progress tests unchanged and passing.
5. `verify` not slower (same puzzles, before/after).
6. PRD NFR-1, DECISIONS (3 entries + 2 notes), TESTING.md and README updated.

## Assumptions and unresolved questions (resolved by assumption; the orchestrator may override)

1. **The engine fix belongs in this WT.** It is a one-`if` completeness fix that the removal needs to be exact, and it doesn't slow `verify`. Without it the nested bases occasionally go badly wrong (70.6% on one 40×40). Alternative: keep the engine as is and verify each block from scratch (about 10× slower at 100×100).
2. **NFR-1 numbers** (10 s up to 30×30, 30 s at 40×40, 100×100 within a 30-minute limit) are my reading of "may exceed 5 s; keep 100×100 practical (minutes, not hours)". Measured: 30×30 p95 2.8 s, 40×40 10 s, 100×100 6–9 minutes with one seed in 9 at 19 minutes. If 19 minutes is too long, the levers are WT19's engine speed-ups (every pass of the solver is O(edges)) or a per-size cap; nothing cheaper was found here (see Alternatives).
3. **No per-user generation limit** is added, although a 100×100 job now holds the single worker 6–19 minutes. Flagged in DECISIONS for a later WT.
4. **E2E config**: `DAILY_DAYS_AHEAD` "1" instead of longer poll timeouts; the e2e suites are not in the gate and were not run here (they need Mailpit, Garage and Turnstile access).
5. `bench:clue-gaps` gets slower (about 3 minutes) because classification verifies sparser puzzles; left as is.
