<script lang="ts">
  import { type BoardAnalysis, EdgeState, NO_CLUE, type Puzzle } from "@loophole/core";
  import { cellPoint, dotPoint, edgeMidpoint, edgeSegment, type Layout, markSizes } from "../game/geometry.ts";
  import type { HintMarks } from "../game/hint.ts";
  import { insideCells } from "../game/inside.ts";
  import type { Size, View } from "../game/viewport.ts";

  interface Props {
    puzzle: Puzzle;
    edges: Uint8Array;
    analysis: BoardAnalysis;
    /** The whole board at the current cell size. */
    layout: Layout;
    view: View;
    port: Size;
    /** The hint on show: an ai wash on its cells and dots, and its move as a dashed ghost. */
    hint: HintMarks | null;
  }

  let { puzzle, edges, analysis, layout, view, port, hint }: Props = $props();

  const grid = $derived(puzzle.grid);

  // The marks are laid out at `drawn`, the cell size the zoom last settled on, with no margin. While
  // the zoom changes, a transform scales them to the live size; 150ms after it stops they are laid
  // out again at the new size, so line and dot sizes match the design kit and the SVG is not
  // rebuilt on every frame of a pinch.
  // svelte-ignore state_referenced_locally
  let drawn = $state(layout.cell);
  $effect(() => {
    const cell = layout.cell;
    if (cell === drawn) return;
    const t = setTimeout(() => {
      drawn = cell;
    }, 150);
    return () => clearTimeout(t);
  });

  const geo: Layout = $derived({
    cell: drawn,
    margin: 0,
    width: grid.width * drawn,
    height: grid.height * drawn,
  });
  const S = $derived(drawn);
  const size = $derived(markSizes(drawn));
  const transform = $derived(
    `translate(${layout.margin - view.x} ${layout.margin - view.y}) scale(${layout.cell / drawn})`,
  );

  const dots = $derived(Array.from({ length: grid.dotCount }, (_, d) => dotPoint(grid, geo, d)));
  const clues = $derived.by(() => {
    const out: { cell: number; x: number; y: number; text: string }[] = [];
    for (let i = 0; i < grid.cellCount; i++) {
      if (puzzle.clues[i] === NO_CLUE) continue;
      const p = cellPoint(grid, geo, i);
      out.push({ cell: i, x: p.x, y: p.y, text: String(puzzle.clues[i]) });
    }
    return out;
  });

  const v = $derived(analysis.violations);
  const badCells = $derived(new Set([...v.overfullCells, ...v.starvedCells]));
  const loopEdges = $derived(new Set(v.loopEdges));
  const lines = $derived(Array.from(edges.keys()).filter((e) => edges[e] === EdgeState.Line));
  const crosses = $derived(Array.from(edges.keys()).filter((e) => edges[e] === EdgeState.Cross));
  const inside = $derived(analysis.solved ? insideCells(grid, edges) : null);
  const hintCells = $derived(new Set(hint?.cells ?? []));
  // Ghosts only on edges that are still empty, as on the Hint artboard.
  const ghosts = $derived((hint?.ghosts ?? []).filter(([e]) => edges[e] === EdgeState.Unknown));
</script>

<svg class="board-svg" width={port.width} height={port.height} aria-hidden="true">
  <g {transform}>
    {#if inside}
      {#each inside as isIn, i (i)}
        {#if isIn}
          {@const p = cellPoint(grid, geo, i)}
          <rect class="wash" x={p.x - S / 2} y={p.y - S / 2} width={S} height={S} />
        {/if}
      {/each}
    {/if}

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

    {#each lines as e (e)}
      {@const s = edgeSegment(grid, geo, e)}
      <line
        class="line"
        class:loop={loopEdges.has(e)}
        x1={s.x1}
        y1={s.y1}
        x2={s.x2}
        y2={s.y2}
        stroke-width={size.line}
      />
    {/each}

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

    {#each crosses as e (e)}
      {@const { x, y } = edgeMidpoint(grid, geo, e)}
      {@const a = size.crossArm}
      <path
        class="cross"
        d="M{x - a} {y - a}L{x + a} {y + a}M{x + a} {y - a}L{x - a} {y + a}"
        stroke-width={size.crossWidth}
      />
    {/each}

    {#each dots as p, d (d)}
      <circle class="dot" cx={p.x} cy={p.y} r={size.dotRadius} />
    {/each}

    {#each clues as q (q.cell)}
      <text
        class="clue"
        class:bad={badCells.has(q.cell)}
        class:hinted={hintCells.has(q.cell)}
        x={q.x}
        y={q.y}
        font-size={size.clue}>{q.text}</text
      >
      {#if badCells.has(q.cell)}
        <circle class="ring" cx={q.x} cy={q.y} r={size.clueRing} />
      {/if}
    {/each}

    {#each v.dots as d (d)}
      {@const p = dotPoint(grid, geo, d)}
      <circle class="ring" cx={p.x} cy={p.y} r={size.dotRing} />
    {/each}
  </g>
</svg>

<style>
  svg {
    display: block;
  }

  .wash {
    fill: var(--solved-wash);
  }

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

  .line {
    stroke: var(--ink);
    stroke-linecap: round;
  }

  .line.loop {
    stroke: var(--shu);
    stroke-linecap: butt;
    stroke-dasharray: 6 5;
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

  .clue.bad {
    fill: var(--shu);
  }

  .ring {
    fill: none;
    stroke: var(--shu);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
</style>
