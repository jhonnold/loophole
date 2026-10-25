/**
 * Writes the large layout and performance fixtures (docs/DECISIONS.md, WT5): for each size, grows and
 * reshapes a random cell region with a seeded generator, takes its boundary as the loop and shows
 * every clue. Output is deterministic. Run from the repo root:
 *
 *   bun apps/web/scripts/large-fixtures.ts && bun run format
 */
import {
  createGrid,
  createRng,
  deriveClues,
  EdgeState,
  encodeEdges,
  type Grid,
} from "@loophole/core";

interface Spec {
  readonly id: string;
  readonly name: string;
  readonly size: number;
}

const SPECS: readonly Spec[] = [
  { id: "large-20", name: "Large", size: 20 },
  { id: "big-30", name: "Big", size: 30 },
  { id: "huge-40", name: "Huge", size: 40 },
  { id: "giant-100", name: "Giant", size: 100 },
];

/**
 * True when moving cell (r, c) into or out of the region keeps the region's boundary one simple
 * loop. Moving it joins the cell to the other side, so among its eight neighbours the other side's
 * cells (off the board counts as outside) must form exactly one run that includes a side
 * neighbour, and none may touch it only at a corner.
 */
function canFlip(inside: Uint8Array, W: number, H: number, r: number, c: number): boolean {
  const other = 1 - inside[r * W + c];
  const at = (rr: number, cc: number) =>
    rr >= 0 && rr < H && cc >= 0 && cc < W ? inside[rr * W + cc] === other : other === 0;
  // Clockwise from the top: N, NE, E, SE, S, SW, W, NW.
  const ring = [
    at(r - 1, c),
    at(r - 1, c + 1),
    at(r, c + 1),
    at(r + 1, c + 1),
    at(r + 1, c),
    at(r + 1, c - 1),
    at(r, c - 1),
    at(r - 1, c - 1),
  ];
  for (let i = 1; i < 8; i += 2) {
    if (ring[i] && !ring[i - 1] && !ring[(i + 1) % 8]) return false;
  }
  if (!ring[0] && !ring[2] && !ring[4] && !ring[6]) return false;
  let runs = 0;
  for (let i = 0; i < 8; i++) if (ring[i] && !ring[(i + 7) % 8]) runs++;
  return runs === 1;
}

function loopEdges(grid: Grid, inside: Uint8Array): Uint8Array {
  const edges = new Uint8Array(grid.edgeCount).fill(EdgeState.Cross);
  for (let e = 0; e < grid.edgeCount; e++) {
    const a = grid.edgeCells[e * 2];
    const b = grid.edgeCells[e * 2 + 1];
    const ia = a >= 0 ? inside[a] : 0;
    const ib = b >= 0 ? inside[b] : 0;
    if (ia !== ib) edges[e] = EdgeState.Line;
  }
  return edges;
}

function make(spec: Spec) {
  const W = spec.size;
  const H = spec.size;
  const grid = createGrid(W, H);
  const rng = createRng(`loophole-fixture-${spec.id}`);
  const inside = new Uint8Array(W * H);
  inside[Math.floor(H / 2) * W + Math.floor(W / 2)] = 1;
  let count = 1;
  // Grow to half the board, then keep adding and removing random boundary cells while between 40%
  // and 60% of the board is inside, so the loop wanders over the whole board.
  for (let step = 0; step < W * H * 60; step++) {
    const cell = rng.int(W * H);
    const adding = inside[cell] === 0;
    const grown = step >= W * H * 20;
    if (adding ? count >= W * H * (grown ? 0.6 : 0.5) : !grown || count <= W * H * 0.4) continue;
    if (!canFlip(inside, W, H, Math.floor(cell / W), cell % W)) continue;
    inside[cell] = adding ? 1 : 0;
    count += adding ? 1 : -1;
  }
  const edges = loopEdges(grid, inside);
  const clues = Array.from(deriveClues(grid, edges), (n) => String(n)).join("");
  return { spec, clues, solution: encodeEdges(edges) };
}

const made = SPECS.map(make);

const fixtures = `import type { FixtureRecord } from "./fixtures.ts";

/**
 * Large layout and performance fixtures, written by \`apps/web/scripts/large-fixtures.ts\`: each is
 * the boundary of a random region with every clue shown. Do not edit by hand.
 */
export const LARGE_FIXTURES: readonly FixtureRecord[] = [
${made
  .map(
    (m) => `  {
    id: "${m.spec.id}",
    name: "${m.spec.name}",
    subtitle: "Practice · 練習",
    wire: {
      v: 1,
      width: ${m.spec.size},
      height: ${m.spec.size},
      clues:
        "${m.clues}",
    },
  },`,
  )
  .join("\n")}
];
`;

const solutions = `/**
 * Solutions of the large fixtures, written by \`apps/web/scripts/large-fixtures.ts\`. Tests only.
 */
export const LARGE_SOLUTIONS: Readonly<Record<string, string>> = {
${made.map((m) => `  "${m.spec.id}":\n    "${m.solution}",`).join("\n")}
};
`;

await Bun.write("apps/web/src/lib/puzzles/large-fixtures.ts", fixtures);
await Bun.write("apps/web/src/lib/test-support/large-solutions.ts", solutions);
console.log(made.map((m) => `${m.spec.id}: ${m.clues.length} clues`).join("\n"));
