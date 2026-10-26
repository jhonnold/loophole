# WT14 `clue-gap-harness` — implementation plan

Branch `feat/clue-gap-harness`, worktree `/home/jhonnold/projects/loophole-wt/clue-gap-harness`. PRD: FR-3 (rule solver), FR-4 (verifier), FR-9 (clue removal), NFR-3 (tests). Roadmap: WT14 builds the measuring stick and corpus for WT15 (edge-pair parity), WT16 (clue colouring), WT17 (deeper lookahead) and WT18 (generator retune).

## Goal

A benchmark that shows how much clue density the rule solver costs on generated (windy) puzzles, plus a small committed corpus of boards that have exactly one solution but leave today's solver stuck, so later WTs can test new rules against them.

1. **`bench:clue-gaps`** (`packages/core/bench/clue-gaps.ts`): for 5×5, 7×7, 10×10, 15×15 and 20×20 it generates seeded puzzles and prints one line per size: clue density; each kept clue taken out alone, classed as `removable` (rules still solve), `gap` (still unique, rules stuck) or `needed` (not unique); a **solver floor** (whole-board greedy removal with the rules) and a **verifier floor** (whole-board greedy removal with `verify`, up to 15×15). About 70 s.
2. **Corpus** (`packages/core/src/test-support/clue-gaps.json`, written by `bench:clue-gaps --write-corpus`): 36 gap cases, 12 each from 5×5, 7×7 and 10×10, smallest first. Each is the generated puzzle without one clue (v1 wire format) plus the edges the solver had decided when it got stuck (`encodeEdges` text). Loader `clueGapCorpus()` in `test-support/clue-gaps.ts`.
3. **Test** (`packages/core/src/clue-gaps.test.ts`): every entry is `unique`; its stuck board and today's solver agree with the solution; the number of entries the solver solves equals a golden constant `SOLVED` (0 today; WT15–17 raise it).
4. DECISIONS entry with the baseline numbers; README script row.

No change to `engine.ts`, `solver.ts`, `verify.ts`, `generate.ts` or anything in `apps/`. `GENERATOR_VERSION` stays `"2"`.

## Measured (this machine, 16 cores, Bun 1.3.13, idle; the code in this plan, run twice, identical output apart from times)

```
clue-gaps 5×5: n=100 clues=52.3% removable=49.9% gap=1.4% needed=48.7% unknown=0 solver-floor=41.2% verify-floor=40.7% (unknown 0) time=0.8s
clue-gaps 7×7: n=100 clues=51.2% removable=51.2% gap=3.9% needed=44.9% unknown=0 solver-floor=40.3% verify-floor=39.0% (unknown 0) time=2.8s
clue-gaps 10×10: n=50 clues=54.3% removable=68.2% gap=3.6% needed=28.1% unknown=0 solver-floor=40.2% verify-floor=39.0% (unknown 29) time=14.1s
clue-gaps 15×15: n=10 clues=55.0% removable=76.8% gap=1.9% needed=21.3% unknown=0 solver-floor=40.7% verify-floor=40.1% (unknown 119) time=35.3s
clue-gaps 20×20: n=10 clues=56.5% removable=74.8% gap=4.8% needed=20.4% unknown=0 solver-floor=42.2% verify-floor=- time=17.1s
wrote 36 cases to …/packages/core/src/test-support/clue-gaps.json
```

Total 70 s. `clue-gaps.json` sha256 `91e612353cb4b580d68b6ef9b6d4343ee291b2c53588c072a682805b0abddbb6` (16 171 bytes); the same on both runs. `removable`/`gap`/`needed` are shares of the kept clues; `clues` and the floors are shares of all cells.

### What the numbers say (important for WT15–18)

- **The solver is not the main limit; the removal procedure is.** Taking clues out one at a time over the whole board, keeping a removal while today's rules (lookahead included) still solve it, gets every size to 40–42% clued. That is within 0.5–1.3 points of the verifier floor (39–41%) and close to the book's ~39%. Generated puzzles keep 51–57% because of `generate`'s local 7×7-window test plus the restore step: 50–77% of the clues it keeps can each be taken out alone with the rules still solving the puzzle. Split at 10×10 (10 puzzles, scratch run): of the clues the removal pass kept, 59% are removable in the final puzzle; of the clues the restore step put back, 89%. Clues put back near a stuck area make their neighbours unnecessary.
- **Pure solver gaps are rare:** 1.4–4.8% of kept clues.
- **Cost of a whole-board removal** (for WT18): about 0.04 s per puzzle at 10×10, 0.9 s at 20×20, 7 s at 30×30 (scratch run, 2 puzzles, floor 40.2%). NFR-1 allows a 5 s p95 at 30×30, and 100×100 would take far longer (WT3 measured about 30 minutes for a whole-board solve per clue). WT18 would need a hybrid, for example a whole-board pass over put-back clues and their neighbours only.
- **Without lookahead** (scratch run, `solve(…, { lookahead: false })`, whole-board greedy from the full clue set): 43.8% at 7×7, 45.0% at 10×10, 46.4% at 20×20, against 41.1%, 42.0% and 43.0% with lookahead from the same start. So the named rules alone already reach about 45%; WT15–17 matter most for difficulty levels that leave out "Try and see", and for the last point or two.

### Choices measured

- **Verifier budget** (`maxNodes`, no time limit, so it is deterministic; DECISIONS WT2). Verifier floor from generated puzzles, scratch runs on other seeds: 10×10 (30 puzzles) 38.2% at 10 000, 30 000 and 100 000 nodes, with 14, 10 and 1 removals left `unknown`; 15×15 (6 puzzles) 38.4% at both 10 000 and 100 000 nodes (87 and 33 `unknown`) but 18 s against 73 s. A removal that runs out of nodes is not made, and almost none of those would have been allowed, so 10 000 is used.
- **Verifier floor at 20×20** is not feasible: 23 s per puzzle at 10 000 nodes, with 133 removals `unknown` over 2 puzzles, so the floor (44.3%) came out above the solver floor (41.5%) and means nothing. Shown as `-`.
- **Floors start from the generated puzzle**, both with the same seeded order, so the generated density, the solver floor and the verifier floor are directly comparable. Starting the verifier floor from the full clue set gave 40.6% at 10×10 against 38.3% from the generated puzzle (20 puzzles; 7×7: 41.2% against 40.2%), and costs more verifies.
- **Classification order:** solve first, verify only when the rules get stuck (a puzzle the sound rules solve has one solution). Same numbers and corpus as verify-first, fewer verifies.
- **Seed variance:** with another seed family (`gap-<size>-<n>`, 30 puzzles) the gap share was 3.5% at 7×7 and 3.2% at 10×10, the solver floor 40.7% and 40.0%, the verifier floor 40.3% and 38.2%.

### Corpus

36 entries: `clue-gaps-5-3#13` … `clue-gaps-10-11#64` (id = generate seed `#` cell index). Removed clues: 0 ×6, 1 ×17, 2 ×7, 3 ×6. Share of edges still open in the stuck board: 0.38–0.80 at 5×5, 0.38–0.73 at 7×7, 0.14–0.54 at 10×10. At most 2 entries per puzzle, for variety.

## Design

### Files

| File | Change |
|---|---|
| `packages/core/bench/clue-gaps.ts` | new: the benchmark and corpus writer |
| `packages/core/package.json` | new script `bench:clue-gaps` |
| `packages/core/src/test-support/clue-gaps.ts` | new: `ClueGapEntry`, `ClueGapCase`, `clueGapCorpus()` |
| `packages/core/src/test-support/clue-gaps.json` | new, generated: the 36-entry corpus |
| `packages/core/src/clue-gaps.test.ts` | new: corpus checks and the `SOLVED` golden count |
| `docs/DECISIONS.md` | new WT14 entry at the bottom |
| `README.md` | Scripts table: `bench:clue-gaps` row |

`tsconfig.json` (core sources) excludes `src/test-support` and tests, so the JSON import is only type-checked by `tsconfig.test.json`, which includes `src` and `bench` with Bun types. `tsconfig.base.json` already has `resolveJsonModule`. Biome checks JSON: `JSON.stringify(corpus, null, 2)` plus a newline passes `biome check` unchanged (checked).

### Corpus entry (`clue-gaps.json`, an array of these)

```ts
interface ClueGapEntry {
  readonly id: string;           // "<generate seed>#<cell>"
  readonly puzzle: PuzzleWireV1; // generated puzzle minus that clue; keeps seed and meta.generator "2"
  readonly cell: number;         // cell index of the removed clue
  readonly clue: number;         // the removed clue, 0–3
  readonly stuck: string;        // encodeEdges(solve(puzzle).edges), status "stuck"
}
```

The solver's status for "no rule applies, edges still open" is `stuck` (`incomplete` means stopped by `maxSteps` or time; `solver.ts`). The recorded board is the `stuck` result. The solution is not stored: `verify` returns it in a few milliseconds.

### Test design: a golden count, not a hard "still stuck" assertion

Per entry (permanent facts, true whatever rules are added): `verify` says `unique`; the cell has no clue and the solution's clue there equals `clue`; the stuck board has an open edge; every edge the stuck board decides, and every edge `solve(puzzle)` decides, matches the solution. The last one is a soundness check of every future rule on hard boards.

Then one test: the number of entries `solve` solves equals `const SOLVED = 0`. A WT that adds rules sees it fail with the new count, raises `SOLVED` and quotes the number in its DECISIONS entry, like a golden value; a drop means a rule got weaker. The gate stays green and fast (the file runs in about 0.15 s).

### The rule-subset seam

`bench/clue-gaps.ts` calls the solver only through `runRules(puzzle)`, which today is `solve(puzzle)`. When `solve` takes a rule set (roadmap Decisions: `solve(puzzle, { rules })`), WT15–17 change that one function (and can add a flag). The test calls `solve(c.puzzle)` in two places; the same applies. No option is built here.

### Re-running and comparing (WT15–18)

`bun run --cwd packages/core bench:clue-gaps` prints one stable `clue-gaps <size>:` line per size; compare against the WT14 lines in DECISIONS. Seeds (`clue-gaps-<size>-<n>`, order seed `<seed>/floor`) and the node budget are fixed, so only code changes move the numbers. A WT that bumps `GENERATOR_VERSION` changes the generated puzzles and therefore all numbers; the committed corpus does not change and stays the fixed WT14 baseline. Do not run `--write-corpus` in later WTs unless the plan says to make a new corpus.

### Gate cost

Core tests 230 → 268 (+38: 1 shape test, 36 per-entry tests, 1 count test). `clue-gaps.test.ts` about 0.15 s. Whole `bun run check` 818 tests, green.

## Rules for the implementer

- Run `export PATH="$HOME/.bun/bin:$PATH"` in every shell. Work in `/home/jhonnold/projects/loophole-wt/clue-gap-harness`. Run `bun install --frozen-lockfile` once first if `node_modules` is missing. Do not clone the repo anywhere (`/tmp` is a small tmpfs).
- Copy code blocks **exactly**. They were formatted with Biome and produced the corpus and numbers above. If the corpus hash differs, you did not copy something exactly: fix the code, never hand-edit the JSON.
- No `console`, `Date`, `performance` or Bun APIs in `src/` outside tests and `test-support` (the typecheck enforces it for `src/`). The benchmark may use them.
- Do not change `engine.ts`, `solver.ts`, `verify.ts`, `generate.ts` or `GENERATOR_VERSION`.
- `bun run check` must pass after every step; commit after each step with the given message. Do not push.

## Step 1 — Benchmark, loader and corpus

### 1.1 `packages/core/package.json` — one exact edit

Replace

```json
    "bench:generate": "bun bench/generate.ts"
```

with

```json
    "bench:generate": "bun bench/generate.ts",
    "bench:clue-gaps": "bun bench/clue-gaps.ts"
```

### 1.2 `packages/core/src/test-support/clue-gaps.ts` — new file

```ts
import { decodeEdges, type PuzzleWireV1, parsePuzzle } from "../format.ts";
import type { Puzzle } from "../puzzle.ts";
import entries from "./clue-gaps.json";

/** One entry of `clue-gaps.json`, written by `bench/clue-gaps.ts --write-corpus`. */
export interface ClueGapEntry {
  /** `<generate seed>#<cell>`: the generated puzzle it came from and the clue taken out. */
  readonly id: string;
  /** The generated puzzle without that clue, in the v1 wire format. */
  readonly puzzle: PuzzleWireV1;
  /** Index of the cell whose clue was taken out. */
  readonly cell: number;
  /** The clue taken out, 0–3. */
  readonly clue: number;
  /** The edges today's solver decided before it got stuck on `puzzle`, as `encodeEdges` text. */
  readonly stuck: string;
}

/** A corpus entry, parsed. */
export interface ClueGapCase {
  readonly id: string;
  readonly puzzle: Puzzle;
  readonly cell: number;
  readonly clue: number;
  readonly stuck: Uint8Array;
}

/**
 * Boards with exactly one solution where the rule solver got stuck when the corpus was made
 * (WT14), smallest first: generated puzzles with one kept clue taken out. Rule tests for later
 * solver work start from these.
 */
export function clueGapCorpus(): ClueGapCase[] {
  return (entries as ClueGapEntry[]).map((e) => {
    const puzzle = parsePuzzle(e.puzzle);
    return {
      id: e.id,
      puzzle,
      cell: e.cell,
      clue: e.clue,
      stuck: decodeEdges(puzzle.grid, e.stuck),
    };
  });
}
```

### 1.3 `packages/core/src/test-support/clue-gaps.json` — placeholder

Create it with the single line `[]` (so the loader type-checks before the benchmark writes the real corpus in 1.5).

### 1.4 `packages/core/bench/clue-gaps.ts` — new file

```ts
/**
 * Clue-gap benchmark (not part of `bun run check`). Run: `bun run --cwd packages/core bench:clue-gaps`.
 *
 * Measures how far today's rule solver is from what uniqueness alone allows, on generated puzzles
 * (DECISIONS, WT14). For each size it generates puzzles and prints one line:
 * - `clues`: share of cells that keep a clue.
 * - Each kept clue taken out alone: `removable` (the rules still solve the puzzle), `gap` (still
 *   one solution, but the rules get stuck: a solver gap), `needed` (no longer one solution) and
 *   `unknown` (the verifier's node budget ran out). Shares of the kept clues.
 * - `solver-floor`: clues left after taking clues out one at a time in seeded random order while
 *   the rules still solve the whole puzzle. What today's solver allows with a whole-board removal.
 * - `verify-floor`: the same, keeping a removal while `verify` says `unique`. What a perfect solver
 *   would allow (an estimate: one greedy order, and a removal whose check runs out of nodes is not
 *   made). Too slow above 15×15, so left out there.
 * Everything is seeded and uses node budgets, never time, so every run prints the same numbers
 * apart from the times. Takes about a minute.
 *
 * `--write-corpus` also rewrites `src/test-support/clue-gaps.json`: the first gap cases from the
 * smallest sizes, each the generated puzzle without that clue plus the edges the solver decided
 * before it got stuck. `clue-gaps.test.ts` checks them. The committed file is the WT14 baseline;
 * later work keeps it as it is, since rewriting it after the generator or the rules change gives
 * different boards.
 */
import { encodeEdges, serializePuzzle } from "../src/format.ts";
import { generate } from "../src/generate.ts";
import { createPuzzle, NO_CLUE, type Puzzle } from "../src/puzzle.ts";
import { createRng } from "../src/rng.ts";
import { type SolveResult, solve } from "../src/solver.ts";
import type { ClueGapEntry } from "../src/test-support/clue-gaps.ts";
import { verify } from "../src/verify.ts";

/** Board side, puzzles per size, and whether to estimate the verifier floor. */
const SIZES: [number, number, boolean][] = [
  [5, 100, true],
  [7, 100, true],
  [10, 50, true],
  [15, 10, true],
  [20, 10, false],
];
/** Deterministic verification: a node budget and no time limit (DECISIONS, WT2). */
const VERIFY_OPTIONS = { maxNodes: 10_000, timeLimitMs: Number.POSITIVE_INFINITY };
/** Corpus: gap cases per size, from these sizes, at most this many from one puzzle. */
const CORPUS_PER_SIZE = 12;
const CORPUS_SIZES = [5, 7, 10];
const CORPUS_PER_PUZZLE = 2;
const CORPUS_FILE = new URL("../src/test-support/clue-gaps.json", import.meta.url);

/**
 * The one place the harness runs the rule solver. When `solve` takes a rule set (roadmap,
 * WT15–17), pass it here to measure that subset.
 */
function runRules(puzzle: Puzzle): SolveResult {
  return solve(puzzle);
}

/**
 * Takes clues out of a copy of `puzzle` in seeded random order, keeping each removal while `keeps`
 * says the puzzle still works. Returns the clues left.
 */
function greedyFloor(puzzle: Puzzle, seed: string, keeps: (p: Puzzle) => boolean): number {
  const clues = puzzle.clues.slice();
  const work: Puzzle = { grid: puzzle.grid, clues };
  const order: number[] = [];
  for (let i = 0; i < clues.length; i++) if (clues[i] !== NO_CLUE) order.push(i);
  const rng = createRng(seed);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  let left = order.length;
  for (const i of order) {
    const k = clues[i];
    clues[i] = NO_CLUE;
    if (keeps(work)) left--;
    else clues[i] = k;
  }
  return left;
}

const writeCorpus = process.argv.includes("--write-corpus");
const corpus: ClueGapEntry[] = [];
const pct = (n: number, of: number) => `${((100 * n) / of).toFixed(1)}%`;

for (const [size, count, withVerifyFloor] of SIZES) {
  const t0 = performance.now();
  let cells = 0;
  let kept = 0;
  const classes = { removable: 0, gap: 0, needed: 0, unknown: 0 };
  let solverFloor = 0;
  let verifyFloor = 0;
  let floorUnknown = 0;
  let sizeCorpus = 0;
  for (let n = 0; n < count; n++) {
    const seed = `clue-gaps-${size}-${n}`;
    const { puzzle } = generate({ width: size, height: size, seed });
    const { grid } = puzzle;
    cells += grid.cellCount;
    const clues = puzzle.clues.slice();
    const without: Puzzle = { grid, clues };
    let fromPuzzle = 0;
    for (let i = 0; i < grid.cellCount; i++) {
      const k = clues[i];
      if (k === NO_CLUE) continue;
      kept++;
      clues[i] = NO_CLUE;
      // The rules are sound, so a puzzle they solve has one solution: verify only when stuck.
      const result = runRules(without);
      const status = result.status === "solved" ? "solved" : verify(without, VERIFY_OPTIONS).status;
      if (status === "solved") classes.removable++;
      else if (status === "unique") {
        classes.gap++;
        if (
          writeCorpus &&
          CORPUS_SIZES.includes(size) &&
          sizeCorpus < CORPUS_PER_SIZE &&
          fromPuzzle < CORPUS_PER_PUZZLE
        ) {
          const wire = createPuzzle(size, size, clues, { seed, meta: puzzle.meta });
          corpus.push({
            id: `${seed}#${i}`,
            puzzle: serializePuzzle(wire),
            cell: i,
            clue: k,
            stuck: encodeEdges(result.edges),
          });
          sizeCorpus++;
          fromPuzzle++;
        }
      } else if (status === "unknown") classes.unknown++;
      else classes.needed++;
      clues[i] = k;
    }
    solverFloor += greedyFloor(puzzle, `${seed}/floor`, (p) => runRules(p).status === "solved");
    if (withVerifyFloor) {
      verifyFloor += greedyFloor(puzzle, `${seed}/floor`, (p) => {
        const status = verify(p, VERIFY_OPTIONS).status;
        if (status === "unknown") floorUnknown++;
        return status === "unique";
      });
    }
  }
  const seconds = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(
    `clue-gaps ${size}×${size}: n=${count} clues=${pct(kept, cells)} ` +
      `removable=${pct(classes.removable, kept)} gap=${pct(classes.gap, kept)} ` +
      `needed=${pct(classes.needed, kept)} unknown=${classes.unknown} ` +
      `solver-floor=${pct(solverFloor, cells)} ` +
      `verify-floor=${withVerifyFloor ? `${pct(verifyFloor, cells)} (unknown ${floorUnknown})` : "-"} ` +
      `time=${seconds}s`,
  );
}

if (writeCorpus) {
  await Bun.write(CORPUS_FILE, `${JSON.stringify(corpus, null, 2)}\n`);
  console.log(`wrote ${corpus.length} cases to ${CORPUS_FILE.pathname}`);
}
```

### 1.5 Write the corpus and check it

```sh
cd packages/core
bun run bench:clue-gaps --write-corpus     # ~70 s
sha256sum src/test-support/clue-gaps.json  # 91e612353cb4b580d68b6ef9b6d4343ee291b2c53588c072a682805b0abddbb6
cd ../..
bun run check
```

Expect the five lines in "Measured" (times may differ) and `wrote 36 cases`. The first entry's id is `clue-gaps-5-3#13`, the last `clue-gaps-10-11#64`. If the hash differs, compare your code with the listings; do not edit the JSON.

Commit: `chore(core): add a clue-gap benchmark and a corpus of boards the solver gets stuck on`

## Step 2 — Corpus test

### 2.1 `packages/core/src/clue-gaps.test.ts` — new file

```ts
import { describe, expect, test } from "bun:test";
import { EdgeState } from "./grid.ts";
import { deriveClues, NO_CLUE } from "./puzzle.ts";
import { solve } from "./solver.ts";
import { clueGapCorpus } from "./test-support/clue-gaps.ts";
import { verify } from "./verify.ts";

/**
 * Corpus entries the rule solver solves. 0 when the corpus was made (WT14): every entry was stuck.
 * A solver change that solves more raises it, like a golden value; a drop means it got weaker.
 */
const SOLVED = 0;

const corpus = clueGapCorpus();

/** Edges that `edges` decides differently from `solution`. */
function disagreements(edges: Uint8Array, solution: Uint8Array): number {
  let n = 0;
  for (let e = 0; e < edges.length; e++) {
    if (edges[e] !== EdgeState.Unknown && edges[e] !== solution[e]) n++;
  }
  return n;
}

describe("clue-gap corpus", () => {
  test("has 36 entries with distinct ids, smallest boards first", () => {
    expect(corpus.length).toBe(36);
    expect(new Set(corpus.map((c) => c.id)).size).toBe(corpus.length);
    const sizes = corpus.map((c) => c.puzzle.grid.cellCount);
    expect(sizes).toEqual(sizes.toSorted((a, b) => a - b));
  });

  for (const c of corpus) {
    test(`${c.id} has one solution, which the stuck board and the solver agree with`, () => {
      const result = verify(c.puzzle, { maxNodes: 10_000, timeLimitMs: Number.POSITIVE_INFINITY });
      expect(result.status).toBe("unique");
      const solution = result.solutions[0];
      expect(c.puzzle.clues[c.cell]).toBe(NO_CLUE);
      expect(deriveClues(c.puzzle.grid, solution)[c.cell]).toBe(c.clue);
      expect(c.stuck.includes(EdgeState.Unknown)).toBe(true);
      expect(disagreements(c.stuck, solution)).toBe(0);
      expect(disagreements(solve(c.puzzle).edges, solution)).toBe(0);
    });
  }

  test(`the rule solver solves ${SOLVED} of the entries`, () => {
    const solved = corpus.filter((c) => solve(c.puzzle).status === "solved").map((c) => c.id);
    expect(solved.length).toBe(SOLVED);
  });
});
```

### Verify

```sh
bun test packages/core/src/clue-gaps.test.ts   # 38 pass, ~0.15 s
bun run check                                  # core 268 tests
```

Sanity check, then undo: set `SOLVED = 1` and see the count test fail; put it back to 0.

Commit: `test(core): check the clue-gap corpus against the verifier and the solver`

## Step 3 — Docs

### 3.1 `README.md` — one exact edit

After the row

```
| `bun run --cwd packages/core bench:generate` | Time puzzle generation on 7×7 to 100×100 boards and measure loop shape and acceptance (not part of the check) |
```

add

```
| `bun run --cwd packages/core bench:clue-gaps` | Measure which kept clues the rule solver needs on generated 5×5 to 20×20 puzzles, against how few clues one solution allows (`--write-corpus` rewrites the test corpus; not part of the check) |
```

### 3.2 `docs/DECISIONS.md` — append at the end of the file (after a blank line)

If your benchmark numbers differ (they should not, apart from times), use yours.

```markdown
## 2026-10-26 · WT14 `clue-gap-harness` · Measuring what the solver costs: a benchmark and a corpus of stuck boards
- **Question:** Generated windy puzzles keep 51–57% of cells clued (books about 39%). How much of that is the rule solver's fault, how do WT15–18 measure progress, and what do new rules get tested on?
- **Decision:** `bench:clue-gaps` (`packages/core/bench/clue-gaps.ts`) generates seeded puzzles at 5×5, 7×7, 10×10, 15×15 and 20×20 and prints one line per size: clue density; each kept clue taken out alone, classed `removable` (the rules still solve it), `gap` (still one solution, the rules get stuck) or `needed` (not unique); a solver floor (clues taken out one at a time in seeded random order over the whole board while the rules still solve it) and a verifier floor (the same while `verify` says `unique`; up to 15×15, too slow above). Verification uses 10 000 nodes and no time limit, so every run prints the same numbers. The solver is called through one function, `runRules`, where a future rule-set option goes. `--write-corpus` wrote `packages/core/src/test-support/clue-gaps.json`: 36 gap cases, 12 each from 5×5, 7×7 and 10×10 (at most 2 per puzzle), each the generated puzzle without that clue in the v1 wire format plus the solver's stuck edges; `clueGapCorpus()` loads it. It is a fixed baseline: later WTs keep it. `clue-gaps.test.ts` checks each entry is `unique` and that its stuck board and the solver agree with the solution, and that the solver solves exactly `SOLVED` entries (0 now). A WT that adds rules raises `SOLVED`, like a golden value, re-runs the benchmark and records its lines next to these.
- **Reason:** Baseline (generated density / removable / gap / needed / solver floor / verifier floor): 5×5 (100 puzzles) 52.3% / 49.9% / 1.4% / 48.7% / 41.2% / 40.7%; 7×7 (100) 51.2% / 51.2% / 3.9% / 44.9% / 40.3% / 39.0%; 10×10 (50) 54.3% / 68.2% / 3.6% / 28.1% / 40.2% / 39.0%; 15×15 (10) 55.0% / 76.8% / 1.9% / 21.3% / 40.7% / 40.1%; 20×20 (10) 56.5% / 74.8% / 4.8% / 20.4% / 42.2% / not run. About 70 s in all. So today's rules, lookahead included, already allow 40–42%, within about a point of what one solution allows, and the extra clues come from the generator's local-window test and put-back step: 50–77% of the clues it keeps can each go with the rules still solving the puzzle. Without lookahead the same whole-board removal (from the full clue set) reaches about 44–46%. A whole-board removal costs about 1 s per puzzle at 20×20 and 7 s at 30×30, too slow as is for NFR-1 and far too slow at 100×100, so WT18 has to find a cheaper way to get there. A higher node budget did not change the verifier floor (10×10: 38.2% at 10 000, 30 000 and 100 000 nodes on 30 other puzzles); at 20×20, 10 000 nodes left too many removals unknown for the floor to mean anything.
```

### Verify

```sh
bun run check
```

Commit: `docs: record the clue-gap baseline`

## Final checks

```sh
bun run check
git log --oneline main..HEAD    # 3 commits (plus the plan commit, if the orchestrator commits it)
git status                      # clean
```

Put the full `bench:clue-gaps` output in the final report.

## Acceptance criteria

| Id | Criterion | Where checked |
|---|---|---|
| Harness | One `clue-gaps <size>:` line per size with density, removable/gap/needed/unknown shares, solver floor, verifier floor (≤ 15×15); seeded and node-budgeted, so the numbers repeat | run twice, same lines; "Measured" |
| Baseline | Gap share and floors recorded for 7×7 and 10×10 at least (all five sizes here) | DECISIONS entry |
| Corpus | 36 deterministic entries, smallest boards first, v1 wire puzzle + `encodeEdges` stuck board, loader in `test-support` | sha256 matches; `clue-gaps.test.ts` shape test |
| Corpus test | Every entry `unique`; stuck board and solver agree with the solution; solved count is a golden `SOLVED = 0` | `clue-gaps.test.ts` (38 tests, ~0.15 s) |
| Seam | Solver called through one `runRules` function | code review |
| No behaviour change | `engine.ts`, `solver.ts`, `verify.ts`, `generate.ts` untouched; `GENERATOR_VERSION` `"2"`; generator goldens pass | `git diff main --stat`; `generate.test.ts` |
| Docs | README row; DECISIONS entry in the template | review |
| Gate | `bun run check` green | Final checks |

## Unresolved questions (resolved by assumption; the orchestrator may override)

- **The roadmap's premise does not hold.** The brief says the rule solver's strength is the limit. Measured: today's rules allow 40–42% with a whole-board removal, within about a point of the verifier floor; the 51–57% comes from `generate`'s removal procedure. WT15–17 rules would move density by about a point at most (more for lookahead-free difficulty levels); WT18's removal retune is where most of the drop is. Worth telling the user before WT15 starts; maybe WT18's removal work should come first. WT14 itself records this and does not change the generator.
- "Status incomplete" in the brief: the engine calls that state `stuck`; the corpus records the `stuck` result.
- 5×5 is added (not in the brief's example sizes) so the corpus starts with boards small enough to study by hand.
- The verifier floor starts from the generated puzzle, not the full clue set, so all three densities share one starting point.
- The corpus comes from generated puzzles, as the brief asks, not from solver-minimal ones; those would give sparser stuck boards if WT15–17 want them later.
- `SOLVED` is an exact golden count, not "at least": the gate then also catches a rule getting weaker.
- No `--no-lookahead` flag or rule-subset option: `runRules` is the seam; the no-lookahead numbers above are from a scratch run.
