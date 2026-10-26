/**
 * Clue-gap benchmark (not part of `bun run check`). Run: `bun run --cwd packages/core bench:clue-gaps`.
 *
 * Measures how far today's rule solver is from what uniqueness alone allows, on generated puzzles
 * (DECISIONS, WT14). For each size it generates puzzles and prints one line:
 * - `clues`: share of cells that keep a clue. `restored`: share of cells whose clue `generate`
 *   put back in its safeguard step (`stats.restored`; 0 since WT15).
 * - Each kept clue taken out alone: `removable` (the rules still solve the puzzle), `gap` (still
 *   one solution, but the rules get stuck: a solver gap), `needed` (no longer one solution) and
 *   `unknown` (the verifier's node budget ran out). Shares of the kept clues.
 * - `solver-floor`: clues left after taking clues out one at a time in seeded random order while
 *   the rules still solve the whole puzzle. What today's solver allows with a whole-board removal.
 * - `verify-floor`: the same, keeping a removal while `verify` says `unique`. What a perfect solver
 *   would allow (an estimate: one greedy order, and a removal whose check runs out of nodes is not
 *   made). Too slow above 15×15, so left out there.
 * Everything is seeded and uses node budgets, never time, so every run prints the same numbers
 * apart from the times. Takes about 3 minutes.
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
import { CLUE_GAP_VERIFY_OPTIONS, type ClueGapEntry } from "../src/test-support/clue-gaps.ts";
import { verify } from "../src/verify.ts";

/** Board side, puzzles per size, and whether to estimate the verifier floor. */
const SIZES: [number, number, boolean][] = [
  [5, 100, true],
  [7, 100, true],
  [10, 50, true],
  [15, 10, true],
  [20, 10, false],
];
/** Corpus: gap cases per size, from these sizes, at most this many from one puzzle. */
const CORPUS_PER_SIZE = 12;
const CORPUS_SIZES = [5, 7, 10];
const CORPUS_PER_PUZZLE = 2;
const CORPUS_FILE = new URL("../src/test-support/clue-gaps.json", import.meta.url);

/**
 * The one place the harness runs the rule solver. When `solve` takes a rule set (the rules
 * work after the clue-removal rework), pass it here to measure that subset.
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
  let restored = 0;
  const classes = { removable: 0, gap: 0, needed: 0, unknown: 0 };
  let solverFloor = 0;
  let verifyFloor = 0;
  let floorUnknown = 0;
  let sizeCorpus = 0;
  for (let n = 0; n < count; n++) {
    const seed = `clue-gaps-${size}-${n}`;
    const { puzzle, stats } = generate({ width: size, height: size, seed });
    const { grid } = puzzle;
    cells += grid.cellCount;
    restored += stats.restored;
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
      const status =
        result.status === "solved" ? "solved" : verify(without, CLUE_GAP_VERIFY_OPTIONS).status;
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
        const status = verify(p, CLUE_GAP_VERIFY_OPTIONS).status;
        if (status === "unknown") floorUnknown++;
        return status === "unique";
      });
    }
  }
  const seconds = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(
    `clue-gaps ${size}×${size}: n=${count} clues=${pct(kept, cells)} restored=${pct(restored, cells)} ` +
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
