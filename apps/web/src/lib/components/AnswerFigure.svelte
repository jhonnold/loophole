<script lang="ts">
  import { EdgeState, type Grid } from "@loophole/core";
  import { cellPoint, dotPoint, edgeSegment, type Layout } from "../game/geometry.ts";

  interface Props {
    grid: Grid;
    /** One answer, as edge states. */
    edges: Uint8Array;
    /** A cell to mark with a dashed ai box, or null. */
    highlight: number | null;
    name: string;
  }

  let { grid, edges, highlight, name }: Props = $props();

  // The Editor artboard's small answer boards: 133px square, lines and dots, no clues.
  const BOX = 133;
  const layout: Layout = $derived.by(() => {
    const margin = 7;
    const cell = (BOX - 2 * margin) / Math.max(grid.width, grid.height);
    return { cell, margin, width: grid.width * cell + 2 * margin, height: grid.height * cell + 2 * margin };
  });
  const line = $derived(Math.max(1, Math.min(2.5, layout.cell * 0.15)));
  const lines = $derived.by(() => {
    let d = "";
    for (let e = 0; e < grid.edgeCount; e++) {
      if (edges[e] !== EdgeState.Line) continue;
      const s = edgeSegment(grid, layout, e);
      d += `M${s.x1} ${s.y1}L${s.x2} ${s.y2}`;
    }
    return d;
  });
  // Dots only while they stay apart.
  const dots = $derived.by(() => {
    if (layout.cell < 6) return [];
    return Array.from({ length: grid.dotCount }, (_, d) => dotPoint(grid, layout, d));
  });
  const mark = $derived(highlight === null ? null : cellPoint(grid, layout, highlight));
</script>

<figure>
  <svg width={layout.width} height={layout.height} aria-hidden="true">
    {#if mark}
      <rect
        class="mark"
        x={mark.x - layout.cell / 2 + 1}
        y={mark.y - layout.cell / 2 + 1}
        width={layout.cell - 2}
        height={layout.cell - 2}
        rx="2"
      />
    {/if}
    <path class="line" d={lines} stroke-width={line} />
    {#each dots as p, i (i)}
      <circle class="dot" cx={p.x} cy={p.y} r={Math.max(1, layout.cell * 0.05)} />
    {/each}
  </svg>
  <figcaption>{name}</figcaption>
</figure>

<style>
  figure {
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }

  svg {
    display: block;
    background: var(--ground);
    border: 1.5px solid var(--hairline);
  }

  .line {
    fill: none;
    stroke: var(--ink);
    stroke-linecap: round;
  }

  .dot {
    fill: var(--ink);
  }

  .mark {
    fill: var(--hint-wash);
    stroke: var(--ai);
    stroke-width: 1.5;
    stroke-dasharray: 3 2;
  }

  figcaption {
    font-size: 13px;
    font-weight: 700;
  }
</style>
