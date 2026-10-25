<script lang="ts">
  import { auth } from "$lib/auth/index.ts";
  import SiteHeader from "$lib/components/SiteHeader.svelte";
  import { type ReportedPuzzle, reports } from "$lib/puzzles/index.ts";

  let items: ReportedPuzzle[] | null = $state(null);
  let error = $state("");

  async function load() {
    items = await reports.list();
    if (items === null) error = "Couldn't load the reports.";
  }

  async function act(action: "unpublish" | "dismiss", puzzleId: string) {
    error = "";
    const result = await reports[action](puzzleId);
    if (result.ok) items = (items ?? []).filter((r) => r.puzzleId !== puzzleId);
    else error = result.message;
  }

  $effect(() => {
    if ($auth.status === "user" && $auth.user.isAdmin && items === null) load();
  });
</script>

<svelte:head>
  <title>Reports · Loophole</title>
</svelte:head>

<SiteHeader />

<!-- The admins' reports list (PRD FR-28): reported puzzles that are still published. -->
<main class="auth">
  <h1>Reports</h1>
  {#if $auth.status === "loading"}
    <p role="status">Loading…</p>
  {:else if $auth.status === "guest" || !$auth.user.isAdmin}
    <p>Admins only.</p>
  {:else if items === null}
    <p role="status">{error || "Loading…"}</p>
  {:else}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if items.length === 0}
      <p>No open reports.</p>
    {/if}
    <ul class="reports">
      {#each items as item (item.puzzleId)}
        <li>
          <p>
            <a href="/play/{item.puzzleId}">{item.width}×{item.height} {item.origin}</a>
            · reported by <b>{item.count}</b>
            {item.count === 1 ? "player" : "players"}
          </p>
          <ul class="reasons">
            {#each item.reports as r, i (i)}
              <li>{r.reason}</li>
            {/each}
          </ul>
          <div class="actions">
            <button type="button" class="danger" onclick={() => act("unpublish", item.puzzleId)}>Unpublish</button>
            <button type="button" class="secondary" onclick={() => act("dismiss", item.puzzleId)}>Dismiss</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .reports {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .reports > li {
    padding: 12px 14px;
    border: 2px solid var(--ink);
    border-radius: 6px;
    background: var(--sheet);
  }

  .reasons {
    margin: 0 0 12px;
    padding-left: 20px;
    color: var(--ink);
  }

  .actions {
    display: flex;
    gap: 10px;
  }
</style>
