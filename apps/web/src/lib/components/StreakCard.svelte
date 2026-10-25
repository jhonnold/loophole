<script lang="ts">
  import { weekdayLetter } from "../daily/days.ts";

  interface Props {
    streak: number;
    /** The last seven days, oldest first; the last one is today. */
    week: readonly { readonly day: string; readonly finished: boolean }[];
  }

  let { streak, week }: Props = $props();
</script>

<!-- The streak card (Home artboard, PRD FR-24): the count, then the last seven days, a 完 for each
     day with a finished daily and a dashed box for today until it has one. -->
<section class="streak" aria-label="Streak">
  <div class="count">
    <span class="number">{streak}</span>
    <span class="label">day streak</span>
  </div>
  <ol class="week">
    {#each week as d, i (d.day)}
      {@const today = i === week.length - 1}
      <li>
        {#if d.finished}
          <span class="box done" aria-hidden="true">完</span>
        {:else}
          <span class="box" class:today aria-hidden="true"></span>
        {/if}
        <span class="day" class:today>{weekdayLetter(d.day)}</span>
        <span class="visually-hidden">{d.day}: {d.finished ? "solved" : "not solved"}</span>
      </li>
    {/each}
  </ol>
</section>

<style>
  .streak {
    background: var(--sheet);
    border: 2px solid var(--ink);
    border-radius: 6px;
    padding: 10px 14px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .count {
    display: flex;
    flex-direction: column;
    line-height: 1.1;
    min-width: 64px;
  }

  .number {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 28px;
  }

  .label {
    font-size: 12px;
    font-weight: 700;
    color: var(--ink-soft);
  }

  .week {
    flex: 1 1 auto;
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 4px;
  }

  .week li {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
  }

  .box {
    width: 28px;
    height: 28px;
    border: 2px solid transparent;
    border-radius: 6px;
  }

  .box.done {
    border-color: var(--shu);
    color: var(--shu);
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 900;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .box.today {
    border: 2px dashed var(--pencil);
  }

  .day {
    font-size: 11px;
    color: var(--ink-soft);
  }

  .day.today {
    font-weight: 700;
    color: var(--ink);
  }
</style>
