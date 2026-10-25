<script lang="ts">
  import { EdgeState, NO_CLUE, type Puzzle } from "@loophole/core";
  import { cellPoint, dotPoint, edgeSegment, type Layout } from "../game/geometry.ts";
  import { insideCells } from "../game/inside.ts";

  interface Props {
    puzzle: Puzzle;
    /** The solved board, as edge states. */
    edges: Uint8Array;
  }

  let { puzzle, edges }: Props = $props();

  // The Solved artboard's board: 212px square with a 15px margin, the inside washed, clues and dots
  // while the cells are big enough to show them.
  const BOX = 212;
  const grid = $derived(puzzle.grid);
  const layout: Layout = $derived.by(() => {
    const margin = 15;
    const cell = (BOX - 2 * margin) / Math.max(grid.width, grid.height);
    return { cell, margin, width: grid.width * cell + 2 * margin, height: grid.height * cell + 2 * margin };
  });
  const line = $derived(Math.max(1, Math.min(3.5, layout.cell * 0.13)));
  const inside = $derived(insideCells(grid, edges));
  const lines = $derived.by(() => {
    let d = "";
    for (let e = 0; e < grid.edgeCount; e++) {
      if (edges[e] !== EdgeState.Line) continue;
      const s = edgeSegment(grid, layout, e);
      d += `M${s.x1} ${s.y1}L${s.x2} ${s.y2}`;
    }
    return d;
  });
  const washes = $derived(
    Array.from({ length: grid.cellCount }, (_, c) => c).filter((c) => inside[c] === 1),
  );
  const clues = $derived(
    layout.cell < 10
      ? []
      : Array.from({ length: grid.cellCount }, (_, c) => c).filter((c) => puzzle.clues[c] !== NO_CLUE),
  );
  const dots = $derived(
    layout.cell < 6 ? [] : Array.from({ length: grid.dotCount }, (_, d) => dotPoint(grid, layout, d)),
  );
</script>

<svg class="solved-board" width={BOX} height={BOX} viewBox="0 0 {BOX} {BOX}" role="img" aria-label="Your solved board">
  {#each washes as c (c)}
    {@const p = cellPoint(grid, layout, c)}
    <rect class="wash" x={p.x - layout.cell / 2} y={p.y - layout.cell / 2} width={layout.cell} height={layout.cell} />
  {/each}
  <path class="line" d={lines} stroke-width={line} />
  {#each dots as p, i (i)}
    <circle class="dot" cx={p.x} cy={p.y} r={Math.max(1, layout.cell * 0.055)} />
  {/each}
  {#each clues as c (c)}
    {@const p = cellPoint(grid, layout, c)}
    <text class="clue" x={p.x} y={p.y} font-size={layout.cell * 0.56}>{puzzle.clues[c]}</text>
  {/each}
</svg>

<style>
  .solved-board {
    display: block;
    flex: 0 0 auto;
    background: var(--sheet);
    border: 2px solid var(--ink);
    box-shadow: 4px 4px 0 var(--frame-shadow);
  }

  .wash {
    fill: var(--solved-wash);
  }

  .line {
    fill: none;
    stroke: var(--ink);
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .dot {
    fill: var(--ink);
  }

  .clue {
    fill: var(--ink);
    font-weight: 500;
    text-anchor: middle;
    dominant-baseline: central;
  }
</style>
