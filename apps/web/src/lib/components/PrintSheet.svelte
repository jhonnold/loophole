<script lang="ts">
  import { NO_CLUE } from "@loophole/core";
  import { cellPoint, dotPoint, type Layout, markSizes } from "../game/geometry.ts";
  import { type PuzzleEntry, puzzleSubtitle, puzzleTitle } from "../puzzles/index.ts";

  interface Props {
    entry: PuzzleEntry;
  }

  let { entry }: Props = $props();

  // The blank puzzle for paper: dots and clues only, black on white whatever the theme. The play
  // screen mounts it straight under <body> the first time the player prints, and app.css hides
  // everything else in print.
  const CELL = 40;
  const MARGIN = 20;
  const grid = $derived(entry.puzzle.grid);
  const layout: Layout = $derived({
    cell: CELL,
    margin: MARGIN,
    width: grid.width * CELL + 2 * MARGIN,
    height: grid.height * CELL + 2 * MARGIN,
  });
  const size = markSizes(CELL);
  const dots = $derived(Array.from({ length: grid.dotCount }, (_, d) => dotPoint(grid, layout, d)));
  const clues = $derived(
    Array.from({ length: grid.cellCount }, (_, c) => c).filter((c) => entry.puzzle.clues[c] !== NO_CLUE),
  );
</script>

<div class="print-sheet">
  <h1>{puzzleTitle(entry)}</h1>
  <p>{puzzleSubtitle(entry)}</p>
  <svg viewBox="0 0 {layout.width} {layout.height}" role="img" aria-label="Puzzle to print">
    {#each dots as p, d (d)}
      <circle class="dot" cx={p.x} cy={p.y} r={size.dotRadius} />
    {/each}
    {#each clues as c (c)}
      {@const p = cellPoint(grid, layout, c)}
      <text class="clue" x={p.x} y={p.y} font-size={size.clue}>{entry.puzzle.clues[c]}</text>
    {/each}
  </svg>
</div>

<style>
  .print-sheet {
    display: none;
    background: #fff;
    color: #000;
    font-family: var(--font-ui);
  }

  @media print {
    .print-sheet {
      display: block;
    }
  }

  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 20pt;
  }

  p {
    margin: 2pt 0 12pt;
    font-size: 11pt;
  }

  svg {
    display: block;
    width: 100%;
    max-height: 85vh;
  }

  .dot,
  .clue {
    fill: #000;
  }

  .clue {
    font-weight: 500;
    text-anchor: middle;
    dominant-baseline: central;
  }
</style>
