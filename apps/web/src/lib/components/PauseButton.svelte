<script lang="ts">
  interface Props {
    paused: boolean;
    disabled?: boolean;
    ontoggle: () => void;
  }

  let { paused, disabled = false, ontoggle }: Props = $props();
</script>

<button
  type="button"
  class="pause"
  aria-label={paused ? "Resume" : "Pause"}
  {disabled}
  onclick={ontoggle}
>
  {#if paused}
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"
      ><path d="M4 2.5v9l7.5-4.5z" fill="currentColor" /></svg
    >
  {:else}
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"
      ><path d="M4 2v10M10 2v10" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" /></svg
    >
  {/if}
</button>

<style>
  .pause {
    width: 32px;
    height: 32px;
    flex: 0 0 auto;
    border-radius: 50%;
    border: 0;
    padding: 0;
    background: var(--ink);
    color: var(--on-ink);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .pause:disabled {
    background: var(--disabled);
    cursor: default;
  }
</style>
