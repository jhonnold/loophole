<script lang="ts">
  import { EdgeState, NO_CLUE } from "@loophole/core";
  import { cellPoint, dotPoint, edgeMidpoint, edgeSegment, type Layout, markSizes } from "../game/geometry.ts";
  import type { RulePattern } from "../game/patterns.ts";

  interface Props {
    pattern: RulePattern;
  }

  let { pattern }: Props = $props();

  // The Hint artboard's figure: a 72px square, the pattern centred with at least 8px around it
  // (14px for a single cell).
  const BOX = 72;
  const grid = $derived(pattern.puzzle.grid);
  const longest = $derived(Math.max(grid.width, grid.height));
  const cell = $derived((BOX - 2 * (longest === 1 ? 14 : 8)) / longest);
  const geo: Layout = $derived({ cell, margin: 0, width: grid.width * cell, height: grid.height * cell });
  const offset = $derived(`translate(${(BOX - geo.width) / 2} ${(BOX - geo.height) / 2})`);
  const size = $derived(markSizes(cell));
  const edgeList = $derived(Array.from(pattern.edges.keys()));
  const hinted = $derived(new Set(pattern.marks.cells));
</script>

<svg width={BOX} height={BOX} viewBox="0 0 {BOX} {BOX}" aria-hidden="true">
  <rect class="paper" width={BOX} height={BOX} rx="6" />
  <g transform={offset}>
    {#each pattern.marks.cells as i (i)}
      {@const p = cellPoint(grid, geo, i)}
      <rect class="wash" x={p.x - cell / 2 + 2} y={p.y - cell / 2 + 2} width={cell - 4} height={cell - 4} rx="3" />
    {/each}
    {#each pattern.marks.dots as d (d)}
      {@const p = dotPoint(grid, geo, d)}
      <circle class="wash" cx={p.x} cy={p.y} r={cell * 0.3} />
    {/each}
    {#each edgeList as e (e)}
      {#if pattern.edges[e] === EdgeState.Line}
        {@const s = edgeSegment(grid, geo, e)}
        <line class="line" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke-width={size.line} />
      {/if}
    {/each}
    {#each pattern.marks.ghosts as [e, state] (e)}
      {#if state === EdgeState.Line}
        {@const s = edgeSegment(grid, geo, e)}
        <line class="ghost" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke-width={size.line} />
      {:else}
        {@const { x, y } = edgeMidpoint(grid, geo, e)}
        {@const a = size.crossArm}
        <path class="ghost-cross" d="M{x - a} {y - a}L{x + a} {y + a}M{x + a} {y - a}L{x - a} {y + a}" stroke-width={size.crossWidth * 1.6} />
      {/if}
    {/each}
    {#each edgeList as e (e)}
      {#if pattern.edges[e] === EdgeState.Cross}
        {@const { x, y } = edgeMidpoint(grid, geo, e)}
        {@const a = size.crossArm}
        <path class="cross" d="M{x - a} {y - a}L{x + a} {y + a}M{x + a} {y - a}L{x - a} {y + a}" stroke-width={size.crossWidth} />
      {/if}
    {/each}
    {#each { length: grid.dotCount } as _, d (d)}
      {@const p = dotPoint(grid, geo, d)}
      <circle class="dot" cx={p.x} cy={p.y} r={size.dotRadius} />
    {/each}
    {#each { length: grid.cellCount } as _, i (i)}
      {#if pattern.puzzle.clues[i] !== NO_CLUE}
        {@const p = cellPoint(grid, geo, i)}
        <text class="clue" class:hinted={hinted.has(i)} x={p.x} y={p.y} font-size={size.clue}>{pattern.puzzle.clues[i]}</text>
      {/if}
    {/each}
  </g>
</svg>

<style>
  svg {
    display: block;
  }

  .paper {
    fill: var(--ground);
  }

  .wash {
    fill: var(--hint-wash);
  }

  .line {
    stroke: var(--ink);
    stroke-linecap: round;
  }

  .ghost {
    stroke: var(--ai);
    stroke-dasharray: 4 3;
  }

  .ghost-cross {
    stroke: var(--ai);
    stroke-linecap: round;
    fill: none;
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
</style>
