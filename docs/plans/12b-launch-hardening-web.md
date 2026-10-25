# WT12b `launch-hardening` (tests and web) — implementation plan

The second of two plans for WT12 (PRD §11 M8). Start it on the same branch, `feat/launch-hardening` at `/home/jhonnold/projects/loophole-wt/launch-hardening`, **after every step of `docs/plans/12a-launch-hardening-server.md` is committed**. Check first: `grep -c AdminHealth packages/api-client/src/schema.ts` prints a number above 0, and `git log --oneline -1` shows 12a's docs commit.

PRD: §6 user stories (all six, end to end), §10 (p95 time to first interaction under 2 s), §5 (admins view system health), NFR-5 (contrast in both themes, words not colour, keyboard), FR-14 and FR-17 (clock, pause, solve, lock), FR-22 (today's dailies on Home), NFR-1 and NFR-2 (performance checks stay).

## How to work through this plan

- Prefix every shell command with `export PATH="$HOME/.bun/bin:$PATH";` and run it from the worktree root unless a command says `cd apps/web`.
- **Create**, **Replace the whole of**, **Edit**, **Append** and **Delete** mean what they mean in 12a: write exactly the fenced content; apply each Find/Replace in order (each Find occurs once).
- Biome lints `.svelte` files but doesn't format them: copy those exactly.
- `bun run check` must pass before each commit; `bun run format` fixes formatting reported by Biome.
- End-to-end runs: use your own ports, `E2E_PORT=4303` for `test:e2e` and `test:perf`, `E2E_AUTH_PORT=4304` for `test:e2e:auth` and `test:e2e:stories`. The suites that need the dev services need `docker compose up -d` and `./scripts/garage-init.sh`; stop them afterwards with `docker compose stop` only if you started them (never `down`, never `-v`).
- `test:perf` misses budgets when the host is busy: check `uptime` first and run it with a load average under 4.
- Commit after each step with the message given. Don't push.

## What this builds

- **Admin health page (§5).** `/admin` shows 12a's `GET /api/admin/health` in words: database and blob checks with their errors, the job queue and the age of the oldest waiting job, each daily size's stock, the latest failed jobs and the versions. Text comes from plain tested functions in `lib/admin`.
- **Clock and input lock (follow-up, FR-14, FR-17).** A test with Playwright's fake clock: the clock runs, stops on pause, stops on solve, and a solved board ignores taps and keys and leaves the Tab order.
- **Accessibility (NFR-5).** `@axe-core/playwright` 4.13.0 runs WCAG A and AA rules, contrast included, on fourteen screens in both themes at phone and desktop sizes, as part of `bun run test:e2e`. One real violation found and fixed (the not-ready daily covers' text contrast).
- **User stories (§6).** `bun run test:e2e:stories`: one test per story on the full stack (API, worker, Garage, Mailpit), skipping without them.
- **Time to first interaction (§10).** A `@perf` check under `bun run test:perf` that fails at a p95 of 2 s or more. Cold loads took 2.6–3.1 s because the fonts' Japanese `@font-face` rules (about 720 KB) blocked the first paint; the root layout now imports only the Latin subsets and loads the full stylesheets after the first paint, which brings both pages to about 1.6 s with no layout shift under taps.
- **CI.** A second job installs Chromium and runs `bun run test:e2e` (accessibility and clock tests included), keeping the Playwright results as an artifact when it fails. The suites that need services, and `test:perf`, stay local.
- **Follow-ups.** Home keeps asking every 30 s while any of today's dailies isn't ready; the leaderboard test's fixed 300 ms sleep becomes a wait on the response.

## Out of scope

Subsetting the fonts further; restyling screens beyond the one contrast fix; running the service-backed suites in CI.

## Steps

### B1 Home keeps asking while a daily isn't ready (follow-up)

After the day rolled over, the home page stopped asking for today's set, so a cover stayed "Not ready yet" after a worker outage ended. The rule moves into a plain, tested function, `dailyRefreshDue`, which also asks while any size has no puzzle.

**Edit `apps/web/src/lib/daily/days.ts`**: 1 replacement, in order.

1. Find:
````ts
/** Milliseconds from `ms` to the next 00:00 UTC, when new daily puzzles come out. */
export function msToNextDay(ms: number): number {
  return DAY_MS - (((ms % DAY_MS) + DAY_MS) % DAY_MS);
}

/** "5h 12m" from an hour up, "12m 05s" below. */
````
   Replace with:
````ts
/** Milliseconds from `ms` to the next 00:00 UTC, when new daily puzzles come out. */
export function msToNextDay(ms: number): number {
  return DAY_MS - (((ms % DAY_MS) + DAY_MS) % DAY_MS);
}

/**
 * Whether Home should ask for today's daily set again (at most every 30 s): the server couldn't be
 * reached (`null`), this device's clock says the next day has started, or a size class isn't ready
 * yet (a slow or failed generation). `undefined` means the first answer hasn't come back.
 */
export function dailyRefreshDue(
  set: { nextAt: string; puzzles: readonly { puzzleId: string | null }[] } | null | undefined,
  now: number,
): boolean {
  if (set === undefined) return false;
  if (set === null) return true;
  return now >= Date.parse(set.nextAt) || set.puzzles.some((p) => p.puzzleId === null);
}

/** "5h 12m" from an hour up, "12m 05s" below. */
````

**Edit `apps/web/src/lib/daily/days.test.ts`**: 2 replacements, in order.

1. Find:
````ts
  countdown,
  coverTint,
  dailyPath,
  dailySubtitle,
  dayHeading,
  msToNextDay,
````
   Replace with:
````ts
  countdown,
  coverTint,
  dailyPath,
  dailyRefreshDue,
  dailySubtitle,
  dayHeading,
  msToNextDay,
````

2. Find:
````ts
    expect(countdown(-5)).toBe("0m 00s");
  });

  test("writes days as the artboards do, in UTC", () => {
    expect(dayHeading("2026-10-25")).toBe("日曜日 · Sunday 25 October");
    expect(shortDay("2026-10-25")).toBe("25 Oct");
````
   Replace with:
````ts
    expect(countdown(-5)).toBe("0m 00s");
  });

  test("Home asks again when the server was down, the day is over, or a size isn't ready", () => {
    const nextAt = "2026-10-26T00:00:00.000Z";
    const before = Date.UTC(2026, 9, 25, 23);
    const ready = { nextAt, puzzles: [{ puzzleId: "a" }, { puzzleId: "b" }] };
    expect(dailyRefreshDue(undefined, before)).toBe(false);
    expect(dailyRefreshDue(null, before)).toBe(true);
    expect(dailyRefreshDue(ready, before)).toBe(false);
    expect(dailyRefreshDue(ready, Date.parse(nextAt))).toBe(true);
    expect(
      dailyRefreshDue({ nextAt, puzzles: [{ puzzleId: "a" }, { puzzleId: null }] }, before),
    ).toBe(true);
  });

  test("writes days as the artboards do, in UTC", () => {
    expect(dayHeading("2026-10-25")).toBe("日曜日 · Sunday 25 October");
    expect(shortDay("2026-10-25")).toBe("25 Oct");
````

**Edit `apps/web/src/routes/+page.svelte`**: 2 replacements, in order.

1. Find:
````svelte
  import SiteHeader from "$lib/components/SiteHeader.svelte";
  import StreakCard from "$lib/components/StreakCard.svelte";
  import type { DailySet, DailySummary } from "$lib/daily/api.ts";
  import { countdown, dailyPath, dayHeading, msToNextDay, sizeName, utcDay } from "$lib/daily/days.ts";
  import { daily } from "$lib/daily/index.ts";
  import { type CoverStatus, coverStatus } from "$lib/daily/view.ts";
  import { formatClock } from "$lib/game/timer.ts";
````
   Replace with:
````svelte
  import SiteHeader from "$lib/components/SiteHeader.svelte";
  import StreakCard from "$lib/components/StreakCard.svelte";
  import type { DailySet, DailySummary } from "$lib/daily/api.ts";
  import {
    countdown,
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
````

2. Find:
````svelte
    refresh();
    // New puzzles come out at 00:00 UTC (`nextAt`). The device's clock can run ahead of or behind
    // the server's, so once that time has passed, ask again every 30 s until the server answers
    // with the new day; with no set at all (server unreachable) it asks every 30 s too.
    const tick = setInterval(() => {
      now = Date.now();
      const due = today === null || (today !== undefined && now >= Date.parse(today.nextAt));
      if (due && now - fetchedAt >= 30_000) void refreshDaily();
    }, 1000);
    return () => clearInterval(tick);
  });
````
   Replace with:
````svelte
    refresh();
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
````

**Verify:** `bun run check`; `bun test apps/web/src/lib/daily/days.test.ts` passes.

**Commit:** `fix(web): Home keeps asking for today's set while a daily isn't ready`

### B2 Wait for the late leaderboard answer instead of sleeping (follow-up)

The leaderboard test held back an answer, released it and slept 300 ms before checking it was ignored. It now waits for that response and two animation frames. The prototype checked the test still fails when the page's stale-answer guard is removed.

**Edit `apps/web/tests/daily.e2e.ts`**: 1 replacement, in order.

1. Find:
````ts
    await page.getByRole("button", { name: "All time" }).click();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "tsuru" })).toBeVisible();
    release();
    await expect.poll(() => answered).toBe(true);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
    await expect(page.getByText("49 cells · today")).toBeVisible();
    await expect(page.getByText("slowpoke")).toHaveCount(0);
  });
````
   Replace with:
````ts
    await page.getByRole("button", { name: "All time" }).click();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "tsuru" })).toBeVisible();
    const late = page.waitForResponse("**/api/leaderboards/areas/**");
    release();
    await late;
    expect(answered).toBe(true);
    // Let the page handle the late answer (two frames) before checking it was ignored.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await expect(page.getByText("49 cells · today")).toBeVisible();
    await expect(page.getByText("slowpoke")).toHaveCount(0);
  });
````

**Verify:** `bun run check`; `cd apps/web && E2E_PORT=4303 bunx playwright test tests/daily.e2e.ts -g "earlier choice" --repeat-each=10` shows 10 passed.

**Commit:** `test(web): wait for the late leaderboard answer instead of a fixed sleep`

### B3 The clock stops on pause and on solve, and a solved board is locked (follow-up)

Playwright's fake clock (`page.clock.install()`) makes seconds pass on demand, so the test reads exact times. The prototype checked it fails when the play screen keeps the clock running after a solve.

**Create `apps/web/tests/clock.e2e.ts`**:

````ts
import { createGrid, hEdgeIndex } from "@loophole/core";
import { expect, test } from "@playwright/test";
import { FIXTURE_SOLUTIONS } from "../src/lib/test-support/solutions.ts";
import { board, edgePoint, lines } from "./board.ts";

// The play clock (PRD FR-14, FR-17) under Playwright's fake clock, so seconds pass on demand: it
// runs while playing, stops on pause and on solve, and a solved board takes no more input.

const grid7 = createGrid(7, 7);

test.use({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });

test("the clock stops on pause and on solve, and a solved board takes no input", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/play/small-7");
  await expect(board(page)).toHaveAttribute("tabindex", "0");
  const clock = page.getByRole("timer").first();
  await expect(clock).toHaveText("00:00");

  await page.clock.runFor(5_000);
  await expect(clock).toHaveText("00:05");

  // Paused: a minute passes, the clock doesn't move.
  await page.getByRole("button", { name: "Pause" }).first().click();
  await expect(board(page)).toHaveCount(0);
  await page.clock.runFor(60_000);
  await expect(clock).toHaveText("00:05");
  await page.getByRole("button", { name: "Resume" }).first().click();
  await expect(board(page)).toBeVisible();
  await page.clock.runFor(2_000);
  await expect(clock).toHaveText("00:07");

  // Solved: the clock stops at the solve.
  const solution = FIXTURE_SOLUTIONS["small-7"];
  for (let e = 0; e < solution.length; e++) {
    if (solution[e] !== "1") continue;
    const p = await edgePoint(page, grid7, e);
    await page.touchscreen.tap(p.x, p.y);
  }
  await expect(page.getByRole("img", { name: "Solved" })).toBeVisible();
  const solvedText = await clock.textContent();
  await page.clock.runFor(120_000);
  await expect(clock).toHaveText(solvedText ?? "");
  await expect(page.getByText(`Solved in ${solvedText}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause" }).first()).toBeDisabled();

  // Locked: taps and keys change nothing, and the board leaves the Tab order.
  const lineCount = await lines(page).count();
  await expect(board(page)).toHaveAttribute("tabindex", "-1");
  const p = await edgePoint(page, grid7, hEdgeIndex(grid7, 0, 0));
  await page.touchscreen.tap(p.x, p.y);
  await board(page).dispatchEvent("keydown", { key: " " });
  await page.keyboard.press("x");
  await page.keyboard.press("z");
  await expect(lines(page)).toHaveCount(lineCount);
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
});
````

**Verify:** `bun run check`; `cd apps/web && E2E_PORT=4303 bunx playwright test tests/clock.e2e.ts` shows 1 passed.

**Commit:** `test(web): the clock stops on pause and on solve, and a solved board takes no input`

### B4 System health on the admin page

12a added `GET /api/admin/health`. The admin page now shows it above the reports, in words (NFR-5): each check OK or "Down: <error>", the queue, each daily size's stock ("3 days ahead", "today only", "today's is missing"), the latest failed jobs and the versions, with a "Check again" button. The text is built by plain functions in `lib/admin/health.ts` with tests beside them; the page stays thin. `tests/admin-mocks.ts` stands in for the admin API.

**Create `apps/web/src/lib/admin/health.ts`**:

````ts
import type { ApiClient, Schemas } from "@loophole/api-client";

export type AdminHealth = Schemas["AdminHealth"];

/** The admins' health report (PRD §5: admins view system health). */
export function createHealth(client: ApiClient) {
  return {
    /** The report, or null when it can't be read (not an admin, offline). */
    async read(): Promise<AdminHealth | null> {
      try {
        const { data } = await client.GET("/api/admin/health");
        return data ?? null;
      } catch {
        return null;
      }
    },
  };
}

/** "12s", "4m 05s", "3h 20m", "2d 4h": how long ago `iso` was, from `now`. */
export function elapsedText(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`;
}

/** "2 waiting (oldest 4m 05s), 1 running". */
export function queueText(jobs: AdminHealth["jobs"], now: number): string {
  const oldest =
    jobs.oldestQueuedAt === null ? "" : ` (oldest ${elapsedText(jobs.oldestQueuedAt, now)})`;
  return `${jobs.queued} waiting${oldest}, ${jobs.running} running`;
}

/** "generate · timeout · 10m 05s ago" for a failed job. */
export function failureText(job: AdminHealth["failures"][number], now: number): string {
  const when = job.finishedAt === null ? "" : ` · ${elapsedText(job.finishedAt, now)} ago`;
  return `${job.kind} · ${job.status}${when}`;
}

/** How a size class's daily stock reads: today's missing is the one that needs action. */
export function stockText(days: number): string {
  if (days === 0) return "today's is missing";
  return days === 1 ? "today only" : `${days} days ahead`;
}
````

**Create `apps/web/src/lib/admin/health.test.ts`**:

````ts
import { describe, expect, test } from "bun:test";
import { createApiClient } from "@loophole/api-client";
import { createHealth, elapsedText, failureText, queueText, stockText } from "./health.ts";

const REPORT = {
  database: { ok: true, ms: 1, error: null },
  blobs: { ok: false, ms: 2000, error: "No answer within 2000 ms" },
  jobs: { queued: 2, running: 1, oldestQueuedAt: "2026-10-25T11:58:00.000Z" },
  dailies: [{ size: 7, days: 3 }],
  failures: [],
  versions: { app: "abc123", generator: "1", runtime: "bun 1.3.13" },
  startedAt: "2026-10-25T10:00:00.000Z",
};

function clientAnswering(status: number, body: unknown) {
  const fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof globalThis.fetch;
  return createApiClient({ baseUrl: "http://api.test", fetch });
}

describe("admin health", () => {
  test("reads the report, or null when the server refuses", async () => {
    expect(await createHealth(clientAnswering(200, REPORT)).read()).toEqual(REPORT);
    expect(
      await createHealth(clientAnswering(403, { title: "Admins only", status: 403 })).read(),
    ).toBeNull();
  });

  test("writes ages and the daily stock in words", () => {
    const now = Date.parse("2026-10-25T12:00:00.000Z");
    expect(elapsedText("2026-10-25T11:59:48.000Z", now)).toBe("12s");
    expect(elapsedText("2026-10-25T11:55:55.000Z", now)).toBe("4m 05s");
    expect(elapsedText("2026-10-25T08:40:00.000Z", now)).toBe("3h 20m");
    expect(elapsedText("2026-10-23T08:00:00.000Z", now)).toBe("2d 4h");
    expect(queueText(REPORT.jobs, now)).toBe("2 waiting (oldest 2m 00s), 1 running");
    expect(queueText({ queued: 0, running: 0, oldestQueuedAt: null }, now)).toBe(
      "0 waiting, 0 running",
    );
    const failed = {
      id: "j1",
      kind: "verify" as const,
      status: "timeout" as const,
      error: "Stopped after the 45 s time limit.",
      finishedAt: "2026-10-25T11:50:00.000Z",
    };
    expect(failureText(failed, now)).toBe("verify · timeout · 10m 00s ago");
    expect(failureText({ ...failed, finishedAt: null }, now)).toBe("verify · timeout");
    expect(stockText(0)).toBe("today's is missing");
    expect(stockText(1)).toBe("today only");
    expect(stockText(3)).toBe("3 days ahead");
  });
});
````

**Create `apps/web/src/lib/admin/index.ts`**:

````ts
import { createApiClient } from "@loophole/api-client";
import { createHealth } from "./health.ts";

export {
  type AdminHealth,
  elapsedText,
  failureText,
  queueText,
  stockText,
} from "./health.ts";

/** The admins' health report. */
export const health = createHealth(createApiClient());
````

**Replace the whole of `apps/web/src/routes/admin/+page.svelte`**:

````svelte
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
````

**Edit `apps/web/src/routes/account/+page.svelte`**: 1 replacement, in order.

1. Find:
````svelte
    <GuestImport />
    <p><button class="primary" type="button" onclick={() => logOut(user.id)}>Log out</button></p>
    {#if logOutError}<p class="error" role="alert">{logOutError}</p>{/if}
    {#if user.isAdmin}<p><a href="/admin">Reported puzzles</a></p>{/if}

    <h2 id="name">Name on leaderboards</h2>
    <p>
````
   Replace with:
````svelte
    <GuestImport />
    <p><button class="primary" type="button" onclick={() => logOut(user.id)}>Log out</button></p>
    {#if logOutError}<p class="error" role="alert">{logOutError}</p>{/if}
    {#if user.isAdmin}<p><a href="/admin">Admin: system health and reported puzzles</a></p>{/if}

    <h2 id="name">Name on leaderboards</h2>
    <p>
````

**Create `apps/web/tests/admin-mocks.ts`**:

````ts
import type { Schemas } from "@loophole/api-client";
import type { Page } from "@playwright/test";
import { USER } from "./daily-mocks.ts";

// A stand-in for the admin API, so the admin page can be checked with no server.

export const HEALTH: Schemas["AdminHealth"] = {
  database: { ok: true, ms: 1, error: null },
  blobs: { ok: false, ms: 2000, error: "No answer within 2000 ms" },
  jobs: { queued: 2, running: 1, oldestQueuedAt: new Date(Date.now() - 125_000).toISOString() },
  dailies: [
    { size: 7, days: 3 },
    { size: 10, days: 3 },
    { size: 20, days: 1 },
    { size: 40, days: 0 },
  ],
  failures: [
    {
      id: "j9",
      kind: "generate",
      status: "timeout",
      error: "Stopped after the 60 s time limit.",
      finishedAt: new Date(Date.now() - 600_000).toISOString(),
    },
  ],
  versions: { app: "4f8cb61", generator: "1", runtime: "bun 1.3.13" },
  startedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
};

/** Logs in as an admin and answers the health report and an empty reports list. */
export async function mockAdminApi(page: Page) {
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { user: { ...USER, isAdmin: true } } }),
  );
  await page.route("**/api/admin/health", (route) => route.fulfill({ json: HEALTH }));
  await page.route("**/api/admin/reports", (route) => route.fulfill({ json: { items: [] } }));
}
````

**Create `apps/web/tests/admin.e2e.ts`**:

````ts
import { expect, test } from "@playwright/test";
import { mockAdminApi } from "./admin-mocks.ts";
import { scrollsSideways } from "./board.ts";

// The admin page's health view (PRD §5), against the stand-in in admin-mocks.ts.

test.use({ viewport: { width: 360, height: 560 }, hasTouch: true, isMobile: true });

test("shows system health in words: checks, queue, daily stock, failures, versions", async ({
  page,
}) => {
  await mockAdminApi(page);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "System health" })).toBeVisible();
  const health = page.locator("dl.health");
  await expect(health).toContainText("Database");
  await expect(health).toContainText("OK");
  await expect(health).toContainText("Down: No answer within 2000 ms");
  await expect(health).toContainText(/2 waiting \(oldest 2m \d\ds\), 1 running/);
  await expect(health).toContainText("Small 7×7: 3 days ahead");
  await expect(health).toContainText("Large 20×20: today only");
  await expect(health).toContainText("Giant 40×40: today's is missing");
  await expect(health).toContainText("app 4f8cb61, generator 1, bun 1.3.13");
  await expect(page.getByText(/generate · timeout · 10m \d\ds ago/)).toBeVisible();
  await expect(page.getByText("Stopped after the 60 s time limit.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reported puzzles" })).toBeVisible();
  await expect(page.getByText("No open reports.")).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
});

test("a player who isn't an admin sees nothing of it", async ({ page }) => {
  await page.route("**/api/session", (route) => route.fulfill({ json: { user: null } }));
  await page.goto("/admin");
  await expect(page.getByText("Admins only.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "System health" })).toHaveCount(0);
});
````

**Verify:** `bun run check`; `cd apps/web && E2E_PORT=4303 bunx playwright test tests/admin.e2e.ts` shows 2 passed.

**Commit:** `feat(web): system health on the admin page`

### B5 Accessibility checks in both themes (NFR-5)

axe-core's WCAG 2.0–2.2 A and AA rules on every main screen, in both themes, on a phone and a desktop. In the prototype the first run found one real problem, on the home page in Paper: the covers of dailies not ready yet were dimmed with `opacity: 0.6`, which put their text at 3.7:1. Only the dot paper fades now.

**Run** (4.13.0 is the newest release more than two weeks old (4.14.0 is from 15 October)):

```sh
cd apps/web && bun add --dev --exact @axe-core/playwright@4.13.0
```

**Edit `apps/web/src/lib/components/BookCover.svelte`**: 2 replacements, in order.

1. Find:
````svelte
    outline: 2px solid #1e1c19;
  }

  .disabled {
    opacity: 0.6;
  }

  .badge {
    position: absolute;
    top: 0;
````
   Replace with:
````svelte
    outline: 2px solid #1e1c19;
  }

  .badge {
    position: absolute;
    top: 0;
````

2. Find:
````svelte
    background-image: radial-gradient(#1e1c19 1.3px, transparent 1.6px);
    background-size: var(--dots) var(--dots);
    background-position: 4px 4px;
  }

  .status {
````
   Replace with:
````svelte
    background-image: radial-gradient(#1e1c19 1.3px, transparent 1.6px);
    background-size: var(--dots) var(--dots);
    background-position: 4px 4px;
  }

  /* A puzzle that isn't ready: only the dot paper fades, so the words keep their contrast (NFR-5). */
  .disabled .paper {
    opacity: 0.45;
  }

  .status {
````

**Create `apps/web/tests/a11y.e2e.ts`**:

````ts
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { FIXTURE_SOLUTIONS } from "../src/lib/test-support/solutions.ts";
import { mockAdminApi } from "./admin-mocks.ts";
import { board } from "./board.ts";
import { attempt, mockDailyApi, TODAY } from "./daily-mocks.ts";

// Automated accessibility checks (PRD NFR-5): axe-core's WCAG 2.2 A and AA rules, contrast
// included, on the main screens in both themes, on a phone and a desktop. Screens that need the
// API get the daily stand-in from daily-mocks.ts.

interface Screen {
  readonly name: string;
  readonly path: string;
  /** Before the page loads: API stand-ins. */
  readonly mock?: (page: Page) => Promise<void>;
  /** After it loads: get the screen into the state to check. */
  readonly act?: (page: Page) => Promise<void>;
}

const FINISHED = attempt({ status: "finished", elapsedMs: 198_000, ranked: true, rank: 214 });

const SCREENS: Screen[] = [
  { name: "home, guest", path: "/", mock: (p) => mockDailyApi(p) },
  { name: "home, player", path: "/", mock: (p) => mockDailyApi(p, { user: true }) },
  { name: "play", path: "/play/small-7" },
  {
    name: "play, hint card",
    path: "/play/small-7",
    act: async (p) => {
      await board(p).focus();
      await p.keyboard.press("h");
      await expect(p.getByRole("button", { name: "Apply" })).toBeVisible();
    },
  },
  {
    name: "play, paused",
    path: "/play/small-7",
    act: async (p) => {
      await p.getByRole("button", { name: "Pause" }).first().click();
      await expect(p.getByText("一時停止")).toBeVisible();
    },
  },
  { name: "create", path: "/create" },
  { name: "log in", path: "/login" },
  { name: "sign up", path: "/signup" },
  { name: "forgot password", path: "/forgot-password" },
  {
    name: "daily, ranked start",
    path: `/daily/${TODAY}/7`,
    mock: (p) => mockDailyApi(p, { user: true }),
  },
  {
    name: "daily, solved",
    path: `/daily/${TODAY}/7`,
    mock: (p) =>
      mockDailyApi(p, { user: true, attempt: FINISHED, progress: FIXTURE_SOLUTIONS["small-7"] }),
  },
  { name: "leaderboard", path: "/leaderboard", mock: (p) => mockDailyApi(p, { user: true }) },
  { name: "account", path: "/account", mock: (p) => mockDailyApi(p, { user: true }) },
  { name: "admin", path: "/admin", mock: mockAdminApi },
];

for (const theme of ["light", "dark"] as const) {
  for (const viewport of [
    { width: 390, height: 664 },
    { width: 1280, height: 800 },
  ]) {
    test.describe(`${theme} theme, ${viewport.width}×${viewport.height}`, () => {
      test.use({ viewport });

      for (const screen of SCREENS) {
        test(`${screen.name} has no WCAG A or AA violations (NFR-5)`, async ({ page }) => {
          await page.addInitScript((t) => localStorage.setItem("loophole:theme", t), theme);
          await screen.mock?.(page);
          await page.goto(screen.path);
          await page.waitForLoadState("networkidle");
          await screen.act?.(page);
          const { violations } = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
            .analyze();
          const found = violations.flatMap((v) =>
            v.nodes.map((n) => `${v.id}: ${n.target.join(" ")} — ${n.failureSummary ?? ""}`),
          );
          expect(found).toEqual([]);
        });
      }
    });
  }
}
````

**Verify:** `bun run check`; `cd apps/web && E2E_PORT=4303 bunx playwright test tests/a11y.e2e.ts` shows 56 passed. To see the check catch something, put `opacity: 0.6;` back on `.disabled` in `BookCover.svelte`: the home screens in the light theme fail with `color-contrast`.

**Commit:** two commits: stage `apps/web/src/lib/components/BookCover.svelte` and commit `fix(web): covers of dailies not ready keep their text contrast`; then stage `apps/web/package.json`, `bun.lock` and `apps/web/tests/a11y.e2e.ts` and commit `test(web): axe accessibility checks on the main screens in both themes`

### B6 The PRD §6 user stories end to end

One test per story, on the full stack the auth config already starts (API serving the built app, worker, fresh database, Mailpit, Garage, Turnstile's test keys). Each starts as a new visitor or account. It skips itself without Mailpit, Garage or Cloudflare.

**Create `apps/web/playwright.stories.config.ts`**:

````ts
import { defineConfig } from "@playwright/test";
import auth from "./playwright.auth.config.ts";

// The PRD §6 user stories, end to end on the full stack: the same API (serving the built app),
// worker, fresh database, Mailpit and Garage as `bun run test:e2e:auth`. The tests skip themselves
// when Mailpit, Garage or challenges.cloudflare.com can't be reached. Run with
// `bun run test:e2e:stories` from the repo root; E2E_AUTH_PORT changes the port as for the auth tests.
export default defineConfig({ ...auth, testMatch: "**/*.story-e2e.ts" });
````

**Create `apps/web/tests/stories.story-e2e.ts`**:

````ts
import {
  createGrid,
  EdgeState,
  generate,
  hEdgeIndex,
  type Puzzle,
  parsePuzzle,
  RULE_TEXT,
  RULE_TITLE,
  serializePuzzle,
  verify,
} from "@loophole/core";
import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test";
import { board, edgePoint, lines } from "./board.ts";
import { canSignUp, mailedLink, reachable } from "./mailpit.ts";

// One test per user story in PRD §6, each as a new visitor or a new account, against the real
// API, worker, database, blob store and mail (playwright.stories.config.ts).

const PASSWORD = "hunter22-e2e";
const PHONE = { viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true };
const DESKTOP = { viewport: { width: 1280, height: 800 } };

// A fresh stack's worker first generates the dailies, and ranked solves wait out the minimum time.
test.describe.configure({ timeout: 90_000 });

test.beforeAll(async () => {
  test.skip(
    !(await canSignUp()) || !(await reachable("http://localhost:3903/health")),
    "needs Mailpit and Garage (docker compose up -d, scripts/garage-init.sh) and access to challenges.cloudflare.com",
  );
});

/** Signs up through the API and, unless `confirm` is false, confirms the email from Mailpit. */
async function newAccount(request: APIRequestContext, confirm = true): Promise<string> {
  const email = `story-${crypto.randomUUID()}@loophole.test`;
  const res = await request.post("/api/auth/signup", {
    data: { email, password: PASSWORD, captchaToken: "XXXX.DUMMY.TOKEN.XXXX" },
  });
  expect(res.status()).toBe(204);
  if (confirm) {
    const token = new URLSearchParams((await mailedLink(email)).split("#")[1]).get("token");
    expect((await request.post("/api/auth/verify-email", { data: { token } })).status()).toBe(204);
  }
  return email;
}

/** Logs in through the login page, as a player would. */
async function logIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("link", { name: "Account" })).toBeVisible();
}

/** Today's daily puzzle of `size`, once the worker has generated it. */
async function todaysDaily(request: APIRequestContext, size: number) {
  let id = "";
  let day = "";
  await expect
    .poll(
      async () => {
        const set = (await (await request.get("/api/daily")).json()) as {
          day: string;
          puzzles: { size: number; puzzleId: string | null }[];
        };
        day = set.day;
        id = set.puzzles.find((p) => p.size === size)?.puzzleId ?? "";
        return id;
      },
      { timeout: 30_000 },
    )
    .not.toBe("");
  return { id, day };
}

/** A new 5×5 practice puzzle, generated by the worker. */
async function generatedPuzzle(request: APIRequestContext): Promise<string> {
  const res = await request.post("/api/jobs/generate", { data: { width: 5, height: 5 } });
  expect(res.status()).toBe(202);
  const { id } = (await res.json()) as { id: string };
  await expect
    .poll(
      async () =>
        ((await (await request.get(`/api/jobs/${id}`)).json()) as { status: string }).status,
      {
        timeout: 30_000,
      },
    )
    .toBe("done");
  return id;
}

/** The puzzle's clues from the API, and its solution worked out from them as anyone could. */
async function solvedFromClues(request: APIRequestContext, id: string) {
  const served = (await (await request.get(`/api/puzzles/${id}`)).json()) as {
    puzzle: Record<string, unknown>;
  };
  const puzzle = parsePuzzle(served.puzzle);
  const [solution] = verify(puzzle).solutions;
  const lineEdges = [...solution.keys()].filter((e) => solution[e] === EdgeState.Line);
  return { puzzle, lineEdges };
}

/** Marks every line of the solution; the last one after `minMs` from `startedAt`. */
async function drawSolution(
  page: Page,
  puzzle: Puzzle,
  lineEdges: number[],
  touch: boolean,
  minMs = 0,
  startedAt = Date.now(),
) {
  const tap = async (edge: number) => {
    const p = await edgePoint(page, puzzle.grid, edge);
    if (touch) await page.touchscreen.tap(p.x, p.y);
    else await page.mouse.click(p.x, p.y);
  };
  for (const e of lineEdges.slice(0, -1)) await tap(e);
  // A ranked solve faster than the loop could be drawn isn't ranked (DECISIONS, timing).
  await page.waitForTimeout(Math.max(0, minMs - (Date.now() - startedAt)));
  await tap(lineEdges[lineEdges.length - 1]);
}

async function newPage(browser: Browser, options: typeof PHONE | typeof DESKTOP) {
  return (await browser.newContext(options)).newPage();
}

test("as a guest, I can start a puzzle in one tap and solve it on my phone", async ({
  browser,
  request,
}) => {
  const { id } = await todaysDaily(request, 7);
  const { puzzle, lineEdges } = await solvedFromClues(request, id);
  const page = await newPage(browser, PHONE);
  await page.goto("/");
  // One tap on today's small cover opens the board, no account needed.
  await page
    .getByRole("list", { name: "Today's daily puzzles" })
    .getByRole("link", { name: /Small/ })
    .tap();
  await expect(board(page)).toHaveAttribute("tabindex", "0");
  await expect(page.getByText("Playing unranked.")).toBeVisible();
  await drawSolution(page, puzzle, lineEdges, true);
  await expect(page.getByRole("img", { name: "Solved" })).toBeVisible();
  await page.context().close();
});

test("as a player, I can leave a puzzle and resume it on another device", async ({
  browser,
  request,
}) => {
  const id = await generatedPuzzle(request);
  // Saving progress doesn't need a confirmed email.
  const email = await newAccount(request, false);
  const grid = createGrid(5, 5);

  const phone = await newPage(browser, PHONE);
  await logIn(phone, email);
  await phone.goto(`/play/${id}`);
  await expect(board(phone)).toHaveAttribute("tabindex", "0");
  const saved = phone.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().includes(`/progress/${id}`) && r.ok(),
  );
  const p = await edgePoint(phone, grid, hEdgeIndex(grid, 0, 0));
  await phone.touchscreen.tap(p.x, p.y);
  await saved;
  await phone.context().close();

  const laptop = await newPage(browser, DESKTOP);
  await logIn(laptop, email);
  await laptop.getByRole("link", { name: /5×5.*In progress/ }).click();
  await expect(laptop).toHaveURL(`/play/${id}`);
  await expect(lines(laptop)).toHaveCount(1);
  await laptop.context().close();
});

test("as a player, I can ask for a hint and understand why the move is forced", async ({
  browser,
  request,
}) => {
  const id = await generatedPuzzle(request);
  const page = await newPage(browser, PHONE);
  await page.goto(`/play/${id}`);
  await expect(board(page)).toHaveAttribute("tabindex", "0");
  const asked = page.waitForResponse((r) => r.url().endsWith(`/api/puzzles/${id}/hint`) && r.ok());
  await page.getByRole("button", { name: "Hint" }).click();
  const hint = (await (await asked).json()) as { kind: string; rule: keyof typeof RULE_TITLE };
  // An empty board's first hint is a deduction: its rule named and explained in words.
  expect(hint.kind).toBe("step");
  await expect(page.getByRole("heading", { name: RULE_TITLE[hint.rule] })).toBeVisible();
  await expect(page.getByText(RULE_TEXT[hint.rule])).toBeVisible();
  await expect(page.getByText("Hint used").first()).toBeVisible();
  await page.getByRole("button", { name: "Apply move" }).click();
  await expect(page.getByRole("navigation", { name: "Puzzle tools" })).toBeVisible();
  await page.context().close();
});

test("as a player, I can see how my solve time ranks among puzzles of the same size and level", async ({
  browser,
  request,
}) => {
  const page = await newPage(browser, PHONE);
  const email = await newAccount(page.request);
  const { id, day } = await todaysDaily(request, 7);
  const { puzzle, lineEdges } = await solvedFromClues(request, id);
  await logIn(page, email);
  await page.goto(`/daily/${day}/7`);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(board(page)).toBeVisible();
  await drawSolution(page, puzzle, lineEdges, true, 6_000);
  await expect(page.getByText("Rank today")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("49 cells · today")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "You" })).toBeVisible();
  // The all-time board of the same area (7×7 = 49 cells) and level.
  await page.goto("/leaderboard?size=7&scope=all");
  await expect(page.getByText("49 cells · all time")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "You" })).toBeVisible();
  await page.context().close();
});

test("as a creator, I can enter clues and be told if the puzzle is unique, has no solution, or has several", async ({
  browser,
}) => {
  const page = await newPage(browser, DESKTOP);
  const email = await newAccount(page.request);
  await logIn(page, email);
  const openDraft = async (draft: object) => {
    await page.evaluate(
      (text) => localStorage.setItem("loophole:editor-draft", text),
      JSON.stringify(draft),
    );
    await page.goto("/create");
  };
  await page.goto("/create");
  await openDraft({ v: 1, width: 2, height: 2, clues: "...." });
  await expect(page.getByText("More than one answer")).toBeVisible();
  await openDraft({ v: 1, width: 1, height: 1, clues: "0" });
  await expect(page.getByText("No answer", { exact: true })).toBeVisible();
  // A unique puzzle the worker then proves and publishes (FR-27): a 5×5 nobody has published.
  const { clues } = serializePuzzle(
    generate({ width: 5, height: 5, seed: crypto.randomUUID() }).puzzle,
  );
  await openDraft({ v: 1, width: 5, height: 5, clues });
  await expect(page.getByText("Exactly one answer")).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.context().close();
});

test("as a player, I can play today's daily puzzle and keep a streak", async ({
  browser,
  request,
}) => {
  const page = await newPage(browser, DESKTOP);
  const email = await newAccount(page.request);
  const { id } = await todaysDaily(request, 10);
  const { puzzle, lineEdges } = await solvedFromClues(request, id);
  await logIn(page, email);
  await page.goto("/");
  await expect(page.getByLabel("Streak")).toContainText("0 day streak");
  const covers = page.getByRole("list", { name: "Today's daily puzzles" });
  await covers.getByRole("link", { name: /Medium/ }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await expect(board(page)).toBeVisible();
  // 10×10 needs at least 10 s to count (0.1 s per cell).
  await drawSolution(page, puzzle, lineEdges, false, 11_000);
  await expect(page.getByText("Rank today")).toBeVisible({ timeout: 15_000 });
  await page.goto("/");
  await expect(page.getByLabel("Streak")).toContainText("1 day streak");
  await expect(covers.getByRole("link", { name: /Medium.*Solved/ })).toBeVisible();
  await page.context().close();
});
````

**Edit `apps/web/package.json`**: 1 replacement, in order.

1. Find:
````json
    "test:e2e:auth": "playwright test --config playwright.auth.config.ts"
````
   Replace with:
````json
    "test:e2e:auth": "playwright test --config playwright.auth.config.ts",
    "test:e2e:stories": "playwright test --config playwright.stories.config.ts"
````

**Edit `package.json`**: 1 replacement, in order.

1. Find:
````json
    "test:e2e": "bun run --cwd apps/web test:e2e",
    "test:perf": "bun run --cwd apps/web test:perf",
    "test:e2e:auth": "bun run --cwd apps/web test:e2e:auth",
    "dev:api": "bun --watch apps/server/src/api/main.ts",
    "dev:worker": "bun --watch apps/server/src/worker/main.ts",
    "gen:api": "bun apps/server/scripts/gen-api.ts",
````
   Replace with:
````json
    "test:e2e": "bun run --cwd apps/web test:e2e",
    "test:perf": "bun run --cwd apps/web test:perf",
    "test:e2e:auth": "bun run --cwd apps/web test:e2e:auth",
    "test:e2e:stories": "bun run --cwd apps/web test:e2e:stories",
    "dev:api": "bun --watch apps/server/src/api/main.ts",
    "dev:worker": "bun --watch apps/server/src/worker/main.ts",
    "gen:api": "bun apps/server/scripts/gen-api.ts",
````

**Verify:** `bun run check`. With the dev services up (`docker compose up -d`, `./scripts/garage-init.sh`): `E2E_AUTH_PORT=4304 bun run test:e2e:stories` shows 6 passed (about 40 s). Stop the services afterwards with `docker compose stop` if you started them.

**Commit:** `test(web): end-to-end tests of the PRD user stories`

### B7 Time to first interaction under 2 s (PRD §10): Latin fonts first

Measured before this step: about 2.6–3.1 s for a cold load of the home page or a puzzle on a slowed phone and network, because the five `@fontsource` weights bring about 720 KB of `@font-face` rules (one per Japanese glyph range) that block the first paint. The root layout now imports only the Latin subsets (about 300 bytes each), so Latin text has its final font from the first paint; `$lib/fonts.ts` imports the full stylesheets after it, and only the few Japanese words swap in later. In the prototype both pages then took about 1.6 s. Deferring every font also met the target but swapped Latin text under taps, so this split is the one to keep. The only flaky runs seen with it came from tests measuring the board before it had rendered (the deferred import changes hydration timing a little), so `dotPoints` in `tests/board.ts` now waits for the board's dots. The check asserts the 2 s budget, so a slow or broken page fails it.

**Edit `apps/web/src/routes/+layout.svelte`**: 2 replacements, in order.

1. Find:
````svelte
<script lang="ts">
  import "@fontsource/zen-kaku-gothic-new/400.css";
  import "@fontsource/zen-kaku-gothic-new/500.css";
  import "@fontsource/zen-kaku-gothic-new/700.css";
  import "@fontsource/zen-maru-gothic/700.css";
  import "@fontsource/zen-maru-gothic/900.css";
  import { onMount } from "svelte";
  import { auth } from "$lib/auth/index.ts";
  import "../app.css";
````
   Replace with:
````svelte
<script lang="ts">
  // Latin first: these small stylesheets block the first paint, so Latin text never swaps fonts.
  // The full ones (every Japanese glyph range, about 700 KB of rules) load after it ($lib/fonts.ts).
  import "@fontsource/zen-kaku-gothic-new/latin-400.css";
  import "@fontsource/zen-kaku-gothic-new/latin-500.css";
  import "@fontsource/zen-kaku-gothic-new/latin-700.css";
  import "@fontsource/zen-maru-gothic/latin-700.css";
  import "@fontsource/zen-maru-gothic/latin-900.css";
  import { onMount } from "svelte";
  import { auth } from "$lib/auth/index.ts";
  import "../app.css";
````

2. Find:
````svelte
  // Find out once who is logged in; the header and the account pages read the store.
  onMount(() => {
    auth.refresh();
  });
</script>

````
   Replace with:
````svelte
  // Find out once who is logged in; the header and the account pages read the store.
  onMount(() => {
    auth.refresh();
    void import("$lib/fonts.ts");
  });
</script>

````

**Create `apps/web/src/lib/fonts.ts`**:

````ts
// The design kit's fonts in full (DECISIONS, "Self-hosted fonts"), with the Japanese glyph ranges.
// The root layout imports this after the first paint, since these stylesheets are about 700 KB of
// @font-face rules; the Latin subsets it imports itself are there from the start (PRD §10).
import "@fontsource/zen-kaku-gothic-new/400.css";
import "@fontsource/zen-kaku-gothic-new/500.css";
import "@fontsource/zen-kaku-gothic-new/700.css";
import "@fontsource/zen-maru-gothic/700.css";
import "@fontsource/zen-maru-gothic/900.css";
````

**Edit `apps/web/tests/board.ts`**: 1 replacement, in order.

1. Find:
````ts
  return page.locator("[role=application]");
}

/** Page coordinates of every dot of an SVG board, from where the dots render (index order). */
export async function dotPoints(page: Page): Promise<{ x: number; y: number }[]> {
  return page.locator("[role=application] circle.dot").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
````
   Replace with:
````ts
  return page.locator("[role=application]");
}

/**
 * Page coordinates of every dot of an SVG board, from where the dots render (index order). Waits
 * for the board to render first, so a call right after `page.goto` doesn't read an empty board.
 */
export async function dotPoints(page: Page): Promise<{ x: number; y: number }[]> {
  const dots = page.locator("[role=application] circle.dot");
  await dots.first().waitFor();
  return dots.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
````

**Create `apps/web/tests/first-interaction.e2e.ts`**:

````ts
import { type Browser, expect, type Page, test } from "@playwright/test";
import { board } from "./board.ts";

// PRD §10: p95 time to first interaction on a mid-range phone under 2 s. Each load starts with an
// empty cache, the CPU slowed 4× and a slow 4G network (150 ms round trips, 1.6 Mbit/s down), as
// Lighthouse models a mid-range phone. The time runs from navigation until the page takes input.
// Run with `bun run test:perf`; like the frame-time checks, it depends on the machine.
//
// The design kit's fonts load in two parts so this holds: the Latin subsets block the first paint
// (about 2 KB of rules), and the full stylesheets with the Japanese glyph ranges (about 700 KB) load
// after it (DECISIONS, "Time to first interaction").

const LOADS = 5;
const BUDGET_MS = 2_000;

async function phonePage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 664 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  return page;
}

async function p95Load(browser: Browser, path: string, ready: (page: Page) => Promise<void>) {
  const times: number[] = [];
  for (let i = 0; i < LOADS; i++) {
    const page = await phonePage(browser);
    const started = Date.now();
    await page.goto(path, { waitUntil: "commit" });
    await ready(page);
    times.push(Date.now() - started);
    await page.context().close();
  }
  times.sort((a, b) => a - b);
  return { times, p95: times[Math.min(times.length - 1, Math.ceil(0.95 * times.length) - 1)] };
}

test.describe("@perf time to first interaction (PRD §10)", () => {
  test("the home page takes a tap within 2 s", async ({ browser }) => {
    const { times, p95 } = await p95Load(browser, "/", async (page) => {
      await expect(page.getByRole("heading", { name: "Practice 練習" })).toBeVisible({
        timeout: 15_000,
      });
    });
    console.log(`home: ${times.join(", ")} ms; p95 ${p95} ms`);
    expect(p95).toBeLessThan(BUDGET_MS);
  });

  test("a puzzle takes its first move within 2 s", async ({ browser }) => {
    const { times, p95 } = await p95Load(browser, "/play/small-7", async (page) => {
      await expect(board(page)).toHaveAttribute("tabindex", "0", { timeout: 15_000 });
    });
    console.log(`play: ${times.join(", ")} ms; p95 ${p95} ms`);
    expect(p95).toBeLessThan(BUDGET_MS);
  });
});
````

**Verify:** `bun run check`. On a quiet host (`uptime` load under 4): `E2E_PORT=4303 bun run test:perf` shows 4 passed, with the first-interaction times printed (about 1.6 s p95 in the prototype). Then check nothing moves under taps: `E2E_PORT=4303 bun run test:e2e` three times (139 passed each time) and `cd apps/web && E2E_PORT=4303 bunx playwright test tests/play.e2e.ts tests/zoom.e2e.ts tests/hint.e2e.ts tests/editor.e2e.ts tests/clock.e2e.ts tests/daily.e2e.ts --repeat-each=3` (243 passed).

**Commit:** two commits: stage `apps/web/tests/board.ts` and commit `test(web): read board dots only once the board has rendered`; then stage the rest and commit `perf(web): load the fonts' Latin subsets first and the Japanese ranges after the first paint`

### B8 The offline end-to-end tests in CI

**Edit `.github/workflows/ci.yml`**: 1 replacement, in order.

1. Find:
````yaml
          bun-version-file: package.json
      - run: bun install --frozen-lockfile
      - run: bun run check
````
   Replace with:
````yaml
          bun-version-file: package.json
      - run: bun install --frozen-lockfile
      - run: bun run check

  # The end-to-end tests that need no server (bun run test:e2e), including the accessibility
  # checks. The account, publishing and story suites need Mailpit, Garage and Cloudflare, and the
  # timing checks (test:perf) depend on the machine, so they run locally (docs/TESTING.md).
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: package.json
      - run: bun install --frozen-lockfile
      - run: bunx playwright install --with-deps chromium
        working-directory: apps/web
      - run: bun run test:e2e
      - uses: actions/upload-artifact@v7
        if: failure()
        with:
          name: playwright-results
          path: apps/web/test-results
          retention-days: 7
````

**Verify:** `bun run check`; `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` prints nothing. The job itself can only run on GitHub; locally, `E2E_PORT=4303 bun run test:e2e` is what it runs.

**Commit:** `ci: run the end-to-end tests that need no server`

### B9 Docs

**Edit `README.md`**: 6 replacements, in order.

1. Find:
````markdown
and there is a production Docker image with a Compose file and a database backup script. Each phase's plan is in
````
   Replace with:
````markdown
and there is a production Docker image with a Compose file and a database backup script. Admins see system health on the admin page, and end-to-end suites cover the PRD's user stories and check accessibility in both themes. Each phase's plan is in
````

2. Find:
````markdown
`bun run test:perf` runs the frame-time checks for drawing and zooming large boards, with the CPU slowed to stand in for a mid-range phone. They are kept apart because their timings depend on the machine.
````
   Replace with:
````markdown
They include accessibility checks (axe-core's WCAG 2.2 A and AA rules, contrast among them) on the main screens in both themes, and CI runs them too.

`bun run test:perf` runs the frame-time checks for drawing and zooming large boards, with the CPU slowed to stand in for a mid-range phone, and the time to first interaction on a phone with a slow network (PRD §10). They are kept apart because their timings depend on the machine; run them on an idle host. A puzzle and the home page take their first input in about 1.6 s there, under the 2 s target, because only the fonts' Latin subsets hold up the first paint (`docs/DECISIONS.md`, "Time to first interaction").
````

3. Find:
````markdown
The daily test waits for the worker to generate today's puzzles, solves the 7×7 ranked and checks its rank.
````
   Replace with:
````markdown
The daily test waits for the worker to generate today's puzzles, solves the 7×7 ranked and checks its rank.

`bun run test:e2e:stories` runs one test for each user story in the PRD (§6) on the same stack: a guest starts and solves a puzzle in one tap on a phone; a player resumes on another device; a hint names and explains its rule; a ranked solve shows its rank among boards of the same size; a creator is told when a puzzle has one answer, none or several, and publishes it; a daily solve starts a streak. It needs the same services as `test:e2e:auth` and skips itself without them.
````

4. Find:
````markdown
To make an account an admin (for the reported puzzles page at `/admin` and, later, the health view), run from the repo root:
````
   Replace with:
````markdown
To make an account an admin (for the admin page at `/admin`: system health and reported puzzles), run from the repo root:
````

5. Find:
````markdown
Admins can also read `GET /api/admin/health`: the database and Garage checks with their errors, the job queue, the daily stock, recent failed jobs and the versions.
````
   Replace with:
````markdown
Admins also see a summary at `/admin`: the database and Garage checks with their errors, the job queue, the daily stock, recent failed jobs and the versions.
````

6. Find:
````markdown
| `bun run test:e2e:auth` | Build the web app, serve it from the API with a worker and run the account, publishing and progress end-to-end tests (needs Mailpit; publishing and progress also Garage) |
````
   Replace with:
````markdown
| `bun run test:e2e:auth` | Build the web app, serve it from the API with a worker and run the account, publishing and progress end-to-end tests (needs Mailpit; publishing and progress also Garage) |
| `bun run test:e2e:stories` | The same stack, running one end-to-end test per PRD §6 user story (needs Mailpit and Garage) |
````

**Edit `docs/TESTING.md`**: 3 replacements, in order.

1. Find:
````markdown
and then `bun run check` on every push to `main` and on every pull request.
````
   Replace with:
````markdown
and then `bun run check` on every push to `main` and on every pull request. A second job installs Chromium and runs `bun run test:e2e` (the end-to-end tests that need no server, accessibility checks included).
````

2. Find:
````markdown
The daily puzzle screens need the API, which `vite preview` doesn't have, so
````
   Replace with:
````markdown
The story suite (`tests/*.story-e2e.ts`, `bun run test:e2e:stories`) has one test per user story in PRD §6. Its config, `playwright.stories.config.ts`, reuses the auth config's API, worker, fresh database and services, so it needs and skips like `test:e2e:auth`.

The accessibility checks (`tests/a11y.e2e.ts`) run axe-core's WCAG 2.2 A and AA rules (`@axe-core/playwright`) on the main screens in both themes, on a phone and a desktop, with the daily and admin stand-ins for screens that need the API (`tests/daily-mocks.ts`, `tests/admin-mocks.ts`). A new screen gets a line in its list. `tests/clock.e2e.ts` drives the play clock with Playwright's fake clock (`page.clock`), so seconds pass on demand.

The daily puzzle screens need the API, which `vite preview` doesn't have, so
````

3. Find:
````markdown
Frame-time checks (`tests/perf.e2e.ts`, tagged `@perf`) slow the CPU down and measure animation frames while drawing and zooming large boards. `bun run test:e2e` skips them; run them with `bun run test:perf`. They stay out of the gate because their timings depend on the machine.
````
   Replace with:
````markdown
Frame-time checks (`tests/perf.e2e.ts`, tagged `@perf`) slow the CPU down and measure animation frames while drawing and zooming large boards, and `tests/first-interaction.e2e.ts` (also `@perf`) times cold loads of the home page and a puzzle on a slowed phone and network (PRD §10). `bun run test:e2e` skips them; run them with `bun run test:perf` on an idle machine (`uptime`: they miss their budgets when the load average is high). They stay out of the gate because their timings depend on the machine.
````

**Append to the end of `docs/DECISIONS.md`** (after its last line, keeping one blank line between entries):

````markdown
## 2026-10-25 · WT12 `launch-hardening` · Accessibility checks
- **Question:** How is NFR-5's "sufficient contrast in both themes" checked, beyond keyboard play and words over colour?
- **Decision:** `tests/a11y.e2e.ts` runs `@axe-core/playwright` 4.13.0 (4.14.0 is ten days old) with the WCAG 2.0, 2.1 and 2.2 A and AA rules on the main screens (home as guest and player, play, the hint card, pause, the editor, log in, sign up, forgot password, the ranked start and Solved screens, the leaderboard, the account page and the admin page) in both themes, at 390×664 and 1280×800, and fails on any violation. Screens that need the API use the daily and admin stand-ins. The first run found one problem: the covers of daily puzzles not ready yet were dimmed with `opacity: 0.6`, which took their text to 3.7:1. Now only the dot paper fades, and the text keeps full contrast.
- **Reason:** axe catches contrast, names, roles and structure on every screen in seconds and needs no server, so it runs with `bun run test:e2e` and in CI. Dimming only the decoration keeps "Not ready yet" readable, which is the information.

## 2026-10-25 · WT12 `launch-hardening` · User stories end to end
- **Question:** How are the PRD §6 user stories checked as a whole?
- **Decision:** `tests/stories.story-e2e.ts`, one test per story, run by `bun run test:e2e:stories` with `playwright.stories.config.ts`, which reuses the auth config (the API serving the built app, the worker, a fresh database, Mailpit, Garage, Turnstile's test keys). Every test starts as a new visitor or a new account: a guest taps today's 7×7 cover on a phone and solves it; a player's move on a phone is there on a laptop; a hint on a generated puzzle names and explains its rule; a ranked 7×7 solve shows "Rank today", the 49-cell board and the all-time board with the player on it; a creator is told "More than one answer", "No answer" and "Exactly one answer" and publishes the last; a ranked 10×10 solve turns a 0-day streak into 1. It skips itself without the services or Cloudflare, so it isn't in CI. The auth config also turns the metrics listeners off for its servers.
- **Reason:** The other suites test features one by one; this one reads like the PRD and catches a break anywhere along a story's path. Reusing the auth stack keeps one set of servers to maintain.

## 2026-10-25 · WT12 `launch-hardening` · Time to first interaction
- **Question:** Does Loophole meet PRD §10's "p95 time-to-first-interaction on a mid-range phone under 2 s"?
- **Decision:** It does now. `tests/first-interaction.e2e.ts` (`bun run test:perf`) loads the home page and a puzzle five times each with an empty cache, the CPU slowed 4× and a slow 4G network (150 ms round trips, 1.6 Mbit/s), times navigation to the first moment the page takes input, and fails at a p95 of 2 s or more. Before this change both took 2.6 to 3.1 s: the five `@fontsource` weights bring about 720 KB of `@font-face` rules (one per Japanese glyph range), which blocked the first paint. The root layout now imports only the Latin subsets (`latin-400.css` and so on, about 300 bytes each), so Latin text has its final font from the first paint and never swaps; `$lib/fonts.ts` imports the full stylesheets after the first paint, and the few Japanese words (the theme switch, 一時停止, スリザーリンク, 完) swap in when their glyphs arrive. Measured: about 1.6 s for both pages. Deferring every font, tried first, also met the target but swapped Latin text under taps. With the split, the full offline suite passed three times in a row and the play, zoom, hint, editor, clock and daily specs passed with `--repeat-each=3` twice; the only failures seen came from tests that measured the board before it rendered, so `dotPoints` in `tests/board.ts` now waits for the board's dots.
- **Reason:** The rules, not the font files, were the blocker, and almost all of them are for Japanese glyphs the app uses in a handful of places. Splitting keeps the self-hosted fonts (WT4) and moves only those rules off the critical path.

## 2026-10-25 · WT12 `launch-hardening` · Home keeps asking while a daily isn't ready
- **Question:** The home page stopped asking for today's set once the new day had arrived, so a cover stayed "Not ready yet" after the worker caught up (WT11b review follow-up). When should it ask again?
- **Decision:** Every 30 s while the server can't be reached, while this device's clock is past `nextAt`, or while any of today's sizes has no puzzle (`dailyRefreshDue` in `lib/daily/days.ts`, unit-tested). The leaderboard test that waited a fixed 300 ms for a late answer now waits for that answer and two animation frames.
- **Reason:** A missing daily is exactly when the player should see it appear without reloading; one small request every 30 s while something is missing costs nothing.

## 2026-10-25 · WT12 `launch-hardening` · End-to-end tests in CI
- **Question:** WT4 kept browser downloads out of CI. Now that the accessibility checks and the clock test live in `bun run test:e2e`, should CI run it?
- **Decision:** Yes, as a second job (`e2e`) next to `check`: install Chromium with `bunx playwright install --with-deps chromium` and run `bun run test:e2e`. `test:e2e:auth`, `test:e2e:stories` and `test:perf` stay local: the first two need Mailpit, Garage and Cloudflare, the last depends on the machine.
- **Reason:** The offline suite needs no server and covers every screen, so a regression in layout, accessibility or input should block a merge like a failing unit test. A separate job keeps `bun run check` itself free of browsers.
````

**Edit `apps/web/AGENTS.md`**: 1 replacement, in order.

1. Find:
````markdown
- Daily puzzles, ranked attempts and leaderboards go through `lib/daily`
````
   Replace with:
````markdown
- The admin page's health view gets its report through `lib/admin`, a plain tested module like the others.
- `tests/a11y.e2e.ts` runs axe-core on each main screen in both themes; add a new screen to its list.
- The root layout imports only the fonts' Latin subsets; the full stylesheets (Japanese glyphs) come from `$lib/fonts.ts` after the first paint, so time to first interaction stays under 2 s. Japanese text swaps in late, so keep it out of places where a change of width would move the board.
- Daily puzzles, ranked attempts and leaderboards go through `lib/daily`
````

**Verify:** `bun run check`.

**Commit:** `docs: admin health page, accessibility, user-story and first-interaction checks`

### B10 Full runs (no commit)

1. `E2E_PORT=4303 bun run test:e2e`: 139 passed (the prototype's count with WT11b merged; more if main gained tests).
2. With the dev services up: `E2E_AUTH_PORT=4304 bun run test:e2e:auth` (5 passed) and `E2E_AUTH_PORT=4304 bun run test:e2e:stories` (6 passed).
3. On a quiet host: `E2E_PORT=4303 bun run test:perf` (4 passed; first interaction under 2 s).
4. `./scripts/test-under-load.sh 6 3` reports no failing test.
5. Stop the dev services with `docker compose stop` if you started them; `git status --short` is clean.

## Acceptance criteria

- **§6 user stories**: each of the six has a passing test on the full stack (`test:e2e:stories`): guest one tap and solve on a phone; resume on another device; hint names and explains its rule; rank on today's and the all-time 49-cell board; creator told several, none, one, and publishes; daily solve makes a 1-day streak.
- **NFR-5**: axe reports no WCAG A or AA violation (contrast included) on the main screens in both themes at 390×664 and 1280×800 (`a11y.e2e.ts`); the admin page states every condition in words.
- **FR-14, FR-17 (follow-up)**: the clock stops on pause and on solve, and a solved board takes no taps or keys (`clock.e2e.ts`).
- **§5**: an admin sees checks, queue, daily stock, failures and versions at `/admin`; others see "Admins only." (`admin.e2e.ts`, `health.test.ts`).
- **§10**: p95 time to first interaction under 2 s for a cold home page and a cold puzzle on a 4× slowed CPU and slow 4G (`first-interaction.e2e.ts`, about 1.6 s), with no new flakiness in the input tests (`--repeat-each=3`).
- **NFR-1, NFR-2**: `test:perf`'s frame-time checks and 12a's `bench:jobs` still pass on a quiet host.
- **FR-22 (follow-up)**: Home asks again every 30 s while any of today's sizes has no puzzle (`days.test.ts`); no fixed sleep left in `daily.e2e.ts`.
- **CI**: the `e2e` job runs `bun run test:e2e` after `bunx playwright install --with-deps chromium` and uploads `apps/web/test-results` when it fails.
- `bun run check` passes after every step.

## DECISIONS entries (added in step B9)

Accessibility checks · User stories end to end · Time to first interaction · Home keeps asking while a daily isn't ready · End-to-end tests in CI. The full text is in step B9.

## Merge notes

- Depends on 12a (the admin health route and its generated client types, the auth config's metrics change, the root `package.json` and docs edits).
- WT11b is merged; the daily screens, `daily-mocks.ts` and `tests/ports.ts` this plan uses come from it. If main has moved on since `781a247`, merge it before starting and re-run B10.

## Review responses (plan review 1)

- **12b-1 (`test.fail` hides breakage; try a Latin-first split):** accepted, and the split works. With the Latin subsets imported eagerly and the full stylesheets loaded after the first paint, both pages take about 1.6 s (budget 2 s), so B7 adopts it and the check asserts the 2 s budget directly. No ceiling or known-gap mark remains. Stability: the full offline suite passed three times in a row, and the play, zoom, hint, editor, clock and daily specs passed with `--repeat-each=3` twice (243 each). The two flakes seen before the fix were tests reading board dots before the board rendered, not font swaps, so `dotPoints` now waits for the dots. Checked with the DevTools protocol that 一時停止 renders in Zen Maru Gothic once the full stylesheet has loaded. The full stylesheets load through a dynamic `import()` from the layout rather than a `<link media="print">` swap: an imported stylesheet goes through Vite like the eager ones, so its font files are bundled and their URLs rewritten with no extra config.
- **12b-2 (stories under the default timeout):** accepted. `test.describe.configure({ timeout: 90_000 })` covers all six, and the per-test overrides are gone.
- **12b-3 (no artifacts from CI):** accepted. The job uploads `apps/web/test-results` with `actions/upload-artifact@v7` (the current major, matching `checkout@v7`) when it fails, kept 7 days.

## Unresolved questions

- **CI e2e job** couldn't be run locally. Default: keep it; if GitHub's runner lacks something Chromium needs, `--with-deps` should cover it, otherwise pin the runner image.
- **Japanese text swaps in after the first paint** (the theme switch labels, 一時停止, スリザーリンク, 完). Default: accept it; none of it sits where a change of width moves the board. A 32-glyph subset font would remove the swap and can come later.
