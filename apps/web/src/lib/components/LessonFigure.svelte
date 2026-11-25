<script lang="ts">
  import type { Frame } from "../techniques/lessons.ts";
  import RulePattern from "./RulePattern.svelte";

  interface Props {
    frames: readonly Frame[];
    /** The technique's name, for the step buttons' labels. */
    name: string;
  }

  let { frames, name }: Props = $props();

  let at = $state(0);
  const frame = $derived(frames[at]);
  const count = $derived(frames.length);
</script>

<!-- A technique walked through a picture at a time. The picture is hidden from screen readers; the
     caption says what it shows and is read out when the step changes. -->
<figure class="lesson">
  <RulePattern pattern={frame} size={168} />
  <figcaption>
    <p class="caption" aria-live="polite">{frame.caption}</p>
    <div class="controls">
      <button
        type="button"
        aria-label="Previous step of {name}"
        disabled={at === 0}
        onclick={() => (at -= 1)}
        ><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
          ><path d="M15 5l-7 7 7 7" /></svg
        ></button
      >
      <span class="count">Step {at + 1} of {count}</span>
      <button
        type="button"
        aria-label="Next step of {name}"
        disabled={at === count - 1}
        onclick={() => (at += 1)}
        ><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
          ><path d="M9 5l7 7-7 7" /></svg
        ></button
      >
    </div>
  </figcaption>
</figure>

<style>
  .lesson {
    margin: 0;
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }

  figcaption {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* Room for the longest caption, so the buttons stay put while stepping. */
  .caption {
    margin: 0;
    min-height: calc(4 * 1.45em);
    font-size: 15px;
    line-height: 1.45;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .count {
    font-size: 13px;
    font-weight: 700;
    color: var(--ink-soft);
    font-variant-numeric: tabular-nums;
  }

  /* Previous and next, like the hint card's paging arrows. */
  button {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    padding: 0;
    border-radius: 999px;
    border: 2px solid var(--ai);
    background: transparent;
    color: var(--ai);
    cursor: pointer;
  }

  button:disabled {
    border-color: var(--disabled);
    color: var(--disabled);
    cursor: default;
  }

  /* Phones: the picture above its words. */
  @media (max-width: 559px) {
    .lesson {
      flex-direction: column;
      align-items: center;
    }

    figcaption {
      align-self: stretch;
    }

    .controls {
      justify-content: center;
    }
  }
</style>
