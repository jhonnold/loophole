<script lang="ts">
  import { onMount } from "svelte";
  import type { Attempt, Leaderboard } from "../daily/api.ts";
  import { DAILY_SIZES, dailyPath, shortDay, sizeName } from "../daily/days.ts";
  import { daily } from "../daily/index.ts";
  import { shareText } from "../daily/view.ts";
  import { formatClock } from "../game/timer.ts";
  import type { PuzzleEntry } from "../puzzles/index.ts";
  import { openSaves } from "../sync/index.ts";
  import LeaderboardCard from "./LeaderboardCard.svelte";
  import SolvedBoard from "./SolvedBoard.svelte";

  interface Props {
    entry: PuzzleEntry;
    day: string;
    size: number;
    /** The daily is today's. */
    live: boolean;
    attempt: Attempt;
    userId: string;
    /** Play the daily again, unranked. */
    onreplay: () => void;
  }

  let { entry, day, size, live, attempt, userId, onreplay }: Props = $props();

  let edges: Uint8Array | null = $state.raw(null);
  let board = $state<Leaderboard | null | undefined>(undefined);
  let best: number | null = $state(null);
  let shared = $state(false);

  const nextSize = $derived(DAILY_SIZES[DAILY_SIZES.indexOf(size) + 1]);
  const note = $derived(
    attempt.assisted
      ? "A hint was used, so this solve isn't on the leaderboard."
      : !attempt.ranked
        ? "This solve was faster than the loop can be drawn, so it isn't ranked."
        : board
          ? `Ranked among ${board.total} ${board.total === 1 ? "solver" : "solvers"} of this puzzle.`
          : "Ranked on this puzzle's leaderboard.",
  );

  onMount(() => {
    // The board as it was solved, from this device or the account.
    const saves = openSaves(entry.id, entry.puzzle.grid, () => {});
    saves.load().then((saved) => {
      if (saved?.solved) edges = saved.edges;
      saves.close();
    });
    daily.puzzleBoard(entry.id).then((b) => {
      board = b;
    });
    daily.summary(userId).then((s) => {
      best = s?.bests.find((b) => b.area === attempt.area && b.level === attempt.level)?.timeMs ?? null;
    });
  });

  async function share() {
    const text = shareText(sizeName(size), size, shortDay(day), attempt);
    try {
      if (navigator.share) await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
      shared = true;
    } catch {
      shared = false;
    }
  }
</script>

<!-- The Solved screen (Solved artboard, PRD FR-23, FR-24): stamp, time, rank and the leaderboard of
     this daily's area. -->
<div class="solved">
  <header class="bar">
    <a class="back" href="/">
      <span class="visually-hidden">Back to today</span>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
    </a>
    <div class="titles">
      <h1>{entry.name} · {size}×{size}</h1>
      <span class="subtitle">{entry.subtitle}</span>
    </div>
    <button type="button" class="round" onclick={share}>
      <span class="visually-hidden">{shared ? "Result copied" : "Share result"}</span>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg>
    </button>
  </header>

  <div class="top">
    {#if edges}<SolvedBoard puzzle={entry.puzzle} {edges} />{/if}
    <div class="stamp-col">
      <div class="stamp" role="img" aria-label="Solved">
        <span class="kanji" aria-hidden="true">完</span><span class="word" aria-hidden="true">SOLVED</span>
      </div>
      <p class="note">{note}</p>
      {#if shared}<p class="note" role="status">Result copied.</p>{/if}
    </div>
  </div>

  <div class="stats">
    <div class="stat">
      <span class="label">Time</span>
      <span class="value tabular">{formatClock(attempt.elapsedMs)}</span>
    </div>
    <div class="stat">
      <span class="label">{live ? "Rank today" : "Rank"}</span>
      <span class="value">{attempt.rank === null ? "—" : `#${attempt.rank}`}</span>
    </div>
    <div class="stat">
      <span class="label">Your best</span>
      <span class="value tabular">{best === null ? "—" : formatClock(best)}</span>
    </div>
  </div>

  {#if board?.me && board.me.name === null}
    <p class="name-tip">You're listed as Anonymous. <a href="/account">Choose a name</a> for the leaderboards.</p>
  {/if}

  <LeaderboardCard {board} caption="{attempt.area} cells · {live ? 'today' : shortDay(day)}" />

  <div class="actions">
    {#if nextSize !== undefined}
      <a class="primary" href={dailyPath(day, nextSize)}>
        Next: {sizeName(nextSize)} {nextSize}×{nextSize}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
      </a>
    {:else}
      <a class="primary" href="/">Back to today</a>
    {/if}
    <a class="outline" href="/leaderboard?size={size}">All-time board</a>
    <button type="button" class="text" onclick={onreplay}>Play again, unranked</button>
  </div>
</div>

<style>
  .solved {
    max-width: 640px;
    margin: 0 auto;
    padding: 12px 16px calc(20px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .bar {
    height: 52px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .back,
  .round {
    width: 44px;
    height: 44px;
    flex: 0 0 auto;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .round {
    padding: 0;
    border: 2px solid var(--ink);
    background: var(--sheet);
    cursor: pointer;
  }

  .titles {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }

  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 20px;
  }

  .subtitle {
    font-size: 13px;
    font-weight: 500;
    color: var(--ink-soft);
  }

  .top {
    display: flex;
    gap: 14px;
    align-items: flex-start;
  }

  .stamp-col {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    padding-top: 4px;
  }

  .stamp {
    width: 96px;
    height: 96px;
    margin-left: 8px;
    border: 4px solid var(--shu);
    border-radius: 16px;
    color: var(--shu);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    transform: rotate(-8deg);
    font-family: var(--font-display);
    line-height: 1;
  }

  .kanji {
    font-size: 46px;
    font-weight: 900;
  }

  .word {
    margin-top: 3px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
  }

  .note {
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
    color: var(--ink-soft);
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .stat {
    padding: 10px 12px;
    background: var(--sheet);
    border: 2px solid var(--ink);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .label {
    font-size: 12px;
    font-weight: 700;
    color: var(--ink-soft);
  }

  .value {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 26px;
  }

  .tabular {
    font-variant-numeric: tabular-nums;
  }

  .name-tip {
    margin: 0;
    font-size: 14px;
    color: var(--ink-soft);
  }

  .name-tip a {
    color: var(--ai);
    font-weight: 700;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .primary {
    height: 52px;
    border-radius: 999px;
    background: var(--ink);
    color: var(--on-ink);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 16px;
    font-weight: 700;
  }

  .primary:hover {
    color: var(--on-ink);
  }

  .outline {
    height: 44px;
    border-radius: 999px;
    border: 2px solid var(--ink);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    font-weight: 700;
  }

  .text {
    height: 44px;
    border: 0;
    background: none;
    color: var(--ink-soft);
    font-size: 14px;
    font-weight: 700;
    text-decoration: underline;
    cursor: pointer;
  }

  /* The smallest phones: the board shrinks with the screen so the stamp still fits beside it. */
  @media (max-width: 379px) {
    .solved {
      padding-inline: 14px;
    }

    .top :global(.solved-board) {
      width: 190px;
      height: 190px;
    }
  }
</style>
