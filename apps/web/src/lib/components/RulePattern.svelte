<script lang="ts">
  import { analyzeBoard } from "@loophole/core";
  import type { Layout } from "../game/geometry.ts";
  import type { RulePattern } from "../game/patterns.ts";
  import BoardSvg from "./BoardSvg.svelte";

  interface Props {
    pattern: RulePattern;
    /** The square's side in pixels; the hint card's is 72 (Hint artboard). */
    size?: number;
  }

  let { pattern, size = 72 }: Props = $props();

  // The Hint artboard's figure: a square, the pattern drawn by the board renderer and centred with
  // at least 8px around it at 72px (14px for a single cell), and as much more as the square is.
  const BOX = $derived(size);
  const grid = $derived(pattern.puzzle.grid);
  const longest = $derived(Math.max(grid.width, grid.height));
  const cell = $derived((BOX - (2 * (longest === 1 ? 14 : 8) * BOX) / 72) / longest);
  const layout: Layout = $derived({ cell, margin: 0, width: grid.width * cell, height: grid.height * cell });
  const view = $derived({ cell, x: (layout.width - BOX) / 2, y: (layout.height - BOX) / 2 });
  const analysis = $derived(analyzeBoard(pattern.puzzle, pattern.edges));
</script>

<svg width={BOX} height={BOX} viewBox="0 0 {BOX} {BOX}" aria-hidden="true">
  <rect class="paper" width={BOX} height={BOX} rx="6" />
  <BoardSvg
    puzzle={pattern.puzzle}
    edges={pattern.edges}
    {analysis}
    {layout}
    {view}
    port={{ width: BOX, height: BOX }}
    hint={pattern.marks}
  />
</svg>

<style>
  svg {
    display: block;
  }

  .paper {
    fill: var(--ground);
  }
</style>
