<script lang="ts">
  import { analyzeBoard } from "@loophole/core";
  import { onMount } from "svelte";
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
  import { type Command, screenCommand } from "../game/keyboard.ts";
  import { violationMessages } from "../game/messages.ts";
  import { browserStorage, createProgressStore, type ProgressStore } from "../game/progress.ts";
  import {
    createStopwatch,
    elapsed,
    formatClock,
    isRunning,
    type Stopwatch,
    start,
    stop,
  } from "../game/timer.ts";
  import { type PuzzleEntry, puzzleTitle } from "../puzzles/index.ts";
  import BoardView from "./BoardView.svelte";
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
  let store: ProgressStore | null = null;

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
  const layout = $derived(
    stageWidth > 0
      ? fitLayout(grid.width, grid.height, roomWidth, roomHeight, minCell, MAX_CELL)
      : null,
  );
  const stageMinHeight = $derived(
    stageWidth > 0 ? minBoardHeight(grid.width, grid.height, roomWidth, minCell) + FRAME : 0,
  );

  function save() {
    store?.save(entry.id, {
      edges: board.edges,
      elapsedMs: elapsed(watch, performance.now()),
      solved,
    });
  }

  function update(next: Board) {
    if (next === board) return;
    board = next;
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

  function setPaused(value: boolean) {
    if (!ready || solved || value === paused) return;
    paused = value;
    const t = performance.now();
    watch = value ? stop(watch, t) : start(watch, t);
    now = t;
    save();
  }

  function run(cmd: Command) {
    if (cmd.type === "pause") setPaused(!paused);
    else if (locked) return;
    else if (cmd.type === "undo") update(undo(board));
    else if (cmd.type === "redo") update(redo(board));
  }

  function onwindowkeydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, select, [contenteditable='true']")) return;
    const cmd = screenCommand(e);
    if (cmd === null) return;
    e.preventDefault();
    run(cmd);
  }

  function clear() {
    if (!locked) update(clearAll(board));
  }

  function startOver() {
    store?.clear(entry.id);
    board = createBoard(grid.edgeCount);
    now = performance.now();
    watch = start(createStopwatch(), now);
    paused = false;
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
    store = createProgressStore(browserStorage());
    const saved = store.load(entry.id, grid);
    if (saved !== null) {
      board = createBoard(grid.edgeCount, saved.edges);
      watch = createStopwatch(saved.elapsedMs);
    }
    now = performance.now();
    if (!analyzeBoard(puzzle, board.edges).solved) watch = start(watch, now);
    ready = true;

    const tick = setInterval(() => {
      now = performance.now();
    }, 250);
    // Leaving the tab pauses the clock (and hides the board) and saves, since a phone may never
    // come back to this page.
    const onvisibility = () => {
      if (document.visibilityState === "hidden") {
        setPaused(true);
        save();
      }
    };
    document.addEventListener("visibilitychange", onvisibility);
    window.addEventListener("pagehide", save);
    return () => {
      clearInterval(tick);
      wideQuery.removeEventListener("change", onwide);
      document.removeEventListener("visibilitychange", onvisibility);
      window.removeEventListener("pagehide", save);
      save();
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
    <b>{analysis.satisfiedClues}</b> of {analysis.clueCount} clues satisfied
  </p>

  <main class="play">
    <div
      class="stage"
      bind:clientWidth={stageWidth}
      bind:clientHeight={stageHeight}
      style:min-height="{stageMinHeight}px"
    >
      {#if layout}
        <div class="frame" style:width="{layout.width + FRAME}px" style:height="{layout.height + FRAME}px">
          {#if paused}
            <div class="paused">
              <span class="paused-title">一時停止</span>
              <span class="paused-text">Paused — the board is hidden while the clock is stopped.</span>
              <button type="button" class="primary" onclick={() => setPaused(false)}>Resume</button>
            </div>
          {:else}
            <BoardView {puzzle} edges={board.edges} {analysis} {layout} {locked} onedit={edit} />
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
              <span class="soft">Saved on this device.</span>
            </div>
            <button type="button" class="primary" onclick={startOver}>Start over</button>
          </div>
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

      {#if !solved}
        <ToolBar
          canUndo={!locked && board.past.length > 0}
          canRedo={!locked && board.future.length > 0}
          canClear={!locked && hasMarks(board)}
          onundo={() => run({ type: "undo" })}
          onredo={() => run({ type: "redo" })}
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
          <dt>P</dt><dd>pause</dd>
          <dt>Mouse</dt><dd>click to cycle, drag to draw a run</dd>
        </dl>
      </section>
    </div>
  </main>
</div>

<style>
  .screen {
    min-height: 100dvh;
    max-width: 1280px;
    margin: 0 auto;
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 10px;
    overscroll-behavior: none;
  }

  .bar {
    height: 52px;
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
      padding-block: 8px calc(8px + env(safe-area-inset-bottom));
      gap: 8px;
    }

    .bar {
      height: 48px;
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
      padding: 20px 24px 32px;
      gap: 14px;
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
