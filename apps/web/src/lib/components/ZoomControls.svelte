<script lang="ts">
  import { type View, ZOOM_STEP, type ZoomLimits } from "../game/viewport.ts";

  interface Props {
    view: View;
    limits: ZoomLimits;
    /** Zooms by `factor` around the middle of the viewport. */
    onzoom: (factor: number) => void;
  }

  let { view, limits, onzoom }: Props = $props();

  const percent = $derived(Math.round((view.cell / limits.min) * 100));
</script>

<!-- Zoom controls (Night artboard): bottom right of a zoomable board. -->
<div class="zoom">
  <button
    type="button"
    aria-label="Zoom out"
    disabled={view.cell <= limits.min}
    onclick={() => onzoom(1 / ZOOM_STEP)}
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
  </button>
  <span class="percent">{percent}%</span>
  <button
    type="button"
    aria-label="Zoom in"
    disabled={view.cell >= limits.max}
    onclick={() => onzoom(ZOOM_STEP)}
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg>
  </button>
</div>

<style>
  .zoom {
    position: absolute;
    right: 8px;
    bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px;
    background: color-mix(in srgb, var(--ground) 92%, transparent);
    border: 1.5px solid var(--hairline);
    border-radius: 999px;
    z-index: 1;
  }

  .zoom button {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 0;
    background: transparent;
    color: var(--ink);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
  }

  .zoom button:disabled {
    color: var(--disabled);
    cursor: default;
  }

  .percent {
    min-width: 40px;
    font-size: 13px;
    font-weight: 700;
    color: var(--ink-soft);
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
</style>
