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
