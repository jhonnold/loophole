<script lang="ts">
  import { type BoardAnalysis, EdgeState, NONE, type Puzzle } from "@loophole/core";
  import { type EdgeChange, nextState } from "../game/board.ts";
  import { edgeSegment, type Layout, type Point } from "../game/geometry.ts";
  import { PointerGesture } from "../game/gesture.ts";
  import { boardCommand, edgeLabel, moveCursor } from "../game/keyboard.ts";
  import { BoardPointers } from "../game/pointers.ts";
  import {
    miniJump,
    miniLayout,
    panBy,
    revealRect,
    type Size,
    SVG_MAX_SIZE,
    type View,
    ZOOM_STEP,
    type ZoomLimits,
    zoomAround,
  } from "../game/viewport.ts";
  import BoardCanvas from "./BoardCanvas.svelte";
  import BoardSvg from "./BoardSvg.svelte";
  import MiniMap from "./MiniMap.svelte";

  interface Props {
    puzzle: Puzzle;
    edges: Uint8Array;
    analysis: BoardAnalysis;
    /** The whole board at the current cell size. */
    layout: Layout;
    /** Where the viewport sits on the board; always at (0, 0) for a board that does not zoom. */
    view: View;
    /** The visible box: the board's own size, or the stage for a zoomable board. */
    port: Size;
    /** Zoom range, or null when the board fits and does not zoom. */
    zoom: ZoomLimits | null;
    /** No drawing: paused or solved. Zoom and pan still work. */
    locked: boolean;
    /** Applies edits; `merge` joins them to the previous undo step (drag strokes). */
    onedit: (changes: EdgeChange[], merge: boolean) => void;
    /** Moves or zooms the view of a zoomable board. */
    onview: (view: View) => void;
  }

  let { puzzle, edges, analysis, layout, view, port, zoom, locked, onedit, onview }: Props = $props();

  const grid = $derived(puzzle.grid);
  const S = $derived(layout.cell);
  const canvas = $derived(grid.width > SVG_MAX_SIZE || grid.height > SVG_MAX_SIZE);

  // Keyboard cursor (NFR-5): shown while the board has focus and the keyboard was used last.
  let surface: HTMLDivElement | undefined = $state();
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
    const x = horizontal ? s.x1 - 6 : s.x1 - thick / 2;
    const y = horizontal ? s.y1 - thick / 2 : s.y1 - 6;
    return {
      x: x - view.x,
      y: y - view.y,
      width: horizontal ? len : thick,
      height: horizontal ? thick : len,
      radius: thick / 2,
      labelX: Math.min(Math.max((s.x1 + s.x2) / 2 - view.x, 130), port.width - 130),
      labelY: Math.max(s.y1, s.y2) - view.y + (horizontal ? thick / 2 : 6) + 8,
    };
  });

  const pointers = new BoardPointers();
  let gesture: PointerGesture | null = null;

  function local(e: { clientX: number; clientY: number }): Point {
    const r = (surface as HTMLDivElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onpointerdown(e: PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = local(e);
    const started = pointers.down(e.pointerId, p, view, zoom !== null && e.pointerType !== "mouse");
    if (started === null) return;
    surface?.setPointerCapture(e.pointerId);
    if (started === "zoom") {
      // A second finger: this is a pinch, not a stroke. Marks a stroke already made stay.
      gesture?.cancel();
      gesture = null;
      return;
    }
    keyboardMode = false;
    if (locked) return;
    gesture = new PointerGesture(grid, layout);
    gesture.down(p.x + view.x, p.y + view.y);
  }

  function onpointermove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    if (zoom !== null) {
      const next = pointers.move(e.pointerId, p, grid, port, zoom);
      if (next !== null) {
        onview(next);
        return;
      }
    }
    if (gesture === null || !pointers.drawing) return;
    const step = gesture.move(p.x + view.x, p.y + view.y, edges);
    if (step !== null) onedit(step.changes, step.merge);
  }

  function onpointerup(e: PointerEvent) {
    if (!pointers.up(e.pointerId) || gesture === null) return;
    const tapped = gesture.up();
    gesture = null;
    if (tapped !== NONE && !locked) {
      cursor = tapped;
      onedit([[tapped, nextState(edges[tapped] as EdgeState)]], false);
    }
  }

  function onpointercancel(e: PointerEvent) {
    if (!pointers.up(e.pointerId)) return;
    gesture?.cancel();
    gesture = null;
  }

  // Wheel and trackpad: Ctrl/⌘ + wheel (and trackpad pinch, which the browser reports the same
  // way) zooms around the pointer; plain wheel and two-finger scroll pan. Svelte adds wheel
  // listeners as passive, so this one is added by hand to be able to stop page zoom and scroll. It
  // covers the whole board, overview map and zoom pill included, and stays put while the view moves
  // (a new `zoom` object comes with every view).
  let boardEl: HTMLDivElement | undefined = $state();
  const zoomable = $derived(zoom !== null);
  $effect(() => {
    const el = boardEl;
    if (el === undefined || !zoomable) return;
    const onwheel = (e: WheelEvent) => {
      // Never let the page scroll or zoom under the board, even while a stroke is held.
      e.preventDefault();
      if (gesture !== null || zoom === null) return;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? port.height : 1;
      let dx = e.deltaX * unit;
      let dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        // A mouse-wheel notch is about 100 px of delta; clamp it so one notch is about 1.28×, not
        // e×. Trackpad pinches send small deltas, which this rate keeps quick.
        const step = Math.max(-25, Math.min(25, dy));
        onview(zoomAround(grid, view, view.cell * Math.exp(-step * 0.01), local(e), port, zoom));
        return;
      }
      if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
      onview(panBy(grid, view, -dx, -dy, port, zoom));
    };
    el.addEventListener("wheel", onwheel, { passive: false });
    return () => el.removeEventListener("wheel", onwheel);
  });

  function zoomBy(factor: number, at: Point) {
    if (zoom !== null) onview(zoomAround(grid, view, view.cell * factor, at, port, zoom));
  }

  function centre(): Point {
    return { x: port.width / 2, y: port.height / 2 };
  }

  /** Pans so the cursor's edge, with half a cell around it, is on screen and clear of the overlays. */
  function reveal(edge: number) {
    if (zoom === null) return;
    const s = edgeSegment(grid, layout, edge);
    const rect = {
      x: s.x1 - S / 2,
      y: s.y1 - S / 2,
      width: s.x2 - s.x1 + S,
      height: s.y2 - s.y1 + S,
    };
    onview(revealRect(grid, view, rect, port, zoom));
  }

  /** Moves keyboard focus to the board; the parent calls this after the board remounts. */
  export function focus(): void {
    surface?.focus();
  }

  function onkeydown(e: KeyboardEvent) {
    if (locked || e.ctrlKey || e.metaKey || e.altKey) return;
    // Keys wait until a stroke ends, so a keyboard edit never joins the stroke's undo step.
    if (gesture !== null) return;
    if (zoom !== null && (e.key === "+" || e.key === "=" || e.key === "-")) {
      e.preventDefault();
      const s = edgeSegment(grid, layout, cursor);
      const at = { x: (s.x1 + s.x2) / 2 - view.x, y: (s.y1 + s.y2) / 2 - view.y };
      zoomBy(e.key === "-" ? 1 / ZOOM_STEP : ZOOM_STEP, at);
      return;
    }
    const cmd = boardCommand(e.key);
    if (cmd === null) return;
    e.preventDefault();
    keyboardMode = true;
    if (cmd.type === "move") {
      cursor = moveCursor(grid, cursor, cmd.direction);
      reveal(cursor);
    } else if (cmd.type === "cycle") onedit([[cursor, nextState(edges[cursor] as EdgeState)]], false);
    else if (cmd.type === "cross") onedit([[cursor, EdgeState.Cross]], false);
    else if (cmd.type === "erase") onedit([[cursor, EdgeState.Unknown]], false);
  }

  const percent = $derived(zoom === null ? 100 : Math.round((view.cell / zoom.min) * 100));
</script>

<div
  bind:this={boardEl}
  class="board"
  style:width="{port.width}px"
  style:height="{port.height}px"
>
  <!-- The board is one focusable widget: pointer input is hit-tested by geometry and keyboard input
       moves an edge cursor, so its edges need no DOM elements of their own. The data attributes
       give tests the board's geometry, which a canvas cannot show. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={surface}
    class="surface"
    role="application"
    aria-label="Puzzle board, {grid.width} by {grid.height}. Arrow keys move the edge cursor; Space cycles line, cross, empty."
    aria-describedby="board-cursor"
    tabindex={locked ? -1 : 0}
    data-cell={layout.cell}
    data-margin={layout.margin}
    data-x={view.x}
    data-y={view.y}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    {onpointercancel}
    {onkeydown}
    onfocus={() => {
      focused = true;
      // Tab and other keyboard focus show the cursor at once, in view; a click does not.
      keyboardMode = surface?.matches(":focus-visible") ?? false;
      if (keyboardMode) reveal(cursor);
    }}
    onblur={() => (focused = false)}
  >
    {#if canvas}
      <BoardCanvas {puzzle} {edges} {analysis} {layout} {view} {port} />
    {:else}
      <BoardSvg {puzzle} {edges} {analysis} {layout} {view} {port} />
    {/if}
    {#if showCursor}
      <svg class="overlay" width={port.width} height={port.height} aria-hidden="true">
        <rect
          class="cursor"
          x={cursorBox.x}
          y={cursorBox.y}
          width={cursorBox.width}
          height={cursorBox.height}
          rx={cursorBox.radius}
        />
      </svg>
    {/if}
  </div>
  {#if showCursor}
    <div class="tip" style:left="{cursorBox.labelX}px" style:top="{cursorBox.labelY}px" aria-hidden="true">
      {cursorLabel}
    </div>
  {/if}
  {#if zoom !== null}
    {@const limits = zoom}
    <MiniMap
      {grid}
      {edges}
      {view}
      {port}
      onjump={(x, y) => onview(miniJump(grid, view, x, y, miniLayout(grid), port, limits))}
    />
    <div class="zoom">
      <button
        type="button"
        aria-label="Zoom out"
        disabled={view.cell <= limits.min}
        onclick={() => zoomBy(1 / ZOOM_STEP, centre())}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
      </button>
      <span class="percent">{percent}%</span>
      <button
        type="button"
        aria-label="Zoom in"
        disabled={view.cell >= limits.max}
        onclick={() => zoomBy(ZOOM_STEP, centre())}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg>
      </button>
    </div>
  {/if}
  <p id="board-cursor" class="visually-hidden" aria-live="polite">{showCursor ? cursorLabel : ""}</p>
</div>

<style>
  .board {
    position: relative;
  }

  .surface {
    position: relative;
    width: 100%;
    height: 100%;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    cursor: pointer;
    outline: none;
  }

  .overlay {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
  }

  .cursor {
    fill: none;
    stroke: var(--ai);
    stroke-width: 3;
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
    z-index: 2;
  }

  /* Zoom controls (Night artboard): bottom right of the board. */
  .zoom {
    position: absolute;
    right: 8px;
    bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px;
    background: color-mix(in srgb, var(--ground) 92%, transparent);
    border: 1.5px solid var(--hairline);
    border-radius: 999px;
    z-index: 1;
  }

  .zoom button {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 0;
    background: transparent;
    color: var(--ink);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
  }

  .zoom button:disabled {
    color: var(--disabled);
    cursor: default;
  }

  .percent {
    min-width: 40px;
    font-size: 13px;
    font-weight: 700;
    color: var(--ink-soft);
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
</style>
