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
    onapply: () => void;
    /** Closes the card; the hint stays drawn on the board until the move is made. */
    onlater: () => void;
  }

  let { grid, view, onapply, onlater }: Props = $props();

  let applyButton: HTMLButtonElement | undefined = $state();
  // The card takes the tray's place, so focus moves to its first action (NFR-5).
  onMount(() => applyButton?.focus());

  const pattern = $derived(view.rule === null ? undefined : RULE_PATTERNS[view.rule]);
  // The board is a picture to screen readers, so the card also says where the move is.
  const where = $derived(view.apply.map(([e, s]) => edgeLabel(grid, e, s)).join("; "));
</script>

<!-- Hint artboard: replaces the tool tray; the rule's pattern is drawn small beside the words, which
     flow under it when they run long, so the card stays short enough for a phone. -->
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
    <h2 id="hint-title">{view.title}</h2>
    <p class="text" id="hint-text">{view.text}</p>
    <p class="visually-hidden" id="hint-move">Move: {where}.</p>
  </div>
  <div class="actions">
    <button
      type="button"
      class="apply"
      bind:this={applyButton}
      aria-describedby="hint-title hint-text hint-move"
      onclick={onapply}>{view.applyLabel}</button
    >
    <button type="button" class="later" onclick={onlater}>{view.laterLabel}</button>
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

  /* Phones: a 56px figure without its caption, 14px words and 44px buttons, so the longest hint
     still fits under a 7×7 board on the Play artboard's 390×664. */
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

    figure > :global(svg) {
      width: 56px;
      height: 56px;
    }

    figcaption {
      display: none;
    }

    button {
      height: 44px;
      font-size: 15px;
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
  }
</style>
