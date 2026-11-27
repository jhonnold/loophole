<script lang="ts">
  import { type BoardAnalysis, EdgeState, NO_CLUE, type Puzzle } from "@loophole/core";
  import { cellPoint, dotPoint, edgeMidpoint, edgeSegment, type Layout, markSizes } from "../game/geometry.ts";
  import type { HintMarks } from "../game/hint.ts";
  import { insideCells } from "../game/inside.ts";
  import { hatched, hatchSegments, mirrored, tintSquare } from "../game/sides.ts";
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
  // A try-and-see hint's supposed marks, and where they break the rules.
  const whatIf = $derived((hint?.whatIf ?? []).filter(([e]) => edges[e] === EdgeState.Unknown));
  const conflict = $derived(hint?.conflict);
  // A parity or colouring step's cells by side, and the marks its chains run along.
  const sideCells = $derived(hint?.sides?.cells ?? []);
  const sideEdges = $derived(hint?.sides?.edges ?? []);
  const tinted = $derived(new Set(sideCells.map((t) => t.cell)));
  const hatch = (x: number, y: number, s: number, mirror = false) =>
    hatchSegments(x, y, s, S / 5, mirror)
      .map(([a, b, c, d]) => `M${a} ${b}L${c} ${d}`)
      .join("");
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

    {#each sideCells as t (t.cell)}
      {@const p = cellPoint(grid, geo, t.cell)}
      {@const q = tintSquare(p.x, p.y, S, t.strong)}
      <rect class="side side-{t.tone}" x={q.x} y={q.y} width={q.size} height={q.size} rx="3" />
      {#if hatched(t.tone)}
        <path class="side-hatch" d={hatch(q.x, q.y, q.size, mirrored(t.tone))} stroke-width={Math.max(1, S / 24)} />
      {/if}
    {/each}
    {#each sideEdges as e (e)}
      {@const s = edgeSegment(grid, geo, e)}
      <line class="side-chain" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke-width={size.line * 3.5} />
    {/each}

    {#if hint}
      {#each hint.cells.filter((i) => !tinted.has(i)) as i (i)}
        {@const p = cellPoint(grid, geo, i)}
        <rect class="hint-wash" x={p.x - S / 2 + 2} y={p.y - S / 2 + 2} width={S - 4} height={S - 4} rx="3" />
      {/each}
      {#each hint.dots as d (d)}
        {@const p = dotPoint(grid, geo, d)}
        <circle class="hint-wash" cx={p.x} cy={p.y} r={S * 0.3} />
      {/each}
    {/if}

    {#if conflict}
      {#each conflict.cells as i (i)}
        {@const p = cellPoint(grid, geo, i)}
        <rect class="conflict-wash" x={p.x - S / 2 + 2} y={p.y - S / 2 + 2} width={S - 4} height={S - 4} rx="3" />
      {/each}
      {#each conflict.dots as d (d)}
        {@const p = dotPoint(grid, geo, d)}
        <circle class="conflict-wash" cx={p.x} cy={p.y} r={S * 0.3} />
      {/each}
      {#each conflict.edges as e (e)}
        {@const s = edgeSegment(grid, geo, e)}
        <line class="conflict-edge" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke-width={size.line * 3} />
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

    {#each whatIf as [e, state] (e)}
      {#if state === EdgeState.Line}
        {@const s = edgeSegment(grid, geo, e)}
        <line
          class="what-if"
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          stroke-width={size.line}
          stroke-dasharray="0.1 {size.line * 2.2}"
        />
      {:else}
        {@const { x, y } = edgeMidpoint(grid, geo, e)}
        {@const a = size.crossArm}
        <path
          class="what-if-cross"
          d="M{x - a} {y - a}L{x + a} {y + a}M{x + a} {y - a}L{x - a} {y + a}"
          stroke-width={size.crossWidth * 1.3}
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

  .side-in {
    fill: var(--side-in);
  }

  .side-out {
    fill: var(--side-out);
  }

  .side-a,
  .side-b {
    fill: var(--side-rel);
  }

  .side-hatch {
    stroke: var(--side-hatch);
    stroke-linecap: butt;
    fill: none;
  }

  /* The marks a hint's side chains run along: a soft ai band under the mark. */
  .side-chain {
    stroke: var(--side-chain);
    stroke-linecap: round;
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

  /* Supposed marks: dotted and fainter than the real move's dashes. */
  .what-if {
    stroke: var(--what-if);
    stroke-linecap: round;
  }

  .what-if-cross {
    stroke: var(--what-if);
    stroke-linecap: round;
    fill: none;
  }

  .conflict-wash {
    fill: var(--conflict-wash);
  }

  .conflict-edge {
    stroke: var(--conflict-wash);
    stroke-linecap: round;
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
