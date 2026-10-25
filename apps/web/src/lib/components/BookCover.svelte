<script lang="ts">
  import { coverTint } from "../daily/days.ts";
  import type { CoverStatus } from "../daily/view.ts";

  interface Props {
    /** Where the cover goes; null for a puzzle that can't be opened yet. */
    href: string | null;
    width: number;
    height: number;
    name: string;
    status: CoverStatus;
  }

  let { href, width, height, name, status }: Props = $props();

  // The dot paper gets finer for bigger boards (Home artboard: 12px, then 8px and 5px).
  const dots = $derived(width >= 40 ? 5 : width >= 20 ? 8 : 12);
</script>

<!-- A puzzle as a pocket-book cover (Home artboard): tint per size class, size badge, name, dot
     paper and a status line. Text on covers is always ink, in both themes. -->
<svelte:element
  this={href === null ? "div" : "a"}
  class="cover"
  class:disabled={href === null}
  href={href ?? undefined}
  style:background={coverTint(width)}
  style:--dots="{dots}px"
>
  <span class="badge">{width}×{height}</span>
  <span class="kana">スリザーリンク</span>
  <span class="name">{name}</span>
  <span class="paper" aria-hidden="true"></span>
  <span class="status">
    {#if status.kind === "solved"}
      <span class="stamp" aria-hidden="true">完</span>
    {:else if status.kind === "playing"}
      <span class="dot" aria-hidden="true"></span>
    {:else}
      <span class="dot hollow" aria-hidden="true"></span>
    {/if}
    {status.text}
  </span>
</svelte:element>

<style>
  .cover {
    position: relative;
    height: 184px;
    padding: 12px;
    border-radius: 6px;
    color: #1e1c19;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  a.cover:hover {
    color: #1e1c19;
    outline: 2px solid #1e1c19;
  }

  .disabled {
    opacity: 0.6;
  }

  .badge {
    position: absolute;
    top: 0;
    right: 0;
    padding: 5px 9px;
    border-radius: 0 6px 0 6px;
    background: #23355e;
    color: #fffdf8;
    font-size: 13px;
    font-weight: 700;
  }

  .kana {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
  }

  .name {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 24px;
    line-height: 1;
  }

  .paper {
    flex: 1 1 auto;
    border: 2px solid #1e1c19;
    background-color: #fffdf8;
    background-image: radial-gradient(#1e1c19 1.3px, transparent 1.6px);
    background-size: var(--dots) var(--dots);
    background-position: 4px 4px;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 700;
  }

  .dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #2e4c8a;
  }

  .dot.hollow {
    background: none;
    border: 1.5px solid #1e1c19;
  }

  .stamp {
    flex: 0 0 auto;
    width: 18px;
    height: 18px;
    border: 2px solid #c23b22;
    border-radius: 4px;
    color: #c23b22;
    font-family: var(--font-display);
    font-size: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
