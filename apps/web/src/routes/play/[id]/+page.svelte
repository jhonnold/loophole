<script lang="ts">
  import PlayScreen from "$lib/components/PlayScreen.svelte";
  import PuzzleFooter from "$lib/components/PuzzleFooter.svelte";
  import { puzzleTitle } from "$lib/puzzles/index.ts";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{puzzleTitle(data.entry)} · Loophole</title>
</svelte:head>

{#key data.entry.id}
  <PlayScreen entry={data.entry} />
  {#if data.entry.origin !== undefined}
    <PuzzleFooter entry={data.entry} />
  {/if}
{/key}
