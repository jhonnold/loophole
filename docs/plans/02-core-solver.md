# WT2 `core-solver` — implementation plan

Branch `feat/core-solver`, worktree `/home/jhonnold/projects/loophole-wt/core-solver`. PRD: FR-3 (rule-based solver), FR-4 (verifier), FR-5 (verified against brute force), FR-6 (step record for hints), NFR-1 (100×100 verification within 30 s or `unknown`), NFR-3 (unit and property tests), §9 scale risk (rule-solvable ⇒ provably unique).

## Goal

Add to `packages/core` (pure TypeScript, no dependencies):

- **`solve(puzzle, options)`**: applies named, sound deductions until solved or stuck, recording each as a step `{rule, changes, cells, dots}`. `solved` proves the solution is unique with no guessing (PRD §9).
- **`verify(puzzle, options)`**: `unique | none | multiple | unknown`, with one solution for `unique`, two different ones for `multiple`, and stats. Rules first, then a depth-first search that stops at the second solution, under a time/node budget with an injectable clock.
- **Rule ids with one-sentence explanations** as data (`RULE_IDS`, `RULE_TEXT`) for hints.
- **FR-5 tests**: every clue assignment on every grid of ≤ 6 cells (66,780 puzzles) plus fast-check up to 5×4, comparing both `verify` and every edge `solve` decides with `bruteForceSolutions`.
- **A benchmark** (`bun run --cwd packages/core bench`, not in the gate) on 10×10, 30×30 and 100×100 puzzles derived from random loops.

Out of scope: the generator (WT3), Worker/timeout plumbing (WT6), hint API/UI (WT8), editor (WT10).

## How later worktrees use this

- **WT3 generator**: a candidate puzzle is acceptable when `solve(puzzle).status === "solved"` (rule-solvable with bounded lookahead ⇒ unique, PRD §9); `solve(puzzle, { lookahead: false })` is a cheaper first filter. `verify` is the final check before publishing. Both accept `timeLimitMs` / `now`.
- **WT6 worker**: runs `verify(puzzle, { timeLimitMs })` inside a Bun `Worker`; the verifier checks its own deadline (once per lookahead probe and per search node), and the Worker's `terminate()` is the outer hard cap. `stats` go into the job row.
- **WT8 hints**: `solve(puzzle, { initial: playerEdges, maxSteps: 1 }).steps[0]` is the next deduction from the player's board: highlight `cells` and `dots`, show `RULE_TEXT[step.rule]`, and the edges in `changes`. Deductions are sound relative to the board they start from, so WT8 must first remove (or flag) player edges that disagree with the stored solution; otherwise `status` can be `contradiction` or the step can follow from a wrong line.
- **WT10 editor**: live feedback is `verify(puzzle, { timeLimitMs })`; `multiple` carries two different solutions to show.

## Design

### Files

| File | Exported from `index.ts` | Contents |
|---|---|---|
| `packages/core/src/rules.ts` | yes | `RULE_IDS`, `RuleId`, `RULE_TEXT`, `EdgeChange`, `Step` |
| `packages/core/src/engine.ts` | **no** (internal) | `Engine` (state, trail, all rule tiers), `Budget`, `SolverStop`, `Mark` |
| `packages/core/src/solver.ts` | yes | `solve`, `SolveOptions`, `SolveResult`, `SolveStatus` |
| `packages/core/src/verify.ts` | yes | `verify`, `VerifyOptions`, `VerifyResult`, `VerifyStatus`, `VerifyStats`, `DEFAULT_VERIFY_TIME_LIMIT_MS` |
| `packages/core/src/test-support/loops.ts` | no (tests, bench) | `randomLoop(grid, rng, coverage)`, `puzzleFromLoop(grid, loop, rng, keep)` |
| `packages/core/bench/verify.ts` | no | benchmark script |
| tests | — | `rules.test.ts`, `solver.test.ts`, `verify.test.ts`, `agreement.test.ts` |

### Public API

```ts
// rules.ts
export const RULE_IDS: readonly [
  "clue-zero", "clue-satisfied", "clue-needs-all", "dot-full", "dot-continue", "dot-dead-end",
  "corner-1", "corner-3", "adjacent-3s", "diagonal-3s", "premature-loop", "loop-complete",
  "parity", "lookahead"];
export type RuleId = (typeof RULE_IDS)[number];
export const RULE_TEXT: Readonly<Record<RuleId, string>>;
export interface EdgeChange { readonly edge: number; readonly state: 1 | 2 } // Line | Cross
export interface Step {
  readonly rule: RuleId;
  readonly changes: readonly EdgeChange[]; // edges this step set, in order
  readonly cells: readonly number[];       // reason: cells to highlight
  readonly dots: readonly number[];        // reason: dots to highlight
}

// solver.ts
export type SolveStatus = "solved" | "stuck" | "contradiction" | "incomplete";
export interface SolveOptions {
  readonly initial?: Uint8Array;   // starting edge states (player board); not modified
  readonly lookahead?: boolean;    // default true
  readonly maxSteps?: number;      // default unlimited → "incomplete" when hit
  readonly timeLimitMs?: number;   // default unlimited → "incomplete" when hit
  readonly now?: () => number;     // default Date.now
}
export interface SolveResult { readonly status: SolveStatus; readonly steps: Step[]; readonly edges: Uint8Array }
export function solve(puzzle: Puzzle, options?: SolveOptions): SolveResult;

// verify.ts
export const DEFAULT_VERIFY_TIME_LIMIT_MS = 30_000;
export type VerifyStatus = "unique" | "none" | "multiple" | "unknown";
export interface VerifyOptions { readonly timeLimitMs?: number; readonly now?: () => number; readonly maxNodes?: number }
export interface VerifyStats { readonly nodes: number; readonly probes: number; readonly elapsedMs: number }
export interface VerifyResult { readonly status: VerifyStatus; readonly solutions: Uint8Array[]; readonly stats: VerifyStats }
export function verify(puzzle: Puzzle, options?: VerifyOptions): VerifyResult;
```

`solve` and `load` throw `RangeError` for an `initial` of the wrong length or with a value other than 0/1/2 (programmer error, as in `analyzeBoard`).

### Engine state and invariants (`engine.ts`)

- `edges: Uint8Array` — one `EdgeState` per edge.
- Path ends: lines form paths. For every dot of line-degree 1, `mate[d]` is the dot at the other end of its path and `plen[d]` the path's length in edges. Values at other dots are stale and never read.
- `lineCount`, and `closed` — true once a line closed a loop that was checked to contain every line and satisfy every clue (so `closed` ⇒ the board is a solution once the remaining edges are crossed).
- **Trail**: `set()` pushes every edge it sets; path-end updates push `(dot, oldMate, oldLen)`. `mark()` records trail lengths and `closed`; `undo(mark)` pops back to it and clears the worklist. Lookahead probes and search nodes use mark/undo instead of copying arrays. `edgeTrail.length === edgeCount` means every edge is decided.
- **Worklist**: a ring buffer over items `0 … cellCount−1` (cells) and `cellCount + d` (dots), each queued at most once (`inQueue`). Setting edge `e` queues both its dots and the up-to-4 cells around each of those dots (the corner rule reads edges outside the cell).
- **`set(e, state)`** (edge must be unknown) does the path bookkeeping and returns false on an immediate contradiction: a third line at a dot, any line after `closed`, or a closing line whose loop is not the full solution (`plen[a] + 1 !== lineCount` or a clue unsatisfied). For a line `(a, b)` with prior degrees `da`, `db`: if `da === db === 1 && mate[a] === b` the line closes the path; otherwise the new ends are `ea = da ? mate[a] : a`, `eb = db ? mate[b] : b`, with length `plen[a] + plen[b] + 1` (counting 0 for a fresh dot).
- **`assign(e, state)`** is what rules call: no-op if already `state`, false if already the other state, else records the change in the current step and calls `set`.

### Rules

All are sound: whatever they decide holds in every solution of the puzzle (given the starting board). "Cross" includes "off the board" for edges that do not exist.

| Id | Tier | When | Sets | Reason (`cells`, `dots`) |
|---|---|---|---|---|
| `clue-zero` | 1 | clue 0 with an open side | open sides → cross | the cell |
| `clue-satisfied` | 1 | clue k ≥ 1, lines = k, open sides remain | open sides → cross | the cell |
| `clue-needs-all` | 1 | lines + open = k, open sides remain | open sides → line | the cell |
| `corner-1` / `corner-3` | 1 | clue 1/3; at one corner dot both edges outside the cell are crossed or off the board; one of the cell's two sides there is open | both sides at that corner → cross (1) / line (3) | the cell, the corner dot |
| `dot-full` | 1 | dot with 2 lines and an open edge | open edges → cross | the dot |
| `dot-continue` | 1 | dot with 1 line and exactly 1 open edge | it → line | the dot |
| `dot-dead-end` | 1 | dot with 0 lines and exactly 1 open edge | it → cross | the dot |
| `premature-loop` | 1 | dot `d` with 1 line, ≥ 2 open edges, one open edge leads to `mate[d]`, and closing there would not be a full solution | that edge → cross | `d`, `mate[d]` |
| `loop-complete` | 1 | `closed` and open edges remain | all open edges → cross | none |
| `adjacent-3s` | 2 | two 3s sharing a side | the two outer sides parallel to the shared side → line; the edges continuing the shared side past both ends → cross | both cells |
| `diagonal-3s` | 2 | two 3s touching at one corner | each cell's two sides at its far corner → line | both cells |
| `parity` | 3 | open edge whose two cells have a known relative side (inside/outside) | line if the sides differ, else cross | its cells (outside excluded) |
| `lookahead` | 4 | assuming one state for an open edge and running tier 1 gives a contradiction | the other state | the edge's two dots, plus the cell or dot where the contradiction showed (if any) |

Contradictions (no step): a cell with more lines than its clue or too few possible; a dot with 3+ lines, or 1 line and no open edge; every edge decided with no closed loop (an empty board); `set()` failures above; parity inconsistency; **connectivity**: walking from a line over non-crossed edges must reach every line and an open side of every clue above 0 (skipped until the first line exists, because before that a clue's open sides may lie in different regions — see the regression test).

Notes on soundness:

- **Adjacent 3s do not claim the shared side.** The common rule "the shared side is a line" fails when the whole solution is the rectangle around both cells (2×1 `"33"`: the shared side is crossed). Outer sides and the continuations are forced in both cases (a dot-degree argument), so only those are set; the shared side follows from the other rules when it is forced. A unit test pins this.
- **Corner rule**: when both outside edges at a corner are crossed, the cell's two sides there are equal (a line on one must continue on the other). A 1 cannot have both, a 3 must have at least one of each corner pair.
- **Diagonal 3s**: the shared dot's four edges are exactly the inner sides of both cells; each 3 has at least one line there, the dot can take only two, so each cell's single non-line is at the shared dot.
- **Parity**: union-find with parity over cells plus one "outside" node; a line links different sides, a cross the same side.

### Tiers and order (`propagate`)

`solveRoot(lookahead)` = `local()` → `applyPatterns()` (tier 2, once) → `propagate(lookahead)`; `propagate` loops: `local()` (tier 1 to fixpoint) → if `closed` done → `parity()`; if it set anything, restart → `connected()` (contradiction only) → if lookahead: `lookahead()`; if it set anything, restart → done. Going back to tier 1 after every change makes steps come out roughly easiest first, which is what hints want. The initial worklist holds every cell, then every dot, so steps on an empty board start with clue rules in reading order.

**Lookahead** (depth 1): for each open edge, round-robin from where the last scan stopped, try Line then Cross; each probe is `mark` → `set` → `local()` → `undo`, with step recording off. Probes use tier 1 only (parity and connectivity are O(edges) and would make each probe expensive). The first contradiction fixes the edge the other way and returns; a full scan without one ends the tier. Each probe calls `budget.tick()`.

**Search** (verifier, after `solveRoot(true)` is consistent and not closed): iterative DFS with an explicit stack of `{mark, pos, triedLine}`. Branch on the first open edge in **reading order** (row r's horizontal edges, then the vertical edges below them), **cross first**, then line; each node runs `propagate(false)` (tiers 1 and 3, connectivity, no lookahead). Edges before the parent's branch position are already decided, so the scan resumes there. A node with `closed` is a solution; stop at two. Each node calls `budget.node()`.

Why this search: on puzzles from random loops keeping 10%, 20% and 30% of their clues (10 boards each, 30 per size), the first prototype (branch at the lowest-numbered path end, line first, no connectivity check) left 2/30 at 10×10, 9/30 at 15×15, 14/30 at 20×20 and 25/30 at 30×30 `unknown` with a 2 s limit. Reading order + cross first + the connectivity check left 0/30, 1/30, 2/30 and 10/30 with a 1 s limit (all multiple-solution boards). Lookahead at every node was much slower in a spot check (a 30×30 board keeping 30% of its clues went from `multiple` in 0.7 s to `unknown` at 10 s).

**Budget**: `deadline = now() + timeLimitMs`; `tick()` throws `SolverStop("budget")` when `now() > deadline`; `node()` also counts nodes against `maxNodes`. `solve`/`verify` catch `SolverStop` and return `incomplete` / `unknown`. `now` defaults to `Date.now` (in ES lib; `performance` is not in core's typecheck). Tests pass a fake clock (`() => t++`), which makes budget behaviour deterministic.

### Measured performance (this machine, prototype = the code below)

| Case | Result |
|---|---|
| Every clue of a random loop, 10/30/100 sides (rules alone, no search) | `unique`; 100×100 median ≈ 3 ms |
| Minimal rule-solvable clue sets (clues removed greedily while `solve` still solves; lookahead-heavy): 10×10 (≈ 31% clues), 30×30 (≈ 20%), 50×50 (18%: 223 lookahead steps, 27,516 probes) | `unique`; ≈ 0.3 ms, ≈ 5 ms, ≈ 25 ms |
| Minimal rule-solvable 100×100 (16% clues: 800 lookahead steps, 263,004 probes) | `unique` in ≈ 355 ms (`solve` ≈ 361 ms). Building it by greedy removal took ≈ 30 min (10,000 full solves), so WT3 needs a cheaper removal strategy at this size |
| 100×100 keeping 70% of a loop's clues | `multiple` in ≈ 15–20 ms |
| 100×100 with no clues | `multiple` in ≈ 1.7 s (10,001 search nodes) |
| 100×100 keeping 30% / 10% of a loop's clues, 10 s limit | `unknown` at 10,001–10,003 ms (deadline honoured) |
| `bun run check` test phase | ≈ 3 s (was ≈ 0.3 s); the FR-5 agreement file is ≈ 2 s of it |

A search node at 100×100 costs ≈ 0.4–0.8 ms (parity and connectivity are O(edges) per node).

## Rules for the implementer

- Run every command from the worktree root: `cd /home/jhonnold/projects/loophole-wt/core-solver`.
- Bun is not on PATH by default. Start every shell command that uses `bun` with `export PATH="$HOME/.bun/bin:$PATH";`.
- Run `bun install` once before step 1. It must not change `bun.lock`.
- Create each file with exactly the content given. Blocks fenced with `~~~~` are file contents, verbatim (2-space indent, LF, final newline). Do not "improve" the code: the expected steps, edge numbers, statuses and stats in the tests were produced by running exactly this code, and every literal puzzle's solution count was checked with `bruteForceSolutions`.
- No new dependencies.
- Leave `docs/plans/02-core-solver.md` (this file) unchanged.
- Make the commits below, in order, with the exact messages given. Do not push. Stage only the files each step names (`git add <paths>`).
- After each step run its verification. If anything differs from what is expected, fix the cause before going on. Do not skip a check and do not weaken a test. Property tests use random seeds: if one fails, it printed a seed and a counterexample — stop and report it rather than retrying.
- If `bun run lint` reports formatting differences in a file you created, run `bun run format`, then confirm with `git diff` that only whitespace/wrapping changed.

---

## Step 1 — Rule ids and the step type

### 1.1 `packages/core/src/rules.ts` (new)

~~~~ts
import type { EdgeState } from "./grid.ts";

/**
 * The named deductions the rule solver uses (PRD FR-3), with a short explanation of each for hints
 * (FR-6, FR-12). A solver step names its rule by id; the UI shows the text and highlights the
 * step's cells and dots.
 */
export const RULE_IDS = [
  "clue-zero",
  "clue-satisfied",
  "clue-needs-all",
  "dot-full",
  "dot-continue",
  "dot-dead-end",
  "corner-1",
  "corner-3",
  "adjacent-3s",
  "diagonal-3s",
  "premature-loop",
  "loop-complete",
  "parity",
  "lookahead",
] as const;

export type RuleId = (typeof RULE_IDS)[number];

export const RULE_TEXT: Readonly<Record<RuleId, string>> = {
  "clue-zero": "A 0 has no lines around it, so all four of its sides are crossed.",
  "clue-satisfied":
    "This number already has that many lines around it, so its remaining sides are crossed.",
  "clue-needs-all":
    "This number needs every side that is still open, so those sides are all lines.",
  "dot-full": "Two lines already meet at this dot, so its other edges are crossed.",
  "dot-continue": "The line that reaches this dot has to go on, and only one edge is left open.",
  "dot-dead-end":
    "No line reaches this dot and only one edge is open, so the loop cannot pass through it.",
  "corner-1":
    "The loop cannot enter this corner from outside, and a 1 cannot use both sides there, so both are crossed.",
  "corner-3":
    "The loop cannot enter this corner from outside, and a 3 must use at least one side there, so both are lines.",
  "adjacent-3s":
    "Two 3s side by side: their outer sides are lines, and the edges that continue their shared side are crossed.",
  "diagonal-3s": "Two 3s touching at a corner: the sides at their far corners are lines.",
  "premature-loop":
    "This edge would close a loop while other lines or numbers still need it, so it is crossed.",
  "loop-complete":
    "The loop is closed and every number is satisfied, so all other edges are crossed.",
  parity:
    "Known edges show whether these two cells are on the same side of the loop, which decides the edge between them.",
  lookahead:
    "Trying the other choice for this edge quickly leads to a contradiction, so it must be this way.",
};

/** One edge a step decided. */
export interface EdgeChange {
  readonly edge: number;
  readonly state: typeof EdgeState.Line | typeof EdgeState.Cross;
}

/**
 * One applied deduction. `changes` are the edges it set, in order. `cells` and `dots` are the
 * reason: the clue cells and dots a hint highlights.
 */
export interface Step {
  readonly rule: RuleId;
  readonly changes: readonly EdgeChange[];
  readonly cells: readonly number[];
  readonly dots: readonly number[];
}
~~~~

### 1.2 `packages/core/src/rules.test.ts` (new)

~~~~ts
import { describe, expect, test } from "bun:test";
import { RULE_IDS, RULE_TEXT } from "./rules.ts";

describe("rule ids", () => {
  test("are unique and each has an explanation", () => {
    expect(new Set(RULE_IDS).size).toBe(RULE_IDS.length);
    for (const id of RULE_IDS) expect(RULE_TEXT[id].length).toBeGreaterThan(20);
    expect(Object.keys(RULE_TEXT).sort()).toEqual([...RULE_IDS].sort());
  });
});
~~~~

### 1.3 `packages/core/src/index.ts` — append one line

Add at the end of the file:

~~~~ts
export * from "./rules.ts";
~~~~

### Verify

```sh
export PATH="$HOME/.bun/bin:$PATH"
bun test packages/core/src/rules.test.ts   # expect 1 pass, 0 fail
bun run check; echo "rc=$?"                # expect rc=0
```

Commit: `git add packages/core/src/rules.ts packages/core/src/rules.test.ts packages/core/src/index.ts && git commit -m "feat(core): add solver rule ids and hint text"`

---

## Step 2 — Deduction engine and `solve` (FR-3, FR-6)

### 2.1 `packages/core/src/engine.ts` (new)

~~~~ts
/**
 * The deduction engine shared by `solve` and `verify`. Not part of the public API.
 *
 * State is one `EdgeState` per edge plus, for every dot at the end of a line path, the dot at the
 * path's other end (`mate`) and the path's length in edges (`plen`). Every change is pushed on a
 * trail so lookahead probes and the verifier's search can undo back to a mark.
 *
 * Rules come in tiers, cheapest first:
 * 1. local rules on a worklist of cells and dots: clue rules, corner rules, dot degree,
 *    premature loop, loop complete
 * 2. the 3s patterns, which depend only on the clues and are applied once
 * 3. inside/outside parity, a union-find over cells (global), then a connectivity check that
 *    only detects contradictions (global)
 * 4. lookahead: assume an edge, run tier 1, and take the opposite on a contradiction
 * After any change the engine goes back to tier 1, so steps come out roughly easiest first.
 */
import { EdgeState, type Grid, NONE } from "./grid.ts";
import { NO_CLUE, type Puzzle } from "./puzzle.ts";
import type { EdgeChange, RuleId, Step } from "./rules.ts";

const { Unknown, Line, Cross } = EdgeState;

/** Thrown to stop the engine early: out of time or search nodes, or `maxSteps` reached. */
export class SolverStop extends Error {
  constructor(readonly reason: "budget" | "steps") {
    super(`solver stopped: ${reason}`);
    this.name = "SolverStop";
  }
}

/** Time and node limits. `tick` is called once per lookahead probe, `node` once per search node. */
export class Budget {
  nodes = 0;

  constructor(
    private readonly now: () => number,
    private readonly deadline: number,
    private readonly maxNodes: number,
  ) {}

  tick(): void {
    if (this.now() > this.deadline) throw new SolverStop("budget");
  }

  node(): void {
    this.nodes++;
    if (this.nodes > this.maxNodes) throw new SolverStop("budget");
    this.tick();
  }
}

export interface Mark {
  readonly edges: number;
  readonly ends: number;
  readonly closed: boolean;
}

interface Pattern {
  readonly rule: RuleId;
  readonly cells: readonly number[];
  readonly lines: readonly number[];
  readonly crosses: readonly number[];
}

const dotCellsCache = new WeakMap<Grid, Int32Array>();

/** 4 entries per dot: the cells up-left, up-right, down-right, down-left of it, `NONE` off the board. */
function dotCells(grid: Grid): Int32Array {
  const cached = dotCellsCache.get(grid);
  if (cached !== undefined) return cached;
  const W = grid.width;
  const H = grid.height;
  const t = new Int32Array(grid.dotCount * 4).fill(NONE);
  for (let r = 0; r <= H; r++) {
    for (let c = 0; c <= W; c++) {
      const k = (r * (W + 1) + c) * 4;
      if (r > 0 && c > 0) t[k] = (r - 1) * W + c - 1;
      if (r > 0 && c < W) t[k + 1] = (r - 1) * W + c;
      if (r < H && c < W) t[k + 2] = r * W + c;
      if (r < H && c > 0) t[k + 3] = r * W + c - 1;
    }
  }
  dotCellsCache.set(grid, t);
  return t;
}

export class Engine {
  readonly grid: Grid;
  readonly clues: Int8Array;
  readonly edges: Uint8Array;
  /** Set when a loop has closed; it was checked to be a full solution. */
  closed = false;
  /** Lookahead probes run so far. */
  probes = 0;
  /** Recorded steps, or null when not recording. */
  steps: Step[] | null = null;
  maxSteps = Number.POSITIVE_INFINITY;

  private readonly dotCells: Int32Array;
  private readonly mate: Int32Array;
  private readonly plen: Int32Array;
  private lineCount = 0;
  private readonly edgeTrail: number[] = [];
  private readonly endTrail: number[] = [];
  private readonly queue: Int32Array;
  private readonly inQueue: Uint8Array;
  private qHead = 0;
  private qLen = 0;
  /** Worklist item (cell, or cellCount + dot) where the last contradiction was found, or NONE. */
  private conflict = NONE;
  private pending: EdgeChange[] | null = null;
  private pendingRule: RuleId = "clue-zero";
  private pendingCells: readonly number[] = [];
  private pendingDots: readonly number[] = [];
  private readonly patterns: Pattern[];
  private readonly ufParent: Int32Array;
  private readonly ufParity: Uint8Array;
  private ufFound = 0;
  private readonly seen: Uint8Array;
  private readonly order: Int32Array;
  private readonly stack: Int32Array;
  private lookCursor = 0;

  constructor(
    puzzle: Puzzle,
    private readonly budget: Budget,
  ) {
    const grid = puzzle.grid;
    this.grid = grid;
    this.clues = puzzle.clues;
    this.edges = new Uint8Array(grid.edgeCount);
    this.dotCells = dotCells(grid);
    this.mate = new Int32Array(grid.dotCount);
    this.plen = new Int32Array(grid.dotCount);
    const items = grid.cellCount + grid.dotCount;
    this.queue = new Int32Array(items);
    this.inQueue = new Uint8Array(items);
    for (let x = 0; x < items; x++) this.enqueue(x);
    this.patterns = buildPatterns(grid, puzzle.clues);
    this.ufParent = new Int32Array(grid.cellCount + 1);
    this.ufParity = new Uint8Array(grid.cellCount + 1);
    this.seen = new Uint8Array(grid.dotCount);
    this.stack = new Int32Array(grid.dotCount);
    this.order = readingOrder(grid);
  }

  /** Applies a starting board (for example a player's progress). False if it breaks a rule. */
  load(initial: Uint8Array): boolean {
    if (initial.length !== this.grid.edgeCount) {
      throw new RangeError(`expected ${this.grid.edgeCount} edge states, got ${initial.length}`);
    }
    for (let e = 0; e < initial.length; e++) {
      const s = initial[e];
      if (s === Line || s === Cross) {
        if (!this.set(e, s)) return false;
      } else if (s !== Unknown) {
        throw new RangeError(`edge ${e} has invalid state ${s}`);
      }
    }
    return true;
  }

  /** Runs every rule tier to a fixpoint. False on a contradiction. */
  solveRoot(lookahead: boolean): boolean {
    return this.local() && this.applyPatterns() && this.propagate(lookahead);
  }

  /** Tiers 1, 3 and (optionally) 4 until nothing changes. False on a contradiction. */
  propagate(lookahead: boolean): boolean {
    for (;;) {
      if (!this.local()) return false;
      if (this.closed) return true;
      const p = this.parity();
      if (p < 0) return false;
      if (p > 0) continue;
      if (!this.connected()) return false;
      if (!lookahead) return true;
      const q = this.lookahead();
      if (q < 0) return false;
      if (q > 0) continue;
      return true;
    }
  }

  mark(): Mark {
    return { edges: this.edgeTrail.length, ends: this.endTrail.length, closed: this.closed };
  }

  undo(m: Mark): void {
    const { edges, mate, plen, edgeTrail, endTrail } = this;
    while (endTrail.length > m.ends) {
      const len = endTrail.pop() as number;
      const old = endTrail.pop() as number;
      const d = endTrail.pop() as number;
      mate[d] = old;
      plen[d] = len;
    }
    while (edgeTrail.length > m.edges) {
      const e = edgeTrail.pop() as number;
      if (edges[e] === Line) this.lineCount--;
      edges[e] = Unknown;
    }
    this.closed = m.closed;
    this.clearQueue();
    this.conflict = NONE;
  }

  /**
   * Sets an unknown edge. Keeps path ends up to date and returns false when the change breaks a
   * rule on the spot: a third line at a dot, a line after the loop closed, or a loop that closes
   * without being a full solution. Other checks happen when the worklist runs.
   */
  set(e: number, state: EdgeState): boolean {
    const { grid, edges, mate, plen } = this;
    edges[e] = state;
    this.edgeTrail.push(e);
    const a = grid.edgeDots[e * 2];
    const b = grid.edgeDots[e * 2 + 1];
    this.touch(a);
    this.touch(b);
    if (state !== Line) return true;
    this.lineCount++;
    const da = this.degree(a) - 1;
    const db = this.degree(b) - 1;
    if (da >= 2 || db >= 2 || this.closed) return false;
    if (da === 1 && db === 1 && mate[a] === b) {
      // This line closes a path into a loop: fine only if the loop is everything.
      if (plen[a] + 1 !== this.lineCount || !this.cluesSatisfied(NONE)) return false;
      this.closed = true;
      return true;
    }
    const ea = da === 0 ? a : mate[a];
    const eb = db === 0 ? b : mate[b];
    const len = (da === 0 ? 0 : plen[a]) + (db === 0 ? 0 : plen[b]) + 1;
    this.saveEnd(ea);
    this.saveEnd(eb);
    mate[ea] = eb;
    mate[eb] = ea;
    plen[ea] = len;
    plen[eb] = len;
    return true;
  }

  /**
   * The verifier's search branches on edges in reading order: each row's horizontal edges, then the
   * vertical edges below them. Returns the first position at or after `from` in that order whose
   * edge is open, or -1.
   */
  nextOpen(from: number): number {
    const { order, edges } = this;
    for (let p = from; p < order.length; p++) if (edges[order[p]] === Unknown) return p;
    return NONE;
  }

  /** The edge at position `p` of the reading order. */
  edgeAt(p: number): number {
    return this.order[p];
  }

  // --- tier 1: worklist rules ---------------------------------------------------------------

  /** Runs the worklist dry. False on a contradiction. */
  local(): boolean {
    const C = this.grid.cellCount;
    for (;;) {
      while (this.qLen > 0) {
        const x = this.dequeue();
        const ok = x < C ? this.cellRule(x) : this.dotRule(x - C);
        if (!ok) {
          this.conflict = x;
          this.clearQueue();
          return false;
        }
      }
      if (this.closed) {
        if (this.edgeTrail.length === this.grid.edgeCount) return true;
        this.begin("loop-complete", [], []);
        for (let e = 0; e < this.grid.edgeCount; e++) {
          if (this.edges[e] === Unknown) this.assign(e, Cross);
        }
        this.commit();
        continue;
      }
      // Every edge decided and no loop: the board has no lines at all.
      if (this.edgeTrail.length === this.grid.edgeCount) {
        this.conflict = NONE;
        return false;
      }
      return true;
    }
  }

  private cellRule(i: number): boolean {
    const k = this.clues[i];
    if (k === NO_CLUE) return true;
    const { cellEdges } = this.grid;
    let lines = 0;
    let unknown = 0;
    for (let j = 0; j < 4; j++) {
      const s = this.edges[cellEdges[i * 4 + j]];
      if (s === Line) lines++;
      else if (s === Unknown) unknown++;
    }
    if (lines > k || lines + unknown < k) return false;
    if (unknown === 0) return true;
    if (lines === k) return this.fillCell(i, Cross, k === 0 ? "clue-zero" : "clue-satisfied");
    if (lines + unknown === k) return this.fillCell(i, Line, "clue-needs-all");
    if (k === 1 || k === 3) {
      const { edgeDots } = this.grid;
      const t = cellEdges[i * 4];
      const r = cellEdges[i * 4 + 1];
      const b = cellEdges[i * 4 + 2];
      const l = cellEdges[i * 4 + 3];
      return (
        this.corner(i, k, t, l, edgeDots[t * 2], 0, 3) &&
        this.corner(i, k, t, r, edgeDots[t * 2 + 1], 0, 1) &&
        this.corner(i, k, b, r, edgeDots[b * 2 + 1], 2, 1) &&
        this.corner(i, k, b, l, edgeDots[b * 2], 2, 3)
      );
    }
    return true;
  }

  private fillCell(i: number, state: EdgeState, rule: RuleId): boolean {
    this.begin(rule, [i], []);
    for (let j = 0; j < 4; j++) {
      const e = this.grid.cellEdges[i * 4 + j];
      if (this.edges[e] === Unknown && !this.assign(e, state)) return false;
    }
    this.commit();
    return true;
  }

  /**
   * Corner rule for a 1 or a 3. `e1` and `e2` are the cell's sides at corner dot `d`; `o1` and `o2`
   * are the `dotEdges` slots of the dot's two edges outside the cell. When both outside edges are
   * crossed or off the board, the loop cannot turn into the corner from outside, so `e1` and `e2`
   * are both lines or both crosses: both lines for a 3, both crosses for a 1.
   */
  private corner(
    i: number,
    k: number,
    e1: number,
    e2: number,
    d: number,
    o1: number,
    o2: number,
  ): boolean {
    const { edges } = this;
    if (edges[e1] !== Unknown && edges[e2] !== Unknown) return true;
    const x = this.grid.dotEdges[d * 4 + o1];
    const y = this.grid.dotEdges[d * 4 + o2];
    if ((x !== NONE && edges[x] !== Cross) || (y !== NONE && edges[y] !== Cross)) return true;
    const state = k === 3 ? Line : Cross;
    this.begin(k === 3 ? "corner-3" : "corner-1", [i], [d]);
    if (!this.assign(e1, state) || !this.assign(e2, state)) return false;
    this.commit();
    return true;
  }

  private dotRule(d: number): boolean {
    const { grid, edges } = this;
    let lines = 0;
    let unknown = 0;
    for (let j = 0; j < 4; j++) {
      const e = grid.dotEdges[d * 4 + j];
      if (e === NONE) continue;
      if (edges[e] === Line) lines++;
      else if (edges[e] === Unknown) unknown++;
    }
    if (lines > 2) return false;
    if (unknown === 0) return lines !== 1;
    if (lines === 2) return this.fillDot(d, Cross, "dot-full");
    if (lines === 0) return unknown === 1 ? this.fillDot(d, Cross, "dot-dead-end") : true;
    if (unknown === 1) return this.fillDot(d, Line, "dot-continue");
    // One line ends here. An open edge to the other end of its path would close a loop.
    const m = this.mate[d];
    for (let j = 0; j < 4; j++) {
      const e = grid.dotEdges[d * 4 + j];
      if (e === NONE || edges[e] !== Unknown) continue;
      const other = grid.edgeDots[e * 2] === d ? grid.edgeDots[e * 2 + 1] : grid.edgeDots[e * 2];
      if (other !== m) continue;
      if (this.plen[d] === this.lineCount && this.cluesSatisfied(e)) return true;
      this.begin("premature-loop", [], [d, m]);
      if (!this.assign(e, Cross)) return false;
      this.commit();
      return true;
    }
    return true;
  }

  private fillDot(d: number, state: EdgeState, rule: RuleId): boolean {
    this.begin(rule, [], [d]);
    for (let j = 0; j < 4; j++) {
      const e = this.grid.dotEdges[d * 4 + j];
      if (e !== NONE && this.edges[e] === Unknown && !this.assign(e, state)) return false;
    }
    this.commit();
    return true;
  }

  // --- tier 2: 3s patterns ------------------------------------------------------------------

  private applyPatterns(): boolean {
    for (const p of this.patterns) {
      this.begin(p.rule, p.cells, []);
      for (const e of p.lines) if (!this.assign(e, Line)) return false;
      for (const e of p.crosses) if (!this.assign(e, Cross)) return false;
      this.commit();
    }
    return this.local();
  }

  // --- tier 3: inside/outside parity --------------------------------------------------------

  /**
   * Every cell is inside or outside the loop, and everything beyond the border is outside. A line
   * separates cells of different sides, a cross joins cells of the same side. Union-find with
   * parity over the cells plus one "outside" node (index cellCount) links cells whose relative
   * side is known; an open edge between two linked cells is then decided. Returns the number of
   * edges set, or -1 on a contradiction.
   */
  private parity(): number {
    const { grid, edges, ufParent, ufParity } = this;
    const C = grid.cellCount;
    for (let i = 0; i <= C; i++) {
      ufParent[i] = i;
      ufParity[i] = 0;
    }
    for (let e = 0; e < grid.edgeCount; e++) {
      const s = edges[e];
      if (s === Unknown) continue;
      const a = this.ufFind(sideNode(grid, e, 0));
      const pa = this.ufFound;
      const b = this.ufFind(sideNode(grid, e, 1));
      const pb = this.ufFound;
      const differ = s === Line ? 1 : 0;
      if (a === b) {
        if ((pa ^ pb) !== differ) return -1;
      } else {
        ufParent[a] = b;
        ufParity[a] = pa ^ pb ^ differ;
      }
    }
    let count = 0;
    for (let e = 0; e < grid.edgeCount; e++) {
      if (edges[e] !== Unknown) continue;
      const na = sideNode(grid, e, 0);
      const nb = sideNode(grid, e, 1);
      const a = this.ufFind(na);
      const pa = this.ufFound;
      const b = this.ufFind(nb);
      const pb = this.ufFound;
      if (a !== b) continue;
      const cells = [na, nb].filter((n) => n !== C);
      this.begin("parity", cells, []);
      if (!this.assign(e, pa !== pb ? Line : Cross)) return -1;
      this.commit();
      count++;
    }
    return count;
  }

  /** Root of `x`'s set; leaves the parity of `x` relative to the root in `ufFound`. */
  private ufFind(x: number): number {
    const { ufParent, ufParity } = this;
    let root = x;
    let p = 0;
    while (ufParent[root] !== root) {
      p ^= ufParity[root];
      root = ufParent[root];
    }
    // Path compression: point every node on the way straight at the root.
    let cur = x;
    let cp = p;
    while (ufParent[cur] !== cur) {
      const next = ufParent[cur];
      const np = cp ^ ufParity[cur];
      ufParent[cur] = root;
      ufParity[cur] = cp;
      cur = next;
      cp = np;
    }
    this.ufFound = p;
    return root;
  }

  /**
   * False when the loop cannot be one piece: walking from a line along edges that are not crossed
   * must reach every other line and an open side of every clue above 0. Does nothing before the
   * first line is drawn (a clue's sides can then lie in different regions).
   */
  private connected(): boolean {
    const { grid, edges, clues, seen, stack } = this;
    const first = edges.indexOf(Line);
    if (first < 0) return true;
    const seed = grid.edgeDots[first * 2];
    seen.fill(0);
    seen[seed] = 1;
    stack[0] = seed;
    let top = 1;
    while (top > 0) {
      const d = stack[--top];
      for (let j = 0; j < 4; j++) {
        const e = grid.dotEdges[d * 4 + j];
        if (e === NONE || edges[e] === Cross) continue;
        const o = grid.edgeDots[e * 2] === d ? grid.edgeDots[e * 2 + 1] : grid.edgeDots[e * 2];
        if (!seen[o]) {
          seen[o] = 1;
          stack[top++] = o;
        }
      }
    }
    for (let e = 0; e < grid.edgeCount; e++) {
      if (edges[e] === Line && !seen[grid.edgeDots[e * 2]]) return false;
    }
    for (let i = 0; i < grid.cellCount; i++) {
      if (clues[i] <= 0) continue;
      let reached = false;
      for (let j = 0; j < 4 && !reached; j++) {
        const e = grid.cellEdges[i * 4 + j];
        reached = edges[e] !== Cross && seen[grid.edgeDots[e * 2]] === 1;
      }
      if (!reached) return false;
    }
    return true;
  }

  // --- tier 4: lookahead --------------------------------------------------------------------

  /**
   * Tries each open edge both ways, running only the worklist rules after each assumption. If
   * one way leads to a contradiction the edge takes the other state. Scans round-robin from where
   * the last scan stopped. Returns 1 after a deduction, 0 when a full scan finds none, -1 when the
   * deduction itself contradicts.
   */
  private lookahead(): number {
    const E = this.grid.edgeCount;
    const recording = this.steps;
    for (let k = 0; k < E; k++) {
      const e = (this.lookCursor + k) % E;
      if (this.edges[e] !== Unknown) continue;
      for (const assumed of [Line, Cross]) {
        this.budget.tick();
        this.probes++;
        const m = this.mark();
        this.steps = null;
        const ok = this.set(e, assumed) && this.local();
        const site = this.conflict;
        this.steps = recording;
        this.undo(m);
        if (ok) continue;
        this.lookCursor = (e + 1) % E;
        const C = this.grid.cellCount;
        const a = this.grid.edgeDots[e * 2];
        const b = this.grid.edgeDots[e * 2 + 1];
        const cells = site !== NONE && site < C ? [site] : [];
        const dots = site !== NONE && site >= C ? [a, b, site - C] : [a, b];
        this.begin("lookahead", cells, dots);
        if (!this.assign(e, assumed === Line ? Cross : Line)) return -1;
        this.commit();
        return 1;
      }
    }
    return 0;
  }

  // --- helpers ------------------------------------------------------------------------------

  /** Sets an edge on behalf of a rule, recording it in the current step. */
  private assign(e: number, state: EdgeState): boolean {
    const cur = this.edges[e];
    if (cur === state) return true;
    if (cur !== Unknown) return false;
    this.pending?.push({ edge: e, state: state as EdgeChange["state"] });
    return this.set(e, state);
  }

  private begin(rule: RuleId, cells: readonly number[], dots: readonly number[]): void {
    if (this.steps === null) {
      this.pending = null;
      return;
    }
    this.pending = [];
    this.pendingRule = rule;
    this.pendingCells = cells;
    this.pendingDots = dots;
  }

  private commit(): void {
    const steps = this.steps;
    const changes = this.pending;
    this.pending = null;
    if (steps === null || changes === null || changes.length === 0) return;
    steps.push({
      rule: this.pendingRule,
      changes,
      cells: this.pendingCells,
      dots: this.pendingDots,
    });
    if (steps.length >= this.maxSteps) throw new SolverStop("steps");
  }

  /** True when every clue has exactly its number of lines, counting `extra` (or NONE) as a line too. */
  private cluesSatisfied(extra: number): boolean {
    const { grid, clues, edges } = this;
    for (let i = 0; i < grid.cellCount; i++) {
      const k = clues[i];
      if (k === NO_CLUE) continue;
      let lines = 0;
      for (let j = 0; j < 4; j++) {
        const e = grid.cellEdges[i * 4 + j];
        if (edges[e] === Line || e === extra) lines++;
      }
      if (lines !== k) return false;
    }
    return true;
  }

  private degree(d: number): number {
    let n = 0;
    for (let j = 0; j < 4; j++) {
      const e = this.grid.dotEdges[d * 4 + j];
      if (e !== NONE && this.edges[e] === Line) n++;
    }
    return n;
  }

  private saveEnd(d: number): void {
    this.endTrail.push(d, this.mate[d], this.plen[d]);
  }

  /** Queues a dot and the cells around it after one of its edges changed. */
  private touch(d: number): void {
    this.enqueue(this.grid.cellCount + d);
    for (let j = 0; j < 4; j++) {
      const c = this.dotCells[d * 4 + j];
      if (c !== NONE) this.enqueue(c);
    }
  }

  private enqueue(x: number): void {
    if (this.inQueue[x]) return;
    this.inQueue[x] = 1;
    this.queue[(this.qHead + this.qLen) % this.queue.length] = x;
    this.qLen++;
  }

  private dequeue(): number {
    const x = this.queue[this.qHead];
    this.qHead = (this.qHead + 1) % this.queue.length;
    this.qLen--;
    this.inQueue[x] = 0;
    return x;
  }

  private clearQueue(): void {
    while (this.qLen > 0) this.dequeue();
  }
}

/** Edges row by row: horizontal edges of row r left to right, then the vertical edges below them. */
function readingOrder(grid: Grid): Int32Array {
  const W = grid.width;
  const order = new Int32Array(grid.edgeCount);
  let p = 0;
  for (let r = 0; r <= grid.height; r++) {
    for (let c = 0; c < W; c++) order[p++] = r * W + c;
    if (r < grid.height)
      for (let c = 0; c <= W; c++) order[p++] = grid.hEdgeCount + r * (W + 1) + c;
  }
  return order;
}

/** The union-find node on side `k` (0 or 1) of edge `e`: a cell, or cellCount for outside. */
function sideNode(grid: Grid, e: number, k: number): number {
  const c = grid.edgeCells[e * 2 + k];
  return c === NONE ? grid.cellCount : c;
}

/**
 * Adjacent 3s (sharing a side): both outer sides parallel to the shared side are lines, and the
 * edges continuing the shared side beyond its ends are crossed. Diagonal 3s (sharing only a dot):
 * the two sides of each cell at the corner away from the other are lines.
 */
function buildPatterns(grid: Grid, clues: Int8Array): Pattern[] {
  const W = grid.width;
  const H = grid.height;
  const { cellEdges, edgeDots, dotEdges } = grid;
  const out: Pattern[] = [];
  const is3 = (r: number, c: number) =>
    r >= 0 && r < H && c >= 0 && c < W && clues[r * W + c] === 3;
  const present = (es: number[]) => es.filter((e) => e !== NONE);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (!is3(r, c)) continue;
      const a = r * W + c;
      if (is3(r, c + 1)) {
        const b = a + 1;
        const shared = cellEdges[a * 4 + 1];
        out.push({
          rule: "adjacent-3s",
          cells: [a, b],
          lines: [cellEdges[a * 4 + 3], cellEdges[b * 4 + 1]],
          crosses: present([
            dotEdges[edgeDots[shared * 2] * 4],
            dotEdges[edgeDots[shared * 2 + 1] * 4 + 2],
          ]),
        });
      }
      if (is3(r + 1, c)) {
        const b = a + W;
        const shared = cellEdges[a * 4 + 2];
        out.push({
          rule: "adjacent-3s",
          cells: [a, b],
          lines: [cellEdges[a * 4], cellEdges[b * 4 + 2]],
          crosses: present([
            dotEdges[edgeDots[shared * 2] * 4 + 3],
            dotEdges[edgeDots[shared * 2 + 1] * 4 + 1],
          ]),
        });
      }
      if (is3(r + 1, c + 1)) {
        const b = a + W + 1;
        out.push({
          rule: "diagonal-3s",
          cells: [a, b],
          lines: [
            cellEdges[a * 4],
            cellEdges[a * 4 + 3],
            cellEdges[b * 4 + 1],
            cellEdges[b * 4 + 2],
          ],
          crosses: [],
        });
      }
      if (is3(r + 1, c - 1)) {
        const b = a + W - 1;
        out.push({
          rule: "diagonal-3s",
          cells: [a, b],
          lines: [
            cellEdges[a * 4],
            cellEdges[a * 4 + 1],
            cellEdges[b * 4 + 2],
            cellEdges[b * 4 + 3],
          ],
          crosses: [],
        });
      }
    }
  }
  return out;
}
~~~~

### 2.2 `packages/core/src/solver.ts` (new)

~~~~ts
import { Budget, Engine, SolverStop } from "./engine.ts";
import type { Puzzle } from "./puzzle.ts";
import type { Step } from "./rules.ts";

/**
 * - `solved`: the rules decided every edge; the result is the puzzle's only solution.
 * - `stuck`: no rule applies any more and some edges are still open.
 * - `contradiction`: the clues (with `initial`) break a rule, so there is no solution.
 * - `incomplete`: stopped early by `maxSteps` or the time limit.
 */
export type SolveStatus = "solved" | "stuck" | "contradiction" | "incomplete";

export interface SolveOptions {
  /** Starting edge states, for example a player's board. Defaults to all unknown. Not modified. */
  readonly initial?: Uint8Array;
  /** Use bounded lookahead when the other rules are stuck. Default true. */
  readonly lookahead?: boolean;
  /** Stop after recording this many steps. Default no limit. */
  readonly maxSteps?: number;
  /** Stop after this many milliseconds, measured with `now`. Default no limit. */
  readonly timeLimitMs?: number;
  /** Clock in milliseconds. Default `Date.now`. */
  readonly now?: () => number;
}

export interface SolveResult {
  readonly status: SolveStatus;
  /** Every deduction applied, in order. */
  readonly steps: Step[];
  /** Edge states when the solver stopped. */
  readonly edges: Uint8Array;
}

/**
 * Applies named deductions until the puzzle is solved or no rule applies (PRD FR-3), recording
 * each one as a step (FR-6). Every deduction is sound: it holds in every solution of the puzzle.
 * So `solved` proves the solution is unique without any guessing.
 */
export function solve(puzzle: Puzzle, options: SolveOptions = {}): SolveResult {
  const now = options.now ?? Date.now;
  const budget = new Budget(
    now,
    now() + (options.timeLimitMs ?? Number.POSITIVE_INFINITY),
    Number.POSITIVE_INFINITY,
  );
  const engine = new Engine(puzzle, budget);
  const steps: Step[] = [];
  engine.steps = steps;
  engine.maxSteps = options.maxSteps ?? Number.POSITIVE_INFINITY;
  let status: SolveStatus;
  try {
    const ok =
      (options.initial === undefined || engine.load(options.initial)) &&
      engine.solveRoot(options.lookahead ?? true);
    status = !ok ? "contradiction" : engine.closed ? "solved" : "stuck";
  } catch (err) {
    if (!(err instanceof SolverStop)) throw err;
    status = "incomplete";
  }
  return { status, steps, edges: engine.edges.slice() };
}
~~~~

### 2.3 `packages/core/src/index.ts` — append one line

~~~~ts
export * from "./solver.ts";
~~~~

### 2.4 `packages/core/src/solver.test.ts` (new)

The per-rule puzzles were found by scanning every clue assignment of grids up to 2×3 for small puzzles where each rule fires; each has exactly one solution (brute force) and `solve` solves it, so the expected steps are stable. `"2222"`'s solution is the `FIXTURES` entry `2x2 all twos`.

~~~~ts
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { analyzeBoard } from "./analyze.ts";
import { bruteForceSolutions } from "./bruteforce.ts";
import { decodeEdges, encodeEdges, parsePuzzle } from "./format.ts";
import { EdgeState } from "./grid.ts";
import { RULE_IDS, type RuleId, type Step } from "./rules.ts";
import { solve } from "./solver.ts";
import { arbPuzzleWithSolution } from "./test-support/arbitraries.ts";
import { FIXTURES } from "./test-support/fixtures.ts";

function puzzle(width: number, height: number, clues: string) {
  return parsePuzzle({ v: 1, width, height, clues });
}

/** A step written compactly: changes as "edge:state" pairs. */
function brief(step: Step) {
  return {
    rule: step.rule,
    changes: step.changes.map((c) => `${c.edge}:${c.state}`).join(" "),
    cells: step.cells,
    dots: step.dots,
  };
}

/** Replays steps from `initial` and checks each one only sets edges that were still unknown. */
function replay(edgeCount: number, steps: Step[], initial?: Uint8Array): Uint8Array {
  const edges = initial === undefined ? new Uint8Array(edgeCount) : initial.slice();
  for (const step of steps) {
    expect(step.changes.length).toBeGreaterThan(0);
    for (const { edge, state } of step.changes) {
      expect(edges[edge]).toBe(EdgeState.Unknown);
      edges[edge] = state;
    }
  }
  return edges;
}

describe("solve: each rule", () => {
  // [width, height, clues, step index, expected step]. Edge numbering: docs/FORMAT.md.
  const cases: [number, number, string, number, ReturnType<typeof brief>][] = [
    [2, 2, "0...", 0, { rule: "clue-zero", changes: "0:2 7:2 2:2 6:2", cells: [0], dots: [] }],
    [2, 2, "0...", 1, { rule: "dot-dead-end", changes: "1:2", cells: [], dots: [1] }],
    [1, 2, "3.", 0, { rule: "corner-3", changes: "0:1 3:1", cells: [0], dots: [0] }],
    [1, 2, "1.", 0, { rule: "corner-1", changes: "0:2 3:2", cells: [0], dots: [0] }],
    [1, 2, "3.", 2, { rule: "premature-loop", changes: "1:2", cells: [], dots: [2, 3] }],
    [1, 2, "3.", 3, { rule: "dot-continue", changes: "6:1", cells: [], dots: [3] }],
    [
      2,
      3,
      "..33..",
      0,
      { rule: "adjacent-3s", changes: "11:1 13:1 9:2 15:2", cells: [2, 3], dots: [] },
    ],
    [2, 3, "..33..", 1, { rule: "parity", changes: "12:2", cells: [2, 3], dots: [] }],
    [2, 3, "..33..", 2, { rule: "clue-needs-all", changes: "3:1 5:1", cells: [3], dots: [] }],
    [2, 3, "..33..", 4, { rule: "dot-full", changes: "10:2", cells: [], dots: [5] }],
    [2, 3, ".331..", 1, { rule: "diagonal-3s", changes: "4:1 11:1", cells: [1, 2], dots: [] }],
    [2, 3, ".331..", 4, { rule: "lookahead", changes: "0:2", cells: [2], dots: [0, 1] }],
    [2, 3, ".331..", 7, { rule: "clue-satisfied", changes: "3:2", cells: [1], dots: [] }],
    [
      2,
      3,
      "33....",
      8,
      { rule: "loop-complete", changes: "4:2 5:2 6:2 7:2 14:2 15:2 16:2", cells: [], dots: [] },
    ],
  ];

  for (const [w, h, clues, index, expected] of cases) {
    test(`${expected.rule} on ${w}×${h} "${clues}" (step ${index})`, () => {
      const result = solve(puzzle(w, h, clues));
      expect(result.status).toBe("solved");
      expect(brief(result.steps[index])).toEqual(expected);
    });
  }

  test("every rule id is covered above", () => {
    const covered = new Set<RuleId>(cases.map((c) => c[4].rule as RuleId));
    expect([...covered].sort()).toEqual([...RULE_IDS].sort());
  });

  test("two 3s side by side do not claim their shared side", () => {
    // The only solution is the rectangle around both cells, with the shared side crossed.
    const p = puzzle(2, 1, "33");
    const result = solve(p);
    expect(result.status).toBe("solved");
    expect(encodeEdges(result.edges)).toBe(encodeEdges(bruteForceSolutions(p)[0]));
    expect(result.edges[5]).toBe(EdgeState.Cross);
  });
});

describe("solve", () => {
  for (const f of FIXTURES) {
    test(`fixture ${f.name}: status fits the solution count and steps replay`, () => {
      const p = puzzle(f.width, f.height, f.clues);
      const result = solve(p);
      if (result.status === "solved") {
        expect(f.count).toBe(1);
        expect(analyzeBoard(p, result.edges).solved).toBe(true);
        if (f.solutions !== undefined) expect(encodeEdges(result.edges)).toBe(f.solutions[0]);
      }
      if (result.status === "contradiction") expect(f.count).toBe(0);
      else expect(replay(p.grid.edgeCount, result.steps)).toEqual(result.edges);
    });
  }

  test("stops at maxSteps", () => {
    const result = solve(puzzle(2, 2, "0..."), { maxSteps: 1 });
    expect(result.status).toBe("incomplete");
    expect(result.steps.map((s) => s.rule)).toEqual(["clue-zero"]);
  });

  test("stops when the time limit passes", () => {
    let t = 0;
    const result = solve(puzzle(3, 3, "........."), { timeLimitMs: 0, now: () => t++ });
    expect(result.status).toBe("incomplete");
  });

  test("without lookahead it can get stuck where lookahead solves", () => {
    const p = puzzle(2, 2, "2222");
    expect(solve(p, { lookahead: false }).status).toBe("stuck");
    expect(solve(p).status).toBe("solved");
  });

  test("continues from a partial board and leaves its edges alone", () => {
    const p = puzzle(2, 2, "2222");
    const solution = decodeEdges(p.grid, "112211121121");
    const initial = solution.map((s, e) => (e % 2 === 0 ? s : EdgeState.Unknown));
    const result = solve(p, { initial });
    expect(result.status).toBe("solved");
    expect(result.edges).toEqual(solution);
    expect(replay(p.grid.edgeCount, result.steps, initial)).toEqual(solution);
  });

  test("reports a contradiction for a board that breaks a rule", () => {
    const p = puzzle(2, 2, "2222");
    // A loop around cell 0 alone: closed too early.
    const initial = decodeEdges(p.grid, "101000110000");
    expect(solve(p, { initial }).status).toBe("contradiction");
  });

  test("rejects a malformed starting board", () => {
    const p = puzzle(2, 2, "....");
    expect(() => solve(p, { initial: new Uint8Array(11) })).toThrow(RangeError);
    expect(() => solve(p, { initial: new Uint8Array(12).fill(3) })).toThrow(RangeError);
  });

  test("from a correct partial board it never contradicts the solution", () => {
    fc.assert(
      fc.property(
        arbPuzzleWithSolution(4, 4),
        fc.array(fc.boolean(), { minLength: 40, maxLength: 40 }),
        ({ puzzle: p, solution }, given) => {
          const initial = solution.map((s, e) => (given[e] ? s : EdgeState.Unknown));
          const result = solve(p, { initial });
          expect(result.status).not.toBe("contradiction");
          expect(result.status).not.toBe("incomplete");
          result.edges.forEach((s, e) => {
            if (s !== EdgeState.Unknown) expect(s).toBe(solution[e]);
          });
        },
      ),
      { numRuns: 200 },
    );
  });
});
~~~~

### Verify

```sh
export PATH="$HOME/.bun/bin:$PATH"
bun test packages/core/src/solver.test.ts  # expect 40 pass, 0 fail
bun run check; echo "rc=$?"                # expect rc=0
```

Commit: `git add packages/core/src/engine.ts packages/core/src/solver.ts packages/core/src/solver.test.ts packages/core/src/index.ts && git commit -m "feat(core): add rule-based solver with a step log"`

---

## Step 3 — Verifier (FR-4, NFR-1)

### 3.1 `packages/core/src/verify.ts` (new)

~~~~ts
import { Budget, Engine, type Mark, SolverStop } from "./engine.ts";
import { EdgeState } from "./grid.ts";
import type { Puzzle } from "./puzzle.ts";

/** Default verification time limit (PRD NFR-1). */
export const DEFAULT_VERIFY_TIME_LIMIT_MS = 30_000;

/**
 * - `unique`: exactly one solution.
 * - `none`: no solution.
 * - `multiple`: at least two solutions.
 * - `unknown`: the time or node budget ran out before the answer was known.
 */
export type VerifyStatus = "unique" | "none" | "multiple" | "unknown";

export interface VerifyOptions {
  /** Give up with `unknown` after this many milliseconds, measured with `now`. Default 30 000. */
  readonly timeLimitMs?: number;
  /** Clock in milliseconds. Default `Date.now`. Tests pass a fake clock. */
  readonly now?: () => number;
  /** Give up with `unknown` after this many search nodes. Default no limit. */
  readonly maxNodes?: number;
}

export interface VerifyStats {
  /** Search nodes visited (0 when the rules alone decided the puzzle). */
  readonly nodes: number;
  /** Lookahead probes run. */
  readonly probes: number;
  readonly elapsedMs: number;
}

export interface VerifyResult {
  readonly status: VerifyStatus;
  /**
   * Solutions found, as full edge-state arrays: one for `unique`, two different ones for
   * `multiple`, none for `none`, and whatever was found before the budget ran out for `unknown`.
   */
  readonly solutions: Uint8Array[];
  readonly stats: VerifyStats;
}

/**
 * Decides how many solutions a puzzle has (PRD FR-4). Runs the rule solver first; if it gets
 * stuck, searches depth-first and stops at the second solution. Gives up with `unknown` when the
 * time or node budget runs out.
 */
export function verify(puzzle: Puzzle, options: VerifyOptions = {}): VerifyResult {
  const now = options.now ?? Date.now;
  const start = now();
  const budget = new Budget(
    now,
    start + (options.timeLimitMs ?? DEFAULT_VERIFY_TIME_LIMIT_MS),
    options.maxNodes ?? Number.POSITIVE_INFINITY,
  );
  const engine = new Engine(puzzle, budget);
  const solutions: Uint8Array[] = [];
  let status: VerifyStatus;
  try {
    if (engine.solveRoot(true)) search(engine, budget, solutions);
    status = solutions.length === 0 ? "none" : solutions.length === 1 ? "unique" : "multiple";
  } catch (err) {
    if (!(err instanceof SolverStop)) throw err;
    status = "unknown";
  }
  return {
    status,
    solutions,
    stats: { nodes: budget.nodes, probes: engine.probes, elapsedMs: now() - start },
  };
}

interface Frame {
  readonly mark: Mark;
  /** Position of the branch edge in the engine's reading order. */
  readonly pos: number;
  triedLine: boolean;
}

/**
 * Depth-first search from a propagated, consistent state, collecting up to two solutions. Branches
 * on the first open edge in reading order, cross first, and runs the rules without lookahead at
 * every node. Edges before a node's branch position are all decided, so the next scan starts
 * there. Uses an explicit stack because a 100×100 board can need thousands of nested branches.
 */
function search(engine: Engine, budget: Budget, solutions: Uint8Array[]): void {
  const stack: Frame[] = [];
  let ok = true;
  for (;;) {
    if (ok) {
      if (engine.closed) {
        solutions.push(engine.edges.slice());
        if (solutions.length >= 2) return;
      } else {
        budget.node();
        // An open edge exists: local() fails when every edge is decided and no loop closed.
        const pos = engine.nextOpen(stack.at(-1)?.pos ?? 0);
        stack.push({ mark: engine.mark(), pos, triedLine: false });
        ok = engine.set(engine.edgeAt(pos), EdgeState.Cross) && engine.propagate(false);
        continue;
      }
    }
    // Backtrack to the deepest branch that still has its line side to try.
    for (;;) {
      const top = stack.at(-1);
      if (top === undefined) return;
      engine.undo(top.mark);
      if (!top.triedLine) {
        top.triedLine = true;
        ok = engine.set(engine.edgeAt(top.pos), EdgeState.Line) && engine.propagate(false);
        break;
      }
      stack.pop();
    }
  }
}
~~~~

### 3.2 `packages/core/src/index.ts` — append one line

~~~~ts
export * from "./verify.ts";
~~~~

After this step `index.ts` ends with the three lines `export * from "./rules.ts";`, `export * from "./solver.ts";`, `export * from "./verify.ts";` (alphabetical, like the rest).

### 3.3 `packages/core/src/test-support/loops.ts` (new)

A test and benchmark helper, not a generator. The `canAdd` test keeps the grown region and its complement each 4-connected with no two cells meeting only at a corner, so the region's boundary is one simple loop; `verify.test.ts` checks that on 50 random boards.

~~~~ts
import { EdgeState, type Grid, NONE } from "../grid.ts";
import { createPuzzle, deriveClues, NO_CLUE, type Puzzle } from "../puzzle.ts";
import type { Rng } from "../rng.ts";

/**
 * A random single loop on `grid`: the boundary of a random 4-connected region of cells grown
 * from one cell until it covers about `coverage` of the board. A test and benchmark helper only;
 * the real loop generator is WT3's.
 *
 * A cell joins the region only when its 8 neighbours (off-board counts as outside), read around
 * the ring, hold exactly one run of inside cells and that run includes a side neighbour. That
 * keeps the inside and the outside each connected with no two cells meeting only at a corner, so
 * the boundary stays one simple loop.
 */
export function randomLoop(grid: Grid, rng: Rng, coverage = 0.5): Uint8Array {
  const W = grid.width;
  const H = grid.height;
  const inside = new Uint8Array(grid.cellCount);
  const at = (r: number, c: number) => (r >= 0 && r < H && c >= 0 && c < W ? inside[r * W + c] : 0);
  // Ring order: N, NE, E, SE, S, SW, W, NW. Even slots are side neighbours.
  const ring = [
    [-1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, -1],
  ];
  const canAdd = (r: number, c: number): boolean => {
    let runs = 0;
    let side = false;
    for (let k = 0; k < 8; k++) {
      const [dr, dc] = ring[k];
      const [pr, pc] = ring[(k + 7) % 8];
      const cur = at(r + dr, c + dc);
      if (cur && !at(r + pr, c + pc)) runs++;
      if (cur && k % 2 === 0) side = true;
    }
    return runs === 1 && side;
  };

  // Grow from a random cell, picking random cells next to the region. A cell that cannot join yet
  // is dropped and comes back when another of its neighbours joins.
  const target = Math.max(1, Math.floor(grid.cellCount * coverage));
  const frontier: number[] = [];
  const add = (i: number) => {
    inside[i] = 1;
    const r = Math.floor(i / W);
    const c = i % W;
    if (r > 0 && !inside[i - W]) frontier.push(i - W);
    if (r < H - 1 && !inside[i + W]) frontier.push(i + W);
    if (c > 0 && !inside[i - 1]) frontier.push(i - 1);
    if (c < W - 1 && !inside[i + 1]) frontier.push(i + 1);
  };
  add(rng.int(grid.cellCount));
  for (let size = 1; size < target && frontier.length > 0; ) {
    const k = rng.int(frontier.length);
    const i = frontier[k];
    frontier[k] = frontier[frontier.length - 1];
    frontier.pop();
    if (inside[i] || !canAdd(Math.floor(i / W), i % W)) continue;
    add(i);
    size++;
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

/**
 * A puzzle whose clues are derived from `loop`, keeping each clue with probability `keep`
 * (1 keeps them all). A cell with 4 lines never gets a clue.
 */
export function puzzleFromLoop(grid: Grid, loop: Uint8Array, rng: Rng, keep = 1): Puzzle {
  const clues = Array.from(deriveClues(grid, loop), (k) =>
    k <= 3 && (keep >= 1 || rng.float() < keep) ? k : NO_CLUE,
  );
  return createPuzzle(grid.width, grid.height, clues);
}
~~~~

### 3.4 `packages/core/src/verify.test.ts` (new)

`.2222.` on 2×3 is unique by brute force but the rules alone get stuck (found by scanning all 2×3 assignments), so it exercises the search. In the clock test, `verify` reads the clock once at the start (1000), six probes read 1001…1006 and the sixth exceeds the deadline 1005, and the final read is 1007: `elapsedMs` 7.

~~~~ts
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
~~~~

### Verify

```sh
export PATH="$HOME/.bun/bin:$PATH"
bun test packages/core/src/verify.test.ts  # expect 27 pass, 0 fail
bun run check; echo "rc=$?"                # expect rc=0
```

Commit: `git add packages/core/src/verify.ts packages/core/src/index.ts packages/core/src/test-support/loops.ts packages/core/src/verify.test.ts && git commit -m "feat(core): add verifier with budgeted search"`

---

## Step 4 — Agreement with brute force (FR-5)

### 4.1 `packages/core/src/agreement.test.ts` (new)

The exhaustive part checks 66,780 puzzles in about 1 s. The 2×4 regression case is a real bug the prototype had (the connectivity check seeded from a clue before any line existed); fast-check found it in roughly one run in six at 300 runs, hence `numRuns: 1000` and the fixed unit test.

~~~~ts
/**
 * PRD FR-5: the verifier and the rule solver agree with the brute-force oracle on small grids.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { bruteForceSolutions } from "./bruteforce.ts";
import { encodeEdges } from "./format.ts";
import { EdgeState } from "./grid.ts";
import { createPuzzle, NO_CLUE, type Puzzle } from "./puzzle.ts";
import { solve } from "./solver.ts";
import { arbPuzzleWithSolution } from "./test-support/arbitraries.ts";
import { verify } from "./verify.ts";

/** Checks `solve` and `verify` against every brute-force solution of `p`. */
function checkAgainstBruteForce(p: Puzzle): void {
  const all = bruteForceSolutions(p, Number.POSITIVE_INFINITY);
  const encoded = new Set(all.map(encodeEdges));

  const v = verify(p);
  expect(v.status).toBe(all.length === 0 ? "none" : all.length === 1 ? "unique" : "multiple");
  expect(v.solutions.length).toBe(Math.min(all.length, 2));
  for (const s of v.solutions) expect(encoded.has(encodeEdges(s))).toBe(true);
  if (v.solutions.length === 2) {
    expect(encodeEdges(v.solutions[0])).not.toBe(encodeEdges(v.solutions[1]));
  }

  // Every edge the rule solver decides agrees with every solution.
  const r = solve(p);
  r.edges.forEach((state, e) => {
    if (state === EdgeState.Unknown) return;
    for (const s of all) expect(s[e]).toBe(state);
  });
  if (r.status === "solved") expect(all.length).toBe(1);
  if (r.status === "contradiction") expect(all.length).toBe(0);
  expect(r.status).not.toBe("incomplete");
}

describe("agreement with brute force", () => {
  // Every clue assignment (5 choices per cell) on every grid of at most 6 cells: 66,780 puzzles.
  const sizes: [number, number][] = [
    [1, 1],
    [1, 2],
    [2, 1],
    [1, 3],
    [3, 1],
    [1, 4],
    [4, 1],
    [2, 2],
    [1, 5],
    [5, 1],
    [1, 6],
    [6, 1],
    [2, 3],
    [3, 2],
  ];
  for (const [w, h] of sizes) {
    test(`every puzzle on a ${w}×${h} grid`, () => {
      const n = w * h;
      const clues = new Array<number>(n);
      for (let code = 0; code < 5 ** n; code++) {
        let x = code;
        for (let i = 0; i < n; i++) {
          clues[i] = (x % 5) - 1;
          x = Math.floor(x / 5);
        }
        checkAgainstBruteForce(createPuzzle(w, h, clues));
      }
    });
  }

  test("a clue whose open sides lie in different regions (found by fast-check)", () => {
    // Before any line is drawn, the 1 at row 1 can still use either its top or its bottom side,
    // and those lie in regions the crosses have already cut apart.
    checkAgainstBruteForce(
      createPuzzle(2, 4, [NO_CLUE, NO_CLUE, 0, 1, 1, NO_CLUE, NO_CLUE, NO_CLUE]),
    );
  });

  test("random puzzles with a planted solution, up to 4×4", () => {
    fc.assert(
      fc.property(arbPuzzleWithSolution(4, 4), ({ puzzle }) => checkAgainstBruteForce(puzzle)),
      { numRuns: 1000 },
    );
  });

  test("random puzzles with a planted solution, up to 5×4", () => {
    fc.assert(
      fc.property(arbPuzzleWithSolution(5, 4), ({ puzzle }) => checkAgainstBruteForce(puzzle)),
      { numRuns: 20 },
    );
  });

  test("random clue grids, up to 4×4", () => {
    const arb = fc
      .record({ width: fc.integer({ min: 1, max: 4 }), height: fc.integer({ min: 1, max: 4 }) })
      .chain(({ width, height }) =>
        fc.record({
          width: fc.constant(width),
          height: fc.constant(height),
          clues: fc.array(fc.constantFrom(NO_CLUE, NO_CLUE, NO_CLUE, 0, 1, 2, 3), {
            minLength: width * height,
            maxLength: width * height,
          }),
        }),
      );
    fc.assert(
      fc.property(arb, ({ width, height, clues }) =>
        checkAgainstBruteForce(createPuzzle(width, height, clues)),
      ),
      { numRuns: 1000 },
    );
  });
});
~~~~

### Verify

```sh
export PATH="$HOME/.bun/bin:$PATH"
bun test packages/core/src/agreement.test.ts   # expect 18 pass, 0 fail, ~2 s
for i in 1 2 3 4 5; do bun test packages/core/src/agreement.test.ts 2>&1 | grep -E '^ [0-9]+ fail'; done   # expect " 0 fail" five times
bun run check; echo "rc=$?"                    # expect rc=0
```

Commit: `git add packages/core/src/agreement.test.ts && git commit -m "test(core): check solver and verifier against brute force"`

---

## Step 5 — Benchmark (not in the gate)

### 5.1 `packages/core/bench/verify.ts` (new)

~~~~ts
/**
 * Verification benchmark (not part of `bun run check`). Run: `bun run --cwd packages/core bench`.
 *
 * Puzzles come from random loops (`src/test-support/loops.ts`):
 * - "full": every clue kept. The rules solve these outright.
 * - "70%": a random 30% of clues blanked. Often several solutions, so the search runs.
 * - "minimal": clues removed in random order while the rule solver still solves the puzzle, as
 *   a generator would. Needs lookahead; the closest thing to a generated puzzle until WT3.
 *   Building these takes a few seconds at 30×30, so 100×100 is left out.
 * Prints the time per `verify` call and how often each status came back.
 */
import { createGrid, type Grid } from "../src/grid.ts";
import { createPuzzle, NO_CLUE, type Puzzle } from "../src/puzzle.ts";
import { createRng, type Rng } from "../src/rng.ts";
import { solve } from "../src/solver.ts";
import { puzzleFromLoop, randomLoop } from "../src/test-support/loops.ts";
import { verify } from "../src/verify.ts";

type Make = (grid: Grid, rng: Rng) => Puzzle;

const full: Make = (grid, rng) => puzzleFromLoop(grid, randomLoop(grid, rng), rng);
const partial: Make = (grid, rng) => puzzleFromLoop(grid, randomLoop(grid, rng), rng, 0.7);
const minimal: Make = (grid, rng) => {
  const clues = Array.from(full(grid, rng).clues);
  const order = clues.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const i of order) {
    const k = clues[i];
    if (k === NO_CLUE) continue;
    clues[i] = NO_CLUE;
    if (solve(createPuzzle(grid.width, grid.height, clues)).status !== "solved") clues[i] = k;
  }
  return createPuzzle(grid.width, grid.height, clues);
};

const CASES: { label: string; make: Make; size: number; count: number }[] = [
  { label: "full", make: full, size: 10, count: 50 },
  { label: "full", make: full, size: 30, count: 20 },
  { label: "full", make: full, size: 100, count: 5 },
  { label: "70%", make: partial, size: 10, count: 50 },
  { label: "70%", make: partial, size: 30, count: 20 },
  { label: "70%", make: partial, size: 100, count: 5 },
  { label: "minimal", make: minimal, size: 10, count: 20 },
  { label: "minimal", make: minimal, size: 30, count: 3 },
];

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

for (const { label, make, size, count } of CASES) {
  const grid = createGrid(size, size);
  const times: number[] = [];
  const statuses: Record<string, number> = {};
  let clues = 0;
  for (let n = 0; n < count; n++) {
    const puzzle = make(grid, createRng(`bench-${label}-${size}-${n}`));
    clues += puzzle.clues.filter((k) => k !== NO_CLUE).length;
    const t0 = performance.now();
    const result = verify(puzzle);
    times.push(performance.now() - t0);
    statuses[result.status] = (statuses[result.status] ?? 0) + 1;
  }
  times.sort((a, b) => a - b);
  console.log(
    `${size}×${size} ${label}: n=${count} clues=${Math.round((100 * clues) / (count * size * size))}% ` +
      `median=${percentile(times, 0.5).toFixed(1)}ms p95=${percentile(times, 0.95).toFixed(1)}ms ` +
      `max=${times[times.length - 1].toFixed(1)}ms statuses=${JSON.stringify(statuses)}`,
  );
}
~~~~

### 5.2 `packages/core/package.json` (replace)

~~~~json
{
  "name": "@loophole/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc -p . && tsc -p tsconfig.test.json",
    "bench": "bun bench/verify.ts"
  }
}
~~~~

### 5.3 `packages/core/tsconfig.test.json` (replace)

So the benchmark is type-checked (with Bun's types) and linted:

~~~~json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "bench"]
}
~~~~

### Verify

```sh
export PATH="$HOME/.bun/bin:$PATH"
bun run --cwd packages/core bench    # 8 lines, ~6 s; every "full" and "minimal" line has statuses all "unique"; 100×100 full max well under 1000ms
bun run check; echo "rc=$?"          # expect rc=0 (bun test does not pick up bench/verify.ts)
```

Expected output shape (times vary by machine):

```
10×10 full: n=50 clues=100% median=0.1ms p95=0.3ms max=1.9ms statuses={"unique":50}
30×30 full: n=20 clues=100% median=0.3ms p95=0.4ms max=0.5ms statuses={"unique":20}
100×100 full: n=5 clues=100% median=3.0ms p95=3.2ms max=3.2ms statuses={"unique":5}
10×10 70%: n=50 clues=70% median=0.1ms p95=0.3ms max=0.8ms statuses={"unique":36,"multiple":14}
30×30 70%: n=20 clues=70% median=0.5ms p95=1.0ms max=1.5ms statuses={"multiple":12,"unique":8}
100×100 70%: n=5 clues=70% median=17.5ms p95=20.7ms max=20.7ms statuses={"multiple":5}
10×10 minimal: n=20 clues=31% median=0.3ms p95=0.6ms max=0.7ms statuses={"unique":20}
30×30 minimal: n=3 clues=20% median=4.7ms p95=5.6ms max=5.6ms statuses={"unique":3}
```

Commit: `git add packages/core/bench/verify.ts packages/core/package.json packages/core/tsconfig.test.json && git commit -m "chore(core): add verification benchmark"`

---

## Step 6 — Mutation check (scratch only, nothing committed)

Confirm the tests catch broken rules. Work in a scratch copy so the worktree is never left modified:

```sh
export PATH="$HOME/.bun/bin:$PATH"
S=/tmp/claude-1000/-home-jhonnold-projects-loophole/a34715f6-7810-5a69-ba81-edd46bda034d/scratchpad/core-solver/mut
rm -rf $S && git clone -q /home/jhonnold/projects/loophole-wt/core-solver $S -b feat/core-solver && (cd $S && bun install >/dev/null)
```

For each row: in `$S`, apply the one replacement (first occurrence) to the file, run `(cd $S && bun test packages/core/src)`, record pass/fail counts, then `git -C $S checkout -- packages/core/src`. Every row marked "killed" must report at least one failing test.

| # | Mutation | File | Replace (first occurrence) | With | Expected | Prototype result (pass/fail of 190) |
|---|---|---|---|---|---|---|
| M1 | adjacent 3s also line the shared side | `engine.ts` | `lines: [cellEdges[a * 4 + 3], cellEdges[b * 4 + 1]],` | `lines: [cellEdges[a * 4 + 3], cellEdges[b * 4 + 1], shared],` | killed | 171/19 |
| M2 | corner rule with 1 and 3 swapped | `engine.ts` | `const state = k === 3 ? Line : Cross;` | `const state = k === 1 ? Line : Cross;` | killed | 150/40 |
| M3 | diagonal 3s: wrong side of the second cell | `engine.ts` | `cellEdges[b * 4 + 1],` | `cellEdges[b * 4 + 3],` | killed | 181/9 |
| M4 | parity sign flipped | `engine.ts` | `pa !== pb ? Line : Cross` | `pa === pb ? Line : Cross` | killed | 167/23 |
| M5 | lookahead keeps the assumption | `engine.ts` | `assumed === Line ? Cross : Line` | `assumed` | killed | 150/40 |
| M6 | premature loop ignores the full-solution case | `engine.ts` | `if (this.plen[d] === this.lineCount && this.cluesSatisfied(e)) return true;` | *(delete it)* | killed | 172/18 |
| M7 | connectivity treats open edges as blocked | `engine.ts` | `if (e === NONE \|\| edges[e] === Cross) continue;` | `if (e === NONE \|\| edges[e] !== Line) continue;` | killed | 165/25 |
| M8 | connectivity runs before the first line | `engine.ts` | see M8 old below | see M8 new below | killed | 189/1 |
| M9 | undo forgets path ends | `engine.ts` | `mate[d] = old;` | *(delete it)* | killed | 170/20 |
| M10 | undo forgets closed | `engine.ts` | `this.closed = m.closed;` | *(delete it)* | killed | 150/40 |
| M11 | search stops at the first solution | `verify.ts` | `if (solutions.length >= 2) return;` | `if (solutions.length >= 1) return;` | killed | 167/23 |
| M12 | no search when the rules get stuck | `verify.ts` | `if (engine.solveRoot(true)) search(engine, budget, solutions);` | `if (engine.solveRoot(true) && engine.closed) solutions.push(engine.edges.slice());` | killed | 165/25 |
| M13 | closing check skips the loop length | `engine.ts` | `if (plen[a] + 1 !== this.lineCount \|\| !this.cluesSatisfied(NONE)) return false;` | `if (!this.cluesSatisfied(NONE)) return false;` | survives: equivalent | 190/0 |
| M14 | closing check skips the clues | `engine.ts` | `if (plen[a] + 1 !== this.lineCount \|\| !this.cluesSatisfied(NONE)) return false;` | `if (plen[a] + 1 !== this.lineCount) return false;` | killed | 189/1 |
| M15 | dot rule allows 3 lines | `engine.ts` | `if (lines > 2) return false;` | `if (lines > 3) return false;` | survives: equivalent | 190/0 |

Notes: M13 and M15 remove checks that are made twice (M13: a short loop that closes while other lines exist leaves those lines with dead ends, which the dot rule catches; M15: `set()` already rejects a third line at a dot), so they cannot be killed by behaviour tests. M14 is killed only because a lookahead step's reported contradiction site moves. M8 reintroduces the prototype's connectivity bug; the 2×4 regression test kills it.

M8 old (exact text in `connected()`):

~~~~ts
if (first < 0) return true;
    const seed = grid.edgeDots[first * 2];
~~~~

M8 new (exact text in `connected()`):

~~~~ts
let seed = first >= 0 ? grid.edgeDots[first * 2] : NONE;
    for (let i = 0; i < grid.cellCount && seed === NONE; i++) {
      if (clues[i] <= 0) continue;
      for (let j = 0; j < 4; j++) {
        const ce = grid.cellEdges[i * 4 + j];
        if (edges[ce] !== Cross) {
          seed = grid.edgeDots[ce * 2];
          break;
        }
      }
    }
    if (seed === NONE) return true;
~~~~

Write the results table to `$S/../mutation-results.md` (scratch, not committed) and mention it in your final report. If a "killed" row survives, stop and report it.

---

## Step 7 — Docs

### 7.1 `README.md` — two exact edits

1. In `## Status`, replace
   ~~~~markdown
   Early development. The repo has the build tooling, the local dev services, the design kit, and the start of the puzzle engine: the grid model, the wire format, rule checks for play, a brute-force solution counter for tests, and a seeded random number generator. The solver, generator, server and web app are being built in phases; each phase's plan is in [`docs/plans/`](docs/plans/).
   ~~~~
   with
   ~~~~markdown
   Early development. The repo has the build tooling, the local dev services, the design kit, and the start of the puzzle engine: the grid model, the wire format, rule checks for play, a brute-force solution counter for tests, a seeded random number generator, a rule-based solver that records each deduction for hints, and a verifier that says whether a puzzle has one solution, none, several, or could not be decided in time. The generator, server and web app are being built in phases; each phase's plan is in [`docs/plans/`](docs/plans/).
   ~~~~
2. In the `## Scripts` table, directly after the row ``| `bun run test` | Run all tests with `bun test` |`` add:
   ~~~~markdown
   | `bun run --cwd packages/core bench` | Time puzzle verification on 10×10 to 100×100 boards (not part of the check) |
   ~~~~

### 7.2 `packages/core/AGENTS.md` — append one bullet at the end

~~~~markdown
- `solve` and `verify` share one deduction engine (`src/engine.ts`, not exported). Every rule must be sound: what it decides holds in every solution. A new rule gets an id and a one-sentence explanation in `src/rules.ts`, which hints show to players. The brute-force agreement tests in `src/agreement.test.ts` are the safety net; run `bun run --cwd packages/core bench` after changing the engine.
~~~~

### 7.3 `docs/DECISIONS.md` — append at the end (after a blank line)

~~~~markdown
## 2026-10-25 · WT2 `core-solver` · One deduction engine for solve and verify
- **Question:** How should the rule solver, lookahead and the verifier's search share state?
- **Decision:** One internal `Engine` (`packages/core/src/engine.ts`, not exported) over a `Uint8Array` of edge states. It tracks path ends (for each end dot, the other end and the path length) so closing a loop is checked in O(1), keeps a trail with mark/undo, and runs local rules from a worklist of cells and dots. Rules come in four tiers (local; 3s patterns; parity plus a connectivity check; lookahead), and after any change it goes back to the local rules.
- **Reason:** Undo instead of copying makes lookahead probes and search nodes cheap on 100×100 boards, and going back to the cheapest tier keeps steps in rough easiest-first order for hints.

## 2026-10-25 · WT2 `core-solver` · Rule ids and what a step carries
- **Question:** Which deductions, under which ids, and what does each recorded step hold?
- **Decision:** 14 ids in `RULE_IDS`, each with one plain sentence in `RULE_TEXT`: `clue-zero`, `clue-satisfied`, `clue-needs-all`, `dot-full`, `dot-continue`, `dot-dead-end`, `corner-1`, `corner-3`, `adjacent-3s`, `diagonal-3s`, `premature-loop`, `loop-complete`, `parity`, `lookahead`. A step is `{rule, changes, cells, dots}`; `cells` and `dots` are what a hint highlights. Parity steps name only the two cells, lookahead steps name the edge's dots and where the contradiction showed, `loop-complete` names nothing.
- **Reason:** FR-3's list plus the bookkeeping rules a hint needs to explain every move. The text has no placeholders, so the UI can show it as is.

## 2026-10-25 · WT2 `core-solver` · Adjacent 3s leave the shared side alone
- **Question:** The usual pattern says two 3s side by side always have their shared side as a line. Do we apply it?
- **Decision:** No. `adjacent-3s` sets only the two outer sides parallel to the shared side (lines) and the edges that continue the shared side (crosses).
- **Reason:** The usual pattern is wrong when the whole loop is the rectangle around the two cells (2×1 `"33"` has its shared side crossed). The rest follows from dot degree alone; when the shared side is forced, other rules find it.

## 2026-10-25 · WT2 `core-solver` · Corner rule covers any closed-off corner
- **Question:** Does "a 1 or 3 in a corner" mean board corners only?
- **Decision:** Any corner of a 1 or 3 whose two outside edges are crossed or off the board: a 1 gets both its sides there crossed, a 3 gets both as lines.
- **Reason:** The same argument holds (a line on one side there must continue on the other), and it also catches corners closed off while solving.

## 2026-10-25 · WT2 `core-solver` · Lookahead is one level deep
- **Question:** How is "bounded lookahead" bounded?
- **Decision:** Depth 1: assume a state for one open edge, run only the worklist rules (no parity, connectivity or nested lookahead), and on a contradiction set the other state. Open edges are tried round-robin; the tier ends when a full scan finds nothing. Every probe checks the time budget.
- **Reason:** Parity and connectivity cost O(edges) each and would multiply the cost of every probe. With depth 1, a 50×50 puzzle reduced to a minimal rule-solvable clue set solves in about 25 ms.

## 2026-10-25 · WT2 `core-solver` · How the verifier searches
- **Question:** What does the verifier do when the rules get stuck?
- **Decision:** Depth-first search with an explicit stack, branching on the first open edge in reading order, cross first. Each node runs the rules without lookahead plus a connectivity check (from a line, every other line and an open side of every clue above 0 must be reachable over edges that are not crossed). It stops at the second solution.
- **Reason:** Of the variants measured (branching at a path end or in reading order, line or cross first, with or without the connectivity check, lookahead at every node), this one left the fewest under-clued boards `unknown` within 1 s: 0 of 30 at 10×10, 1 of 30 at 15×15, 2 of 30 at 20×20 and 10 of 30 at 30×30, on boards keeping 10–30% of their clues. Heavily under-clued large boards can still end `unknown`, which FR-4 and PRD §9 allow.

## 2026-10-25 · WT2 `core-solver` · Verification budget
- **Question:** How is the verification time limit enforced and tested?
- **Decision:** `verify` takes `timeLimitMs` (default `DEFAULT_VERIFY_TIME_LIMIT_MS` = 30 000), an injectable clock `now` (default `Date.now`) and `maxNodes`. The deadline is checked once per lookahead probe and once per search node; running out returns `unknown` with any solution already found. `solve` takes the same time options plus `maxSteps`. The worker's `terminate()` (WT6) stays the outer hard limit.
- **Reason:** A fake clock makes the budget tests deterministic. `performance.now` is not available to core's typecheck (no DOM or Bun types); `Date.now` is plain ECMAScript.

## 2026-10-25 · WT2 `core-solver` · What "brute force on all small grids" covers
- **Question:** How far do the FR-5 agreement tests go?
- **Decision:** Every clue assignment on every grid of at most 6 cells (66,780 puzzles, about 1 s), plus fast-check: 1000 planted-solution puzzles up to 4×4, 20 up to 5×4 and 1000 random clue grids up to 4×4. Each checks `verify`'s status and solutions, and that every edge `solve` decides matches every brute-force solution. All 937,500 puzzles on 2×4, 4×2, 1×7 and 7×1 also pass, but take 25 s, so they are not in the gate.
- **Reason:** It keeps `bun run check` around 3 s and catches every seeded rule mutation in the plan's mutation check. A bug fast-check found in the prototype (the connectivity check seeded from a clue before any line existed, on a 2×4 board) is pinned as a unit test.

## 2026-10-25 · WT2 `core-solver` · Hints start from the player's board
- **Question:** How will hints (WT8) get the next deduction for a player?
- **Decision:** `solve(puzzle, { initial: board, maxSteps: 1 })`. Deductions are sound for the board they start from, so the caller first drops player edges that disagree with the stored solution.
- **Reason:** One solver serves both uses, and its step already holds what a hint shows.
~~~~

### Verify

```sh
export PATH="$HOME/.bun/bin:$PATH"
git diff --stat   # README.md, packages/core/AGENTS.md, docs/DECISIONS.md only
bun run check; echo "rc=$?"   # expect rc=0
```

Commit: `git add README.md packages/core/AGENTS.md docs/DECISIONS.md && git commit -m "docs: describe the solver and verifier"`

---

## Final checks

```sh
export PATH="$HOME/.bun/bin:$PATH"
git status --short                              # expect clean
git log --oneline main..HEAD                    # the 6 commits above (plus the plan commit), in order
bun install --frozen-lockfile; echo "rc=$?"     # expect rc=0
bun run check; echo "rc=$?"                     # expect rc=0, 190 pass, 0 fail
for i in 1 2 3; do bun test 2>&1 | grep -E '^ [0-9]+ fail'; done   # expect " 0 fail" three times
git diff main --stat -- packages/core/src/grid.ts packages/core/src/puzzle.ts packages/core/src/analyze.ts packages/core/src/bruteforce.ts packages/core/src/format.ts packages/core/src/rng.ts   # expect no output: WT1 files untouched
```

## Acceptance criteria

| # | Criterion | PRD | Checked by |
|---|---|---|---|
| 1 | Solver applies the named deductions (clue-0, satisfied, needs-all, dot degree 0/1/2, corner 1/3, adjacent and diagonal 3s, parity, premature loop, bounded lookahead) until stuck | FR-3 | `solver.test.ts` "each rule" (one literal puzzle per rule id, exact changes) |
| 2 | Every deduction is sound | FR-3, FR-5 | `agreement.test.ts`: every decided edge equals that edge in every brute-force solution; partial-board property in `solver.test.ts` |
| 3 | Each step records rule id, edges set with new state, and the cells/dots involved; steps replay to the final board | FR-6 | `solver.test.ts` replay checks, per-rule `cells`/`dots` |
| 4 | Rule ids have human-readable explanations kept in core as data | FR-6, FR-12 | `rules.test.ts` |
| 5 | Verifier returns `unique`/`none`/`multiple`/`unknown`; one solution for unique, two distinct for multiple | FR-4 | `verify.test.ts` fixtures, empty-board test |
| 6 | Verifier equals brute force on all grids ≤ 6 cells and random grids ≤ 20 cells | FR-5 | `agreement.test.ts` |
| 7 | Budget exhaustion gives `unknown`; clock injectable; node cap | FR-4, NFR-1 | `verify.test.ts` maxNodes and fake-clock tests |
| 8 | Rule-solvable 100×100 verified well under 30 s; under-clued 100×100 stops at the limit with `unknown` | NFR-1, §9 | 100×100 test in `verify.test.ts`; benchmark output in step 5; measurements above |
| 9 | Mutated rules are caught by the tests | NFR-3 | step 6 report |
| 10 | Core stays dependency-free and Bun/DOM-free; `bun run check` green after every commit | NFR-3 | typecheck with `types: []`; each step's verification |

## Unresolved questions

1. **Adjacent 3s shared side.** The rule never claims the shared side (the textbook version is wrong for the 2-cell loop). Proposed default: keep it that way; `parity`/`lookahead` derive the shared side when it is forced, and the hint text says so.
2. **Parity hint reason.** A `parity` step names only the two cells, not the chain of known edges linking them. Proposed default: keep; WT8 can compute a chain if play-testing shows the hint is opaque.
3. **`unknown` for very under-clued boards.** The search still gives up on, for example, 100×100 boards keeping 30% of a loop's clues, and on about a third of 30×30 boards keeping 10–30% within 1 s. Proposed default: accept (FR-4/§9 allow it); WT10's editor shows "too open to check, add clues". Stronger search (restarts, better pruning) can come later if editor use shows the need.
4. **Gate time.** `bun run check`'s test phase grows from about 0.3 s to about 3 s (exhaustive FR-5 checks). Proposed default: accept.
