<script lang="ts">
  import { onMount } from "svelte";
  import { browserStorage } from "../game/progress.ts";
  import { applyThemeChoice, readThemeChoice, saveThemeChoice, type ThemeChoice } from "../theme.ts";

  const OPTIONS: { value: ThemeChoice; label: string }[] = [
    { value: "light", label: "紙 Paper" },
    { value: "dark", label: "夜 Night" },
    { value: "system", label: "System" },
  ];

  let choice: ThemeChoice = $state("system");

  onMount(() => {
    choice = readThemeChoice(browserStorage());
  });

  function pick(value: ThemeChoice) {
    choice = value;
    saveThemeChoice(browserStorage(), value);
    applyThemeChoice(document.documentElement, value);
  }
</script>

<fieldset class="switch">
  <legend class="visually-hidden">Theme</legend>
  {#each OPTIONS as o (o.value)}
    <button type="button" aria-pressed={choice === o.value} onclick={() => pick(o.value)}>
      {o.label}
    </button>
  {/each}
</fieldset>

<style>
  .switch {
    display: inline-flex;
    margin: 0;
    min-width: 0;
    padding: 3px;
    gap: 2px;
    border: 2px solid var(--ink);
    border-radius: 999px;
  }

  button {
    height: 34px;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--ink);
    font-size: 14px;
    font-weight: 700;
    white-space: nowrap;
    cursor: pointer;
  }

  button[aria-pressed="true"] {
    background: var(--ink);
    color: var(--on-ink);
  }
</style>
