<script lang="ts">
  import { analyzeBoard, NONE, type Puzzle } from "@loophole/core";
  import { type CellEdit, cellCommand, cellLabel, moveCell } from "../editor/keyboard.ts";
  import { cellAt, cellPoint, type Layout, type Point } from "../game/geometry.ts";
  import { BoardPointers } from "../game/pointers.ts";
  import {
    miniJump,
    miniLayout,
    panBy,
    revealRect,
    type Size,
    SVG_MAX_SIZE,
    type View,
    wheelView,
    ZOOM_STEP,
    type ZoomLimits,
    zoomAround,
  } from "../game/viewport.ts";
  import BoardCanvas from "./BoardCanvas.svelte";
  import BoardSvg from "./BoardSvg.svelte";
  import MiniMap from "./MiniMap.svelte";
  import ZoomControls from "./ZoomControls.svelte";

  interface Props {
    /** The draft: clues only. */
    puzzle: Puzzle;
    /** Cells to mark with a dashed ai box, such as a suggested clue's cell (Editor artboard). */
    highlight: readonly number[];
    layout: Layout;
    view: View;
    port: Size;
    zoom: ZoomLimits | null;
    /** A tap on a cell; the editor decides what it does. */
    ontap: (cell: number) => void;
    /** A key's edit to the cursor's cell. */
    onkey: (cell: number, edit: CellEdit) => void;
    onview: (view: View) => void;
  }

  let { puzzle, highlight, layout, view, port, zoom, ontap, onkey, onview }: Props = $props();

  // The editor's board is drawn by the play board's renderers, with no lines.
  const grid = $derived(puzzle.grid);
  const S = $derived(layout.cell);
  const canvas = $derived(grid.width > SVG_MAX_SIZE || grid.height > SVG_MAX_SIZE);
  const edges = $derived(new Uint8Array(grid.edgeCount));
  const analysis = $derived(analyzeBoard(puzzle, edges));
  const marks = $derived(
    highlight.map((cell) => {
      const p = cellPoint(grid, layout, cell);
      return { cell, x: p.x - S / 2 - view.x + 2, y: p.y - S / 2 - view.y + 2, size: S - 4 };
    }),
  );

  // Keyboard cursor (NFR-5): a cell, shown while the board has focus and the keyboard was used last.
  let surface: HTMLDivElement | undefined = $state();
  let cursor = $state(0);
  let focused = $state(false);
  let keyboardMode = $state(false);
  const showCursor = $derived(focused && keyboardMode);
  const cursorLabel = $derived(cellLabel(grid, cursor, puzzle.clues[cursor]));
  const cursorBox = $derived.by(() => {
    const p = cellPoint(grid, layout, cursor);
    return { x: p.x - S / 2 - view.x + 2, y: p.y - S / 2 - view.y + 2, size: S - 4 };
  });

  // One finger (or the mouse) taps a cell; dragging past the slop pans a zoomable board instead;
  // a second finger pinches.
  const pointers = new BoardPointers();
  let press: Point | null = null;
  let last: Point | null = null;

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
    keyboardMode = false;
    press = started === "draw" ? p : null;
    last = p;
  }

  function onpointermove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    if (zoom !== null) {
      const pinched = pointers.move(e.pointerId, p, grid, port, zoom);
      if (pinched !== null) {
        onview(pinched);
        return;
      }
    }
    if (!pointers.drawing || last === null) return;
    if (press !== null && Math.hypot(p.x - press.x, p.y - press.y) > Math.max(8, S / 4)) {
      press = null;
    }
    if (press === null && zoom !== null) onview(panBy(grid, view, p.x - last.x, p.y - last.y, port, zoom));
    last = p;
  }

  function onpointerup(e: PointerEvent) {
    if (!pointers.up(e.pointerId) || press === null) return;
    const cell = cellAt(grid, layout, press.x + view.x, press.y + view.y);
    press = null;
    if (cell === NONE) return;
    cursor = cell;
    ontap(cell);
  }

  function onpointercancel(e: PointerEvent) {
    pointers.up(e.pointerId);
    press = null;
  }

  // Wheel and trackpad, as on the play board; added by hand so it can stop page zoom and scroll.
  let boardEl: HTMLDivElement | undefined = $state();
  const zoomable = $derived(zoom !== null);
  $effect(() => {
    const el = boardEl;
    if (el === undefined || !zoomable) return;
    const onwheel = (e: WheelEvent) => {
      e.preventDefault();
      if (zoom !== null) onview(wheelView(grid, view, e, local(e), port, zoom));
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

  /** Pans so the cursor's cell is on screen and clear of the overlays. */
  function reveal(cell: number) {
    if (zoom === null) return;
    const p = cellPoint(grid, layout, cell);
    onview(revealRect(grid, view, { x: p.x - S, y: p.y - S, width: 2 * S, height: 2 * S }, port, zoom));
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (zoom !== null && (e.key === "+" || e.key === "=" || e.key === "-")) {
      e.preventDefault();
      const p = cellPoint(grid, layout, cursor);
      zoomBy(e.key === "-" ? 1 / ZOOM_STEP : ZOOM_STEP, { x: p.x - view.x, y: p.y - view.y });
      return;
    }
    const cmd = cellCommand(e.key);
    if (cmd === null) return;
    e.preventDefault();
    keyboardMode = true;
    if (cmd.type === "move") {
      cursor = moveCell(grid, cursor, cmd.direction);
      reveal(cursor);
    } else {
      onkey(cursor, cmd);
    }
  }
</script>

<div bind:this={boardEl} class="board" style:width="{port.width}px" style:height="{port.height}px">
  <!-- One focusable widget, like the play board: taps are hit-tested by geometry and the keyboard
       moves a cell cursor. The data attributes give tests the board's geometry. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={surface}
    class="surface"
    role="application"
    aria-label="Puzzle grid, {grid.width} by {grid.height}. Arrow keys move between cells; type 0 to 3 to place a clue, Backspace to erase."
    aria-describedby="editor-cursor"
    tabindex={0}
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
      keyboardMode = surface?.matches(":focus-visible") ?? false;
      if (keyboardMode) reveal(cursor);
    }}
    onblur={() => (focused = false)}
  >
    {#if canvas}
      <BoardCanvas {puzzle} {edges} {analysis} {layout} {view} {port} hint={null} />
    {:else}
      <BoardSvg {puzzle} {edges} {analysis} {layout} {view} {port} hint={null} />
    {/if}
    {#if showCursor || marks.length > 0}
      <svg class="overlay" width={port.width} height={port.height} aria-hidden="true">
        {#each marks as m (m.cell)}
          <rect class="mark" x={m.x} y={m.y} width={m.size} height={m.size} rx="4" />
        {/each}
        {#if showCursor}
          <rect class="cursor" x={cursorBox.x} y={cursorBox.y} width={cursorBox.size} height={cursorBox.size} rx="4" />
        {/if}
      </svg>
    {/if}
  </div>
  {#if zoom !== null}
    {@const limits = zoom}
    <MiniMap
      {grid}
      {edges}
      {view}
      {port}
      onjump={(x, y) => onview(miniJump(grid, view, x, y, miniLayout(grid), port, limits))}
    />
    <ZoomControls {view} {limits} onzoom={(factor) => zoomBy(factor, centre())} />
  {/if}
  <p id="editor-cursor" class="visually-hidden" aria-live="polite">{showCursor ? cursorLabel : ""}</p>
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

  .mark {
    fill: var(--hint-wash);
    stroke: var(--ai);
    stroke-width: 2.5;
    stroke-dasharray: 6 4;
  }

  .cursor {
    fill: none;
    stroke: var(--ai);
    stroke-width: 3;
  }
</style>
