# WT8 `hints` — implementation plan

Branch `feat/hints`, worktree `/home/jhonnold/projects/loophole-wt/hints` (based on main `3542be0`, which includes WT6). PRD: FR-6 (the solver's step record powers hints), FR-12 (hint highlights the cells of the next forced deduction, explains the rule in words, marks the solve as assisted), FR-15 (only definite rule breaks are flagged passively), FR-25 (the server never sends the solution), NFR-2 (360 px phones, frame times), NFR-5 (keyboard, not by colour alone).

## Goal

- **Core**: `findHint(puzzle, solution, board)` picks what a hint shows from the player's board: a wrong mark first, else the solver's next step from the board, else (no rule applies) one line of the solution; `RULE_TITLE` gives every rule a short card title next to `RULE_TEXT`.
- **Server**: `POST /api/puzzles/{id}/hint` with the player's board returns that hint, worked out against the stored solution by a new `HintManager`. The solution never leaves the server. This is the seam WT11 uses to record that a ranked player took a hint. No migration.
- **Web**: a Hint button in the tray (`H` on the keyboard). The hint card replaces the tray (Hint artboard): eyebrow, rule title, explanation, the rule's pattern drawn small, **Apply move** and **I'll draw it**. The board gets an ai wash on the step's cells and dots, the forced move as a dashed ai ghost line or ai ×, and hinted clues bold in ai, on both the SVG and the canvas renderer. A zoomed board pans the hint into view. Built-in puzzles work hints out in the browser from their clues; server puzzles ask the API.
- **Assisted flag**: seeing a hint marks the attempt assisted; saved in guest progress (`assisted`), shown as a "Hint used" tag in the status line (phones), the time card (desktop) and on the solved card.
- **Follow-up [WT8]**: trackpad pinch speed in `BoardView` (Step 4).

## Decision: where the hint is computed

Core holds one pure function, `findHint`, and both places call it:

- **Built-in puzzles (fixtures)**: in the browser. The fixture source works out the solution once per puzzle with `verify` (the fixtures are unique; `medium-10` needs search, so `solve` alone is not enough) and keeps it in memory. Nothing leaks: the clues alone determine the solution. Measured: `verify` takes 0.5–11 ms on every fixture, 7 ms on `giant-100`.
- **Server puzzles**: `POST /api/puzzles/{id}/hint`. The server already holds the solution in the blob store (`PuzzleManager.getSolution`), so the client never needs it and never solves a large board (a generated 100×100 takes about 280 ms to verify in Bun, longer on a phone). The endpoint is where ranked play (WT11) records that a hint was used, so the assisted flag can be trusted server side; nothing is persisted per user yet (no accounts or ranked attempts exist).

Hints start from the player's board (DECISIONS, WT2): deductions are only sound on a board that agrees with the solution, so marks that disagree are reported first.

## Decision: wrong marks, and when no rule applies

- **Mistakes first.** If any mark disagrees with the solution, the hint is "This line doesn't fit" (or "This × doesn't fit") for the lowest such edge, with its two dots washed, plus "N more marks don't fit either." The action is **Erase it** (sets the edge empty; it does not draw the right state). FR-15's passive highlighting is unchanged; this is shown only when the player asks.
- **Next step.** Otherwise `solve(puzzle, { initial: board, maxSteps: 1 })` gives the step: its rule, the edges it sets (ghosts, and what Apply draws), its cells and dots (washes).
- **No rule applies** (possible on `medium-10` and on submitted puzzles that need search): one line of the solution, preferring one that extends a line already on the board. Card: "No rule applies here".
- **Solved**: no hint (the tray is gone once solved anyway).

## Out of scope

Persisting hint use per user or session (WT9/WT11); hiding the Hint button or recording assists for ranked puzzles (WT11); "Hint used · unranked" wording and leaderboard exclusion (WT11, FR-23); an API end-to-end test (the Playwright preview has no API proxy, so the server path is covered by route and client unit tests); any header, nav or layout change (WT7 owns those).

## How later worktrees use this

- **WT9 progress sync**: the guest progress object now has `assisted: boolean`; sync it with the rest.
- **WT10 submissions**: submitted puzzles may need search; hints on them hit `HINT_TIME_LIMIT_MS` (500 ms) and become revealed lines. If that proves too slow or too frequent, store a solver trace from a known-correct board, or raise the limit inside a worker.
- **WT11 ranked**: decide whether hint calls on a live ranked puzzle must come from the ranked session (signed in, attempt id) and refuse or record others. Give `HintManager` an assist-recording port (user/session + puzzle id) and call it in `hint()` for ranked attempts; ranked puzzles are stored unpublished until release, and `HintManager` uses `PuzzleManager.get` (published only), so pre-release puzzles already 404. Show "Hint used · unranked" for ranked puzzles. Ranked solves with an assist are excluded from leaderboards.

## Design details

### Core

`packages/core/src/hint.ts`:

```ts
export type Hint =
  | { kind: "solved" }
  | { kind: "mistake"; edge: number; count: number }
  | { kind: "step"; step: Step }
  | { kind: "reveal"; edge: number };
export function findHint(
  puzzle: Puzzle,
  solution: Uint8Array,
  board: Uint8Array,
  options?: { timeLimitMs?: number; now?: () => number },
): Hint;
```

The time limit is passed to `solve`; a solve stopped with no step falls through to a revealed line, which is still a correct hint.

`RULE_TITLE: Record<RuleId, string>` in `rules.ts`. "Clue saturated" for `clue-needs-all` matches the Hint artboard, whose example is exactly that rule.

### Server

- `managers/hint-manager.ts`: `HintManager({ puzzles: PuzzleManager })`, `hint(id, edges): Promise<Hint | null>` (null = no published puzzle), throws `InvalidBoardError` when the edge string does not fit the puzzle. It caps the search at `HINT_TIME_LIMIT_MS` = 500 ms, so an unauthenticated POST cannot hold the API thread on a puzzle that needs search (generated puzzles answer in 0.1–2 ms, even at 100×100). The error class lives in this file, not `errors.ts`, to keep clear of WT7's edits.
- `api/schemas.ts`: `HintRequestSchema` (`{ edges }`, strict, `^[012]*$`, at most 20 200 characters = a 100×100 board) and `HintSchema` (discriminated union on `kind`; step changes use `"line"`/`"cross"`).
- `api/app.ts`: the route; `InvalidBoardError` → 400 problem "Invalid board" with the decoder's message; unknown puzzle → 404.

### Web

| File | Role |
|---|---|
| `lib/game/hint.ts` | `HintMarks`, `HintView`, `hintView()` (core hint → card words, marks, Apply move), `hintCurrent()` (is the hint still open on this board), `hintRect()` (area to pan into view), `puzzleSolution()` (verify → the unique solution) |
| `lib/game/patterns.ts` | `RULE_PATTERNS`: a tiny board for each rule's figure, showing the reason for the move (corner rules at an inner corner whose outside edges are crossed, parity with one cell known outside and one inside). Lookahead has no figure (no single picture says "try and see"), and loop-complete never reaches a hint (the board is solved first), so the map is `Partial` |
| `lib/components/RulePattern.svelte` | draws a pattern in a 72 px square (Hint artboard) |
| `lib/components/HintCard.svelte` | the card; focuses Apply on open, and Apply is described by the title, the text and a visually hidden "Move: …" line with edge labels, so a screen reader reads the whole hint |
| `lib/puzzles/*` | `PuzzleSource.hint(id, puzzle, edges)`; fixtures local, API via the client, `withServer` routes by id |
| `BoardSvg` / `paint.ts` / `BoardCanvas` / `BoardView` | `hint: HintMarks | null` prop; washes, ghosts, bold ai clues; pan-into-view |
| `ToolBar.svelte` | fourth button, Hint, in ai (Play, Small and Desktop artboards: Undo, Redo, Hint, Clear) |
| `PlayScreen.svelte` | hint state, card in place of the tray, `assisted` tag and saving |
| `game/progress.ts` | `assisted` in `Progress`; stored as an optional field in the v1 object (old saves load as `false`) |
| `game/keyboard.ts` | `H` → `hint`, `Escape` → `close` |

Card behaviour:

- **Hint** (button or `H`): asks the puzzle source; shows the card in place of the tray, focus on its first button; marks the attempt assisted and saves. While the request runs the Hint button is disabled. If it fails, "Couldn't get a hint just now. Try again in a moment." shows in the notes (ahead of rule-error messages, since a board with a rule break is exactly when a hint is wanted) and the tray stays.
- **Apply move / Erase it**: applies the hint's changes as one undo step, closes the card, focus back to the board.
- **I'll draw it / I'll fix it** or `Escape`: closes the card; the washes and ghosts stay on the board.
- The hint ends (card and marks go) when its whole move has been made, when one of its edges is marked to something else, on solve, or on Start over. Edits elsewhere keep it (a sound deduction stays true). Pressing Hint while a hint is still on the board reopens its card.
- Paused: the card hides with the board and the disabled tray shows; resuming brings it back.
- Zoomed boards pan so the hint's marks are in view (once per hint).
- The status-line tag takes the zoom tip's place, so the line never wraps, and overhangs the line box (`margin-block: -3px`), so the board never moves when it appears.
- The card must fit the room the notes, spacer and tray leave under a 7×7 on phones (measured: about 180 px at 390×664, about 150 px at 360×560), for the longest texts too (parity and the corner rules are about 110 characters, the "× doesn't fit" card with a count about 90). So the figure floats right and the words flow under it, and on phones (under 900 px wide) the card uses 8/12 px padding, 6 px gaps, 14 px text, a 56 px figure without its caption and 44 px buttons. On phones at most 620 px tall (Small artboard) there is no figure, the eyebrow is kept for screen readers only (the title says what kind of hint it is), the title is 18 px and the text 13 px. Measured on the prototype, the worst case leaves about 8 px to spare on both phone sizes, the page never scrolls and the board never moves; an end-to-end test opens every rule small-7 uses plus that mistake card at both sizes and checks this. Desktop keeps the artboard's sizes and the 72 px figure with its caption.

Colours: new token `--hint-wash` (Paper `rgb(46 76 138 / 0.16)` as on the Hint artboard, Night `rgb(143 177 240 / 0.2)`); the tag uses the existing `--ai-wash`. Not colour alone (NFR-5): ghosts are dashed lines and ×s (shape), hinted clues are bold, the card names the rule and what is highlighted in words, and screen readers get the move's edge labels.

## Environment notes for the implementer

- Every shell: `export PATH="$HOME/.bun/bin:$PATH"`. Run commands from the worktree root `/home/jhonnold/projects/loophole-wt/hints` unless a step says otherwise.
- The gate is `bun run check` (lint, typecheck, API contract, tests; about 15 s). `bun run format` fixes Biome formatting of `.ts` files; Biome does not format `.svelte` files, so copy their code exactly as given.
- `bun run test:e2e` and `bun run test:perf` build the app and serve it on port 4173. If the port is busy (another worktree's run), wait and retry; do not change the port in the committed config.
- One server test (thread timing) can fail once under heavy machine load; rerun `bun run check` before investigating.
- Commit after each step with the message given, only when that step's verification passes. Do not push.

## Steps

### Step 1 — Core: `findHint` and rule titles

1. In `packages/core/src/rules.ts`, insert this block directly above the line `/** One edge a step decided. */`:

```ts
/** A short name for each rule, shown as the hint card's title. */
export const RULE_TITLE: Readonly<Record<RuleId, string>> = {
  "clue-zero": "A zero",
  "clue-satisfied": "Clue complete",
  "clue-needs-all": "Clue saturated",
  "dot-full": "Dot full",
  "dot-continue": "Line goes on",
  "dot-dead-end": "Dead end",
  "corner-1": "1 in a corner",
  "corner-3": "3 in a corner",
  "adjacent-3s": "3s side by side",
  "diagonal-3s": "3s corner to corner",
  "premature-loop": "No small loops",
  "loop-complete": "Loop complete",
  parity: "Inside and outside",
  lookahead: "Try and see",
};

```

2. In `packages/core/src/rules.test.ts`, replace the import line with:

```ts
import { RULE_IDS, RULE_TEXT, RULE_TITLE } from "./rules.ts";
```

and add this test after the existing one, inside the same `describe`:

```ts

  test("each has a short title", () => {
    for (const id of RULE_IDS) expect(RULE_TITLE[id].length).toBeLessThanOrEqual(24);
    expect(Object.keys(RULE_TITLE).sort()).toEqual([...RULE_IDS].sort());
  });
```

3. Create `packages/core/src/hint.ts`:

```ts
import { analyzeBoard } from "./analyze.ts";
import { EdgeState, type Grid } from "./grid.ts";
import type { Puzzle } from "./puzzle.ts";
import type { Step } from "./rules.ts";
import { solve } from "./solver.ts";

/**
 * What a hint shows (PRD FR-12), from the player's board and the puzzle's solution:
 * - `solved`: the board is already complete.
 * - `mistake`: `edge` is marked differently from the solution (the lowest such edge); `count` is how
 *   many marks are wrong in all. Mistakes come first, because deductions from a board with a wrong
 *   mark would not make sense to the player.
 * - `step`: the next deduction from the player's board, as the rule solver records it.
 * - `reveal`: no rule applies, so `edge` is one line of the solution, preferably one that extends a
 *   line already on the board.
 */
export type Hint =
  | { readonly kind: "solved" }
  | { readonly kind: "mistake"; readonly edge: number; readonly count: number }
  | { readonly kind: "step"; readonly step: Step }
  | { readonly kind: "reveal"; readonly edge: number };

export interface HintOptions {
  /**
   * Stop looking for a deduction after this many milliseconds, measured with `now`, and reveal a
   * line instead. Default no limit.
   */
  readonly timeLimitMs?: number;
  /** Clock in milliseconds. Default `Date.now`. */
  readonly now?: () => number;
}

/**
 * The next hint for `board` (PRD FR-6, FR-12). `solution` is the puzzle's solution as edge states,
 * and `board` the player's marks; neither is modified. Throws `RangeError` when either has the wrong
 * length.
 */
export function findHint(
  puzzle: Puzzle,
  solution: Uint8Array,
  board: Uint8Array,
  options: HintOptions = {},
): Hint {
  const { grid } = puzzle;
  if (solution.length !== grid.edgeCount || board.length !== grid.edgeCount) {
    throw new RangeError(
      `expected ${grid.edgeCount} edge states, got ${solution.length} and ${board.length}`,
    );
  }
  if (analyzeBoard(puzzle, board).solved) return { kind: "solved" };

  let first = -1;
  let count = 0;
  for (let e = 0; e < grid.edgeCount; e++) {
    if (board[e] === EdgeState.Unknown || board[e] === solution[e]) continue;
    if (first < 0) first = e;
    count++;
  }
  if (count > 0) return { kind: "mistake", edge: first, count };

  // Every mark agrees with the solution, so the solver's deductions from the board are sound. A
  // solve stopped by the time limit has no step and falls through to a revealed line.
  const result = solve(puzzle, { ...options, initial: board, maxSteps: 1 });
  const step = result.steps[0];
  if (step !== undefined) return { kind: "step", step };
  return { kind: "reveal", edge: revealEdge(grid, solution, board) };
}

/**
 * An open edge that is a line in the solution: the first one, in edge order, that touches a dot
 * where exactly one line ends, or else the first one. One exists whenever the board is unsolved and
 * has no mistakes.
 */
function revealEdge(grid: Grid, solution: Uint8Array, board: Uint8Array): number {
  let fallback = -1;
  for (let e = 0; e < grid.edgeCount; e++) {
    if (board[e] !== EdgeState.Unknown || solution[e] !== EdgeState.Line) continue;
    if (fallback < 0) fallback = e;
    if (lineDegree(grid, board, grid.edgeDots[e * 2]) === 1) return e;
    if (lineDegree(grid, board, grid.edgeDots[e * 2 + 1]) === 1) return e;
  }
  return fallback;
}

function lineDegree(grid: Grid, board: Uint8Array, dot: number): number {
  let n = 0;
  for (let j = 0; j < 4; j++) {
    const e = grid.dotEdges[dot * 4 + j];
    if (e >= 0 && board[e] === EdgeState.Line) n++;
  }
  return n;
}
```

4. In `packages/core/src/index.ts`, add `export * from "./hint.ts";` after the `./grid.ts` line (keep alphabetical order).

5. Create `packages/core/src/hint.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { analyzeBoard } from "./analyze.ts";
import { decodeEdges, parsePuzzle } from "./format.ts";
import { EdgeState, hEdgeIndex } from "./grid.ts";
import { findHint } from "./hint.ts";
import { solve } from "./solver.ts";
import { arbPuzzleWithSolution } from "./test-support/arbitraries.ts";

function puzzle(width: number, height: number, clues: string) {
  return parsePuzzle({ v: 1, width, height, clues });
}

describe("findHint", () => {
  test("names the next rule from an empty board", () => {
    // 2×2 with a 0 in the top-left cell: the 0's four sides are crossed first.
    const p = puzzle(2, 2, "0...");
    const solution = decodeEdges(p.grid, "222121222211");
    const hint = findHint(p, solution, new Uint8Array(p.grid.edgeCount));
    expect(hint).toEqual({
      kind: "step",
      step: {
        rule: "clue-zero",
        changes: [
          { edge: 0, state: EdgeState.Cross },
          { edge: 7, state: EdgeState.Cross },
          { edge: 2, state: EdgeState.Cross },
          { edge: 6, state: EdgeState.Cross },
        ],
        cells: [0],
        dots: [],
      },
    });
  });

  test("starts from the player's marks", () => {
    // Same puzzle with the 0's sides already crossed: the next step is a different rule.
    const p = puzzle(2, 2, "0...");
    const solution = decodeEdges(p.grid, "222121222211");
    const board = decodeEdges(p.grid, "202000220000");
    const hint = findHint(p, solution, board);
    expect(hint.kind).toBe("step");
    if (hint.kind !== "step") return;
    expect(hint.step.rule).not.toBe("clue-zero");
    for (const { edge, state } of hint.step.changes) {
      expect(board[edge]).toBe(EdgeState.Unknown);
      expect(solution[edge]).toBe(state);
    }
  });

  test("reports the first wrong mark and how many there are", () => {
    // 2×2 all 2s; its only loop runs around the outside.
    const p = puzzle(2, 2, "2222");
    const solution = decodeEdges(p.grid, "112211121121");
    const board = new Uint8Array(p.grid.edgeCount);
    board[0] = EdgeState.Cross; // a line in the solution
    board[2] = EdgeState.Line; // a cross in the solution
    board[1] = EdgeState.Line; // right
    expect(findHint(p, solution, board)).toEqual({ kind: "mistake", edge: 0, count: 2 });
  });

  test("says when the board is already solved, crosses or not", () => {
    const p = puzzle(2, 2, "2222");
    const solution = decodeEdges(p.grid, "112211121121");
    expect(findHint(p, solution, solution)).toEqual({ kind: "solved" });
    const linesOnly = solution.map((s) => (s === EdgeState.Line ? s : EdgeState.Unknown));
    expect(findHint(p, solution, linesOnly)).toEqual({ kind: "solved" });
  });

  test("reveals a line of the solution when no rule applies, extending the player's line", () => {
    // 3×3 with no clues: no rule decides anything. The solution is the outer ring.
    const p = puzzle(3, 3, ".........");
    const solution = decodeEdges(p.grid, "111222222111122112211221");
    const empty = new Uint8Array(p.grid.edgeCount);
    expect(findHint(p, solution, empty)).toEqual({ kind: "reveal", edge: 0 });
    // A line on the bottom edge: the reveal continues it rather than starting at the top.
    const board = empty.slice();
    board[hEdgeIndex(p.grid, 3, 1)] = EdgeState.Line;
    expect(findHint(p, solution, board)).toEqual({
      kind: "reveal",
      edge: hEdgeIndex(p.grid, 3, 0),
    });
  });

  test("reveals a line instead when the time limit stops the search for a deduction", () => {
    // Tiny-5 (a web fixture): replay its solver steps up to its first lookahead, which only comes
    // after the time-checked tiers. With a clock already past the limit the hint is a reveal.
    const p = puzzle(5, 5, "..0.......3.1.0.3.1......");
    const full = solve(p);
    const board = new Uint8Array(p.grid.edgeCount);
    for (const step of full.steps) {
      if (step.rule === "lookahead") break;
      for (const c of step.changes) board[c.edge] = c.state;
    }
    const hint = findHint(p, full.edges, board);
    expect(hint.kind === "step" && hint.step.rule).toBe("lookahead");
    let t = 0;
    const late = findHint(p, full.edges, board, { timeLimitMs: 500, now: () => (t += 1000) });
    expect(late.kind).toBe("reveal");
  });

  test("rejects boards of the wrong size", () => {
    const p = puzzle(2, 2, "2222");
    expect(() => findHint(p, new Uint8Array(12), new Uint8Array(3))).toThrow(RangeError);
  });

  test("every hint agrees with the solution (property)", () => {
    fc.assert(
      fc.property(
        arbPuzzleWithSolution(4, 4),
        fc.boolean(),
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 40, maxLength: 40 }),
        ({ puzzle: p, solution }, withMistakes, picks) => {
          // Per edge: 0-5 left open, 6-8 copied from the solution, 9 wrong (or open without mistakes).
          const board = new Uint8Array(p.grid.edgeCount);
          let wrong = 0;
          for (let e = 0; e < board.length; e++) {
            const pick = picks[e % picks.length];
            if (pick >= 6 && pick <= 8) board[e] = solution[e];
            else if (pick === 9 && withMistakes) {
              board[e] = solution[e] === EdgeState.Line ? EdgeState.Cross : EdgeState.Line;
              wrong++;
            }
          }
          const hint = findHint(p, solution, board);
          if (wrong > 0) {
            expect(hint.kind).toBe("mistake");
            if (hint.kind !== "mistake") return;
            expect(hint.count).toBe(wrong);
            expect(board[hint.edge]).not.toBe(solution[hint.edge]);
            return;
          }
          if (hint.kind === "solved") {
            expect(analyzeBoard(p, board).solved).toBe(true);
          } else if (hint.kind === "step") {
            for (const { edge, state } of hint.step.changes) {
              expect(board[edge]).toBe(EdgeState.Unknown);
              expect(solution[edge]).toBe(state);
            }
          } else if (hint.kind === "reveal") {
            expect(board[hint.edge]).toBe(EdgeState.Unknown);
            expect(solution[hint.edge]).toBe(EdgeState.Line);
          } else {
            throw new Error(`unexpected ${hint.kind}`);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
```

(The planted-solution arbitrary's puzzles may have other solutions too; the property still holds, because every rule is sound for every solution that agrees with the board, including the planted one.)

6. In `packages/core/AGENTS.md`, replace the sentence `A new rule gets an id and a one-sentence explanation alongside the others, because hints show that text to players.` with:

```
A new rule gets an id, a short title and a one-sentence explanation alongside the others, because hint cards show them to players (the web app also draws a small pattern for each rule).
```

**Verify:**

```sh
bun run format && bun test packages/core/src/hint.test.ts packages/core/src/rules.test.ts && bun run --cwd packages/core typecheck && bun run check
```

**Commit:** `feat(core): add findHint and rule titles for hints`

### Step 2 — Server: hint endpoint backed by the stored solution

1. Create `apps/server/src/managers/hint-manager.ts`:

```ts
import { decodeEdges, FormatError, findHint, type Hint } from "@loophole/core";
import type { PuzzleManager } from "./puzzle-manager.ts";

/** The board sent for a hint does not fit the puzzle (wrong length or a bad character). */
export class InvalidBoardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBoardError";
  }
}

/**
 * How long a hint request may look for a deduction. Generated puzzles answer in a few ms; a
 * submitted puzzle that needs search (WT10) gets a revealed line after this instead of tying up the
 * API thread.
 */
export const HINT_TIME_LIMIT_MS = 500;

export interface HintManagerDeps {
  readonly puzzles: PuzzleManager;
}

/**
 * Hints for published puzzles (PRD FR-6, FR-12): the next deduction from a player's board, worked
 * out against the stored solution, which never leaves the server (FR-25). Ranked play (WT11) will
 * record here that a player took a hint.
 */
export class HintManager {
  readonly #deps: HintManagerDeps;

  constructor(deps: HintManagerDeps) {
    this.#deps = deps;
  }

  /**
   * The hint for `edges` (the edge-state encoding) on puzzle `id`, or null when there is no
   * published puzzle with that id. Throws `InvalidBoardError` when `edges` does not fit the puzzle.
   */
  async hint(id: string, edges: string): Promise<Hint | null> {
    const { puzzles } = this.#deps;
    const record = puzzles.get(id);
    if (record === null) return null;
    let board: Uint8Array;
    try {
      board = decodeEdges(record.puzzle.grid, edges);
    } catch (err) {
      if (err instanceof FormatError) throw new InvalidBoardError(err.message);
      throw err;
    }
    const solution = await puzzles.getSolution(id);
    if (solution === null) throw new Error(`Puzzle ${id} has no stored solution`);
    return findHint(record.puzzle, solution, board, { timeLimitMs: HINT_TIME_LIMIT_MS });
  }
}
```

2. Create `apps/server/src/managers/hint-manager.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { FakeClock, FakePuzzleRepository } from "../test-support/fakes.ts";
import { HintManager, InvalidBoardError } from "./hint-manager.ts";
import { PuzzleManager } from "./puzzle-manager.ts";

// 2×2 all 2s; its only loop runs around the outside.
const SOLUTION = "112211121121";

async function setup() {
  const blobs = new MemoryBlobStore();
  const puzzles = new PuzzleManager({
    puzzles: new FakePuzzleRepository(),
    blobs,
    clock: new FakeClock(5000),
  });
  await puzzles.saveGenerated("p-1", {
    puzzle: serializePuzzle(createPuzzle(2, 2, [2, 2, 2, 2])),
    solution: SOLUTION,
    steps: [],
  });
  return { blobs, hints: new HintManager({ puzzles }) };
}

describe("HintManager", () => {
  test("gives the next step from the player's board", async () => {
    const { hints } = await setup();
    const hint = await hints.hint("p-1", "000000000000");
    expect(hint?.kind).toBe("step");
    if (hint?.kind !== "step") return;
    for (const { edge, state } of hint.step.changes) expect(Number(SOLUTION[edge])).toBe(state);
  });

  test("points out a wrong mark using the stored solution", async () => {
    const { hints } = await setup();
    expect(await hints.hint("p-1", "200000000000")).toEqual({ kind: "mistake", edge: 0, count: 1 });
  });

  test("says when the board is solved", async () => {
    const { hints } = await setup();
    expect(await hints.hint("p-1", SOLUTION)).toEqual({ kind: "solved" });
  });

  test("is null for an unknown puzzle", async () => {
    const { hints } = await setup();
    expect(await hints.hint("nope", SOLUTION)).toBeNull();
  });

  test("rejects a board that does not fit the puzzle", async () => {
    const { hints } = await setup();
    await expect(hints.hint("p-1", "000")).rejects.toBeInstanceOf(InvalidBoardError);
    await expect(hints.hint("p-1", "00000000000x")).rejects.toThrow("invalid character");
  });

  test("fails loudly when the solution blob is missing", async () => {
    const { blobs, hints } = await setup();
    blobs.blobs.delete("puzzles/p-1/solution.txt");
    await expect(hints.hint("p-1", "000000000000")).rejects.toThrow("no stored solution");
  });
});
```

3. In `apps/server/src/api/schemas.ts`:
   - After `import { z } from "@hono/zod-openapi";` add `import { RULE_IDS } from "@loophole/core";`.
   - Append at the end of the file:

```ts

export const HintRequestSchema = z
  .strictObject({
    edges: z
      .string()
      .regex(/^[012]*$/)
      .max(20_200)
      .openapi({
        description:
          "The player's board: one character per edge, 0 empty, 1 line, 2 cross (docs/FORMAT.md).",
      }),
  })
  .openapi("HintRequest");

const EdgeIndex = z.int().min(0);

export const HintSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("solved") }),
    z.object({
      kind: z.literal("mistake"),
      edge: EdgeIndex.openapi({
        description: "The first edge marked differently from the solution.",
      }),
      count: z.int().min(1).openapi({ description: "How many marks are wrong." }),
    }),
    z.object({
      kind: z.literal("step"),
      rule: z.enum(RULE_IDS),
      changes: z.array(z.object({ edge: EdgeIndex, state: z.enum(["line", "cross"]) })),
      cells: z.array(z.int().min(0)),
      dots: z.array(z.int().min(0)),
    }),
    z.object({
      kind: z.literal("reveal"),
      edge: EdgeIndex.openapi({ description: "An open edge that is a line in the solution." }),
    }),
  ])
  .openapi("Hint", {
    description:
      "The next hint: a wrong mark, the next deduction (rule, edges it decides, cells and dots it rests on), a line from the solution when no rule applies, or solved.",
  });
```

4. In `apps/server/src/api/app.ts`, make these edits:
   - Replace `import { serializePuzzle } from "@loophole/core";` with `import { EdgeState, type Hint, serializePuzzle } from "@loophole/core";`.
   - After `import { QueueFullError } from "../managers/errors.ts";` add `import { type HintManager, InvalidBoardError } from "../managers/hint-manager.ts";`.
   - In the `./schemas.ts` import list, add `HintRequestSchema,` and `HintSchema,` after `HealthSchema,`.
   - In `interface AppDeps`, after `readonly jobs: JobManager;` add `readonly hints: HintManager;`.
   - Insert this route definition directly above `const generateRoute = createRoute({`:

```ts
const hintRoute = createRoute({
  method: "post",
  path: "/api/puzzles/{id}/hint",
  summary: "The next hint for a player's board",
  description:
    "Works from the player's marks and the stored solution, which is never sent (PRD FR-12, FR-25).",
  request: {
    params: IdParamSchema,
    body: { required: true, content: { "application/json": { schema: HintRequestSchema } } },
  },
  responses: {
    200: { description: "The hint.", content: { "application/json": { schema: HintSchema } } },
    400: problemResponse("Invalid id, or a board that does not fit the puzzle."),
    404: problemResponse("No published puzzle with this id."),
    413: problemResponse("Request body larger than 64 KiB."),
    415: problemResponse("Request body is not JSON."),
  },
});

```

   - Replace `const { puzzles, jobs } = deps;` with `const { puzzles, jobs, hints } = deps;`.
   - Insert directly above `  app.openapi(generateRoute, (c) => {`:

```ts
  app.openapi(hintRoute, async (c) => {
    const hint = await hints.hint(c.req.valid("param").id, c.req.valid("json").edges);
    if (hint === null) return problem(c, 404, "Puzzle not found");
    return c.json(toHintDto(hint), 200);
  });

```

   - In `app.onError`, directly above `    if (err instanceof HTTPException) return problem(c, err.status, err.message);` insert:

```ts
    if (err instanceof InvalidBoardError)
      return problem(c, 400, "Invalid board", { detail: err.message });
```

   - Insert directly above `function toJobDto(job: Job) {`:

```ts
function toHintDto(hint: Hint) {
  switch (hint.kind) {
    case "solved":
      return { kind: "solved" as const };
    case "mistake":
      return { kind: "mistake" as const, edge: hint.edge, count: hint.count };
    case "reveal":
      return { kind: "reveal" as const, edge: hint.edge };
    case "step":
      return {
        kind: "step" as const,
        rule: hint.step.rule,
        changes: hint.step.changes.map((ch) => ({
          edge: ch.edge,
          state: ch.state === EdgeState.Line ? ("line" as const) : ("cross" as const),
        })),
        cells: [...hint.step.cells],
        dots: [...hint.step.dots],
      };
  }
}

```

5. In `apps/server/src/api/main.ts`:
   - After `import { loadConfig } from "../config.ts";` add `import { HintManager } from "../managers/hint-manager.ts";`.
   - Replace `const app = createApp({ puzzles, jobs, webDir: config.webDir });` with:

```ts
const hints = new HintManager({ puzzles });
const app = createApp({ puzzles, jobs, hints, webDir: config.webDir });
```

6. In `apps/server/src/api/spec.ts`:
   - Add `import { HintManager } from "../managers/hint-manager.ts";` above the `JobManager` import.
   - Replace

```ts
  const db = openDatabase(":memory:");
  const app = createApp({
    puzzles: new PuzzleManager({
      puzzles: new SqlitePuzzleRepository(db),
      blobs: new MemoryBlobStore(),
      clock: systemClock,
    }),
```

   with

```ts
  const db = openDatabase(":memory:");
  const puzzles = new PuzzleManager({
    puzzles: new SqlitePuzzleRepository(db),
    blobs: new MemoryBlobStore(),
    clock: systemClock,
  });
  const app = createApp({
    puzzles,
    hints: new HintManager({ puzzles }),
```

7. In `apps/server/src/worker/flow.test.ts`:
   - Add `import { HintManager } from "../managers/hint-manager.ts";` above the `JobManager` import.
   - Replace `return { app: createApp({ puzzles, jobs }), runs, puzzles };` with `return { app: createApp({ puzzles, jobs, hints: new HintManager({ puzzles }) }), runs, puzzles };`.

8. In `apps/server/src/api/app.test.ts`:
   - Add `import { HintManager } from "../managers/hint-manager.ts";` above the `JobManager` import.
   - Replace `const app = createApp({ puzzles, jobs, webDir: options.webDir });` with:

```ts
  const app = createApp({
    puzzles,
    jobs,
    hints: new HintManager({ puzzles }),
    webDir: options.webDir,
  });
```

   - Insert directly above `describe("jobs", () => {`:

```ts
describe("POST /api/puzzles/{id}/hint", () => {
  test("answers with the next step, in wire shape", async () => {
    const { app, savePuzzle } = setup();
    const id = await savePuzzle();
    const res = await app.request(`/api/puzzles/${id}/hint`, postJson({ edges: "000000000000" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: string; changes: { edge: number; state: string }[] };
    expect(body.kind).toBe("step");
    for (const { edge, state } of body.changes) {
      expect(state).toBe(SOLUTION[edge] === "1" ? "line" : "cross");
    }
  });

  test("points out a wrong mark and never sends the solution", async () => {
    const { app, savePuzzle } = setup();
    const id = await savePuzzle();
    const res = await app.request(`/api/puzzles/${id}/hint`, postJson({ edges: "200000000000" }));
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ kind: "mistake", edge: 0, count: 1 });
    expect(text).not.toContain(SOLUTION);
  });

  test("rejects a board of the wrong size, bad characters and unknown fields", async () => {
    const { app, savePuzzle } = setup();
    const id = await savePuzzle();
    const url = `/api/puzzles/${id}/hint`;
    const short = await expectProblem(await app.request(url, postJson({ edges: "000" })), 400);
    expect(short.detail).toContain("expected 12 characters");
    await expectProblem(await app.request(url, postJson({ edges: "00000000000x" })), 400);
    await expectProblem(await app.request(url, postJson({ edges: "0", extra: 1 })), 400);
  });

  test("is 404 for an unknown puzzle", async () => {
    const { app } = setup();
    await expectProblem(await app.request("/api/puzzles/nope/hint", postJson({ edges: "" })), 404);
  });
});

```

9. In `apps/server/AGENTS.md`, replace the bullet beginning `- Solutions and solver traces live in the blob store` with:

```
- Solutions and solver traces live in the blob store, and puzzle responses carry clues only (PRD FR-25). Server code that needs a solution reads it through the puzzle manager; hints are worked out here from the stored solution (the hint manager), so a client never needs it.
```

10. Regenerate the contract: `bun run gen:api` (rewrites `openapi.yaml` and `packages/api-client/src/schema.ts`; both are committed). Check that `packages/api-client/src/schema.ts` now has a `Hint:` union with `kind: "solved" | …` members and a `"/api/puzzles/{id}/hint"` path.

**Verify:**

```sh
bun run format && bun run gen:api && bun test apps/server && bun run --cwd apps/server typecheck && bun run check
```

**Commit:** `feat(server): add a hint endpoint backed by the stored solution`

### Step 3 — Web: hint logic, rule patterns, hint keys and puzzle sources

1. Create `apps/web/src/lib/game/hint.ts`:

```ts
import {
  EdgeState,
  type Grid,
  type Hint,
  type Puzzle,
  RULE_TEXT,
  RULE_TITLE,
  type RuleId,
  verify,
} from "@loophole/core";
import type { EdgeChange } from "./board.ts";
import { cellPoint, dotPoint, edgeMidpoint, type Layout, type Point } from "./geometry.ts";
import type { Rect } from "./viewport.ts";

/** What a hint draws on the board (design kit, Board): an ai wash and dashed ai ghost moves. */
export interface HintMarks {
  readonly cells: readonly number[];
  readonly dots: readonly number[];
  /** The forced move: a dashed ghost line or a ghost ×, on edges that are still empty. */
  readonly ghosts: readonly EdgeChange[];
}

/** A hint ready to show: the card's words, the board marks and the move "Apply" makes. */
export interface HintView {
  /** The small line above the title, e.g. "next forced move". */
  readonly eyebrow: string;
  readonly title: string;
  readonly text: string;
  /** The rule whose pattern the card draws, or null for a mistake or a revealed line. */
  readonly rule: RuleId | null;
  readonly marks: HintMarks;
  readonly apply: readonly EdgeChange[];
  readonly applyLabel: string;
  /** The label of the button that closes the card and leaves the move to the player. */
  readonly laterLabel: string;
  /** The states of the `apply` edges when the hint was made. */
  readonly before: readonly EdgeState[];
}

/** The two dots at the ends of an edge. */
function edgeDots(grid: Grid, edge: number): number[] {
  return [grid.edgeDots[edge * 2], grid.edgeDots[edge * 2 + 1]];
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Turns a core hint into what the card and the board show. Null when the board is solved. */
export function hintView(grid: Grid, hint: Hint, edges: Uint8Array): HintView | null {
  const view = (v: Omit<HintView, "before">): HintView => ({
    ...v,
    before: v.apply.map(([e]) => edges[e] as EdgeState),
  });
  switch (hint.kind) {
    case "solved":
      return null;
    case "step": {
      const { rule, changes, cells, dots } = hint.step;
      const moves = changes.map((c): EdgeChange => [c.edge, c.state]);
      return view({
        eyebrow: "next forced move",
        title: RULE_TITLE[rule],
        text: RULE_TEXT[rule],
        rule,
        marks: { cells, dots, ghosts: moves },
        apply: moves,
        applyLabel: "Apply move",
        laterLabel: "I'll draw it",
      });
    }
    case "mistake": {
      const line = edges[hint.edge] === EdgeState.Line;
      const others = hint.count - 1;
      const more =
        others > 0
          ? ` ${others} more ${plural(others, "mark doesn't", "marks don't")} fit either.`
          : "";
      return view({
        eyebrow: "check your marks",
        title: line ? "This line doesn't fit" : "This × doesn't fit",
        text:
          (line
            ? "The line between the two highlighted dots is not part of the solution."
            : "The loop needs the edge between the two highlighted dots.") + more,
        rule: null,
        marks: { cells: [], dots: edgeDots(grid, hint.edge), ghosts: [] },
        apply: [[hint.edge, EdgeState.Unknown]],
        applyLabel: "Erase it",
        laterLabel: "I'll fix it",
      });
    }
    case "reveal": {
      const move: EdgeChange = [hint.edge, EdgeState.Line];
      return view({
        eyebrow: "from the solution",
        title: "No rule applies here",
        text: "None of the rules decides the next move from what is on the board, so here is one line of the solution.",
        rule: null,
        marks: { cells: [], dots: edgeDots(grid, hint.edge), ghosts: [move] },
        apply: [move],
        applyLabel: "Apply move",
        laterLabel: "I'll draw it",
      });
    }
  }
}

/**
 * Whether a hint still applies to the board: false once the player has made its whole move, or has
 * changed one of its edges to something else (say, undone a mark it asked to erase).
 */
export function hintCurrent(view: HintView, edges: Uint8Array): boolean {
  let done = true;
  for (let i = 0; i < view.apply.length; i++) {
    const [edge, target] = view.apply[i];
    const now = edges[edge];
    if (now === target) continue;
    if (now !== view.before[i]) return false;
    done = false;
  }
  return !done;
}

/**
 * The board area a hint's marks cover, in board pixels, with half a cell around them; a zoomed board
 * pans it into view. Null when there are no marks.
 */
export function hintRect(grid: Grid, layout: Layout, marks: HintMarks): Rect | null {
  const points: Point[] = [
    ...marks.cells.map((c) => cellPoint(grid, layout, c)),
    ...marks.dots.map((d) => dotPoint(grid, layout, d)),
    ...marks.ghosts.map(([e]) => edgeMidpoint(grid, layout, e)),
  ];
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const half = layout.cell / 2;
  const x = Math.min(...xs) - half;
  const y = Math.min(...ys) - half;
  return {
    x,
    y,
    width: Math.max(...xs) + half - x,
    height: Math.max(...ys) + half - y,
  };
}

/**
 * The puzzle's solution, worked out from its clues, for hints on puzzles that come with no server
 * (the built-in ones). Throws when the puzzle has no single solution.
 */
export function puzzleSolution(puzzle: Puzzle): Uint8Array {
  const result = verify(puzzle);
  if (result.status !== "unique") throw new Error(`No single solution (${result.status})`);
  return result.solutions[0];
}
```

2. Create `apps/web/src/lib/game/hint.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  decodeEdges,
  EdgeState,
  findHint,
  type Hint,
  parsePuzzle,
  RULE_TEXT,
  RULE_TITLE,
} from "@loophole/core";
import { FIXTURE_SOLUTIONS } from "../test-support/solutions.ts";
import { hintCurrent, hintRect, hintView, puzzleSolution } from "./hint.ts";

// 2×2 all 2s; its only loop runs around the outside.
const puzzle = parsePuzzle({ v: 1, width: 2, height: 2, clues: "2222" });
const grid = puzzle.grid;
const empty = () => new Uint8Array(grid.edgeCount);

describe("hintView", () => {
  test("a step shows its rule's title and text, ghosts its changes and applies them", () => {
    const hint: Hint = {
      kind: "step",
      step: {
        rule: "clue-zero",
        changes: [
          { edge: 0, state: EdgeState.Cross },
          { edge: 7, state: EdgeState.Cross },
        ],
        cells: [0],
        dots: [],
      },
    };
    const view = hintView(grid, hint, empty());
    expect(view).toEqual({
      eyebrow: "next forced move",
      title: RULE_TITLE["clue-zero"],
      text: RULE_TEXT["clue-zero"],
      rule: "clue-zero",
      marks: {
        cells: [0],
        dots: [],
        ghosts: [
          [0, EdgeState.Cross],
          [7, EdgeState.Cross],
        ],
      },
      apply: [
        [0, EdgeState.Cross],
        [7, EdgeState.Cross],
      ],
      applyLabel: "Apply move",
      laterLabel: "I'll draw it",
      before: [EdgeState.Unknown, EdgeState.Unknown],
    });
  });

  test("a wrong line is highlighted by its dots and erased, and the others are counted", () => {
    const edges = empty();
    edges[2] = EdgeState.Line;
    const view = hintView(grid, { kind: "mistake", edge: 2, count: 3 }, edges);
    expect(view?.title).toBe("This line doesn't fit");
    expect(view?.text).toEndWith("2 more marks don't fit either.");
    expect(view?.marks).toEqual({ cells: [], dots: [3, 4], ghosts: [] });
    expect(view?.apply).toEqual([[2, EdgeState.Unknown]]);
    expect(view?.applyLabel).toBe("Erase it");
    expect(view?.laterLabel).toBe("I'll fix it");
    expect(view?.rule).toBeNull();
  });

  test("a wrong cross says the loop needs that edge", () => {
    const edges = empty();
    edges[0] = EdgeState.Cross;
    const view = hintView(grid, { kind: "mistake", edge: 0, count: 1 }, edges);
    expect(view?.title).toBe("This × doesn't fit");
    expect(view?.text).not.toContain("more");
  });

  test("a revealed line is ghosted and applied as a line", () => {
    const view = hintView(grid, { kind: "reveal", edge: 1 }, empty());
    expect(view?.marks.ghosts).toEqual([[1, EdgeState.Line]]);
    expect(view?.apply).toEqual([[1, EdgeState.Line]]);
    expect(view?.rule).toBeNull();
  });

  test("a solved board has nothing to show", () => {
    expect(hintView(grid, { kind: "solved" }, empty())).toBeNull();
  });
});

describe("hintCurrent", () => {
  const hint: Hint = {
    kind: "step",
    step: {
      rule: "clue-needs-all",
      changes: [
        { edge: 0, state: EdgeState.Line },
        { edge: 1, state: EdgeState.Line },
      ],
      cells: [0],
      dots: [],
    },
  };

  test("holds while part of the move is still to make", () => {
    const edges = empty();
    const view = hintView(grid, hint, edges);
    if (view === null) throw new Error("no view");
    expect(hintCurrent(view, edges)).toBe(true);
    edges[0] = EdgeState.Line;
    expect(hintCurrent(view, edges)).toBe(true);
    edges[5] = EdgeState.Cross; // elsewhere
    expect(hintCurrent(view, edges)).toBe(true);
  });

  test("ends when the whole move is made", () => {
    const edges = empty();
    const view = hintView(grid, hint, edges);
    if (view === null) throw new Error("no view");
    edges[0] = EdgeState.Line;
    edges[1] = EdgeState.Line;
    expect(hintCurrent(view, edges)).toBe(false);
  });

  test("ends when one of its edges is marked differently", () => {
    const edges = empty();
    const view = hintView(grid, hint, edges);
    if (view === null) throw new Error("no view");
    edges[1] = EdgeState.Cross;
    expect(hintCurrent(view, edges)).toBe(false);
  });
});

describe("hintRect", () => {
  const layout = { cell: 40, margin: 10, width: 100, height: 100 };

  test("covers cells, dots and ghost edges with half a cell around them", () => {
    // Cell 0 is centred at (30, 30); dot 8 (row 2, col 2) is at (90, 90).
    expect(hintRect(grid, layout, { cells: [0], dots: [8], ghosts: [] })).toEqual({
      x: 10,
      y: 10,
      width: 100,
      height: 100,
    });
    // Edge 0 (top of cell 0) has its middle at (30, 10).
    expect(hintRect(grid, layout, { cells: [], dots: [], ghosts: [[0, EdgeState.Line]] })).toEqual({
      x: 10,
      y: -10,
      width: 40,
      height: 40,
    });
  });

  test("is null without marks", () => {
    expect(hintRect(grid, layout, { cells: [], dots: [], ghosts: [] })).toBeNull();
  });
});

describe("puzzleSolution", () => {
  test("works out a built-in puzzle's solution from its clues", () => {
    const small = parsePuzzle({
      v: 1,
      width: 7,
      height: 7,
      clues: ".11..0..23.2......2.21.0....1....01.1..3..0..1..1",
    });
    const solution = puzzleSolution(small);
    expect(solution).toEqual(decodeEdges(small.grid, FIXTURE_SOLUTIONS["small-7"]));
    expect(findHint(small, solution, solution)).toEqual({ kind: "solved" });
  });

  test("throws for a puzzle without a single solution", () => {
    expect(() => puzzleSolution(parsePuzzle({ v: 1, width: 2, height: 2, clues: "...." }))).toThrow(
      "No single solution",
    );
  });
});
```

3. Create `apps/web/src/lib/game/patterns.ts`:

```ts
import {
  cellIndex,
  dotIndex,
  EdgeState,
  type Grid,
  hEdgeIndex,
  type Puzzle,
  parsePuzzle,
  type RuleId,
  vEdgeIndex,
} from "@loophole/core";
import type { EdgeChange } from "./board.ts";
import type { HintMarks } from "./hint.ts";

/** A rule drawn small on the hint card (Hint artboard): a tiny board, its marks and the hint. */
export interface RulePattern {
  readonly puzzle: Puzzle;
  readonly edges: Uint8Array;
  readonly marks: HintMarks;
}

interface PatternSpec {
  readonly lines?: readonly number[];
  readonly crosses?: readonly number[];
  readonly cells?: readonly number[];
  readonly dots?: readonly number[];
  readonly ghostLines?: readonly number[];
  readonly ghostCrosses?: readonly number[];
}

/** Index helpers for one grid: h(r, c), v(r, c), cell(r, c), dot(r, c). */
interface At {
  readonly h: (r: number, c: number) => number;
  readonly v: (r: number, c: number) => number;
  readonly cell: (r: number, c: number) => number;
  readonly dot: (r: number, c: number) => number;
}

function pattern(
  width: number,
  height: number,
  clues: string,
  spec: (at: At) => PatternSpec,
): RulePattern {
  const puzzle = parsePuzzle({ v: 1, width, height, clues });
  const g: Grid = puzzle.grid;
  const s = spec({
    h: (r, c) => hEdgeIndex(g, r, c),
    v: (r, c) => vEdgeIndex(g, r, c),
    cell: (r, c) => cellIndex(g, r, c),
    dot: (r, c) => dotIndex(g, r, c),
  });
  const edges = new Uint8Array(g.edgeCount);
  for (const e of s.lines ?? []) edges[e] = EdgeState.Line;
  for (const e of s.crosses ?? []) edges[e] = EdgeState.Cross;
  const ghosts: EdgeChange[] = [
    ...(s.ghostLines ?? []).map((e): EdgeChange => [e, EdgeState.Line]),
    ...(s.ghostCrosses ?? []).map((e): EdgeChange => [e, EdgeState.Cross]),
  ];
  return { puzzle, edges, marks: { cells: s.cells ?? [], dots: s.dots ?? [], ghosts } };
}

/**
 * A small picture for each rule that has one. Rules about dots use a 2×2 board and its centre dot;
 * the others use the fewest cells that show the idea. Lookahead has no single picture, and a hint
 * never shows loop-complete (the board is solved by then), so neither has one.
 */
export const RULE_PATTERNS: Readonly<Partial<Record<RuleId, RulePattern>>> = {
  "clue-zero": pattern(1, 1, "0", (a) => ({
    cells: [0],
    ghostCrosses: [a.h(0, 0), a.v(0, 1), a.h(1, 0), a.v(0, 0)],
  })),
  "clue-satisfied": pattern(1, 1, "1", (a) => ({
    lines: [a.h(0, 0)],
    cells: [0],
    ghostCrosses: [a.v(0, 1), a.h(1, 0), a.v(0, 0)],
  })),
  "clue-needs-all": pattern(1, 1, "1", (a) => ({
    crosses: [a.h(0, 0), a.h(1, 0), a.v(0, 0)],
    cells: [0],
    ghostLines: [a.v(0, 1)],
  })),
  "dot-full": pattern(2, 2, "....", (a) => ({
    lines: [a.v(0, 1), a.h(1, 0)],
    dots: [a.dot(1, 1)],
    ghostCrosses: [a.h(1, 1), a.v(1, 1)],
  })),
  "dot-continue": pattern(2, 2, "....", (a) => ({
    lines: [a.v(0, 1)],
    crosses: [a.h(1, 0), a.v(1, 1)],
    dots: [a.dot(1, 1)],
    ghostLines: [a.h(1, 1)],
  })),
  "dot-dead-end": pattern(2, 2, "....", (a) => ({
    crosses: [a.v(0, 1), a.h(1, 0), a.v(1, 1)],
    dots: [a.dot(1, 1)],
    ghostCrosses: [a.h(1, 1)],
  })),
  // A corner of the clue whose two outside edges are crossed, here inside the board.
  "corner-1": pattern(2, 2, "..1.", (a) => ({
    crosses: [a.v(0, 1), a.h(1, 1)],
    cells: [a.cell(1, 0)],
    dots: [a.dot(1, 1)],
    ghostCrosses: [a.h(1, 0), a.v(1, 1)],
  })),
  "corner-3": pattern(2, 2, "..3.", (a) => ({
    crosses: [a.v(0, 1), a.h(1, 1)],
    cells: [a.cell(1, 0)],
    dots: [a.dot(1, 1)],
    ghostLines: [a.h(1, 0), a.v(1, 1)],
  })),
  "adjacent-3s": pattern(2, 3, "..33..", (a) => ({
    cells: [a.cell(1, 0), a.cell(1, 1)],
    ghostLines: [a.v(1, 0), a.v(1, 2)],
    ghostCrosses: [a.v(0, 1), a.v(2, 1)],
  })),
  "diagonal-3s": pattern(2, 2, "3..3", (a) => ({
    cells: [a.cell(0, 0), a.cell(1, 1)],
    ghostLines: [a.h(0, 0), a.v(0, 0), a.h(2, 1), a.v(1, 2)],
  })),
  "premature-loop": pattern(2, 1, "..", (a) => ({
    lines: [a.h(0, 0), a.v(0, 0), a.h(1, 0), a.v(0, 2)],
    dots: [a.dot(0, 1), a.dot(1, 1)],
    ghostCrosses: [a.v(0, 1)],
  })),
  // The left cell is outside (its outer side is crossed), the right one inside (its outer side is a
  // line), so the edge between them is a line.
  parity: pattern(2, 1, "..", (a) => ({
    crosses: [a.v(0, 0)],
    lines: [a.v(0, 2)],
    cells: [a.cell(0, 0), a.cell(0, 1)],
    ghostLines: [a.v(0, 1)],
  })),
};
```

4. Create `apps/web/src/lib/game/patterns.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { EdgeState, RULE_IDS } from "@loophole/core";
import { RULE_PATTERNS } from "./patterns.ts";

describe("RULE_PATTERNS", () => {
  test("every rule but lookahead and loop-complete has a pattern with a ghost move on empty edges", () => {
    const drawn = RULE_IDS.filter((id) => id !== "lookahead" && id !== "loop-complete");
    expect(Object.keys(RULE_PATTERNS).sort()).toEqual([...drawn].sort());
    for (const id of drawn) {
      const p = RULE_PATTERNS[id];
      if (p === undefined) throw new Error(`no pattern for ${id}`);
      const { puzzle, edges, marks } = p;
      const { grid } = puzzle;
      expect([id, marks.ghosts.length > 0]).toEqual([id, true]);
      for (const [edge] of marks.ghosts) {
        expect(edge).toBeLessThan(grid.edgeCount);
        expect([id, edges[edge]]).toEqual([id, EdgeState.Unknown]);
      }
      for (const c of marks.cells) expect(c).toBeLessThan(grid.cellCount);
      for (const d of marks.dots) expect(d).toBeLessThan(grid.dotCount);
      // Small enough to read at 72px.
      expect(Math.max(grid.width, grid.height)).toBeLessThanOrEqual(3);
    }
  });
});
```

5. In `apps/web/src/lib/game/keyboard.ts`:
   - Replace `  | { readonly type: "cycle" | "cross" | "erase" | "undo" | "redo" | "pause" };` with:

```ts
  | {
      readonly type: "cycle" | "cross" | "erase" | "undo" | "redo" | "pause" | "hint" | "close";
    };
```

   - Replace the one-line doc comment `/** Shortcuts that work anywhere on the play screen: Z undo, Y redo, P pause, plus Ctrl/⌘ forms. */` with:

```ts
/**
 * Shortcuts that work anywhere on the play screen: Z undo, Y redo, P pause, H hint, Escape to close
 * the hint card, plus Ctrl/⌘ forms of undo and redo.
 */
```

   - In `screenCommand`, replace

```ts
  if (key === "p") return { type: "pause" };
  return null;
```

   with

```ts
  if (key === "p") return { type: "pause" };
  if (key === "h") return { type: "hint" };
  if (key === "escape") return { type: "close" };
  return null;
```

6. In `apps/web/src/lib/game/keyboard.test.ts`, inside `describe("screenCommand", …)`, add after the test `"maps Z, Y and P with and without modifiers"`:

```ts

  test("maps H to a hint and Escape to closing it", () => {
    expect(screenCommand(key("h"))).toEqual({ type: "hint" });
    expect(screenCommand(key("H", { shiftKey: true }))).toEqual({ type: "hint" });
    expect(screenCommand(key("Escape"))).toEqual({ type: "close" });
    expect(screenCommand(key("h", { ctrlKey: true }))).toBeNull();
  });
```

7. In `apps/web/src/lib/puzzles/source.ts`:
   - Replace `import type { Puzzle } from "@loophole/core";` with `import type { Hint, Puzzle } from "@loophole/core";`.
   - In `interface PuzzleSource`, after the `get(id: string): Promise<PuzzleEntry | null>;` line add:

```ts
  /** The next hint for the player's board `edges` on puzzle `id` (PRD FR-12). */
  hint(id: string, puzzle: Puzzle, edges: Uint8Array): Promise<Hint>;
```

8. In `apps/web/src/lib/puzzles/fixtures.ts`:
   - Replace the first import line with:

```ts
import { findHint, type PuzzleWireV1, parsePuzzle } from "@loophole/core";
import { puzzleSolution } from "../game/hint.ts";
```

   - Directly above `export const fixtureSource: PuzzleSource = {` insert:

```ts
// Solutions worked out on the first hint for each built-in puzzle; the app ships none.
const solutions = new Map<string, Uint8Array>();

```

   - Replace the end of `fixtureSource`

```ts
    const entry: PuzzleEntry = { ...summary(f), puzzle: parsePuzzle(f.wire) };
    return entry;
  },
};
```

   with

```ts
    const entry: PuzzleEntry = { ...summary(f), puzzle: parsePuzzle(f.wire) };
    return entry;
  },
  async hint(id, puzzle, edges) {
    let solution = solutions.get(id);
    if (solution === undefined) {
      solution = puzzleSolution(puzzle);
      solutions.set(id, solution);
    }
    return findHint(puzzle, solution, edges);
  },
};
```

9. In `apps/web/src/lib/puzzles/api.ts`:
   - Replace `import { parsePuzzle } from "@loophole/core";` with `import { EdgeState, encodeEdges, type Hint, parsePuzzle } from "@loophole/core";`.
   - Replace the line `/** Puzzles from the server's API: recent published puzzles, clues only. */` with:

```ts
function toHint(h: Schemas["Hint"]): Hint {
  switch (h.kind) {
    case "solved":
    case "mistake":
    case "reveal":
      return h;
    case "step":
      return {
        kind: "step",
        step: {
          rule: h.rule,
          changes: h.changes.map((c) => ({
            edge: c.edge,
            state: c.state === "line" ? EdgeState.Line : EdgeState.Cross,
          })),
          cells: h.cells,
          dots: h.dots,
        },
      };
  }
}

/** Puzzles from the server's API: recent published puzzles, clues only, and hints. */
```

   - Replace the end of `apiSource`

```ts
      return { ...summary({ ...data, width, height }), puzzle: parsePuzzle(data.puzzle) };
    },
  };
}
```

   with

```ts
      return { ...summary({ ...data, width, height }), puzzle: parsePuzzle(data.puzzle) };
    },
    async hint(id, _puzzle, edges) {
      const { data, response } = await client.POST("/api/puzzles/{id}/hint", {
        params: { path: { id } },
        body: { edges: encodeEdges(edges) },
      });
      if (data === undefined) throw new Error(`Could not get a hint (HTTP ${response.status})`);
      return toHint(data);
    },
  };
}
```

10. In `apps/web/src/lib/puzzles/combined.ts`, after the `get` method (after its closing `},`) add:

```ts
    async hint(id, puzzle, edges) {
      const source = (await local.get(id)) !== null ? local : server;
      return source.hint(id, puzzle, edges);
    },
```

11. In `apps/web/src/lib/puzzles/api.test.ts`:
   - Replace `import { serializePuzzle } from "@loophole/core";` with `import { createPuzzle, EdgeState, serializePuzzle } from "@loophole/core";`.
   - Replace the `clientFor` helper's doc comment and first lines so it also records request bodies:

```ts
/**
 * A client whose fetch answers from `routes` (path → [status, body]) and records the URLs and the
 * request bodies.
 */
function clientFor(routes: Record<string, [number, unknown]>) {
  const urls: string[] = [];
  const bodies: unknown[] = [];
  const fetch = (async (input: Request) => {
    const url = new URL(input.url);
    urls.push(url.pathname + url.search);
    if (input.method === "POST") bodies.push(await input.json());
```

     (the rest of the function stays) and replace its return line with `  return { client: createApiClient({ baseUrl: "http://api.test", fetch }), urls, bodies };`.
   - Add these tests at the end of `describe("apiSource", …)`:

```ts

  test("hint posts the board and maps a step to core's shape", async () => {
    const step = {
      kind: "step",
      rule: "clue-zero",
      changes: [
        { edge: 0, state: "cross" },
        { edge: 7, state: "line" },
      ],
      cells: [0],
      dots: [],
    };
    const { client, bodies } = clientFor({ "/api/puzzles/p1/hint": [200, step] });
    const puzzle = createPuzzle(2, 2);
    const edges = new Uint8Array(puzzle.grid.edgeCount);
    edges[3] = EdgeState.Line;
    expect(await apiSource(client).hint("p1", puzzle, edges)).toEqual({
      kind: "step",
      step: {
        rule: "clue-zero",
        changes: [
          { edge: 0, state: EdgeState.Cross },
          { edge: 7, state: EdgeState.Line },
        ],
        cells: [0],
        dots: [],
      },
    });
    expect(bodies).toEqual([{ edges: "000100000000" }]);
  });

  test("hint passes other kinds through and throws on failure", async () => {
    const { client } = clientFor({
      "/api/puzzles/p1/hint": [200, { kind: "mistake", edge: 4, count: 2 }],
      "/api/puzzles/p2/hint": [404, { title: "Puzzle not found" }],
    });
    const puzzle = createPuzzle(2, 2);
    const edges = new Uint8Array(puzzle.grid.edgeCount);
    expect(await apiSource(client).hint("p1", puzzle, edges)).toEqual({
      kind: "mistake",
      edge: 4,
      count: 2,
    });
    await expect(apiSource(client).hint("p2", puzzle, edges)).rejects.toThrow("HTTP 404");
  });
```

12. In `apps/web/src/lib/puzzles/combined.test.ts`:
   - Replace `sourceOf` with:

```ts
/** A source holding `ids`; every hint it gives is a reveal of edge `ids.length`, to tell sources apart. */
function sourceOf(...ids: string[]): PuzzleSource {
  return {
    list: async () => ids.map((id) => ({ ...entry(id) })),
    get: async (id) => (ids.includes(id) ? entry(id) : null),
    hint: async () => ({ kind: "reveal", edge: ids.length }),
  };
}
```

   - In `down`, after its `get` member add:

```ts
  hint: async () => {
    throw new Error("offline");
  },
```

   - Add at the end of `describe("withServer", …)`:

```ts

  test("hint asks the source that holds the puzzle", async () => {
    const puzzle = createPuzzle(1, 1);
    const edges = new Uint8Array(4);
    const source = withServer(sourceOf("a"), sourceOf("x", "y"));
    expect(await source.hint("a", puzzle, edges)).toEqual({ kind: "reveal", edge: 1 });
    expect(await source.hint("x", puzzle, edges)).toEqual({ kind: "reveal", edge: 2 });
    await expect(withServer(sourceOf("a"), down).hint("z", puzzle, edges)).rejects.toThrow(
      "offline",
    );
  });
```

13. In `apps/web/src/lib/puzzles/fixtures.test.ts`:
   - Replace the core import with `import { analyzeBoard, decodeEdges, EdgeState, verify } from "@loophole/core";`.
   - Add at the end of `describe("fixture puzzles", …)`:

```ts

  test("hint works from the puzzle's own solution", async () => {
    const entry = await fixtureSource.get("small-7");
    if (entry === null) throw new Error("missing small-7");
    const { puzzle } = entry;
    const solution = decodeEdges(puzzle.grid, FIXTURE_SOLUTIONS["small-7"]);
    const empty = new Uint8Array(puzzle.grid.edgeCount);
    const first = await fixtureSource.hint("small-7", puzzle, empty);
    expect(first.kind).toBe("step");
    if (first.kind === "step") {
      for (const { edge, state } of first.step.changes) expect(solution[edge]).toBe(state);
    }
    const wrong = empty.slice();
    const e = solution.indexOf(EdgeState.Cross);
    wrong[e] = EdgeState.Line;
    expect(await fixtureSource.hint("small-7", puzzle, wrong)).toEqual({
      kind: "mistake",
      edge: e,
      count: 1,
    });
  });
```

**Verify:**

```sh
bun run format && bun test apps/web/src/lib && bun run --cwd apps/web typecheck && bun run check
```

**Commit:** `feat(web): hint logic, rule patterns and hint sources`

### Step 4 — Follow-up: trackpad pinch speed

In `apps/web/src/lib/components/BoardView.svelte`, inside the `onwheel` handler, replace

```ts
        // A mouse-wheel notch is about 100 px of delta; clamp it so one notch is about 1.28×, not e×.
        const step = Math.max(-50, Math.min(50, dy));
        onview(zoomAround(grid, view, view.cell * Math.exp(-step * 0.005), local(e), port, zoom));
```

with

```ts
        // A mouse-wheel notch is about 100 px of delta; clamp it so one notch is about 1.28×, not
        // e×. Trackpad pinches send small deltas, which this rate keeps quick.
        const step = Math.max(-25, Math.min(25, dy));
        onview(zoomAround(grid, view, view.cell * Math.exp(-step * 0.01), local(e), port, zoom));
```

A mouse notch stays e^0.25 ≈ 1.28×; a trackpad pinch delta now zooms twice as fast as before.

**Verify:** `bun run check && bun run test:e2e` (the zoom tests' wheel-notch check must still pass).

**Commit:** `fix(web): restore trackpad pinch zoom speed`

### Step 5 — Web: hint marks on the SVG and canvas boards

1. In `apps/web/src/app.css` add a `--hint-wash` token directly after each `--ai-wash` line (three places; keep each block's indentation):
   - In `:root` (Paper), after `  --ai-wash: rgb(46 76 138 / 0.12);` add `  --hint-wash: rgb(46 76 138 / 0.16);`
   - In `:root[data-theme="dark"]`, after `  --ai-wash: rgb(143 177 240 / 0.16);` add `  --hint-wash: rgb(143 177 240 / 0.2);`
   - In the `@media (prefers-color-scheme: dark)` block, after `    --ai-wash: rgb(143 177 240 / 0.16);` add `    --hint-wash: rgb(143 177 240 / 0.2);`

   Check with `grep -n hint-wash apps/web/src/app.css`: exactly three lines.

2. In `apps/web/src/lib/game/paint.ts`:
   - After `} from "./geometry.ts";` add `import type { HintMarks } from "./hint.ts";`.
   - In `interface Palette`, after `readonly wash: string;` add `readonly ai: string;` and `readonly hintWash: string;`.
   - In `interface Scene`, after `readonly palette: Palette;` add:

```ts
  /** The hint on show, or null. */
  readonly hint: HintMarks | null;
```

   - Replace the doc comment of `paintBoard` with:

```ts
/**
 * Draws the board on a canvas with the SVG board's look (design kit, Board): solved wash, hint wash,
 * lines (dashed shu for a premature loop), the hint's ghost moves, crosses, dots, clues and error
 * rings. Only the cells in the viewport, plus a one-cell border, are drawn (viewport culling); a
 * hint's few marks are drawn wherever they are.
 */
```

   - Replace `const { puzzle, edges, analysis, layout, view, port, ratio, palette } = scene;` with `const { puzzle, edges, analysis, layout, view, port, ratio, palette, hint } = scene;`.
   - Directly above `  const strokeLines = (dashed: boolean) => {` insert:

```ts
  const hinted = new Uint8Array(hint === null ? 0 : grid.cellCount);
  if (hint !== null) {
    ctx.fillStyle = palette.hintWash;
    for (const i of hint.cells) {
      hinted[i] = 1;
      const p = cellPoint(grid, layout, i);
      ctx.fillRect(p.x - S / 2 + 2, p.y - S / 2 + 2, S - 4, S - 4);
    }
    ctx.beginPath();
    for (const d of hint.dots) {
      const p = dotPoint(grid, layout, d);
      ctx.moveTo(p.x + S * 0.3, p.y);
      ctx.arc(p.x, p.y, S * 0.3, 0, 2 * Math.PI);
    }
    ctx.fill();
  }

```

   - Directly after the two lines `  if (v.loopEdges.length > 0) strokeLines(true);` / `  ctx.setLineDash([]);` insert:

```ts

  if (hint !== null && hint.ghosts.length > 0) {
    // The forced move on edges still empty: a dashed ai line, or a bolder ai ×.
    ctx.beginPath();
    for (const [e, state] of hint.ghosts) {
      if (state !== EdgeState.Line || edges[e] !== EdgeState.Unknown) continue;
      const s = edgeSegment(grid, layout, e);
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
    ctx.lineWidth = size.line;
    ctx.lineCap = "butt";
    ctx.strokeStyle = palette.ai;
    ctx.setLineDash([6, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const [e, state] of hint.ghosts) {
      if (state !== EdgeState.Cross || edges[e] !== EdgeState.Unknown) continue;
      const { x, y } = edgeMidpoint(grid, layout, e);
      const a = size.crossArm;
      ctx.moveTo(x - a, y - a);
      ctx.lineTo(x + a, y + a);
      ctx.moveTo(x + a, y - a);
      ctx.lineTo(x - a, y + a);
    }
    ctx.lineWidth = size.crossWidth * 1.6;
    ctx.lineCap = "round";
    ctx.stroke();
  }
```

   - Replace

```ts
  ctx.beginPath();
  if (S >= MIN_CLUE_CELL) {
    ctx.font = `500 ${size.clue}px "Zen Kaku Gothic New", system-ui, sans-serif`;
```

   with

```ts
  ctx.beginPath();
  const clueFont = (weight: number) =>
    `${weight} ${size.clue}px "Zen Kaku Gothic New", system-ui, sans-serif`;
  if (S >= MIN_CLUE_CELL) {
    ctx.font = clueFont(500);
```

   - Replace

```ts
      if (S >= MIN_CLUE_CELL) {
        ctx.fillStyle = bad[i] === 1 ? palette.shu : palette.ink;
        ctx.fillText(String(clue), p.x, p.y);
      }
```

   with

```ts
      if (S >= MIN_CLUE_CELL) {
        // A clue the hint rests on is bold and ai, as on the Hint artboard.
        const strong = hint !== null && hinted[i] === 1 && bad[i] === 0;
        if (strong) ctx.font = clueFont(700);
        ctx.fillStyle = bad[i] === 1 ? palette.shu : strong ? palette.ai : palette.ink;
        ctx.fillText(String(clue), p.x, p.y);
        if (strong) ctx.font = clueFont(500);
      }
```

3. In `apps/web/src/lib/game/paint.test.ts`:
   - After the `bun:test`/core imports add `import type { HintMarks } from "./hint.ts";` (above the `./paint.ts` import).
   - Replace `const palette = { ink: "#000", pencil: "#888", shu: "#c00", wash: "#fee" };` with:

```ts
const palette = {
  ink: "#000",
  pencil: "#888",
  shu: "#c00",
  wash: "#fee",
  ai: "#24a",
  hintWash: "#24a3",
};
```

   - Replace the `scene` signature line `function scene(width: number, cell: number, x: number, y: number, edges?: Uint8Array): Scene {` with:

```ts
function scene(
  width: number,
  cell: number,
  x: number,
  y: number,
  edges?: Uint8Array,
  hint: HintMarks | null = null,
): Scene {
```

     and in its returned object add `hint,` after `palette,`.
   - Add at the end of `describe("paintBoard", …)`:

```ts

  test("draws a hint's wash, dot wash and ghost moves", () => {
    const grid = createGrid(5, 5);
    const hint: HintMarks = {
      cells: [0, 1],
      dots: [7],
      ghosts: [
        [hEdgeIndex(grid, 0, 0), EdgeState.Line],
        [hEdgeIndex(grid, 0, 1), EdgeState.Cross],
      ],
    };
    const plain = recorder();
    paintBoard(plain.ctx, scene(5, 44, 0, 0));
    const { ctx, calls } = recorder();
    paintBoard(ctx, scene(5, 44, 0, 0, undefined, hint));
    // Two cell washes; one dot wash circle.
    expect(calls.fillRect).toBe((plain.calls.fillRect ?? 0) + 2);
    expect(calls.arc).toBe(plain.calls.arc + 1);
    // One dashed ghost line and one ghost × (two strokes of the × each moveTo + lineTo).
    expect(calls.lineTo).toBe((plain.calls.lineTo ?? 0) + 1 + 2);
  });

  test("leaves out ghosts on edges the player has already marked", () => {
    const grid = createGrid(5, 5);
    const edges = new Uint8Array(grid.edgeCount);
    edges[hEdgeIndex(grid, 0, 0)] = EdgeState.Line;
    const hint: HintMarks = {
      cells: [],
      dots: [],
      ghosts: [[hEdgeIndex(grid, 0, 0), EdgeState.Line]],
    };
    const plain = recorder();
    paintBoard(plain.ctx, scene(5, 44, 0, 0, edges));
    const { ctx, calls } = recorder();
    paintBoard(ctx, scene(5, 44, 0, 0, edges, hint));
    expect(calls.lineTo).toBe(plain.calls.lineTo);
  });
```

4. In `apps/web/src/lib/components/BoardCanvas.svelte`:
   - After `import type { Layout } from "../game/geometry.ts";` add `  import type { HintMarks } from "../game/hint.ts";`.
   - In `Props`, after `port: Size;` add `    hint: HintMarks | null;`, and change the destructuring to `let { puzzle, edges, analysis, layout, view, port, hint }: Props = $props();`.
   - Replace the `return { ink: …, wash: get("--solved-wash") };` line in `palette()` with:

```ts
    return {
      ink: get("--ink"),
      pencil: get("--pencil"),
      shu: get("--shu"),
      wash: get("--solved-wash"),
      ai: get("--ai"),
      hintWash: get("--hint-wash"),
    };
```

   - Replace `const scene = { puzzle, edges, analysis, layout, view, port, ratio, palette: palette(el) };` with `const scene = { puzzle, edges, analysis, layout, view, port, ratio, palette: palette(el), hint };`.

5. In `apps/web/src/lib/components/BoardSvg.svelte`:
   - After the `../game/geometry.ts` import add `  import type { HintMarks } from "../game/hint.ts";`.
   - In `Props`, after `port: Size;` add:

```ts
    /** The hint on show: an ai wash on its cells and dots, and its move as a dashed ghost. */
    hint: HintMarks | null;
```

     and change the destructuring to `let { puzzle, edges, analysis, layout, view, port, hint }: Props = $props();`.
   - After `const inside = $derived(analysis.solved ? insideCells(grid, edges) : null);` add:

```ts
  const hintCells = $derived(new Set(hint?.cells ?? []));
  // Ghosts only on edges that are still empty, as on the Hint artboard.
  const ghosts = $derived((hint?.ghosts ?? []).filter(([e]) => edges[e] === EdgeState.Unknown));
```

   - In the markup, directly above `    {#each lines as e (e)}` insert:

```svelte
    {#if hint}
      {#each hint.cells as i (i)}
        {@const p = cellPoint(grid, geo, i)}
        <rect class="hint-wash" x={p.x - S / 2 + 2} y={p.y - S / 2 + 2} width={S - 4} height={S - 4} rx="3" />
      {/each}
      {#each hint.dots as d (d)}
        {@const p = dotPoint(grid, geo, d)}
        <circle class="hint-wash" cx={p.x} cy={p.y} r={S * 0.3} />
      {/each}
    {/if}

```

   - Directly above `    {#each crosses as e (e)}` insert:

```svelte
    {#each ghosts as [e, state] (e)}
      {#if state === EdgeState.Line}
        {@const s = edgeSegment(grid, geo, e)}
        <line class="ghost" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke-width={size.line} />
      {:else}
        {@const { x, y } = edgeMidpoint(grid, geo, e)}
        {@const a = size.crossArm}
        <path
          class="ghost-cross"
          d="M{x - a} {y - a}L{x + a} {y + a}M{x + a} {y - a}L{x - a} {y + a}"
          stroke-width={size.crossWidth * 1.6}
        />
      {/if}
    {/each}

```

   - On the clue `<text>`, after `class:bad={badCells.has(q.cell)}` add the line `        class:hinted={hintCells.has(q.cell)}`.
   - In `<style>`, directly above `  .line {` insert:

```css
  .hint-wash {
    fill: var(--hint-wash);
  }

  .ghost {
    stroke: var(--ai);
    stroke-linecap: butt;
    stroke-dasharray: 6 5;
  }

  .ghost-cross {
    stroke: var(--ai);
    stroke-linecap: round;
    fill: none;
  }

```

     and directly above `  .clue.bad {` insert:

```css
  .clue.hinted {
    fill: var(--ai);
    font-weight: 700;
  }

```

     (`.clue.bad` stays after `.clue.hinted`, so a broken clue stays shu.)

6. In `apps/web/src/lib/components/BoardView.svelte`:
   - After the `@loophole/core` import add `  import { untrack } from "svelte";`.
   - After `import { PointerGesture } from "../game/gesture.ts";` add `  import { type HintMarks, hintRect } from "../game/hint.ts";`.
   - In `Props`, after the `locked: boolean;` member (and its comment) add:

```ts
    /** The hint on show, drawn over the board; null for none. */
    hint: HintMarks | null;
```

   - Replace `let { puzzle, edges, analysis, layout, view, port, zoom, locked, onedit, onview }: Props = $props();` with:

```ts
  let { puzzle, edges, analysis, layout, view, port, zoom, locked, hint, onedit, onview }: Props =
    $props();
```

   - Directly above `  /** Moves keyboard focus to the board; the parent calls this after the board remounts. */` insert:

```ts
  // A new hint on a zoomed board pans its marks into view; the view is read without tracking it,
  // so this runs once per hint, not on every pan.
  $effect(() => {
    const marks = hint;
    if (marks === null) return;
    untrack(() => {
      const rect = hintRect(grid, layout, marks);
      if (zoom !== null && rect !== null) onview(revealRect(grid, view, rect, port, zoom));
    });
  });

```

   - Replace the two renderer lines with:

```svelte
      <BoardCanvas {puzzle} {edges} {analysis} {layout} {view} {port} {hint} />
    {:else}
      <BoardSvg {puzzle} {edges} {analysis} {layout} {view} {port} {hint} />
```

7. In `apps/web/src/lib/components/PlayScreen.svelte`, on the `<BoardView` element, after the `{locked}` line add `              hint={null}` (Step 6 replaces it).

**Verify:**

```sh
bun run format && bun test apps/web/src/lib/game/paint.test.ts && bun run check && bun run test:e2e && bun run test:perf
```

**Commit:** `feat(web): draw hint washes and ghost moves on both board renderers`

### Step 6 — Web: hint card in place of the tray, Hint button, assisted progress

1. Create `apps/web/src/lib/components/RulePattern.svelte`:

```svelte
<script lang="ts">
  import { EdgeState, NO_CLUE } from "@loophole/core";
  import { cellPoint, dotPoint, edgeMidpoint, edgeSegment, type Layout, markSizes } from "../game/geometry.ts";
  import type { RulePattern } from "../game/patterns.ts";

  interface Props {
    pattern: RulePattern;
  }

  let { pattern }: Props = $props();

  // The Hint artboard's figure: a 72px square, the pattern centred with at least 8px around it
  // (14px for a single cell).
  const BOX = 72;
  const grid = $derived(pattern.puzzle.grid);
  const longest = $derived(Math.max(grid.width, grid.height));
  const cell = $derived((BOX - 2 * (longest === 1 ? 14 : 8)) / longest);
  const geo: Layout = $derived({ cell, margin: 0, width: grid.width * cell, height: grid.height * cell });
  const offset = $derived(`translate(${(BOX - geo.width) / 2} ${(BOX - geo.height) / 2})`);
  const size = $derived(markSizes(cell));
  const edgeList = $derived(Array.from(pattern.edges.keys()));
  const hinted = $derived(new Set(pattern.marks.cells));
</script>

<svg width={BOX} height={BOX} viewBox="0 0 {BOX} {BOX}" aria-hidden="true">
  <rect class="paper" width={BOX} height={BOX} rx="6" />
  <g transform={offset}>
    {#each pattern.marks.cells as i (i)}
      {@const p = cellPoint(grid, geo, i)}
      <rect class="wash" x={p.x - cell / 2 + 2} y={p.y - cell / 2 + 2} width={cell - 4} height={cell - 4} rx="3" />
    {/each}
    {#each pattern.marks.dots as d (d)}
      {@const p = dotPoint(grid, geo, d)}
      <circle class="wash" cx={p.x} cy={p.y} r={cell * 0.3} />
    {/each}
    {#each edgeList as e (e)}
      {#if pattern.edges[e] === EdgeState.Line}
        {@const s = edgeSegment(grid, geo, e)}
        <line class="line" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke-width={size.line} />
      {/if}
    {/each}
    {#each pattern.marks.ghosts as [e, state] (e)}
      {#if state === EdgeState.Line}
        {@const s = edgeSegment(grid, geo, e)}
        <line class="ghost" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke-width={size.line} />
      {:else}
        {@const { x, y } = edgeMidpoint(grid, geo, e)}
        {@const a = size.crossArm}
        <path class="ghost-cross" d="M{x - a} {y - a}L{x + a} {y + a}M{x + a} {y - a}L{x - a} {y + a}" stroke-width={size.crossWidth * 1.6} />
      {/if}
    {/each}
    {#each edgeList as e (e)}
      {#if pattern.edges[e] === EdgeState.Cross}
        {@const { x, y } = edgeMidpoint(grid, geo, e)}
        {@const a = size.crossArm}
        <path class="cross" d="M{x - a} {y - a}L{x + a} {y + a}M{x + a} {y - a}L{x - a} {y + a}" stroke-width={size.crossWidth} />
      {/if}
    {/each}
    {#each { length: grid.dotCount } as _, d (d)}
      {@const p = dotPoint(grid, geo, d)}
      <circle class="dot" cx={p.x} cy={p.y} r={size.dotRadius} />
    {/each}
    {#each { length: grid.cellCount } as _, i (i)}
      {#if pattern.puzzle.clues[i] !== NO_CLUE}
        {@const p = cellPoint(grid, geo, i)}
        <text class="clue" class:hinted={hinted.has(i)} x={p.x} y={p.y} font-size={size.clue}>{pattern.puzzle.clues[i]}</text>
      {/if}
    {/each}
  </g>
</svg>

<style>
  svg {
    display: block;
  }

  .paper {
    fill: var(--ground);
  }

  .wash {
    fill: var(--hint-wash);
  }

  .line {
    stroke: var(--ink);
    stroke-linecap: round;
  }

  .ghost {
    stroke: var(--ai);
    stroke-dasharray: 4 3;
  }

  .ghost-cross {
    stroke: var(--ai);
    stroke-linecap: round;
    fill: none;
  }

  .cross {
    stroke: var(--pencil);
    stroke-linecap: round;
    fill: none;
  }

  .dot {
    fill: var(--ink);
  }

  .clue {
    fill: var(--ink);
    font-family: var(--font-ui);
    font-weight: 500;
    text-anchor: middle;
    dominant-baseline: central;
  }

  .clue.hinted {
    fill: var(--ai);
    font-weight: 700;
  }
</style>
```

2. Create `apps/web/src/lib/components/HintCard.svelte`:

```svelte
<script lang="ts">
  import type { Grid } from "@loophole/core";
  import { onMount } from "svelte";
  import type { HintView } from "../game/hint.ts";
  import { edgeLabel } from "../game/keyboard.ts";
  import { RULE_PATTERNS } from "../game/patterns.ts";
  import RulePattern from "./RulePattern.svelte";

  interface Props {
    grid: Grid;
    view: HintView;
    onapply: () => void;
    /** Closes the card; the hint stays drawn on the board until the move is made. */
    onlater: () => void;
  }

  let { grid, view, onapply, onlater }: Props = $props();

  let applyButton: HTMLButtonElement | undefined = $state();
  // The card takes the tray's place, so focus moves to its first action (NFR-5).
  onMount(() => applyButton?.focus());

  const pattern = $derived(view.rule === null ? undefined : RULE_PATTERNS[view.rule]);
  // The board is a picture to screen readers, so the card also says where the move is.
  const where = $derived(view.apply.map(([e, s]) => edgeLabel(grid, e, s)).join("; "));
</script>

<!-- Hint artboard: replaces the tool tray; the rule's pattern is drawn small beside the words, which
     flow under it when they run long, so the card stays short enough for a phone. -->
<section class="hint" aria-labelledby="hint-title">
  <div class="body">
    {#if pattern}
      <figure>
        <RulePattern {pattern} />
        <figcaption>the pattern</figcaption>
      </figure>
    {/if}
    <span class="eyebrow">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        ><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z" /></svg
      >
      ヒント · {view.eyebrow}
    </span>
    <h2 id="hint-title">{view.title}</h2>
    <p class="text" id="hint-text">{view.text}</p>
    <p class="visually-hidden" id="hint-move">Move: {where}.</p>
  </div>
  <div class="actions">
    <button
      type="button"
      class="apply"
      bind:this={applyButton}
      aria-describedby="hint-title hint-text hint-move"
      onclick={onapply}>{view.applyLabel}</button
    >
    <button type="button" class="later" onclick={onlater}>{view.laterLabel}</button>
  </div>
</section>

<style>
  .hint {
    background: var(--sheet);
    border: 2px solid var(--ai);
    border-radius: 10px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* A block (not flex) box, so the words wrap around the floated figure. */
  .body {
    display: flow-root;
  }

  .eyebrow {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
    color: var(--ai);
    font-size: 13px;
    font-weight: 700;
  }

  h2 {
    margin: 0 0 4px;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 20px;
    line-height: 1.2;
  }

  .text {
    margin: 0;
    font-size: 15px;
    line-height: 1.45;
  }

  figure {
    float: right;
    margin: 0 0 4px 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  figcaption {
    font-size: 12px;
    color: var(--ink-soft);
  }

  .actions {
    display: flex;
    gap: 10px;
  }

  button {
    flex: 1 1 0;
    height: 48px;
    border-radius: 999px;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
  }

  .apply {
    border: 0;
    background: var(--ai);
    color: var(--on-ink);
  }

  .later {
    border: 2px solid var(--ink);
    background: transparent;
    color: var(--ink);
  }

  /* Phones: a 56px figure without its caption, 14px words and 44px buttons, so the longest hint
     still fits under a 7×7 board on the Play artboard's 390×664. */
  @media (max-width: 899px) {
    .hint {
      padding: 8px 12px;
      gap: 6px;
    }

    .eyebrow,
    h2 {
      margin-bottom: 2px;
    }

    .text {
      font-size: 14px;
      line-height: 1.35;
    }

    figure :global(svg) {
      width: 56px;
      height: 56px;
    }

    figcaption {
      display: none;
    }

    button {
      height: 44px;
      font-size: 15px;
    }
  }

  /* The smallest phones (Small artboard, 360×560): no figure, the eyebrow only for screen
     readers (the title says what kind of hint it is), 13px words. */
  @media (max-width: 899px) and (max-height: 620px) {
    .hint {
      gap: 4px;
    }

    h2 {
      margin-bottom: 0;
      font-size: 18px;
    }

    figure {
      display: none;
    }

    .eyebrow {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }

    .text {
      font-size: 13px;
      line-height: 1.3;
    }
  }
</style>
```

3. In `apps/web/src/lib/components/ToolBar.svelte`:
   - Replace the `Props` interface and destructuring with:

```ts
  interface Props {
    canUndo: boolean;
    canRedo: boolean;
    canHint: boolean;
    canClear: boolean;
    onundo: () => void;
    onredo: () => void;
    onhint: () => void;
    onclear: () => void;
  }

  let { canUndo, canRedo, canHint, canClear, onundo, onredo, onhint, onclear }: Props = $props();
```

   - Change the markup comment's second line to `     Desktop artboard, with keyboard shortcuts shown. Hint is in ai, as on both. -->`.
   - Directly above the Clear button (`  <button type="button" disabled={!canClear} onclick={onclear}>`) insert:

```svelte
  <button type="button" class="hint" disabled={!canHint} onclick={onhint}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      ><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z" /></svg
    >Hint <kbd>H</kbd>
  </button>
```

   - In `.tools`, change `grid-template-columns: repeat(3, minmax(0, 1fr));` to `grid-template-columns: repeat(4, minmax(0, 1fr));`.
   - Directly above the first `  button:disabled {` (outside the media query) insert:

```css
  .hint {
    color: var(--ai);
  }

```

   - Inside `@media (min-width: 900px)`, directly above `    button:disabled {` insert:

```css
    .hint {
      border-color: var(--ai);
    }

```

4. In `apps/web/src/lib/game/progress.ts`:
   - In `interface Progress`, after `readonly solved: boolean;` add:

```ts
  /** A hint was shown during this attempt (PRD FR-12). */
  readonly assisted: boolean;
```

   - In `interface StoredProgressV1`, after `solved: boolean;` add:

```ts
  /** Missing in saves from before hints, which had none. */
  assisted?: boolean;
```

   - In `load`, replace `return { edges: decodeEdges(grid, data.edges), elapsedMs, solved: data.solved === true };` with:

```ts
        return {
          edges: decodeEdges(grid, data.edges),
          elapsedMs,
          solved: data.solved === true,
          assisted: data.assisted === true,
        };
```

   - In `save`, after `solved: progress.solved,` add `assisted: progress.assisted,`.

5. In `apps/web/src/lib/game/progress.test.ts`:
   - Rename the first test to `"round-trips edges, time, solved and assisted flags per puzzle"`, save with `{ edges, elapsedMs: 4200.4, solved: true, assisted: true }`, expect `store.load` to equal `{ edges, elapsedMs: 4200, solved: true, assisted: true }`, and add `assisted: true,` after `solved: true,` in the stored-JSON expectation.
   - In `"clear forgets a puzzle"` and in `"keeps working when storage throws or is missing"`, add `assisted: false` to the saved object.
   - In `"ignores broken, foreign or wrong-sized data"`, add the comment `// A save from before hints has no assisted flag.` above the last `storage.data.set(…)` and `assisted: false,` after `solved: false,` in its expectation.

6. In `apps/web/src/lib/components/PlayScreen.svelte`, make these edits in order:

   a. After the `../game/geometry.ts` import block add:

```ts
  import { type HintView, hintCurrent, hintView } from "../game/hint.ts";
```

   b. Replace

```ts
  import { type PuzzleEntry, puzzleTitle } from "../puzzles/index.ts";
  import BoardView from "./BoardView.svelte";
```

   with

```ts
  import { type PuzzleEntry, puzzleSource, puzzleTitle } from "../puzzles/index.ts";
  import BoardView from "./BoardView.svelte";
  import HintCard from "./HintCard.svelte";
```

   c. After `  let boardView: { focus(): void } | undefined = $state();` add:

```ts

  // Hints (FR-12). `hint` stays drawn on the board until its move is made or overtaken; `hintOpen`
  // is whether its card is showing in place of the tool tray. Seeing a hint marks the attempt as
  // assisted, which is saved with the progress.
  let hint: HintView | null = $state.raw(null);
  let hintOpen = $state(false);
  let hintBusy = $state(false);
  let hintFailed = $state(false);
  let assisted = $state(false);
```

   d. In `save()`, after `      solved,` add `      assisted,`.

   e. In `update()`, after `    board = next;` add `    hintFailed = false;`.

   f. Directly above `  function setPaused(value: boolean) {` insert:

```ts
  async function askHint() {
    if (locked || hintBusy) return;
    if (hint !== null) {
      hintOpen = true;
      return;
    }
    hintBusy = true;
    hintFailed = false;
    const edges = board.edges;
    try {
      const result = await puzzleSource.hint(entry.id, puzzle, edges);
      // The board changed while the hint was on its way; the player can ask again.
      if (board.edges !== edges) return;
      const view = hintView(grid, result, edges);
      if (view === null) return;
      hint = view;
      hintOpen = true;
      assisted = true;
      save();
    } catch (err) {
      console.warn("Hint unavailable:", err);
      hintFailed = true;
    } finally {
      hintBusy = false;
    }
  }

  function applyHint() {
    if (hint === null) return;
    const changes = [...hint.apply];
    hint = null;
    hintOpen = false;
    edit(changes, false);
    focusBoard();
  }

  function closeHint() {
    hintOpen = false;
    focusBoard();
  }

  // A hint ends once its move is made, or one of its edges is marked differently.
  $effect(() => {
    if (hint !== null && (solved || !hintCurrent(hint, board.edges))) {
      hint = null;
      hintOpen = false;
    }
  });

```

   g. In `run()`, after `    else if (cmd.type === "redo") update(redo(board));` add:

```ts
    else if (cmd.type === "hint") askHint();
    else if (cmd.type === "close" && hintOpen) closeHint();
```

   h. In `startOver()`, after `    paused = false;` add:

```ts
    hint = null;
    hintOpen = false;
    assisted = false;
```

   i. In `onMount`, after `      watch = createStopwatch(saved.elapsedMs);` add `      assisted = saved.assisted;`.

   j. Replace the status line's zoom tip `    {#if zoomable}<span>Pinch or use +/− to zoom</span>{/if}` with:

```svelte
    <!-- One line only: the tag takes the zoom tip's place once a hint is used. -->
    {#if assisted}<span class="assisted">Hint used</span>
    {:else if zoomable}<span>Pinch or use +/− to zoom</span>{/if}
```

   k. On `<BoardView`, replace `              hint={null}` (from Step 5) with `              hint={hint?.marks ?? null}`.

   l. In the time card, after the `<span class="soft">…clues satisfied</span>` line inside `.timecard-text` add `          {#if assisted}<span class="assisted">Hint used</span>{/if}`.

   m. In the solved card, after `<span class="solved-title">Solved in {clock}</span>` add `              {#if assisted}<span class="assisted">Hint used</span>{/if}`.

   n. In `.notes`, insert between the solved card's closing `</div>` and `{:else if messages.length > 0}` (so the hint card and the failure note both come before the rule-error card):

```svelte
        {:else if hint !== null && hintOpen && !paused}
          <HintCard {grid} view={hint} onapply={applyHint} onlater={closeHint} />
        {:else if hintFailed}
          <p class="card hint-failed" role="status">Couldn't get a hint just now. Try again in a moment.</p>
```

   o. Replace the tool bar block

```svelte
      {#if !solved}
        <ToolBar
          canUndo={!locked && board.past.length > 0}
          canRedo={!locked && board.future.length > 0}
          canClear={!locked && hasMarks(board)}
          onundo={() => run({ type: "undo" })}
          onredo={() => run({ type: "redo" })}
          onclear={clear}
        />
      {/if}
```

   with

```svelte
      {#if !solved && !(hint !== null && hintOpen && !paused)}
        <ToolBar
          canUndo={!locked && board.past.length > 0}
          canRedo={!locked && board.future.length > 0}
          canHint={!locked && !hintBusy}
          canClear={!locked && hasMarks(board)}
          onundo={() => run({ type: "undo" })}
          onredo={() => run({ type: "redo" })}
          onhint={() => run({ type: "hint" })}
          onclear={clear}
        />
      {/if}
```

   p. In the keyboard help list, after `<dt>Z / Y</dt><dd>undo / redo</dd>` add `          <dt>H</dt><dd>hint</dd>`.

   q. In `<style>`, directly above `  .solved-card {` insert:

```css
  /* "Hint used" (Play artboard): an ai tag; the words carry it, not the colour. */
  .assisted {
    align-self: flex-start;
    padding: 3px 10px;
    border-radius: 6px;
    background: var(--ai-wash);
    color: var(--ai);
    font-size: 13px;
    font-weight: 700;
    white-space: nowrap;
  }

  /* In the status line the tag overhangs the line box, so showing it never moves the board. */
  .status .assisted {
    margin-block: -3px;
  }

  .hint-failed {
    margin: 0;
    padding: 10px 14px;
    font-size: 15px;
    line-height: 1.45;
  }

```

**Verify:**

```sh
bun run format && bun run --cwd apps/web typecheck && bun run check && bun run test:e2e
```

Then look at it: `bun run dev:web`, open http://localhost:5173/play/small-7 in a 390×664 window, press Hint, and compare with `docs/design/Hint.dc.html` (card under the board, eyebrow "ヒント · next forced move", title, text, 72 px pattern, two pill buttons; ai wash and ghost ×s on the board).

**Commit:** `feat(web): hint card in place of the tool tray, marking the solve as assisted`

### Step 7 — End-to-end tests

Create `apps/web/tests/hint.e2e.ts`:

```ts
import {
  decodeEdges,
  EdgeState,
  encodeEdges,
  findHint,
  parsePuzzle,
  RULE_TITLE,
  type RuleId,
  type Step,
  solve,
} from "@loophole/core";
import { expect, type Page, test } from "@playwright/test";
import { FIXTURES } from "../src/lib/puzzles/fixtures.ts";
import { FIXTURE_SOLUTIONS } from "../src/lib/test-support/solutions.ts";
import { board, boardView, crosses, edgePoint, lines, twoFingers } from "./board.ts";

const wire = FIXTURES.find((f) => f.id === "small-7")?.wire;
if (wire === undefined) throw new Error("small-7 fixture missing");
const puzzle = parsePuzzle(wire);
const grid = puzzle.grid;
const solution = decodeEdges(grid, FIXTURE_SOLUTIONS["small-7"]);
const empty = new Uint8Array(grid.edgeCount);

/** The step a hint on `edges` shows, worked out here the same way the app does. */
function expectedStep(edges: Uint8Array): Step {
  const hint = findHint(puzzle, solution, edges);
  if (hint.kind !== "step") throw new Error(`expected a step, got ${hint.kind}`);
  return hint.step;
}

/**
 * A board on which the next hint is `rule`: small-7's solver steps replayed from an empty board up
 * to the first point where that rule comes next.
 */
function boardBefore(rule: RuleId): Uint8Array {
  const edges = new Uint8Array(grid.edgeCount);
  for (const step of solve(puzzle).steps) {
    const hint = findHint(puzzle, solution, edges);
    if (hint.kind === "step" && hint.step.rule === rule) return edges;
    for (const c of step.changes) edges[c.edge] = c.state;
  }
  throw new Error(`small-7 never needs ${rule}`);
}

/** Crosses on the first three lines of the solution: a "× doesn't fit" hint with a count. */
function threeWrongCrosses(): Uint8Array {
  const edges = new Uint8Array(grid.edgeCount);
  let n = 0;
  for (let e = 0; e < edges.length && n < 3; e++) {
    if (solution[e] !== EdgeState.Line) continue;
    edges[e] = EdgeState.Cross;
    n++;
  }
  return edges;
}

// Every rule small-7 uses, so the longest texts (parity, the 3s) are among them.
const RULES: RuleId[] = [
  "clue-zero",
  "clue-satisfied",
  "clue-needs-all",
  "dot-full",
  "dot-continue",
  "dot-dead-end",
  "corner-1",
  "corner-3",
  "premature-loop",
  "parity",
  "lookahead",
];

/** True when the page is no taller than the window. */
function fitsTheWindow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight);
}

/** The whole solution but one line, with every cross: one move from solved. */
function oneLineShort(): { edges: Uint8Array; missing: number } {
  const edges = solution.slice();
  const missing = edges.indexOf(EdgeState.Line);
  edges[missing] = EdgeState.Unknown;
  return { edges, missing };
}

/** Opens small-7 with `edges` saved as the guest's progress. */
async function openWith(page: Page, edges: Uint8Array) {
  await page.goto("/");
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [
      "loophole:progress:small-7",
      JSON.stringify({ v: 1, edges: encodeEdges(edges), elapsedMs: 0, solved: false }),
    ],
  );
  await page.goto("/play/small-7");
  await expect(board(page)).toBeVisible();
}

const ghosts = (page: Page) =>
  page.locator("[role=application] .ghost, [role=application] .ghost-cross");

// The smallest phone (Small artboard), where the card has to fit under a 7×7, and the Play size.
for (const [width, height] of [
  [360, 560],
  [390, 664],
] as const) {
  test.describe(`phone ${width}×${height}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true, isMobile: true });

    test("a hint names the next rule, ghosts its move and applies it (FR-12)", async ({ page }) => {
      await openWith(page, empty);
      const before = await board(page).boundingBox();
      await page.getByRole("button", { name: "Hint" }).click();
      const step = expectedStep(empty);
      await expect(page.getByRole("heading", { name: RULE_TITLE[step.rule] })).toBeVisible();
      await expect(ghosts(page)).toHaveCount(step.changes.length);
      // The card takes the tray's place without moving the board.
      await expect(page.getByRole("navigation", { name: "Puzzle tools" })).toHaveCount(0);
      expect(await board(page).boundingBox()).toEqual(before);
      await page.getByRole("button", { name: "Apply move" }).click();
      const crossed = step.changes.filter((c) => c.state === EdgeState.Cross).length;
      await expect(crosses(page)).toHaveCount(crossed);
      await expect(ghosts(page)).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: "Puzzle tools" })).toBeVisible();
    });

    test("finishing with a hint marks the solve as assisted (FR-12)", async ({ page }) => {
      await openWith(page, oneLineShort().edges);
      await page.getByRole("button", { name: "Hint" }).click();
      await page.getByRole("button", { name: "Apply move" }).click();
      await expect(page.getByRole("img", { name: "Solved" })).toBeVisible();
      await expect(page.locator(".solved-card")).toContainText("Hint used");
      await page.reload();
      await expect(page.locator(".solved-card")).toContainText("Hint used");
    });

    test("every hint card fits under the board without moving it (NFR-2)", async ({ page }) => {
      const cases: [string, Uint8Array][] = [
        ...RULES.map((rule): [string, Uint8Array] => [RULE_TITLE[rule], boardBefore(rule)]),
        ["This × doesn't fit", threeWrongCrosses()],
      ];
      for (const [title, edges] of cases) {
        await openWith(page, edges);
        const before = await board(page).boundingBox();
        await page.getByRole("button", { name: "Hint" }).click();
        await expect(page.getByRole("heading", { name: title })).toBeVisible();
        expect([title, await fitsTheWindow(page)]).toEqual([title, true]);
        expect([title, await board(page).boundingBox()]).toEqual([title, before]);
      }
    });

    test("a wrong mark is pointed out first and can be erased", async ({ page }) => {
      await openWith(page, empty);
      const wrong = solution.indexOf(EdgeState.Cross);
      const p = await edgePoint(page, grid, wrong);
      await page.touchscreen.tap(p.x, p.y);
      await expect(lines(page)).toHaveCount(1);
      await page.getByRole("button", { name: "Hint" }).click();
      await expect(page.getByRole("heading", { name: "This line doesn't fit" })).toBeVisible();
      await page.getByRole("button", { name: "Erase it" }).click();
      await expect(lines(page)).toHaveCount(0);
    });
  });
}

test.describe("phone 390×664, zoomed board", () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });

  test("a hint pans a zoomed board to show its move", async ({ page }) => {
    await page.goto("/play/medium-10");
    await expect(board(page)).toBeVisible();
    // Two fingers up and to the left move the view to the board's bottom-right corner.
    const box = (await boardView(page)).box;
    const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await twoFingers(
      page,
      [
        { x: c.x + 60, y: c.y + 80 },
        { x: c.x + 120, y: c.y + 80 },
      ],
      [
        { x: c.x - 160, y: c.y - 140 },
        { x: c.x - 100, y: c.y - 140 },
      ],
    );
    await expect.poll(async () => (await boardView(page)).y).toBeGreaterThan(100);
    // medium-10's first hint is the 0 in the top row, out of view now.
    await page.getByRole("button", { name: "Hint" }).click();
    await expect(page.locator("[role=application] .ghost-cross")).toHaveCount(4);
    const frame = await board(page).boundingBox();
    if (frame === null) throw new Error("board not visible");
    for (const g of await page.locator("[role=application] .ghost-cross").all()) {
      const b = await g.boundingBox();
      if (b === null) throw new Error("ghost not drawn");
      expect(b.x).toBeGreaterThanOrEqual(frame.x);
      expect(b.y).toBeGreaterThanOrEqual(frame.y);
      expect(b.x + b.width).toBeLessThanOrEqual(frame.x + frame.width);
      expect(b.y + b.height).toBeLessThanOrEqual(frame.y + frame.height);
    }
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("H opens the hint, Escape leaves it on the board, Enter applies it (NFR-5)", async ({
    page,
  }) => {
    await openWith(page, empty);
    const step = expectedStep(empty);
    await board(page).focus();
    await page.keyboard.press("h");
    await expect(page.getByRole("button", { name: "Apply move" })).toBeFocused();
    await expect(page.getByText("the pattern")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Apply move" })).toHaveCount(0);
    await expect(board(page)).toBeFocused();
    // The move stays drawn as a ghost until it is made.
    await expect(ghosts(page)).toHaveCount(step.changes.length);
    await expect(page.locator(".timecard").getByText("Hint used")).toBeVisible();
    await page.keyboard.press("h");
    await page.keyboard.press("Enter");
    await expect(ghosts(page)).toHaveCount(0);
    await expect(board(page)).toBeFocused();
  });

  test("hints work on a canvas board", async ({ page }) => {
    await page.goto("/play/huge-40");
    await expect(board(page)).toBeVisible();
    await page.getByRole("button", { name: "Hint" }).click();
    await expect(page.getByText("ヒント · next forced move")).toBeVisible();
    await page.getByRole("button", { name: "Apply move" }).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = localStorage.getItem("loophole:progress:huge-40");
          return raw === null ? 0 : (JSON.parse(raw).edges as string).replace(/0/g, "").length;
        }),
      )
      .toBeGreaterThan(0);
  });
});
```

**Verify:**

```sh
bun run format && bun run check && bun run test:e2e && bun run test:perf
```

Expected: the 11 new tests pass with the existing ones (51 in all in the prototype), and both frame-time checks stay under their limits. The fit test replays small-7's solver steps until each rule is next (deterministic), so it covers the longest card texts; the pan test fails if BoardView's pan-to-hint effect is removed (checked on the prototype).

**Commit:** `test(web): end-to-end hint flow on phones and desktop`

### Step 8 — Docs: README, web AGENTS, DECISIONS

1. `README.md`, Status paragraph:
   - After the sentence ending `…, and progress saved in the browser.` insert: ` A Hint button (or H) shows the next forced deduction from the player's board, with the rule's name, a one-line explanation and its pattern drawn small, or points out a mark that doesn't fit; using one marks the attempt as assisted.`
   - Replace `The server has its foundation: an HTTP API that serves puzzles and queues generation jobs,` with `The server has its foundation: an HTTP API that serves puzzles, gives hints from each puzzle's stored solution and queues generation jobs,`.
   - Replace `Accounts, hints, daily puzzles and the rest come in later phases;` with `Accounts, daily puzzles and the rest come in later phases;`.
2. `README.md`, Server section: after the `curl -s localhost:3000/api/puzzles/<puzzle id>  # clues only` line, inside the same code block, add:

```
curl -s -X POST localhost:3000/api/puzzles/<puzzle id>/hint -H 'content-type: application/json' -d '{"edges":"<edge string>"}'
```

   and after the code block add the sentence: `The hint takes the player's board in the edge-state encoding (docs/FORMAT.md) and answers with a wrong mark, the next deduction, a line from the solution when no rule applies, or "solved".` (put it before the existing `The API is described in …` sentence).
3. `apps/web/AGENTS.md`: after the bullet beginning `- Screens get puzzles through the puzzle source interface.` add:

```
- Hints come through the puzzle source too: built-in puzzles work them out in the browser from their clues (core's `findHint`), server puzzles ask the API. Seeing a hint marks the attempt as assisted in the saved progress.
```

4. `docs/DECISIONS.md`: append these entries at the end (dates as written):

```
## 2026-10-25 · WT8 `hints` · Where hints are worked out
- **Question:** Should the hint come from the client (core's solver from the player's board) or from a server endpoint?
- **Decision:** Both call one pure core function, `findHint(puzzle, solution, board)`. Built-in puzzles work it out in the browser: the fixture source finds the solution once per puzzle with `verify` (from the clues, so nothing is revealed that the client could not compute; `medium-10` needs search, so `solve` alone would not do) and keeps it in memory. Server puzzles use `POST /api/puzzles/{id}/hint` with the board in the edge-state encoding; a `HintManager` reads the stored solution through the puzzle manager, which stays on the server. No migration: nothing is stored per player yet.
- **Reason:** The server already has every served puzzle's solution, so phones never verify a large generated board (about 280 ms for a 100×100 in Bun, more on a phone). The endpoint is where ranked play (WT11) records an assist against the signed-in ranked attempt (FR-12, FR-23). It cannot catch help from elsewhere (another session, or a solver run on the clues, which alone determine the solution), so leaderboard integrity still rests on FR-25's server validation and timing checks. The search is capped at 500 ms per request, after which the hint is a revealed line, so a puzzle that needs search cannot hold the API thread. Built-in puzzles keep working with no server, as the end-to-end tests need.

## 2026-10-25 · WT8 `hints` · Wrong marks come first; a line from the solution when no rule applies
- **Question:** Hints start from the player's board (WT2), but deductions are only sound on a board that agrees with the solution. What does a hint show when the board has a wrong mark, and when no rule applies?
- **Decision:** If any mark disagrees with the solution, the hint names the lowest such edge ("This line doesn't fit" or "This × doesn't fit"), washes its two dots, says how many other marks don't fit, and offers to erase it (not to draw the right state). Otherwise it is the solver's next step from the board (`solve` with `initial` and `maxSteps: 1`). If no rule applies, it shows one line of the solution, preferring one that extends a line already on the board ("No rule applies here").
- **Reason:** A deduction drawn next to a wrong mark would contradict what the player sees. Pointing out one wrong mark only when asked keeps FR-15's rule that merely-wrong guesses are never flagged on their own. A board that needs search (some submitted puzzles, `medium-10` part way) would otherwise get no help at all.

## 2026-10-25 · WT8 `hints` · The hint card and the assisted flag
- **Question:** How does the hint card behave, and what counts as an assisted solve?
- **Decision:** The card replaces the tool tray (Hint artboard). Apply makes the hint's move as one undo step; "I'll draw it" or Escape closes the card and leaves the washes and ghosts on the board until the move is made or one of its edges is marked to something else. H asks for a hint; focus goes to the card's first button and back to the board when it closes. A zoomed board pans the hint into view. Seeing a hint marks the attempt assisted: guest progress stores `assisted` (an optional field of the v1 object; older saves load as not assisted), Start over clears it, and a "Hint used" tag shows in the status line, the desktop time card and the solved card. The tag takes the zoom tip's place in the status line. Rule titles live in core next to the rule text (`RULE_TITLE`); the small rule pictures live in the web app.
- **Reason:** It follows the design kit (hints replace the tray, ai wash, dashed ghost), keeps every action reachable from the keyboard (NFR-5), and the words on the card and tag carry the meaning, not the colour. Counting a hint that was only looked at is the simplest rule that cannot be gamed by dismissing the card. Practice puzzles are never ranked, so the tag says "Hint used"; ranked play (WT11) adds "unranked". On phones the card is compacted (floated figure, smaller type, no figure on the smallest phones) so the longest hint fits under a 7×7 without scrolling or moving the board; an end-to-end test checks every rule small-7 uses at 360×560 and 390×664. Each rule's figure shows the reason for the move, not only the move; lookahead has no figure.
```

**Verify:** `bun run check` (Biome skips Markdown; this checks nothing else broke).

**Commit:** `docs: hints in README, AGENTS and DECISIONS`

### Step 9 — Final check (no commit)

```sh
bun run check && bun run test:e2e && bun run test:perf && git status --short
```

All green and a clean tree. Take screenshots at 390×664, 360×560 and 1280×800 of `/play/small-7` with the hint card open (dev server or `bun run --cwd apps/web preview` after a build) and compare with `docs/design/Hint.dc.html`. Also screenshot the worst cases at both phone sizes: the boards the fit test builds for `parity` and `corner-3` (replay `solve(puzzle).steps` until `findHint` gives that rule, save it as progress in `localStorage`, reload) and the three-wrong-crosses board. Each card must end above the bottom padding with the board where it was.

## Acceptance criteria

| # | Criterion | PRD | Checked by |
|---|---|---|---|
| 1 | A hint names the next forced deduction from the player's board, with its rule title and RULE_TEXT, highlights its cells/dots and shows the forced edges | FR-6, FR-12 | core `hint.test.ts` (rule fixture, from-the-board, property), web `hint.test.ts`, e2e "names the next rule" |
| 2 | A board with a wrong mark gets "doesn't fit" for one mark, with a count, and Erase; no passive flagging changes | FR-12, FR-15 | core mistake test + property, e2e "wrong mark", existing FR-15 e2e |
| 3 | An already-solved board yields no hint; no rule → a solution line extending the player's line | FR-12 | core tests |
| 4 | Card replaces the tray, shows the rule pattern (a correct reason per rule; none for lookahead), Apply / I'll draw it; board does not move | FR-12, NFR-2 | e2e "every hint card fits…" (bounding box unchanged at 360×560 and 390×664), `patterns.test.ts`, screenshots |
| 5 | ai wash, dashed ghost line / ghost ×, bold ai clues on SVG and canvas | FR-12 | `paint.test.ts`, e2e ghost counts (SVG), e2e canvas board |
| 6 | Keyboard: H opens, focus on Apply (described by title, text and move), Escape closes, Enter applies, focus back to board; not colour alone | NFR-5 | e2e desktop, `keyboard.test.ts` |
| 7 | Using a hint marks the solve assisted; persisted in guest progress; shown on the solved card | FR-12 | `progress.test.ts`, e2e "marks the solve as assisted" (with reload) |
| 8 | Server hint endpoint never sends the solution; layering kept (route → HintManager → PuzzleManager/core); OpenAPI and client regenerated | FR-25 | `app.test.ts`, `hint-manager.test.ts`, Biome layering lint, `check:api` |
| 9 | No page scroll and no board movement with any hint card open (every rule small-7 uses, plus the "× doesn't fit" card with a count) at 360×560 and 390×664 | NFR-2 | e2e "every hint card fits under the board without moving it", Step 9 screenshots |
| 9a | A hint on a zoomed board pans its move into view | FR-12, FR-13 | e2e "a hint pans a zoomed board to show its move" (medium-10, 390×664) |
| 9b | A hint request stops searching after 500 ms and reveals a line instead | NFR-4 | core "reveals a line instead when the time limit…" test |
| 10 | Trackpad pinch speed restored; wheel notch still ~1.28× | FR-13 | existing zoom e2e |
| 11 | `bun run check`, `test:e2e`, `test:perf` green | NFR-3 | Step 9 |

## Merge notes (WT7 `accounts` runs in parallel)

- **Generated files**: `openapi.yaml` and `packages/api-client/src/schema.ts` are generated. On conflict, take either side, then run `bun run gen:api` on the merged tree and commit the result; never hand-merge them.
- **Likely text conflicts** (both sides add lines): `apps/server/src/api/app.ts` (imports, `AppDeps`, the destructuring in `createApp`, `onError`), `apps/server/src/api/main.ts` and `spec.ts` (manager wiring), `apps/server/src/api/app.test.ts` and `worker/flow.test.ts` (the `createApp` calls need both WT7's deps and `hints`), `apps/server/src/api/schemas.ts` (appended schemas), `README.md` (Status, Server), `docs/DECISIONS.md` (both append at the end; keep both sets of entries), possibly `apps/web/src/app.css` (tokens). Keep both sides' additions.
- **WT7 moves `problemResponse`** from `app.ts` to `api/problem.ts`: after the merge, `hintRoute` uses the one imported from `./problem.ts`.
- **CSRF**: WT7 adds `sameOriginOnly` on `/api/*` and asks every POST route to list a 403. Add `403: problemResponse("Sent from another site (CSRF protection).")` to `hintRoute`'s responses. The web client's same-origin POST passes the check, and the route tests send no `Origin` header, so they pass too.
- **Composition roots**: WT7 rewrites `main.ts` and `spec.ts`; re-add `new HintManager({ puzzles })` and pass `hints` to `createApp` in both.
- **Route tests**: the `createApp` calls in `app.test.ts` and `worker/flow.test.ts` need both `hints: new HintManager({ puzzles })` and WT7's `...accountDeps(db, clock)`.
- After resolving: `bun run gen:api`, then `bun run check` and `bun run test:e2e`.
- **No migration** in this WT, so no numbering clash with WT7's `002`.
- WT8 does not touch the header, nav or app layout.

## Prototype

Built and checked in a scratch worktree before writing this plan, and again after review round 1: `bun run check` green (425 tests), `bun run test:e2e` 51 passed, `bun run test:perf` p95 16.8 ms on both checks. Screenshots at 390×664 (Paper and Night), 360×560, 1280×800 and a zoomed 10×10 matched the Hint artboard's layout, and so did the worst cases (parity, corner-3, three wrong crosses) at both phone sizes. Before the phone compaction, the longest cards overflowed by up to 30 px at 390×664 and 25 px at 360×560 and moved the board; after it, about 8 px is left over in the worst case. The status line needed the tag to take the zoom tip's place (it wrapped on a zoomed 10×10).

## Unresolved questions

- Tag text "Hint used" rather than the kit's "Hint used · unranked" on practice puzzles. Default: "Hint used" now; WT11 shows "· unranked" on ranked puzzles.
- On phones at most 620 px tall the status line is hidden (WT4), so the tag shows only on the solved card there. Default: accept.
- One wrong mark per hint (with a count) instead of all at once. Default: one at a time.
- Showing a solution line when no rule applies, rather than "no hint". Default: show the line.
- Start over clears the assisted flag for guest practice. Default: yes; ranked attempts (WT11) keep theirs on the server.

## Review responses

Round 1 (`plan-review-1.md`), all accepted:

1. Cards overflowing on phones (major): fixed with the floated figure and compact phone styles described under "Card behaviour", re-measured on every rule small-7 uses plus the "× doesn't fit" card with a count. The mistake text for a cross is also shorter. A new end-to-end test checks no page scroll and an unchanged board at 360×560 and 390×664; acceptance #9 points at it, and Step 9 screenshots the worst cases.
2. Misleading figures: parity, corner-1 and corner-3 now use the reviewer's boards. Lookahead and loop-complete have no figure: `RULE_PATTERNS` is `Partial`, HintCard draws a figure only when one exists, and `patterns.test.ts` checks exactly the drawn rules.
3. Merge notes: added `problemResponse` moving to `problem.ts`, the CSRF 403, the rewritten composition roots, `accountDeps` in route tests, and the commands to run after the merge.
4. Unbounded solve: `findHint` takes `{ timeLimitMs, now }`, and `HintManager` uses 500 ms, with a core test. There is also a WT10 note.
5. Overstated trust: the DECISIONS reason is reworded (assists are recorded for the signed-in ranked attempt; integrity rests on FR-25 validation and timing), and there is a WT11 item about requiring the ranked session.
6. Failure note order and wording: the note now comes before rule-error messages and reads "Couldn't get a hint just now. Try again in a moment."
7. Screen readers: the text and move lines have ids, and Apply has `aria-describedby="hint-title hint-text hint-move"`.
8. Pan untested: there is a new end-to-end test on medium-10 at 390×664 (pan to the bottom-right with two fingers, then Hint, then every ghost × inside the board frame). It fails when the pan effect is disabled.
