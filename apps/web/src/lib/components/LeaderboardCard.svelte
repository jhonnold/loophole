<script lang="ts">
  import type { Leaderboard } from "../daily/api.ts";
  import { boardRows, rowName } from "../daily/view.ts";
  import { formatClock } from "../game/timer.ts";

  interface Props {
    /** The board; null when it couldn't be read, undefined while loading. */
    board: Leaderboard | null | undefined;
    /** The line next to the heading, e.g. "49 cells · today". */
    caption: string;
  }

  let { board, caption }: Props = $props();

  const rows = $derived(board ? boardRows(board.entries) : []);
</script>

<!-- 番付 Leaderboard (Solved artboard, PRD FR-23): the top times, a gap, then the player's row and
     its neighbours. The player's row is outlined in ai and says "You". -->
<section class="board" aria-labelledby="lb-h">
  <div class="head">
    <h2 id="lb-h">番付 Leaderboard</h2>
    <span class="caption">{caption}</span>
  </div>
  {#if board === undefined}
    <p class="empty" role="status">Loading…</p>
  {:else if board === null}
    <p class="empty" role="status">Couldn't load the leaderboard.</p>
  {:else if rows.length === 0}
    <p class="empty">No ranked solves yet.</p>
  {:else}
    <ol>
      {#each rows as row (row.kind === "gap" ? `gap-${row.after}` : row.entry.rank)}
        {#if row.kind === "gap"}
          <li class="row gap" aria-hidden="true"><span class="rank">…</span></li>
        {:else}
          <li class="row" class:me={row.entry.me}>
            <span class="rank">{row.entry.rank}</span>
            <span class="name" class:anonymous={!row.entry.me && row.entry.name === null}>{rowName(row.entry)}</span>
            <span class="time">{formatClock(row.entry.timeMs)}</span>
          </li>
        {/if}
      {/each}
    </ol>
  {/if}
  <p class="note">Ranked by time within puzzles of the same area. Solves that used a hint are not listed.</p>
</section>

<style>
  .board {
    background: var(--sheet);
    border: 2px solid var(--ink);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
  }

  .head {
    padding: 12px 14px 8px;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    border-bottom: 2px solid var(--hairline);
  }

  h2 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 19px;
  }

  .caption {
    font-size: 13px;
    color: var(--ink-soft);
  }

  ol {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    display: flex;
    flex-direction: column;
  }

  .row {
    min-height: 40px;
    padding: 0 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
  }

  .row.me {
    margin: 2px 6px;
    padding: 0 8px;
    border: 2px solid var(--ai);
    border-radius: 6px;
    background: var(--ai-wash);
  }

  .rank {
    width: 44px;
    flex: 0 0 auto;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--ink-soft);
  }

  .name {
    flex: 1 1 auto;
    min-width: 0;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name.anonymous {
    font-weight: 500;
    color: var(--ink-soft);
  }

  .time {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .empty {
    margin: 0;
    padding: 14px;
    color: var(--ink-soft);
  }

  .note {
    margin: 0;
    padding: 10px 14px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--ink-soft);
    border-top: 2px solid var(--hairline);
  }
</style>
