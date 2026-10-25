<script lang="ts">
  interface Props {
    canUndo: boolean;
    canRedo: boolean;
    canHint: boolean;
    canClear: boolean;
    onundo: () => void;
    onredo: () => void;
    onhint: () => void;
    onclear: () => void;
  }

  let { canUndo, canRedo, canHint, canClear, onundo, onredo, onhint, onclear }: Props = $props();
</script>

<!-- Phones: the tray under the board from the Play artboard. Wide screens: the button grid from the
     Desktop artboard, with keyboard shortcuts shown. Hint is in ai, as on both. -->
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
  <button type="button" class="hint" disabled={!canHint} onclick={onhint}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      ><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z" /></svg
    >Hint <kbd>H</kbd>
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
    grid-template-columns: repeat(4, minmax(0, 1fr));
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

  .hint {
    color: var(--ai);
  }

  button:disabled {
    color: var(--disabled);
    cursor: default;
  }

  kbd {
    display: none;
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

    .hint {
      border-color: var(--ai);
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
