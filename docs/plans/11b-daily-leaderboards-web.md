# WT11b `daily-leaderboards` (web) — implementation plan

The second of two plans for WT11. It starts from **main after WT11a (`docs/plans/11a-daily-leaderboards-server.md`) is merged**: the server routes, `openapi.yaml` and the generated client must already have the daily, attempt, leaderboard and display-name paths. Suggested branch and worktree: `feat/daily-leaderboards-web` at `/home/jhonnold/projects/loophole-wt/daily-leaderboards-web`, made from that main. Check first: `grep -c DailySet packages/api-client/src/schema.ts` must print a number above 0.

PRD: FR-22 (today's daily puzzles, switching at 00:00 UTC), FR-23 (leaderboard of the area bucket, hinted solves left out), FR-24 (streak, personal best), FR-17 and FR-25 (completion confirmed by the server; the client never gets the solution), FR-12 (a hint makes the solve unranked), NFR-2 (360 px, no sideways scroll), NFR-5 (words, not colour alone; keyboard reachable), NFR-6 (a ranked solve kept on the device goes with the account's keys), §6 stories (daily and streak; rank among the same size and level). Design: `docs/design/Home.dc.html`, `docs/design/Solved.dc.html`, `docs/design/README.md` (cover tints Sakura `#F2C4CE` 7×7, Kinari `#E8DFC4` 10×10, Sora `#C8DAE6` 20×20, Wakaba `#D5E3C2` 40×40).

## How to work through this plan

- Prefix every shell command with `export PATH="$HOME/.bun/bin:$PATH";` and run it from the worktree root. Run `bun install` once in a fresh worktree.
- **Create** means: write the file with exactly the content between the four-backtick fences (the Write tool). Paths with `[day]` and `[size]` are literal folder names (SvelteKit route parameters).
- **Edit** means: apply each numbered Find/Replace with the Edit tool, in order. Each Find block is copied from the file as it is at that point, including indentation, and occurs exactly once.
- **Replace the whole of** means: overwrite the file with the content shown.
- `bun run check` must pass before each commit; `bun run format` fixes formatting reported by Biome (it doesn't format `.svelte` files, so copy those exactly).
- End-to-end runs: other worktrees may hold ports 4173/4174, so run with your own, for example `E2E_PORT=4273 bun run test:e2e` and `E2E_AUTH_PORT=4274 bun run test:e2e:auth` (step B1 adds these variables). `bun run test:e2e:auth` needs `docker compose up -d` and `./scripts/garage-init.sh`; stop the services afterwards with `docker compose stop` only if you started them (never `down`, never `-v`).
- One existing test, `openDatabase and migrate > several connections opening a new file at once all succeed in WAL mode`, fails now and then on main too ("no such savepoint", "cannot start a transaction within a transaction"); if it is the only failure, run `bun run check` again. It is a known flake for WT12, not something to fix here.
- Commit after each step with the message given. Don't push.

## What this builds

- **Home** (`/`, Home artboard): the date line in Japanese and English ("日曜日 · Sunday 25 October", UTC), "Today's puzzles", a countdown to 00:00 UTC worked out on the device ("New puzzles in 5h 42m"; at midnight the covers reload), the streak card for confirmed players (count and the last seven days: 完 for a finished daily, dashed for today), a one-line note for guests and unconfirmed accounts, the four daily covers two by two (four across from 720 px) in their tints with badge, スリザーリンク, size name (Small, Medium, Large, Giant), dot paper and a status line (Solved · mm:ss with the 完 stamp, In progress, New · not started, New · best on a big screen for 40×40, Not ready yet), then Continue and the practice covers under "Practice 練習 · fresh, proven unique". Covers are one `BookCover` component for both. Without the server the page says daily puzzles need it and practice still works.
- **Daily page** (`/daily/<day>/<size>`): loads the day's set (`dayResult`: a day to come or a bad date is a 404 page, only an unreachable server a 503) and the puzzle (named "Small · 7×7", subtitle "Daily · 25 Oct · 今日の問題"). By mode (`dailyMode`, unit-tested):
  - confirmed player, today, no attempt → a "Ranked solve" card with the rules and **Start**; the board isn't shown until Start. A successful Start clears the saved board for that puzzle (`openSaves(…).load()`, `clear()`), so earlier unranked progress can't count; a 409 (the day ended while the page was open) runs `invalidateAll()` and the page plays unranked;
  - attempt being played → `PlayScreen` with the `ranked` prop: the clock starts from the server's elapsed time and never pauses (Pause disabled, leaving the tab doesn't pause), "Hint used · unranked", no Start over; on solve, the solve is sent through `lib/daily/finish.ts`, which keeps it in `localStorage` (`loophole:user:<id>:ranked:<puzzle>`) and retries (2 s, 5 s, 15 s, then every 30 s) until the server answers; a page opened later sends a kept solve first, or forgets it when the server already has the attempt finished;
  - attempt finished → the **Solved screen** (Solved artboard): header with back, title, subtitle and share (copies or shares "Loophole daily · Small 7×7 · 25 Oct · 03:18 · #214"), the solved board with the inside washed, the 完 SOLVED stamp and a note (ranked among N / hint used / too fast), Time, Rank today and Your best cards, a prompt to choose a name when listed as Anonymous, the 番付 Leaderboard card for the area ("49 cells · today") with the top rows, a gap and the player's neighbourhood, Next: Medium 10×10, All-time board, Play again, unranked;
  - guests, unconfirmed accounts, an earlier day, or a replay → plain `PlayScreen`, with a note under it.
- **Leaderboard page** (`/leaderboard?size=7&scope=all`): size chips and Today / All time, the same leaderboard card; linked as **Ranks** in the header.
- **Account page**: "Name on leaderboards" form (save, remove), and the deletion text mentions leaderboard entries.
- **Header**: main navigation Today, Create, Ranks; the wide header gets 24 px gutters from 900 px (follow-up).
- **PlayScreen** changes only by the optional `ranked` prop (about 25 lines); all ranking logic is in `lib/daily` and the daily route.

## Follow-ups handled here

- `[WT11]` *configurable Playwright preview port*: `E2E_PORT` (default 4173) for `test:e2e`/`test:perf`, `E2E_AUTH_PORT` (default 4174) for `test:e2e:auth`, in `tests/ports.ts`; documented in TESTING.md and README (step B1, B7).
- `[WT11]` *SiteHeader wide padding*: `@media (min-width: 900px) { .top-inner.wide { padding-left: 24px; padding-right: 24px; } }` (step B1).
- The display name, hint seam and hint `count` follow-ups were done in WT11a; the account page here adds the name form.

## Out of scope

Archive pages for earlier days (a past day's daily opens from a link, unranked, but nothing lists them). The Home artboard's Library tab, practice size chips with "New 7×7 puzzle" and "From players" list (nothing serves them yet). The Solved artboard's shu last stroke. A "ranked" badge inside the play screen (the gate card and the note under the board say it).

## Steps
### B1 Follow-ups: configurable end-to-end ports; wide header padding

The two follow-ups from earlier reviews. `tests/ports.ts` reads the ports once for the configs and the tests; the auth config also keeps the worker's daily stock small (`DAILY_DAYS_AHEAD: "2"`), so the tests' own generation jobs don't wait behind a dozen daily ones.

**Create `apps/web/tests/ports.ts`**:

````ts
// Ports the end-to-end tests serve the app on. Worktrees running tests side by side set their own,
// since `--strictPort` fails when another run holds the port.

/** `vite preview` for `bun run test:e2e` and `bun run test:perf`: `E2E_PORT`, default 4173. */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 4173);

/** The API serving the app for `bun run test:e2e:auth`: `E2E_AUTH_PORT`, default 4174. */
export const E2E_AUTH_PORT = Number(process.env.E2E_AUTH_PORT ?? 4174);
````

**Edit `apps/web/playwright.config.ts`**: 2 replacements, in order.

1. Find:
````ts
import { defineConfig } from "@playwright/test";

// End-to-end tests against the built app. Not part of `bun run check`: they need a Chromium build
// (`bunx playwright install chromium`). Run with `bun run test:e2e` from this package.
export default defineConfig({
  testDir: "tests",
````
   Replace with:
````ts
import { defineConfig } from "@playwright/test";
import { E2E_PORT } from "./tests/ports.ts";

// End-to-end tests against the built app. Not part of `bun run check`: they need a Chromium build
// (`bunx playwright install chromium`). Run with `bun run test:e2e` from this package; set E2E_PORT
// to serve on another port than 4173.
export default defineConfig({
  testDir: "tests",
````

2. Find:
````ts
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun run build && bun run preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    // Always serve a fresh build; fails fast if something else already holds the port.
    reuseExistingServer: false,
````
   Replace with:
````ts
  reporter: "list",
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `bun run build && bun run preview --port ${E2E_PORT} --strictPort`,
    url: `http://localhost:${E2E_PORT}`,
    // Always serve a fresh build; fails fast if something else already holds the port.
    reuseExistingServer: false,
````

**Edit `apps/web/playwright.auth.config.ts`**: 5 replacements, in order.

1. Find:
````ts
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// End-to-end tests of accounts, publishing and saved progress against the real API, which also
// serves the built app (as in production), and the job worker. Needs Mailpit and, for publishing
// and progress, Garage (`docker compose up -d`), and access to Cloudflare's Turnstile check; the
// tests skip themselves without them. Run with `bun run test:e2e:auth` from this package.

// A fresh database file for every run, shared by the API and the worker. Playwright loads this
````
   Replace with:
````ts
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import { E2E_AUTH_PORT } from "./tests/ports.ts";

// End-to-end tests of accounts, publishing and saved progress against the real API, which also
// serves the built app (as in production), and the job worker. Needs Mailpit and, for publishing
// and progress, Garage (`docker compose up -d`), and access to Cloudflare's Turnstile check; the
// tests skip themselves without them. Run with `bun run test:e2e:auth` from this package; set
// E2E_AUTH_PORT to serve on another port than 4174.

// A fresh database file for every run, shared by the API and the worker. Playwright loads this
````

2. Find:
````ts
const env = {
  DATABASE_PATH: join(process.env.LOOPHOLE_E2E_DIR, "e2e.sqlite"),
  PUBLIC_URL: "http://localhost:4174",
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
````
   Replace with:
````ts
const env = {
  DATABASE_PATH: join(process.env.LOOPHOLE_E2E_DIR, "e2e.sqlite"),
  PUBLIC_URL: `http://localhost:${E2E_AUTH_PORT}`,
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
````

3. Find:
````ts
  S3_ACCESS_KEY_ID: "GK1a2b3c4d5e6f708192a3b4c5",
  S3_SECRET_ACCESS_KEY: "8b339f8231fe89196b07eb8766bf6f079805f64a9be09934697b94e0b1aa0a0b",
};
````
   Replace with:
````ts
  S3_ACCESS_KEY_ID: "GK1a2b3c4d5e6f708192a3b4c5",
  S3_SECRET_ACCESS_KEY: "8b339f8231fe89196b07eb8766bf6f079805f64a9be09934697b94e0b1aa0a0b",
  // Today's and tomorrow's daily puzzles only, so the worker is soon free for the tests' own jobs.
  DAILY_DAYS_AHEAD: "2",
};
````

4. Find:
````ts
  reporter: "list",
  use: {
    baseURL: "http://localhost:4174",
    browserName: "chromium",
    trace: "retain-on-failure",
````
   Replace with:
````ts
  reporter: "list",
  use: {
    baseURL: `http://localhost:${E2E_AUTH_PORT}`,
    browserName: "chromium",
    trace: "retain-on-failure",
````

5. Find:
````ts
      // From the repo root, like the other server scripts.
      command: "bun run build && cd ../.. && bun apps/server/src/api/main.ts",
      url: "http://localhost:4174/api/health",
      reuseExistingServer: false,
      env: { ...env, PORT: "4174", WEB_DIR: "apps/web/build" },
    },
    {
````
   Replace with:
````ts
      // From the repo root, like the other server scripts.
      command: "bun run build && cd ../.. && bun apps/server/src/api/main.ts",
      url: `http://localhost:${E2E_AUTH_PORT}/api/health`,
      reuseExistingServer: false,
      env: { ...env, PORT: String(E2E_AUTH_PORT), WEB_DIR: "apps/web/build" },
    },
    {
````

**Edit `apps/web/tests/mailpit.ts`**: 2 replacements, in order.

1. Find:
````ts
import { expect } from "@playwright/test";

const MAILPIT_API = "http://127.0.0.1:8025/api/v1";
````
   Replace with:
````ts
import { expect } from "@playwright/test";
import { E2E_AUTH_PORT } from "./ports.ts";

const MAILPIT_API = "http://127.0.0.1:8025/api/v1";
````

2. Find:
````ts
          Text: string;
        };
        link = message.Text.match(/http:\/\/localhost:4174(\/\S+#token=\S+)/)?.[1] ?? "";
        return link;
      },
````
   Replace with:
````ts
          Text: string;
        };
        const pattern = new RegExp(`http://localhost:${E2E_AUTH_PORT}(/\\S+#token=\\S+)`);
        link = message.Text.match(pattern)?.[1] ?? "";
        return link;
      },
````

**Edit `apps/web/tests/submit.auth-e2e.ts`**: 2 replacements, in order.

1. Find:
````ts
import { expect, test } from "@playwright/test";
import { canSignUp, mailedLink, reachable } from "./mailpit.ts";

test.beforeAll(async () => {
````
   Replace with:
````ts
import { expect, test } from "@playwright/test";
import { canSignUp, mailedLink, reachable } from "./mailpit.ts";
import { E2E_AUTH_PORT } from "./ports.ts";

test.beforeAll(async () => {
````

2. Find:
````ts
  const link = await page.getByLabel("Link to share").inputValue();
  expect(link).toMatch(/^http:\/\/localhost:4174\/play\/[0-9a-f-]{36}$/);
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Player-made · 5×5" })).toBeVisible();
````
   Replace with:
````ts
  const link = await page.getByLabel("Link to share").inputValue();
  expect(link).toMatch(new RegExp(`^http://localhost:${E2E_AUTH_PORT}/play/[0-9a-f-]{36}$`));
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Player-made · 5×5" })).toBeVisible();
````

**Edit `apps/web/src/lib/components/SiteHeader.svelte`** (padding only; step B5 adds the navigation): 1 replacement, in order.

1. Find:
````svelte
  }

  .brand {
    display: flex;
````
   Replace with:
````svelte
  }

  /* The editor's page has 24px gutters from 900px up; its header lines up with them. */
  @media (min-width: 900px) {
    .top-inner.wide {
      padding-left: 24px;
      padding-right: 24px;
    }
  }

  .brand {
    display: flex;
````

**Verify:** `bun run check`, then `E2E_PORT=4273 bun run test:e2e` (all pass, served on 4273).

**Commits:** stage the five files other than `SiteHeader.svelte` and commit `test(web): configurable ports for the end-to-end tests`; then stage `SiteHeader.svelte` and commit `fix(web): the wide site header lines up with the editor from 900px`.

### B2 Client modules under `lib/daily`

Plain TypeScript over the generated client, tested under `bun test` (no runes, no `$lib`/`$app`, no DOM): names, tints and UTC dates (`days.ts`); the API calls (`api.ts`: reads answer null when the server can't be reached, actions a `Result` with the status); sending a ranked solve with retries and keeping it on the device (`finish.ts`); the page mode, leaderboard rows with gaps, cover status lines, the share text and the `RankedPlay` type for the play screen (`view.ts`); the app's instances (`index.ts`).

**Create `apps/web/src/lib/daily/days.ts`**:

````ts
// Names, colours and dates for daily puzzles (PRD FR-22). Days are UTC days, `YYYY-MM-DD`.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Display names of the daily size classes (Home artboard). */
const SIZE_NAMES: Record<number, string> = { 7: "Small", 10: "Medium", 20: "Large", 40: "Giant" };

/** "Small" for 7, … ; "15×15" for a size without a name. */
export function sizeName(size: number): string {
  return SIZE_NAMES[size] ?? `${size}×${size}`;
}

/**
 * Pale cover tint per size class (design kit, Colour): Sakura, Kinari, Sora, Wakaba. The same in
 * both themes; text on covers is always ink.
 */
export function coverTint(width: number): string {
  if (width <= 7) return "#F2C4CE";
  if (width <= 10) return "#E8DFC4";
  if (width <= 20) return "#C8DAE6";
  return "#D5E3C2";
}

/** The UTC day that contains `ms`. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Milliseconds from `ms` to the next 00:00 UTC, when new daily puzzles come out. */
export function msToNextDay(ms: number): number {
  return DAY_MS - (((ms % DAY_MS) + DAY_MS) % DAY_MS);
}

/** "5h 12m" from an hour up, "12m 05s" below. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s).padStart(2, "0")}s`;
}

const JP_WEEKDAYS = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];

function date(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** "日曜日 · Sunday 25 October" (Home artboard). */
export function dayHeading(day: string): string {
  const d = date(day);
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const rest = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
  return `${JP_WEEKDAYS[d.getUTCDay()]} · ${weekday} ${rest}`;
}

/** "25 Oct". */
export function shortDay(day: string): string {
  return date(day).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "M", "T", "W", … for the streak strip. */
export function weekdayLetter(day: string): string {
  return "SMTWTFS"[date(day).getUTCDay()];
}

/** The play page of a daily puzzle. */
export function dailyPath(day: string, size: number): string {
  return `/daily/${day}/${size}`;
}

/** The second header line of a daily: "Daily · 25 Oct · 今日の問題" on its day. */
export function dailySubtitle(day: string, live: boolean): string {
  return live ? `Daily · ${shortDay(day)} · 今日の問題` : `Daily · ${shortDay(day)}`;
}
````

**Create `apps/web/src/lib/daily/days.test.ts`**:

````ts
import { describe, expect, test } from "bun:test";
import {
  countdown,
  coverTint,
  dailyPath,
  dailySubtitle,
  dayHeading,
  msToNextDay,
  shortDay,
  sizeName,
  utcDay,
  weekdayLetter,
} from "./days.ts";

describe("daily names and dates", () => {
  test("size classes have the Home artboard's names and cover tints", () => {
    expect([7, 10, 20, 40].map(sizeName)).toEqual(["Small", "Medium", "Large", "Giant"]);
    expect(sizeName(15)).toBe("15×15");
    expect([7, 10, 20, 40].map(coverTint)).toEqual(["#F2C4CE", "#E8DFC4", "#C8DAE6", "#D5E3C2"]);
  });

  test("counts down to the next 00:00 UTC", () => {
    const midnight = Date.UTC(2026, 9, 26);
    expect(utcDay(midnight - 1)).toBe("2026-10-25");
    expect(msToNextDay(midnight - 1)).toBe(1);
    expect(msToNextDay(midnight)).toBe(24 * 60 * 60 * 1000);
    expect(countdown((5 * 60 + 12) * 60_000 + 30_000)).toBe("5h 12m");
    expect(countdown(12 * 60_000 + 5_000)).toBe("12m 05s");
    expect(countdown(-5)).toBe("0m 00s");
  });

  test("writes days as the artboards do, in UTC", () => {
    expect(dayHeading("2026-10-25")).toBe("日曜日 · Sunday 25 October");
    expect(shortDay("2026-10-25")).toBe("25 Oct");
    expect(weekdayLetter("2026-10-19")).toBe("M");
    expect(weekdayLetter("2026-10-25")).toBe("S");
    expect(dailySubtitle("2026-10-25", true)).toBe("Daily · 25 Oct · 今日の問題");
    expect(dailySubtitle("2026-10-24", false)).toBe("Daily · 24 Oct");
    expect(dailyPath("2026-10-25", 7)).toBe("/daily/2026-10-25/7");
  });
});
````

**Create `apps/web/src/lib/daily/api.ts`**:

````ts
import type { ApiClient, Schemas } from "@loophole/api-client";
import { failureMessage } from "../auth/auth.ts";

export type DailySet = Schemas["DailySet"];
export type DailySummary = Schemas["DailySummary"];
export type Attempt = Schemas["Attempt"];
export type Leaderboard = Schemas["Leaderboard"];
export type LeaderboardEntry = Schemas["LeaderboardEntry"];

/** A request's outcome. `status` 0 means the server couldn't be reached. */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly status: number; readonly message: string };

const OFFLINE = "Couldn't reach the server. Check your connection and try again.";

/** How many rows a leaderboard shows above the player's own (Solved artboard). */
export const BOARD_LIMIT = 10;

/**
 * Daily puzzles, ranked attempts, leaderboards and display names from the API (PRD FR-22 to
 * FR-25). Reads answer null when the server can't be reached; actions answer a `Result`.
 */
export function createDailyApi(client: ApiClient) {
  async function run<T>(
    request: () => Promise<{ data?: unknown; error?: unknown; response: Response }>,
    pick: (data: never) => T,
  ): Promise<Result<T>> {
    try {
      const { data, error, response } = await request();
      if (response.ok && data !== undefined) return { ok: true, value: pick(data as never) };
      return {
        ok: false,
        status: response.status,
        message: failureMessage(response.status, error),
      };
    } catch {
      return { ok: false, status: 0, message: OFFLINE };
    }
  }

  async function read<T>(request: () => Promise<{ data?: T }>): Promise<T | null> {
    try {
      return (await request()).data ?? null;
    } catch {
      return null;
    }
  }

  return {
    /** A day's daily puzzles (today by default), or null when the server can't be reached. */
    day: (day?: string) =>
      read(() => client.GET("/api/daily", { params: { query: day === undefined ? {} : { day } } })),

    /** A day's daily puzzles, or why not: 404 for a day to come, 400 for a bad day, 0 offline. */
    dayResult: (day: string) =>
      run(
        () => client.GET("/api/daily", { params: { query: { day } } }),
        (data: DailySet) => data,
      ),

    summary: (userId: string) =>
      read(() => client.GET("/api/users/{userId}/daily", { params: { path: { userId } } })),

    /** The player's attempt at a daily (null for none), or a failure. */
    attempt: (userId: string, puzzleId: string) =>
      run(
        () =>
          client.GET("/api/users/{userId}/attempts/{puzzleId}", {
            params: { path: { userId, puzzleId } },
          }),
        (data: Schemas["AttemptResult"]) => data.attempt,
      ),

    start: (userId: string, puzzleId: string) =>
      run(
        () =>
          client.POST("/api/users/{userId}/attempts/{puzzleId}", {
            params: { path: { userId, puzzleId } },
          }),
        (data: Schemas["StartedAttempt"]) => data.attempt,
      ),

    finish: (userId: string, puzzleId: string, edges: string, elapsedMs: number) =>
      run(
        () =>
          client.POST("/api/users/{userId}/attempts/{puzzleId}/finish", {
            params: { path: { userId, puzzleId } },
            body: { edges, elapsedMs: Math.max(0, Math.round(elapsedMs)) },
          }),
        (data: Schemas["StartedAttempt"]) => data.attempt,
      ),

    /** A daily's leaderboard, or null when it can't be read. */
    puzzleBoard: (puzzleId: string, limit = BOARD_LIMIT) =>
      read(() =>
        client.GET("/api/leaderboards/daily/{puzzleId}", {
          params: { path: { puzzleId }, query: { limit } },
        }),
      ),

    /** The all-time leaderboard of an area (width × height), or null when it can't be read. */
    bucketBoard: (area: number, limit = BOARD_LIMIT) =>
      read(() =>
        client.GET("/api/leaderboards/areas/{area}", {
          params: { path: { area }, query: { limit, level: 1 } },
        }),
      ),

    displayName: (userId: string) =>
      run(
        () => client.GET("/api/users/{userId}/display-name", { params: { path: { userId } } }),
        (data: Schemas["DisplayName"]) => data.displayName,
      ),

    setDisplayName: (userId: string, displayName: string | null) =>
      run(
        () =>
          client.PUT("/api/users/{userId}/display-name", {
            params: { path: { userId } },
            body: { displayName },
          }),
        (data: Schemas["DisplayName"]) => data.displayName,
      ),
  };
}

export type DailyApi = ReturnType<typeof createDailyApi>;
````

**Create `apps/web/src/lib/daily/api.test.ts`**:

````ts
import { describe, expect, test } from "bun:test";
import { createApiClient } from "@loophole/api-client";
import { type Attempt, createDailyApi } from "./api.ts";

const SET = {
  day: "2026-10-25",
  live: true,
  nextAt: "2026-10-26T00:00:00.000Z",
  puzzles: [{ size: 7, puzzleId: "d7" }],
};

/** A daily API whose fetch answers `respond` for every request, recording what was sent. */
function apiFor(respond: (req: Request) => Response | Promise<Response>) {
  const sent: { method: string; url: string; body: unknown }[] = [];
  const fetch = (async (req: Request) => {
    const url = new URL(req.url);
    const text = req.method === "GET" ? "" : await req.text();
    sent.push({
      method: req.method,
      url: url.pathname + url.search,
      body: text ? JSON.parse(text) : null,
    });
    return respond(req);
  }) as typeof globalThis.fetch;
  return { api: createDailyApi(createApiClient({ baseUrl: "http://api.test", fetch })), sent };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": status < 400 ? "application/json" : "application/problem+json" },
  });

describe("createDailyApi", () => {
  test("reads a day's puzzles, and null when the server can't be reached", async () => {
    const { api, sent } = apiFor(() => json(200, SET));
    expect(await api.day()).toEqual(SET);
    expect(await api.day("2026-10-24")).toEqual(SET);
    expect(sent.map((s) => s.url)).toEqual(["/api/daily", "/api/daily?day=2026-10-24"]);

    const down = apiFor(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(await down.api.day()).toBeNull();
    // `vite preview` answers API paths with the app's own page.
    const page = apiFor(() => new Response("<!doctype html>", { status: 200 }));
    expect(await page.api.day()).toBeNull();
  });

  test("starts and finishes attempts, with the time in whole milliseconds", async () => {
    const attempt: Attempt = {
      puzzleId: "d7",
      day: "2026-10-25",
      area: 49,
      level: 1,
      status: "playing",
      startedAt: "2026-10-25T10:00:00.000Z",
      finishedAt: null,
      elapsedMs: 0,
      assisted: false,
      ranked: false,
      rank: null,
    };
    const { api, sent } = apiFor(() => json(200, { attempt }));
    expect(await api.start("u1", "d7")).toEqual({ ok: true, value: attempt });
    expect(await api.finish("u1", "d7", "1122", 1234.6)).toEqual({ ok: true, value: attempt });
    expect(sent).toEqual([
      { method: "POST", url: "/api/users/u1/attempts/d7", body: null },
      {
        method: "POST",
        url: "/api/users/u1/attempts/d7/finish",
        body: { edges: "1122", elapsedMs: 1235 },
      },
    ]);
  });

  test("a refused action carries its status and the server's reason", async () => {
    const { api } = apiFor(() =>
      json(409, { type: "about:blank", title: "Name taken", status: 409, detail: "Taken." }),
    );
    expect(await api.setDisplayName("u1", "tsuru")).toEqual({
      ok: false,
      status: 409,
      message: "Taken.",
    });
    const down = apiFor(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(await down.api.attempt("u1", "d7")).toMatchObject({ ok: false, status: 0 });
  });

  test("dayResult tells a day to come from a server that can't be reached", async () => {
    const early = apiFor(() =>
      json(404, { type: "about:blank", title: "Daily puzzle not found", status: 404 }),
    );
    expect(await early.api.dayResult("2026-10-26")).toMatchObject({ ok: false, status: 404 });
    const { api } = apiFor(() => json(200, SET));
    expect(await api.dayResult("2026-10-25")).toEqual({ ok: true, value: SET });
  });

  test("an attempt that was never started reads as null", async () => {
    const { api } = apiFor(() => json(200, { attempt: null }));
    expect(await api.attempt("u1", "d7")).toEqual({ ok: true, value: null });
  });
});
````

**Create `apps/web/src/lib/daily/finish.ts`**:

````ts
import type { KeyValueStorage } from "../game/progress.ts";
import type { Attempt, Result } from "./api.ts";

/** A ranked solve waiting to reach the server. */
export interface PendingSolve {
  /** The board, in the wire format's edge-state encoding. */
  readonly edges: string;
  /** The ranked clock when the board was solved. */
  readonly elapsedMs: number;
}

/** How a send ended. */
export type FinishOutcome =
  | { readonly kind: "done"; readonly attempt: Attempt }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "stopped" };

/** Waits between tries; the last one repeats. */
export const FINISH_RETRY_MS = [2_000, 5_000, 15_000, 30_000] as const;

export interface FinisherDeps {
  readonly finish: (puzzleId: string, edges: string, elapsedMs: number) => Promise<Result<Attempt>>;
  readonly storage: KeyValueStorage | null;
  /** The logged-in player; pending solves are kept under their account's keys. */
  readonly userId: string;
  /** Resolves after `ms`, or early when `signal` aborts. Tests pass a manual one. */
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const realWait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });

/**
 * Sends ranked solves to the server (PRD FR-17), keeping each one on the device until the server
 * has answered, so a solve made offline or lost with a closed tab is sent again with the same
 * attempt and the time it was solved in. Network failures, 408, 429 and server errors are retried;
 * a 401 or 403 stops and keeps the solve for the next login; any other refusal drops it.
 */
export function createFinisher(deps: FinisherDeps) {
  const wait = deps.wait ?? realWait;
  const key = (puzzleId: string) => `loophole:user:${deps.userId}:ranked:${puzzleId}`;

  function pending(puzzleId: string): PendingSolve | null {
    try {
      const text = deps.storage?.getItem(key(puzzleId));
      if (!text) return null;
      const data = JSON.parse(text) as Partial<PendingSolve>;
      if (typeof data.edges !== "string" || typeof data.elapsedMs !== "number") return null;
      return { edges: data.edges, elapsedMs: data.elapsedMs };
    } catch {
      return null;
    }
  }

  function keep(puzzleId: string, solve: PendingSolve): void {
    try {
      deps.storage?.setItem(key(puzzleId), JSON.stringify(solve));
    } catch {
      // Storage refused: the send below still goes out.
    }
  }

  function drop(puzzleId: string): void {
    try {
      deps.storage?.removeItem(key(puzzleId));
    } catch {
      // Nothing to do.
    }
  }

  return {
    pending,

    /** Forgets a kept solve, once the server is known to have the attempt finished. */
    forget: drop,

    /**
     * Sends the pending solve for `puzzleId`, first storing `solve` as it unless one is already
     * waiting (the first solve's time counts). Retries until the server answers or `signal`
     * aborts; `onretry` hears each failure that will be retried.
     */
    async send(
      puzzleId: string,
      solve: PendingSolve | null,
      signal: AbortSignal,
      onretry: (message: string) => void = () => {},
    ): Promise<FinishOutcome> {
      if (solve !== null && pending(puzzleId) === null) keep(puzzleId, solve);
      const next = pending(puzzleId) ?? solve;
      if (next === null) return { kind: "stopped" };
      for (let i = 0; !signal.aborted; i++) {
        const result = await deps.finish(puzzleId, next.edges, next.elapsedMs);
        if (result.ok) {
          drop(puzzleId);
          return { kind: "done", attempt: result.value };
        }
        const { status, message } = result;
        if (status === 401 || status === 403) return { kind: "failed", message };
        if (status !== 0 && status !== 408 && status !== 429 && status < 500) {
          drop(puzzleId);
          return { kind: "failed", message };
        }
        onretry(message);
        await wait(FINISH_RETRY_MS[Math.min(i, FINISH_RETRY_MS.length - 1)], signal);
      }
      return { kind: "stopped" };
    },
  };
}

export type Finisher = ReturnType<typeof createFinisher>;
````

**Create `apps/web/src/lib/daily/finish.test.ts`**:

````ts
import { describe, expect, test } from "bun:test";
import { memoryStorage } from "../test-support/memory-storage.ts";
import type { Attempt, Result } from "./api.ts";
import { createFinisher, FINISH_RETRY_MS } from "./finish.ts";

const ATTEMPT: Attempt = {
  puzzleId: "d1",
  day: "2026-10-25",
  area: 49,
  level: 1,
  status: "finished",
  startedAt: "2026-10-25T10:00:00.000Z",
  finishedAt: "2026-10-25T10:03:18.000Z",
  elapsedMs: 198_000,
  assisted: false,
  ranked: true,
  rank: 214,
};

const SOLVE = { edges: "1122", elapsedMs: 198_000 };
const KEY = "loophole:user:u1:ranked:d1";

/** A finisher whose server answers from `answers` in turn, with waits that return at once. */
function setup(answers: Result<Attempt>[]) {
  const storage = memoryStorage();
  const sent: { puzzleId: string; edges: string; elapsedMs: number }[] = [];
  const waits: number[] = [];
  const finisher = createFinisher({
    storage,
    userId: "u1",
    finish: async (puzzleId, edges, elapsedMs) => {
      sent.push({ puzzleId, edges, elapsedMs });
      const answer = answers.shift();
      if (answer === undefined) throw new Error("no answer left");
      return answer;
    },
    wait: async (ms) => {
      waits.push(ms);
    },
  });
  return { storage, sent, waits, finisher };
}

const offline: Result<Attempt> = { ok: false, status: 0, message: "offline" };

describe("ranked finish (FR-17)", () => {
  test("sends the solve and forgets it once the server has it", async () => {
    const { storage, sent, finisher } = setup([{ ok: true, value: ATTEMPT }]);
    const outcome = await finisher.send("d1", SOLVE, new AbortController().signal);
    expect(outcome).toEqual({ kind: "done", attempt: ATTEMPT });
    expect(sent).toEqual([{ puzzleId: "d1", ...SOLVE }]);
    expect(storage.getItem(KEY)).toBeNull();
  });

  test("retries network failures, rate limits and server errors with backoff, same solve each time", async () => {
    const { sent, waits, finisher } = setup([
      offline,
      { ok: false, status: 503, message: "down" },
      { ok: false, status: 429, message: "slow down" },
      offline,
      offline,
      { ok: true, value: ATTEMPT },
    ]);
    const retries: string[] = [];
    const outcome = await finisher.send("d1", SOLVE, new AbortController().signal, (m) =>
      retries.push(m),
    );
    expect(outcome.kind).toBe("done");
    expect(sent.every((s) => s.elapsedMs === SOLVE.elapsedMs)).toBe(true);
    expect(waits).toEqual([...FINISH_RETRY_MS, FINISH_RETRY_MS[3]]);
    expect(retries).toEqual(["offline", "down", "slow down", "offline", "offline"]);
  });

  test("a solve stays on the device until sent, and the first solve's time counts", async () => {
    const controller = new AbortController();
    const { storage, finisher } = setup([offline]);
    const stopped = finisher.send("d1", SOLVE, controller.signal, () => controller.abort());
    expect(await stopped).toEqual({ kind: "stopped" });
    expect(JSON.parse(storage.getItem(KEY) ?? "")).toEqual(SOLVE);
    expect(finisher.pending("d1")).toEqual(SOLVE);

    // Back on the page later: the stored solve goes out, not a later reading of the clock.
    const later = setup([{ ok: true, value: ATTEMPT }]);
    later.storage.setItem(KEY, JSON.stringify(SOLVE));
    const again = new AbortController().signal;
    await later.finisher.send("d1", { edges: "1122", elapsedMs: 999_999 }, again);
    expect(later.sent[0]?.elapsedMs).toBe(SOLVE.elapsedMs);
  });

  test("a lost login stops and keeps the solve; a refusal drops it", async () => {
    const lost = setup([{ ok: false, status: 401, message: "Not logged in" }]);
    expect(await lost.finisher.send("d1", SOLVE, new AbortController().signal)).toEqual({
      kind: "failed",
      message: "Not logged in",
    });
    expect(lost.finisher.pending("d1")).toEqual(SOLVE);

    const refused = setup([{ ok: false, status: 400, message: "That board is not the solution." }]);
    const outcome = await refused.finisher.send("d1", SOLVE, new AbortController().signal);
    expect(outcome.kind).toBe("failed");
    expect(refused.finisher.pending("d1")).toBeNull();
  });

  test("forget drops a kept solve the server already has", () => {
    const { storage, finisher } = setup([]);
    storage.setItem(KEY, JSON.stringify(SOLVE));
    finisher.forget("d1");
    expect(finisher.pending("d1")).toBeNull();
    expect(storage.getItem(KEY)).toBeNull();
  });

  test("with nothing pending and no solve, there is nothing to send", async () => {
    const { sent, finisher } = setup([]);
    expect(await finisher.send("d1", null, new AbortController().signal)).toEqual({
      kind: "stopped",
    });
    expect(sent).toEqual([]);
  });
});
````

**Create `apps/web/src/lib/daily/view.ts`**:

````ts
import type { AuthState } from "../auth/auth.ts";
import { formatClock } from "../game/timer.ts";
import type { Attempt, LeaderboardEntry } from "./api.ts";

/**
 * What a daily puzzle's page shows:
 * - `loading`: who is logged in, or their attempt, isn't known yet.
 * - `error`: the attempt couldn't be read; offer to try again.
 * - `gate`: a confirmed player on the daily's day with no attempt yet: offer a ranked start.
 * - `ranked`: their attempt is being played; the ranked clock runs.
 * - `solved`: their attempt is finished: the Solved screen.
 * - `unranked`: plain play, for a guest, an unconfirmed account, an earlier day's daily, or a
 *   replay after a ranked solve.
 */
export type DailyMode =
  | { readonly kind: "loading" | "error" | "gate" }
  | { readonly kind: "ranked" | "solved"; readonly attempt: Attempt }
  | {
      readonly kind: "unranked";
      readonly reason: "guest" | "unconfirmed" | "ended" | "replay";
    };

export interface DailyModeInput {
  readonly auth: AuthState;
  /** The daily is today's. */
  readonly live: boolean;
  /** The player's attempt: null for none, undefined while loading, "error" if it couldn't be read. */
  readonly attempt: Attempt | null | undefined | "error";
  /** The player chose to play a finished daily again, unranked. */
  readonly replay: boolean;
}

export function dailyMode({ auth, live, attempt, replay }: DailyModeInput): DailyMode {
  if (auth.status === "loading") return { kind: "loading" };
  if (auth.status === "guest") return { kind: "unranked", reason: "guest" };
  if (!auth.user.emailVerified) return { kind: "unranked", reason: "unconfirmed" };
  if (attempt === undefined) return { kind: "loading" };
  if (attempt === "error") return { kind: "error" };
  if (attempt === null) return live ? { kind: "gate" } : { kind: "unranked", reason: "ended" };
  if (attempt.status === "playing") return { kind: "ranked", attempt };
  return replay ? { kind: "unranked", reason: "replay" } : { kind: "solved", attempt };
}

/** A leaderboard's rows, with a gap wherever ranks jump (Solved artboard: 1, 2, 3, …, 213). */
export type BoardRow =
  | { readonly kind: "entry"; readonly entry: LeaderboardEntry }
  | { readonly kind: "gap"; readonly after: number };

export function boardRows(entries: readonly LeaderboardEntry[]): BoardRow[] {
  const rows: BoardRow[] = [];
  let last = 0;
  for (const entry of entries) {
    if (entry.rank > last + 1) rows.push({ kind: "gap", after: last });
    rows.push({ kind: "entry", entry });
    last = entry.rank;
  }
  return rows;
}

/** The name a leaderboard row shows: "You" for the viewer, "Anonymous" for a player without one. */
export function rowName(entry: LeaderboardEntry): string {
  if (entry.me) return "You";
  return entry.name ?? "Anonymous";
}

/** A daily cover's status line (Home artboard). */
export interface CoverStatus {
  readonly kind: "solved" | "playing" | "new" | "missing";
  readonly text: string;
}

export interface CoverInput {
  readonly size: number;
  /** False while the server hasn't generated the puzzle. */
  readonly ready: boolean;
  /** The player's ranked attempt, if any. */
  readonly attempt?: Attempt;
  /** Progress saved on this device or account, for play outside a ranked attempt. */
  readonly progress?: { readonly solved: boolean; readonly elapsedMs: number } | null;
}

export function coverStatus({ size, ready, attempt, progress }: CoverInput): CoverStatus {
  if (!ready) return { kind: "missing", text: "Not ready yet" };
  if (attempt?.status === "finished") {
    return { kind: "solved", text: `Solved · ${formatClock(attempt.elapsedMs)}` };
  }
  if (attempt?.status === "playing") return { kind: "playing", text: "In progress · ranked" };
  if (progress?.solved)
    return { kind: "solved", text: `Solved · ${formatClock(progress.elapsedMs)}` };
  if (progress)
    return { kind: "playing", text: `In progress · ${formatClock(progress.elapsedMs)}` };
  return { kind: "new", text: size >= 40 ? "New · best on a big screen" : "New · not started" };
}

/** The share text for a finished daily (Solved artboard's share button). */
export function shareText(name: string, size: number, dayLabel: string, attempt: Attempt): string {
  const place = attempt.rank === null ? "" : ` · #${attempt.rank}`;
  return `Loophole daily · ${name} ${size}×${size} · ${dayLabel} · ${formatClock(attempt.elapsedMs)}${place}`;
}

/** What the play screen needs for a ranked attempt (PRD FR-17, FR-25). */
export interface RankedPlay {
  /** The ranked clock when the screen opened, as the server measured it. */
  readonly elapsedMs: number;
  /** Called once the board is solved, with the board and the ranked clock. */
  readonly onsolve: (edges: Uint8Array, elapsedMs: number) => void;
  /** The line on the solved card while the server checks the solve. */
  readonly status: string;
}
````

**Create `apps/web/src/lib/daily/view.test.ts`**:

````ts
import { describe, expect, test } from "bun:test";
import type { AuthState, User } from "../auth/auth.ts";
import type { Attempt, LeaderboardEntry } from "./api.ts";
import { boardRows, coverStatus, dailyMode, rowName, shareText } from "./view.ts";

const USER: User = {
  id: "u1",
  email: "ann@example.com",
  emailVerified: true,
  isAdmin: false,
  createdAt: "2026-10-25T00:00:00.000Z",
};
const confirmed: AuthState = { status: "user", user: USER };
const unconfirmed: AuthState = { status: "user", user: { ...USER, emailVerified: false } };

const PLAYING: Attempt = {
  puzzleId: "d1",
  day: "2026-10-25",
  area: 49,
  level: 1,
  status: "playing",
  startedAt: "2026-10-25T10:00:00.000Z",
  finishedAt: null,
  elapsedMs: 400_000,
  assisted: false,
  ranked: false,
  rank: null,
};
const FINISHED: Attempt = {
  ...PLAYING,
  status: "finished",
  finishedAt: "2026-10-25T10:03:18.000Z",
  elapsedMs: 198_000,
  ranked: true,
  rank: 214,
};

describe("dailyMode", () => {
  test("guests and unconfirmed accounts play unranked", () => {
    const base = { live: true, attempt: null, replay: false };
    expect(dailyMode({ ...base, auth: { status: "loading" } })).toEqual({ kind: "loading" });
    expect(dailyMode({ ...base, auth: { status: "guest" } })).toEqual({
      kind: "unranked",
      reason: "guest",
    });
    expect(dailyMode({ ...base, auth: unconfirmed })).toEqual({
      kind: "unranked",
      reason: "unconfirmed",
    });
  });

  test("a confirmed player gets the ranked start on the daily's day only", () => {
    const base = { auth: confirmed, replay: false };
    expect(dailyMode({ ...base, live: true, attempt: undefined })).toEqual({ kind: "loading" });
    expect(dailyMode({ ...base, live: true, attempt: "error" })).toEqual({ kind: "error" });
    expect(dailyMode({ ...base, live: true, attempt: null })).toEqual({ kind: "gate" });
    expect(dailyMode({ ...base, live: false, attempt: null })).toEqual({
      kind: "unranked",
      reason: "ended",
    });
  });

  test("an attempt is played ranked, then shows the Solved screen, then can be replayed", () => {
    const base = { auth: confirmed, live: false };
    expect(dailyMode({ ...base, attempt: PLAYING, replay: false })).toEqual({
      kind: "ranked",
      attempt: PLAYING,
    });
    expect(dailyMode({ ...base, attempt: FINISHED, replay: false })).toEqual({
      kind: "solved",
      attempt: FINISHED,
    });
    expect(dailyMode({ ...base, attempt: FINISHED, replay: true })).toEqual({
      kind: "unranked",
      reason: "replay",
    });
  });
});

describe("leaderboard rows", () => {
  const entry = (rank: number, me = false, name: string | null = null): LeaderboardEntry => ({
    rank,
    name,
    timeMs: rank * 1000,
    me,
  });

  test("put a gap wherever ranks jump", () => {
    const rows = boardRows([entry(1), entry(2), entry(3), entry(213), entry(214, true)]);
    expect(rows.map((r) => (r.kind === "gap" ? "…" : r.entry.rank))).toEqual([
      1,
      2,
      3,
      "…",
      213,
      214,
    ]);
    expect(boardRows([entry(5, true)]).map((r) => r.kind)).toEqual(["gap", "entry"]);
    expect(boardRows([])).toEqual([]);
  });

  test("name the viewer You and players without a name Anonymous", () => {
    expect(rowName(entry(1, false, "tsuru"))).toBe("tsuru");
    expect(rowName(entry(1))).toBe("Anonymous");
    expect(rowName(entry(1, true, "kuroneko"))).toBe("You");
  });
});

describe("coverStatus", () => {
  test("shows a ranked attempt first, then progress on the device, then new", () => {
    expect(coverStatus({ size: 7, ready: true, attempt: FINISHED })).toEqual({
      kind: "solved",
      text: "Solved · 03:18",
    });
    expect(coverStatus({ size: 7, ready: true, attempt: PLAYING }).text).toBe(
      "In progress · ranked",
    );
    expect(
      coverStatus({ size: 10, ready: true, progress: { solved: false, elapsedMs: 400_000 } }),
    ).toEqual({ kind: "playing", text: "In progress · 06:40" });
    expect(coverStatus({ size: 20, ready: true, progress: null }).text).toBe("New · not started");
    expect(coverStatus({ size: 40, ready: true }).text).toBe("New · best on a big screen");
    expect(coverStatus({ size: 40, ready: false }).kind).toBe("missing");
  });
});

test("shareText sums up a finished daily", () => {
  expect(shareText("Small", 7, "25 Oct", FINISHED)).toBe(
    "Loophole daily · Small 7×7 · 25 Oct · 03:18 · #214",
  );
  expect(shareText("Small", 7, "25 Oct", { ...FINISHED, rank: null })).toBe(
    "Loophole daily · Small 7×7 · 25 Oct · 03:18",
  );
});
````

**Create `apps/web/src/lib/daily/index.ts`**:

````ts
import { createApiClient } from "@loophole/api-client";
import { browserStorage } from "../game/progress.ts";
import { createDailyApi } from "./api.ts";
import { createFinisher, type Finisher } from "./finish.ts";

export type {
  Attempt,
  DailySet,
  DailySummary,
  Leaderboard,
  LeaderboardEntry,
} from "./api.ts";
export { BOARD_LIMIT } from "./api.ts";

/** The app's daily puzzle, ranked attempt and leaderboard client. */
export const daily = createDailyApi(createApiClient());

/** Sends a player's ranked solves, keeping them on this device until the server has them. */
export function finisherFor(userId: string): Finisher {
  return createFinisher({
    userId,
    storage: browserStorage(),
    finish: (puzzleId, edges, elapsedMs) => daily.finish(userId, puzzleId, edges, elapsedMs),
  });
}
````

**Verify:** `bun test apps/web/src/lib/daily && bun run check`.

**Commit:** `feat(web): daily puzzle, ranked finish and leaderboard client modules`

### B3 Home page: today's covers, countdown and streak

`BookCover` takes over the cover markup the home page had inline and adds the finer dot paper for 20×20 and 40×40 (Home artboard); `StreakCard` is the streak card. The home page is rewritten around them (the practice list, Continue and the guest import stay as they were).

**Create `apps/web/src/lib/components/BookCover.svelte`**:

````svelte
<script lang="ts">
  import { coverTint } from "../daily/days.ts";
  import type { CoverStatus } from "../daily/view.ts";

  interface Props {
    /** Where the cover goes; null for a puzzle that can't be opened yet. */
    href: string | null;
    width: number;
    height: number;
    name: string;
    status: CoverStatus;
  }

  let { href, width, height, name, status }: Props = $props();

  // The dot paper gets finer for bigger boards (Home artboard: 12px, then 8px and 5px).
  const dots = $derived(width >= 40 ? 5 : width >= 20 ? 8 : 12);
</script>

<!-- A puzzle as a pocket-book cover (Home artboard): tint per size class, size badge, name, dot
     paper and a status line. Text on covers is always ink, in both themes. -->
<svelte:element
  this={href === null ? "div" : "a"}
  class="cover"
  class:disabled={href === null}
  href={href ?? undefined}
  style:background={coverTint(width)}
  style:--dots="{dots}px"
>
  <span class="badge">{width}×{height}</span>
  <span class="kana">スリザーリンク</span>
  <span class="name">{name}</span>
  <span class="paper" aria-hidden="true"></span>
  <span class="status">
    {#if status.kind === "solved"}
      <span class="stamp" aria-hidden="true">完</span>
    {:else if status.kind === "playing"}
      <span class="dot" aria-hidden="true"></span>
    {:else}
      <span class="dot hollow" aria-hidden="true"></span>
    {/if}
    {status.text}
  </span>
</svelte:element>

<style>
  .cover {
    position: relative;
    height: 184px;
    padding: 12px;
    border-radius: 6px;
    color: #1e1c19;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  a.cover:hover {
    color: #1e1c19;
    outline: 2px solid #1e1c19;
  }

  .disabled {
    opacity: 0.6;
  }

  .badge {
    position: absolute;
    top: 0;
    right: 0;
    padding: 5px 9px;
    border-radius: 0 6px 0 6px;
    background: #23355e;
    color: #fffdf8;
    font-size: 13px;
    font-weight: 700;
  }

  .kana {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
  }

  .name {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 24px;
    line-height: 1;
  }

  .paper {
    flex: 1 1 auto;
    border: 2px solid #1e1c19;
    background-color: #fffdf8;
    background-image: radial-gradient(#1e1c19 1.3px, transparent 1.6px);
    background-size: var(--dots) var(--dots);
    background-position: 4px 4px;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 700;
  }

  .dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #2e4c8a;
  }

  .dot.hollow {
    background: none;
    border: 1.5px solid #1e1c19;
  }

  .stamp {
    flex: 0 0 auto;
    width: 18px;
    height: 18px;
    border: 2px solid #c23b22;
    border-radius: 4px;
    color: #c23b22;
    font-family: var(--font-display);
    font-size: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
````

**Create `apps/web/src/lib/components/StreakCard.svelte`**:

````svelte
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
````

**Replace the whole of `apps/web/src/routes/+page.svelte`** with:

````svelte
<script lang="ts">
  import type { Schemas } from "@loophole/api-client";
  import { createGrid } from "@loophole/core";
  import { onMount } from "svelte";
  import { auth } from "$lib/auth/index.ts";
  import BookCover from "$lib/components/BookCover.svelte";
  import GuestImport from "$lib/components/GuestImport.svelte";
  import SiteHeader from "$lib/components/SiteHeader.svelte";
  import StreakCard from "$lib/components/StreakCard.svelte";
  import type { DailySet, DailySummary } from "$lib/daily/api.ts";
  import { countdown, dailyPath, dayHeading, msToNextDay, sizeName, utcDay } from "$lib/daily/days.ts";
  import { daily } from "$lib/daily/index.ts";
  import { type CoverStatus, coverStatus } from "$lib/daily/view.ts";
  import { formatClock } from "$lib/game/timer.ts";
  import { inProgress, localProgress } from "$lib/sync/index.ts";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let statuses: Record<string, CoverStatus> = $state({});
  // A logged-in player's unsolved puzzles from the server, so they can carry on from any device.
  let resume: Schemas["ProgressSummary"][] = $state([]);
  // Today's daily puzzles: undefined while loading, null when the server can't be reached.
  let today = $state<DailySet | null | undefined>(undefined);
  let summary: DailySummary | null = $state(null);
  let dailyStatuses: Record<number, CoverStatus> = $state({});
  let now = $state(Date.now());

  const day = $derived(today?.day ?? utcDay(now));

  async function progressOf(id: string, width: number, height: number) {
    return localProgress(id, createGrid(width, height));
  }

  async function refreshDaily() {
    today = await daily.day();
    const user = $auth.status === "user" ? $auth.user : null;
    summary = user === null ? null : await daily.summary(user.id);
    for (const p of today?.puzzles ?? []) {
      const attempt = summary?.attempts.find((a) => a.puzzleId === p.puzzleId);
      const progress = p.puzzleId === null ? null : await progressOf(p.puzzleId, p.size, p.size);
      dailyStatuses[p.size] = coverStatus({ size: p.size, ready: p.puzzleId !== null, attempt, progress });
    }
  }

  async function refresh() {
    for (const p of data.puzzles) {
      const saved = await progressOf(p.id, p.width, p.height);
      statuses[p.id] = coverStatus({ size: p.width, ready: true, progress: saved });
    }
    resume = await inProgress();
  }

  onMount(() => {
    refresh();
    // New puzzles come out at 00:00 UTC; the countdown reaches it and the covers change.
    let shownDay = utcDay(Date.now());
    const tick = setInterval(() => {
      now = Date.now();
      if (utcDay(now) !== shownDay) {
        shownDay = utcDay(now);
        void refreshDaily();
      }
    }, 1000);
    return () => clearInterval(tick);
  });

  // Covers and the streak depend on who is logged in, so load them once that is known.
  let loadedFor: string | null = null;
  $effect(() => {
    if ($auth.status === "loading") return;
    const who = $auth.status === "user" ? $auth.user.id : "guest";
    if (who === loadedFor) return;
    loadedFor = who;
    void refreshDaily();
  });

  function nameOf(id: string): string {
    return data.puzzles.find((p) => p.id === id)?.name ?? "Puzzle";
  }
</script>

<svelte:head>
  <title>Loophole</title>
</svelte:head>

<SiteHeader />

<main class="page">
  <GuestImport dismissible onimported={refresh} />

  <div class="heading">
    <span class="date">{dayHeading(day)}</span>
    <h1>Today's puzzles</h1>
    <span class="next" role="timer">New puzzles in {countdown(msToNextDay(now))}</span>
  </div>

  {#if $auth.status === "user" && summary !== null}
    {#if $auth.user.emailVerified}
      <StreakCard streak={summary.streak} week={summary.week} />
    {:else}
      <p class="card">Confirm your email to play daily puzzles ranked and keep a streak.</p>
    {/if}
  {:else if $auth.status === "guest"}
    <p class="card">With an account, your daily solves are ranked and you keep a streak.</p>
  {/if}

  {#if today === null}
    <p class="card">Daily puzzles need the server, which can't be reached right now. The practice puzzles below work offline.</p>
  {:else if today !== undefined}
    <ul class="covers daily" aria-label="Today's daily puzzles">
      {#each today.puzzles as p (p.size)}
        <li>
          <BookCover
            href={p.puzzleId === null ? null : dailyPath(today.day, p.size)}
            width={p.size}
            height={p.size}
            name={sizeName(p.size)}
            status={dailyStatuses[p.size] ?? coverStatus({ size: p.size, ready: p.puzzleId !== null })}
          />
        </li>
      {/each}
    </ul>
  {/if}

  {#if resume.length > 0}
    <section class="section" aria-labelledby="continue-h">
      <h2 id="continue-h">Continue</h2>
      <ul class="resume">
        {#each resume as r (r.puzzleId)}
          <li>
            <a href="/play/{r.puzzleId}">
              <b>{nameOf(r.puzzleId)} · {r.width}×{r.height}</b>
              <span>In progress · {formatClock(r.elapsedMs)}</span>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="section" aria-labelledby="practice-h">
    <div class="section-head">
      <h2 id="practice-h">Practice <span class="jp">練習</span></h2>
      <span class="soft">fresh, proven unique</span>
    </div>
    <ul class="covers">
      {#each data.puzzles as p (p.id)}
        <li>
          <BookCover
            href="/play/{p.id}"
            width={p.width}
            height={p.height}
            name={p.name}
            status={statuses[p.id] ?? coverStatus({ size: p.width, ready: true })}
          />
        </li>
      {/each}
    </ul>
  </section>
</main>

<style>
  .page {
    max-width: 960px;
    margin: 0 auto;
    padding: 16px 16px calc(24px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .heading {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .date,
  .next {
    font-size: 14px;
    font-weight: 700;
    color: var(--ink-soft);
  }

  .next {
    font-weight: 500;
    font-variant-numeric: tabular-nums;
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

  .jp {
    font-size: 14px;
    font-weight: 700;
    color: var(--ink-soft);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  .soft {
    font-size: 13px;
    color: var(--ink-soft);
  }

  .card {
    margin: 0;
    padding: 10px 14px;
    background: var(--sheet);
    border: 2px solid var(--ink);
    border-radius: 6px;
    font-size: 15px;
  }

  .resume {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .resume a {
    min-height: 44px;
    padding: 8px 14px;
    border: 2px solid var(--ink);
    border-radius: 6px;
    background: var(--sheet);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 4px 12px;
  }

  .resume span {
    font-size: 14px;
    color: var(--ink-soft);
  }

  .covers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px;
  }

  /* Today's four covers: two by two on phones (Home artboard), one row on wide screens. */
  .covers.daily {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (min-width: 720px) {
    .covers.daily {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
</style>
````

**Verify:** `bun run check`, then `E2E_PORT=4273 bun run test:e2e` (the existing tests still pass; the home page works with no server).

**Commit:** `feat(web): home page with today's daily puzzles and the streak`

### B4 Ranked play: the play screen's `ranked` prop, the daily page, the Solved screen

`PlayScreen` gets the optional `ranked` prop and nothing else: with it the stopwatch is set from `ranked.elapsedMs` once progress has loaded, `setPaused` does nothing (so leaving the tab doesn't pause either), the pause buttons are disabled, adopting a board from another device keeps the running clock, solving calls `ranked.onsolve`, a board that loads already solved calls it at once (its answer was lost), the hint tag reads "Hint used · unranked", and the solved card shows `ranked.status` and no Start over. The daily route picks the mode and owns the ranked flow (after a successful Start it clears the saved board, so the ranked board starts empty; a 409 reloads the page with `invalidateAll()`; a finished attempt makes it forget a kept solve); `SolvedView` is the Solved screen, with `SolvedBoard` (the 212 px board) and `LeaderboardCard`.

**Edit `apps/web/src/lib/components/PlayScreen.svelte`**: 11 replacements, in order.

1. Find:
````svelte
  import { analyzeBoard } from "@loophole/core";
  import { onDestroy, onMount, tick } from "svelte";
  import {
    applyChanges,
````
   Replace with:
````svelte
  import { analyzeBoard } from "@loophole/core";
  import { onDestroy, onMount, tick } from "svelte";
  import type { RankedPlay } from "../daily/view.ts";
  import {
    applyChanges,
````

2. Find:
````svelte
  interface Props {
    entry: PuzzleEntry;
  }

  let { entry }: Props = $props();

  const puzzle = $derived(entry.puzzle);
````
   Replace with:
````svelte
  interface Props {
    entry: PuzzleEntry;
    /**
     * Set for a ranked daily attempt: the clock counts from the attempt's start on the server and
     * never pauses, solving calls `onsolve`, and there is no Start over.
     */
    ranked?: RankedPlay;
  }

  let { entry, ranked }: Props = $props();

  const puzzle = $derived(entry.puzzle);
````

3. Find:
````svelte
  const clock = $derived(formatClock(elapsed(watch, now)));
  const locked = $derived(paused || solved || !ready);

  // Board sizing. On phones the stage holds just the board, and an empty spacer under the notes
````
   Replace with:
````svelte
  const clock = $derived(formatClock(elapsed(watch, now)));
  const locked = $derived(paused || solved || !ready);
  const assistedLabel = $derived(ranked ? "Hint used · unranked" : "Hint used");

  // Board sizing. On phones the stage holds just the board, and an empty spacer under the notes
````

4. Find:
````svelte
    assisted = saved?.assisted ?? false;
    now = performance.now();
    watch = createStopwatch(saved?.elapsedMs ?? 0);
    const done = analyzeBoard(puzzle, board.edges).solved;
    if (done) paused = false;
````
   Replace with:
````svelte
    assisted = saved?.assisted ?? false;
    now = performance.now();
    // The ranked clock keeps running from the attempt's start.
    if (!ranked) watch = createStopwatch(saved?.elapsedMs ?? 0);
    const done = analyzeBoard(puzzle, board.edges).solved;
    if (done) paused = false;
````

5. Find:
````svelte
  function setPaused(value: boolean) {
    if (!ready || solved || value === paused) return;
    paused = value;
    const t = performance.now();
````
   Replace with:
````svelte
  function setPaused(value: boolean) {
    // A ranked attempt's clock never stops, so it has no pause.
    if (!ready || solved || value === paused || ranked) return;
    paused = value;
    const t = performance.now();
````

6. Find:
````svelte
  $effect(() => {
    if (solved && isRunning(watch)) {
      watch = stop(watch, performance.now());
      save();
    }
  });
````
   Replace with:
````svelte
  $effect(() => {
    if (solved && isRunning(watch)) {
      const t = performance.now();
      watch = stop(watch, t);
      save();
      ranked?.onsolve(board.edges, elapsed(watch, t));
    }
  });
````

7. Find:
````svelte
        assisted = saved.assisted;
      }
      synced = opened.synced;
      now = performance.now();
      if (!analyzeBoard(puzzle, board.edges).solved) watch = start(watch, now);
      ready = true;
    });
````
   Replace with:
````svelte
        assisted = saved.assisted;
      }
      if (ranked) watch = createStopwatch(ranked.elapsedMs);
      synced = opened.synced;
      now = performance.now();
      if (!analyzeBoard(puzzle, board.edges).solved) watch = start(watch, now);
      // Solved before the server heard of it (the answer was lost): send it now.
      else ranked?.onsolve(board.edges, elapsed(watch, now));
      ready = true;
    });
````

8. Find:
````svelte
    <div class="pill">
      <span class="clock" role="timer">{clock}</span>
      <PauseButton {paused} disabled={solved} ontoggle={() => setPaused(!paused)} />
    </div>
  </header>
````
   Replace with:
````svelte
    <div class="pill">
      <span class="clock" role="timer">{clock}</span>
      <PauseButton {paused} disabled={solved || ranked !== undefined} ontoggle={() => setPaused(!paused)} />
    </div>
  </header>
````

9. Find:
````svelte
    <span><b>{analysis.satisfiedClues}</b> of {analysis.clueCount} clues satisfied</span>
    <!-- One line only: the tag takes the zoom tip's place once a hint is used. -->
    {#if assisted}<span class="assisted">Hint used</span>
    {:else if zoomable}<span>Pinch or use +/− to zoom</span>{/if}
  </p>
````
   Replace with:
````svelte
    <span><b>{analysis.satisfiedClues}</b> of {analysis.clueCount} clues satisfied</span>
    <!-- One line only: the tag takes the zoom tip's place once a hint is used. -->
    {#if assisted}<span class="assisted">{assistedLabel}</span>
    {:else if zoomable}<span>Pinch or use +/− to zoom</span>{/if}
  </p>
````

10. Find:
````svelte
          <span class="big-clock">{clock}</span>
          <span class="soft"><b>{analysis.satisfiedClues}</b> of {analysis.clueCount} clues satisfied</span>
          {#if assisted}<span class="assisted">Hint used</span>{/if}
        </div>
        <button type="button" class="outline" disabled={solved} onclick={() => setPaused(!paused)}>
          {paused ? "Resume" : "Pause"} <kbd>P</kbd>
        </button>
````
   Replace with:
````svelte
          <span class="big-clock">{clock}</span>
          <span class="soft"><b>{analysis.satisfiedClues}</b> of {analysis.clueCount} clues satisfied</span>
          {#if assisted}<span class="assisted">{assistedLabel}</span>{/if}
        </div>
        <button type="button" class="outline" disabled={solved || ranked !== undefined} onclick={() => setPaused(!paused)}>
          {paused ? "Resume" : "Pause"} <kbd>P</kbd>
        </button>
````

11. Find:
````svelte
            <div class="solved-text">
              <span class="solved-title">Solved in {clock}</span>
              {#if assisted}<span class="assisted">Hint used</span>{/if}
              <span class="soft">{synced ? "Saved to your account." : "Saved on this device."}</span>
            </div>
            <button type="button" class="primary" onclick={startOver}>Start over</button>
          </div>
        {:else if hint !== null && hintOpen && !paused}
````
   Replace with:
````svelte
            <div class="solved-text">
              <span class="solved-title">Solved in {clock}</span>
              {#if assisted}<span class="assisted">{assistedLabel}</span>{/if}
              <span class="soft">{ranked ? ranked.status : synced ? "Saved to your account." : "Saved on this device."}</span>
            </div>
            {#if !ranked}<button type="button" class="primary" onclick={startOver}>Start over</button>{/if}
          </div>
        {:else if hint !== null && hintOpen && !paused}
````

**Create `apps/web/src/lib/components/LeaderboardCard.svelte`**:

````svelte
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
````

**Create `apps/web/src/lib/components/SolvedBoard.svelte`**:

````svelte
<script lang="ts">
  import { EdgeState, NO_CLUE, type Puzzle } from "@loophole/core";
  import { cellPoint, dotPoint, edgeSegment, type Layout } from "../game/geometry.ts";
  import { insideCells } from "../game/inside.ts";

  interface Props {
    puzzle: Puzzle;
    /** The solved board, as edge states. */
    edges: Uint8Array;
  }

  let { puzzle, edges }: Props = $props();

  // The Solved artboard's board: 212px square with a 15px margin, the inside washed, clues and dots
  // while the cells are big enough to show them.
  const BOX = 212;
  const grid = $derived(puzzle.grid);
  const layout: Layout = $derived.by(() => {
    const margin = 15;
    const cell = (BOX - 2 * margin) / Math.max(grid.width, grid.height);
    return { cell, margin, width: grid.width * cell + 2 * margin, height: grid.height * cell + 2 * margin };
  });
  const line = $derived(Math.max(1, Math.min(3.5, layout.cell * 0.13)));
  const inside = $derived(insideCells(grid, edges));
  const lines = $derived.by(() => {
    let d = "";
    for (let e = 0; e < grid.edgeCount; e++) {
      if (edges[e] !== EdgeState.Line) continue;
      const s = edgeSegment(grid, layout, e);
      d += `M${s.x1} ${s.y1}L${s.x2} ${s.y2}`;
    }
    return d;
  });
  const washes = $derived(
    Array.from({ length: grid.cellCount }, (_, c) => c).filter((c) => inside[c] === 1),
  );
  const clues = $derived(
    layout.cell < 10
      ? []
      : Array.from({ length: grid.cellCount }, (_, c) => c).filter((c) => puzzle.clues[c] !== NO_CLUE),
  );
  const dots = $derived(
    layout.cell < 6 ? [] : Array.from({ length: grid.dotCount }, (_, d) => dotPoint(grid, layout, d)),
  );
</script>

<svg class="solved-board" width={BOX} height={BOX} viewBox="0 0 {BOX} {BOX}" role="img" aria-label="Your solved board">
  {#each washes as c (c)}
    {@const p = cellPoint(grid, layout, c)}
    <rect class="wash" x={p.x - layout.cell / 2} y={p.y - layout.cell / 2} width={layout.cell} height={layout.cell} />
  {/each}
  <path class="line" d={lines} stroke-width={line} />
  {#each dots as p, i (i)}
    <circle class="dot" cx={p.x} cy={p.y} r={Math.max(1, layout.cell * 0.055)} />
  {/each}
  {#each clues as c (c)}
    {@const p = cellPoint(grid, layout, c)}
    <text class="clue" x={p.x} y={p.y} font-size={layout.cell * 0.56}>{puzzle.clues[c]}</text>
  {/each}
</svg>

<style>
  .solved-board {
    display: block;
    flex: 0 0 auto;
    background: var(--sheet);
    border: 2px solid var(--ink);
    box-shadow: 4px 4px 0 var(--frame-shadow);
  }

  .wash {
    fill: var(--solved-wash);
  }

  .line {
    fill: none;
    stroke: var(--ink);
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .dot {
    fill: var(--ink);
  }

  .clue {
    fill: var(--ink);
    font-weight: 500;
    text-anchor: middle;
    dominant-baseline: central;
  }
</style>
````

**Create `apps/web/src/lib/components/SolvedView.svelte`**:

````svelte
<script lang="ts">
  import { onMount } from "svelte";
  import type { Attempt, Leaderboard } from "../daily/api.ts";
  import { dailyPath, shortDay, sizeName } from "../daily/days.ts";
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

  const SIZES = [7, 10, 20, 40];

  let edges: Uint8Array | null = $state.raw(null);
  let board = $state<Leaderboard | null | undefined>(undefined);
  let best: number | null = $state(null);
  let shared = $state(false);

  const nextSize = $derived(SIZES[SIZES.indexOf(size) + 1]);
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
````

**Create `apps/web/src/routes/daily/[day]/[size]/+page.ts`**:

````ts
import { error } from "@sveltejs/kit";
import { dailySubtitle, sizeName } from "$lib/daily/days.ts";
import { daily } from "$lib/daily/index.ts";
import { type PuzzleEntry, puzzleSource } from "$lib/puzzles/index.ts";
import type { PageLoad } from "./$types";

/** A daily puzzle's page: the day's puzzle of one size class, or why there is none. */
export const load: PageLoad = async ({ params }) => {
  const size = Number(params.size);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.day) || !Number.isInteger(size)) {
    error(404, "No such daily puzzle");
  }
  const result = await daily.dayResult(params.day);
  // A day to come (404) or a day that doesn't exist (400) has no daily puzzle.
  if (!result.ok && result.status === 0) {
    error(503, "Daily puzzles need the server, which can't be reached right now.");
  }
  if (!result.ok) error(404, "No such daily puzzle");
  const set = result.value;
  const puzzleId = set.puzzles.find((p) => p.size === size)?.puzzleId;
  if (puzzleId === undefined) error(404, "No such daily puzzle");
  let entry: PuzzleEntry | null = null;
  if (puzzleId !== null) {
    const found = await puzzleSource.get(puzzleId);
    if (found === null) error(404, "No such daily puzzle");
    // Named for its size class, not as a practice puzzle (Solved artboard header).
    entry = { ...found, name: sizeName(size), subtitle: dailySubtitle(set.day, set.live) };
  }
  return { day: set.day, size, live: set.live, entry };
};
````

**Create `apps/web/src/routes/daily/[day]/[size]/+page.svelte`**:

````svelte
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
  import { openSaves } from "$lib/sync/index.ts";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  // The player's attempt: undefined while loading, null for none, "error" if it couldn't be read.
  let attempt = $state<Attempt | null | undefined | "error">(undefined);
  let replay = $state(false);
  let starting = $state(false);
  let startError = $state("");
  let rankedStatus = $state("Checking your solve…");
  let sending = false;
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
    if (sending) return;
    sending = true;
    rankedStatus = "Checking your solve…";
    const outcome = await finisherFor(id).send(puzzleId, solve, controller.signal, () => {
      rankedStatus = "Couldn't reach the server. Your solve is saved here and will be sent again.";
    });
    sending = false;
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
    <p class="eyebrow">{data.entry.subtitle}</p>
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
````

**Verify:** `bun run check`, then `E2E_PORT=4273 bun run test:e2e` (play, hint and zoom tests unchanged).

**Commit:** `feat(web): ranked daily play and the Solved screen`

### B5 Leaderboard page, leaderboard name on the account page, header navigation

The leaderboard page reads its size and period from the address. The account page loads and saves the leaderboard name (errors from the server, such as "Another player already has that name.", show under the field). The header's navigation gains Today and Ranks; SvelteKit's typed routes need `/leaderboard` to exist before the header can compare against it, which is why it comes in this step.

**Create `apps/web/src/routes/leaderboard/+page.svelte`**:

````svelte
<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { auth } from "$lib/auth/index.ts";
  import LeaderboardCard from "$lib/components/LeaderboardCard.svelte";
  import SiteHeader from "$lib/components/SiteHeader.svelte";
  import type { Leaderboard } from "$lib/daily/api.ts";
  import { sizeName } from "$lib/daily/days.ts";
  import { daily } from "$lib/daily/index.ts";

  const SIZES = [7, 10, 20, 40];

  // The board shown comes from the address, so it can be linked: ?size=10&scope=all.
  const size = $derived(SIZES.includes(Number(page.url.searchParams.get("size"))) ? Number(page.url.searchParams.get("size")) : 7);
  const scope = $derived(page.url.searchParams.get("scope") === "all" ? "all" : "today");

  let board = $state<Leaderboard | null | undefined>(undefined);
  let missing = $state(false);

  async function load(forSize: number, forScope: string) {
    board = undefined;
    missing = false;
    if (forScope === "all") {
      board = await daily.bucketBoard(forSize * forSize);
      return;
    }
    const today = await daily.day();
    const puzzleId = today?.puzzles.find((p) => p.size === forSize)?.puzzleId ?? null;
    if (today !== null && puzzleId === null) {
      missing = true;
      board = null;
      return;
    }
    board = puzzleId === null ? null : await daily.puzzleBoard(puzzleId);
  }

  // Reload when the board chosen changes, and when who is logged in is known (their own row).
  $effect(() => {
    if ($auth.status !== "loading") void load(size, scope);
  });

  function choose(nextSize: number, nextScope: string) {
    const query = nextScope === "all" ? `?size=${nextSize}&scope=all` : `?size=${nextSize}`;
    void goto(`/leaderboard${query}`, { replaceState: true, keepFocus: true, noScroll: true });
  }
</script>

<svelte:head>
  <title>Leaderboard · Loophole</title>
</svelte:head>

<SiteHeader />

<main class="page">
  <h1>Leaderboards</h1>

  <fieldset class="choices">
    <legend class="visually-hidden">Size</legend>
    {#each SIZES as s (s)}
      <button type="button" class="chip" aria-pressed={s === size} onclick={() => choose(s, scope)}>
        {sizeName(s)} {s}×{s}
      </button>
    {/each}
  </fieldset>
  <fieldset class="choices">
    <legend class="visually-hidden">Period</legend>
    <button type="button" class="chip" aria-pressed={scope === "today"} onclick={() => choose(size, "today")}>Today</button>
    <button type="button" class="chip" aria-pressed={scope === "all"} onclick={() => choose(size, "all")}>All time</button>
  </fieldset>

  {#if missing}
    <p class="soft">Today's {sizeName(size)} puzzle isn't ready yet.</p>
  {:else}
    <LeaderboardCard {board} caption="{size * size} cells · {scope === 'all' ? 'all time' : 'today'}" />
  {/if}
  {#if scope === "all"}
    <p class="soft">Each player's best time on any daily puzzle of this size.</p>
  {/if}
</main>

<style>
  .page {
    max-width: 640px;
    margin: 0 auto;
    padding: 16px 16px calc(24px + env(safe-area-inset-bottom));
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

  .choices {
    margin: 0;
    padding: 0 0 2px;
    border: 0;
    min-width: 0;
    display: flex;
    gap: 8px;
    overflow-x: auto;
  }

  /* Size chips (Home artboard, Practice). */
  .chip {
    flex: 0 0 auto;
    height: 44px;
    padding: 0 14px;
    border-radius: 8px;
    border: 2px solid var(--hairline);
    background: var(--sheet);
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
  }

  .chip[aria-pressed="true"] {
    border-color: var(--ink);
    background: var(--ink);
    color: var(--on-ink);
  }

  .soft {
    margin: 0;
    font-size: 14px;
    color: var(--ink-soft);
  }
</style>
````

**Edit `apps/web/src/routes/account/+page.svelte`**: 5 replacements, in order.

1. Find:
````svelte
  import GuestImport from "$lib/components/GuestImport.svelte";
  import SiteHeader from "$lib/components/SiteHeader.svelte";
  import { submissions } from "$lib/editor/index.ts";
  import { type Submission, verdictText } from "$lib/editor/submit.ts";
````
   Replace with:
````svelte
  import GuestImport from "$lib/components/GuestImport.svelte";
  import SiteHeader from "$lib/components/SiteHeader.svelte";
  import { daily } from "$lib/daily/index.ts";
  import { submissions } from "$lib/editor/index.ts";
  import { type Submission, verdictText } from "$lib/editor/submit.ts";
````

2. Find:
````svelte
  let mine: Submission[] | null = $state(null);
  let mineFailed = $state(false);

  // The player's submitted puzzles and their verdicts (PRD FR-27).
````
   Replace with:
````svelte
  let mine: Submission[] | null = $state(null);
  let mineFailed = $state(false);
  // The name shown on leaderboards: undefined until loaded.
  let displayName: string | null | undefined = $state(undefined);
  let nameDraft = $state("");
  let nameError = $state("");
  let nameSaved = $state(false);
  let nameBusy = $state(false);

  $effect(() => {
    if ($auth.status === "user" && displayName === undefined) {
      daily.displayName($auth.user.id).then((result) => {
        displayName = result.ok ? result.value : null;
        nameDraft = displayName ?? "";
      });
    }
  });

  async function saveName(event: SubmitEvent | null, userId: string, name: string | null) {
    event?.preventDefault();
    nameBusy = true;
    nameError = "";
    nameSaved = false;
    const result = await daily.setDisplayName(userId, name);
    nameBusy = false;
    if (!result.ok) {
      nameError = result.message;
      return;
    }
    displayName = result.value;
    nameDraft = result.value ?? "";
    nameSaved = true;
  }

  // The player's submitted puzzles and their verdicts (PRD FR-27).
````

3. Find:
````svelte
        <p>
          Your email isn't confirmed yet. You can play as usual; confirming it will let you submit
          puzzles and appear on leaderboards when those arrive.
        </p>
        <button class="secondary" type="button" onclick={() => resend(user.email)}>Send a new link</button>
````
   Replace with:
````svelte
        <p>
          Your email isn't confirmed yet. You can play as usual; confirming it will let you submit
          puzzles, play daily puzzles ranked and appear on leaderboards.
        </p>
        <button class="secondary" type="button" onclick={() => resend(user.email)}>Send a new link</button>
````

4. Find:
````svelte
    {#if logOutError}<p class="error" role="alert">{logOutError}</p>{/if}
    {#if user.isAdmin}<p><a href="/admin">Reported puzzles</a></p>{/if}

    <h2>Your puzzles</h2>
````
   Replace with:
````svelte
    {#if logOutError}<p class="error" role="alert">{logOutError}</p>{/if}
    {#if user.isAdmin}<p><a href="/admin">Reported puzzles</a></p>{/if}

    <h2 id="name">Name on leaderboards</h2>
    <p>
      Leaderboards show this name next to your times, for anyone to see. Without one you're listed as
      Anonymous.
    </p>
    {#if displayName !== undefined}
      <form onsubmit={(e) => saveName(e, user.id, nameDraft)}>
        <label>
          Name
          <input type="text" autocomplete="nickname" required minlength="3" maxlength="20" bind:value={nameDraft} />
          <span class="hint">3 to 20 letters, digits, _ . or -</span>
        </label>
        {#if nameError}<p class="error" role="alert">{nameError}</p>{/if}
        {#if nameSaved}<p class="done" role="status">Saved.</p>{/if}
        <button class="primary" type="submit" disabled={nameBusy}>Save name</button>
        {#if displayName !== null}
          <button class="secondary" type="button" disabled={nameBusy} onclick={() => saveName(null, user.id, null)}>Remove my name</button>
        {/if}
      </form>
    {/if}

    <h2>Your puzzles</h2>
````

5. Find:
````svelte
    <p>
      This removes your email, password and everything saved for your account, for good, including
      this browser's copy of it. Puzzles you published stay up for others to play, no longer linked to
      you. Progress you saved here without an account stays.
    </p>
    <form onsubmit={(e) => deleteAccount(e, user.id)}>
````
   Replace with:
````svelte
    <p>
      This removes your email, password and everything saved for your account, for good, including
      your times and name on the leaderboards and this browser's copy of your progress. Puzzles you
      published stay up for others to play, no longer linked to you. Progress you saved here without
      an account stays.
    </p>
    <form onsubmit={(e) => deleteAccount(e, user.id)}>
````

**Edit `apps/web/src/lib/components/SiteHeader.svelte`** (Today and Ranks join Create; Ranks needs the leaderboard route above): 2 replacements, in order.

1. Find:
````svelte
      </a>
      <nav class="main" aria-label="Main">
        <a href="/create" aria-current={page.url.pathname === "/create" ? "page" : undefined}>Create</a>
      </nav>
    </div>
````
   Replace with:
````svelte
      </a>
      <nav class="main" aria-label="Main">
        <a href="/" aria-current={page.url.pathname === "/" ? "page" : undefined}>Today</a>
        <a href="/create" aria-current={page.url.pathname === "/create" ? "page" : undefined}>Create</a>
        <a href="/leaderboard" aria-current={page.url.pathname === "/leaderboard" ? "page" : undefined}>Ranks</a>
      </nav>
    </div>
````

2. Find:
````svelte
  .start {
    display: flex;
    align-items: center;
    gap: 16px;
  }
````
   Replace with:
````svelte
  .start {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 16px;
  }

  .main {
    display: flex;
    gap: 4px;
  }
````

**Verify:** `bun run check`.

**Commit:** `feat(web): leaderboard page and leaderboard names on the account page`

### B6 End-to-end tests

`tests/daily-mocks.ts` answers the daily, attempt, leaderboard, session and progress routes with `page.route`, with the small-7 fixture as today's 7×7 (`e2e-daily-7`) and the Solved artboard's leaderboard. `tests/daily.e2e.ts` runs under `bun run test:e2e` with no server; `tests/daily.auth-e2e.ts` runs against the real API and worker and skips itself without Mailpit, Garage or challenges.cloudflare.com.

**Create `apps/web/tests/daily-mocks.ts`**:

````ts
import type { Schemas } from "@loophole/api-client";
import type { Page, Route } from "@playwright/test";
import { FIXTURES } from "../src/lib/puzzles/fixtures.ts";

// A stand-in for the daily puzzle API, so the guest end-to-end tests (`bun run test:e2e`, no
// server) can open daily puzzles, ranked attempts and leaderboards. Today's 7×7 daily is the
// small-7 fixture under the id below; the other sizes aren't ready.

export const DAILY_ID = "e2e-daily-7";
export const TODAY = new Date().toISOString().slice(0, 10);

const small7 = FIXTURES.find((f) => f.id === "small-7");
if (small7 === undefined) throw new Error("small-7 fixture missing");

export const USER: Schemas["User"] = {
  id: "u1",
  email: "ann@example.com",
  emailVerified: true,
  isAdmin: false,
  createdAt: "2026-10-01T00:00:00.000Z",
};

export function attempt(changes: Partial<Schemas["Attempt"]> = {}): Schemas["Attempt"] {
  return {
    puzzleId: DAILY_ID,
    day: TODAY,
    area: 49,
    level: 1,
    status: "playing",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    elapsedMs: 0,
    assisted: false,
    ranked: false,
    rank: null,
    ...changes,
  };
}

/** The Solved artboard's board: the top three, a gap, then the player and their neighbours. */
export const BOARD: Schemas["Leaderboard"] = {
  area: 49,
  level: 1,
  total: 480,
  entries: [
    { rank: 1, name: "kuroneko", timeMs: 72_000, me: false },
    { rank: 2, name: "tsuru", timeMs: 79_000, me: false },
    { rank: 3, name: "inkwell", timeMs: 86_000, me: false },
    { rank: 213, name: null, timeMs: 197_000, me: false },
    { rank: 214, name: null, timeMs: 198_000, me: true },
    { rank: 215, name: "loop_de_loop", timeMs: 201_000, me: false },
  ],
  me: { rank: 214, name: null, timeMs: 198_000, me: true },
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: status < 400 ? "application/json" : "application/problem+json",
    body: JSON.stringify(body),
  });

export interface MockOptions {
  /** Log in as `USER`; a guest otherwise. */
  readonly user?: boolean;
  /** The player's attempt at today's 7×7, as the server first reports it. */
  readonly attempt?: Schemas["Attempt"] | null;
  /** The saved board on the daily, in the edge-state encoding. */
  readonly progress?: string;
  /** What finishing the attempt answers. */
  readonly finished?: Schemas["Attempt"];
}

/** Answers the daily API (and the session and progress routes it needs) from fixed data. */
export async function mockDailyApi(page: Page, options: MockOptions = {}) {
  let current = options.attempt ?? null;
  // The saved board on the daily: PUT replaces it and DELETE (Start over, or a ranked start) drops it.
  let stored = options.progress === undefined ? null : { edges: options.progress, solved: true };
  await page.route("**/api/session", (route) => json(route, { user: options.user ? USER : null }));
  await page.route("**/api/daily*", (route) =>
    json(route, {
      day: TODAY,
      live: true,
      nextAt: `${TODAY}T23:59:59.999Z`,
      puzzles: [
        { size: 7, puzzleId: DAILY_ID },
        { size: 10, puzzleId: null },
        { size: 20, puzzleId: null },
        { size: 40, puzzleId: null },
      ],
    }),
  );
  await page.route(`**/api/puzzles/${DAILY_ID}`, (route) =>
    json(route, {
      id: DAILY_ID,
      puzzle: small7?.wire,
      origin: "generated",
      createdAt: `${TODAY}T00:00:00.000Z`,
    }),
  );
  await page.route(`**/api/leaderboards/**`, (route) => json(route, BOARD));
  await page.route("**/api/users/u1/daily", (route) =>
    json(route, {
      day: TODAY,
      streak: 12,
      week: [6, 5, 4, 3, 2, 1, 0].map((back) => ({
        day: new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10),
        finished: back > 0,
      })),
      attempts: current === null ? [] : [current],
      bests: [{ area: 49, level: 1, timeMs: 171_000 }],
    }),
  );
  await page.route(`**/api/users/u1/attempts/${DAILY_ID}`, (route) => {
    if (route.request().method() === "POST") current = attempt();
    return json(route, { attempt: current });
  });
  await page.route(`**/api/users/u1/attempts/${DAILY_ID}/finish`, (route) => {
    current = options.finished ?? attempt({ status: "finished", ranked: true, rank: 1 });
    return json(route, { attempt: current });
  });
  await page.route("**/api/users/u1/progress*", (route) => json(route, { items: [] }));
  await page.route(`**/api/users/u1/progress/${DAILY_ID}`, async (route) => {
    const request = route.request();
    if (request.method() === "DELETE") {
      stored = null;
      return route.fulfill({ status: 204 });
    }
    if (request.method() === "PUT") {
      const body = request.postDataJSON() as { edges: string; elapsedMs: number };
      stored = { edges: body.edges, solved: false };
      const progress = {
        puzzleId: DAILY_ID,
        edges: body.edges,
        elapsedMs: body.elapsedMs,
        solved: false,
        assisted: false,
        version: 2,
        updatedAt: new Date().toISOString(),
      };
      return json(route, { progress, accepted: true });
    }
    if (stored === null) return json(route, { progress: null });
    return json(route, {
      progress: {
        puzzleId: DAILY_ID,
        edges: stored.edges,
        elapsedMs: 198_000,
        solved: stored.solved,
        assisted: false,
        version: 1,
        updatedAt: new Date().toISOString(),
      },
    });
  });
}
````

**Create `apps/web/tests/daily.e2e.ts`**:

````ts
import { createGrid } from "@loophole/core";
import { expect, test } from "@playwright/test";
import { FIXTURE_SOLUTIONS } from "../src/lib/test-support/solutions.ts";
import { board, edgePoint, lines, scrollsSideways } from "./board.ts";
import { attempt, DAILY_ID, mockDailyApi, TODAY } from "./daily-mocks.ts";

// Daily puzzles, ranked play and leaderboards against a stand-in for the API (daily-mocks.ts):
// `bun run test:e2e` runs with no server. The real API is covered by daily.auth-e2e.ts.

const grid7 = createGrid(7, 7);
const SOLUTION = FIXTURE_SOLUTIONS["small-7"];

test.describe("home on a phone (Home artboard, FR-22, FR-24)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("today's puzzles as covers, the countdown and practice; a guest is offered a login", async ({
    page,
  }) => {
    await mockDailyApi(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Today's puzzles" })).toBeVisible();
    await expect(page.getByRole("timer")).toContainText("New puzzles in");
    const covers = page.getByRole("list", { name: "Today's daily puzzles" });
    const small = covers.getByRole("link", { name: /Small.*New · not started/ });
    await expect(small).toHaveAttribute("href", `/daily/${TODAY}/7`);
    await expect(small).toHaveCSS("background-color", "rgb(242, 196, 206)");
    await expect(covers.getByText("Not ready yet")).toHaveCount(3);
    await expect(page.getByText("With an account, your daily solves are ranked")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Practice 練習" })).toBeVisible();
    expect(await scrollsSideways(page)).toBe(false);
  });

  test("a logged-in player sees their streak and their solved daily", async ({ page }) => {
    await mockDailyApi(page, {
      user: true,
      attempt: attempt({ status: "finished", elapsedMs: 198_000, ranked: true, rank: 214 }),
    });
    await page.goto("/");
    await expect(page.getByLabel("Streak")).toContainText("12 day streak");
    const covers = page.getByRole("list", { name: "Today's daily puzzles" });
    await expect(covers.getByRole("link", { name: /Small.*Solved · 03:18/ })).toBeVisible();
  });

  test("without the server, practice still works", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Daily puzzles need the server")).toBeVisible();
    await expect(page.getByRole("link", { name: /Small/ }).first()).toHaveAttribute(
      "href",
      "/play/small-7",
    );
  });
});

test.describe("daily play", () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });

  test("a guest plays today's daily unranked", async ({ page }) => {
    await mockDailyApi(page);
    await page.goto(`/daily/${TODAY}/7`);
    await expect(page.getByRole("heading", { name: "Small · 7×7" })).toBeVisible();
    await expect(page.getByText("Daily ·").first()).toBeVisible();
    await expect(board(page)).toBeVisible();
    await expect(page.getByText("Playing unranked.")).toBeVisible();
  });

  test("a ranked solve: start, solve, the server's rank on the Solved screen (FR-17, FR-25)", async ({
    page,
  }) => {
    await mockDailyApi(page, {
      user: true,
      // Solved earlier, unranked: a ranked attempt still starts from an empty board.
      progress: SOLUTION,
      finished: attempt({
        status: "finished",
        elapsedMs: 198_000,
        ranked: true,
        rank: 214,
        finishedAt: new Date().toISOString(),
      }),
    });
    await page.goto(`/daily/${TODAY}/7`);
    await expect(page.getByRole("heading", { name: "Ranked solve" })).toBeVisible();
    await expect(board(page)).toHaveCount(0);
    await expect(page.getByText("Starting clears any unranked progress")).toBeVisible();
    await page.getByRole("button", { name: "Start" }).click();
    await expect(board(page)).toBeVisible();
    await expect(lines(page)).toHaveCount(0);
    // A ranked clock never pauses.
    await expect(page.getByRole("button", { name: /Pause/ }).first()).toBeDisabled();
    const finish = page.waitForRequest((r) => r.url().endsWith(`/attempts/${DAILY_ID}/finish`));
    for (let e = 0; e < SOLUTION.length; e++) {
      if (SOLUTION[e] !== "1") continue;
      const p = await edgePoint(page, grid7, e);
      await page.touchscreen.tap(p.x, p.y);
    }
    const sent = (await finish).postDataJSON() as { edges: string; elapsedMs: number };
    expect(sent.edges.replaceAll("2", "0")).toBe(SOLUTION.replaceAll("2", "0"));
    await expect(page.getByRole("img", { name: "Solved" })).toBeVisible();
    await expect(page.getByText("Rank today")).toBeVisible();
    await expect(page.getByText("#214")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "You" })).toContainText("03:18");
  });
});

test.describe("Solved screen (Solved artboard, FR-23, FR-24)", () => {
  test.use({ viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true });

  test("stamp, time, rank, best and the leaderboard around the player", async ({ page }) => {
    await mockDailyApi(page, {
      user: true,
      attempt: attempt({ status: "finished", elapsedMs: 198_000, ranked: true, rank: 214 }),
      progress: SOLUTION,
    });
    await page.goto(`/daily/${TODAY}/7`);
    await expect(page.getByRole("img", { name: "Solved" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Your solved board" })).toBeVisible();
    await expect(page.getByText("03:18").first()).toBeVisible();
    await expect(page.getByText("#214")).toBeVisible();
    await expect(page.getByText("02:51")).toBeVisible();
    await expect(page.getByRole("heading", { name: "番付 Leaderboard" })).toBeVisible();
    await expect(page.getByText("49 cells · today")).toBeVisible();
    const rows = page.getByRole("listitem");
    await expect(rows.filter({ hasText: "kuroneko" })).toContainText("01:12");
    await expect(rows.filter({ hasText: "You" })).toContainText("214");
    await expect(rows.filter({ hasText: "Anonymous" })).toContainText("213");
    await expect(page.getByRole("link", { name: /Next: Medium 10×10/ })).toHaveAttribute(
      "href",
      `/daily/${TODAY}/10`,
    );
    expect(await scrollsSideways(page)).toBe(false);

    await page.getByRole("button", { name: "Play again, unranked" }).click();
    await expect(page.getByText("Playing again for practice")).toBeVisible();
  });
});

test.describe("leaderboard page (FR-23)", () => {
  test.use({ viewport: { width: 360, height: 560 }, hasTouch: true, isMobile: true });

  test("shows today's board and switches to all time", async ({ page }) => {
    await mockDailyApi(page);
    await page.goto("/leaderboard");
    await expect(page.getByRole("heading", { name: "Leaderboards" })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "tsuru" })).toBeVisible();
    await page.getByRole("button", { name: "All time" }).click();
    await expect(page).toHaveURL(/scope=all/);
    await expect(page.getByText("49 cells · all time")).toBeVisible();
    expect(await scrollsSideways(page)).toBe(false);
  });
});
````

**Create `apps/web/tests/daily.auth-e2e.ts`**:

````ts
import { EdgeState, parsePuzzle, verify } from "@loophole/core";
import { expect, test } from "@playwright/test";
import { board, edgePoint } from "./board.ts";
import { canSignUp, mailedLink, reachable } from "./mailpit.ts";

// Today's daily puzzles from the real worker and a ranked solve validated by the real API (PRD
// FR-17, FR-22, FR-23, FR-25), with the stack playwright.auth.config.ts starts.

const PASSWORD = "hunter22-e2e";

test.beforeAll(async () => {
  // Ranked play needs a confirmed email (Mailpit) and the worker's puzzles (Garage).
  test.skip(
    !(await canSignUp()) || !(await reachable("http://localhost:3903/health")),
    "needs Mailpit and Garage (docker compose up -d) and access to challenges.cloudflare.com",
  );
});

test.use({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });

test("a confirmed player solves today's 7×7 ranked and sees their rank", async ({ page }) => {
  test.setTimeout(90_000);
  // Sign up, confirm and log in through the API; the account test covers those pages.
  const email = `e2e-${crypto.randomUUID()}@loophole.test`;
  const signUp = await page.request.post("/api/auth/signup", {
    data: { email, password: PASSWORD, captchaToken: "XXXX.DUMMY.TOKEN.XXXX" },
  });
  expect(signUp.status()).toBe(204);
  const token = new URLSearchParams((await mailedLink(email)).split("#")[1]).get("token");
  expect((await page.request.post("/api/auth/verify-email", { data: { token } })).status()).toBe(
    204,
  );
  const login = await page.request.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(login.status()).toBe(200);

  // The worker generates today's puzzles when it starts.
  let puzzleId = "";
  let day = "";
  await expect
    .poll(
      async () => {
        const set = (await (await page.request.get("/api/daily")).json()) as {
          day: string;
          puzzles: { size: number; puzzleId: string | null }[];
        };
        day = set.day;
        puzzleId = set.puzzles.find((p) => p.size === 7)?.puzzleId ?? "";
        return puzzleId;
      },
      { timeout: 30_000 },
    )
    .not.toBe("");

  // The puzzle comes without its seed or generator version, and the solution is worked out here
  // from the clues, as anyone could.
  const served = (await (await page.request.get(`/api/puzzles/${puzzleId}`)).json()) as {
    puzzle: Record<string, unknown>;
  };
  expect(Object.keys(served.puzzle).sort()).toEqual(["clues", "height", "v", "width"]);
  const puzzle = parsePuzzle(served.puzzle);
  const [solution] = verify(puzzle).solutions;

  await page.goto("/");
  const covers = page.getByRole("list", { name: "Today's daily puzzles" });
  await expect(page.getByLabel("Streak")).toContainText("0 day streak");
  await covers.getByRole("link", { name: /Small.*New · not started/ }).click();
  await expect(page).toHaveURL(`/daily/${day}/7`);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(board(page)).toBeVisible();
  const started = Date.now();

  const lines = [...solution.keys()].filter((e) => solution[e] === EdgeState.Line);
  for (const e of lines.slice(0, -1)) {
    const p = await edgePoint(page, puzzle.grid, e);
    await page.touchscreen.tap(p.x, p.y);
  }
  // A solve faster than the loop can be drawn (5 s for 49 cells) isn't ranked.
  await page.waitForTimeout(Math.max(0, 6_000 - (Date.now() - started)));
  const last = await edgePoint(page, puzzle.grid, lines[lines.length - 1]);
  await page.touchscreen.tap(last.x, last.y);

  await expect(page.getByText("Rank today")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("#1", { exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "You" })).toContainText("1");

  await page.goto("/");
  await expect(page.getByLabel("Streak")).toContainText("1 day streak");
  await expect(covers.getByRole("link", { name: /Small.*Solved/ })).toBeVisible();
});
````

**Verify:** `bun run check`; `E2E_PORT=4273 bun run test:e2e` (72 pass); with the dev services up, `E2E_AUTH_PORT=4274 bun run test:e2e:auth` (5 pass).

**Commit:** `test(web): end-to-end tests of daily puzzles and a ranked solve`

### B7 Docs

Append the four DECISIONS entries to the end of the file as shown (the block starts with a blank line). The other doc edits change a phrase or add a paragraph.

**Append to the end of `docs/DECISIONS.md`**:

````markdown

## 2026-10-25 · WT11 `daily-leaderboards` · Ranked play in the web app
- **Question:** How does the web app run a ranked attempt, and what happens when the solve can't be sent?
- **Decision:**
  - **Pages.** Today's puzzles open at `/daily/<day>/<size>`. A confirmed player who hasn't started sees a card explaining the ranked rules with a Start button, and no board, so the clock and the first sight of the puzzle line up. A successful Start clears the board saved for that puzzle (on the account and the device), so unranked progress from before (an unconfirmed account, guest progress brought in, another device) never counts toward the ranked time, and a board already solved can't finish the attempt at once; the card says so. A Start refused because the day ended (409) reloads the page, which then plays unranked. After Start the play screen runs with a `ranked` prop: the clock starts from the server's elapsed time and has no pause, "Hint used · unranked" replaces "Hint used", and the solved card has no Start over. Everything else about ranking lives in `$lib/daily`; the play screen only calls `onsolve`.
  - **Sending.** On solve the board and the clock are kept in `localStorage` under the account's keys (`loophole:user:<id>:ranked:<puzzle>`) and sent; network failures, 408, 429 and server errors are retried after 2, 5, 15, then every 30 s, and a page opened later sends a kept solve first, with its original time. A 401 or 403 stops and keeps it for the next login; any other refusal drops it, and so does opening the page when the server already has the attempt finished. Deleting the account removes it with the rest of the account's keys.
  - **After.** A finished attempt shows the Solved screen. "Play again, unranked" opens the board as a practice replay. Guests, unconfirmed accounts and earlier days' dailies play as before, with a note under the board.
- **Reason:** Keeping the solve until the server has it is the offline rule WT9 set for progress; sending the time measured at the solve, within the server's grace, keeps a short outage from costing time. Gating the board keeps a player from studying the puzzle on the ranked clock's page before it starts, though the clues are public anyway.

## 2026-10-25 · WT11 `daily-leaderboards` · Home and Solved screens against the design kit
- **Question:** The Home and Solved artboards show some things the app doesn't have yet. What was built?
- **Decision:** Home: the date line, "Today's puzzles", a countdown to 00:00 UTC (not on the artboard), the streak card for confirmed players (a one-line note for guests and unconfirmed accounts), the four daily covers in their tints with status lines, then Continue and the practice covers as before. The header's main navigation is Today, Create and Ranks (the leaderboard page); Library, the practice size chips with "New 7×7 puzzle" and the "From players" list are not built, since nothing serves them yet. Solved: the board with its inside washed, the stamp, Time, Rank today and Your best, the leaderboard of the area, Next and, added, "All-time board" and "Play again, unranked". The share button copies (or shares) a one-line result; the shu last stroke is not drawn, as the play screen doesn't record which stroke closed the loop.
- **Reason:** Matches the artboards wherever there is data to show, without dead links or buttons.

## 2026-10-25 · WT11 `daily-leaderboards` · Configurable end-to-end ports
- **Question:** Parallel worktrees running the Playwright tests collide on the fixed ports 4173 and 4174 (`--strictPort` fails). How are they told apart?
- **Decision:** `E2E_PORT` (default 4173) sets the `vite preview` port of `bun run test:e2e` and `test:perf`; `E2E_AUTH_PORT` (default 4174) sets the API's port, `PUBLIC_URL` and the mailed links of `bun run test:e2e:auth`. Both are read in `tests/ports.ts`, which the configs and tests import.
- **Reason:** One variable per config keeps both suites runnable at once in one checkout, and the defaults leave every existing command unchanged.

## 2026-10-25 · WT11 `daily-leaderboards` · End-to-end tests of daily puzzles
- **Question:** How are daily puzzles tested in a browser when `bun run test:e2e` has no API?
- **Decision:** `tests/daily.e2e.ts` stands in for the daily, attempt, leaderboard, session and progress routes with `page.route` (`tests/daily-mocks.ts`), with the small-7 fixture as today's 7×7: the home covers and streak, guest play, a ranked solve from Start to the Solved screen, the Solved screen itself and the leaderboard page. `tests/daily.auth-e2e.ts` runs the real thing with the auth config's API and worker: the worker stocks today's puzzles (`DAILY_DAYS_AHEAD=2` there), a confirmed player solves the 7×7 ranked (the test works out the solution from the clues with core's `verify` and waits out the 5 s minimum) and sees rank #1 and a one-day streak. It skips itself without Mailpit, Garage or Cloudflare.
- **Reason:** The stand-in keeps the screens covered with no server, and one real run checks the parts a stand-in can't: the worker's schedule, the secret seed, the server's check of the board and its timing.
````

**Edit `README.md`**: 4 replacements, in order.

1. Find (this text, which may be part of a line):
````markdown
and lets players choose a name for the leaderboards; the web app's screens for them come in the next phase.
````
   Replace with:
````markdown
and lets players choose a name for the leaderboards. The home page shows today's puzzles as book covers with a countdown to the next ones and, for logged-in players, their streak. A confirmed player gets one ranked try at each daily, on a clock that doesn't stop, and the Solved screen shows the time, the rank and the leaderboard of that size; guests play the dailies unranked. The leaderboard page (Ranks) shows each size's board for today and of all time.
````

2. Find (this text, which may be part of a line):
````markdown
```sh
bun run test:e2e
```
````
   Replace with:
````markdown
```sh
bun run test:e2e
```

They serve the build on port 4173; set `E2E_PORT` to use another, for example while another checkout runs its own tests.
````

3. Find (this text, which may be part of a line):
````markdown
starts the API serving it on port 4174 and a worker,
````
   Replace with:
````markdown
starts the API serving it on port 4174 (`E2E_AUTH_PORT` to change it) and a worker,
````

4. Find (this text, which may be part of a line):
````markdown
and brings a guest's progress into an account.
````
   Replace with:
````markdown
and brings a guest's progress into an account. The daily test waits for the worker to generate today's puzzles, solves the 7×7 ranked and checks its rank.
````

**Edit `docs/TESTING.md`**: 4 replacements, in order.

1. Find (this text, which may be part of a line):
````markdown
Run them with `bun run test:e2e`. They are not part of `bun run check`
````
   Replace with:
````markdown
Run them with `bun run test:e2e`; they serve the build on port 4173, or on `E2E_PORT` when it is set, which side-by-side worktrees need. They are not part of `bun run check`
````

2. Find (this text, which may be part of a line):
````markdown
starts the real API serving it on port 4174 and a worker,
````
   Replace with:
````markdown
starts the real API serving it on port 4174 (or `E2E_AUTH_PORT`) and a worker,
````

3. Find (this text, which may be part of a line):
````markdown
plays it in two browser contexts logged in to the same account.
````
   Replace with:
````markdown
plays it in two browser contexts logged in to the same account; the daily test waits for the worker to generate today's puzzles (the config keeps `DAILY_DAYS_AHEAD` at 2) and solves the 7×7 ranked, working out the solution from the clues with core's `verify`.
````

4. Find (this text, which may be part of a line):
````markdown
The web app's sync module is tested under `bun test`
````
   Replace with:
````markdown
The daily puzzle screens need the API, which `vite preview` doesn't have, so `tests/daily.e2e.ts` answers the daily, attempt, leaderboard, session and progress routes itself with `page.route` (`tests/daily-mocks.ts`), with the small-7 fixture as today's 7×7.

The web app's sync module is tested under `bun test`
````

**Edit `apps/web/AGENTS.md`**: 1 replacement, in order.

1. Find (this text, which may be part of a line):
````markdown
- The puzzle editor's logic (draft, keys, live check, submitting) lives in plain, tested modules under `lib/editor`; its components stay thin, and its board reuses the play board's renderers.
````
   Replace with:
````markdown
- The puzzle editor's logic (draft, keys, live check, submitting) lives in plain, tested modules under `lib/editor`; its components stay thin, and its board reuses the play board's renderers.
- Daily puzzles, ranked attempts and leaderboards go through `lib/daily`, plain tested modules over the generated client. The play screen takes an optional `ranked` prop and knows nothing else about ranking. The guest end-to-end tests stand in for the daily API with `page.route` (`tests/daily-mocks.ts`); the end-to-end ports come from `tests/ports.ts` (`E2E_PORT`, `E2E_AUTH_PORT`).
````

**Verify:** `bun run check`.

**Commit:** `docs: daily puzzles, ranked play and leaderboards in the web app`

### B8 Live check and screenshots (no commit)

1. `E2E_PORT=4273 bun run test:e2e` — all pass (the 7 new daily tests among them).
2. With Garage and Mailpit up: `E2E_AUTH_PORT=4274 bun run test:e2e:auth` — 5 pass, including "a confirmed player solves today's 7×7 ranked and sees their rank".
3. `E2E_PORT=4273 bun run test:perf` if `uptime` shows a load average under 4 (it misses budgets under load; a miss under load isn't a failure of this work).
4. Screenshots against the artboards: create `apps/web/tests/zz-shots.e2e.ts` (delete it afterwards; don't commit it), run `E2E_PORT=4273 bunx playwright test tests/zz-shots.e2e.ts` from `apps/web`, and compare `home.png` with `design-home.png` and `solved.png` with `design-solved.png` in `/tmp/loophole-shots`. Expect the same layout, tints, stamp, stat cards and leaderboard rows; the differences listed in DECISIONS ("Home and Solved screens against the design kit") are expected.

````ts
import { resolve } from "node:path";
import { test } from "@playwright/test";
import { FIXTURE_SOLUTIONS } from "../src/lib/test-support/solutions.ts";
import { attempt, mockDailyApi, TODAY } from "./daily-mocks.ts";

const OUT = "/tmp/loophole-shots";
// Run from apps/web, as the step says.
const DESIGN = resolve(process.cwd(), "../../docs/design");
test.use({ viewport: { width: 390, height: 900 } });

test("screenshots", async ({ page }) => {
  await mockDailyApi(page, {
    user: true,
    attempt: attempt({ status: "finished", elapsedMs: 198_000, ranked: true, rank: 214 }),
    progress: FIXTURE_SOLUTIONS["small-7"],
  });
  await page.goto("/");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/home.png`, fullPage: true });
  await page.goto(`/daily/${TODAY}/7`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/solved.png`, fullPage: true });
  await page.goto(`file://${DESIGN}/Home.dc.html`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/design-home.png`, fullPage: true });
  await page.goto(`file://${DESIGN}/Solved.dc.html`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/design-solved.png`, fullPage: true });
});
````

## Acceptance criteria

- **FR-22**: the home page shows today's four dailies as covers in the kit's tints with a countdown to 00:00 UTC; covers link to `/daily/<day>/<size>`; not-ready sizes say so (daily.e2e "today's puzzles as covers…"; daily.auth-e2e uses the worker's real puzzles).
- **Ranked start**: Start clears earlier unranked progress, so the ranked board starts empty (daily.e2e ranked test with a solved board saved beforehand).
- **FR-17, FR-25**: a ranked solve is sent to the server and only the server's answer shows the Solved screen; the client never has the solution (it sends its board); a solve that can't be sent is kept on the device and sent again with its original time (`finish.test.ts`; daily.e2e ranked test; daily.auth-e2e real solve with rank #1).
- **FR-12**: a hint during a ranked attempt shows "Hint used · unranked"; the server marks the attempt (WT11a); the Solved screen says the solve isn't on the leaderboard.
- **FR-23**: the Solved screen and the leaderboard page show the area's board with the top rows, a gap, and the player's row ("You", ai outline) and neighbours, even outside the top (`view.test.ts` rows; daily.e2e Solved and leaderboard tests).
- **FR-24**: the streak card shows the count and the last seven days; the Solved screen shows Your best (daily.e2e; daily.auth-e2e "1 day streak").
- **Guests** play dailies unranked with local progress (daily.e2e "a guest plays today's daily unranked").
- **NFR-2**: no sideways scroll at 360×560 and 390×844 on the home, Solved and leaderboard pages (daily.e2e).
- **NFR-5**: statuses and rows are words ("Solved", "You", "Anonymous", "Not ready yet"), never colour alone; buttons and links are reachable from the keyboard.
- **NFR-6**: a kept ranked solve lives under `loophole:user:<id>:`, so deleting the account clears it (`forgetUser`); the account page says leaderboard entries and the name go with the account.
- **Layering in the web app**: logic is in plain tested modules (`lib/daily/*.ts`, under `bun test`), components stay thin, PlayScreen only gains the `ranked` prop.
- **Follow-ups**: `E2E_PORT` and `E2E_AUTH_PORT` work (`E2E_PORT=4273 bun run test:e2e`), documented; the wide header has 24 px gutters from 900 px.
- `bun run check` passes after every step; `bun run test:e2e` passes with no API; `bun run test:e2e:auth` passes with the dev services.

## DECISIONS entries (added in step B7)

Ranked play in the web app · Home and Solved screens against the design kit · Configurable end-to-end ports · End-to-end tests of daily puzzles — the full text is in step B7.

## Review responses (plan review 1)

- 11b-1 (saved progress carries into the ranked attempt): accepted. Start clears the saved board before the ranked board opens; the gate card says so; the mocked ranked e2e now starts with a solved board saved and checks the ranked board is empty; the 11a DECISIONS entry says a ranked attempt starts from an empty board. If another tab of the same player started the attempt a moment earlier, its first moves are cleared too; that is accepted.
- 11b-2 (kept solve never forgotten): accepted. `finisher.forget` (unit-tested) runs when the attempt reads finished.
- 11b-3 (bad or future day shown as server down): accepted. `daily.dayResult` keeps the status; 404 and 400 become "No such daily puzzle", only status 0 is 503; unit test added.
- 11b-4 (Start refused after midnight): accepted. A 409 runs `invalidateAll()`, and the page drops into the unranked "ended" mode.

## Unresolved questions

- None blocking. Defaults taken: the board stays hidden until Start; Next goes to the next size of the same day whether or not it is solved; the countdown uses the device's clock; the Library tab, practice size chips and "From players" list from the Home artboard are left out until something serves them.
