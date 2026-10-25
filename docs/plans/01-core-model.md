# WT1 `core-model` — implementation plan

Branch `feat/core-model`, worktree `/home/jhonnold/projects/loophole-wt/core-model`. PRD: FR-1 (grid model), FR-2 (wire format), FR-15 (violations, completion), FR-5 (brute-force oracle for later verifier tests), FR-10 (seeded randomness), NFR-3 (unit and property tests).

## Goal

Replace the placeholder in `packages/core` with the foundation later worktrees build on:

- **Grid model**: W×H cells (1–100 each), dot/edge/cell numbering, adjacency tables in typed arrays for hot loops, edge states unknown/line/cross.
- **Puzzle + wire format v1**: a `Puzzle` type, strict `parsePuzzle` with useful errors, canonical `serializePuzzle`, an edge-state string encoding for progress and solutions, and `docs/FORMAT.md` as the spec.
- **Board analysis (FR-15)**: definite violations (dots, overfull clues, starved clues, premature closed loops) and completion.
- **Brute-force solution finder**: slow, obviously correct, independent of any solver, for grids up to 20 cells.
- **Seeded PRNG**: sfc32 + cyrb128, frozen by golden tests.
- Two review follow-ups: core sources typecheck without Bun types, and CI gets a read-only token.

Out of scope: the rule solver, verifier, generator (WT2, WT3), any UI (WT4).

## How later worktrees use this

- **WT2 solver/verifier**: iterates `grid.cellEdges`, `grid.dotEdges`, `grid.edgeDots`, `grid.edgeCells` (flat `Int32Array`s, 4 or 2 entries per item, `NONE = -1` off the board) over a `Uint8Array` of `EdgeState`s. Compares its verifier with `bruteForceSolutions` / `countSolutions` using the fast-check arbitraries and `FIXTURES` in the core package's test-support folder (FR-5).
- **WT3 generator**: `createRng(seed)` for all randomness; `deriveClues(grid, loopEdges)` to turn a loop into clues (map 4 to `NO_CLUE`); `createPuzzle(w, h, clues, { seed, meta })`; `encodeEdges` to store the solution.
- **WT4 web board**: `parsePuzzle` for fixtures and API payloads, `edgeCoords` to place edges, `analyzeBoard` after each move for error rings (`violations`), the "n of m clues" counter (`satisfiedClues`, `clueCount`) and solved detection (`solved`); `encodeEdges`/`decodeEdges` for guest progress in localStorage.

## Design

### Numbering (W = width, H = height)

| Thing | Range | Index |
|---|---|---|
| cell (r, c) | 0 ≤ r < H, 0 ≤ c < W | `r*W + c` |
| dot (r, c) | 0 ≤ r ≤ H, 0 ≤ c ≤ W | `r*(W+1) + c` |
| horizontal edge (r, c), dot (r,c)–(r,c+1) | 0 ≤ r ≤ H, 0 ≤ c < W | `r*W + c` |
| vertical edge (r, c), dot (r,c)–(r+1,c) | 0 ≤ r < H, 0 ≤ c ≤ W | `hEdgeCount + r*(W+1) + c`, `hEdgeCount = (H+1)*W` |

`edgeCount = (H+1)*W + H*(W+1)`. This matches the design kit prototype (`docs/design/Play.dc.html`: `h` edges `r*W+c`, `v` edges `r*(W+1)+c`), with the vertical block offset by `hEdgeCount`.

Adjacency tables on `Grid` (all `Int32Array`):

| Table | Entries per item | Order |
|---|---|---|
| `cellEdges` | 4 per cell | top, right, bottom, left |
| `dotEdges` | 4 per dot | up, right, down, left (`NONE` off the board) |
| `edgeDots` | 2 per edge | top/left dot, bottom/right dot |
| `edgeCells` | 2 per edge | cell above/left, cell below/right (`NONE` outside) |

2×2 example (used in tests):

```
d0 -0- d1 -1- d2
6      7      8
d3 -2- d4 -3- d5
9      10     11
d6 -4- d7 -5- d8
```
Cell edges: c0 = 0,7,2,6; c1 = 1,8,3,7; c2 = 2,10,4,9; c3 = 3,11,5,10. Outer loop = 0,1,8,11,5,4,9,6.

### Public API (exported from `packages/core/src/index.ts`)

```ts
// grid.ts
export const MIN_SIZE = 1, MAX_SIZE = 100, NONE = -1;
export const EdgeState = { Unknown: 0, Line: 1, Cross: 2 } as const;
export type EdgeState = 0 | 1 | 2;
export interface Grid { width; height; cellCount; dotCount; hEdgeCount; edgeCount; cellEdges; dotEdges; edgeDots; edgeCells }
export interface EdgeCoords { horizontal: boolean; row: number; col: number }
export function createGrid(width: number, height: number): Grid;            // RangeError on bad size
export function cellIndex(grid: Grid, row: number, col: number): number;
export function dotIndex(grid: Grid, row: number, col: number): number;
export function hEdgeIndex(grid: Grid, row: number, col: number): number;
export function vEdgeIndex(grid: Grid, row: number, col: number): number;
export function edgeCoords(grid: Grid, edge: number): EdgeCoords;

// puzzle.ts
export const NO_CLUE = -1;
export interface Puzzle { grid: Grid; clues: Int8Array; seed?: string; meta?: Readonly<Record<string, string>> }
export interface PuzzleOptions { seed?: string; meta?: Readonly<Record<string, string>> }
export function createPuzzle(width: number, height: number, clues?: ArrayLike<number>, options?: PuzzleOptions): Puzzle;
export function deriveClues(grid: Grid, edges: Uint8Array): Int8Array;     // 0–4 per cell

// format.ts
export interface PuzzleWireV1 { v: 1; width: number; height: number; clues: string; seed?: string; meta?: Record<string, string> }
export const MAX_SEED_LENGTH = 128, MAX_META_ENTRIES = 32, MAX_META_KEY_LENGTH = 64, MAX_META_VALUE_LENGTH = 1024;
export class FormatError extends Error { readonly path: string }
export function parsePuzzle(input: unknown): Puzzle;                       // FormatError
export function serializePuzzle(puzzle: Puzzle): PuzzleWireV1;
export function parsePuzzleJson(text: string): Puzzle;                     // FormatError
export function serializePuzzleJson(puzzle: Puzzle): string;               // canonical text
export function encodeEdges(edges: Uint8Array): string;                    // "0"/"1"/"2" per edge
export function decodeEdges(grid: Grid, text: string): Uint8Array;         // FormatError

// analyze.ts
export interface Violations { dots: number[]; overfullCells: number[]; starvedCells: number[]; loopEdges: number[] }
export interface BoardAnalysis { violations: Violations; solved: boolean; satisfiedClues: number; clueCount: number }
export function analyzeBoard(puzzle: Puzzle, edges: Uint8Array): BoardAnalysis;
export function hasViolations(violations: Violations): boolean;

// bruteforce.ts
export const BRUTE_FORCE_MAX_CELLS = 20;
export function bruteForceSolutions(puzzle: Puzzle, limit?: number): Uint8Array[];  // default limit 2
export function countSolutions(puzzle: Puzzle, limit?: number): number;             // default limit 2

// rng.ts
export interface Rng { next(): number; float(): number; int(n: number): number }
export function hashSeed(seed: string): [number, number, number, number];
export function createRng(seed: string): Rng;
```

### Algorithms

- **Violations / completion** (`analyzeBoard`, one O(edges) pass): per clue cell count lines and unknowns → overfull if `lines > clue`, starved if `lines + unknown < clue`, satisfied if `lines === clue`. Per dot count line degree → violation if ≥ 3. Split line edges into connected components with an explicit stack (edges connect through shared dots); a component is a closed loop when every dot on it has degree exactly 2. `solved = components === 1 && closedLoops === 1 && satisfied === clueCount`. When not solved, `loopEdges` = all edges of all closed loops, sorted.
- **Brute force**: for every non-empty inside set (bitmask over cells, `1 … 2^n − 1`, ascending), the line set is the boundary (edge is a line iff its two cells differ, outside the board counts as outside). Keep it if clues match and the lines form one loop (non-empty, every dot degree 0 or 2, all lines reachable from the first). Every single loop is the boundary of exactly one inside set, so each solution is found exactly once. Solutions come out in ascending mask order.
- **PRNG**: cyrb128(seed) → 4 words → sfc32 state; discard 15 outputs; `float = next() / 2^32`; `int(n)` rejects `x ≥ 2^32 − (2^32 mod n)` then returns `x mod n`.

## Rules for the implementer

- Run every command from the worktree root: `cd /home/jhonnold/projects/loophole-wt/core-model`.
- Bun is not on PATH by default. Start every shell command that uses `bun` with `export PATH="$HOME/.bun/bin:$PATH";`.
- Run `bun install` once before step 1 (the worktree has no `node_modules`). It must report no lockfile changes; `bun.lock` must stay unmodified.
- Create each file with exactly the content given. Blocks fenced with `~~~~` are file contents, verbatim (2-space indent, LF, final newline). Do not "improve" the code: the tests, golden values and fixture strings were generated by running exactly this code.
- No new dependencies. `fast-check` and `@types/bun` are already root devDependencies.
- Leave `docs/plans/01-core-model.md` (this file) unchanged.
- Make the eight commits below, in order, with the exact messages given. Do not push. Stage only the files each step names (`git add <paths>`; for deletions use `git rm`).
- After each step, run that step's verification. If anything differs from what is expected, fix the cause before going on. Do not skip a check and do not weaken a test.
- If `bun run lint` reports formatting differences in a file you created, run `bun run format`, then confirm with `git diff` that only whitespace/wrapping changed.

---

## Step 1 — CI token is read-only

Follow-up from the scaffold review: the workflow should not get a write token.

Replace `.github/workflows/ci.yml` with:

~~~~yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: package.json
      - run: bun install --frozen-lockfile
      - run: bun run check
~~~~

Verify:
```sh
grep -n -A1 '^permissions:' .github/workflows/ci.yml   # expect "permissions:" then "  contents: read"
export PATH="$HOME/.bun/bin:$PATH"; bun run check; echo "rc=$?"   # expect rc=0, 2 pass
```

Commit (`git add .github/workflows/ci.yml`): `ci: give the workflow a read-only token`

---

## Step 2 — Core sources typecheck without Bun types

Follow-up from the scaffold review: `tsconfig.base.json` has `types: ["bun"]`, so Bun globals would typecheck inside core's runtime code. Core's main config drops all ambient types and skips tests; a second config checks tests with Bun's types.

### 2.1 `packages/core/tsconfig.json` (replace)

~~~~json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": []
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts", "src/test-support"]
}
~~~~

### 2.2 `packages/core/tsconfig.test.json` (new)

~~~~json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
~~~~

### 2.3 `packages/core/package.json` (replace)

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
    "typecheck": "tsc -p . && tsc -p tsconfig.test.json"
  }
}
~~~~

Verify:
```sh
export PATH="$HOME/.bun/bin:$PATH"
bun run check; echo "rc=$?"                                # expect rc=0, 2 pass
echo 'export const v = Bun.version;' > packages/core/src/bad.ts
(cd packages/core && bun run typecheck); echo "rc=$?"      # expect error TS2868 "Cannot find name 'Bun'", rc=2
echo 'console.log(1);' > packages/core/src/bad.ts
(cd packages/core && bun run typecheck); echo "rc=$?"      # expect error TS2584 "Cannot find name 'console'", rc=2
rm packages/core/src/bad.ts
(cd packages/core && bun run typecheck); echo "rc=$?"      # expect rc=0
git status --short    # expect only: M packages/core/package.json, M packages/core/tsconfig.json, ?? packages/core/tsconfig.test.json
```

Commit (`git add packages/core/tsconfig.json packages/core/tsconfig.test.json packages/core/package.json`): `build(core): typecheck core sources without bun types`

---

## Step 3 — Grid model

Deletes the scaffold placeholder (`add` and its test).

### 3.1 Delete the placeholder test
`git rm packages/core/src/index.test.ts`

### 3.2 `packages/core/src/grid.ts` (new)

~~~~ts
/**
 * Grid geometry for a W×H Slitherlink board, with adjacency tables in typed arrays for hot loops.
 *
 * Indexing (W = width, H = height):
 * - cell (row r, col c), 0 ≤ r < H, 0 ≤ c < W: `r * W + c`
 * - dot (row r, col c), 0 ≤ r ≤ H, 0 ≤ c ≤ W: `r * (W + 1) + c`
 * - horizontal edge (row r, col c), 0 ≤ r ≤ H, 0 ≤ c < W, joins dot (r, c) to dot (r, c + 1): `r * W + c`
 * - vertical edge (row r, col c), 0 ≤ r < H, 0 ≤ c ≤ W, joins dot (r, c) to dot (r + 1, c):
 *   `hEdgeCount + r * (W + 1) + c`, where `hEdgeCount = (H + 1) * W`
 */

export const MIN_SIZE = 1;
export const MAX_SIZE = 100;

/** Marks a missing neighbour in `dotEdges` and `edgeCells`. */
export const NONE = -1;

/** The state of one edge. Edge states are stored in a `Uint8Array` of length `grid.edgeCount`. */
export const EdgeState = {
  Unknown: 0,
  Line: 1,
  Cross: 2,
} as const;
export type EdgeState = (typeof EdgeState)[keyof typeof EdgeState];

export interface Grid {
  readonly width: number;
  readonly height: number;
  readonly cellCount: number;
  readonly dotCount: number;
  readonly hEdgeCount: number;
  readonly edgeCount: number;
  /** 4 entries per cell, clockwise from the top: `[top, right, bottom, left]` edge indices. */
  readonly cellEdges: Int32Array;
  /** 4 entries per dot, clockwise from up: `[up, right, down, left]` edge indices, `NONE` off the board. */
  readonly dotEdges: Int32Array;
  /** 2 entries per edge: `[top or left dot, bottom or right dot]`. */
  readonly edgeDots: Int32Array;
  /** 2 entries per edge: `[cell above or left, cell below or right]`, `NONE` outside the board. */
  readonly edgeCells: Int32Array;
}

export interface EdgeCoords {
  readonly horizontal: boolean;
  readonly row: number;
  readonly col: number;
}

export function createGrid(width: number, height: number): Grid {
  if (!isValidSize(width) || !isValidSize(height)) {
    throw new RangeError(
      `grid size must be whole numbers from ${MIN_SIZE} to ${MAX_SIZE}, got ${width}×${height}`,
    );
  }
  const W = width;
  const H = height;
  const cellCount = W * H;
  const dotCount = (W + 1) * (H + 1);
  const hEdgeCount = (H + 1) * W;
  const edgeCount = hEdgeCount + H * (W + 1);

  const cellEdges = new Int32Array(cellCount * 4);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const k = (r * W + c) * 4;
      cellEdges[k] = r * W + c;
      cellEdges[k + 1] = hEdgeCount + r * (W + 1) + c + 1;
      cellEdges[k + 2] = (r + 1) * W + c;
      cellEdges[k + 3] = hEdgeCount + r * (W + 1) + c;
    }
  }

  const dotEdges = new Int32Array(dotCount * 4).fill(NONE);
  for (let r = 0; r <= H; r++) {
    for (let c = 0; c <= W; c++) {
      const k = (r * (W + 1) + c) * 4;
      if (r > 0) dotEdges[k] = hEdgeCount + (r - 1) * (W + 1) + c;
      if (c < W) dotEdges[k + 1] = r * W + c;
      if (r < H) dotEdges[k + 2] = hEdgeCount + r * (W + 1) + c;
      if (c > 0) dotEdges[k + 3] = r * W + c - 1;
    }
  }

  const edgeDots = new Int32Array(edgeCount * 2);
  const edgeCells = new Int32Array(edgeCount * 2).fill(NONE);
  for (let r = 0; r <= H; r++) {
    for (let c = 0; c < W; c++) {
      const e = r * W + c;
      edgeDots[e * 2] = r * (W + 1) + c;
      edgeDots[e * 2 + 1] = r * (W + 1) + c + 1;
      if (r > 0) edgeCells[e * 2] = (r - 1) * W + c;
      if (r < H) edgeCells[e * 2 + 1] = r * W + c;
    }
  }
  for (let r = 0; r < H; r++) {
    for (let c = 0; c <= W; c++) {
      const e = hEdgeCount + r * (W + 1) + c;
      edgeDots[e * 2] = r * (W + 1) + c;
      edgeDots[e * 2 + 1] = (r + 1) * (W + 1) + c;
      if (c > 0) edgeCells[e * 2] = r * W + c - 1;
      if (c < W) edgeCells[e * 2 + 1] = r * W + c;
    }
  }

  return {
    width: W,
    height: H,
    cellCount,
    dotCount,
    hEdgeCount,
    edgeCount,
    cellEdges,
    dotEdges,
    edgeDots,
    edgeCells,
  };
}

function isValidSize(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_SIZE && n <= MAX_SIZE;
}

export function cellIndex(grid: Grid, row: number, col: number): number {
  return row * grid.width + col;
}

export function dotIndex(grid: Grid, row: number, col: number): number {
  return row * (grid.width + 1) + col;
}

export function hEdgeIndex(grid: Grid, row: number, col: number): number {
  return row * grid.width + col;
}

export function vEdgeIndex(grid: Grid, row: number, col: number): number {
  return grid.hEdgeCount + row * (grid.width + 1) + col;
}

/** Row and column of an edge, in the horizontal or vertical edge numbering described above. */
export function edgeCoords(grid: Grid, edge: number): EdgeCoords {
  if (edge < grid.hEdgeCount) {
    return { horizontal: true, row: Math.floor(edge / grid.width), col: edge % grid.width };
  }
  const v = edge - grid.hEdgeCount;
  return { horizontal: false, row: Math.floor(v / (grid.width + 1)), col: v % (grid.width + 1) };
}
~~~~

### 3.3 `packages/core/src/index.ts` (replace)

~~~~ts
export * from "./grid.ts";
~~~~

### 3.4 `packages/core/src/grid.test.ts` (new)

~~~~ts
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  cellIndex,
  createGrid,
  dotIndex,
  edgeCoords,
  hEdgeIndex,
  NONE,
  vEdgeIndex,
} from "./grid.ts";

// 2×2 grid numbering used below (dots dN, edges by number):
//
//   d0 -0- d1 -1- d2
//   6      7      8
//   d3 -2- d4 -3- d5
//   9      10     11
//   d6 -4- d7 -5- d8
//
// Cells: c0 top-left, c1 top-right, c2 bottom-left, c3 bottom-right.

describe("createGrid", () => {
  test("counts cells, dots and edges", () => {
    const g = createGrid(2, 2);
    expect([g.width, g.height, g.cellCount, g.dotCount, g.hEdgeCount, g.edgeCount]).toEqual([
      2, 2, 4, 9, 6, 12,
    ]);
    const wide = createGrid(3, 1);
    expect([wide.cellCount, wide.dotCount, wide.hEdgeCount, wide.edgeCount]).toEqual([3, 8, 6, 10]);
    expect(createGrid(100, 100).edgeCount).toBe(20200);
  });

  test("lists each cell's edges as top, right, bottom, left", () => {
    expect(Array.from(createGrid(2, 2).cellEdges)).toEqual([
      0, 7, 2, 6, 1, 8, 3, 7, 2, 10, 4, 9, 3, 11, 5, 10,
    ]);
    // 3×1: edges 0-2 top row, 3-5 bottom row, 6-9 verticals.
    expect(Array.from(createGrid(3, 1).cellEdges.slice(8, 12))).toEqual([2, 9, 5, 8]);
  });

  test("lists each dot's edges as up, right, down, left", () => {
    const g = createGrid(2, 2);
    const at = (d: number) => Array.from(g.dotEdges.slice(d * 4, d * 4 + 4));
    expect(at(0)).toEqual([NONE, 0, 6, NONE]);
    expect(at(1)).toEqual([NONE, 1, 7, 0]);
    expect(at(4)).toEqual([7, 3, 10, 2]);
    expect(at(8)).toEqual([11, NONE, NONE, 5]);
  });

  test("lists each edge's dots and cells", () => {
    const g = createGrid(2, 2);
    const dots = (e: number) => [g.edgeDots[e * 2], g.edgeDots[e * 2 + 1]];
    const cells = (e: number) => [g.edgeCells[e * 2], g.edgeCells[e * 2 + 1]];
    expect(dots(0)).toEqual([0, 1]);
    expect(dots(5)).toEqual([7, 8]);
    expect(dots(6)).toEqual([0, 3]);
    expect(dots(11)).toEqual([5, 8]);
    expect(cells(0)).toEqual([NONE, 0]);
    expect(cells(2)).toEqual([0, 2]);
    expect(cells(4)).toEqual([2, NONE]);
    expect(cells(6)).toEqual([NONE, 0]);
    expect(cells(7)).toEqual([0, 1]);
    expect(cells(8)).toEqual([1, NONE]);
  });

  test("rejects sizes outside 1-100 and non-integers", () => {
    for (const [w, h] of [
      [0, 5],
      [5, 0],
      [101, 5],
      [5, 101],
      [1.5, 2],
      [Number.NaN, 2],
    ]) {
      expect(() => createGrid(w as number, h as number)).toThrow(RangeError);
    }
  });

  test("tables agree with each other on any grid", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 8 }), (w, h) => {
        const g = createGrid(w, h);
        // Every cell's edges have that cell beside them.
        for (let i = 0; i < g.cellCount; i++) {
          for (let j = 0; j < 4; j++) {
            const e = g.cellEdges[i * 4 + j];
            expect([g.edgeCells[e * 2], g.edgeCells[e * 2 + 1]]).toContain(i);
          }
        }
        // Every edge appears in the dotEdges of exactly its two dots, and in the cellEdges of
        // exactly its non-NONE cells.
        const dotHits = new Array<number>(g.edgeCount).fill(0);
        for (let d = 0; d < g.dotCount; d++) {
          for (let j = 0; j < 4; j++) {
            const e = g.dotEdges[d * 4 + j];
            if (e === NONE) continue;
            dotHits[e]++;
            expect([g.edgeDots[e * 2], g.edgeDots[e * 2 + 1]]).toContain(d);
          }
        }
        expect(dotHits.every((n) => n === 2)).toBe(true);
        const cellHits = new Array<number>(g.edgeCount).fill(0);
        for (const e of g.cellEdges) cellHits[e]++;
        for (let e = 0; e < g.edgeCount; e++) {
          const sides =
            (g.edgeCells[e * 2] === NONE ? 0 : 1) + (g.edgeCells[e * 2 + 1] === NONE ? 0 : 1);
          expect(cellHits[e]).toBe(sides);
        }
      }),
      { numRuns: 30 },
    );
  });
});

describe("index helpers", () => {
  test("match the documented formulas", () => {
    const g = createGrid(3, 2);
    expect(cellIndex(g, 1, 2)).toBe(5);
    expect(dotIndex(g, 2, 3)).toBe(11);
    expect(hEdgeIndex(g, 2, 1)).toBe(7);
    expect(vEdgeIndex(g, 1, 3)).toBe(9 + 7);
  });

  test("edgeCoords inverts hEdgeIndex and vEdgeIndex", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 20 }), (w, h) => {
        const g = createGrid(w, h);
        for (let e = 0; e < g.edgeCount; e++) {
          const { horizontal, row, col } = edgeCoords(g, e);
          expect(horizontal ? hEdgeIndex(g, row, col) : vEdgeIndex(g, row, col)).toBe(e);
          expect(horizontal).toBe(e < g.hEdgeCount);
        }
      }),
      { numRuns: 30 },
    );
  });
});
~~~~

Verify:
```sh
export PATH="$HOME/.bun/bin:$PATH"
bun test packages/core/src/grid.test.ts   # expect 8 pass, 0 fail
bun run check; echo "rc=$?"               # expect rc=0, "8 pass", "Ran 8 tests across 1 file"
grep -rn "add(" packages/core/src || echo "placeholder gone"
```

Commit (`git add packages/core/src/grid.ts packages/core/src/grid.test.ts packages/core/src/index.ts`; the `git rm` is already staged): `feat(core): add grid model with dot, edge and cell indexing`

---

## Step 4 — Puzzle model and wire format v1

### 4.1 `packages/core/src/puzzle.ts` (new)

~~~~ts
import { createGrid, EdgeState, type Grid } from "./grid.ts";

/** Marks a cell without a clue in `Puzzle.clues`. */
export const NO_CLUE = -1;

export interface Puzzle {
  readonly grid: Grid;
  /** One entry per cell, row-major: 0–3, or `NO_CLUE`. */
  readonly clues: Int8Array;
  readonly seed?: string;
  readonly meta?: Readonly<Record<string, string>>;
}

export interface PuzzleOptions {
  readonly seed?: string;
  readonly meta?: Readonly<Record<string, string>>;
}

/**
 * Builds a puzzle. `clues` defaults to no clues. Throws `RangeError` for a bad size, a clues array
 * of the wrong length, or a clue outside 0–3 and `NO_CLUE`. Use `parsePuzzle` for untrusted input.
 */
export function createPuzzle(
  width: number,
  height: number,
  clues?: ArrayLike<number>,
  options: PuzzleOptions = {},
): Puzzle {
  const grid = createGrid(width, height);
  const out = new Int8Array(grid.cellCount).fill(NO_CLUE);
  if (clues !== undefined) {
    if (clues.length !== grid.cellCount) {
      throw new RangeError(`expected ${grid.cellCount} clues, got ${clues.length}`);
    }
    for (let i = 0; i < grid.cellCount; i++) {
      const k = clues[i];
      if (k !== NO_CLUE && k !== 0 && k !== 1 && k !== 2 && k !== 3) {
        throw new RangeError(`clue at cell ${i} must be 0-3 or ${NO_CLUE}, got ${k}`);
      }
      out[i] = k;
    }
  }
  const puzzle: { grid: Grid; clues: Int8Array; seed?: string; meta?: Record<string, string> } = {
    grid,
    clues: out,
  };
  if (options.seed !== undefined) puzzle.seed = options.seed;
  if (options.meta !== undefined) puzzle.meta = { ...options.meta };
  return puzzle;
}

/**
 * Counts the `Line` sides of every cell. Values are 0–4; a 4 only happens when the loop is that one
 * cell, so map 4 to `NO_CLUE` before using the result as clues.
 */
export function deriveClues(grid: Grid, edges: Uint8Array): Int8Array {
  const clues = new Int8Array(grid.cellCount);
  for (let i = 0; i < grid.cellCount; i++) {
    let n = 0;
    for (let j = 0; j < 4; j++) {
      if (edges[grid.cellEdges[i * 4 + j]] === EdgeState.Line) n++;
    }
    clues[i] = n;
  }
  return clues;
}
~~~~

### 4.2 `packages/core/src/format.ts` (new)

~~~~ts
import { EdgeState, type Grid, MAX_SIZE, MIN_SIZE } from "./grid.ts";
import { createPuzzle, NO_CLUE, type Puzzle } from "./puzzle.ts";

/** Version 1 of the puzzle wire format. `docs/FORMAT.md` is the specification. */
export interface PuzzleWireV1 {
  v: 1;
  width: number;
  height: number;
  clues: string;
  seed?: string;
  meta?: Record<string, string>;
}

export const MAX_SEED_LENGTH = 128;
export const MAX_META_ENTRIES = 32;
export const MAX_META_KEY_LENGTH = 64;
export const MAX_META_VALUE_LENGTH = 1024;

/** Thrown for input that does not follow `docs/FORMAT.md`. `path` names the offending field. */
export class FormatError extends Error {
  readonly path: string;

  constructor(path: string, detail: string) {
    super(path === "" ? detail : `${path}: ${detail}`);
    this.name = "FormatError";
    this.path = path;
  }
}

const PUZZLE_FIELDS = new Set(["v", "width", "height", "clues", "seed", "meta"]);

/** Validates a decoded JSON value against the v1 puzzle format. Throws `FormatError`. */
export function parsePuzzle(input: unknown): Puzzle {
  if (!isPlainObject(input)) throw new FormatError("", "expected a JSON object");
  for (const key of Object.keys(input)) {
    if (!PUZZLE_FIELDS.has(key)) throw new FormatError(key, "unknown field");
  }
  if (!("v" in input)) throw new FormatError("v", "missing; expected 1");
  if (input.v !== 1) {
    throw new FormatError("v", `unsupported version ${JSON.stringify(input.v)}; expected 1`);
  }
  const width = parseSize(input, "width");
  const height = parseSize(input, "height");

  const clueText = input.clues;
  if (typeof clueText !== "string") throw new FormatError("clues", "expected a string");
  const cellCount = width * height;
  if (clueText.length !== cellCount) {
    throw new FormatError(
      "clues",
      `expected ${cellCount} characters (${width}×${height}), got ${clueText.length}`,
    );
  }
  const clues = new Int8Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    const ch = clueText[i];
    if (ch === ".") clues[i] = NO_CLUE;
    else if (ch === "0" || ch === "1" || ch === "2" || ch === "3") clues[i] = Number(ch);
    else {
      const row = Math.floor(i / width);
      const col = i % width;
      throw new FormatError(
        "clues",
        `invalid character ${JSON.stringify(ch)} at index ${i} (row ${row}, col ${col}); use 0-3 or "."`,
      );
    }
  }

  let seed: string | undefined;
  if ("seed" in input) {
    if (typeof input.seed !== "string") throw new FormatError("seed", "expected a string");
    if (input.seed.length < 1 || input.seed.length > MAX_SEED_LENGTH) {
      throw new FormatError(
        "seed",
        `expected 1 to ${MAX_SEED_LENGTH} characters, got ${input.seed.length}`,
      );
    }
    seed = input.seed;
  }

  let meta: Record<string, string> | undefined;
  if ("meta" in input) meta = parseMeta(input.meta);

  return createPuzzle(width, height, clues, { seed, meta });
}

/** Converts a puzzle to its v1 wire object, ready for `JSON.stringify`. Meta keys come out sorted. */
export function serializePuzzle(puzzle: Puzzle): PuzzleWireV1 {
  const { grid, clues } = puzzle;
  let text = "";
  for (let i = 0; i < grid.cellCount; i++) {
    text += clues[i] === NO_CLUE ? "." : String(clues[i]);
  }
  const wire: PuzzleWireV1 = { v: 1, width: grid.width, height: grid.height, clues: text };
  if (puzzle.seed !== undefined) wire.seed = puzzle.seed;
  if (puzzle.meta !== undefined) {
    wire.meta = Object.fromEntries(
      Object.entries(puzzle.meta).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  }
  return wire;
}

/** `parsePuzzle` for JSON text. Invalid JSON is a `FormatError` too. */
export function parsePuzzleJson(text: string): Puzzle {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new FormatError("", `invalid JSON: ${(err as Error).message}`);
  }
  return parsePuzzle(value);
}

/** The canonical JSON text of a puzzle: `serializePuzzle` with no whitespace. */
export function serializePuzzleJson(puzzle: Puzzle): string {
  return JSON.stringify(serializePuzzle(puzzle));
}

/** Encodes edge states as one character per edge, in edge index order: `0` unknown, `1` line, `2` cross. */
export function encodeEdges(edges: Uint8Array): string {
  let text = "";
  for (let e = 0; e < edges.length; e++) {
    const s = edges[e];
    if (s !== EdgeState.Unknown && s !== EdgeState.Line && s !== EdgeState.Cross) {
      throw new RangeError(`edge ${e} has invalid state ${s}`);
    }
    text += String(s);
  }
  return text;
}

/** Decodes an edge-state string for the given grid. Throws `FormatError`. */
export function decodeEdges(grid: Grid, text: string): Uint8Array {
  if (typeof text !== "string") throw new FormatError("edges", "expected a string");
  if (text.length !== grid.edgeCount) {
    throw new FormatError(
      "edges",
      `expected ${grid.edgeCount} characters for a ${grid.width}×${grid.height} grid, got ${text.length}`,
    );
  }
  const edges = new Uint8Array(grid.edgeCount);
  for (let e = 0; e < text.length; e++) {
    const ch = text[e];
    if (ch === "0" || ch === "1" || ch === "2") edges[e] = Number(ch);
    else {
      throw new FormatError(
        "edges",
        `invalid character ${JSON.stringify(ch)} at index ${e}; use 0, 1 or 2`,
      );
    }
  }
  return edges;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSize(input: Record<string, unknown>, field: "width" | "height"): number {
  const n = input[field];
  if (typeof n !== "number" || !Number.isInteger(n) || n < MIN_SIZE || n > MAX_SIZE) {
    throw new FormatError(
      field,
      `expected a whole number from ${MIN_SIZE} to ${MAX_SIZE}, got ${JSON.stringify(n)}`,
    );
  }
  return n;
}

function parseMeta(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) throw new FormatError("meta", "expected an object");
  const entries = Object.entries(value);
  if (entries.length > MAX_META_ENTRIES) {
    throw new FormatError(
      "meta",
      `expected at most ${MAX_META_ENTRIES} entries, got ${entries.length}`,
    );
  }
  for (const [key, v] of entries) {
    if (key.length < 1 || key.length > MAX_META_KEY_LENGTH) {
      throw new FormatError("meta", `keys must be 1 to ${MAX_META_KEY_LENGTH} characters`);
    }
    if (typeof v !== "string") throw new FormatError(`meta.${key}`, "expected a string");
    if (v.length > MAX_META_VALUE_LENGTH) {
      throw new FormatError(
        `meta.${key}`,
        `expected at most ${MAX_META_VALUE_LENGTH} characters, got ${v.length}`,
      );
    }
  }
  // fromEntries defines own properties, so a "__proto__" key stays an ordinary key.
  return Object.fromEntries(entries) as Record<string, string>;
}
~~~~

Notes on behaviour the tests pin down:
- Errors stop at the first problem, checked in this order: object shape, unknown fields, `v`, `width`, `height`, `clues`, `seed`, `meta`.
- Clue error positions are 0-based (`index 2 (row 1, col 0)`).
- `meta` is rebuilt with `Object.fromEntries`, so a `"__proto__"` key stays a plain own key and never changes the object's prototype.

### 4.3 `packages/core/src/test-support/arbitraries.ts` (new; step 5 extends it)

This folder holds test helpers shared by test files. The main tsconfig excludes it; it is not exported from `index.ts`.

~~~~ts
import fc from "fast-check";
import type { PuzzleWireV1 } from "../format.ts";

/** Valid v1 wire objects, with optional seed and meta. */
export function arbPuzzleWire(maxWidth = 12, maxHeight = 12): fc.Arbitrary<PuzzleWireV1> {
  return fc
    .record({
      width: fc.integer({ min: 1, max: maxWidth }),
      height: fc.integer({ min: 1, max: maxHeight }),
    })
    .chain(({ width, height }) =>
      fc.record(
        {
          v: fc.constant(1 as const),
          width: fc.constant(width),
          height: fc.constant(height),
          clues: fc
            .array(fc.constantFrom(".", "0", "1", "2", "3"), {
              minLength: width * height,
              maxLength: width * height,
            })
            .map((chars) => chars.join("")),
          seed: fc.string({ minLength: 1, maxLength: 128 }),
          meta: fc.dictionary(
            fc.string({ minLength: 1, maxLength: 64 }),
            fc.string({ maxLength: 50 }),
            {
              maxKeys: 8,
              noNullPrototype: true,
            },
          ),
        },
        { requiredKeys: ["v", "width", "height", "clues"] },
      ),
    );
}
~~~~

### 4.4 `packages/core/src/index.ts` (replace)

~~~~ts
export * from "./format.ts";
export * from "./grid.ts";
export * from "./puzzle.ts";
~~~~

### 4.5 `packages/core/src/puzzle.test.ts` (new)

~~~~ts
import { describe, expect, test } from "bun:test";
import { createGrid, EdgeState } from "./grid.ts";
import { createPuzzle, deriveClues, NO_CLUE } from "./puzzle.ts";

describe("createPuzzle", () => {
  test("defaults to no clues and no seed or meta", () => {
    const p = createPuzzle(2, 1);
    expect(Array.from(p.clues)).toEqual([NO_CLUE, NO_CLUE]);
    expect(p.grid.width).toBe(2);
    expect("seed" in p).toBe(false);
    expect("meta" in p).toBe(false);
  });

  test("copies clues, seed and meta", () => {
    const clues = [0, 3, NO_CLUE];
    const meta = { title: "x" };
    const p = createPuzzle(3, 1, clues, { seed: "s", meta });
    clues[0] = 2;
    meta.title = "y";
    expect(Array.from(p.clues)).toEqual([0, 3, NO_CLUE]);
    expect(p.seed).toBe("s");
    expect(p.meta).toEqual({ title: "x" });
  });

  test("rejects a wrong clue count or a clue outside 0-3", () => {
    expect(() => createPuzzle(2, 2, [1, 2, 3])).toThrow(RangeError);
    expect(() => createPuzzle(1, 1, [4])).toThrow(RangeError);
    expect(() => createPuzzle(1, 1, [-2])).toThrow(RangeError);
    expect(() => createPuzzle(0, 1)).toThrow(RangeError);
  });
});

describe("deriveClues", () => {
  test("counts line sides per cell", () => {
    const g = createGrid(2, 2);
    const edges = new Uint8Array(g.edgeCount).fill(EdgeState.Cross);
    // Loop around the top two cells: edges 0, 1, 8, 3, 2, 6.
    for (const e of [0, 1, 8, 3, 2, 6]) edges[e] = EdgeState.Line;
    expect(Array.from(deriveClues(g, edges))).toEqual([3, 3, 1, 1]);
  });

  test("gives 4 for a loop around one cell", () => {
    const g = createGrid(1, 1);
    expect(Array.from(deriveClues(g, new Uint8Array([1, 1, 1, 1])))).toEqual([4]);
  });
});
~~~~

### 4.6 `packages/core/src/format.test.ts` (new)

~~~~ts
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  decodeEdges,
  encodeEdges,
  FormatError,
  parsePuzzle,
  parsePuzzleJson,
  serializePuzzle,
  serializePuzzleJson,
} from "./format.ts";
import { createGrid } from "./grid.ts";
import { NO_CLUE } from "./puzzle.ts";
import { arbPuzzleWire } from "./test-support/arbitraries.ts";

const PLAY_PUZZLE = {
  v: 1,
  width: 7,
  height: 7,
  clues: ".11..0..23.2......2.21.0....1....01.1..3..0..1..1",
} as const;

function formatError(fn: () => unknown): FormatError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(FormatError);
    return err as FormatError;
  }
  throw new Error("expected a FormatError");
}

describe("parsePuzzle", () => {
  test("reads the design kit's 7×7 puzzle", () => {
    const p = parsePuzzle(PLAY_PUZZLE);
    expect(p.grid.width).toBe(7);
    expect(p.grid.height).toBe(7);
    expect(Array.from(p.clues.slice(0, 6))).toEqual([NO_CLUE, 1, 1, NO_CLUE, NO_CLUE, 0]);
    expect(serializePuzzle(p)).toEqual(PLAY_PUZZLE);
  });

  test("maps clue characters to clue values", () => {
    const p = parsePuzzle({ v: 1, width: 5, height: 1, clues: ".0123" });
    expect(Array.from(p.clues)).toEqual([NO_CLUE, 0, 1, 2, 3]);
  });

  test("keeps seed and meta", () => {
    const p = parsePuzzle({ v: 1, width: 1, height: 1, clues: ".", seed: "abc", meta: { a: "1" } });
    expect(p.seed).toBe("abc");
    expect(p.meta).toEqual({ a: "1" });
  });

  const ok = { v: 1, width: 2, height: 2, clues: "...." };
  const cases: [string, unknown, string, string][] = [
    ["null", null, "", "expected a JSON object"],
    ["an array", [], "", "expected a JSON object"],
    ["a string", "2x2", "", "expected a JSON object"],
    ["an unknown field", { ...ok, extra: 1 }, "extra", "extra: unknown field"],
    ["a missing version", { width: 2, height: 2, clues: "...." }, "v", "v: missing; expected 1"],
    ["version 2", { ...ok, v: 2 }, "v", "v: unsupported version 2; expected 1"],
    [
      "width 0",
      { ...ok, width: 0 },
      "width",
      "width: expected a whole number from 1 to 100, got 0",
    ],
    [
      "width 101",
      { ...ok, width: 101 },
      "width",
      "width: expected a whole number from 1 to 100, got 101",
    ],
    [
      "width 1.5",
      { ...ok, width: 1.5 },
      "width",
      "width: expected a whole number from 1 to 100, got 1.5",
    ],
    [
      "width as a string",
      { ...ok, width: "2" },
      "width",
      'width: expected a whole number from 1 to 100, got "2"',
    ],
    [
      "a missing height",
      { v: 1, width: 2, clues: ".." },
      "height",
      "height: expected a whole number from 1 to 100, got undefined",
    ],
    ["clues as a number", { ...ok, clues: 1234 }, "clues", "clues: expected a string"],
    [
      "too few clues",
      { ...ok, clues: "..." },
      "clues",
      "clues: expected 4 characters (2×2), got 3",
    ],
    [
      "a bad clue",
      { ...ok, clues: "..4." },
      "clues",
      'clues: invalid character "4" at index 2 (row 1, col 0); use 0-3 or "."',
    ],
    ["an empty seed", { ...ok, seed: "" }, "seed", "seed: expected 1 to 128 characters, got 0"],
    [
      "a long seed",
      { ...ok, seed: "s".repeat(129) },
      "seed",
      "seed: expected 1 to 128 characters, got 129",
    ],
    ["a numeric seed", { ...ok, seed: 5 }, "seed", "seed: expected a string"],
    ["meta as an array", { ...ok, meta: [] }, "meta", "meta: expected an object"],
    ["a numeric meta value", { ...ok, meta: { a: 1 } }, "meta.a", "meta.a: expected a string"],
    [
      "an empty meta key",
      { ...ok, meta: { "": "x" } },
      "meta",
      "meta: keys must be 1 to 64 characters",
    ],
    [
      "a long meta value",
      { ...ok, meta: { k: "x".repeat(1025) } },
      "meta.k",
      "meta.k: expected at most 1024 characters, got 1025",
    ],
    [
      "too many meta entries",
      { ...ok, meta: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, ""])) },
      "meta",
      "meta: expected at most 32 entries, got 33",
    ],
  ];
  for (const [name, input, path, message] of cases) {
    test(`rejects ${name}`, () => {
      const err = formatError(() => parsePuzzle(input));
      expect(err.path).toBe(path);
      expect(err.message).toBe(message);
      expect(err.name).toBe("FormatError");
    });
  }
});

describe("serializePuzzle", () => {
  test("writes canonical JSON with sorted meta keys", () => {
    const p = parsePuzzle({
      v: 1,
      width: 2,
      height: 1,
      clues: "3.",
      seed: "s",
      meta: { b: "2", a: "1" },
    });
    expect(serializePuzzleJson(p)).toBe(
      '{"v":1,"width":2,"height":1,"clues":"3.","seed":"s","meta":{"a":"1","b":"2"}}',
    );
  });

  test("keeps a __proto__ meta key as plain data", () => {
    const p = parsePuzzleJson('{"v":1,"width":1,"height":1,"clues":".","meta":{"__proto__":"x"}}');
    const meta = serializePuzzle(p).meta as Record<string, string>;
    expect(Object.getPrototypeOf(meta)).toBe(Object.prototype);
    expect(Object.keys(meta)).toEqual(["__proto__"]);
    expect(serializePuzzleJson(p)).toContain('"meta":{"__proto__":"x"}');
  });

  test("round-trips any valid wire object", () => {
    fc.assert(
      fc.property(arbPuzzleWire(), (wire) => {
        expect(serializePuzzle(parsePuzzle(wire))).toEqual(wire);
        const p = parsePuzzle(wire);
        expect(serializePuzzleJson(parsePuzzleJson(serializePuzzleJson(p)))).toBe(
          serializePuzzleJson(p),
        );
      }),
    );
  });
});

describe("parsePuzzleJson", () => {
  test("reports invalid JSON as a FormatError", () => {
    const err = formatError(() => parsePuzzleJson("{nope"));
    expect(err.path).toBe("");
    expect(err.message.startsWith("invalid JSON: ")).toBe(true);
  });
});

describe("edge encoding", () => {
  test("writes one digit per edge", () => {
    expect(encodeEdges(new Uint8Array([0, 1, 2, 1]))).toBe("0121");
    expect(Array.from(decodeEdges(createGrid(1, 1), "1112"))).toEqual([1, 1, 1, 2]);
  });

  test("rejects bad input", () => {
    const g = createGrid(1, 1);
    expect(formatError(() => decodeEdges(g, "111")).message).toBe(
      "edges: expected 4 characters for a 1×1 grid, got 3",
    );
    expect(formatError(() => decodeEdges(g, "1131")).message).toBe(
      'edges: invalid character "3" at index 2; use 0, 1 or 2',
    );
    expect(() => encodeEdges(new Uint8Array([3]))).toThrow(RangeError);
  });

  test("round-trips any edge states", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 10 }),
        fc.infiniteStream(fc.constantFrom(0, 1, 2)),
        (w, h, states) => {
          const g = createGrid(w, h);
          const edges = Uint8Array.from(states.take(g.edgeCount));
          expect(decodeEdges(g, encodeEdges(edges))).toEqual(edges);
        },
      ),
    );
  });
});
~~~~

### 4.7 `docs/FORMAT.md` (new)

~~~~markdown
# Wire format

How Loophole puzzles and board states are written down for storage and for the API (PRD FR-2). The core package implements this: `parsePuzzle` / `serializePuzzle` for puzzles, `encodeEdges` / `decodeEdges` for edge states.

Current version: **1**.

## Coordinates

A puzzle is a grid of W×H cells (W = width = columns, H = height = rows), each between 1 and 100. Rows count from 0 at the top and columns from 0 at the left.

- **Cell** (row r, col c), 0 ≤ r < H, 0 ≤ c < W, has index `r·W + c`.
- **Dot** (row r, col c), 0 ≤ r ≤ H, 0 ≤ c ≤ W, has index `r·(W+1) + c`. Dots are the cell corners.
- **Horizontal edge** (row r, col c), 0 ≤ r ≤ H, 0 ≤ c < W, joins dot (r, c) to dot (r, c+1). Index `r·W + c`.
- **Vertical edge** (row r, col c), 0 ≤ r < H, 0 ≤ c ≤ W, joins dot (r, c) to dot (r+1, c). Index `(H+1)·W + r·(W+1) + c`.

So all `(H+1)·W` horizontal edges come first, row by row, then all `H·(W+1)` vertical edges, row by row. The edge count is `(H+1)·W + H·(W+1)`.

A 2×2 grid, with edge indices:

```
 +-0-+-1-+
 6   7   8
 +-2-+-3-+
 9  10  11
 +-4-+-5-+
```

## Puzzle (version 1)

A puzzle is a JSON object:

```json
{"v":1,"width":7,"height":7,"clues":".11..0..23.2......2.21.0....1....01.1..3..0..1..1"}
```

| Field | Required | Type | Rules |
|---|---|---|---|
| `v` | yes | number | Format version. Must be `1`. |
| `width` | yes | number | Whole number, 1 to 100. |
| `height` | yes | number | Whole number, 1 to 100. |
| `clues` | yes | string | Exactly `width × height` characters, one per cell in row-major order (cell index order). `0`–`3` is a clue; `.` is a cell without a clue. |
| `seed` | no | string | The seed the puzzle was generated from. 1 to 128 characters. |
| `meta` | no | object | Free-form string metadata, such as a generator version or a title. At most 32 entries; keys 1 to 64 characters; values are strings of at most 1024 characters. |

Lengths are counted in UTF-16 code units (JavaScript string length).

A reader rejects a puzzle that breaks any rule, including one with a field not listed above. The error names the field (`width`, `clues`, `meta.title`) and says what was expected.

**Canonical form.** Writers emit the fields in the order of the table, leave out absent optional fields, sort `meta` keys by UTF-16 code unit, and add no whitespace. `serializePuzzleJson` produces this form, so equal puzzles give identical text.

A solution is never part of a puzzle: ranked play must not send it to the client (FR-25).

## Edge states (version 1)

A board state (a player's progress, or a solution) is a string with one character per edge, in edge index order:

| Character | State |
|---|---|
| `0` | unknown (nothing drawn) |
| `1` | line |
| `2` | cross (marked as not a line) |

The string's length must equal the puzzle's edge count. The grid size is not part of the string; it always travels with, or is looked up from, its puzzle.

A solution is written with only `1` and `2`. The 2×2 puzzle `"2222"` has one solution, the outer square:

```
112211121121
```

## Versioning

Any change that an older reader would misread gets a new version number. A puzzle carries its version in `v`. Version 1 edge strings contain only `0`, `1` and `2`; a later edge encoding will start with a character outside those, so it can be told apart from version 1.
~~~~

Verify:
```sh
export PATH="$HOME/.bun/bin:$PATH"
bun test packages/core/src/format.test.ts packages/core/src/puzzle.test.ts   # expect 37 pass, 0 fail
bun run check; echo "rc=$?"                  # expect rc=0, "45 pass", "Ran 45 tests across 3 files"
```

Commit (`git add packages/core/src/puzzle.ts packages/core/src/puzzle.test.ts packages/core/src/format.ts packages/core/src/format.test.ts packages/core/src/test-support/arbitraries.ts packages/core/src/index.ts docs/FORMAT.md`): `feat(core): add puzzle model and v1 wire format`

---

## Step 5 — Brute-force solution finder

### 5.1 `packages/core/src/bruteforce.ts` (new)

~~~~ts
import { EdgeState, type Grid, NONE } from "./grid.ts";
import { NO_CLUE, type Puzzle } from "./puzzle.ts";

/** Largest grid area `bruteForceSolutions` accepts: it tries 2^cells colourings. */
export const BRUTE_FORCE_MAX_CELLS = 20;

/**
 * Finds solutions by trying every way to colour the cells inside or outside, in increasing bitmask
 * order (bit i set = cell i inside). This is a test oracle: slow, simple, and sharing no logic with
 * the solver.
 *
 * Why it finds every solution exactly once: a single closed loop splits the cells into inside and
 * outside, and an edge is on the loop exactly when the cells on its two sides differ (with
 * everything beyond the border counting as outside). So each solution is the boundary of exactly
 * one non-empty inside set. Each colouring's boundary is kept only if it is one closed loop that
 * satisfies every clue.
 *
 * Returns at most `limit` solutions, each a full edge-state array (`Line` or `Cross`, never
 * `Unknown`). Throws `RangeError` when the grid has more than `BRUTE_FORCE_MAX_CELLS` cells.
 */
export function bruteForceSolutions(puzzle: Puzzle, limit = 2): Uint8Array[] {
  const { grid, clues } = puzzle;
  const n = grid.cellCount;
  if (n > BRUTE_FORCE_MAX_CELLS) {
    throw new RangeError(`brute force supports at most ${BRUTE_FORCE_MAX_CELLS} cells, got ${n}`);
  }
  if (!(limit >= 1)) throw new RangeError(`limit must be at least 1, got ${limit}`);

  const solutions: Uint8Array[] = [];
  const inside = new Uint8Array(n);
  const total = 2 ** n;
  for (let mask = 1; mask < total && solutions.length < limit; mask++) {
    for (let i = 0; i < n; i++) inside[i] = (mask >>> i) & 1;
    const edges = boundary(grid, inside);
    if (cluesMatch(grid, clues, edges) && isOneLoop(grid, edges)) solutions.push(edges);
  }
  return solutions;
}

/** Number of solutions, counting no further than `limit`. */
export function countSolutions(puzzle: Puzzle, limit = 2): number {
  return bruteForceSolutions(puzzle, limit).length;
}

function boundary(grid: Grid, inside: Uint8Array): Uint8Array {
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

function cluesMatch(grid: Grid, clues: Int8Array, edges: Uint8Array): boolean {
  for (let i = 0; i < grid.cellCount; i++) {
    if (clues[i] === NO_CLUE) continue;
    let lines = 0;
    for (let j = 0; j < 4; j++) {
      if (edges[grid.cellEdges[i * 4 + j]] === EdgeState.Line) lines++;
    }
    if (lines !== clues[i]) return false;
  }
  return true;
}

/** True when the lines are non-empty, every dot touches 0 or 2 of them, and they are all connected. */
function isOneLoop(grid: Grid, edges: Uint8Array): boolean {
  let lineCount = 0;
  let first = NONE;
  for (let e = 0; e < grid.edgeCount; e++) {
    if (edges[e] !== EdgeState.Line) continue;
    lineCount++;
    if (first === NONE) first = e;
  }
  if (lineCount === 0) return false;

  for (let d = 0; d < grid.dotCount; d++) {
    let degree = 0;
    for (let j = 0; j < 4; j++) {
      const e = grid.dotEdges[d * 4 + j];
      if (e !== NONE && edges[e] === EdgeState.Line) degree++;
    }
    if (degree !== 0 && degree !== 2) return false;
  }

  const reached = new Uint8Array(grid.edgeCount);
  const stack = [first];
  reached[first] = 1;
  let reachedCount = 0;
  while (stack.length > 0) {
    const e = stack.pop() as number;
    reachedCount++;
    for (let k = 0; k < 2; k++) {
      const d = grid.edgeDots[e * 2 + k];
      for (let j = 0; j < 4; j++) {
        const next = grid.dotEdges[d * 4 + j];
        if (next !== NONE && edges[next] === EdgeState.Line && !reached[next]) {
          reached[next] = 1;
          stack.push(next);
        }
      }
    }
  }
  return reachedCount === lineCount;
}
~~~~

### 5.2 `packages/core/src/test-support/arbitraries.ts` (replace with the full version)

~~~~ts
import fc from "fast-check";
import { bruteForceSolutions } from "../bruteforce.ts";
import type { PuzzleWireV1 } from "../format.ts";
import { createPuzzle, deriveClues, NO_CLUE, type Puzzle } from "../puzzle.ts";

/** Valid v1 wire objects, with optional seed and meta. */
export function arbPuzzleWire(maxWidth = 12, maxHeight = 12): fc.Arbitrary<PuzzleWireV1> {
  return fc
    .record({
      width: fc.integer({ min: 1, max: maxWidth }),
      height: fc.integer({ min: 1, max: maxHeight }),
    })
    .chain(({ width, height }) =>
      fc.record(
        {
          v: fc.constant(1 as const),
          width: fc.constant(width),
          height: fc.constant(height),
          clues: fc
            .array(fc.constantFrom(".", "0", "1", "2", "3"), {
              minLength: width * height,
              maxLength: width * height,
            })
            .map((chars) => chars.join("")),
          seed: fc.string({ minLength: 1, maxLength: 128 }),
          meta: fc.dictionary(
            fc.string({ minLength: 1, maxLength: 64 }),
            fc.string({ maxLength: 50 }),
            {
              maxKeys: 8,
              noNullPrototype: true,
            },
          ),
        },
        { requiredKeys: ["v", "width", "height", "clues"] },
      ),
    );
}

const loopCache = new Map<string, Uint8Array[]>();

/** Every single loop on an empty width×height grid, cached. Keep width×height small. */
export function allLoops(width: number, height: number): Uint8Array[] {
  const key = `${width}x${height}`;
  let loops = loopCache.get(key);
  if (loops === undefined) {
    loops = bruteForceSolutions(createPuzzle(width, height), Number.POSITIVE_INFINITY);
    loopCache.set(key, loops);
  }
  return loops;
}

/**
 * A puzzle together with one of its solutions: a random loop, with each derived clue kept or blanked
 * at random. The puzzle may have other solutions too.
 */
export function arbPuzzleWithSolution(
  maxWidth = 3,
  maxHeight = 3,
): fc.Arbitrary<{ puzzle: Puzzle; solution: Uint8Array }> {
  return fc
    .record({
      width: fc.integer({ min: 1, max: maxWidth }),
      height: fc.integer({ min: 1, max: maxHeight }),
    })
    .chain(({ width, height }) =>
      fc.record({
        width: fc.constant(width),
        height: fc.constant(height),
        loop: fc.nat({ max: allLoops(width, height).length - 1 }),
        keep: fc.array(fc.boolean(), { minLength: width * height, maxLength: width * height }),
      }),
    )
    .map(({ width, height, loop, keep }) => {
      const solution = allLoops(width, height)[loop];
      const full = deriveClues(createPuzzle(width, height).grid, solution);
      const clues = Array.from(full, (k, i) => (keep[i] && k <= 3 ? k : NO_CLUE));
      return { puzzle: createPuzzle(width, height, clues), solution };
    });
}
~~~~

### 5.3 `packages/core/src/test-support/fixtures.ts` (new)

Every count and solution string below was produced by running `bruteForceSolutions` with no limit. Hand checks: 2×2 `0...` forces the three cells touching the 0 outside, so the only loop is the square around the bottom-right cell (edges 3, 5, 10, 11 → `222121222211`); 2×2 `2222` is the outer square; 2×2 `3311` is the top domino; the empty-grid counts 1, 13, 213, 9349 for 1×1 … 4×4 match OEIS A140517 (simple cycles in a square grid graph).

~~~~ts
/**
 * Small puzzles with solution counts checked by brute force. `solutions` lists every solution in
 * `encodeEdges` form, in the order `bruteForceSolutions` returns them.
 */
export interface Fixture {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly clues: string;
  readonly count: number;
  readonly solutions?: readonly string[];
}

export const FIXTURES: readonly Fixture[] = [
  { name: "1x1 empty", width: 1, height: 1, clues: ".", count: 1, solutions: ["1111"] },
  { name: "1x1 zero", width: 1, height: 1, clues: "0", count: 0, solutions: [] },
  { name: "1x1 three", width: 1, height: 1, clues: "3", count: 0, solutions: [] },
  { name: "1x2 three on top", width: 1, height: 2, clues: "3.", count: 1, solutions: ["1211111"] },
  {
    name: "2x2 zero in a corner",
    width: 2,
    height: 2,
    clues: "0...",
    count: 1,
    solutions: ["222121222211"],
  },
  {
    name: "2x2 all twos",
    width: 2,
    height: 2,
    clues: "2222",
    count: 1,
    solutions: ["112211121121"],
  },
  {
    name: "2x2 top domino",
    width: 2,
    height: 2,
    clues: "3311",
    count: 1,
    solutions: ["111122121222"],
  },
  { name: "2x2 all threes", width: 2, height: 2, clues: "3333", count: 0, solutions: [] },
  {
    name: "3x3 top strip",
    width: 3,
    height: 3,
    clues: ".2..1..0.",
    count: 1,
    solutions: ["111111222222122122222222"],
  },
  {
    name: "3x3 corner zeros",
    width: 3,
    height: 3,
    clues: "0.0...0.0",
    count: 1,
    solutions: ["222212212222222221122222"],
  },
  {
    name: "3x3 two zeros",
    width: 3,
    height: 3,
    clues: ".0..0....",
    count: 2,
    solutions: ["222222122122222222221122", "222222221221222222222211"],
  },
  {
    name: "3x3 four clues, two solutions",
    width: 3,
    height: 3,
    clues: "...3.2.13",
    count: 2,
    solutions: ["111212122221122111112211", "112122121111121221121221"],
  },
  {
    name: "3x3 threes on the diagonal",
    width: 3,
    height: 3,
    clues: "3...3...3",
    count: 0,
    solutions: [],
  },
  {
    name: "4x4 unique",
    width: 4,
    height: 4,
    clues: "..3..2.3.2...33.",
    count: 1,
    solutions: ["2212222111212122121222112221211221211112"],
  },
  { name: "4x4 two solutions", width: 4, height: 4, clues: "21....12...2132.", count: 2 },
  { name: "2x2 empty", width: 2, height: 2, clues: "....", count: 13 },
  { name: "3x3 zero in the centre", width: 3, height: 3, clues: "....0....", count: 20 },
];
~~~~

### 5.4 `packages/core/src/index.ts` (replace)

~~~~ts
export * from "./bruteforce.ts";
export * from "./format.ts";
export * from "./grid.ts";
export * from "./puzzle.ts";
~~~~

### 5.5 `packages/core/src/bruteforce.test.ts` (new)

~~~~ts
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { bruteForceSolutions, countSolutions } from "./bruteforce.ts";
import { encodeEdges, parsePuzzle } from "./format.ts";
import { EdgeState } from "./grid.ts";
import { createPuzzle, deriveClues, NO_CLUE } from "./puzzle.ts";
import { arbPuzzleWithSolution } from "./test-support/arbitraries.ts";
import { FIXTURES } from "./test-support/fixtures.ts";

describe("bruteForceSolutions", () => {
  // Loops on an empty grid = simple cycles in the (W+1)×(H+1) grid graph (OEIS A140517 for squares).
  const emptyCounts: [number, number, number][] = [
    [1, 1, 1],
    [1, 2, 3],
    [2, 1, 3],
    [1, 3, 6],
    [2, 2, 13],
    [2, 3, 40],
    [3, 2, 40],
    [3, 3, 213],
    [2, 4, 108],
    [3, 4, 1049],
    [4, 4, 9349],
  ];
  for (const [w, h, n] of emptyCounts) {
    test(`finds ${n} loops on an empty ${w}×${h} grid`, () => {
      expect(countSolutions(createPuzzle(w, h), Number.POSITIVE_INFINITY)).toBe(n);
    });
  }

  for (const f of FIXTURES) {
    test(`fixture ${f.name} has ${f.count} solution(s)`, () => {
      const p = parsePuzzle({ v: 1, width: f.width, height: f.height, clues: f.clues });
      const found = bruteForceSolutions(p, Number.POSITIVE_INFINITY);
      expect(found.length).toBe(f.count);
      if (f.solutions !== undefined) expect(found.map(encodeEdges)).toEqual([...f.solutions]);
    });
  }

  test("stops at the limit", () => {
    const p = createPuzzle(3, 3);
    expect(countSolutions(p)).toBe(2);
    expect(countSolutions(p, 1)).toBe(1);
    expect(bruteForceSolutions(p, 5).length).toBe(5);
  });

  test("returns full assignments of lines and crosses", () => {
    for (const s of bruteForceSolutions(createPuzzle(2, 2), Number.POSITIVE_INFINITY)) {
      expect(s.every((v) => v === EdgeState.Line || v === EdgeState.Cross)).toBe(true);
    }
  });

  test("rejects grids over 20 cells and a limit below 1", () => {
    expect(() => countSolutions(createPuzzle(5, 5))).toThrow(RangeError);
    expect(() => countSolutions(createPuzzle(1, 1), 0)).toThrow(RangeError);
    expect(() => countSolutions(createPuzzle(1, 1), Number.NaN)).toThrow(RangeError);
  });

  test("finds the planted solution, and every solution fits the clues", () => {
    fc.assert(
      fc.property(arbPuzzleWithSolution(3, 3), ({ puzzle, solution }) => {
        const found = bruteForceSolutions(puzzle, Number.POSITIVE_INFINITY);
        expect(found.map(encodeEdges)).toContain(encodeEdges(solution));
        for (const s of found) {
          const derived = deriveClues(puzzle.grid, s);
          puzzle.clues.forEach((k, i) => {
            if (k !== NO_CLUE) expect(derived[i]).toBe(k);
          });
        }
      }),
      { numRuns: 50 },
    );
  });
});
~~~~

Verify:
```sh
export PATH="$HOME/.bun/bin:$PATH"
bun test packages/core/src/bruteforce.test.ts   # expect 32 pass, 0 fail, well under 1 s
bun run check; echo "rc=$?"                     # expect rc=0, "77 pass", "Ran 77 tests across 4 files"
```

Commit (`git add packages/core/src/bruteforce.ts packages/core/src/bruteforce.test.ts packages/core/src/test-support packages/core/src/index.ts`): `feat(core): add brute-force solution finder for tests`

---

## Step 6 — Violations and completion (FR-15)

### 6.1 `packages/core/src/analyze.ts` (new)

~~~~ts
import { EdgeState, NONE } from "./grid.ts";
import { NO_CLUE, type Puzzle } from "./puzzle.ts";

/** Definite rule breaks (PRD FR-15). Each list is sorted ascending. */
export interface Violations {
  /** Dots with 3 or 4 lines. */
  readonly dots: number[];
  /** Clue cells with more lines than their clue. */
  readonly overfullCells: number[];
  /** Clue cells whose lines plus unknown sides are fewer than their clue (too many crosses). */
  readonly starvedCells: number[];
  /** Every edge of every closed loop, when the board is not solved. Empty when solved. */
  readonly loopEdges: number[];
}

export interface BoardAnalysis {
  readonly violations: Violations;
  /** True when the lines form exactly one closed loop and every clue has exactly its number of lines. */
  readonly solved: boolean;
  /** Clue cells with exactly their number of lines. */
  readonly satisfiedClues: number;
  readonly clueCount: number;
}

/**
 * Checks a board for definite rule breaks and completion. `edges` holds one `EdgeState` per edge.
 * Crosses only matter for `starvedCells`; completion looks at lines alone.
 */
export function analyzeBoard(puzzle: Puzzle, edges: Uint8Array): BoardAnalysis {
  const { grid, clues } = puzzle;
  if (edges.length !== grid.edgeCount) {
    throw new RangeError(`expected ${grid.edgeCount} edge states, got ${edges.length}`);
  }

  const overfullCells: number[] = [];
  const starvedCells: number[] = [];
  let clueCount = 0;
  let satisfiedClues = 0;
  for (let i = 0; i < grid.cellCount; i++) {
    const clue = clues[i];
    if (clue === NO_CLUE) continue;
    clueCount++;
    let lines = 0;
    let unknown = 0;
    for (let j = 0; j < 4; j++) {
      const s = edges[grid.cellEdges[i * 4 + j]];
      if (s === EdgeState.Line) lines++;
      else if (s === EdgeState.Unknown) unknown++;
    }
    if (lines > clue) overfullCells.push(i);
    if (lines + unknown < clue) starvedCells.push(i);
    if (lines === clue) satisfiedClues++;
  }

  const degree = new Uint8Array(grid.dotCount);
  for (let e = 0; e < grid.edgeCount; e++) {
    if (edges[e] === EdgeState.Line) {
      degree[grid.edgeDots[e * 2]]++;
      degree[grid.edgeDots[e * 2 + 1]]++;
    }
  }
  const dots: number[] = [];
  for (let d = 0; d < grid.dotCount; d++) {
    if (degree[d] >= 3) dots.push(d);
  }

  // Split the lines into connected components. A component is a closed loop when every dot on it
  // has exactly two lines.
  const seen = new Uint8Array(grid.edgeCount);
  const stack: number[] = [];
  const closedLoops: number[][] = [];
  let componentCount = 0;
  for (let start = 0; start < grid.edgeCount; start++) {
    if (edges[start] !== EdgeState.Line || seen[start]) continue;
    componentCount++;
    const component: number[] = [];
    let closed = true;
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const e = stack.pop() as number;
      component.push(e);
      for (let k = 0; k < 2; k++) {
        const d = grid.edgeDots[e * 2 + k];
        if (degree[d] !== 2) closed = false;
        for (let j = 0; j < 4; j++) {
          const next = grid.dotEdges[d * 4 + j];
          if (next !== NONE && edges[next] === EdgeState.Line && !seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
    }
    if (closed) closedLoops.push(component);
  }

  const solved = componentCount === 1 && closedLoops.length === 1 && satisfiedClues === clueCount;
  const loopEdges = solved ? [] : closedLoops.flat().sort((a, b) => a - b);

  return {
    violations: { dots, overfullCells, starvedCells, loopEdges },
    solved,
    satisfiedClues,
    clueCount,
  };
}

/** True when at least one of the violation lists is non-empty. */
export function hasViolations(violations: Violations): boolean {
  return (
    violations.dots.length > 0 ||
    violations.overfullCells.length > 0 ||
    violations.starvedCells.length > 0 ||
    violations.loopEdges.length > 0
  );
}
~~~~

### 6.2 `packages/core/src/index.ts` (replace)

~~~~ts
export * from "./analyze.ts";
export * from "./bruteforce.ts";
export * from "./format.ts";
export * from "./grid.ts";
export * from "./puzzle.ts";
~~~~

### 6.3 `packages/core/src/analyze.test.ts` (new)

The last two tests are the key properties: `solved` agrees with brute force over every possible line set on tiny grids, and a board that agrees with a real solution (each edge either unknown or equal to the solution) is never flagged, so only definite violations are reported.

~~~~ts
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { analyzeBoard, hasViolations } from "./analyze.ts";
import { bruteForceSolutions } from "./bruteforce.ts";
import { encodeEdges, parsePuzzle } from "./format.ts";
import { EdgeState, type Grid } from "./grid.ts";
import type { Puzzle } from "./puzzle.ts";
import { arbPuzzleWithSolution } from "./test-support/arbitraries.ts";

// 2×2 grid numbering (see grid.test.ts):
//
//   d0 -0- d1 -1- d2
//   6      7      8
//   d3 -2- d4 -3- d5
//   9      10     11
//   d6 -4- d7 -5- d8
//
// Cell edges: c0 = 0,7,2,6  c1 = 1,8,3,7  c2 = 2,10,4,9  c3 = 3,11,5,10.

const puzzle = (width: number, height: number, clues: string): Puzzle =>
  parsePuzzle({ v: 1, width, height, clues });

function board(grid: Grid, lines: number[], crosses: number[] = []): Uint8Array {
  const edges = new Uint8Array(grid.edgeCount);
  for (const e of lines) edges[e] = EdgeState.Line;
  for (const e of crosses) edges[e] = EdgeState.Cross;
  return edges;
}

const NO_VIOLATIONS = { dots: [], overfullCells: [], starvedCells: [], loopEdges: [] };
const OUTER = [0, 1, 8, 11, 5, 4, 9, 6];
const AROUND_C0 = [0, 7, 2, 6];
const AROUND_C3 = [3, 11, 5, 10];

describe("analyzeBoard", () => {
  test("an empty board has no violations and is not solved", () => {
    const p = puzzle(2, 2, "2...");
    const a = analyzeBoard(p, board(p.grid, []));
    expect(a).toEqual({
      violations: NO_VIOLATIONS,
      solved: false,
      satisfiedClues: 0,
      clueCount: 1,
    });
  });

  test("flags dots with 3 or 4 lines", () => {
    const p = puzzle(2, 2, "....");
    expect(analyzeBoard(p, board(p.grid, [0, 1, 7])).violations.dots).toEqual([1]);
    expect(analyzeBoard(p, board(p.grid, [2, 3, 7, 10])).violations.dots).toEqual([4]);
  });

  test("flags a clue with too many lines", () => {
    const p = puzzle(2, 2, "1...");
    const a = analyzeBoard(p, board(p.grid, [0, 6]));
    expect(a.violations.overfullCells).toEqual([0]);
    expect(a.satisfiedClues).toBe(0);
  });

  test("flags a clue with too many crosses", () => {
    const p = puzzle(2, 2, "3..0");
    expect(analyzeBoard(p, board(p.grid, [], [0, 6])).violations.starvedCells).toEqual([0]);
    expect(analyzeBoard(p, board(p.grid, [], [0])).violations.starvedCells).toEqual([]);
    // A 0 is satisfied by crosses, never starved.
    const a = analyzeBoard(p, board(p.grid, [], AROUND_C3));
    expect(a.violations.starvedCells).toEqual([]);
    expect(a.satisfiedClues).toBe(1);
  });

  test("flags a closed loop that does not satisfy the clues", () => {
    const p = puzzle(2, 2, "2222");
    const a = analyzeBoard(p, board(p.grid, AROUND_C0));
    expect(a.violations.loopEdges).toEqual([0, 2, 6, 7]);
    expect(a.solved).toBe(false);
  });

  test("flags a closed loop when other lines exist", () => {
    const p = puzzle(2, 2, "....");
    const a = analyzeBoard(p, board(p.grid, [...AROUND_C0, 5]));
    expect(a.violations.loopEdges).toEqual([0, 2, 6, 7]);
    expect(a.solved).toBe(false);
  });

  test("flags every closed loop", () => {
    // 3×1: c0 = 0,7,3,6 and c2 = 2,9,5,8.
    const p = puzzle(3, 1, "...");
    const a = analyzeBoard(p, board(p.grid, [0, 7, 3, 6, 2, 9, 5, 8]));
    expect(a.violations.loopEdges).toEqual([0, 2, 3, 5, 6, 7, 8, 9]);
  });

  test("does not flag open paths", () => {
    const p = puzzle(2, 2, "....");
    expect(analyzeBoard(p, board(p.grid, [0, 1, 8]))).toEqual({
      violations: NO_VIOLATIONS,
      solved: false,
      satisfiedClues: 0,
      clueCount: 0,
    });
  });

  test("treats two loops sharing a dot as a dot violation, not a closed loop", () => {
    const p = puzzle(2, 2, "....");
    const a = analyzeBoard(p, board(p.grid, [...AROUND_C0, ...AROUND_C3]));
    expect(a.violations.dots).toEqual([4]);
    expect(a.violations.loopEdges).toEqual([]);
    expect(a.solved).toBe(false);
  });

  test("detects a solved board, with or without crosses", () => {
    const p = puzzle(2, 2, "2222");
    const crossed = analyzeBoard(p, board(p.grid, OUTER, [2, 3, 7, 10]));
    expect(crossed).toEqual({
      violations: NO_VIOLATIONS,
      solved: true,
      satisfiedClues: 4,
      clueCount: 4,
    });
    expect(analyzeBoard(p, board(p.grid, OUTER)).solved).toBe(true);
  });

  test("any single loop solves a puzzle without clues", () => {
    const p = puzzle(1, 1, ".");
    expect(analyzeBoard(p, board(p.grid, [0, 1, 2, 3])).solved).toBe(true);
  });

  test("rejects edge states of the wrong length", () => {
    const p = puzzle(1, 1, ".");
    expect(() => analyzeBoard(p, new Uint8Array(3))).toThrow(RangeError);
  });

  test("finds exactly the 13 loops among all line sets on an empty 2×2", () => {
    const p = puzzle(2, 2, "....");
    let solved = 0;
    for (let mask = 0; mask < 2 ** 12; mask++) {
      const edges = new Uint8Array(12);
      for (let e = 0; e < 12; e++) edges[e] = (mask >>> e) & 1 ? EdgeState.Line : EdgeState.Cross;
      if (analyzeBoard(p, edges).solved) solved++;
    }
    expect(solved).toBe(13);
  });

  test("solved matches brute force over every line set", () => {
    const sizes = fc.constantFrom([1, 1], [1, 2], [2, 1], [1, 3], [3, 1], [2, 2]);
    const clue = fc.oneof(
      { arbitrary: fc.constant("."), weight: 3 },
      { arbitrary: fc.constantFrom("0", "1", "2", "3"), weight: 2 },
    );
    fc.assert(
      fc.property(sizes, fc.array(clue, { minLength: 4, maxLength: 4 }), ([w, h], chars) => {
        const p = puzzle(
          w as number,
          h as number,
          chars.slice(0, (w as number) * (h as number)).join(""),
        );
        const expected = bruteForceSolutions(p, Number.POSITIVE_INFINITY).map(encodeEdges);
        const solved: string[] = [];
        const n = p.grid.edgeCount;
        for (let mask = 0; mask < 2 ** n; mask++) {
          const edges = new Uint8Array(n);
          for (let e = 0; e < n; e++)
            edges[e] = (mask >>> e) & 1 ? EdgeState.Line : EdgeState.Cross;
          if (analyzeBoard(p, edges).solved) solved.push(encodeEdges(edges));
        }
        expect(solved.sort()).toEqual(expected.sort());
      }),
      { numRuns: 40 },
    );
  });

  test("never flags a board that agrees with a solution (FR-15)", () => {
    fc.assert(
      fc.property(
        arbPuzzleWithSolution(4, 4),
        fc.infiniteStream(fc.boolean()),
        ({ puzzle: p, solution }, reveal) => {
          const edges = new Uint8Array(p.grid.edgeCount);
          const shown = reveal.take(edges.length);
          let e = 0;
          for (const r of shown) {
            if (r) edges[e] = solution[e];
            e++;
          }
          expect(hasViolations(analyzeBoard(p, edges).violations)).toBe(false);
          const full = analyzeBoard(p, solution);
          expect(full.solved).toBe(true);
          expect(hasViolations(full.violations)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("hasViolations", () => {
  test("is true when any list is non-empty", () => {
    expect(hasViolations(NO_VIOLATIONS)).toBe(false);
    expect(hasViolations({ ...NO_VIOLATIONS, starvedCells: [3] })).toBe(true);
    expect(hasViolations({ ...NO_VIOLATIONS, loopEdges: [1] })).toBe(true);
  });
});
~~~~

Verify:
```sh
export PATH="$HOME/.bun/bin:$PATH"
bun test packages/core/src/analyze.test.ts   # expect 16 pass, 0 fail
bun run check; echo "rc=$?"                  # expect rc=0, "93 pass", "Ran 93 tests across 5 files"
```

Commit (`git add packages/core/src/analyze.ts packages/core/src/analyze.test.ts packages/core/src/index.ts`): `feat(core): add violation and completion checks`

---

## Step 7 — Seeded PRNG (FR-10)

### 7.1 `packages/core/src/rng.ts` (new)

~~~~ts
/** A deterministic pseudo-random number generator (sfc32 seeded by cyrb128). */
export interface Rng {
  /** A uniform unsigned 32-bit integer. */
  next(): number;
  /** A uniform float in [0, 1). */
  float(): number;
  /** A uniform integer in [0, n). `n` must be a whole number from 1 to 2^32. */
  int(n: number): number;
}

const TWO_POW_32 = 2 ** 32;

/** Hashes a string (by UTF-16 code units) to four unsigned 32-bit words with cyrb128. */
export function hashSeed(seed: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * Creates a generator for a seed string. The same seed always gives the same sequence, on every
 * JavaScript engine. Changing this algorithm changes every seeded result, so treat it as frozen.
 */
export function createRng(seed: string): Rng {
  let [a, b, c, d] = hashSeed(seed);

  function next(): number {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  }

  // Discard the first outputs so similar seeds diverge.
  for (let i = 0; i < 15; i++) next();

  return {
    next,
    float: () => next() / TWO_POW_32,
    int(n: number): number {
      if (!Number.isInteger(n) || n < 1 || n > TWO_POW_32) {
        throw new RangeError(`n must be a whole number from 1 to 2^32, got ${n}`);
      }
      // Reject the top partial block so every result is equally likely.
      const limit = TWO_POW_32 - (TWO_POW_32 % n);
      let x = next();
      while (x >= limit) x = next();
      return x % n;
    },
  };
}
~~~~

### 7.2 `packages/core/src/index.ts` (replace)

~~~~ts
export * from "./analyze.ts";
export * from "./bruteforce.ts";
export * from "./format.ts";
export * from "./grid.ts";
export * from "./puzzle.ts";
export * from "./rng.ts";
~~~~

### 7.3 `packages/core/src/rng.test.ts` (new)

The golden values were produced by this code and cross-checked against the reference cyrb128 and sfc32 implementations for 1000 outputs on five seeds.

~~~~ts
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { createRng, hashSeed } from "./rng.ts";

// Golden values. If one of these changes, every seeded puzzle changes (FR-10): don't update them,
// fix the code.
describe("hashSeed", () => {
  test("matches cyrb128", () => {
    expect(hashSeed("")).toEqual([41608494, 3485963809, 1435736333, 1262568316]);
    expect(hashSeed("a")).toEqual([1589175524, 148824423, 2405369273, 1476957317]);
    expect(hashSeed("loophole")).toEqual([2238043155, 186262874, 2921728731, 3017925730]);
  });
});

describe("createRng", () => {
  const take = (seed: string, n: number) => {
    const rng = createRng(seed);
    return Array.from({ length: n }, () => rng.next());
  };

  test("produces the frozen sequence for a seed", () => {
    expect(take("loophole", 5)).toEqual([677394555, 4278237813, 640741612, 2639088317, 2615015132]);
    expect(take("", 5)).toEqual([2420727049, 3315390910, 31621017, 4095259433, 4180064351]);
    expect(take("日本", 5)).toEqual([647600776, 487772127, 3857602401, 239966375, 873164811]);
  });

  test("float divides next by 2^32", () => {
    const rng = createRng("loophole");
    expect([rng.float(), rng.float(), rng.float()]).toEqual([
      0.1577182102482766, 0.9961048637051135, 0.149184281937778,
    ]);
  });

  test("int gives the frozen sequence", () => {
    const rng = createRng("loophole");
    expect(Array.from({ length: 10 }, () => rng.int(10))).toEqual([5, 3, 2, 7, 2, 6, 9, 2, 3, 5]);
    const full = createRng("loophole");
    expect(full.int(2 ** 32)).toBe(677394555);
    expect(createRng("x").int(1)).toBe(0);
  });

  test("int rejects n outside 1 to 2^32", () => {
    const rng = createRng("x");
    for (const n of [0, -1, 1.5, 2 ** 32 + 1, Number.NaN])
      expect(() => rng.int(n)).toThrow(RangeError);
  });

  test("the same seed repeats and different seeds differ", () => {
    expect(take("a", 20)).toEqual(take("a", 20));
    expect(take("a", 5)).not.toEqual(take("b", 5));
  });

  test("int and float stay in range", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 1000 }), (seed, n) => {
        const rng = createRng(seed);
        for (let i = 0; i < 50; i++) {
          const k = rng.int(n);
          expect(Number.isInteger(k) && k >= 0 && k < n).toBe(true);
          const f = rng.float();
          expect(f >= 0 && f < 1).toBe(true);
        }
      }),
    );
  });
});
~~~~

Verify:
```sh
export PATH="$HOME/.bun/bin:$PATH"
bun test packages/core/src/rng.test.ts   # expect 7 pass, 0 fail
bun run check; echo "rc=$?"              # expect rc=0, "100 pass", "Ran 100 tests across 6 files"
```

Commit (`git add packages/core/src/rng.ts packages/core/src/rng.test.ts packages/core/src/index.ts`): `feat(core): add seeded random number generator`

---

## Step 8 — Docs

### 8.1 `README.md` — four exact replacements

1. In `## Status`, replace this line:
   ~~~~markdown
   Early development. The repo has the build tooling, the local dev services and the design kit. The puzzle engine, server and web app are being built in phases; each phase's plan is in [`docs/plans/`](docs/plans/).
   ~~~~
   with:
   ~~~~markdown
   Early development. The repo has the build tooling, the local dev services, the design kit, and the start of the puzzle engine: the grid model, the wire format, rule checks for play, a brute-force solution counter for tests, and a seeded random number generator. The solver, generator, server and web app are being built in phases; each phase's plan is in [`docs/plans/`](docs/plans/).
   ~~~~
2. In the layout code block, replace
   ~~~~
   packages/core      Puzzle engine shared by server and web (placeholder for now)
   ~~~~
   with
   ~~~~
   packages/core      Puzzle engine shared by server and web
   ~~~~
3. In the layout code block, directly after the line `docs/PRD.md        Product requirements`, add:
   ~~~~
   docs/FORMAT.md     Puzzle and board-state wire format
   ~~~~
4. In `## Docs`, directly after the line `- [Product requirements](docs/PRD.md)`, add:
   ~~~~markdown
   - [Wire format](docs/FORMAT.md)
   ~~~~

### 8.2 `AGENTS.md` (root) — one added line

In `## Further reading`, after the line ``- For requirement ids (FR-n, NFR-n) and product scope, see `docs/PRD.md`.`` add:

~~~~markdown
- The puzzle and board-state wire format, including how cells, dots and edges are numbered, is specified in `docs/FORMAT.md`.
~~~~

### 8.3 `packages/core/AGENTS.md` (replace)

~~~~markdown
# core

The puzzle engine shared by the server and the web app: grid and edge model, wire format, rule checks, solver, verifier and generator.

- It is pure TypeScript with no runtime dependencies, and it has to run unchanged in the browser, on the server and in Bun workers. Keep I/O, DOM, Node and Bun APIs out of `src/`. Tests may use `bun:test`.
- Anything random takes an explicit seed and draws from the core's seeded generator, so results can be reproduced.
- Correctness matters most here. Back solver, verifier and generator behaviour with fast-check property tests (see `docs/TESTING.md`).
- Source files are type-checked without Bun or DOM types, so a stray `Bun.` or `console` fails the typecheck. Tests and the shared test helpers (fast-check arbitraries, fixture puzzles with known solution counts) have their own config that adds Bun's types.
- The brute-force solution counter is the reference that solver and verifier tests compare against. Keep it simple and free of solver code.
~~~~

### 8.4 `docs/DECISIONS.md` — append at the end

Append exactly this (it starts with a blank line):

~~~~markdown

## 2026-10-25 · WT1 `core-model` · Edge numbering
- **Question:** How are cells, dots and edges numbered?
- **Decision:** Row-major cells (`r·W + c`) and dots (`r·(W+1) + c`). One edge index space: all horizontal edges first, row by row (`r·W + c`), then all vertical edges, row by row (`(H+1)·W + r·(W+1) + c`). Adjacency is precomputed in `Int32Array` tables on the grid object, with -1 for "off the board". Specified in `docs/FORMAT.md`.
- **Reason:** It matches the design kit's prototype, the edge-state wire string uses the same order, and flat typed arrays keep the solver's inner loops free of allocation.

## 2026-10-25 · WT1 `core-model` · Puzzle wire format is a JSON object
- **Question:** Should FR-2's wire format be a compact string (like `7x7:...`) or a JSON object?
- **Decision:** A JSON object `{v, width, height, clues, seed?, meta?}`, with `v: 1` required and unknown fields rejected. `meta` is string-to-string, at most 32 entries (keys ≤ 64, values ≤ 1024 characters); `seed` is 1–128 characters. A canonical text form (fixed field order, sorted meta keys, no whitespace) is defined.
- **Reason:** The API and SQLite already speak JSON, the server validates DTOs with zod and can hand the object straight to the core parser, and a version field makes later changes explicit. The size limits cover NFR-4's input validation of uploads.

## 2026-10-25 · WT1 `core-model` · Edge-state encoding
- **Question:** How are board states and solutions stored and sent?
- **Decision:** One character per edge in edge index order: `0` unknown, `1` line, `2` cross. The grid size is not repeated; the string always goes with its puzzle. A later encoding will start with a character other than `0`–`2`.
- **Reason:** Simple to read in tests and to check. A 100×100 board is about 20 KB, which is fine for v1; a compact encoding can come later if saved-progress sync (FR-21) shows it matters.

## 2026-10-25 · WT1 `core-model` · Parse errors throw
- **Question:** Should the parser return a result object or throw, and report one error or all of them?
- **Decision:** `parsePuzzle` throws a `FormatError` with a `path` (the field, such as `clues` or `meta.title`) and a message saying what was expected. It stops at the first problem. Programmer errors in trusted code (bad sizes passed to `createGrid`) throw `RangeError` instead.
- **Reason:** One error with a precise field is enough for an API 400 or an editor message, and throwing keeps the call sites short.

## 2026-10-25 · WT1 `core-model` · Which violations are flagged
- **Question:** FR-15 lists four definite violations. Are others (such as a dot with one line and three crosses) flagged too, and what is highlighted for a closed loop?
- **Decision:** Only the four: dots with 3+ lines, clue cells with more lines than the clue, clue cells whose lines plus unknown sides are fewer than the clue, and closed loops when the board is not solved. For a closed loop every edge of that loop is reported. A figure-eight touching at one dot counts as a dot violation, not a closed loop. Completion ignores crosses: exactly one closed loop of lines and every clue met.
- **Reason:** It follows the PRD and the design kit's error states. A property test checks that no board agreeing with a real solution is ever flagged.

## 2026-10-25 · WT1 `core-model` · Brute force by inside/outside colourings
- **Question:** How should the test oracle for FR-5 enumerate solutions?
- **Decision:** Try all 2^(W·H) inside/outside colourings of the cells, take each colouring's boundary as the line set, and keep the ones that are a single closed loop meeting every clue. Grids are capped at 20 cells (about half a second at the cap).
- **Reason:** Every single loop is the boundary of exactly one inside set, so this finds each solution exactly once with no search logic to get wrong, and it shares nothing with the rule solver. Edge subsets (2^edges) would be far slower.

## 2026-10-25 · WT1 `core-model` · Seeded PRNG
- **Question:** Which deterministic generator should seeds use (FR-10)?
- **Decision:** sfc32, seeded with the cyrb128 hash of the seed string (by UTF-16 code units), discarding the first 15 outputs. `int(n)` uses rejection sampling so it has no modulo bias. Golden-value tests freeze the sequence.
- **Reason:** Small, fast, well-tested in JavaScript, and identical on every engine because it uses only 32-bit integer operations. Changing it would change every seeded puzzle, hence the golden tests.

## 2026-10-25 · WT1 `core-model` · Core sources typecheck without Bun types
- **Question:** The base tsconfig loads Bun's types everywhere, so Bun globals would typecheck in core's runtime code. How is that prevented?
- **Decision:** Core's main tsconfig sets `types: []` and excludes tests and the test-support folder; a second config, `tsconfig.test.json`, checks everything with Bun's types. The package's `typecheck` script runs both.
- **Reason:** The compiler then rejects `Bun`, `console` and DOM globals in shipped core code, with no extra lint rules.
~~~~

Verify:
```sh
export PATH="$HOME/.bun/bin:$PATH"
bun run check; echo "rc=$?"     # expect rc=0, 100 pass
git diff --stat                 # expect README.md, AGENTS.md, packages/core/AGENTS.md, docs/DECISIONS.md only
grep -c '^## 2026-10-25 · WT1' docs/DECISIONS.md   # expect 8
test -L CLAUDE.md && test -L packages/core/CLAUDE.md && echo "symlinks intact"
```

Commit (`git add README.md AGENTS.md packages/core/AGENTS.md docs/DECISIONS.md`): `docs: document core model and record wt1 decisions`

---

## Final checks

```sh
export PATH="$HOME/.bun/bin:$PATH"
git status --short                              # expect clean
git log --oneline main..HEAD                    # expect the 8 commits above (plus the plan commit), in order
bun install --frozen-lockfile; echo "rc=$?"     # expect rc=0
bun run check; echo "rc=$?"                     # expect rc=0, 100 pass, 0 fail
for i in 1 2 3; do bun test 2>&1 | grep -E '^ [0-9]+ fail'; done   # expect " 0 fail" three times (property tests use random seeds)
```

## Acceptance criteria

| # | Criterion | PRD | Checked by |
|---|---|---|---|
| 1 | Grids 1–100 per side; other sizes rejected | FR-1 | `createGrid` and `parsePuzzle` tests |
| 2 | Cell/dot/edge numbering and adjacency tables are correct and mutually consistent | FR-1 | literal 2×2 / 3×1 tests, consistency property on grids up to 8×8, `edgeCoords` round-trip |
| 3 | Clues 0–3 or empty; solution = single closed loop meeting every clue | FR-1 | `analyzeBoard` tests, brute-force agreement property |
| 4 | Wire format: width, height, row-major clue string with `.`, optional seed and meta, versioned, specified in `docs/FORMAT.md` | FR-2 | `format.test.ts` (errors with field paths, canonical JSON, round-trip property), `docs/FORMAT.md` |
| 5 | Edge-state encoding for progress and solutions | FR-2 (supports FR-21, FR-25) | edge encoding tests, `docs/FORMAT.md` |
| 6 | Flags exactly the four definite violations, with the offending dots/cells/edges, and never flags a board consistent with a solution | FR-15 | `analyze.test.ts` unit tests + "never flags" property |
| 7 | Completion: one closed loop and all clues satisfied | FR-17 (client side) | `analyze.test.ts`, "solved matches brute force over every line set" |
| 8 | Brute-force finder is exact on small grids, stops at a limit, refuses > 20 cells | FR-5 (oracle) | empty-grid counts (OEIS), `FIXTURES`, limit tests |
| 9 | Seeded PRNG is deterministic per seed and frozen | FR-10 | golden-value tests |
| 10 | Core runtime code cannot use Bun/DOM globals; CI token is read-only | NFR-3 hygiene | step 2 and step 1 verification |
| 11 | `bun run check` green after every commit | NFR-3 | each step's verification |

## Unresolved questions

- None blocking. Defaults chosen and logged in step 8.4: JSON-object wire format, one-char-per-edge state strings, first-error `FormatError`, only the four PRD violations, 20-cell brute-force cap.
