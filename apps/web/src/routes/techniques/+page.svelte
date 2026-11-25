<script lang="ts">
  import { LEVELS, type Level, RULE_TEXT, RULE_TITLE } from "@loophole/core";
  import LessonFigure from "$lib/components/LessonFigure.svelte";
  import SiteHeader from "$lib/components/SiteHeader.svelte";
  import { levelName } from "$lib/puzzles/source.ts";
  import { LESSONS } from "$lib/techniques/lessons.ts";

  const LEVEL_JP: Record<Level, string> = { easy: "初級", medium: "中級", hard: "上級" };
  const LEVEL_TEXT: Record<Level, string> = {
    easy: "Every easy puzzle can be solved with these alone.",
    medium: "Medium puzzles also need these: what a line does at the corner of a clue, and which cells are inside the loop.",
    hard: "Hard puzzles can need everything, up to trying a move and seeing it break a rule.",
  };

  const levels = LEVELS.map((level) => ({ level, lessons: LESSONS.filter((l) => l.level === level) }));
</script>

<svelte:head>
  <title>Techniques · Loophole</title>
</svelte:head>

<SiteHeader />

<main class="page">
  <h1>Techniques</h1>
  <p class="intro">
    Draw one loop along the lines between the dots. It never crosses or touches itself. A number
    says how many of its four sides the loop uses; a cell without one can use any number. Mark an
    edge you know is empty with a ×. Each technique below forces one move, and they run from the
    easiest to the hardest. Step through the pictures: the reason is shaded, the move is dashed.
  </p>

  <nav class="contents" aria-label="Techniques">
    {#each levels as { level, lessons } (level)}
      <div>
        <a class="level-link" href="#{level}">{levelName(level)}</a>
        <ul>
          {#each lessons as l (l.rule)}
            <li><a href="#{l.rule}">{RULE_TITLE[l.rule]}</a></li>
          {/each}
        </ul>
      </div>
    {/each}
  </nav>

  {#each levels as { level, lessons } (level)}
    <section class="level" id={level} aria-labelledby="{level}-h">
      <h2 id="{level}-h">{levelName(level)} <span class="jp">{LEVEL_JP[level]}</span></h2>
      <p class="soft">{LEVEL_TEXT[level]}</p>
      {#each lessons as l (l.rule)}
        <section class="technique" id={l.rule} aria-labelledby="{l.rule}-h">
          <h3 id="{l.rule}-h">{RULE_TITLE[l.rule]}</h3>
          <p class="text">{RULE_TEXT[l.rule]}</p>
          <LessonFigure frames={l.frames} name={RULE_TITLE[l.rule]} />
        </section>
      {/each}
    </section>
  {/each}
</main>

<style>
  .page {
    max-width: 720px;
    margin: 0 auto;
    padding: 16px 16px calc(24px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 16px;
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
    font-size: 24px;
  }

  h3 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 20px;
    line-height: 1.2;
  }

  .jp {
    font-size: 14px;
    font-weight: 700;
    color: var(--ink-soft);
  }

  .intro,
  .text {
    margin: 0;
    font-size: 15px;
    line-height: 1.5;
  }

  .soft {
    margin: 0;
    font-size: 14px;
    color: var(--ink-soft);
  }

  .contents {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
    background: var(--sheet);
    border: 2px solid var(--hairline);
    border-radius: 6px;
  }

  .level-link {
    font-weight: 700;
  }

  .contents ul {
    margin: 4px 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0 14px;
    font-size: 14px;
  }

  .contents li a {
    display: inline-block;
    padding: 4px 0;
    color: var(--ink-soft);
    text-decoration: underline;
    text-decoration-color: var(--hairline);
    text-underline-offset: 3px;
  }

  .level {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 8px;
    border-top: 2px solid var(--ink);
  }

  .technique {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
    background: var(--sheet);
    border: 2px solid var(--hairline);
    border-radius: 10px;
    scroll-margin-top: 12px;
  }

  /* A technique opened from a hint's link stands out. */
  .technique:target {
    border-color: var(--ai);
  }
</style>
