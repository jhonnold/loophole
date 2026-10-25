<script lang="ts">
  import type { Schemas } from "@loophole/api-client";
  import { createGrid } from "@loophole/core";
  import { onMount } from "svelte";
  import { auth } from "$lib/auth/index.ts";
  import BookCover from "$lib/components/BookCover.svelte";
  import GuestImport from "$lib/components/GuestImport.svelte";
  import SiteHeader from "$lib/components/SiteHeader.svelte";
  import StreakCard from "$lib/components/StreakCard.svelte";
  import type { DailySet, DailySummary } from "$lib/daily/api.ts";
  import {
    countdown,
    DAILY_SIZES,
    dailyPath,
    dailyRefreshDue,
    dayHeading,
    msToNextDay,
    sizeName,
    utcDay,
  } from "$lib/daily/days.ts";
  import { daily } from "$lib/daily/index.ts";
  import { type CoverStatus, coverStatus } from "$lib/daily/view.ts";
  import { formatClock } from "$lib/game/timer.ts";
  import { inProgress, localProgress } from "$lib/sync/index.ts";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let statuses: Record<string, CoverStatus> = $state({});
  // A logged-in player's unsolved puzzles from the server, so they can carry on from any device.
  let resume: Schemas["ProgressSummary"][] = $state([]);
  // Today's daily puzzles: undefined while loading, null when the server can't be reached.
  let today = $state<DailySet | null | undefined>(undefined);
  let summary: DailySummary | null = $state(null);
  let dailyStatuses: Record<number, CoverStatus> = $state({});
  let now = $state(Date.now());
  // When the daily set was last asked for (ms), so the rollover retries are spaced out.
  let fetchedAt = 0;

  const day = $derived(today?.day ?? utcDay(now));
  const dailyCovers: { size: number; puzzleId: string | null }[] = $derived(
    today?.puzzles ?? DAILY_SIZES.map((size) => ({ size, puzzleId: null })),
  );
  const msLeft = $derived(today ? Math.max(0, Date.parse(today.nextAt) - now) : msToNextDay(now));

  async function progressOf(id: string, width: number, height: number) {
    return localProgress(id, createGrid(width, height));
  }

  // The day's set doesn't depend on who is logged in, so it's asked for as soon as the page mounts.
  async function refreshDaily() {
    fetchedAt = Date.now();
    today = await daily.day();
    await refreshCovers();
  }

  // The streak and the covers' states depend on who is logged in.
  async function refreshCovers() {
    const user = $auth.status === "user" ? $auth.user : null;
    summary = user === null ? null : await daily.summary(user.id);
    for (const p of today?.puzzles ?? []) {
      const attempt = summary?.attempts.find((a) => a.puzzleId === p.puzzleId);
      const progress = p.puzzleId === null ? null : await progressOf(p.puzzleId, p.size, p.size);
      dailyStatuses[p.size] = coverStatus({ size: p.size, ready: p.puzzleId !== null, attempt, progress });
    }
  }

  async function refresh() {
    for (const p of data.puzzles) {
      const saved = await progressOf(p.id, p.width, p.height);
      statuses[p.id] = coverStatus({ size: p.width, ready: true, progress: saved });
    }
    resume = await inProgress();
  }

  onMount(() => {
    refresh();
    void refreshDaily();
    // New puzzles come out at 00:00 UTC (`nextAt`). The device's clock can run ahead of or behind
    // the server's, so once that time has passed, ask again every 30 s until the server answers
    // with the new day. It also asks every 30 s while the server is unreachable or a size class
    // isn't ready yet, so a cover doesn't stay "Not ready yet" after the worker catches up.
    const tick = setInterval(() => {
      now = Date.now();
      if (dailyRefreshDue(today, now) && now - fetchedAt >= 30_000) void refreshDaily();
    }, 1000);
    return () => clearInterval(tick);
  });

  // Covers and the streak depend on who is logged in, so load them once that is known.
  let loadedFor: string | null = null;
  $effect(() => {
    if ($auth.status === "loading") return;
    const who = $auth.status === "user" ? $auth.user.id : "guest";
    if (who === loadedFor) return;
    loadedFor = who;
    void refreshCovers();
  });

  function nameOf(id: string): string {
    return data.puzzles.find((p) => p.id === id)?.name ?? "Puzzle";
  }
</script>

<svelte:head>
  <title>Loophole</title>
</svelte:head>

<SiteHeader />

<main class="page">
  <GuestImport dismissible onimported={refresh} />

  <div class="heading">
    <span class="date">{dayHeading(day)}</span>
    <h1>Today's puzzles</h1>
    <span class="next" role="timer">New puzzles in {countdown(msLeft)}</span>
  </div>

  {#if $auth.status === "user" && summary !== null}
    {#if $auth.user.emailVerified}
      <StreakCard streak={summary.streak} week={summary.week} />
    {:else}
      <p class="card">Confirm your email to play daily puzzles ranked and keep a streak.</p>
    {/if}
  {:else if $auth.status === "guest"}
    <p class="card">With an account, your daily solves are ranked and you keep a streak.</p>
  {/if}

  {#if today === null}
    <p class="card">Daily puzzles need the server, which can't be reached right now. The practice puzzles below work offline.</p>
  {:else}
    <!-- Until the set arrives, the four covers keep their place, hidden, so nothing below moves. -->
    <ul
      class="covers daily"
      class:pending={today === undefined}
      aria-busy={today === undefined}
      aria-label="Today's daily puzzles"
    >
      {#each dailyCovers as p (p.size)}
        <li>
          <BookCover
            href={p.puzzleId === null ? null : dailyPath(day, p.size)}
            width={p.size}
            height={p.size}
            name={sizeName(p.size)}
            status={dailyStatuses[p.size] ?? coverStatus({ size: p.size, ready: p.puzzleId !== null })}
          />
        </li>
      {/each}
    </ul>
  {/if}

  {#if resume.length > 0}
    <section class="section" aria-labelledby="continue-h">
      <h2 id="continue-h">Continue</h2>
      <ul class="resume">
        {#each resume as r (r.puzzleId)}
          {@const dailySize = today?.puzzles.find((p) => p.puzzleId === r.puzzleId)?.size}
          <li>
            <a href={dailySize === undefined ? `/play/${r.puzzleId}` : dailyPath(day, dailySize)}>
              <b>
                {dailySize === undefined
                  ? `${nameOf(r.puzzleId)} · ${r.width}×${r.height}`
                  : `Daily · ${sizeName(dailySize)} · ${r.width}×${r.height}`}
              </b>
              <span>In progress · {formatClock(r.elapsedMs)}</span>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="section" aria-labelledby="practice-h">
    <div class="section-head">
      <h2 id="practice-h">Practice <span class="jp">練習</span></h2>
      <span class="soft">fresh, proven unique</span>
    </div>
    <ul class="covers">
      {#each data.puzzles as p (p.id)}
        <li>
          <BookCover
            href="/play/{p.id}"
            width={p.width}
            height={p.height}
            name={p.name}
            status={statuses[p.id] ?? coverStatus({ size: p.width, ready: true })}
          />
        </li>
      {/each}
    </ul>
  </section>
</main>

<style>
  .page {
    max-width: 960px;
    margin: 0 auto;
    padding: 16px 16px calc(24px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .heading {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .date,
  .next {
    font-size: 14px;
    font-weight: 700;
    color: var(--ink-soft);
  }

  .next {
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 32px;
    line-height: 1.15;
  }

  h2 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 20px;
  }

  .jp {
    font-size: 14px;
    font-weight: 700;
    color: var(--ink-soft);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  .soft {
    font-size: 13px;
    color: var(--ink-soft);
  }

  .card {
    margin: 0;
    padding: 10px 14px;
    background: var(--sheet);
    border: 2px solid var(--ink);
    border-radius: 6px;
    font-size: 15px;
  }

  .resume {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .resume a {
    min-height: 44px;
    padding: 8px 14px;
    border: 2px solid var(--ink);
    border-radius: 6px;
    background: var(--sheet);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 4px 12px;
  }

  .resume span {
    font-size: 14px;
    color: var(--ink-soft);
  }

  .covers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px;
  }

  /* Today's four covers: two by two on phones (Home artboard), one row on wide screens. */
  .covers.daily {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (min-width: 720px) {
    .covers.daily {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  .covers.pending {
    visibility: hidden;
  }
</style>
