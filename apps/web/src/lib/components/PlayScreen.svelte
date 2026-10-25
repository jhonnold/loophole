<script lang="ts">
  import { analyzeBoard } from "@loophole/core";
  import { onDestroy, onMount, tick } from "svelte";
  import {
    applyChanges,
    type Board,
    clearAll,
    createBoard,
    type EdgeChange,
    hasMarks,
    type Move,
    redo,
    undo,
  } from "../game/board.ts";
  import {
    fitLayout,
    MAX_CELL,
    minBoardHeight,
    POINTER_MIN_CELL,
    TOUCH_MIN_CELL,
  } from "../game/geometry.ts";
  import { type HintView, hintCurrent, hintView } from "../game/hint.ts";
  import { type Command, screenCommand } from "../game/keyboard.ts";
  import { violationMessages } from "../game/messages.ts";
  import type { Progress } from "../game/progress.ts";
  import {
    createStopwatch,
    elapsed,
    formatClock,
    isRunning,
    type Stopwatch,
    start,
    stop,
  } from "../game/timer.ts";
  import { clampView, type View, viewLayout, zoomLimits } from "../game/viewport.ts";
  import { type PuzzleEntry, puzzleSource, puzzleTitle } from "../puzzles/index.ts";
  import { openSaves, type PuzzleSaves } from "../sync/index.ts";
  import BoardView from "./BoardView.svelte";
  import HintCard from "./HintCard.svelte";
  import PauseButton from "./PauseButton.svelte";
  import SolvedSeal from "./SolvedSeal.svelte";
  import ToolBar from "./ToolBar.svelte";

  interface Props {
    entry: PuzzleEntry;
  }

  let { entry }: Props = $props();

  const puzzle = $derived(entry.puzzle);
  const grid = $derived(puzzle.grid);

  // The page re-creates this component for each puzzle, so reading `entry` once here is fine.
  // svelte-ignore state_referenced_locally
  let board: Board = $state.raw(createBoard(entry.puzzle.grid.edgeCount));
  let watch: Stopwatch = $state.raw(createStopwatch());
  let now = $state(0);
  let paused = $state(false);
  let ready = $state(false);
  let saves: PuzzleSaves | null = null;
  // Whether progress goes to the account (logged in, server puzzle) or stays on this device.
  let synced = $state(false);
  // The board was just replaced with a newer one saved on another device.
  let remoteNote = $state(false);
  let boardView: { focus(): void } | undefined = $state();

  // Hints (FR-12). `hint` stays drawn on the board until its move is made or overtaken; `hintOpen`
  // is whether its card is showing in place of the tool tray. Seeing a hint marks the attempt as
  // assisted, which is saved with the progress.
  let hint: HintView | null = $state.raw(null);
  let hintOpen = $state(false);
  let hintBusy = $state(false);
  let hintFailed = $state(false);
  let assisted = $state(false);
  // Set when the puzzle screen goes away, so a hint that arrives late cannot save over newer progress.
  let destroyed = false;
  onDestroy(() => {
    destroyed = true;
  });

  const analysis = $derived(analyzeBoard(puzzle, board.edges));
  const solved = $derived(analysis.solved);
  const messages = $derived(solved ? [] : violationMessages(analysis.violations));
  const clock = $derived(formatClock(elapsed(watch, now)));
  const locked = $derived(paused || solved || !ready);

  // Board sizing. On phones the stage holds just the board, and an empty spacer under the notes
  // takes the rest of the height, so stage + spacer is the room the board may use; that sum does not
  // change when the board grows, so the fit is stable. On wide screens the stage fills its column.
  let stageWidth = $state(0);
  let stageHeight = $state(0);
  let spacerHeight = $state(0);
  let coarse = $state(false);
  let wide = $state(false);
  const FRAME = 4; // the frame's 2px border on each side; the offset shadow is outside the layout
  const minCell = $derived(coarse ? TOUCH_MIN_CELL : POINTER_MIN_CELL);
  const roomWidth = $derived(stageWidth - FRAME);
  const roomHeight = $derived((wide ? stageHeight : stageHeight + spacerHeight) - FRAME);
  const fitted = $derived(
    stageWidth > 0
      ? fitLayout(grid.width, grid.height, roomWidth, roomHeight, minCell, MAX_CELL)
      : null,
  );
  const stageMinHeight = $derived(
    stageWidth > 0 ? minBoardHeight(grid.width, grid.height, roomWidth, minCell) + FRAME : 0,
  );

  // A board whose cells would come out smaller than the minimum zooms instead (FR-13). Whether it
  // does depends only on the width (`fitLayout` gives up the minimum only for width). Its stage then
  // takes the height left over on the screen, at least five cells, and the board's frame fills the
  // stage without sizing it, so the viewport follows the screen and never feeds its own size. It
  // opens at the minimum cell size. `zoomed` is the last view the player chose; it survives
  // pausing, and is clamped again whenever the stage changes size.
  const zoomable = $derived(fitted !== null && fitted.cell < minCell);
  let zoomed: View | null = $state.raw(null);
  const frame = $derived.by(() => {
    if (fitted === null) return null;
    if (!zoomable) {
      return {
        layout: fitted,
        view: { cell: fitted.cell, x: 0, y: 0 },
        port: { width: fitted.width, height: fitted.height },
        zoom: null,
      };
    }
    const port = { width: roomWidth, height: stageHeight - FRAME };
    const zoom = zoomLimits(grid, port);
    const view = clampView(grid, zoomed ?? { cell: minCell, x: 0, y: 0 }, port, zoom);
    return { layout: viewLayout(grid, view.cell), view, port, zoom };
  });

  // Saves and sends it now, as the page may be going away.
  function saveNow() {
    save();
    saves?.flush();
  }

  function save() {
    if (!ready) return;
    saves?.save({
      edges: board.edges,
      elapsedMs: elapsed(watch, performance.now()),
      solved,
      assisted,
    });
  }

  function update(next: Board) {
    if (next === board) return;
    board = next;
    hintFailed = false;
    remoteNote = false;
    save();
  }

  // The move the last edit made, while it is still on top of history. A drag stroke's later steps
  // join the stroke's move only while it is still there; an undo or redo in the middle of a stroke
  // starts a new step instead, so one undo never removes the stroke and an earlier move together.
  let lastEdit: Move | undefined;

  function edit(changes: EdgeChange[], merge: boolean) {
    if (locked) return;
    const join = merge && board.past.at(-1) === lastEdit;
    update(applyChanges(board, changes, join));
    lastEdit = board.past.at(-1);
  }

  // Another device saved further, or the server kept a solved board: show that board instead.
  // Usually this happens while paused, when the tab comes back into sight.
  function adopt(saved: Progress | null) {
    if (!ready || destroyed) return;
    board = createBoard(grid.edgeCount, saved?.edges);
    lastEdit = undefined;
    hint = null;
    hintOpen = false;
    assisted = saved?.assisted ?? false;
    now = performance.now();
    watch = createStopwatch(saved?.elapsedMs ?? 0);
    const done = analyzeBoard(puzzle, board.edges).solved;
    if (done) paused = false;
    else if (!paused) watch = start(watch, now);
    remoteNote = true;
  }

  // Pausing unmounts the board, so after it remounts (on resume or start over) focus goes back to
  // it, and keyboard players keep their place.
  function focusBoard() {
    tick().then(() => boardView?.focus());
  }

  async function askHint() {
    if (locked || hintBusy) return;
    if (hint !== null) {
      hintOpen = true;
      return;
    }
    hintBusy = true;
    hintFailed = false;
    const edges = board.edges;
    try {
      const result = await puzzleSource.hint(entry.id, puzzle, edges);
      // The screen was left, or the board changed, while the hint was on its way.
      if (destroyed || board.edges !== edges) return;
      const view = hintView(grid, result, edges);
      if (view === null) return;
      hint = view;
      hintOpen = true;
      assisted = true;
      save();
    } catch (err) {
      console.warn("Hint unavailable:", err);
      hintFailed = true;
    } finally {
      hintBusy = false;
    }
  }

  function applyHint() {
    if (hint === null) return;
    const changes = [...hint.apply];
    hint = null;
    hintOpen = false;
    edit(changes, false);
    focusBoard();
  }

  function closeHint() {
    hintOpen = false;
    focusBoard();
  }

  // A hint ends once its move is made, or one of its edges is marked differently.
  $effect(() => {
    if (hint !== null && (solved || !hintCurrent(hint, board.edges))) {
      if (hintOpen) focusBoard();
      hint = null;
      hintOpen = false;
    }
  });

  function setPaused(value: boolean) {
    if (!ready || solved || value === paused) return;
    paused = value;
    const t = performance.now();
    watch = value ? stop(watch, t) : start(watch, t);
    now = t;
    save();
    if (!value) focusBoard();
  }

  function run(cmd: Command) {
    if (cmd.type === "pause") setPaused(!paused);
    else if (locked) return;
    else if (cmd.type === "undo") update(undo(board));
    else if (cmd.type === "redo") update(redo(board));
    else if (cmd.type === "hint") askHint();
    else if (cmd.type === "close" && hintOpen) closeHint();
  }

  function onwindowkeydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, select, [contenteditable='true']")) return;
    const cmd = screenCommand(e);
    if (cmd === null) return;
    // Escape closes a hint card; with none open it is left for other UI, such as a dialog.
    if (cmd.type === "close" && !hintOpen) return;
    e.preventDefault();
    run(cmd);
  }

  function clear() {
    if (!locked) update(clearAll(board));
  }

  function startOver() {
    saves?.clear();
    remoteNote = false;
    board = createBoard(grid.edgeCount);
    now = performance.now();
    watch = start(createStopwatch(), now);
    paused = false;
    hint = null;
    hintOpen = false;
    assisted = false;
    focusBoard();
  }

  // Solving stops the clock and records the result (FR-17, client side).
  $effect(() => {
    if (solved && isRunning(watch)) {
      watch = stop(watch, performance.now());
      save();
    }
  });

  onMount(() => {
    coarse = matchMedia("(pointer: coarse)").matches;
    const wideQuery = matchMedia("(min-width: 900px)");
    wide = wideQuery.matches;
    const onwide = () => {
      wide = wideQuery.matches;
    };
    wideQuery.addEventListener("change", onwide);
    const opened = openSaves(entry.id, grid, adopt);
    saves = opened;
    opened.load().then((saved) => {
      if (destroyed) return;
      if (saved !== null) {
        board = createBoard(grid.edgeCount, saved.edges);
        watch = createStopwatch(saved.elapsedMs);
        assisted = saved.assisted;
      }
      synced = opened.synced;
      now = performance.now();
      if (!analyzeBoard(puzzle, board.edges).solved) watch = start(watch, now);
      ready = true;
    });

    const tick = setInterval(() => {
      now = performance.now();
    }, 250);
    // Leaving the tab pauses the clock (and hides the board) and saves, since a phone may never
    // come back to this page. Coming back picks up a board saved meanwhile on another device.
    const onvisibility = () => {
      if (document.visibilityState === "hidden") {
        setPaused(true);
        saveNow();
      } else {
        saves?.refresh();
      }
    };
    document.addEventListener("visibilitychange", onvisibility);
    window.addEventListener("pagehide", saveNow);
    return () => {
      clearInterval(tick);
      wideQuery.removeEventListener("change", onwide);
      document.removeEventListener("visibilitychange", onvisibility);
      window.removeEventListener("pagehide", saveNow);
      saveNow();
      saves?.close();
    };
  });
</script>

<svelte:window onkeydown={onwindowkeydown} />

<div class="screen">
  <header class="bar">
    <a class="back" href="/">
      <span class="visually-hidden">Back to puzzles</span>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        ><path d="M15 5l-7 7 7 7" /></svg
      >
    </a>
    <div class="titles">
      <h1>{puzzleTitle(entry)}</h1>
      <span class="subtitle">{entry.subtitle}</span>
      <span class="subtitle count"><b>{analysis.satisfiedClues}</b> of {analysis.clueCount} clues</span>
    </div>
    <div class="pill">
      <span class="clock" role="timer">{clock}</span>
      <PauseButton {paused} disabled={solved} ontoggle={() => setPaused(!paused)} />
    </div>
  </header>

  <p class="status">
    <span><b>{analysis.satisfiedClues}</b> of {analysis.clueCount} clues satisfied</span>
    <!-- One line only: the tag takes the zoom tip's place once a hint is used. -->
    {#if assisted}<span class="assisted">Hint used</span>
    {:else if zoomable}<span>Pinch or use +/− to zoom</span>{/if}
  </p>

  <main class="play" class:zoom={zoomable}>
    <div
      class="stage"
      bind:clientWidth={stageWidth}
      bind:clientHeight={stageHeight}
      style:min-height="{zoomable ? 5 * minCell + FRAME : stageMinHeight}px"
    >
      {#if frame}
        <div class="frame" style:width="{frame.port.width + FRAME}px" style:height="{frame.port.height + FRAME}px">
          {#if paused}
            <div class="paused">
              <span class="paused-title">一時停止</span>
              <span class="paused-text">Paused — the board is hidden while the clock is stopped.</span>
              <button type="button" class="primary" onclick={() => setPaused(false)}>Resume</button>
            </div>
          {:else}
            <BoardView
              bind:this={boardView}
              {puzzle}
              edges={board.edges}
              {analysis}
              layout={frame.layout}
              view={frame.view}
              port={frame.port}
              zoom={frame.zoom}
              {locked}
              hint={hint?.marks ?? null}
              onedit={edit}
              onview={(v) => (zoomed = v)}
            />
          {/if}
          {#if solved}
            <SolvedSeal />
          {/if}
        </div>
      {/if}
    </div>

    <div class="side">
      <div class="card timecard">
        <div class="timecard-text">
          <span class="label">Time</span>
          <span class="big-clock">{clock}</span>
          <span class="soft"><b>{analysis.satisfiedClues}</b> of {analysis.clueCount} clues satisfied</span>
          {#if assisted}<span class="assisted">Hint used</span>{/if}
        </div>
        <button type="button" class="outline" disabled={solved} onclick={() => setPaused(!paused)}>
          {paused ? "Resume" : "Pause"} <kbd>P</kbd>
        </button>
      </div>

      <div class="notes">
        {#if solved}
          <div class="card solved-card">
            <div class="solved-text">
              <span class="solved-title">Solved in {clock}</span>
              {#if assisted}<span class="assisted">Hint used</span>{/if}
              <span class="soft">{synced ? "Saved to your account." : "Saved on this device."}</span>
            </div>
            <button type="button" class="primary" onclick={startOver}>Start over</button>
          </div>
        {:else if hint !== null && hintOpen && !paused}
          <HintCard {grid} view={hint} onapply={applyHint} onlater={closeHint} />
        {:else if hintFailed}
          <p class="card hint-failed" role="status">Couldn't get a hint just now. Try again in a moment.</p>
        {:else if remoteNote}
          <p class="card hint-failed" role="status">Picked up your progress from another device.</p>
        {:else if messages.length > 0}
          <div class="card errors" role="status">
            {#each messages as m (m.title)}
              <p class="error"><span class="ring" aria-hidden="true"></span><span><b>{m.title}</b> {m.detail}</span></p>
            {/each}
          </div>
        {:else}
          <p class="idle">
            Tap an edge between two dots: <b>line</b>, then <b>×</b>, then empty. Drag to draw a run of
            lines.
          </p>
        {/if}
      </div>

      <div class="spacer" bind:clientHeight={spacerHeight}></div>

      {#if !solved && !(hint !== null && hintOpen && !paused)}
        <ToolBar
          canUndo={!locked && board.past.length > 0}
          canRedo={!locked && board.future.length > 0}
          canHint={!locked && !hintBusy}
          canClear={!locked && hasMarks(board)}
          onundo={() => run({ type: "undo" })}
          onredo={() => run({ type: "redo" })}
          onhint={() => run({ type: "hint" })}
          onclear={clear}
        />
      {/if}

      <section class="card keys" aria-labelledby="keys-h">
        <h2 id="keys-h">Keyboard</h2>
        <dl>
          <dt>← ↑ → ↓</dt><dd>move the edge cursor</dd>
          <dt>Space</dt><dd>line → × → empty</dd>
          <dt>X</dt><dd>cross the edge</dd>
          <dt>Backspace</dt><dd>clear the edge</dd>
          <dt>Z / Y</dt><dd>undo / redo</dd>
          <dt>H</dt><dd>hint</dd>
          <dt>P</dt><dd>pause</dd>
          {#if zoomable && !solved}<dt>+ / −</dt><dd>zoom in / out</dd>{/if}
          <dt>Mouse</dt><dd>click to cycle, drag to draw a run</dd>
        </dl>
      </section>
    </div>
  </main>
</div>

<style>
  .screen {
    /* Header metrics, also used to size a zoomable board's stage on wide screens. */
    --bar-height: 52px;
    --screen-top: 12px;
    --screen-bottom: 12px;
    --screen-gap: 10px;
    min-height: 100dvh;
    max-width: 1280px;
    margin: 0 auto;
    padding: var(--screen-top) 16px calc(var(--screen-bottom) + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: var(--screen-gap);
    overscroll-behavior: none;
  }

  .bar {
    height: var(--bar-height);
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .back {
    width: 44px;
    height: 44px;
    flex: 0 0 auto;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .titles {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }

  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 20px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .subtitle {
    font-size: 13px;
    font-weight: 500;
    color: var(--ink-soft);
  }

  .pill {
    flex: 0 0 auto;
    height: 44px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0 5px 0 14px;
    border-radius: 999px;
    background: var(--sheet);
    border: 2px solid var(--ink);
  }

  .clock {
    font-size: 17px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .status {
    margin: 0;
    flex: 0 0 auto;
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 14px;
    color: var(--ink-soft);
  }

  .status b,
  .soft b {
    color: var(--ink);
  }

  .play {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .stage {
    flex: 0 0 auto;
    display: flex;
    justify-content: center;
    align-items: flex-start;
  }

  .frame {
    position: relative;
    flex: 0 0 auto;
    background: var(--sheet);
    border: 2px solid var(--ink);
    box-shadow: 4px 4px 0 var(--frame-shadow);
  }

  /* A zoomable board's stage takes the free height and its frame fills it without sizing it. */
  .zoom .stage {
    flex: 1 1 0;
    position: relative;
  }

  .zoom .frame {
    position: absolute;
    top: 0;
    left: 0;
  }

  /* On phones, room for a one-message error card, so a zoomable board keeps its height when the
     first rule error appears or clears. */
  @media (max-width: 899px) {
    .zoom .notes {
      min-height: 88px;
    }
  }

  .paused {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 16px;
    text-align: center;
  }

  .paused-title {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 34px;
  }

  .paused-text {
    font-size: 15px;
    color: var(--ink-soft);
  }

  /* On phones the side column's children sit directly in the screen's column. */
  .side {
    display: contents;
  }

  .count {
    display: none;
  }

  .notes {
    display: flex;
    flex-direction: column;
  }

  .idle {
    margin: 0;
    font-size: 15px;
    line-height: 1.5;
    color: var(--ink-soft);
  }

  .idle b {
    color: var(--ink);
  }

  .spacer {
    flex: 1 1 0;
    min-height: 0;
  }

  .zoom .spacer {
    display: none;
  }

  .card {
    background: var(--sheet);
    border: 2px solid var(--ink);
    border-radius: 6px;
  }

  .errors {
    border-color: var(--shu);
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .error {
    margin: 0;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 15px;
    line-height: 1.45;
  }

  .error b {
    color: var(--shu);
  }

  .ring {
    flex: 0 0 auto;
    width: 20px;
    height: 20px;
    margin-top: 1px;
    border: 2px solid var(--shu);
    border-radius: 50%;
  }

  /* "Hint used" (Play artboard): an ai tag; the words carry it, not the colour. */
  .assisted {
    align-self: flex-start;
    padding: 3px 10px;
    border-radius: 6px;
    background: var(--ai-wash);
    color: var(--ai);
    font-size: 13px;
    font-weight: 700;
    white-space: nowrap;
  }

  /* In the status line the tag overhangs the line box, so showing it never moves the board. */
  .status .assisted {
    margin-block: -3px;
  }

  .hint-failed {
    margin: 0;
    padding: 10px 14px;
    font-size: 15px;
    line-height: 1.45;
  }

  .solved-card {
    padding: 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .solved-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .solved-title {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 22px;
  }

  .soft {
    font-size: 14px;
    color: var(--ink-soft);
  }

  .primary {
    flex: 0 0 auto;
    height: 44px;
    padding: 0 18px;
    border: 0;
    border-radius: 999px;
    background: var(--ink);
    color: var(--on-ink);
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
  }

  .outline {
    height: 48px;
    padding: 0 20px;
    border-radius: 999px;
    border: 2px solid var(--ink);
    background: transparent;
    color: var(--ink);
    font-size: 15px;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .outline:disabled {
    color: var(--disabled);
    border-color: var(--hairline);
    cursor: default;
  }

  .timecard,
  .keys {
    display: none;
  }

  /* The smallest phones (Small artboard, 360×560): a 14px gutter keeps 7×7 at 44px cells, and the
     clue count moves into the header. */
  @media (max-width: 379px) {
    .screen {
      padding-inline: 14px;
    }
  }

  @media (max-height: 620px) {
    .screen {
      --bar-height: 48px;
      --screen-top: 8px;
      --screen-bottom: 8px;
      --screen-gap: 8px;
    }

    .play {
      gap: 8px;
    }

    .status,
    .subtitle {
      display: none;
    }

    .subtitle.count {
      display: block;
    }

    .idle {
      font-size: 14px;
      line-height: 1.45;
    }
  }

  /* Wide screens: board on the left, timer, tools and keyboard help on the right (Desktop artboard). */
  @media (min-width: 900px) {
    .screen {
      --screen-top: 20px;
      --screen-bottom: 32px;
      --screen-gap: 14px;
      padding: var(--screen-top) 24px var(--screen-bottom);
    }

    h1 {
      font-size: 34px;
    }

    .subtitle {
      font-size: 16px;
    }

    .pill,
    .status,
    .spacer {
      display: none;
    }

    .play {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(300px, 380px);
      grid-template-rows: minmax(0, 1fr);
      gap: 32px;
    }

    .stage {
      min-height: 0;
    }

    /* The left column's height comes from the window, not from the side column: everything
       below the header and above the bottom padding. */
    .zoom .stage {
      height: calc(
        100dvh - var(--screen-top) - var(--bar-height) - var(--screen-gap) - var(--screen-bottom)
      );
      align-self: start;
    }

    .frame {
      box-shadow: 6px 6px 0 var(--frame-shadow);
    }

    .side {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .timecard {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 18px;
    }

    .timecard-text {
      display: flex;
      flex-direction: column;
    }

    .label {
      font-size: 13px;
      font-weight: 700;
      color: var(--ink-soft);
    }

    .big-clock {
      font-family: var(--font-display);
      font-weight: 900;
      font-size: 44px;
      line-height: 1.05;
      font-variant-numeric: tabular-nums;
    }

    .keys {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 16px 18px;
    }

    .keys h2 {
      margin: 0;
      font-family: var(--font-display);
      font-weight: 900;
      font-size: 18px;
    }

    .keys dl {
      margin: 0;
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 8px 14px;
      font-size: 14px;
      align-items: center;
    }

    .keys dt {
      font-weight: 700;
    }

    .keys dd {
      margin: 0;
      color: var(--ink-soft);
    }
  }
</style>
