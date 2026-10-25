<!-- The 完 seal stamped on the board when the puzzle is solved (Play and Solved artboards). -->
<div class="seal" role="img" aria-label="Solved">
  <span class="kanji" aria-hidden="true">完</span><span class="word" aria-hidden="true">SOLVED</span>
</div>

<style>
  .seal {
    position: absolute;
    right: -6px;
    top: -14px;
    width: 92px;
    height: 92px;
    border: 4px solid var(--shu);
    border-radius: 14px;
    background: color-mix(in srgb, var(--sheet) 85%, transparent);
    color: var(--shu);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    transform: rotate(-8deg);
    font-family: var(--font-display);
    line-height: 1;
    pointer-events: none;
    animation: stamp 300ms ease-out both;
  }

  .kanji {
    font-size: 44px;
    font-weight: 900;
  }

  .word {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    margin-top: 2px;
  }

  @keyframes stamp {
    from {
      opacity: 0;
      transform: translateY(-12px) rotate(-8deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .seal {
      animation: none;
    }
  }
</style>
