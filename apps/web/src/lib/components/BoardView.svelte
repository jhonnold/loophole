<script lang="ts">
  import { type BoardAnalysis, EdgeState, NO_CLUE, NONE, type Puzzle } from "@loophole/core";
  import { type EdgeChange, nextState } from "../game/board.ts";
  import { cellPoint, dotPoint, edgeSegment, type Layout } from "../game/geometry.ts";
  import { PointerGesture } from "../game/gesture.ts";
  import { insideCells } from "../game/inside.ts";
  import { boardCommand, edgeLabel, moveCursor } from "../game/keyboard.ts";

  interface Props {
    puzzle: Puzzle;
    edges: Uint8Array;
    analysis: BoardAnalysis;
    layout: Layout;
    /** No input: paused or solved. */
    locked: boolean;
    /** Applies edits; `merge` joins them to the previous undo step (drag strokes). */
    onedit: (changes: EdgeChange[], merge: boolean) => void;
  }

  let { puzzle, edges, analysis, layout, locked, onedit }: Props = $props();

  const grid = $derived(puzzle.grid);
  const S = $derived(layout.cell);
  const lineWidth = $derived(Math.max(2, Math.round(S * 0.11)));
  const dotRadius = $derived(Math.max(4, Math.round(S * 0.11)) / 2);
  const crossArm = $derived(S * 0.1);

  const dots = $derived(Array.from({ length: grid.dotCount }, (_, d) => dotPoint(grid, layout, d)));
  const clues = $derived.by(() => {
    const out: { cell: number; x: number; y: number; text: string }[] = [];
    for (let i = 0; i < grid.cellCount; i++) {
      if (puzzle.clues[i] === NO_CLUE) continue;
      const p = cellPoint(grid, layout, i);
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

  // Keyboard cursor (NFR-5): shown while the board has focus and the keyboard was used last.
  let svg: SVGSVGElement | undefined = $state();
  let cursor = $state(0);
  let focused = $state(false);
  let keyboardMode = $state(false);
  const showCursor = $derived(focused && keyboardMode && !locked);
  const cursorLabel = $derived(edgeLabel(grid, cursor, edges[cursor] as EdgeState));
  const cursorBox = $derived.by(() => {
    const s = edgeSegment(grid, layout, cursor);
    const thick = Math.max(20, Math.round(S * 0.48));
    const horizontal = s.y1 === s.y2;
    const len = S + 12;
    return {
      x: horizontal ? s.x1 - 6 : s.x1 - thick / 2,
      y: horizontal ? s.y1 - thick / 2 : s.y1 - 6,
      width: horizontal ? len : thick,
      height: horizontal ? thick : len,
      radius: thick / 2,
      labelX: Math.min(Math.max((s.x1 + s.x2) / 2, 130), layout.width - 130),
      labelY: Math.max(s.y1, s.y2) + (horizontal ? thick / 2 : 6) + 8,
    };
  });

  let gesture: PointerGesture | null = null;
  let pointerId = -1;

  function local(e: PointerEvent): [number, number] {
    const r = (svg as SVGSVGElement).getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function onpointerdown(e: PointerEvent) {
    if (locked || gesture !== null || !e.isPrimary || e.button !== 0) return;
    keyboardMode = false;
    gesture = new PointerGesture(grid, layout);
    pointerId = e.pointerId;
    svg?.setPointerCapture(e.pointerId);
    gesture.down(...local(e));
  }

  function onpointermove(e: PointerEvent) {
    if (gesture === null || e.pointerId !== pointerId) return;
    const step = gesture.move(...local(e), edges);
    if (step !== null) onedit(step.changes, step.merge);
  }

  function onpointerup(e: PointerEvent) {
    if (gesture === null || e.pointerId !== pointerId) return;
    const tapped = gesture.up();
    gesture = null;
    if (tapped !== NONE && !locked) {
      cursor = tapped;
      onedit([[tapped, nextState(edges[tapped] as EdgeState)]], false);
    }
  }

  function onpointercancel(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    gesture?.cancel();
    gesture = null;
  }

  function onkeydown(e: KeyboardEvent) {
    if (locked || e.ctrlKey || e.metaKey || e.altKey) return;
    const cmd = boardCommand(e.key);
    if (cmd === null) return;
    e.preventDefault();
    keyboardMode = true;
    if (cmd.type === "move") cursor = moveCursor(grid, cursor, cmd.direction);
    else if (cmd.type === "cycle") onedit([[cursor, nextState(edges[cursor] as EdgeState)]], false);
    else if (cmd.type === "cross") onedit([[cursor, EdgeState.Cross]], false);
    else if (cmd.type === "erase") onedit([[cursor, EdgeState.Unknown]], false);
  }
</script>

<div class="board" style:width="{layout.width}px" style:height="{layout.height}px">
  <!-- The board is one focusable widget: pointer input is hit-tested by geometry and keyboard input
       moves an edge cursor, so its edges need no DOM elements of their own. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <svg
    bind:this={svg}
    width={layout.width}
    height={layout.height}
    viewBox="0 0 {layout.width} {layout.height}"
    role="application"
    aria-label="Puzzle board, {grid.width} by {grid.height}. Arrow keys move the edge cursor; Space cycles line, cross, empty."
    aria-describedby="board-cursor"
    tabindex={locked ? -1 : 0}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    {onpointercancel}
    {onkeydown}
    onfocus={() => (focused = true)}
    onblur={() => (focused = false)}
  >
    {#if inside}
      {#each inside as isIn, i (i)}
        {#if isIn}
          {@const p = cellPoint(grid, layout, i)}
          <rect class="wash" x={p.x - S / 2} y={p.y - S / 2} width={S} height={S} />
        {/if}
      {/each}
    {/if}

    {#each lines as e (e)}
      {@const s = edgeSegment(grid, layout, e)}
      <line
        class="line"
        class:loop={loopEdges.has(e)}
        x1={s.x1}
        y1={s.y1}
        x2={s.x2}
        y2={s.y2}
        stroke-width={lineWidth}
      />
    {/each}

    {#each crosses as e (e)}
      {@const s = edgeSegment(grid, layout, e)}
      {@const mx = (s.x1 + s.x2) / 2}
      {@const my = (s.y1 + s.y2) / 2}
      <path
        class="cross"
        d="M{mx - crossArm} {my - crossArm}L{mx + crossArm} {my + crossArm}M{mx + crossArm} {my - crossArm}L{mx - crossArm} {my + crossArm}"
        stroke-width={Math.max(1.5, S * 0.05)}
      />
    {/each}

    {#each dots as p, d (d)}
      <circle class="dot" cx={p.x} cy={p.y} r={dotRadius} />
    {/each}

    {#each clues as q (q.cell)}
      <text
        class="clue"
        class:bad={badCells.has(q.cell)}
        x={q.x}
        y={q.y}
        font-size={S * 0.56}>{q.text}</text
      >
      {#if badCells.has(q.cell)}
        <circle class="ring" cx={q.x} cy={q.y} r={S * 0.34 - 1} />
      {/if}
    {/each}

    {#each v.dots as d (d)}
      {@const p = dotPoint(grid, layout, d)}
      <circle class="ring" cx={p.x} cy={p.y} r={S * 0.26 - 1} />
    {/each}

    {#if showCursor}
      <rect
        class="cursor"
        x={cursorBox.x}
        y={cursorBox.y}
        width={cursorBox.width}
        height={cursorBox.height}
        rx={cursorBox.radius}
      />
    {/if}
  </svg>
  {#if showCursor}
    <div class="tip" style:left="{cursorBox.labelX}px" style:top="{cursorBox.labelY}px" aria-hidden="true">
      {cursorLabel}
    </div>
  {/if}
  <p id="board-cursor" class="visually-hidden" aria-live="polite">{showCursor ? cursorLabel : ""}</p>
</div>

<style>
  .board {
    position: relative;
  }

  svg {
    display: block;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    cursor: pointer;
    outline: none;
  }

  .wash {
    fill: var(--solved-wash);
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
    pointer-events: none;
  }

  .clue.bad {
    fill: var(--shu);
  }

  .ring {
    fill: none;
    stroke: var(--shu);
    stroke-width: 2;
    pointer-events: none;
  }

  .cursor {
    fill: none;
    stroke: var(--ai);
    stroke-width: 3;
    pointer-events: none;
  }

  .tip {
    position: absolute;
    transform: translateX(-50%);
    padding: 6px 10px;
    border-radius: 6px;
    background: var(--ai);
    color: var(--on-ink);
    font-size: 13px;
    font-weight: 700;
    white-space: nowrap;
    pointer-events: none;
    z-index: 1;
  }
</style>
