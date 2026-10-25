<script lang="ts">
  interface Props {
    canUndo: boolean;
    canRedo: boolean;
    canClear: boolean;
    onundo: () => void;
    onredo: () => void;
    onclear: () => void;
  }

  let { canUndo, canRedo, canClear, onundo, onredo, onclear }: Props = $props();
</script>

<!-- Phones: the tray under the board from the Play artboard. Wide screens: the button grid from the
     Desktop artboard, with keyboard shortcuts shown. -->
<nav class="tools" aria-label="Puzzle tools">
  <button type="button" disabled={!canUndo} onclick={onundo}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      ><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg
    >Undo <kbd>Z</kbd>
  </button>
  <button type="button" disabled={!canRedo} onclick={onredo}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      ><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg
    >Redo <kbd>Y</kbd>
  </button>
  <button type="button" disabled={!canClear} onclick={onclear}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      ><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg
    >Clear
  </button>
</nav>

<style>
  .tools {
    height: 68px;
    background: var(--sheet);
    border: 2px solid var(--ink);
    border-radius: 12px;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    padding: 4px;
  }

  button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 56px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--ink);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  button:disabled {
    color: var(--disabled);
    cursor: default;
  }

  kbd {
    display: none;
    font-family: inherit;
    font-size: 12px;
    padding: 1px 6px;
    border: 1.5px solid var(--hairline);
    border-radius: 4px;
    color: var(--ink-soft);
  }

  @media (min-width: 900px) {
    .tools {
      height: auto;
      padding: 0;
      border: 0;
      background: none;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    button {
      flex-direction: row;
      gap: 8px;
      height: 52px;
      border: 2px solid var(--ink);
      background: var(--sheet);
      font-size: 15px;
    }

    button:disabled {
      border-color: var(--hairline);
    }

    svg {
      display: none;
    }

    kbd {
      display: inline;
    }
  }
</style>
