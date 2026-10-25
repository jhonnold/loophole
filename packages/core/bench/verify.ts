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
