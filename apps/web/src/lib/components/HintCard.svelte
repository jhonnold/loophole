<script lang="ts">
  import type { Grid } from "@loophole/core";
  import { onMount } from "svelte";
  import type { HintView } from "../game/hint.ts";
  import { edgeLabel } from "../game/keyboard.ts";
  import { RULE_PATTERNS } from "../game/patterns.ts";
  import RulePattern from "./RulePattern.svelte";

  interface Props {
    grid: Grid;
    view: HintView;
    /** The page on show, from 0; the player steps through the pages from the first. */
    page: number;
    onapply: () => void;
    /** Closes the card; the hint stays drawn on the board until the move is made. */
    onlater: () => void;
  }

  let { grid, view, page = $bindable(), onapply, onlater }: Props = $props();

  let applyButton: HTMLButtonElement | undefined = $state();
  let backButton: HTMLButtonElement | undefined = $state();
  let nextButton: HTMLButtonElement | undefined = $state();
  // The card takes the tray's place, so focus moves to its first action (NFR-5).
  onMount(() => applyButton?.focus());

  const count = $derived(view.pages.length);
  const current = $derived(view.pages[page]);
  const pattern = $derived(current.rule === null ? undefined : RULE_PATTERNS[current.rule]);

  // Paging keeps focus on the pressed button; at either end, where that button is disabled, focus
  // moves to the other one.
  function go(to: number) {
    page = to;
    if (to === 0) nextButton?.focus();
    else if (to === count - 1) backButton?.focus();
  }
  // The board is a picture to screen readers, so the card also says where the move is.
  const where = $derived(view.apply.map(([e, s]) => edgeLabel(grid, e, s)).join("; "));
</script>

<!-- Hint artboard: replaces the tool tray; the rule's pattern is drawn small beside the words, which
     flow under it when they run long, so the card stays short enough for a phone. A hint with steps
     before its line pages through them, from the first, with arrows either side of the actions. -->
<section class="hint" aria-labelledby="hint-title">
  <div class="body">
    {#if pattern}
      <figure>
        <RulePattern {pattern} />
        <figcaption>the pattern</figcaption>
      </figure>
    {/if}
    <span class="eyebrow">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        ><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z" /></svg
      >
      ヒント · {view.eyebrow}
    </span>
    <!-- Paging reads out the new step. -->
    <div class="step" aria-live="polite">
      <h2 id="hint-title">{current.title}</h2>
      <p class="text" id="hint-text">{current.text}</p>
      {#if count > 1}<p class="count" id="hint-count">Step {page + 1} of {count}</p>{/if}
    </div>
    <p class="visually-hidden" id="hint-move">Move: {where}.</p>
  </div>
  <div class="actions">
    {#if count > 1}
      <button
        type="button"
        class="page"
        aria-label="Previous step"
        bind:this={backButton}
        disabled={page === 0}
        onclick={() => go(page - 1)}
        ><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
          ><path d="M15 5l-7 7 7 7" /></svg
        ></button
      >
    {/if}
    <button
      type="button"
      class="apply"
      bind:this={applyButton}
      aria-describedby={count > 1
        ? "hint-count hint-title hint-text hint-move"
        : "hint-title hint-text hint-move"}
      onclick={onapply}>{view.applyLabel}</button
    >
    <button type="button" class="later" onclick={onlater}>{view.laterLabel}</button>
    {#if count > 1}
      <button
        type="button"
        class="page"
        aria-label="Next step"
        bind:this={nextButton}
        disabled={page === count - 1}
        onclick={() => go(page + 1)}
        ><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
          ><path d="M9 5l7 7-7 7" /></svg
        ></button
      >
    {/if}
  </div>
</section>

<style>
  .hint {
    background: var(--sheet);
    border: 2px solid var(--ai);
    border-radius: 10px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* A block (not flex) box, so the words wrap around the floated figure. */
  .body {
    display: flow-root;
  }

  .eyebrow {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
    color: var(--ai);
    font-size: 13px;
    font-weight: 700;
  }

  h2 {
    margin: 0 0 4px;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 20px;
    line-height: 1.2;
  }

  .text {
    margin: 0;
    font-size: 15px;
    line-height: 1.45;
  }

  /* Which step is on show, just above the arrows that page through them. */
  .count {
    margin: 4px 0 0;
    font-size: 13px;
    font-weight: 700;
    line-height: 1.35;
    color: var(--ink-soft);
  }

  figure {
    float: right;
    margin: 0 0 4px 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  figcaption {
    font-size: 12px;
    color: var(--ink-soft);
  }

  .actions {
    display: flex;
    gap: 10px;
  }

  button {
    flex: 1 1 0;
    height: 48px;
    border-radius: 999px;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
  }

  .apply {
    border: 0;
    background: var(--ai);
    color: var(--on-ink);
  }

  .later {
    border: 2px solid var(--ink);
    background: transparent;
    color: var(--ink);
  }

  /* Previous and next step: round, as tall as the other buttons. */
  .page {
    flex: none;
    width: 48px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 2px solid var(--ai);
    background: transparent;
    color: var(--ai);
  }

  .page:disabled {
    border-color: var(--disabled);
    color: var(--disabled);
    cursor: default;
  }

  /* Phones: a 56px figure without its caption, 14px words and 44px
     buttons, so the longest hint still fits under a 7×7 board on the Play artboard's 390×664. */
  @media (max-width: 899px) {
    .hint {
      padding: 8px 12px;
      gap: 6px;
    }

    .eyebrow,
    h2 {
      margin-bottom: 2px;
    }

    .text {
      font-size: 14px;
      line-height: 1.35;
    }

    .count {
      margin-top: 0;
      font-size: 12px;
      line-height: 1.25;
    }

    figure > :global(svg) {
      width: 56px;
      height: 56px;
    }

    figcaption {
      display: none;
    }

    .actions {
      gap: 8px;
    }

    button {
      height: 44px;
      font-size: 15px;
    }

    .page {
      width: 44px;
    }
  }

  /* The smallest phones (Small artboard, 360×560): no figure, the eyebrow only for screen
     readers (the title says what kind of hint it is), 13px words. */
  @media (max-width: 899px) and (max-height: 620px) {
    .hint {
      gap: 4px;
    }

    h2 {
      margin-bottom: 0;
      font-size: 18px;
    }

    figure {
      display: none;
    }

    .eyebrow {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }

    .text {
      font-size: 13px;
      line-height: 1.3;
    }

    .count {
      line-height: 1.2;
    }
  }
</style>
