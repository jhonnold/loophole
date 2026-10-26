<script lang="ts">
  import { encodeEdges } from "@loophole/core";
  import { onDestroy } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { auth } from "$lib/auth/index.ts";
  import PlayScreen from "$lib/components/PlayScreen.svelte";
  import SiteHeader from "$lib/components/SiteHeader.svelte";
  import SolvedView from "$lib/components/SolvedView.svelte";
  import type { Attempt } from "$lib/daily/api.ts";
  import { sizeName } from "$lib/daily/days.ts";
  import { daily, finisherFor } from "$lib/daily/index.ts";
  import { dailyMode } from "$lib/daily/view.ts";
  import { puzzleSubtitle } from "$lib/puzzles/index.ts";
  import { openSaves } from "$lib/sync/index.ts";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  // The player's attempt: undefined while loading, null for none, "error" if it couldn't be read.
  let attempt = $state<Attempt | null | undefined | "error">(undefined);
  let replay = $state(false);
  let starting = $state(false);
  let startError = $state("");
  let rankedStatus = $state("Checking your solve…");
  // The puzzle whose solve is being sent, if any.
  let sendingFor: string | null = null;
  // Stops a send still retrying when the page goes away; the solve stays on the device.
  const controller = new AbortController();
  onDestroy(() => controller.abort());

  const userId = $derived($auth.status === "user" ? $auth.user.id : null);
  const mode = $derived(dailyMode({ auth: $auth, live: data.live, attempt, replay }));
  const name = $derived(`${sizeName(data.size)} · ${data.size}×${data.size}`);

  async function loadAttempt(id: string, puzzleId: string) {
    const result = await daily.attempt(id, puzzleId);
    if (data.entry?.id !== puzzleId) return;
    attempt = result.ok ? result.value : "error";
    const finisher = finisherFor(id);
    // A solve made before the page closed, or offline, goes out now with its own time.
    if (result.ok && result.value?.status === "playing" && finisher.pending(puzzleId)) {
      send(id, puzzleId, null);
    }
    // The server has the solve (its answer was lost): the copy kept here isn't needed any more.
    if (result.ok && result.value?.status === "finished") finisher.forget(puzzleId);
  }

  // The page stays mounted when "Next" opens another size, so start afresh for each puzzle. Only
  // confirmed players have attempts; read theirs once who is logged in is known.
  let shownFor: string | null = null;
  $effect(() => {
    const puzzleId = data.entry?.id ?? null;
    if (puzzleId !== shownFor) {
      shownFor = puzzleId;
      attempt = undefined;
      replay = false;
      startError = "";
    }
    if ($auth.status === "user" && $auth.user.emailVerified && puzzleId !== null && attempt === undefined) {
      void loadAttempt($auth.user.id, puzzleId);
    }
  });

  async function start() {
    if (userId === null || data.entry === null) return;
    const entry = data.entry;
    starting = true;
    startError = "";
    const result = await daily.start(userId, entry.id);
    if (result.ok) {
      // A ranked attempt starts from an empty board: unranked progress saved before Start (while
      // unconfirmed, brought in from guest play, or on another device) mustn't count (DECISIONS).
      const saves = openSaves(entry.id, entry.puzzle.grid, () => {});
      await saves.load();
      saves.clear();
      saves.close();
      attempt = result.value;
    } else if (result.status === 409) {
      // The day ended while the page was open: reload it, and it plays unranked.
      await invalidateAll();
    } else {
      startError = result.message;
    }
    starting = false;
  }

  async function send(id: string, puzzleId: string, solve: { edges: string; elapsedMs: number } | null) {
    if (sendingFor === puzzleId) return;
    sendingFor = puzzleId;
    // The page may have moved on to another size (Next) while this send retries: only the puzzle on
    // screen takes its status and attempt; the solve itself stays on the device until sent.
    const shown = () => data.entry?.id === puzzleId;
    if (shown()) rankedStatus = "Checking your solve…";
    const outcome = await finisherFor(id).send(puzzleId, solve, controller.signal, () => {
      if (shown()) rankedStatus = "Couldn't reach the server. Your solve is saved here and will be sent again.";
    });
    if (sendingFor === puzzleId) sendingFor = null;
    if (!shown()) return;
    if (outcome.kind === "done") attempt = outcome.attempt;
    else if (outcome.kind === "failed") rankedStatus = outcome.message;
  }

  function onsolve(edges: Uint8Array, elapsedMs: number) {
    if (userId !== null && data.entry !== null) {
      void send(userId, data.entry.id, { edges: encodeEdges(edges), elapsedMs });
    }
  }

  const unrankedNote: Record<string, string> = {
    guest: "Playing unranked.",
    unconfirmed: "Playing unranked: confirm your email to rank your solves and keep a streak.",
    ended: "This daily's day is over, so this solve isn't ranked.",
    replay: "Playing again for practice; this solve isn't ranked.",
  };
</script>

<svelte:head>
  <title>{name} · Daily · Loophole</title>
</svelte:head>

{#if data.entry === null}
  <SiteHeader />
  <main class="page">
    <h1>{name}</h1>
    <p>This daily puzzle isn't ready yet. Try again in a few minutes.</p>
    <a class="link" href="/">Back to today</a>
  </main>
{:else if mode.kind === "loading"}
  <SiteHeader />
  <main class="page"><p role="status">Loading…</p></main>
{:else if mode.kind === "error"}
  <SiteHeader />
  <main class="page">
    <h1>{name}</h1>
    <p role="alert">Couldn't reach the server to check your ranked attempt.</p>
    <button type="button" class="primary" onclick={() => (attempt = undefined)}>Try again</button>
  </main>
{:else if mode.kind === "gate"}
  <SiteHeader />
  <main class="page">
    <p class="eyebrow">{puzzleSubtitle(data.entry)}</p>
    <h1>{name}</h1>
    <div class="card">
      <h2>Ranked solve</h2>
      <ul>
        <li>The clock starts when you press Start and keeps running until you finish, even if you leave the page.</li>
        <li>You get one ranked try at each daily puzzle.</li>
        <li>Using a hint keeps the solve off the leaderboard.</li>
        <li>Starting clears any unranked progress on this puzzle.</li>
      </ul>
      {#if startError}<p class="error" role="alert">{startError}</p>{/if}
      <button type="button" class="primary" disabled={starting} onclick={start}>Start</button>
    </div>
  </main>
{:else if mode.kind === "solved" && userId !== null}
  <SolvedView
    entry={data.entry}
    day={data.day}
    size={data.size}
    live={data.live}
    attempt={mode.attempt}
    {userId}
    onreplay={() => (replay = true)}
  />
{:else if mode.kind === "ranked"}
  {#key data.entry.id}
    <PlayScreen entry={data.entry} ranked={{ elapsedMs: mode.attempt.elapsedMs, onsolve, status: rankedStatus }} />
  {/key}
  <footer class="daily-footer">
    <p>Ranked solve: the clock doesn't stop. <a href="/leaderboard?size={data.size}">Leaderboard</a></p>
  </footer>
{:else if mode.kind === "unranked"}
  {#key data.entry.id}
    <PlayScreen entry={data.entry} />
  {/key}
  <footer class="daily-footer">
    <p>
      {unrankedNote[mode.reason]}
      {#if mode.reason === "guest"}<a href="/login">Log in</a> to rank your solves and keep a streak.{/if}
      <a href="/leaderboard?size={data.size}">Leaderboard</a>
    </p>
  </footer>
{/if}

<style>
  .page {
    max-width: 560px;
    margin: 0 auto;
    padding: 20px 16px calc(24px + env(safe-area-inset-bottom));
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

  h2 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 20px;
  }

  p {
    margin: 0;
  }

  .eyebrow {
    font-size: 14px;
    font-weight: 700;
    color: var(--ink-soft);
  }

  .card {
    padding: 14px 16px;
    background: var(--sheet);
    border: 2px solid var(--ink);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  ul {
    margin: 0;
    padding-left: 20px;
    color: var(--ink-soft);
    line-height: 1.5;
  }

  .primary {
    align-self: flex-start;
    height: 48px;
    padding: 0 28px;
    border: 0;
    border-radius: 999px;
    background: var(--ink);
    color: var(--on-ink);
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
  }

  .primary:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .error {
    padding: 10px 12px;
    border-left: 4px solid var(--shu);
    background: var(--ground);
  }

  .link,
  .daily-footer a {
    color: var(--ai);
    font-weight: 700;
  }

  .daily-footer {
    max-width: 1280px;
    margin: 0 auto;
    padding: 16px 16px calc(24px + env(safe-area-inset-bottom));
    border-top: 2px solid var(--hairline);
    font-size: 14px;
    color: var(--ink-soft);
  }
</style>
