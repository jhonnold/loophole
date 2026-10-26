<script lang="ts">
  import { LEVELS, type Level } from "@loophole/core";
  import { onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { generator, jobStatusText, levelName, NEW_PUZZLE_SIZES } from "../puzzles/index.ts";

  let size = $state(7);
  let level = $state<Level>("hard");
  let busy = $state(false);
  let status = $state("");
  let error = $state("");
  // Stops following the job when Home is left; the worker still makes the puzzle.
  const controller = new AbortController();
  onDestroy(() => controller.abort());

  async function make() {
    if (busy) return;
    busy = true;
    error = "";
    status = "Asking for a puzzle…";
    const result = await generator.generate(size, size, level, {
      signal: controller.signal,
      onJob: (job) => {
        status = jobStatusText(job);
      },
    });
    if (controller.signal.aborted) return;
    busy = false;
    status = "";
    if (result.ok) await goto(`/play/${encodeURIComponent(result.puzzleId)}`);
    else error = result.message;
  }
</script>

<!-- A new practice puzzle from the worker (Home artboard, Practice: size chips and "New 7×7
     puzzle"), with a level to choose (PRD FR-7). -->
<div class="new-puzzle">
  <fieldset class="choices">
    <legend class="visually-hidden">Size</legend>
    {#each NEW_PUZZLE_SIZES as s (s)}
      <button type="button" class="chip" aria-pressed={s === size} disabled={busy} onclick={() => (size = s)}>{s}×{s}</button>
    {/each}
  </fieldset>
  <fieldset class="choices">
    <legend class="visually-hidden">Level</legend>
    {#each LEVELS as l (l)}
      <button type="button" class="chip" aria-pressed={l === level} disabled={busy} onclick={() => (level = l)}>{levelName(l)}</button>
    {/each}
  </fieldset>
  <!-- aria-disabled, not disabled, so keyboard focus stays on the button while it works. -->
  <button type="button" class="primary" aria-disabled={busy} onclick={make}>New {levelName(level).toLowerCase()} {size}×{size} puzzle</button>
  <!-- Always rendered, so a screen reader is already watching it when the text arrives. -->
  <p class="soft" role="status">{status}</p>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
  .new-puzzle {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .choices {
    margin: 0;
    padding: 0 0 2px;
    border: 0;
    min-width: 0;
    display: flex;
    gap: 8px;
    overflow-x: auto;
  }

  /* Size and level chips, as on the leaderboard page (Home artboard, Practice). */
  .chip {
    flex: 0 0 auto;
    height: 44px;
    padding: 0 14px;
    border-radius: 8px;
    border: 2px solid var(--hairline);
    background: var(--sheet);
    color: var(--ink);
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    touch-action: manipulation;
  }

  .chip[aria-pressed="true"] {
    border-color: var(--ink);
    background: var(--ink);
    color: var(--on-ink);
  }

  .primary {
    align-self: flex-start;
    height: 48px;
    padding: 0 28px;
    border: 0;
    border-radius: 999px;
    background: var(--ink);
    color: var(--on-ink);
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    touch-action: manipulation;
  }

  .primary[aria-disabled="true"],
  .chip:disabled {
    cursor: default;
  }

  .primary[aria-disabled="true"] {
    opacity: 0.6;
  }

  .soft {
    margin: 0;
    font-size: 14px;
    color: var(--ink-soft);
  }

  /* Empty, the live region takes no room: cancel the gap above it. */
  .soft:empty {
    margin-bottom: -10px;
  }

  .error {
    margin: 0;
    padding: 10px 12px;
    border-left: 4px solid var(--shu);
    background: var(--sheet);
  }
</style>
