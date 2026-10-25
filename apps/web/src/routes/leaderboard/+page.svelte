<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { auth } from "$lib/auth/index.ts";
  import LeaderboardCard from "$lib/components/LeaderboardCard.svelte";
  import SiteHeader from "$lib/components/SiteHeader.svelte";
  import type { Leaderboard } from "$lib/daily/api.ts";
  import { DAILY_SIZES, sizeName } from "$lib/daily/days.ts";
  import { daily } from "$lib/daily/index.ts";

  // The board shown comes from the address, so it can be linked: ?size=10&scope=all.
  const asked = $derived(Number(page.url.searchParams.get("size")));
  const size = $derived(DAILY_SIZES.includes(asked) ? asked : 7);
  const scope = $derived(page.url.searchParams.get("scope") === "all" ? "all" : "today");

  let board = $state<Leaderboard | null | undefined>(undefined);
  let missing = $state(false);

  // Only the latest choice's answers are shown: a slower answer to an earlier choice is dropped.
  let loads = 0;

  async function load(forSize: number, forScope: string) {
    const token = ++loads;
    const latest = () => token === loads;
    board = undefined;
    missing = false;
    if (forScope === "all") {
      const result = await daily.bucketBoard(forSize * forSize);
      if (latest()) board = result;
      return;
    }
    const today = await daily.day();
    if (!latest()) return;
    const puzzleId = today?.puzzles.find((p) => p.size === forSize)?.puzzleId ?? null;
    if (today !== null && puzzleId === null) {
      missing = true;
      board = null;
      return;
    }
    const result = puzzleId === null ? null : await daily.puzzleBoard(puzzleId);
    if (latest()) board = result;
  }

  // Reload when the board chosen changes, and when who is logged in is known (their own row).
  $effect(() => {
    if ($auth.status !== "loading") void load(size, scope);
  });

  function choose(nextSize: number, nextScope: string) {
    const query = nextScope === "all" ? `?size=${nextSize}&scope=all` : `?size=${nextSize}`;
    void goto(`/leaderboard${query}`, { replaceState: true, keepFocus: true, noScroll: true });
  }
</script>

<svelte:head>
  <title>Leaderboard · Loophole</title>
</svelte:head>

<SiteHeader />

<main class="page">
  <h1>Leaderboards</h1>

  <fieldset class="choices">
    <legend class="visually-hidden">Size</legend>
    {#each DAILY_SIZES as s (s)}
      <button type="button" class="chip" aria-pressed={s === size} onclick={() => choose(s, scope)}>
        {sizeName(s)} {s}×{s}
      </button>
    {/each}
  </fieldset>
  <fieldset class="choices">
    <legend class="visually-hidden">Period</legend>
    <button type="button" class="chip" aria-pressed={scope === "today"} onclick={() => choose(size, "today")}>Today</button>
    <button type="button" class="chip" aria-pressed={scope === "all"} onclick={() => choose(size, "all")}>All time</button>
  </fieldset>

  {#if missing}
    <p class="soft">Today's {sizeName(size)} puzzle isn't ready yet.</p>
  {:else}
    <LeaderboardCard {board} caption="{size * size} cells · {scope === 'all' ? 'all time' : 'today'}" />
  {/if}
  {#if scope === "all"}
    <p class="soft">Each player's best time on any daily puzzle of this size.</p>
  {/if}
</main>

<style>
  .page {
    max-width: 640px;
    margin: 0 auto;
    padding: 16px 16px calc(24px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 32px;
    line-height: 1.15;
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

  /* Size chips (Home artboard, Practice). */
  .chip {
    flex: 0 0 auto;
    height: 44px;
    padding: 0 14px;
    border-radius: 8px;
    border: 2px solid var(--hairline);
    background: var(--sheet);
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
  }

  .chip[aria-pressed="true"] {
    border-color: var(--ink);
    background: var(--ink);
    color: var(--on-ink);
  }

  .soft {
    margin: 0;
    font-size: 14px;
    color: var(--ink-soft);
  }
</style>
