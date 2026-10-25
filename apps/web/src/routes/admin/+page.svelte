<script lang="ts">
  import {
    type AdminHealth,
    elapsedText,
    failureText,
    health,
    queueText,
    stockText,
  } from "$lib/admin/index.ts";
  import { auth } from "$lib/auth/index.ts";
  import SiteHeader from "$lib/components/SiteHeader.svelte";
  import { sizeName } from "$lib/daily/days.ts";
  import { type ReportedPuzzle, reports } from "$lib/puzzles/index.ts";

  let items: ReportedPuzzle[] | null = $state(null);
  let error = $state("");
  let report: AdminHealth | null = $state(null);
  let healthError = $state("");
  let checkedAt = $state(Date.now());

  async function loadHealth() {
    healthError = "";
    report = await health.read();
    checkedAt = Date.now();
    if (report === null) healthError = "Couldn't load the health report.";
  }

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
    if ($auth.status === "user" && $auth.user.isAdmin && items === null) {
      load();
      loadHealth();
    }
  });
</script>

<svelte:head>
  <title>Admin · Loophole</title>
</svelte:head>

<SiteHeader />

<!-- The admins' page: system health (PRD §5) and reported puzzles that are still published
     (FR-28). States are written in words, never shown by colour alone (NFR-5). -->
<main class="auth">
  <h1>Admin</h1>
  {#if $auth.status === "loading"}
    <p role="status">Loading…</p>
  {:else if $auth.status === "guest" || !$auth.user.isAdmin}
    <p>Admins only.</p>
  {:else}
    <section aria-labelledby="health-heading">
      <h2 id="health-heading">System health</h2>
      {#if report === null}
        <p role="status">{healthError || "Loading…"}</p>
      {:else}
        <dl class="health">
          <dt>Database</dt>
          <dd>{report.database.ok ? "OK" : `Down: ${report.database.error}`}</dd>
          <dt>Blob storage</dt>
          <dd>{report.blobs.ok ? "OK" : `Down: ${report.blobs.error}`}</dd>
          <dt>Job queue</dt>
          <dd>{queueText(report.jobs, checkedAt)}</dd>
          <dt>Daily puzzles</dt>
          <dd>
            <ul>
              {#each report.dailies as d (d.size)}
                <li>{sizeName(d.size)} {d.size}×{d.size}: {stockText(d.days)}</li>
              {/each}
            </ul>
          </dd>
          <dt>Versions</dt>
          <dd>
            app {report.versions.app}, generator {report.versions.generator}, {report.versions.runtime};
            up {elapsedText(report.startedAt, checkedAt)}
          </dd>
        </dl>
        <h3>Recent failed jobs</h3>
        {#if report.failures.length === 0}
          <p>None.</p>
        {:else}
          <ul class="failures">
            {#each report.failures as f (f.id)}
              <li>
                {failureText(f, checkedAt)}
                {#if f.error}<br /><span class="error-text">{f.error}</span>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
      <button type="button" class="secondary" onclick={loadHealth}>Check again</button>
    </section>

    <section aria-labelledby="reports-heading">
      <h2 id="reports-heading">Reported puzzles</h2>
      {#if items === null}
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
    </section>
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

  .health {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 14px;
    margin: 0 0 12px;
  }

  .health dt {
    font-weight: 700;
  }

  .health dd {
    margin: 0;
  }

  .health ul,
  .failures {
    margin: 0;
    padding-left: 18px;
  }

  .failures {
    margin-bottom: 12px;
  }

  .error-text {
    color: var(--ink-soft);
    overflow-wrap: anywhere;
  }

  section {
    margin-bottom: 24px;
  }
</style>
