/**
 * Verification benchmark (not part of `bun run check`). Run: `bun run --cwd packages/core bench`.
 *
 * Puzzles from random loops (`src/test-support/loops.ts`):
 * - "full": every clue kept. The rules solve these outright.
 * - "70%": a random 30% of clues blanked. Often several solutions, so the search runs.
 * - "minimal": clues removed in random order while the rule solver still solves the puzzle.
 *   Needs lookahead. Building these takes a few seconds at 30×30, so 100×100 is left out.
 * Harder cases (DECISIONS, WT19), checked with at most `HARD_NODES` search nodes so a run takes
 * minutes, not hours (a board that needs more comes back `unknown`):
 * - "corpus": the clue-gap corpus (`clue-gaps.json`): unique, the rules alone get stuck.
 * - "empty" and "draft": what the editor checks while a puzzle is drawn, an empty grid and a
 *   windy loop (`generateLoop`) with 30% of its clues. Many solutions.
 * - "generated −1" and "generated −2": `generate`'s puzzles with one or two random clues taken
 *   out. Near-unique: the search runs long before it finds a second solution, or proves there is
 *   none.
 * Prints the time per `verify` call, how often each status came back and the search nodes in all.
 */
import { generate } from "../src/generate.ts";
import { createGrid, type Grid } from "../src/grid.ts";
import { generateLoop } from "../src/loop.ts";
import { createPuzzle, NO_CLUE, type Puzzle } from "../src/puzzle.ts";
import { createRng, type Rng } from "../src/rng.ts";
import { solve } from "../src/solver.ts";
import { clueGapCorpus } from "../src/test-support/clue-gaps.ts";
import { puzzleFromLoop, randomLoop } from "../src/test-support/loops.ts";
import { type VerifyOptions, verify } from "../src/verify.ts";

/** The node budget of the harder cases. */
const HARD_NODES = 50_000;

type Make = (grid: Grid, rng: Rng, n: number) => Puzzle;

const full: Make = (grid, rng) => puzzleFromLoop(grid, randomLoop(grid, rng), rng);
const partial: Make = (grid, rng) => puzzleFromLoop(grid, randomLoop(grid, rng), rng, 0.7);
const minimal: Make = (grid, rng) => {
  const clues = Array.from(full(grid, rng, 0).clues);
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
const corpus = clueGapCorpus();
const gap: Make = (_grid, _rng, n) => corpus[n].puzzle;
const empty: Make = (grid) => createPuzzle(grid.width, grid.height);
const draft: Make = (grid, rng) => puzzleFromLoop(grid, generateLoop(grid, rng), rng, 0.3);
/** A generated puzzle with `drop` of its clues, picked at random, taken out. */
const generated =
  (drop: number): Make =>
  (grid, rng, n) => {
    const { width, height } = grid;
    const { puzzle } = generate({ width, height, seed: `bench-${width}-${n}` });
    const clues = Array.from(puzzle.clues);
    const kept = clues.flatMap((k, i) => (k === NO_CLUE ? [] : [i]));
    for (let d = 0; d < drop; d++) clues[kept.splice(rng.int(kept.length), 1)[0]] = NO_CLUE;
    return createPuzzle(width, height, clues);
  };

const HARD: VerifyOptions = { maxNodes: HARD_NODES };
const CASES: { label: string; make: Make; size: number; count: number; options?: VerifyOptions }[] =
  [
    { label: "full", make: full, size: 10, count: 50 },
    { label: "full", make: full, size: 30, count: 20 },
    { label: "full", make: full, size: 100, count: 5 },
    { label: "70%", make: partial, size: 10, count: 50 },
    { label: "70%", make: partial, size: 30, count: 20 },
    { label: "70%", make: partial, size: 100, count: 5 },
    { label: "minimal", make: minimal, size: 10, count: 20 },
    { label: "minimal", make: minimal, size: 30, count: 3 },
    { label: "corpus", make: gap, size: 0, count: corpus.length, options: HARD },
    { label: "empty", make: empty, size: 10, count: 1, options: HARD },
    { label: "empty", make: empty, size: 30, count: 1, options: HARD },
    { label: "draft", make: draft, size: 10, count: 10, options: HARD },
    { label: "draft", make: draft, size: 15, count: 10, options: HARD },
    { label: "generated −1", make: generated(1), size: 10, count: 10, options: HARD },
    { label: "generated −1", make: generated(1), size: 15, count: 10, options: HARD },
    { label: "generated −1", make: generated(1), size: 20, count: 10, options: HARD },
    { label: "generated −1", make: generated(1), size: 30, count: 3, options: HARD },
    { label: "generated −2", make: generated(2), size: 10, count: 10, options: HARD },
    { label: "generated −2", make: generated(2), size: 15, count: 10, options: HARD },
    { label: "generated −2", make: generated(2), size: 20, count: 10, options: HARD },
    { label: "generated −2", make: generated(2), size: 30, count: 3, options: HARD },
  ];

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

for (const { label, make, size, count, options } of CASES) {
  // The corpus brings its own grids (size 0): this one goes unused.
  const grid = createGrid(Math.max(size, 1), Math.max(size, 1));
  const times: number[] = [];
  const statuses: Record<string, number> = {};
  let clues = 0;
  let cells = 0;
  let nodes = 0;
  for (let n = 0; n < count; n++) {
    const puzzle = make(grid, createRng(`bench-${label}-${size}-${n}`), n);
    clues += puzzle.clues.filter((k) => k !== NO_CLUE).length;
    cells += puzzle.clues.length;
    const t0 = performance.now();
    const result = verify(puzzle, options);
    times.push(performance.now() - t0);
    statuses[result.status] = (statuses[result.status] ?? 0) + 1;
    nodes += result.stats.nodes;
  }
  times.sort((a, b) => a - b);
  const name = size === 0 ? label : `${size}×${size} ${label}`;
  console.log(
    `${name}: n=${count} clues=${Math.round((100 * clues) / cells)}% ` +
      `median=${percentile(times, 0.5).toFixed(1)}ms p95=${percentile(times, 0.95).toFixed(1)}ms ` +
      `max=${times[times.length - 1].toFixed(1)}ms statuses=${JSON.stringify(statuses)} nodes=${nodes}`,
  );
}
