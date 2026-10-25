<script lang="ts">
  import { createGrid } from "@loophole/core";
  import { onMount } from "svelte";
  import SiteHeader from "$lib/components/SiteHeader.svelte";
  import { browserStorage, createProgressStore } from "$lib/game/progress.ts";
  import { formatClock } from "$lib/game/timer.ts";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  type Status = { kind: "new" } | { kind: "playing" | "solved"; clock: string };
  let statuses: Record<string, Status> = $state({});

  onMount(() => {
    const store = createProgressStore(browserStorage());
    for (const p of data.puzzles) {
      const saved = store.load(p.id, createGrid(p.width, p.height));
      statuses[p.id] =
        saved === null
          ? { kind: "new" }
          : { kind: saved.solved ? "solved" : "playing", clock: formatClock(saved.elapsedMs) };
    }
  });

  // Pale cover tints per size class (design kit, Colour). Text on covers is always ink.
  function tint(width: number): string {
    if (width <= 7) return "#F2C4CE";
    if (width <= 10) return "#E8DFC4";
    if (width <= 20) return "#C8DAE6";
    return "#D5E3C2";
  }
</script>

<svelte:head>
  <title>Loophole</title>
</svelte:head>

<SiteHeader />

<main class="page">
  <h1>Practice puzzles</h1>
  <ul class="covers">
    {#each data.puzzles as p (p.id)}
      {@const status = statuses[p.id] ?? { kind: "new" }}
      <li>
        <a class="cover" href="/play/{p.id}" style:background={tint(p.width)}>
          <span class="badge">{p.width}×{p.height}</span>
          <span class="kana">スリザーリンク</span>
          <span class="name">{p.name}</span>
          <span class="paper" aria-hidden="true"></span>
          <span class="status">
            {#if status.kind === "solved"}
              <span class="stamp" aria-hidden="true">完</span>Solved · {status.clock}
            {:else if status.kind === "playing"}
              <span class="dot" aria-hidden="true"></span>In progress · {status.clock}
            {:else}
              <span class="dot hollow" aria-hidden="true"></span>New · not started
            {/if}
          </span>
        </a>
      </li>
    {/each}
  </ul>
</main>

<style>

  .page {
    max-width: 960px;
    margin: 0 auto;
    padding: 16px 16px calc(24px + env(safe-area-inset-bottom));
  }

  h1 {
    margin: 0 0 14px;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 32px;
    line-height: 1.15;
  }

  .covers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px;
  }

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

  .cover:hover {
    color: #1e1c19;
    outline: 2px solid #1e1c19;
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
    background-size: 12px 12px;
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
