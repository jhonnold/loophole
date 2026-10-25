<script lang="ts">
  import type { VerifyStatus } from "@loophole/core";
  import { onMount } from "svelte";
  import { auth } from "../auth/index.ts";
  import { suggestClue } from "../editor/answers.ts";
  import { type CheckResult, LiveChecker } from "../editor/checker.ts";
  import {
    type Brush,
    brushEdit,
    clearClues,
    clueCount,
    createDraft,
    DEFAULT_SIZE,
    type Draft,
    draftPuzzle,
    editCell,
    loadDraft,
    parseSize,
    resizeDraft,
    saveDraft,
  } from "../editor/draft.ts";
  import { submissions } from "../editor/index.ts";
  import { type SubmitResult, shareUrl, verdictText } from "../editor/submit.ts";
  import { fitLayout, MAX_CELL, POINTER_MIN_CELL, TOUCH_MIN_CELL } from "../game/geometry.ts";
  import { browserStorage } from "../game/progress.ts";
  import { clampView, type View, viewLayout, zoomLimits } from "../game/viewport.ts";
  import AnswerFigure from "./AnswerFigure.svelte";
  import EditorBoard from "./EditorBoard.svelte";

  let draft: Draft = $state.raw(createDraft());
  let widthText = $state(String(DEFAULT_SIZE));
  let heightText = $state(String(DEFAULT_SIZE));
  let brush: Brush = $state(null);
  let ready = $state(false);
  const puzzle = $derived(draftPuzzle(draft));
  const grid = $derived(puzzle.grid);
  const clues = $derived(clueCount(draft));

  // Live feedback (FR-26): "checking" from the edit until the worker answers for that draft.
  let result = $state.raw<CheckResult | null>(null);
  const status: VerifyStatus | "checking" = $derived(result?.status ?? "checking");
  let checker: LiveChecker | null = null;
  // Aborted when the editor is left, so a publish still waiting for its verdict stops polling.
  const leaving = new AbortController();

  const answers = $derived(
    result?.status === "multiple" && result.solutions.length === 2 ? result.solutions : null,
  );
  const suggestion = $derived(answers === null ? null : suggestClue(puzzle, answers[0], answers[1]));
  const highlight = $derived(suggestion === null ? [] : [suggestion.cell]);

  const VERDICTS: Record<VerifyStatus | "checking", { title: string; text: string }> = {
    checking: { title: "Checking…", text: "The verifier is looking for answers to your clues." },
    unique: {
      title: "Exactly one answer",
      text: "Only one loop fits your clues. It's ready to publish.",
    },
    none: { title: "No answer", text: "No single loop fits these clues. Check for a clue too many." },
    multiple: { title: "More than one answer", text: "These two loops both fit your clues." },
    unknown: {
      title: "Too open to check",
      text: "This browser couldn't settle it in time. Add clues; on publishing, the server tries for longer.",
    },
  };
  const verdict = $derived(VERDICTS[status]);

  // Publishing (FR-27).
  let publishing = $state(false);
  let outcome = $state.raw<SubmitResult | null>(null);
  let copied = $state(false);
  const canPublish = $derived(status === "unique" || status === "unknown");

  async function publish() {
    publishing = true;
    outcome = null;
    copied = false;
    const sent = draft;
    let r = await submissions.submit(puzzle);
    if (r.ok && r.submission.status === "pending") {
      r = await submissions.waitFor(r.submission.id, { signal: leaving.signal });
    }
    // An edit while waiting clears the card; the account page still lists the submission.
    if (draft === sent) outcome = r;
    publishing = false;
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      copied = false;
    }
  }

  function update(next: Draft) {
    if (next === draft) return;
    draft = next;
    outcome = null;
  }

  // Sizes apply on change (Enter, leaving the field, the spinner), not on every keystroke: typing
  // "12" must not pass through 1, which would drop every column but the first.
  function setSize(w: string, h: string) {
    const width = parseSize(w);
    const height = parseSize(h);
    if (width === null || height === null) return;
    if (width !== draft.width || height !== draft.height) zoomed = null;
    update(resizeDraft(draft, width, height));
  }

  function pick(value: Brush) {
    brush = brush === value ? null : value;
  }

  // Every change is checked and saved on this device.
  $effect(() => {
    const p = puzzle;
    if (!ready) return;
    result = null;
    checker?.check(p);
    saveDraft(browserStorage(), draft);
  });

  // Board sizing: the board fits its column's width, and zooms when cells would be too small.
  let stageWidth = $state(0);
  let windowHeight = $state(0);
  let coarse = $state(false);
  const FRAME = 4;
  const minCell = $derived(coarse ? TOUCH_MIN_CELL : POINTER_MIN_CELL);
  const roomWidth = $derived(stageWidth - FRAME);
  const roomHeight = $derived(Math.max(5 * minCell, windowHeight - 160));
  let zoomed: View | null = $state.raw(null);
  const frame = $derived.by(() => {
    if (stageWidth <= 0) return null;
    const fitted = fitLayout(grid.width, grid.height, roomWidth, roomHeight, minCell, MAX_CELL);
    if (fitted.cell >= minCell) {
      return {
        layout: fitted,
        view: { cell: fitted.cell, x: 0, y: 0 },
        port: { width: fitted.width, height: fitted.height },
        zoom: null,
      };
    }
    const port = {
      width: roomWidth,
      height: Math.min(roomHeight, viewLayout(grid, minCell).height),
    };
    const zoom = zoomLimits(grid, port);
    const view = clampView(grid, zoomed ?? { cell: minCell, x: 0, y: 0 }, port, zoom);
    return { layout: viewLayout(grid, view.cell), view, port, zoom };
  });

  onMount(() => {
    coarse = matchMedia("(pointer: coarse)").matches;
    const saved = loadDraft(browserStorage());
    if (saved !== null) {
      draft = saved;
      widthText = String(saved.width);
      heightText = String(saved.height);
    }
    checker = new LiveChecker({
      createWorker: () =>
        new Worker(new URL("../editor/verify.worker.ts", import.meta.url), { type: "module" }),
      onresult: (r) => {
        result = r;
      },
    });
    ready = true;
    return () => {
      checker?.dispose();
      leaving.abort();
    };
  });
</script>

<svelte:window bind:innerHeight={windowHeight} />

<main class="editor">
  <div class="heading">
    <h1>New puzzle</h1>
    <span class="lede">作問 · place clues; the verifier checks every change</span>
  </div>

  <div class="columns">
    <aside class="tools">
      <section class="card" aria-labelledby="size-h">
        <h2 id="size-h">Grid size</h2>
        <div class="size">
          <label>
            Width
            <input
              type="number"
              min="1"
              max="100"
              inputmode="numeric"
              bind:value={widthText}
              onchange={() => setSize(widthText, heightText)}
              onblur={() => (widthText = String(draft.width))}
            />
          </label>
          <span class="times" aria-hidden="true">×</span>
          <label>
            Height
            <input
              type="number"
              min="1"
              max="100"
              inputmode="numeric"
              bind:value={heightText}
              onchange={() => setSize(widthText, heightText)}
              onblur={() => (heightText = String(draft.height))}
            />
          </label>
        </div>
        <span class="note">Up to 100 per side.</span>
      </section>

      <section class="card" aria-labelledby="clue-h">
        <h2 id="clue-h">Clue</h2>
        <fieldset class="palette">
          <legend class="visually-hidden">Clue to place</legend>
          {#each [0, 1, 2, 3] as const as n (n)}
            <button type="button" aria-pressed={brush === n} onclick={() => pick(n)}>{n}</button>
          {/each}
          <button type="button" aria-label="Erase clue" aria-pressed={brush === "erase"} onclick={() => pick("erase")}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20H9L4 15l10-10 7 7-6 6" /></svg>
          </button>
        </fieldset>
        <span class="note">
          Tap a cell to cycle 0–3, or pick a clue to place it. On a keyboard, move with the arrows
          and type 0–3; Backspace erases.
        </span>
      </section>

      <button type="button" class="outline" disabled={clues === 0} onclick={() => update(clearClues(draft))}>
        Clear all clues
      </button>
    </aside>

    <section class="grid-col" aria-label="Puzzle grid">
      <div class="stage" bind:clientWidth={stageWidth}>
        {#if frame}
          <div class="frame" style:width="{frame.port.width + FRAME}px" style:height="{frame.port.height + FRAME}px">
            {#key `${grid.width}x${grid.height}`}
              <EditorBoard
                {puzzle}
                {highlight}
                layout={frame.layout}
                view={frame.view}
                port={frame.port}
                zoom={frame.zoom}
                ontap={(cell) => update(editCell(draft, cell, brushEdit(brush)))}
                onkey={(cell, edit) => update(editCell(draft, cell, edit))}
                onview={(v) => (zoomed = v)}
              />
            {/key}
          </div>
        {/if}
      </div>
      <span class="caption">
        {clues} {clues === 1 ? "clue" : "clues"} · {draft.width}×{draft.height} · draft saved on this device
        {#if frame?.zoom}· pinch or use +/− to zoom{/if}
      </span>
    </section>

    <aside class="side">
      <section class="card verifier" aria-labelledby="verdict-h">
        <div class="verifier-head">
          <h2 id="verdict-h">Verifier</h2>
          <span class="live"><span class="live-dot" class:busy={status === "checking"} aria-hidden="true"></span>live</span>
        </div>
        <ol class="statuses" aria-label="Possible results">
          {#each ["unique", "multiple", "none", "unknown"] as const as s (s)}
            <li class={s} aria-current={status === s ? "true" : undefined}>
              {#if status === s}<span class="pip" aria-hidden="true">●</span>{/if}{s}
            </li>
          {/each}
        </ol>
        <div class="verdict" role="status">
          <span class="verdict-title">{verdict.title}</span>
          <span class="verdict-text">{verdict.text}</span>
        </div>
        {#if answers}
          <div class="answers">
            <AnswerFigure {grid} edges={answers[0]} highlight={suggestion?.cell ?? null} name="Answer A" />
            <AnswerFigure {grid} edges={answers[1]} highlight={suggestion?.cell ?? null} name="Answer B" />
          </div>
          <p class="suggestion">
            {#if suggestion}
              <b>Suggestion:</b> a <b>{suggestion.clue}</b> in the highlighted cell rules out Answer B.
            {:else}
              <b>Suggestion:</b> no single new clue tells these apart; change one of your clues.
            {/if}
          </p>
        {/if}

        {#if $auth.status !== "user"}
          <a class="publish link" href="/login">Log in to publish</a>
        {:else if !$auth.user.emailVerified}
          <a class="publish link" href="/account">Confirm your email to publish</a>
        {:else}
          <button type="button" class="publish" disabled={!canPublish || publishing} onclick={publish}>
            {#if publishing}
              Checking on the server…
            {:else if status === "none" || status === "multiple"}
              Publish — needs a unique answer
            {:else if status === "unknown"}
              Publish — the server checks for longer
            {:else}
              Publish
            {/if}
          </button>
        {/if}

        {#if outcome}
          {#if !outcome.ok}
            <p class="result error" role="alert">{outcome.message}</p>
          {:else if outcome.submission.verdict}
            {@const words = verdictText(outcome.submission.verdict)}
            {@const id = outcome.submission.puzzleId}
            <div class="result" class:error={id === null} role="status">
              <b>{words.title}</b>
              <span>{words.text}</span>
              {#if id !== null}
                {@const url = shareUrl(location.origin, id)}
                <input class="share" readonly value={url} aria-label="Link to share" onfocus={(e) => e.currentTarget.select()} />
                <div class="result-actions">
                  <button type="button" class="outline small" onclick={() => copy(url)}>{copied ? "Copied" : "Copy link"}</button>
                  <a class="outline small" href="/play/{id}">Play it</a>
                </div>
              {/if}
            </div>
          {/if}
        {/if}
      </section>
      <p class="aside-note">
        Unique puzzles publish straight away. “Unknown” means the verifier ran out of time proving it;
        try a smaller grid or more clues.
      </p>
    </aside>
  </div>
</main>

<style>
  .editor {
    max-width: 1280px;
    margin: 0 auto;
    padding: 20px 16px calc(32px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .heading {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px 16px;
  }

  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 28px;
  }

  .lede {
    font-size: 15px;
    font-weight: 500;
    color: var(--ink-soft);
  }

  .columns {
    display: flex;
    flex-wrap: wrap;
    gap: 20px 28px;
    align-items: flex-start;
  }

  .tools {
    flex: 1 1 220px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .grid-col {
    flex: 999 1 488px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .side {
    flex: 1 1 320px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .card {
    background: var(--sheet);
    border: 2px solid var(--ink);
    border-radius: 6px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  h2 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 18px;
  }

  .size {
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }

  .size label {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    font-weight: 700;
    color: var(--ink-soft);
  }

  .size input {
    height: 44px;
    width: 100%;
    border: 2px solid var(--ink);
    border-radius: 6px;
    background: var(--sheet);
    padding: 0 10px;
    font: inherit;
    font-size: 17px;
    font-weight: 700;
    color: var(--ink);
  }

  .times {
    height: 44px;
    display: flex;
    align-items: center;
    font-weight: 700;
  }

  .note,
  .caption,
  .aside-note {
    font-size: 13px;
    line-height: 1.5;
    color: var(--ink-soft);
  }

  .caption {
    font-size: 14px;
  }

  .aside-note {
    margin: 0;
  }

  .palette {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px;
  }

  .palette button {
    height: 48px;
    border-radius: 6px;
    border: 2px solid var(--hairline);
    background: var(--sheet);
    color: var(--ink);
    font-size: 22px;
    font-weight: 500;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
  }

  .palette button[aria-pressed="true"] {
    border-color: var(--ink);
    background: var(--ink);
    color: var(--on-ink);
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
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .outline:disabled {
    color: var(--disabled);
    border-color: var(--hairline);
    cursor: default;
  }

  .outline.small {
    height: 40px;
    padding: 0 16px;
    font-size: 14px;
  }

  .stage {
    width: 100%;
  }

  .frame {
    position: relative;
    background: var(--sheet);
    border: 2px solid var(--ink);
    box-shadow: 4px 4px 0 var(--frame-shadow);
  }

  .verifier {
    padding: 18px;
    gap: 14px;
  }

  .verifier-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .live {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--ink-soft);
  }

  .live-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ai);
  }

  .live-dot.busy {
    animation: pulse 1s ease-in-out infinite alternate;
  }

  @keyframes pulse {
    to {
      opacity: 0.25;
    }
  }

  .statuses {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }

  .statuses li {
    text-align: center;
    padding: 8px 2px;
    border-radius: 6px;
    border: 2px solid var(--hairline);
    font-size: 13px;
    font-weight: 700;
    color: var(--ink-soft);
  }

  .pip {
    display: block;
    font-size: 10px;
    line-height: 1.2;
  }

  /* The current result: shu for the ones that block publishing, ai for the others. */
  .statuses li[aria-current="true"] {
    border-color: var(--shu);
    background: color-mix(in srgb, var(--shu) 8%, transparent);
    color: var(--shu);
  }

  .statuses li.unique[aria-current="true"],
  .statuses li.unknown[aria-current="true"] {
    border-color: var(--ai);
    background: var(--ai-wash);
    color: var(--ai);
  }

  .verdict {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .verdict-title {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 22px;
  }

  .verdict-text {
    font-size: 15px;
    line-height: 1.5;
    color: var(--ink-soft);
  }

  .answers {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .suggestion {
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
    padding: 10px 12px;
    border-radius: 6px;
    background: var(--ai-wash);
  }

  .suggestion b:first-child {
    color: var(--ai);
  }

  .publish {
    height: 52px;
    border-radius: 999px;
    border: 0;
    background: var(--ink);
    color: var(--on-ink);
    font-size: 16px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .publish:disabled {
    background: var(--hairline);
    color: var(--ink-soft);
    cursor: default;
  }

  .publish.link:hover {
    color: var(--on-ink);
  }

  .result {
    margin: 0;
    padding: 12px 14px;
    border: 2px solid var(--ink);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 15px;
    line-height: 1.45;
  }

  .result.error {
    border-color: var(--shu);
  }

  .share {
    height: 40px;
    padding: 0 10px;
    border: 2px solid var(--hairline);
    border-radius: 6px;
    background: var(--ground);
    color: var(--ink);
    font: inherit;
    font-size: 14px;
  }

  .result-actions {
    display: flex;
    gap: 8px;
  }

  /* Phones: the grid first, then the verifier, then the size and clue tools. */
  @media (max-width: 899px) {
    .grid-col {
      order: -2;
    }

    .side {
      order: -1;
    }
  }

  @media (min-width: 900px) {
    .editor {
      padding: 28px 24px 40px;
      gap: 20px;
    }

    h1 {
      font-size: 34px;
    }

    .lede {
      font-size: 16px;
    }

    .tools {
      max-width: 260px;
    }

    .side {
      max-width: 380px;
    }

    .frame {
      box-shadow: 6px 6px 0 var(--frame-shadow);
    }
  }
</style>
