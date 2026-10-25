# WT11a `daily-leaderboards` (server) — implementation plan

Branch `feat/daily-leaderboards`, worktree `/home/jhonnold/projects/loophole-wt/daily-leaderboards`, based on main `b88ca64` (WT6 to WT10 are all in). This is the first of two plans for WT11: this one is the server (daily puzzles, ranked attempts, leaderboards, streaks, display names); `docs/plans/11b-daily-leaderboards-web.md` is the web app and starts from main once this one is merged.

PRD: FR-22 (a daily puzzle per size class, the same for everyone, switching at 00:00 UTC), FR-23 (leaderboards by area and level, by time, without hinted solves), FR-24 (streaks and personal bests), FR-25 (the solution is never sent; the server validates the solve and checks timing), FR-17 (completion confirmed on the server for ranked puzzles), FR-12 (a hint marks the solve assisted and keeps it off leaderboards), FR-29 (one level), FR-10/FR-11 (deterministic generation in background jobs), NFR-4 (auth, CSRF, validation, rate limits), NFR-6 (stored data and account deletion), §6 stories "rank among puzzles of the same size and level" and "today's daily puzzle and a streak".

## How to work through this plan

- Prefix every shell command with `export PATH="$HOME/.bun/bin:$PATH";` and run it from the worktree root.
- **Create** means: write the file with exactly the content between the four-backtick fences (the Write tool).
- **Edit** means: apply each numbered Find/Replace with the Edit tool, in order. Each Find block is copied from the file as it is at that point, including indentation and blank lines, and occurs exactly once. Don't reformat anything else.
- **Replace the whole of** means: overwrite the file with the content shown.
- Never edit `openapi.yaml` or `packages/api-client/src/schema.ts` by hand: `bun run gen:api` writes them.
- After each step run its verification command. `bun run check` must pass before each commit. If Biome reports formatting only, run `bun run format` and check again.
- One existing test, `openDatabase and migrate > several connections opening a new file at once all succeed in WAL mode`, fails now and then on main too ("no such savepoint", "cannot start a transaction within a transaction"); if it is the only failure, run `bun run check` again. It is a known flake for WT12, not something to fix here.
- Commit after each step with the message given (conventional commits). Don't push.
- Shell reads of `.env*` files are denied: change `.env.example` with the Edit tool.

## What this builds

- **Daily puzzles (FR-22).** Size classes 7, 10, 20 and 40 (`DAILY_SIZES`). The worker runs a scheduler at start and every minute (`DailyStockManager.stock`) that keeps today and the next `DAILY_DAYS_AHEAD − 1` days (3 days in all) generated: one `generate` job per missing day and size, with input `day` set, never refused by the queue cap. The seed is `HMAC-SHA256(DAILY_SEED_SECRET, "loophole-daily:<day>:<size>:<attempt>")`. A job that failed, timed out or is gone is retried at the next check with `attempt + 1`, so with the next seed. The finished job stores the puzzle **without seed or generator version** and with `puzzles.release_at` = 00:00 UTC of its day (`PuzzleManager.saveDaily`), and links it in the new `dailies` table. `PuzzleManager.get` hides a puzzle before its release time, so the puzzle, hint, progress and report routes all answer 404 for tomorrow's. Dailies are left out of the practice list. A size of today's still missing at two checks in a row is logged as an error ("Today's daily puzzles are late").
- **Ranked attempts (FR-17, FR-25).** `attempts` table: one row per user and daily, started only on the daily's own UTC day (409 afterwards), by a logged-in user with a confirmed email (403 otherwise). The clock runs on the server from the start and never stops. Finishing sends the board and the client's own clock; the server compares the board's lines with the stored solution (400 "Not the solution" otherwise) and takes as the ranked time `min(server, max(client, server − grace))`, the grace being a tenth of the server's time, 3 s to 15 s (`rankedGraceMs`). The solve is ranked unless the attempt is assisted or faster than `max(5 s, 0.1 s × cells)`. A finished attempt sent again returns unchanged (retries are safe).
- **Hints (FR-12).** `POST /api/puzzles/{id}/hint` stays open to everyone. With a login it marks that user's unfinished attempt at the puzzle as assisted (`HintManager` → `AttemptManager.recordHint`). On today's daily a `mistake` hint always says `count: 1`.
- **Leaderboards (FR-23).** Per daily (`GET /api/leaderboards/daily/{puzzleId}`) and all-time per area and level (`GET /api/leaderboards/areas/{area}?level=1`, each player's best), ranked solves only, by time then finish time. Each answers the top `limit` (default 10) plus, when logged in, the viewer's row and its neighbours, and the total. Rows: rank, display name or null, time, `me`. No user ids or emails.
- **Streaks and bests (FR-24).** `GET /api/users/{userId}/daily`: streak (consecutive UTC days up to today with a finished attempt, hinted or not; a streak ending yesterday still counts today), the last seven days, today's attempts, best ranked time per bucket.
- **Display names (NFR-6).** Opt-in; none means "Anonymous" on the boards. `display_names` table (`ON DELETE CASCADE`), 3–20 ASCII letters, digits, `_`, `.`, `-` with at least one letter or digit (so unique ignoring case really holds, and no look-alike letters from other scripts), not `you` or `anonymous`, nothing containing `admin`, `loophole`, `moderator` or `official`, at most 10 changes an hour. `GET`/`PUT /api/users/{userId}/display-name`.
- **Account deletion (NFR-6).** `attempts` and `display_names` reference `users(id) ON DELETE CASCADE`, so deleting an account removes its leaderboard entries and name.
- **Migration 006** (`006_daily.sql`): `puzzles.release_at`, `dailies`, `attempts`, `display_names`.

### Layering

| Layer | New or changed |
|---|---|
| Entrypoints | `api/daily.ts` (routes), `api/daily-schemas.ts` (zod), `api/app.ts` (register, error mapping, hint passes the user), `worker/loop.ts` (scheduler tick), composition roots `api/main.ts`, `api/spec.ts`, `worker/main.ts` |
| Managers | `DailyManager` (which puzzles are today's, API side), `DailyStockManager` (scheduler and storing, worker side), `AttemptManager`, `LeaderboardManager`, `DisplayNameManager`, `days.ts` (UTC day maths, streak); changed `PuzzleManager` (`saveDaily`, release check), `HintManager` (records assists), `JobManager` (`enqueueDaily`), `JobRunManager` (daily jobs go to `DailyStockManager.complete`) |
| Ports | `DailyRepository`, `AttemptRepository`, `DisplayNameRepository`, `DailySeeder` in `ports.ts` |
| Adapters | `SqliteDailyRepository`, `SqliteAttemptRepository` (leaderboards with `ROW_NUMBER()`), `SqliteDisplayNameRepository`, `hmacDailySeeder` (`node:crypto`), migration 006; the clock is the existing `Clock` port |

Managers import no adapters, zod or Hono (Biome enforces it); routes only check the session, the path's user, the confirmed email and the rate limit, then call a manager and translate.

### API

| Route | Auth | Answers |
|---|---|---|
| `GET /api/daily?day=` | none | `DailySet {day, live, nextAt, puzzles: [{size, puzzleId \| null}]}`; 404 for a day to come, 400 for a bad day |
| `GET /api/users/{userId}/daily` | own user | `DailySummary {day, streak, week, attempts, bests}` |
| `GET /api/users/{userId}/attempts/{puzzleId}` | own user | `{attempt \| null}`; 404 if not a visible daily |
| `POST /api/users/{userId}/attempts/{puzzleId}` | own, confirmed, CSRF | `{attempt}` (existing or new); 409 day over; 404 |
| `POST /api/users/{userId}/attempts/{puzzleId}/finish` | own, confirmed, CSRF | body `{edges, elapsedMs}` → `{attempt}` with `rank`; 400 wrong/invalid board; 404 no attempt |
| `GET /api/leaderboards/daily/{puzzleId}?limit=` | optional | `Leaderboard {area, level, total, entries, me}` |
| `GET /api/leaderboards/areas/{area}?level=&limit=` | optional | `Leaderboard` |
| `GET`/`PUT /api/users/{userId}/display-name` | own user (PUT: CSRF) | `{displayName \| null}`; 400 bad or reserved; 409 taken |

`Attempt {puzzleId, day, area, level, status: "playing" \| "finished", startedAt, finishedAt, elapsedMs, assisted, ranked, rank}`; while playing `elapsedMs` is the server's time since the start. All `/api/users/{userId}/…` daily routes share 120 requests a minute per user.

## Follow-ups handled here

- `[WT11]` *public display name*: opt-in names in `display_names`, NFR-6 handling and DECISIONS entry (steps A2–A5, A8).
- `[WT11]` *ranked hint/assist recording through the existing hint seam*: `HintManager` → `AttemptManager.recordHint` (steps A4, A5).
- `[WT11]` *drop or cap the hint mistake `count` for live ranked puzzles*: capped at 1 on today's daily (step A5).
- The Playwright port and SiteHeader padding follow-ups are in WT11b (web).

## Out of scope

The web screens (WT11b). Archive pages for earlier days (the API takes `?day=`, the web shows today). Difficulty levels (FR-29: one level). Pausing ranked attempts. Metrics and alerts beyond the log line (WT12). Profanity filtering or reporting of display names. Practice leaderboards for non-daily puzzles.

## How WT11b uses this

- The generated client has `DailySet`, `DailySummary`, `Attempt`, `AttemptResult`, `StartedAttempt`, `Leaderboard`, `LeaderboardEntry`, `DisplayName` and the paths above.
- A daily puzzle is opened like any server puzzle with `GET /api/puzzles/{id}` (clues only); hints and progress sync use the existing routes unchanged.
- `playwright.auth.config.ts` should set `DAILY_DAYS_AHEAD: "2"` so the worker's start-up stock stays small.

## Steps
### A1 UTC day helpers

Pure functions for UTC days (`YYYY-MM-DD`) and the streak. Managers use them; `isDay` also validates the `day` query.

**Create `apps/server/src/managers/days.ts`**:

````ts
// UTC calendar days as `YYYY-MM-DD` strings, for daily puzzles (PRD FR-22). Days switch at
// 00:00 UTC, which has no daylight saving, so every day is 24 hours long.

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC day that contains `ms`. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 00:00 UTC at the start of `day`, in milliseconds. */
export function dayStart(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

/** The day `n` days after `day` (before it when `n` is negative). */
export function addDays(day: string, n: number): string {
  return utcDay(dayStart(day) + n * DAY_MS);
}

/** Whether `text` is a real calendar day written as `YYYY-MM-DD`. */
export function isDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const start = dayStart(text);
  return !Number.isNaN(start) && utcDay(start) === text;
}

/**
 * The current streak (PRD FR-24): consecutive days, ending today, with a finished daily. A streak
 * that ended yesterday still counts until today is over, so it doesn't drop to 0 at midnight.
 */
export function streakLength(days: Iterable<string>, today: string): number {
  const set = new Set(days);
  let day = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}
````

**Create `apps/server/src/managers/days.test.ts`**:

````ts
import { describe, expect, test } from "bun:test";
import { addDays, DAY_MS, dayStart, isDay, streakLength, utcDay } from "./days.ts";

describe("UTC days", () => {
  test("a day switches at 00:00 UTC", () => {
    const midnight = Date.UTC(2026, 9, 26);
    expect(utcDay(midnight - 1)).toBe("2026-10-25");
    expect(utcDay(midnight)).toBe("2026-10-26");
    expect(dayStart("2026-10-26")).toBe(midnight);
    expect(dayStart(addDays("2026-10-26", 1)) - dayStart("2026-10-26")).toBe(DAY_MS);
  });

  test("adds days across months, years and leap days", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
  });

  test("checks the YYYY-MM-DD form and that the day exists", () => {
    expect(isDay("2026-10-25")).toBe(true);
    expect(isDay("2028-02-29")).toBe(true);
    for (const bad of ["2027-02-29", "2026-13-01", "2026-10-32", "2026-1-5", "today", ""]) {
      expect(isDay(bad)).toBe(false);
    }
  });
});

describe("streakLength (FR-24)", () => {
  const today = "2026-10-25";

  test("counts consecutive days back from today", () => {
    expect(streakLength([], today)).toBe(0);
    expect(streakLength([today], today)).toBe(1);
    expect(streakLength(["2026-10-23", "2026-10-24", today], today)).toBe(3);
    expect(streakLength(["2026-10-22", "2026-10-24", today], today)).toBe(2);
  });

  test("a streak that ended yesterday lasts until today is over", () => {
    expect(streakLength(["2026-10-23", "2026-10-24"], today)).toBe(2);
    expect(streakLength(["2026-10-23"], today)).toBe(0);
  });

  test("runs across a month and a year end", () => {
    const days = ["2026-12-30", "2026-12-31", "2027-01-01"];
    expect(streakLength(days, "2027-01-01")).toBe(3);
    expect(streakLength(["2026-10-31", "2026-11-01"], "2026-11-01")).toBe(2);
  });

  test("ignores repeats and future days", () => {
    expect(streakLength([today, today, "2026-10-24", "2026-10-26"], today)).toBe(2);
  });
});
````

**Verify:** `bun test apps/server/src/managers/days.test.ts` (7 pass).

No commit yet: A1 and A2 go in one commit.

### A2 Migration 006, domain types and ports, puzzles hidden until release

The schema change, the domain types and the adapter interfaces for everything in this plan, and the release time on puzzles: `PuzzleRecord.releaseAt` is new and required, so every test that builds a `PuzzleRecord` by hand gets `releaseAt: null`. `PuzzleManager.saveDaily` stores a daily without seed or `meta`; `PuzzleManager.get` hides it until its release. `FakePuzzleRepository.listPublished` leaves out dailies like the SQL does, and the fakes for the new ports are added now (they are used from A4 on).

**Create `apps/server/src/adapters/db/migrations/006_daily.sql`**:

````sql
-- Daily puzzles (PRD FR-22), ranked attempts at them and leaderboards (FR-17, FR-23 to FR-25), and
-- the names players show on leaderboards. Times are milliseconds since the epoch.

-- Players can't see a puzzle before this time. Only daily puzzles have one (00:00 UTC on their
-- day); they are listed on their own, never with practice puzzles.
ALTER TABLE puzzles ADD COLUMN release_at INTEGER;

-- One puzzle per UTC day and size class, the same for everyone. The worker generates them days
-- ahead; `attempt` goes up when a generation fails, and the seed is derived from day, size,
-- attempt and a server secret.
CREATE TABLE dailies (
  day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  size INTEGER NOT NULL CHECK (size BETWEEN 1 AND 100),
  attempt INTEGER NOT NULL CHECK (attempt >= 0),
  job_id TEXT NOT NULL,
  -- Null until the worker has stored the puzzle.
  puzzle_id TEXT UNIQUE REFERENCES puzzles (id),
  generator_version TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (day, size)
) STRICT;

-- A player's one ranked attempt at a daily puzzle. It belongs to the account and goes with it
-- (NFR-6), which also takes it off every leaderboard.
CREATE TABLE attempts (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  puzzle_id TEXT NOT NULL REFERENCES puzzles (id),
  day TEXT NOT NULL,
  -- The leaderboard bucket (FR-23): width × height, and the puzzle's level (1 for all, FR-29).
  area INTEGER NOT NULL CHECK (area >= 1),
  level INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  -- Null while the attempt is being played.
  finished_at INTEGER,
  -- The ranked time; null while playing.
  time_ms INTEGER CHECK (time_ms >= 0),
  assisted INTEGER NOT NULL CHECK (assisted IN (0, 1)),
  -- 1 when the finished solve counts on leaderboards: no hint and a plausible time.
  ranked INTEGER NOT NULL CHECK (ranked IN (0, 1)),
  PRIMARY KEY (user_id, puzzle_id)
) STRICT;

CREATE INDEX attempts_by_puzzle ON attempts (puzzle_id, ranked, time_ms);
CREATE INDEX attempts_by_bucket ON attempts (area, level, ranked, time_ms);
CREATE INDEX attempts_by_user_day ON attempts (user_id, day);

-- The name a player chose to show on leaderboards; players without one show as anonymous. Public
-- on purpose, and deleted with the account (DECISIONS, "Display names"). Names are ASCII, so
-- NOCASE makes them unique ignoring case.
CREATE TABLE display_names (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 3 AND 20),
  updated_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX display_names_by_name ON display_names (name COLLATE NOCASE);
````

**Edit `apps/server/src/domain.ts`**: 3 replacements, in order.

1. Find:
````ts
  /** The player who submitted it; null for generated puzzles and once the account is deleted. */
  readonly creatorId: string | null;
}
````
   Replace with:
````ts
  /** The player who submitted it; null for generated puzzles and once the account is deleted. */
  readonly creatorId: string | null;
  /**
   * Players can't see the puzzle before this time (ms). Set only for daily puzzles: 00:00 UTC on
   * their day. Null for every other puzzle.
   */
  readonly releaseAt: number | null;
}
````

2. Find:
````ts
  readonly height: number;
  readonly seed: string;
}
````
   Replace with:
````ts
  readonly height: number;
  readonly seed: string;
  /** Set when the puzzle is a daily puzzle: its UTC day, `YYYY-MM-DD` (PRD FR-22). */
  readonly day?: string;
}
````

3. Find:
````ts
  readonly reports: readonly ReportRecord[];
}
````
   Replace with:
````ts
  readonly reports: readonly ReportRecord[];
}

/** The daily puzzle of one size class on one UTC day, the same for everyone (PRD FR-22). */
export interface DailyRecord {
  /** The UTC day, `YYYY-MM-DD`. */
  readonly day: string;
  /** The size class: the puzzle is `size` × `size`. */
  readonly size: number;
  /** Goes up by one each time generation fails; the seed is derived from day, size and this. */
  readonly attempt: number;
  /** The generation job for the current attempt. */
  readonly jobId: string;
  /** Null until the worker has stored the puzzle. */
  readonly puzzleId: string | null;
  /** The generator version that made the puzzle, so it can be regenerated (FR-10). */
  readonly generatorVersion: string | null;
  readonly createdAt: number;
}

/**
 * A player's one ranked attempt at a daily puzzle (PRD FR-17, FR-23, FR-25). The clock runs from
 * `startedAt` and never stops; the server checks the solution and the time.
 */
export interface AttemptRecord {
  readonly userId: string;
  readonly puzzleId: string;
  /** The daily's UTC day. */
  readonly day: string;
  /** Leaderboard bucket: width × height, and the puzzle's level (PRD FR-23, FR-29). */
  readonly area: number;
  readonly level: number;
  readonly startedAt: number;
  /** Null while the attempt is being played. */
  readonly finishedAt: number | null;
  /** The ranked time; null while playing. */
  readonly timeMs: number | null;
  /** A hint was shown during the attempt (PRD FR-12). */
  readonly assisted: boolean;
  /** Set when finished: the solve counts on leaderboards (no hint, a plausible time). */
  readonly ranked: boolean;
}

/** One row of a leaderboard. */
export interface LeaderboardEntry {
  /** 1 for the fastest. Ties go to whoever finished first. */
  readonly rank: number;
  readonly userId: string;
  /** The player's chosen display name, or null when they haven't picked one. */
  readonly name: string | null;
  readonly timeMs: number;
}

/** A slice of a leaderboard: the top rows, and the viewer's row with its neighbours. */
export interface LeaderboardSlice {
  /** How many players are on the board. */
  readonly total: number;
  /** The top `limit` rows, then the viewer's row and the rows either side of it; by rank. */
  readonly entries: readonly LeaderboardEntry[];
}
````

**Edit `apps/server/src/ports.ts`**: 2 replacements, in order.

1. Find:
````ts
  AccountTokenPurpose,
  AccountTokenRecord,
  Job,
  JobInput,
  JobResult,
  ProgressRecord,
  PuzzleRecord,
````
   Replace with:
````ts
  AccountTokenPurpose,
  AccountTokenRecord,
  AttemptRecord,
  DailyRecord,
  Job,
  JobInput,
  JobResult,
  LeaderboardSlice,
  ProgressRecord,
  PuzzleRecord,
````

2. Find:
````ts
  deleteForPuzzle(puzzleId: string): void;
}
````
   Replace with:
````ts
  deleteForPuzzle(puzzleId: string): void;
}

/** Daily puzzles, one row per UTC day and size class (PRD FR-22). */
export interface DailyRepository {
  get(day: string, size: number): DailyRecord | null;
  getByPuzzle(puzzleId: string): DailyRecord | null;
  /** The day's rows, smallest size first. */
  listDay(day: string): DailyRecord[];
  /** Stores a new row. Returns false, storing nothing, when the day and size already have one. */
  insert(record: DailyRecord): boolean;
  /**
   * Moves a row from attempt `fromAttempt` to the next attempt with a new job. Returns false when
   * the row is no longer at `fromAttempt` (another worker moved it first).
   */
  retry(day: string, size: number, fromAttempt: number, jobId: string): boolean;
  /**
   * Links the stored puzzle to the row whose job is `jobId`. Returns false when the row has moved
   * on to another job.
   */
  setPuzzle(
    day: string,
    size: number,
    jobId: string,
    puzzleId: string,
    generatorVersion: string | null,
  ): boolean;
  /**
   * Runs `fn` in one transaction of the database the jobs table is in, so claiming a row and
   * queueing its job happen together or not at all.
   */
  atomically<T>(fn: () => T): T;
}

/** Ranked attempts at daily puzzles, and the leaderboards built from them (PRD FR-23, FR-24). */
export interface AttemptRepository {
  get(userId: string, puzzleId: string): AttemptRecord | null;
  /** Stores a new attempt. Does nothing when the user already has one at this puzzle. */
  insert(record: AttemptRecord): void;
  /** Marks the attempt assisted unless it is finished. */
  markAssisted(userId: string, puzzleId: string): void;
  /**
   * Finishes an attempt that is still being played. Returns false when there is none (missing or
   * already finished).
   */
  finish(
    userId: string,
    puzzleId: string,
    result: { finishedAt: number; timeMs: number; ranked: boolean },
  ): boolean;
  /** The user's attempts on daily puzzles of `day`. */
  listForDay(userId: string, day: string): AttemptRecord[];
  /** Every day on which the user finished an attempt, ranked or not; any order. */
  finishedDays(userId: string): string[];
  /** The user's best ranked time in each bucket. */
  bests(userId: string): { area: number; level: number; timeMs: number }[];
  /** Ranked solves of one puzzle, fastest first: the top `limit` and `viewerId`'s neighbourhood. */
  puzzleBoard(puzzleId: string, viewerId: string | null, limit: number): LeaderboardSlice;
  /**
   * Each player's best ranked time in one bucket, fastest first: the top `limit` and `viewerId`'s
   * neighbourhood.
   */
  bucketBoard(
    area: number,
    level: number,
    viewerId: string | null,
    limit: number,
  ): LeaderboardSlice;
}

/** Names players chose to show on leaderboards. */
export interface DisplayNameRepository {
  get(userId: string): string | null;
  /**
   * Sets the user's name, or removes it when `name` is null. Returns false, changing nothing, when
   * another player has the same name (ignoring ASCII case).
   */
  set(userId: string, name: string | null, now: number): boolean;
}

/**
 * Seeds for daily puzzles: the same for the same day, size and attempt, and unguessable without
 * the server's secret (DECISIONS, "Daily puzzles").
 */
export interface DailySeeder {
  seed(day: string, size: number, attempt: number): string;
}
````

**Edit `apps/server/src/adapters/db/puzzle-repository.ts`**: 4 replacements, in order.

1. Find:
````ts
  created_at: number;
  creator_id: string | null;
};

const COLUMNS =
  "id, width, height, clues, seed, generator_version, level, origin, status, solution_key, trace_key, created_at, creator_id";

/** Puzzles in SQLite. Clues are stored as the wire format's clue string; only `meta.generator` is kept. */
````
   Replace with:
````ts
  created_at: number;
  creator_id: string | null;
  release_at: number | null;
};

const COLUMNS =
  "id, width, height, clues, seed, generator_version, level, origin, status, solution_key, trace_key, created_at, creator_id, release_at";

/** Puzzles in SQLite. Clues are stored as the wire format's clue string; only `meta.generator` is kept. */
````

2. Find:
````ts
  constructor(db: Database) {
    this.#insert = db.query<void, PuzzleRow>(
      `INSERT INTO puzzles (${COLUMNS}) VALUES ($id, $width, $height, $clues, $seed, $generator_version, $level, $origin, $status, $solution_key, $trace_key, $created_at, $creator_id) ON CONFLICT (id) DO NOTHING`,
    );
    this.#get = db.query<PuzzleRow, { id: string }>(
      `SELECT ${COLUMNS} FROM puzzles WHERE id = $id`,
    );
    this.#listPublished = db.query<PuzzleRow, { limit: number }>(
      `SELECT ${COLUMNS} FROM puzzles WHERE status = 'published' ORDER BY created_at DESC, id LIMIT $limit`,
    );
    this.#findByClues = db.query<PuzzleRow, { width: number; height: number; clues: string }>(
````
   Replace with:
````ts
  constructor(db: Database) {
    this.#insert = db.query<void, PuzzleRow>(
      `INSERT INTO puzzles (${COLUMNS}) VALUES ($id, $width, $height, $clues, $seed, $generator_version, $level, $origin, $status, $solution_key, $trace_key, $created_at, $creator_id, $release_at) ON CONFLICT (id) DO NOTHING`,
    );
    this.#get = db.query<PuzzleRow, { id: string }>(
      `SELECT ${COLUMNS} FROM puzzles WHERE id = $id`,
    );
    // Daily puzzles (the only ones with a release time) are listed on their own.
    this.#listPublished = db.query<PuzzleRow, { limit: number }>(
      `SELECT ${COLUMNS} FROM puzzles WHERE status = 'published' AND release_at IS NULL ORDER BY created_at DESC, id LIMIT $limit`,
    );
    this.#findByClues = db.query<PuzzleRow, { width: number; height: number; clues: string }>(
````

3. Find:
````ts
    created_at: r.createdAt,
    creator_id: r.creatorId,
  };
}
````
   Replace with:
````ts
    created_at: r.createdAt,
    creator_id: r.creatorId,
    release_at: r.releaseAt,
  };
}
````

4. Find:
````ts
    createdAt: row.created_at,
    creatorId: row.creator_id,
  };
}
````
   Replace with:
````ts
    createdAt: row.created_at,
    creatorId: row.creator_id,
    releaseAt: row.release_at,
  };
}
````

**Edit `apps/server/src/adapters/db/puzzle-repository.test.ts`**: 2 replacements, in order.

1. Find:
````ts
    createdAt,
    creatorId: null,
  };
  return r;
````
   Replace with:
````ts
    createdAt,
    creatorId: null,
    releaseAt: null,
  };
  return r;
````

2. Find:
````ts
  });

  test("findByClues finds the oldest puzzle with the same size and clues, published or not", () => {
    const repo = new SqlitePuzzleRepository(openDatabase(":memory:"));
````
   Replace with:
````ts
  });

  test("keeps a daily puzzle's release time and leaves it out of the list", () => {
    const repo = new SqlitePuzzleRepository(openDatabase(":memory:"));
    repo.insert(record("practice", 1));
    repo.insert({ ...record("daily", 2), releaseAt: 5000 });
    expect(repo.get("daily")?.releaseAt).toBe(5000);
    expect(repo.get("practice")?.releaseAt).toBeNull();
    expect(repo.listPublished(10).map((r) => r.id)).toEqual(["practice"]);
  });

  test("findByClues finds the oldest puzzle with the same size and clues, published or not", () => {
    const repo = new SqlitePuzzleRepository(openDatabase(":memory:"));
````

**Edit `apps/server/src/adapters/db/database.test.ts`**: 2 replacements, in order.

1. Find:
````ts
    expect(tables).toEqual([
      "account_tokens",
      "jobs",
      "progress",
````
   Replace with:
````ts
    expect(tables).toEqual([
      "account_tokens",
      "attempts",
      "dailies",
      "display_names",
      "jobs",
      "progress",
````

2. Find:
````ts
      .all();
    // 003 was set aside for hints, which needed no table.
    expect(versions).toEqual([{ version: 1 }, { version: 2 }, { version: 4 }, { version: 5 }]);
  });
````
   Replace with:
````ts
      .all();
    // 003 was set aside for hints, which needed no table.
    expect(versions).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
    ]);
  });
````

**Edit `apps/server/src/adapters/db/report-repository.test.ts`**: 1 replacement, in order.

1. Find:
````ts
      createdAt: 0,
      creatorId: null,
    });
  }
````
   Replace with:
````ts
      createdAt: 0,
      creatorId: null,
      releaseAt: null,
    });
  }
````

**Edit `apps/server/src/adapters/db/progress-repository.test.ts`**: 1 replacement, in order.

1. Find:
````ts
      createdAt: 0,
      creatorId: null,
    });
  }
````
   Replace with:
````ts
      createdAt: 0,
      creatorId: null,
      releaseAt: null,
    });
  }
````

**Edit `apps/server/src/managers/progress-manager.test.ts`**: 1 replacement, in order.

1. Find:
````ts
      createdAt: 0,
      creatorId: null,
    });
  }
````
   Replace with:
````ts
      createdAt: 0,
      creatorId: null,
      releaseAt: null,
    });
  }
````

**Edit `apps/server/src/managers/puzzle-manager.ts`**: 4 replacements, in order.

1. Find:
````ts
  async saveGenerated(id: string, generated: GeneratedPuzzle): Promise<string> {
    const { puzzle, solution, steps } = generated;
    return this.#save(id, parsePuzzle(puzzle), solution, steps, "generated", null);
  }
````
   Replace with:
````ts
  async saveGenerated(id: string, generated: GeneratedPuzzle): Promise<string> {
    const { puzzle, solution, steps } = generated;
    return this.#save(id, parsePuzzle(puzzle), solution, steps, "generated", null, null);
  }

  /**
   * Stores a generated daily puzzle (PRD FR-22) that players can't see before `releaseAt`. Its
   * seed and generator version are left out, since with them anyone could rebuild the solution
   * (DECISIONS, WT6 "Puzzle storage"); the daily's own record keeps them. Like `saveGenerated`
   * otherwise. Returns `id`.
   */
  async saveDaily(id: string, generated: GeneratedPuzzle, releaseAt: number): Promise<string> {
    const { puzzle, solution, steps } = generated;
    const { width, height, clues } = puzzle;
    const cluesOnly = parsePuzzle({ v: 1, width, height, clues });
    return this.#save(id, cluesOnly, solution, steps, "generated", null, releaseAt);
  }
````

2. Find:
````ts
    creatorId: string,
  ): Promise<string> {
    return this.#save(id, puzzle, solution, steps, "submitted", creatorId);
  }
````
   Replace with:
````ts
    creatorId: string,
  ): Promise<string> {
    return this.#save(id, puzzle, solution, steps, "submitted", creatorId, null);
  }
````

3. Find:
````ts
    origin: PuzzleOrigin,
    creatorId: string | null,
  ): Promise<string> {
    const { puzzles, blobs, clock } = this.#deps;
````
   Replace with:
````ts
    origin: PuzzleOrigin,
    creatorId: string | null,
    releaseAt: number | null,
  ): Promise<string> {
    const { puzzles, blobs, clock } = this.#deps;
````

4. Find:
````ts
      createdAt: clock.now(),
      creatorId,
    });
    return id;
  }

  /** A published puzzle, or null when there is none with this id. */
  get(id: string): PuzzleRecord | null {
    const record = this.#deps.puzzles.get(id);
    return record?.status === "published" ? record : null;
  }
````
   Replace with:
````ts
      createdAt: clock.now(),
      creatorId,
      releaseAt,
    });
    return id;
  }

  /**
   * A published puzzle that players may see, or null when there is none with this id. A daily
   * puzzle stays hidden until its release time (00:00 UTC on its day).
   */
  get(id: string): PuzzleRecord | null {
    const record = this.#deps.puzzles.get(id);
    if (record?.status !== "published") return null;
    if (record.releaseAt !== null && record.releaseAt > this.#deps.clock.now()) return null;
    return record;
  }
````

**Edit `apps/server/src/managers/puzzle-manager.test.ts`**: 1 replacement, in order.

1. Find:
````ts
});

describe("PuzzleManager for submitted puzzles", () => {
  test("saveSubmitted stores a published puzzle with its creator", async () => {
````
   Replace with:
````ts
});

describe("PuzzleManager for daily puzzles", () => {
  test("saveDaily keeps the seed and generator version out and hides the puzzle until release", async () => {
    const { puzzles, clock, manager } = setup();
    expect(await manager.saveDaily("d-1", GENERATED, 6000)).toBe("d-1");
    const stored = puzzles.get("d-1");
    expect(stored?.releaseAt).toBe(6000);
    expect(stored && serializePuzzle(stored.puzzle)).toEqual({
      v: 1,
      width: 2,
      height: 2,
      clues: "2222",
    });
    expect(manager.get("d-1")).toBeNull();
    expect(manager.getAny("d-1")?.id).toBe("d-1");
    clock.time = 6000;
    expect(manager.get("d-1")?.id).toBe("d-1");
    expect(manager.listRecent(10)).toEqual([]);
    expect(await manager.getSolution("d-1")).not.toBeNull();
  });
});

describe("PuzzleManager for submitted puzzles", () => {
  test("saveSubmitted stores a published puzzle with its creator", async () => {
````

**Edit `apps/server/src/test-support/fakes.ts`** (the practice-list filter, then fakes for the new ports used from step A4 on): 4 replacements, in order.

1. Find:
````ts
  AccountTokenPurpose,
  AccountTokenRecord,
  Job,
  ProgressRecord,
  PuzzleRecord,
````
   Replace with:
````ts
  AccountTokenPurpose,
  AccountTokenRecord,
  AttemptRecord,
  DailyRecord,
  Job,
  LeaderboardEntry,
  LeaderboardSlice,
  ProgressRecord,
  PuzzleRecord,
````

2. Find:
````ts
import type {
  AccountTokenRepository,
  CaptchaVerifier,
  Clock,
  JobEnd,
  JobQueue,
````
   Replace with:
````ts
import type {
  AccountTokenRepository,
  AttemptRepository,
  CaptchaVerifier,
  Clock,
  DailyRepository,
  DisplayNameRepository,
  JobEnd,
  JobQueue,
````

3. Find:
````ts
  listPublished(limit: number): PuzzleRecord[] {
    return [...this.records.values()]
      .filter((r) => r.status === "published")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
````
   Replace with:
````ts
  listPublished(limit: number): PuzzleRecord[] {
    return [...this.records.values()]
      .filter((r) => r.status === "published" && r.releaseAt === null)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
````

4. Find:
````ts
      .slice(0, limit);
  }
}
````
   Replace with:
````ts
      .slice(0, limit);
  }
}

export class FakeDailyRepository implements DailyRepository {
  readonly rows = new Map<string, DailyRecord>();

  get(day: string, size: number): DailyRecord | null {
    return this.rows.get(`${day}/${size}`) ?? null;
  }

  getByPuzzle(puzzleId: string): DailyRecord | null {
    return [...this.rows.values()].find((r) => r.puzzleId === puzzleId) ?? null;
  }

  listDay(day: string): DailyRecord[] {
    return [...this.rows.values()].filter((r) => r.day === day).sort((a, b) => a.size - b.size);
  }

  insert(record: DailyRecord): boolean {
    const key = `${record.day}/${record.size}`;
    if (this.rows.has(key)) return false;
    this.rows.set(key, record);
    return true;
  }

  retry(day: string, size: number, fromAttempt: number, jobId: string): boolean {
    const row = this.get(day, size);
    if (row === null || row.attempt !== fromAttempt || row.puzzleId !== null) return false;
    this.rows.set(`${day}/${size}`, { ...row, attempt: fromAttempt + 1, jobId });
    return true;
  }

  setPuzzle(
    day: string,
    size: number,
    jobId: string,
    puzzleId: string,
    generatorVersion: string | null,
  ): boolean {
    const row = this.get(day, size);
    if (row === null || row.jobId !== jobId || row.puzzleId !== null) return false;
    this.rows.set(`${day}/${size}`, { ...row, puzzleId, generatorVersion });
    return true;
  }

  atomically<T>(fn: () => T): T {
    return fn();
  }
}

/** Attempts in a Map, with the same ranking rules as the SQLite repository. */
export class FakeAttemptRepository implements AttemptRepository {
  readonly records = new Map<string, AttemptRecord>();

  constructor(private readonly names: DisplayNameRepository = new FakeDisplayNameRepository()) {}

  get(userId: string, puzzleId: string): AttemptRecord | null {
    return this.records.get(`${userId}/${puzzleId}`) ?? null;
  }

  insert(record: AttemptRecord): void {
    const key = `${record.userId}/${record.puzzleId}`;
    if (!this.records.has(key)) this.records.set(key, record);
  }

  markAssisted(userId: string, puzzleId: string): void {
    const a = this.get(userId, puzzleId);
    if (a !== null && a.finishedAt === null) this.insertOver({ ...a, assisted: true });
  }

  finish(
    userId: string,
    puzzleId: string,
    result: { finishedAt: number; timeMs: number; ranked: boolean },
  ): boolean {
    const a = this.get(userId, puzzleId);
    if (a === null || a.finishedAt !== null) return false;
    this.insertOver({ ...a, ...result });
    return true;
  }

  listForDay(userId: string, day: string): AttemptRecord[] {
    return this.#all().filter((a) => a.userId === userId && a.day === day);
  }

  finishedDays(userId: string): string[] {
    const days = this.#all().filter((a) => a.userId === userId && a.finishedAt !== null);
    return [...new Set(days.map((a) => a.day))];
  }

  bests(userId: string): { area: number; level: number; timeMs: number }[] {
    const best = new Map<string, { area: number; level: number; timeMs: number }>();
    for (const a of this.#ranked().filter((r) => r.userId === userId)) {
      const key = `${a.area}/${a.level}`;
      const old = best.get(key);
      if (old === undefined || a.timeMs < old.timeMs) {
        best.set(key, { area: a.area, level: a.level, timeMs: a.timeMs });
      }
    }
    return [...best.values()];
  }

  puzzleBoard(puzzleId: string, viewerId: string | null, limit: number): LeaderboardSlice {
    return this.#slice(
      this.#ranked().filter((a) => a.puzzleId === puzzleId),
      viewerId,
      limit,
    );
  }

  bucketBoard(
    area: number,
    level: number,
    viewerId: string | null,
    limit: number,
  ): LeaderboardSlice {
    const best = new Map<string, AttemptRecord & { timeMs: number; finishedAt: number }>();
    for (const a of this.#ranked().filter((r) => r.area === area && r.level === level)) {
      const old = best.get(a.userId);
      if (old === undefined || a.timeMs < old.timeMs) best.set(a.userId, a);
    }
    return this.#slice([...best.values()], viewerId, limit);
  }

  /** Replaces a stored attempt; tests use it to set up finished ones. */
  insertOver(record: AttemptRecord): void {
    this.records.set(`${record.userId}/${record.puzzleId}`, record);
  }

  #all(): AttemptRecord[] {
    return [...this.records.values()];
  }

  #ranked() {
    return this.#all().filter(
      (a): a is AttemptRecord & { timeMs: number; finishedAt: number } =>
        a.ranked && a.timeMs !== null && a.finishedAt !== null,
    );
  }

  #slice(
    rows: (AttemptRecord & { timeMs: number; finishedAt: number })[],
    viewerId: string | null,
    limit: number,
  ): LeaderboardSlice {
    const board: LeaderboardEntry[] = rows
      .sort(
        (a, b) =>
          a.timeMs - b.timeMs ||
          a.finishedAt - b.finishedAt ||
          (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
      )
      .map((a, i) => ({
        rank: i + 1,
        userId: a.userId,
        name: this.names.get(a.userId),
        timeMs: a.timeMs,
      }));
    const mine = board.find((e) => e.userId === viewerId)?.rank ?? Number.NaN;
    return {
      total: board.length,
      entries: board.filter((e) => e.rank <= limit || Math.abs(e.rank - mine) <= 1),
    };
  }
}

export class FakeDisplayNameRepository implements DisplayNameRepository {
  readonly names = new Map<string, string>();

  get(userId: string): string | null {
    return this.names.get(userId) ?? null;
  }

  set(userId: string, name: string | null, _now: number): boolean {
    if (name === null) {
      this.names.delete(userId);
      return true;
    }
    for (const [other, taken] of this.names) {
      if (other !== userId && taken.toLowerCase() === name.toLowerCase()) return false;
    }
    this.names.set(userId, name);
    return true;
  }
}

/** Daily seeds that are easy to read in tests. */
export const fakeSeeds = {
  seed: (day: string, size: number, attempt: number) => `${day}/${size}/${attempt}`,
};

/** For job runs that never meet a daily puzzle. */
export const noDailies = {
  complete: async (): Promise<void> => {
    throw new Error("unexpected daily puzzle");
  },
};
````

**Verify:** `bun run check`.

**Commit:** `feat(server): store daily puzzles hidden until their day`

### A3 Adapters: daily, attempt and display name repositories, daily seeds

SQLite repositories for the three new tables, and the HMAC seed adapter. Leaderboards are one query each: a `board` CTE ranked with `ROW_NUMBER() OVER (ORDER BY time_ms, finished_at, user_id)`, sliced to the top `$limit` plus the viewer's rank ±1 (the shared `SLICE` SQL). The bucket board first takes each player's best with `MIN(time_ms)`; SQLite takes the bare `finished_at` from that same row. `SqliteDailyRepository.atomically` runs a function in one immediate transaction; the scheduler uses it to claim a row and queue its job together.

**Create `apps/server/src/adapters/db/daily-repository.ts`**:

````ts
import type { Database } from "bun:sqlite";
import type { DailyRecord } from "../../domain.ts";
import type { DailyRepository } from "../../ports.ts";

// A type alias, not an interface, so it satisfies bun:sqlite's binding type.
type DailyRow = {
  day: string;
  size: number;
  attempt: number;
  job_id: string;
  puzzle_id: string | null;
  generator_version: string | null;
  created_at: number;
};

const COLUMNS = "day, size, attempt, job_id, puzzle_id, generator_version, created_at";

/** Daily puzzles in SQLite, one row per UTC day and size class. */
export class SqliteDailyRepository implements DailyRepository {
  readonly #db: Database;
  readonly #get;
  readonly #getByPuzzle;
  readonly #listDay;
  readonly #insert;
  readonly #retry;
  readonly #setPuzzle;

  constructor(db: Database) {
    this.#db = db;
    this.#get = db.query<DailyRow, { day: string; size: number }>(
      `SELECT ${COLUMNS} FROM dailies WHERE day = $day AND size = $size`,
    );
    this.#getByPuzzle = db.query<DailyRow, { puzzle: string }>(
      `SELECT ${COLUMNS} FROM dailies WHERE puzzle_id = $puzzle`,
    );
    this.#listDay = db.query<DailyRow, { day: string }>(
      `SELECT ${COLUMNS} FROM dailies WHERE day = $day ORDER BY size`,
    );
    this.#insert = db.query<void, DailyRow>(
      `INSERT INTO dailies (${COLUMNS}) VALUES ($day, $size, $attempt, $job_id, $puzzle_id, $generator_version, $created_at) ON CONFLICT (day, size) DO NOTHING`,
    );
    this.#retry = db.query<void, { day: string; size: number; from: number; job: string }>(
      `UPDATE dailies SET attempt = $from + 1, job_id = $job
       WHERE day = $day AND size = $size AND attempt = $from AND puzzle_id IS NULL`,
    );
    this.#setPuzzle = db.query<
      void,
      { day: string; size: number; job: string; puzzle: string; version: string | null }
    >(
      `UPDATE dailies SET puzzle_id = $puzzle, generator_version = $version
       WHERE day = $day AND size = $size AND job_id = $job AND puzzle_id IS NULL`,
    );
  }

  get(day: string, size: number): DailyRecord | null {
    const row = this.#get.get({ day, size });
    return row === null ? null : fromRow(row);
  }

  getByPuzzle(puzzleId: string): DailyRecord | null {
    const row = this.#getByPuzzle.get({ puzzle: puzzleId });
    return row === null ? null : fromRow(row);
  }

  listDay(day: string): DailyRecord[] {
    return this.#listDay.all({ day }).map(fromRow);
  }

  insert(record: DailyRecord): boolean {
    return (
      this.#insert.run({
        day: record.day,
        size: record.size,
        attempt: record.attempt,
        job_id: record.jobId,
        puzzle_id: record.puzzleId,
        generator_version: record.generatorVersion,
        created_at: record.createdAt,
      }).changes === 1
    );
  }

  retry(day: string, size: number, fromAttempt: number, jobId: string): boolean {
    return this.#retry.run({ day, size, from: fromAttempt, job: jobId }).changes === 1;
  }

  setPuzzle(
    day: string,
    size: number,
    jobId: string,
    puzzleId: string,
    generatorVersion: string | null,
  ): boolean {
    const result = this.#setPuzzle.run({
      day,
      size,
      job: jobId,
      puzzle: puzzleId,
      version: generatorVersion,
    });
    return result.changes === 1;
  }

  atomically<T>(fn: () => T): T {
    return this.#db.transaction(fn).immediate();
  }
}

function fromRow(row: DailyRow): DailyRecord {
  return {
    day: row.day,
    size: row.size,
    attempt: row.attempt,
    jobId: row.job_id,
    puzzleId: row.puzzle_id,
    generatorVersion: row.generator_version,
    createdAt: row.created_at,
  };
}
````

**Create `apps/server/src/adapters/db/daily-repository.test.ts`**:

````ts
import { describe, expect, test } from "bun:test";
import { createPuzzle } from "@loophole/core";
import type { DailyRecord } from "../../domain.ts";
import { SqliteDailyRepository } from "./daily-repository.ts";
import { openDatabase } from "./database.ts";
import { SqlitePuzzleRepository } from "./puzzle-repository.ts";

function setup() {
  const db = openDatabase(":memory:");
  const puzzles = new SqlitePuzzleRepository(db);
  puzzles.insert({
    id: "j-1",
    puzzle: createPuzzle(2, 2),
    origin: "generated",
    status: "published",
    level: 1,
    solutionKey: "puzzles/j-1/solution.txt",
    traceKey: null,
    createdAt: 0,
    creatorId: null,
    releaseAt: 100,
  });
  return new SqliteDailyRepository(db);
}

const row = (changes: Partial<DailyRecord> = {}): DailyRecord => ({
  day: "2026-10-25",
  size: 7,
  attempt: 0,
  jobId: "j-1",
  puzzleId: null,
  generatorVersion: null,
  createdAt: 10,
  ...changes,
});

describe("SqliteDailyRepository", () => {
  test("insert stores one row per day and size; get and listDay read them back", () => {
    const repo = setup();
    expect(repo.insert(row())).toBe(true);
    expect(repo.insert(row({ jobId: "j-other" }))).toBe(false);
    expect(repo.insert(row({ size: 10, jobId: "j-2" }))).toBe(true);
    expect(repo.get("2026-10-25", 7)).toEqual(row());
    expect(repo.get("2026-10-26", 7)).toBeNull();
    expect(repo.listDay("2026-10-25").map((r) => r.size)).toEqual([7, 10]);
    expect(repo.listDay("2026-10-24")).toEqual([]);
  });

  test("retry moves to the next attempt only from the attempt named", () => {
    const repo = setup();
    repo.insert(row());
    expect(repo.retry("2026-10-25", 7, 0, "j-2")).toBe(true);
    expect(repo.retry("2026-10-25", 7, 0, "j-3")).toBe(false);
    expect(repo.get("2026-10-25", 7)).toMatchObject({ attempt: 1, jobId: "j-2" });
  });

  test("setPuzzle links the puzzle only while the row still names that job", () => {
    const repo = setup();
    repo.insert(row());
    expect(repo.setPuzzle("2026-10-25", 7, "j-old", "j-1", "1")).toBe(false);
    expect(repo.setPuzzle("2026-10-25", 7, "j-1", "j-1", "1")).toBe(true);
    expect(repo.get("2026-10-25", 7)).toMatchObject({ puzzleId: "j-1", generatorVersion: "1" });
    expect(repo.getByPuzzle("j-1")?.size).toBe(7);
    expect(repo.getByPuzzle("nope")).toBeNull();
    // A stocked day is never moved to a new attempt.
    expect(repo.retry("2026-10-25", 7, 0, "j-2")).toBe(false);
  });

  test("atomically keeps all of its writes or none", () => {
    const repo = setup();
    expect(repo.atomically(() => repo.insert(row()))).toBe(true);
    expect(() =>
      repo.atomically(() => {
        repo.insert(row({ size: 10, jobId: "j-2" }));
        throw new Error("queue refused");
      }),
    ).toThrow("queue refused");
    expect(repo.get("2026-10-25", 10)).toBeNull();
    expect(repo.get("2026-10-25", 7)).not.toBeNull();
  });
});
````

**Create `apps/server/src/adapters/db/attempt-repository.ts`**:

````ts
import type { Database } from "bun:sqlite";
import type { AttemptRecord, LeaderboardSlice } from "../../domain.ts";
import type { AttemptRepository } from "../../ports.ts";

// A type alias, not an interface, so it satisfies bun:sqlite's binding type.
type AttemptRow = {
  user_id: string;
  puzzle_id: string;
  day: string;
  area: number;
  level: number;
  started_at: number;
  finished_at: number | null;
  time_ms: number | null;
  assisted: number;
  ranked: number;
};

type BoardRow = {
  user_id: string;
  time_ms: number;
  name: string | null;
  rank: number;
  total: number;
};

const COLUMNS =
  "user_id, puzzle_id, day, area, level, started_at, finished_at, time_ms, assisted, ranked";

/**
 * Picks the top `$limit` rows of a ranked `board` (user_id, time_ms, name, rank) and the rows
 * next to `$viewer`'s, with the board's size on every row.
 */
const SLICE = `
  mine AS (SELECT rank FROM board WHERE user_id = $viewer)
  SELECT user_id, time_ms, name, rank, (SELECT count(*) FROM board) AS total
  FROM board
  WHERE rank <= $limit
     OR rank BETWEEN (SELECT rank FROM mine) - 1 AND (SELECT rank FROM mine) + 1
  ORDER BY rank`;

/** Ranked attempts in SQLite, and leaderboards ranked with window functions. */
export class SqliteAttemptRepository implements AttemptRepository {
  readonly #get;
  readonly #insert;
  readonly #markAssisted;
  readonly #finish;
  readonly #listForDay;
  readonly #finishedDays;
  readonly #bests;
  readonly #puzzleBoard;
  readonly #bucketBoard;

  constructor(db: Database) {
    this.#get = db.query<AttemptRow, { user: string; puzzle: string }>(
      `SELECT ${COLUMNS} FROM attempts WHERE user_id = $user AND puzzle_id = $puzzle`,
    );
    this.#insert = db.query<void, AttemptRow>(
      `INSERT INTO attempts (${COLUMNS}) VALUES ($user_id, $puzzle_id, $day, $area, $level, $started_at, $finished_at, $time_ms, $assisted, $ranked)
       ON CONFLICT (user_id, puzzle_id) DO NOTHING`,
    );
    this.#markAssisted = db.query<void, { user: string; puzzle: string }>(
      "UPDATE attempts SET assisted = 1 WHERE user_id = $user AND puzzle_id = $puzzle AND finished_at IS NULL",
    );
    this.#finish = db.query<
      void,
      { user: string; puzzle: string; at: number; time: number; ranked: number }
    >(
      `UPDATE attempts SET finished_at = $at, time_ms = $time, ranked = $ranked
       WHERE user_id = $user AND puzzle_id = $puzzle AND finished_at IS NULL`,
    );
    this.#listForDay = db.query<AttemptRow, { user: string; day: string }>(
      `SELECT ${COLUMNS} FROM attempts WHERE user_id = $user AND day = $day ORDER BY area`,
    );
    this.#finishedDays = db.query<{ day: string }, { user: string }>(
      "SELECT DISTINCT day FROM attempts WHERE user_id = $user AND finished_at IS NOT NULL",
    );
    this.#bests = db.query<{ area: number; level: number; time_ms: number }, { user: string }>(
      `SELECT area, level, MIN(time_ms) AS time_ms FROM attempts
       WHERE user_id = $user AND ranked = 1 GROUP BY area, level ORDER BY area, level`,
    );
    this.#puzzleBoard = db.query<
      BoardRow,
      { puzzle: string; viewer: string | null; limit: number }
    >(
      `WITH board AS (
         SELECT a.user_id, a.time_ms, d.name,
                ROW_NUMBER() OVER (ORDER BY a.time_ms, a.finished_at, a.user_id) AS rank
         FROM attempts a LEFT JOIN display_names d ON d.user_id = a.user_id
         WHERE a.puzzle_id = $puzzle AND a.ranked = 1
       ), ${SLICE}`,
    );
    // SQLite takes a bare column next to MIN() from the row that has the minimum, so
    // `finished_at` is when the player set their best time.
    this.#bucketBoard = db.query<
      BoardRow,
      { area: number; level: number; viewer: string | null; limit: number }
    >(
      `WITH best AS (
         SELECT user_id, MIN(time_ms) AS time_ms, finished_at FROM attempts
         WHERE area = $area AND level = $level AND ranked = 1
         GROUP BY user_id
       ), board AS (
         SELECT b.user_id, b.time_ms, d.name,
                ROW_NUMBER() OVER (ORDER BY b.time_ms, b.finished_at, b.user_id) AS rank
         FROM best b LEFT JOIN display_names d ON d.user_id = b.user_id
       ), ${SLICE}`,
    );
  }

  get(userId: string, puzzleId: string): AttemptRecord | null {
    const row = this.#get.get({ user: userId, puzzle: puzzleId });
    return row === null ? null : fromRow(row);
  }

  insert(r: AttemptRecord): void {
    this.#insert.run({
      user_id: r.userId,
      puzzle_id: r.puzzleId,
      day: r.day,
      area: r.area,
      level: r.level,
      started_at: r.startedAt,
      finished_at: r.finishedAt,
      time_ms: r.timeMs,
      assisted: r.assisted ? 1 : 0,
      ranked: r.ranked ? 1 : 0,
    });
  }

  markAssisted(userId: string, puzzleId: string): void {
    this.#markAssisted.run({ user: userId, puzzle: puzzleId });
  }

  finish(
    userId: string,
    puzzleId: string,
    result: { finishedAt: number; timeMs: number; ranked: boolean },
  ): boolean {
    const { changes } = this.#finish.run({
      user: userId,
      puzzle: puzzleId,
      at: result.finishedAt,
      time: result.timeMs,
      ranked: result.ranked ? 1 : 0,
    });
    return changes === 1;
  }

  listForDay(userId: string, day: string): AttemptRecord[] {
    return this.#listForDay.all({ user: userId, day }).map(fromRow);
  }

  finishedDays(userId: string): string[] {
    return this.#finishedDays.all({ user: userId }).map((r) => r.day);
  }

  bests(userId: string): { area: number; level: number; timeMs: number }[] {
    return this.#bests
      .all({ user: userId })
      .map((r) => ({ area: r.area, level: r.level, timeMs: r.time_ms }));
  }

  puzzleBoard(puzzleId: string, viewerId: string | null, limit: number): LeaderboardSlice {
    return toSlice(this.#puzzleBoard.all({ puzzle: puzzleId, viewer: viewerId, limit }));
  }

  bucketBoard(
    area: number,
    level: number,
    viewerId: string | null,
    limit: number,
  ): LeaderboardSlice {
    return toSlice(this.#bucketBoard.all({ area, level, viewer: viewerId, limit }));
  }
}

function toSlice(rows: BoardRow[]): LeaderboardSlice {
  return {
    total: rows[0]?.total ?? 0,
    entries: rows.map((r) => ({
      rank: r.rank,
      userId: r.user_id,
      name: r.name,
      timeMs: r.time_ms,
    })),
  };
}

function fromRow(row: AttemptRow): AttemptRecord {
  return {
    userId: row.user_id,
    puzzleId: row.puzzle_id,
    day: row.day,
    area: row.area,
    level: row.level,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    timeMs: row.time_ms,
    assisted: row.assisted === 1,
    ranked: row.ranked === 1,
  };
}
````

**Create `apps/server/src/adapters/db/attempt-repository.test.ts`**:

````ts
import { describe, expect, test } from "bun:test";
import { createPuzzle } from "@loophole/core";
import type { AttemptRecord } from "../../domain.ts";
import { SqliteAttemptRepository } from "./attempt-repository.ts";
import { openDatabase } from "./database.ts";
import { SqliteDisplayNameRepository } from "./display-name-repository.ts";
import { SqlitePuzzleRepository } from "./puzzle-repository.ts";
import { SqliteUserRepository } from "./user-repository.ts";

const USERS = ["u1", "u2", "u3", "u4", "u5", "u6"];

function setup() {
  const db = openDatabase(":memory:");
  const users = new SqliteUserRepository(db);
  for (const id of USERS) {
    users.insert({
      id,
      email: `${id}@example.com`,
      passwordHash: "h",
      emailVerifiedAt: 1,
      isAdmin: false,
      createdAt: 0,
    });
  }
  const puzzles = new SqlitePuzzleRepository(db);
  for (const id of ["p1", "p2", "p3"]) {
    puzzles.insert({
      id,
      puzzle: createPuzzle(2, 2),
      origin: "generated",
      status: "published",
      level: 1,
      solutionKey: `puzzles/${id}/solution.txt`,
      traceKey: null,
      createdAt: 0,
      creatorId: null,
      releaseAt: 0,
    });
  }
  return {
    db,
    users,
    names: new SqliteDisplayNameRepository(db),
    repo: new SqliteAttemptRepository(db),
  };
}

function attempt(changes: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    userId: "u1",
    puzzleId: "p1",
    day: "2026-10-25",
    area: 49,
    level: 1,
    startedAt: 1000,
    finishedAt: null,
    timeMs: null,
    assisted: false,
    ranked: false,
    ...changes,
  };
}

/** A finished attempt; `ranked` unless told otherwise. */
function solved(userId: string, timeMs: number, changes: Partial<AttemptRecord> = {}) {
  return attempt({ userId, timeMs, finishedAt: 1000 + timeMs, ranked: true, ...changes });
}

describe("SqliteAttemptRepository", () => {
  test("insert keeps the first attempt; get reads it back", () => {
    const { repo } = setup();
    expect(repo.get("u1", "p1")).toBeNull();
    repo.insert(attempt());
    repo.insert(attempt({ startedAt: 5000 }));
    expect(repo.get("u1", "p1")).toEqual(attempt());
  });

  test("markAssisted and finish change only an attempt still being played", () => {
    const { repo } = setup();
    repo.insert(attempt());
    repo.markAssisted("u1", "p1");
    expect(repo.finish("u1", "p1", { finishedAt: 9000, timeMs: 8000, ranked: false })).toBe(true);
    expect(repo.get("u1", "p1")).toEqual(
      attempt({ assisted: true, finishedAt: 9000, timeMs: 8000 }),
    );
    expect(repo.finish("u1", "p1", { finishedAt: 9500, timeMs: 1, ranked: true })).toBe(false);
    expect(repo.finish("u2", "p1", { finishedAt: 9500, timeMs: 1, ranked: true })).toBe(false);
    repo.insert(attempt({ puzzleId: "p2" }));
    repo.finish("u1", "p2", { finishedAt: 9000, timeMs: 8000, ranked: true });
    repo.markAssisted("u1", "p2");
    expect(repo.get("u1", "p2")?.assisted).toBe(false);
  });

  test("lists a day's attempts, the days with a finished attempt and the best ranked times", () => {
    const { repo } = setup();
    repo.insert(solved("u1", 9000, { puzzleId: "p1", day: "2026-10-24" }));
    repo.insert(solved("u1", 7000, { puzzleId: "p2", day: "2026-10-25" }));
    repo.insert(attempt({ puzzleId: "p3", day: "2026-10-26", area: 100 }));
    expect(repo.listForDay("u1", "2026-10-25").map((a) => a.puzzleId)).toEqual(["p2"]);
    expect(repo.finishedDays("u1").sort()).toEqual(["2026-10-24", "2026-10-25"]);
    expect(repo.bests("u1")).toEqual([{ area: 49, level: 1, timeMs: 7000 }]);
    expect(repo.bests("u2")).toEqual([]);
  });

  test("a puzzle's board ranks ranked solves by time, then by who finished first (FR-23)", () => {
    const { repo, names } = setup();
    repo.insert(solved("u1", 5000));
    repo.insert(solved("u2", 3000));
    repo.insert(solved("u3", 4000, { finishedAt: 9000 }));
    repo.insert(solved("u4", 4000, { finishedAt: 8000 }));
    repo.insert(solved("u5", 1000, { ranked: false, assisted: true }));
    repo.insert(attempt({ userId: "u6" }));
    names.set("u2", "tsuru", 0);
    expect(repo.puzzleBoard("p1", null, 10)).toEqual({
      total: 4,
      entries: [
        { rank: 1, userId: "u2", name: "tsuru", timeMs: 3000 },
        { rank: 2, userId: "u4", name: null, timeMs: 4000 },
        { rank: 3, userId: "u3", name: null, timeMs: 4000 },
        { rank: 4, userId: "u1", name: null, timeMs: 5000 },
      ],
    });
    expect(repo.puzzleBoard("p2", "u1", 10)).toEqual({ total: 0, entries: [] });
  });

  test("a slice holds the top rows and the viewer's neighbours, even outside the top", () => {
    const { repo } = setup();
    USERS.forEach((u, i) => {
      repo.insert(solved(u, 1000 * (i + 1)));
    });
    const ranks = (viewer: string | null, limit: number) =>
      repo.puzzleBoard("p1", viewer, limit).entries.map((e) => e.rank);
    expect(ranks(null, 2)).toEqual([1, 2]);
    expect(ranks("u5", 2)).toEqual([1, 2, 4, 5, 6]);
    expect(ranks("u6", 1)).toEqual([1, 5, 6]);
    expect(ranks("u2", 2)).toEqual([1, 2, 3]);
    expect(repo.puzzleBoard("p1", "u5", 2).total).toBe(6);
  });

  test("a bucket's board takes each player's best ranked time across its puzzles", () => {
    const { repo } = setup();
    repo.insert(solved("u1", 5000, { puzzleId: "p1" }));
    repo.insert(solved("u1", 2000, { puzzleId: "p2" }));
    repo.insert(solved("u2", 3000, { puzzleId: "p1" }));
    repo.insert(solved("u3", 1000, { puzzleId: "p3", area: 100 }));
    repo.insert(solved("u4", 500, { puzzleId: "p2", ranked: false }));
    expect(repo.bucketBoard(49, 1, "u2", 10)).toEqual({
      total: 2,
      entries: [
        { rank: 1, userId: "u1", name: null, timeMs: 2000 },
        { rank: 2, userId: "u2", name: null, timeMs: 3000 },
      ],
    });
    expect(repo.bucketBoard(49, 2, null, 10).total).toBe(0);
  });

  test("deleting the account deletes its attempts, taking it off every board (NFR-6)", () => {
    const { db, repo } = setup();
    repo.insert(solved("u1", 5000));
    repo.insert(solved("u2", 6000));
    db.run("DELETE FROM users WHERE id = 'u1'");
    expect(repo.get("u1", "p1")).toBeNull();
    expect(repo.puzzleBoard("p1", null, 10).entries.map((e) => e.userId)).toEqual(["u2"]);
  });
});
````

**Create `apps/server/src/adapters/db/display-name-repository.ts`**:

````ts
import type { Database } from "bun:sqlite";
import type { DisplayNameRepository } from "../../ports.ts";

/** Leaderboard names in SQLite; unique ignoring ASCII case. */
export class SqliteDisplayNameRepository implements DisplayNameRepository {
  readonly #get;
  readonly #upsert;
  readonly #delete;

  constructor(db: Database) {
    this.#get = db.query<{ name: string }, { user: string }>(
      "SELECT name FROM display_names WHERE user_id = $user",
    );
    this.#upsert = db.query<void, { user: string; name: string; now: number }>(
      `INSERT INTO display_names (user_id, name, updated_at) VALUES ($user, $name, $now)
       ON CONFLICT (user_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
    );
    this.#delete = db.query<void, { user: string }>(
      "DELETE FROM display_names WHERE user_id = $user",
    );
  }

  get(userId: string): string | null {
    return this.#get.get({ user: userId })?.name ?? null;
  }

  set(userId: string, name: string | null, now: number): boolean {
    if (name === null) {
      this.#delete.run({ user: userId });
      return true;
    }
    try {
      this.#upsert.run({ user: userId, name, now });
      return true;
    } catch (err) {
      // The unique index on the name: another player has it.
      if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) return false;
      throw err;
    }
  }
}
````

**Create `apps/server/src/adapters/db/display-name-repository.test.ts`**:

````ts
import { describe, expect, test } from "bun:test";
import { openDatabase } from "./database.ts";
import { SqliteDisplayNameRepository } from "./display-name-repository.ts";
import { SqliteUserRepository } from "./user-repository.ts";

function setup() {
  const db = openDatabase(":memory:");
  const users = new SqliteUserRepository(db);
  for (const id of ["u1", "u2"]) {
    users.insert({
      id,
      email: `${id}@example.com`,
      passwordHash: "h",
      emailVerifiedAt: null,
      isAdmin: false,
      createdAt: 0,
    });
  }
  return { db, repo: new SqliteDisplayNameRepository(db) };
}

describe("SqliteDisplayNameRepository", () => {
  test("sets, replaces and removes a name", () => {
    const { repo } = setup();
    expect(repo.get("u1")).toBeNull();
    expect(repo.set("u1", "kuroneko", 1)).toBe(true);
    expect(repo.get("u1")).toBe("kuroneko");
    expect(repo.set("u1", "tsuru", 2)).toBe(true);
    expect(repo.get("u1")).toBe("tsuru");
    expect(repo.set("u1", null, 3)).toBe(true);
    expect(repo.get("u1")).toBeNull();
  });

  test("a name another player has is refused, ignoring case", () => {
    const { repo } = setup();
    repo.set("u1", "Kuroneko", 1);
    expect(repo.set("u2", "kuroNEKO", 2)).toBe(false);
    expect(repo.get("u2")).toBeNull();
    expect(repo.set("u1", "kuroneko", 3)).toBe(true);
  });

  test("deleting the account deletes its name and frees it (NFR-6)", () => {
    const { db, repo } = setup();
    repo.set("u1", "kuroneko", 1);
    db.run("DELETE FROM users WHERE id = 'u1'");
    expect(repo.get("u1")).toBeNull();
    expect(repo.set("u2", "kuroneko", 2)).toBe(true);
  });
});
````

**Create `apps/server/src/adapters/daily-seeds.ts`**:

````ts
import { createHmac } from "node:crypto";
import type { DailySeeder } from "../ports.ts";

/**
 * Daily seeds from an HMAC-SHA256 of the day, size and attempt under the server's secret
 * (`DAILY_SEED_SECRET`): reproducible by whoever holds the secret, unguessable by anyone else.
 */
export function hmacDailySeeder(secret: string): DailySeeder {
  return {
    seed: (day, size, attempt) =>
      createHmac("sha256", secret)
        .update(`loophole-daily:${day}:${size}:${attempt}`)
        .digest("base64url"),
  };
}
````

**Create `apps/server/src/adapters/daily-seeds.test.ts`**:

````ts
import { describe, expect, test } from "bun:test";
import { MAX_SEED_LENGTH } from "@loophole/core";
import { hmacDailySeeder } from "./daily-seeds.ts";

describe("hmacDailySeeder", () => {
  test("is the same for the same day, size, attempt and secret, and differs otherwise", () => {
    const seeds = hmacDailySeeder("secret-one-for-tests");
    const seed = seeds.seed("2026-10-25", 7, 0);
    expect(seeds.seed("2026-10-25", 7, 0)).toBe(seed);
    expect(seed.length).toBeLessThanOrEqual(MAX_SEED_LENGTH);
    const others = [
      seeds.seed("2026-10-26", 7, 0),
      seeds.seed("2026-10-25", 10, 0),
      seeds.seed("2026-10-25", 7, 1),
      hmacDailySeeder("secret-two-for-tests").seed("2026-10-25", 7, 0),
    ];
    expect(new Set([seed, ...others]).size).toBe(5);
  });
});
````

**Verify:** `bun test apps/server/src/adapters && bun run check`.

**Commit:** `feat(server): repositories for dailies, ranked attempts and display names`

### A4 Managers: dailies, the scheduler, ranked attempts, leaderboards, display names

The business logic, all on fakes in the tests. `test-support/daily.ts` holds `SMALL_DAILY` (the 2×2 all-2s puzzle as a job makes it, with a seed that must never come back out) and `storeDaily`, which the manager and route tests use to put a daily in place. `JobManager.enqueueDaily` queues a daily's job under the id the scheduler chose, skipping the queue cap; `DailyStockManager` claims the row and queues the job inside `dailies.atomically`, so another worker never sees a claimed row without its job.

**Edit `apps/server/src/managers/errors.ts`**: 1 replacement, in order.

1. Find:
````ts
    this.name = "PuzzleNotFoundError";
  }
}
````
   Replace with:
````ts
    this.name = "PuzzleNotFoundError";
  }
}

/** There is no daily puzzle here: an unknown day or puzzle, a day still to come, or a practice puzzle. */
export class DailyNotFoundError extends Error {
  constructor(message = "No daily puzzle here.") {
    super(message);
    this.name = "DailyNotFoundError";
  }
}

/** A ranked attempt can only be started on the daily's own UTC day. */
export class DailyEndedError extends Error {
  constructor() {
    super("This daily puzzle's day is over; it can still be played, but not ranked.");
    this.name = "DailyEndedError";
  }
}

/** The player has no ranked attempt at this puzzle to finish. */
export class AttemptNotFoundError extends Error {
  constructor() {
    super("Start a ranked attempt before sending a solution.");
    this.name = "AttemptNotFoundError";
  }
}

/** A ranked attempt's board is not the puzzle's solution. */
export class WrongSolutionError extends Error {
  constructor() {
    super("That board is not the solution.");
    this.name = "WrongSolutionError";
  }
}

/** The display name is reserved or not allowed. */
export class InvalidDisplayNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDisplayNameError";
  }
}

/** Another player already shows this display name. */
export class DisplayNameTakenError extends Error {
  constructor() {
    super("Another player already has that name.");
    this.name = "DisplayNameTakenError";
  }
}
````

**Edit `apps/server/src/managers/job-manager.ts`**: 2 replacements, in order.

1. Find:
````ts
import type { PuzzleWireV1 } from "@loophole/core";
import type { Job, JobInput } from "../domain.ts";
import type { Clock, JobQueue } from "../ports.ts";
import { QueueFullError } from "./errors.ts";
````
   Replace with:
````ts
import type { PuzzleWireV1 } from "@loophole/core";
import type { GenerateInput, Job, JobInput } from "../domain.ts";
import type { Clock, JobQueue } from "../ports.ts";
import { QueueFullError } from "./errors.ts";
````

2. Find:
````ts
  }

  get(id: string): Job | null {
    return this.#deps.jobs.get(id);
````
   Replace with:
````ts
  }

  /**
   * Queues the generation of a daily puzzle under job id `id` (PRD FR-22). Never refused for a
   * full queue: the scheduler's few jobs a day must not wait behind players' jobs.
   */
  enqueueDaily(id: string, input: GenerateInput & { readonly day: string }): Job {
    const { jobs, clock } = this.#deps;
    return jobs.enqueue({ id, job: { kind: "generate", input }, createdAt: clock.now() });
  }

  get(id: string): Job | null {
    return this.#deps.jobs.get(id);
````

**Edit `apps/server/src/managers/job-manager.test.ts`**: 1 replacement, in order.

1. Find:
````ts
    );
  });
});
````
   Replace with:
````ts
    );
  });

  test("enqueueDaily queues a daily's generation under its id, even when the queue is full", () => {
    const { manager } = setup(1);
    manager.enqueueGenerate({ width: 5, height: 5, seed: "a" });
    const input = { width: 7, height: 7, seed: "s", day: "2026-10-25" };
    expect(manager.enqueueDaily("d-1", input)).toMatchObject({
      id: "d-1",
      kind: "generate",
      status: "queued",
      input,
    });
  });
});
````

**Create `apps/server/src/test-support/daily.ts`** (step A5 adds `dailyDeps`):

````ts
import { createPuzzle, serializePuzzle } from "@loophole/core";
import type { GeneratedPuzzle } from "../domain.ts";
import { dayStart } from "../managers/days.ts";
import type { PuzzleManager } from "../managers/puzzle-manager.ts";
import type { DailyRepository } from "../ports.ts";

/** 2×2 all 2s, as a generation job makes it; its only loop runs around the outside. */
export const SMALL_DAILY: GeneratedPuzzle = {
  puzzle: serializePuzzle(
    createPuzzle(2, 2, [2, 2, 2, 2], { seed: "secret-seed", meta: { generator: "1" } }),
  ),
  solution: "112211121121",
  steps: [],
};

/**
 * Stores `SMALL_DAILY` as the daily of `day` for size class `size` under puzzle id `id`, as the
 * worker would, hidden until the day starts.
 */
export async function storeDaily(
  dailies: DailyRepository,
  puzzles: PuzzleManager,
  day: string,
  id: string,
  size = 7,
): Promise<void> {
  await puzzles.saveDaily(id, SMALL_DAILY, dayStart(day));
  dailies.insert({
    day,
    size,
    attempt: 0,
    jobId: id,
    puzzleId: id,
    generatorVersion: "1",
    createdAt: 0,
  });
}
````

**Create `apps/server/src/managers/daily-manager.ts`**:

````ts
import type { DailyRecord } from "../domain.ts";
import type { Clock, DailyRepository } from "../ports.ts";
import { addDays, dayStart, utcDay } from "./days.ts";
import { DailyNotFoundError } from "./errors.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";

/** The daily size classes (PRD §14 question 6, design kit): each day has a W×W puzzle of each. */
export const DAILY_SIZES: readonly number[] = [7, 10, 20, 40];

/** A day's daily puzzles. */
export interface DailySet {
  readonly day: string;
  /** The day is today, so its puzzles can be played ranked. */
  readonly live: boolean;
  /** When the next day's puzzles come out: the next 00:00 UTC. */
  readonly nextAt: number;
  /** One per size class, smallest first; `puzzleId` is null while the puzzle isn't ready. */
  readonly puzzles: readonly { readonly size: number; readonly puzzleId: string | null }[];
}

export interface DailyManagerDeps {
  readonly dailies: DailyRepository;
  readonly puzzles: PuzzleManager;
  readonly clock: Clock;
}

/**
 * Which puzzles are the daily puzzles (PRD FR-22): one per size class, the same for everyone,
 * switching at 00:00 UTC. The worker makes them ahead of time (`DailyStockManager`); a daily
 * puzzle stays hidden until its day starts.
 */
export class DailyManager {
  readonly #deps: DailyManagerDeps;

  constructor(deps: DailyManagerDeps) {
    this.#deps = deps;
  }

  /** Today's UTC day. */
  today(): string {
    return utcDay(this.#deps.clock.now());
  }

  /** The daily puzzles of `day` (today by default). Throws `DailyNotFoundError` for a day to come. */
  forDay(day = this.today()): DailySet {
    const { dailies, puzzles } = this.#deps;
    const today = this.today();
    if (day > today) throw new DailyNotFoundError("That day's daily puzzles aren't out yet.");
    const rows = new Map(dailies.listDay(day).map((r) => [r.size, r]));
    return {
      day,
      live: day === today,
      nextAt: dayStart(addDays(today, 1)),
      puzzles: DAILY_SIZES.map((size) => {
        const puzzleId = rows.get(size)?.puzzleId ?? null;
        // An admin may have unpublished a broken daily.
        const visible = puzzleId !== null && puzzles.get(puzzleId) !== null;
        return { size, puzzleId: visible ? puzzleId : null };
      }),
    };
  }

  /** The daily that a puzzle players can see is, or null when it isn't one. */
  byPuzzle(puzzleId: string): DailyRecord | null {
    if (this.#deps.puzzles.get(puzzleId) === null) return null;
    return this.#deps.dailies.getByPuzzle(puzzleId);
  }

  /** Whether `daily` is today's, so it can be played ranked. */
  isLive(daily: DailyRecord): boolean {
    return daily.day === this.today();
  }
}
````

**Create `apps/server/src/managers/daily-manager.test.ts`**:

````ts
import { describe, expect, test } from "bun:test";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { storeDaily } from "../test-support/daily.ts";
import { FakeClock, FakeDailyRepository, FakePuzzleRepository } from "../test-support/fakes.ts";
import { DAILY_SIZES, DailyManager } from "./daily-manager.ts";
import { DailyNotFoundError } from "./errors.ts";
import { PuzzleManager } from "./puzzle-manager.ts";

const MIDNIGHT = Date.UTC(2026, 9, 26);

function setup(now = MIDNIGHT - 1) {
  const clock = new FakeClock(now);
  const repo = new FakeDailyRepository();
  const puzzleRepo = new FakePuzzleRepository();
  const puzzles = new PuzzleManager({ puzzles: puzzleRepo, blobs: new MemoryBlobStore(), clock });
  const manager = new DailyManager({ dailies: repo, puzzles, clock });
  return { clock, repo, puzzles, puzzleRepo, manager };
}

describe("DailyManager (FR-22)", () => {
  test("today's set has every size class, with null for puzzles not ready", async () => {
    const { repo, puzzles, manager } = setup();
    await storeDaily(repo, puzzles, "2026-10-25", "d7", 7);
    expect(manager.forDay()).toEqual({
      day: "2026-10-25",
      live: true,
      nextAt: MIDNIGHT,
      puzzles: DAILY_SIZES.map((size) => ({ size, puzzleId: size === 7 ? "d7" : null })),
    });
  });

  test("switches at 00:00 UTC: tomorrow's puzzle appears and today's stops being live", async () => {
    const { clock, repo, puzzles, manager } = setup();
    await storeDaily(repo, puzzles, "2026-10-25", "today", 7);
    await storeDaily(repo, puzzles, "2026-10-26", "tomorrow", 7);
    expect(manager.byPuzzle("tomorrow")).toBeNull();
    expect(() => manager.forDay("2026-10-26")).toThrow(DailyNotFoundError);
    clock.time = MIDNIGHT;
    expect(manager.today()).toBe("2026-10-26");
    expect(manager.forDay().puzzles[0]).toEqual({ size: 7, puzzleId: "tomorrow" });
    expect(manager.forDay("2026-10-25")).toMatchObject({
      live: false,
      nextAt: MIDNIGHT + 86_400_000,
    });
    const yesterday = manager.byPuzzle("today");
    expect(yesterday?.day).toBe("2026-10-25");
    expect(yesterday && manager.isLive(yesterday)).toBe(false);
  });

  test("an unpublished daily and a practice puzzle are not dailies", async () => {
    const { repo, puzzles, manager } = setup();
    await storeDaily(repo, puzzles, "2026-10-25", "d7", 7);
    await puzzles.saveGenerated("practice", {
      puzzle: { v: 1, width: 1, height: 1, clues: "." },
      solution: "1111",
      steps: [],
    });
    expect(manager.byPuzzle("practice")).toBeNull();
    puzzles.unpublish("d7");
    expect(manager.byPuzzle("d7")).toBeNull();
    expect(manager.forDay().puzzles[0].puzzleId).toBeNull();
  });
});
````

**Create `apps/server/src/managers/daily-stock-manager.ts`**:

````ts
import type { DailyRecord, GeneratedPuzzle } from "../domain.ts";
import type { Clock, DailyRepository, DailySeeder } from "../ports.ts";
import { DAILY_SIZES } from "./daily-manager.ts";
import { addDays, dayStart, utcDay } from "./days.ts";
import type { JobManager } from "./job-manager.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";

export interface DailyStockSettings {
  /** How many days, today included, the scheduler keeps generated. */
  readonly daysAhead: number;
}

/** What one scheduler run did. */
export interface StockReport {
  /** Generation jobs queued, first tries and retries. */
  readonly queued: number;
  /** Today's size classes that have no puzzle yet: players can't play them. */
  readonly missingToday: readonly number[];
}

export interface DailyStockManagerDeps {
  readonly dailies: DailyRepository;
  readonly jobs: JobManager;
  readonly puzzles: PuzzleManager;
  readonly seeds: DailySeeder;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly settings: DailyStockSettings;
}

/**
 * The worker's side of daily puzzles (PRD FR-22): keeps the next few days generated, retries
 * failed generations with the next seed, and stores what the jobs make.
 */
export class DailyStockManager {
  readonly #deps: DailyStockManagerDeps;

  constructor(deps: DailyStockManagerDeps) {
    this.#deps = deps;
  }

  /**
   * Queues a generation for every day and size class from today to `daysAhead - 1` days on that
   * has none, and a retry with the next seed for every one whose job failed, timed out or is gone.
   * Safe to run from several workers at once: only one claims each day and size.
   */
  stock(): StockReport {
    const { dailies, jobs, clock, settings } = this.#deps;
    const today = utcDay(clock.now());
    let queued = 0;
    const missingToday: number[] = [];
    for (let i = 0; i < settings.daysAhead; i++) {
      const day = addDays(today, i);
      for (const size of DAILY_SIZES) {
        const row = dailies.get(day, size);
        if (row !== null && row.puzzleId !== null) continue;
        if (day === today) missingToday.push(size);
        if (row !== null) {
          const status = jobs.get(row.jobId)?.status ?? "lost";
          if (status === "queued" || status === "running" || status === "done") continue;
          console.warn(
            `Daily ${day} ${size}×${size}: generation attempt ${row.attempt} ${status}; trying the next seed`,
          );
        }
        if (this.#queue(day, size, row)) queued++;
      }
    }
    return { queued, missingToday };
  }

  /**
   * Stores the puzzle a daily's generation job made, hidden until its day starts, and links it to
   * the day. A job that a retry has replaced stores nothing.
   */
  async complete(jobId: string, day: string, generated: GeneratedPuzzle): Promise<void> {
    const { dailies, puzzles } = this.#deps;
    const size = generated.puzzle.width;
    if (dailies.get(day, size)?.jobId !== jobId) {
      console.warn(`Daily ${day} ${size}×${size}: job ${jobId} was replaced; not stored`);
      return;
    }
    await puzzles.saveDaily(jobId, generated, dayStart(day));
    dailies.setPuzzle(day, size, jobId, jobId, generated.puzzle.meta?.generator ?? null);
  }

  /**
   * Claims the day and size for a new job (first try, or the try after `row`) and queues it, in one
   * transaction: another worker never sees a claimed row whose job isn't in the queue yet.
   */
  #queue(day: string, size: number, row: DailyRecord | null): boolean {
    const { dailies, jobs, seeds, clock, newId } = this.#deps;
    const attempt = row === null ? 0 : row.attempt + 1;
    const jobId = newId();
    return dailies.atomically(() => {
      const claimed =
        row === null
          ? dailies.insert({
              day,
              size,
              attempt,
              jobId,
              puzzleId: null,
              generatorVersion: null,
              createdAt: clock.now(),
            })
          : dailies.retry(day, size, row.attempt, jobId);
      if (!claimed) return false;
      jobs.enqueueDaily(jobId, {
        width: size,
        height: size,
        seed: seeds.seed(day, size, attempt),
        day,
      });
      return true;
    });
  }
}
````

**Create `apps/server/src/managers/daily-stock-manager.test.ts`**:

````ts
import { describe, expect, spyOn, test } from "bun:test";
import { serializePuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import type { GeneratedPuzzle } from "../domain.ts";
import { SMALL_DAILY } from "../test-support/daily.ts";
import {
  FakeClock,
  FakeDailyRepository,
  FakeJobQueue,
  FakePuzzleRepository,
  fakeSeeds,
  sequentialIds,
} from "../test-support/fakes.ts";
import { DailyManager } from "./daily-manager.ts";
import { DailyStockManager } from "./daily-stock-manager.ts";
import { JobManager } from "./job-manager.ts";
import { PuzzleManager } from "./puzzle-manager.ts";

const NOON = Date.UTC(2026, 9, 25, 12);

function setup(daysAhead = 2) {
  const clock = new FakeClock(NOON);
  const repo = new FakeDailyRepository();
  const queue = new FakeJobQueue();
  const puzzleRepo = new FakePuzzleRepository();
  const puzzles = new PuzzleManager({ puzzles: puzzleRepo, blobs: new MemoryBlobStore(), clock });
  // A tiny queue: the scheduler's jobs must get in even when players have filled it.
  const jobs = new JobManager({ jobs: queue, clock, newId: sequentialIds("x"), maxQueued: 1 });
  const stock = new DailyStockManager({
    dailies: repo,
    jobs,
    puzzles,
    seeds: fakeSeeds,
    clock,
    newId: sequentialIds("j"),
    settings: { daysAhead },
  });
  const dailies = new DailyManager({ dailies: repo, puzzles, clock });
  return { clock, repo, queue, puzzles, puzzleRepo, stock, dailies };
}

/** What a generation job for size `size` makes: a puzzle of that width. */
function generated(size: number): GeneratedPuzzle {
  const clues = ".".repeat(size * size);
  return { ...SMALL_DAILY, puzzle: { ...SMALL_DAILY.puzzle, width: size, height: size, clues } };
}

/** Finishes a queued job as the worker would. */
function end(queue: FakeJobQueue, id: string, status: "done" | "failed" | "timeout") {
  queue.claimNext("w", 0);
  queue.finish(
    id,
    "w",
    status === "done"
      ? { status, result: { kind: "generate", puzzleId: id } }
      : { status, error: "boom" },
    0,
  );
}

describe("DailyStockManager.stock (FR-22)", () => {
  test("queues one generation per size class for each day ahead, with seeds from day, size and attempt", () => {
    const { repo, queue, stock } = setup();
    expect(stock.stock()).toEqual({ queued: 8, missingToday: [7, 10, 20, 40] });
    expect(queue.get("j-1")).toMatchObject({
      kind: "generate",
      status: "queued",
      input: { width: 7, height: 7, seed: "2026-10-25/7/0", day: "2026-10-25" },
    });
    expect(queue.get("j-8")?.input).toMatchObject({ width: 40, day: "2026-10-26" });
    expect(repo.get("2026-10-26", 40)).toMatchObject({ attempt: 0, jobId: "j-8", puzzleId: null });
    // Running again while the jobs wait queues nothing more.
    expect(stock.stock()).toEqual({ queued: 0, missingToday: [7, 10, 20, 40] });
    expect(queue.jobs.size).toBe(8);
  });

  test("stores what a job made, hidden until its day, and counts the day as stocked", async () => {
    const { clock, repo, queue, puzzles, puzzleRepo, stock, dailies } = setup(2);
    stock.stock();
    end(queue, "j-1", "done");
    await stock.complete("j-1", "2026-10-25", generated(7));
    expect(repo.get("2026-10-25", 7)).toMatchObject({ puzzleId: "j-1", generatorVersion: "1" });
    expect(puzzleRepo.get("j-1")?.releaseAt).toBe(Date.UTC(2026, 9, 25));
    // The stored puzzle keeps no seed or generator version (FR-25).
    const stored = puzzleRepo.get("j-1");
    expect(stored && serializePuzzle(stored.puzzle)).toEqual({
      v: 1,
      width: 7,
      height: 7,
      clues: ".".repeat(49),
    });
    expect(stock.stock().missingToday).toEqual([10, 20, 40]);
    expect(dailies.forDay().puzzles[0]).toEqual({ size: 7, puzzleId: "j-1" });

    // Tomorrow's is stored the day before and stays hidden until midnight.
    await stock.complete("j-5", "2026-10-26", generated(7));
    expect(repo.get("2026-10-26", 7)?.puzzleId).toBe("j-5");
    expect(puzzles.get("j-5")).toBeNull();
    clock.time = Date.UTC(2026, 9, 26);
    expect(puzzles.get("j-5")?.id).toBe("j-5");
  });

  test("retries a failed, timed-out or lost generation with the next seed", () => {
    const { repo, queue, stock } = setup(1);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    stock.stock();
    end(queue, "j-1", "failed");
    end(queue, "j-2", "timeout");
    queue.jobs.delete("j-3");
    expect(stock.stock()).toEqual({ queued: 3, missingToday: [7, 10, 20, 40] });
    expect(repo.get("2026-10-25", 7)).toMatchObject({ attempt: 1, jobId: "j-5" });
    expect(queue.get("j-5")?.input).toMatchObject({ seed: "2026-10-25/7/1" });
    expect(repo.get("2026-10-25", 10)).toMatchObject({ attempt: 1, jobId: "j-6" });
    expect(repo.get("2026-10-25", 20)).toMatchObject({ attempt: 1, jobId: "j-7" });
    expect(repo.get("2026-10-25", 40)).toMatchObject({ attempt: 0, jobId: "j-4" });
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  test("a job that a retry replaced stores nothing", async () => {
    const { repo, queue, puzzleRepo, stock } = setup(1);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    stock.stock();
    end(queue, "j-1", "timeout");
    stock.stock();
    await stock.complete("j-1", "2026-10-25", generated(7));
    expect(puzzleRepo.get("j-1")).toBeNull();
    expect(repo.get("2026-10-25", 7)?.puzzleId).toBeNull();
    warn.mockRestore();
  });

  test("two workers stocking at once queue each day and size once", () => {
    const first = setup(1);
    const second = new DailyStockManager({
      dailies: first.repo,
      jobs: new JobManager({
        jobs: first.queue,
        clock: first.clock,
        newId: sequentialIds("y"),
        maxQueued: 1,
      }),
      puzzles: first.puzzles,
      seeds: fakeSeeds,
      clock: first.clock,
      newId: sequentialIds("k"),
      settings: { daysAhead: 1 },
    });
    first.stock.stock();
    expect(second.stock().queued).toBe(0);
    expect(first.queue.jobs.size).toBe(4);
  });

  test("rolls over at 00:00 UTC: the new day ahead gets queued", () => {
    const { clock, queue, stock } = setup(1);
    stock.stock();
    clock.time = Date.UTC(2026, 9, 26);
    expect(stock.stock().queued).toBe(4);
    expect(queue.get("j-5")?.input).toMatchObject({ day: "2026-10-26" });
  });
});
````

**Create `apps/server/src/managers/attempt-manager.ts`**:

````ts
import { decodeEdges, EdgeState, FormatError } from "@loophole/core";
import type { AttemptRecord, DailyRecord, PuzzleRecord } from "../domain.ts";
import type { AttemptRepository, Clock } from "../ports.ts";
import type { DailyManager } from "./daily-manager.ts";
import { addDays, streakLength } from "./days.ts";
import {
  AttemptNotFoundError,
  DailyEndedError,
  DailyNotFoundError,
  InvalidBoardError,
  WrongSolutionError,
} from "./errors.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";

/**
 * How much less than the server measured a player's own time may be: a tenth of the server's time,
 * at least 3 s and at most 15 s. A solve can reach the server late (a slow network, a retry), so
 * the player's clock counts; but never by more than this, so a client can't claim a time it didn't
 * play, and on a small board the allowance stays small next to the time itself (DECISIONS, "Ranked
 * attempts and timing").
 */
export function rankedGraceMs(serverMs: number): number {
  return Math.min(15_000, Math.max(3_000, Math.round(serverMs / 10)));
}

/**
 * The least time a ranked solve of a W×H puzzle can take: 0.1 s per cell, at least 5 s. Drawing
 * the loop alone takes longer, so a faster solve was not played on the board and isn't ranked.
 */
export function minRankedMs(area: number): number {
  return Math.max(5_000, area * 100);
}

/** An attempt as a player sees it. */
export interface AttemptView {
  readonly attempt: AttemptRecord;
  /** Time on the ranked clock: until now while playing, the ranked time once finished. */
  readonly elapsedMs: number;
  /** Place on the puzzle's leaderboard, for a ranked solve; else null. */
  readonly rank: number | null;
}

/** What a player sends to finish an attempt. */
export interface FinishInput {
  /** The board, in the wire format's edge-state encoding. */
  readonly edges: string;
  /** The player's own clock since the attempt started. */
  readonly elapsedMs: number;
}

/** A player's daily status (PRD FR-24). */
export interface DailySummary {
  readonly day: string;
  /** Consecutive days, up to today, with a finished daily attempt. */
  readonly streak: number;
  /** The last seven days, oldest first, and whether each has a finished attempt. */
  readonly week: readonly { readonly day: string; readonly finished: boolean }[];
  /** Today's attempts. */
  readonly attempts: readonly AttemptView[];
  /** Best ranked time per leaderboard bucket. */
  readonly bests: readonly {
    readonly area: number;
    readonly level: number;
    readonly timeMs: number;
  }[];
}

export interface AttemptManagerDeps {
  readonly attempts: AttemptRepository;
  readonly dailies: DailyManager;
  readonly puzzles: PuzzleManager;
  readonly clock: Clock;
}

/**
 * Ranked attempts at daily puzzles (PRD FR-17, FR-23 to FR-25). A player gets one attempt per daily,
 * started on its day. Its clock runs on the server from the start and never stops; finishing sends
 * the board, which must be the stored solution, and the player's own time, which counts if it is
 * within `rankedGraceMs` of the server's. A solve is ranked unless a hint was used during it or it
 * was faster than `minRankedMs`. The progress records stay the board players resume (DECISIONS).
 */
export class AttemptManager {
  readonly #deps: AttemptManagerDeps;

  constructor(deps: AttemptManagerDeps) {
    this.#deps = deps;
  }

  /** The user's attempt at a daily puzzle, or null. Throws `DailyNotFoundError`. */
  get(userId: string, puzzleId: string): AttemptView | null {
    this.#daily(puzzleId);
    const attempt = this.#deps.attempts.get(userId, puzzleId);
    return attempt === null ? null : this.#view(attempt);
  }

  /**
   * Starts the user's attempt at today's daily `puzzleId`, or returns the one already started.
   * Throws `DailyNotFoundError`, or `DailyEndedError` for an earlier day's daily.
   */
  start(userId: string, puzzleId: string): AttemptView {
    const { attempts, dailies, clock } = this.#deps;
    const { daily, puzzle } = this.#daily(puzzleId);
    const existing = attempts.get(userId, puzzleId);
    if (existing !== null) return this.#view(existing);
    if (!dailies.isLive(daily)) throw new DailyEndedError();
    const { width, height } = puzzle.puzzle.grid;
    attempts.insert({
      userId,
      puzzleId,
      day: daily.day,
      area: width * height,
      level: puzzle.level,
      startedAt: clock.now(),
      finishedAt: null,
      timeMs: null,
      assisted: false,
      ranked: false,
    });
    return this.#view(this.#stored(userId, puzzleId));
  }

  /**
   * Finishes the user's attempt with their board (PRD FR-17, FR-25). Sending a finished attempt's
   * solution again, as a retry does, returns it unchanged. Throws `DailyNotFoundError`,
   * `AttemptNotFoundError`, `InvalidBoardError` or `WrongSolutionError`.
   */
  async finish(userId: string, puzzleId: string, input: FinishInput): Promise<AttemptView> {
    const { attempts, puzzles, clock } = this.#deps;
    const { puzzle } = this.#daily(puzzleId);
    const before = attempts.get(userId, puzzleId);
    if (before === null) throw new AttemptNotFoundError();
    if (before.finishedAt !== null) return this.#view(before);
    let board: Uint8Array;
    try {
      board = decodeEdges(puzzle.puzzle.grid, input.edges);
    } catch (err) {
      if (err instanceof FormatError) throw new InvalidBoardError(err.message);
      throw err;
    }
    const solution = await puzzles.getSolution(puzzleId);
    if (solution === null) throw new Error(`Puzzle ${puzzleId} has no stored solution`);
    for (let e = 0; e < solution.length; e++) {
      if ((board[e] === EdgeState.Line) !== (solution[e] === EdgeState.Line)) {
        throw new WrongSolutionError();
      }
    }
    // Read again after the await: a hint may have marked the attempt meanwhile. From here to the
    // write nothing awaits, so nothing else runs in between.
    const attempt = this.#stored(userId, puzzleId);
    if (attempt.finishedAt !== null) return this.#view(attempt);
    const now = clock.now();
    const serverMs = Math.max(0, now - attempt.startedAt);
    const grace = rankedGraceMs(serverMs);
    const timeMs = Math.min(serverMs, Math.max(input.elapsedMs, serverMs - grace));
    const ranked = !attempt.assisted && timeMs >= minRankedMs(attempt.area);
    attempts.finish(userId, puzzleId, { finishedAt: now, timeMs, ranked });
    return this.#view(this.#stored(userId, puzzleId));
  }

  /**
   * Records that the user was shown a hint on `puzzleId` (PRD FR-12): their unfinished attempt at
   * it, if any, becomes assisted and won't be ranked. Returns whether the puzzle is today's daily.
   */
  recordHint(userId: string | null, puzzleId: string): boolean {
    const { attempts, dailies } = this.#deps;
    const daily = dailies.byPuzzle(puzzleId);
    if (daily === null) return false;
    if (userId !== null) attempts.markAssisted(userId, puzzleId);
    return dailies.isLive(daily);
  }

  /** The user's streak, last week, today's attempts and best times (PRD FR-24). */
  summary(userId: string): DailySummary {
    const { attempts, dailies } = this.#deps;
    const today = dailies.today();
    const days = new Set(attempts.finishedDays(userId));
    const week = [6, 5, 4, 3, 2, 1, 0].map((back) => {
      const day = addDays(today, -back);
      return { day, finished: days.has(day) };
    });
    return {
      day: today,
      streak: streakLength(days, today),
      week,
      attempts: attempts.listForDay(userId, today).map((a) => this.#view(a)),
      bests: attempts.bests(userId),
    };
  }

  #daily(puzzleId: string): { daily: DailyRecord; puzzle: PuzzleRecord } {
    const daily = this.#deps.dailies.byPuzzle(puzzleId);
    const puzzle = this.#deps.puzzles.get(puzzleId);
    if (daily === null || puzzle === null) throw new DailyNotFoundError();
    return { daily, puzzle };
  }

  #stored(userId: string, puzzleId: string): AttemptRecord {
    const attempt = this.#deps.attempts.get(userId, puzzleId);
    if (attempt === null) throw new Error(`Attempt ${userId}/${puzzleId} is missing`);
    return attempt;
  }

  #view(attempt: AttemptRecord): AttemptView {
    const elapsedMs = attempt.timeMs ?? Math.max(0, this.#deps.clock.now() - attempt.startedAt);
    let rank: number | null = null;
    if (attempt.ranked) {
      const board = this.#deps.attempts.puzzleBoard(attempt.puzzleId, attempt.userId, 0);
      rank = board.entries.find((e) => e.userId === attempt.userId)?.rank ?? null;
    }
    return { attempt, elapsedMs, rank };
  }
}
````

**Create `apps/server/src/managers/attempt-manager.test.ts`**:

````ts
import { describe, expect, test } from "bun:test";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { storeDaily } from "../test-support/daily.ts";
import {
  FakeAttemptRepository,
  FakeClock,
  FakeDailyRepository,
  FakePuzzleRepository,
} from "../test-support/fakes.ts";
import { AttemptManager, minRankedMs, rankedGraceMs } from "./attempt-manager.ts";
import { DailyManager } from "./daily-manager.ts";
import {
  AttemptNotFoundError,
  DailyEndedError,
  DailyNotFoundError,
  InvalidBoardError,
  WrongSolutionError,
} from "./errors.ts";
import { PuzzleManager } from "./puzzle-manager.ts";

// The test daily is 2×2 all 2s; its only loop runs around the outside. Area 4, so a ranked solve
// takes at least minRankedMs(4) = 5 s.
const SOLVED = "112211121121";
const SOLVED_WITHOUT_CROSSES = "110011101101";
const WRONG = "100000000000";
const MIDNIGHT = Date.UTC(2026, 9, 26);
const T0 = MIDNIGHT - 60 * 60 * 1000;

async function setup() {
  const clock = new FakeClock(T0);
  const dailyRepo = new FakeDailyRepository();
  const repo = new FakeAttemptRepository();
  const puzzles = new PuzzleManager({
    puzzles: new FakePuzzleRepository(),
    blobs: new MemoryBlobStore(),
    clock,
  });
  await storeDaily(dailyRepo, puzzles, "2026-10-24", "d24");
  await storeDaily(dailyRepo, puzzles, "2026-10-25", "d25");
  await storeDaily(dailyRepo, puzzles, "2026-10-25", "d25-big", 10);
  await storeDaily(dailyRepo, puzzles, "2026-10-26", "d26");
  await puzzles.saveGenerated("practice", {
    puzzle: { v: 1, width: 2, height: 2, clues: "2222" },
    solution: SOLVED,
    steps: [],
  });
  const dailies = new DailyManager({ dailies: dailyRepo, puzzles, clock });
  const manager = new AttemptManager({ attempts: repo, dailies, puzzles, clock });
  return { clock, repo, manager };
}

describe("AttemptManager.start", () => {
  test("starts one attempt per player and daily, on the server's clock (FR-25)", async () => {
    const { clock, manager } = await setup();
    expect(manager.get("u1", "d25")).toBeNull();
    const started = manager.start("u1", "d25");
    expect(started).toEqual({
      attempt: {
        userId: "u1",
        puzzleId: "d25",
        day: "2026-10-25",
        area: 4,
        level: 1,
        startedAt: T0,
        finishedAt: null,
        timeMs: null,
        assisted: false,
        ranked: false,
      },
      elapsedMs: 0,
      rank: null,
    });
    clock.advance(30_000);
    // Starting again (another tab, a reload) gives back the same attempt and its running clock.
    expect(manager.start("u1", "d25")).toMatchObject({
      attempt: { startedAt: T0 },
      elapsedMs: 30_000,
    });
    expect(manager.get("u1", "d25")?.elapsedMs).toBe(30_000);
    expect(manager.start("u2", "d25").attempt.startedAt).toBe(T0 + 30_000);
  });

  test("only today's daily can be started; tomorrow's and practice puzzles are not dailies", async () => {
    const { manager } = await setup();
    expect(() => manager.start("u1", "d24")).toThrow(DailyEndedError);
    expect(() => manager.start("u1", "d26")).toThrow(DailyNotFoundError);
    expect(() => manager.start("u1", "practice")).toThrow(DailyNotFoundError);
    expect(() => manager.get("u1", "nope")).toThrow(DailyNotFoundError);
  });

  test("at 00:00 UTC yesterday's daily can no longer be started", async () => {
    const { clock, manager } = await setup();
    clock.time = MIDNIGHT - 1;
    manager.start("u1", "d25");
    clock.time = MIDNIGHT;
    expect(() => manager.start("u2", "d25")).toThrow(DailyEndedError);
    expect(manager.start("u1", "d25").attempt.startedAt).toBe(MIDNIGHT - 1);
    expect(manager.start("u2", "d26").attempt.day).toBe("2026-10-26");
  });
});

describe("AttemptManager.finish", () => {
  test("a correct board finishes the attempt with the server's time and a rank (FR-17, FR-23)", async () => {
    const { clock, manager } = await setup();
    manager.start("u1", "d25");
    clock.advance(42_000);
    const done = await manager.finish("u1", "d25", { edges: SOLVED, elapsedMs: 41_500 });
    expect(done).toEqual({
      attempt: expect.objectContaining({ finishedAt: T0 + 42_000, timeMs: 41_500, ranked: true }),
      elapsedMs: 41_500,
      rank: 1,
    });
    // Crosses and empty edges are the same thing to the check: only lines matter.
    manager.start("u2", "d25");
    clock.advance(50_000);
    const second = await manager.finish("u2", "d25", {
      edges: SOLVED_WITHOUT_CROSSES,
      elapsedMs: 50_000,
    });
    expect(second.rank).toBe(2);
  });

  test("a wrong or malformed board is refused and the attempt carries on", async () => {
    const { clock, manager } = await setup();
    manager.start("u1", "d25");
    clock.advance(10_000);
    await expect(manager.finish("u1", "d25", { edges: WRONG, elapsedMs: 1 })).rejects.toThrow(
      WrongSolutionError,
    );
    await expect(manager.finish("u1", "d25", { edges: "12", elapsedMs: 1 })).rejects.toThrow(
      InvalidBoardError,
    );
    expect(manager.get("u1", "d25")?.attempt.finishedAt).toBeNull();
  });

  test("finishing without an attempt, or a practice puzzle, is refused", async () => {
    const { manager } = await setup();
    await expect(manager.finish("u1", "d25", { edges: SOLVED, elapsedMs: 1 })).rejects.toThrow(
      AttemptNotFoundError,
    );
    await expect(manager.finish("u1", "practice", { edges: SOLVED, elapsedMs: 1 })).rejects.toThrow(
      DailyNotFoundError,
    );
  });

  test("the player's time counts only within the grace period of the server's", async () => {
    const { clock, manager } = await setup();
    manager.start("u1", "d25");
    clock.advance(100_000);
    // Claims to have taken 1 s: the server allows at most a tenth of its own time less (10 s here).
    expect([rankedGraceMs(5_000), rankedGraceMs(100_000), rankedGraceMs(600_000)]).toEqual([
      3_000, 10_000, 15_000,
    ]);
    const cheat = await manager.finish("u1", "d25", { edges: SOLVED, elapsedMs: 1_000 });
    expect(cheat.attempt.timeMs).toBe(90_000);
    // Claims more than the server measured: the server's time wins.
    manager.start("u2", "d25");
    clock.advance(20_000);
    const slow = await manager.finish("u2", "d25", { edges: SOLVED, elapsedMs: 90_000 });
    expect(slow.attempt.timeMs).toBe(20_000);
  });

  test("a solve faster than anyone can draw the loop is kept but not ranked", async () => {
    const { clock, manager } = await setup();
    expect(minRankedMs(4)).toBe(5_000);
    expect(minRankedMs(1600)).toBe(160_000);
    manager.start("u1", "d25");
    clock.advance(4_999);
    const fast = await manager.finish("u1", "d25", { edges: SOLVED, elapsedMs: 4_999 });
    expect(fast).toMatchObject({ attempt: { timeMs: 4_999, ranked: false }, rank: null });
  });

  test("a hint during the attempt keeps it off the leaderboard (FR-12, FR-23)", async () => {
    const { clock, manager } = await setup();
    manager.start("u1", "d25");
    expect(manager.recordHint("u1", "d25")).toBe(true);
    clock.advance(60_000);
    const done = await manager.finish("u1", "d25", { edges: SOLVED, elapsedMs: 60_000 });
    expect(done).toMatchObject({ attempt: { assisted: true, ranked: false }, rank: null });
    // A hint after finishing changes nothing.
    manager.start("u2", "d25");
    clock.advance(60_000);
    await manager.finish("u2", "d25", { edges: SOLVED, elapsedMs: 60_000 });
    manager.recordHint("u2", "d25");
    expect(manager.get("u2", "d25")).toMatchObject({ attempt: { assisted: false }, rank: 1 });
  });

  test("sending the solution again, as a retry does, returns the finished attempt unchanged", async () => {
    const { clock, manager } = await setup();
    manager.start("u1", "d25");
    clock.advance(30_000);
    const first = await manager.finish("u1", "d25", { edges: SOLVED, elapsedMs: 30_000 });
    clock.advance(60_000);
    expect(await manager.finish("u1", "d25", { edges: WRONG, elapsedMs: 5 })).toEqual(first);
  });

  test("an attempt started before 00:00 UTC can be finished after it", async () => {
    const { clock, manager } = await setup();
    clock.time = MIDNIGHT - 20_000;
    manager.start("u1", "d25");
    clock.time = MIDNIGHT + 10_000;
    const done = await manager.finish("u1", "d25", { edges: SOLVED, elapsedMs: 30_000 });
    expect(done).toMatchObject({ attempt: { day: "2026-10-25", timeMs: 30_000, ranked: true } });
  });
});

describe("AttemptManager.recordHint", () => {
  test("says whether the puzzle is today's daily", async () => {
    const { manager } = await setup();
    expect(manager.recordHint(null, "d25")).toBe(true);
    expect(manager.recordHint(null, "d24")).toBe(false);
    expect(manager.recordHint("u1", "practice")).toBe(false);
    expect(manager.recordHint("u1", "d26")).toBe(false);
  });
});

describe("AttemptManager.summary (FR-24)", () => {
  /** Plays and finishes `puzzleId` for u1 at `at`, taking a minute. */
  async function solveAt(
    clock: FakeClock,
    manager: AttemptManager,
    puzzleId: string,
    at: number,
    hint = false,
  ) {
    clock.time = at;
    manager.start("u1", puzzleId);
    if (hint) manager.recordHint("u1", puzzleId);
    clock.advance(60_000);
    await manager.finish("u1", puzzleId, { edges: SOLVED, elapsedMs: 60_000 });
  }

  test("counts consecutive days with a finished daily, hinted or not, and keeps it until midnight", async () => {
    const { clock, manager } = await setup();
    await solveAt(clock, manager, "d24", Date.UTC(2026, 9, 24, 9), true);
    clock.time = T0;
    const today = manager.summary("u1");
    expect(today.streak).toBe(1);
    expect(today.week.map((d) => d.finished)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      false,
    ]);
    expect(today.week.at(-1)?.day).toBe("2026-10-25");
    expect(today.attempts).toEqual([]);
    expect(today.bests).toEqual([]);

    await solveAt(clock, manager, "d25", T0);
    const both = manager.summary("u1");
    expect(both.streak).toBe(2);
    expect(both.attempts.map((a) => a.attempt.puzzleId)).toEqual(["d25"]);
    expect(both.bests).toEqual([{ area: 4, level: 1, timeMs: 60_000 }]);

    // Two days later without playing, the streak is gone.
    clock.time = MIDNIGHT + 86_400_000;
    expect(manager.summary("u1").streak).toBe(0);
  });

  test("an unfinished attempt doesn't count toward the streak", async () => {
    const { clock, manager } = await setup();
    clock.time = T0;
    manager.start("u1", "d25");
    expect(manager.summary("u1")).toMatchObject({ streak: 0, attempts: [{ rank: null }] });
  });
});
````

**Create `apps/server/src/managers/leaderboard-manager.ts`**:

````ts
import type { LeaderboardEntry, LeaderboardSlice } from "../domain.ts";
import type { AttemptRepository } from "../ports.ts";
import type { DailyManager } from "./daily-manager.ts";
import { DailyNotFoundError } from "./errors.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";

/** A leaderboard as served: its bucket, its top rows and the viewer's place. */
export interface Leaderboard {
  /** The bucket (PRD FR-23): width × height, and the level. */
  readonly area: number;
  readonly level: number;
  /** How many players are on it. */
  readonly total: number;
  /** The top rows, then the viewer's row and its neighbours, by rank. */
  readonly entries: readonly LeaderboardEntry[];
  /** The viewer's own row, or null when they aren't on the board. */
  readonly me: LeaderboardEntry | null;
}

export interface LeaderboardManagerDeps {
  readonly attempts: AttemptRepository;
  readonly dailies: DailyManager;
  readonly puzzles: PuzzleManager;
}

/**
 * Leaderboards (PRD FR-23): ranked solves of daily puzzles by time, bucketed by area and level, with
 * hinted and implausibly fast solves left out. Each daily has its own board, and each bucket has an
 * all-time board of every player's best time.
 */
export class LeaderboardManager {
  readonly #deps: LeaderboardManagerDeps;

  constructor(deps: LeaderboardManagerDeps) {
    this.#deps = deps;
  }

  /** The board of one daily puzzle. Throws `DailyNotFoundError`. */
  forPuzzle(puzzleId: string, viewerId: string | null, limit: number): Leaderboard {
    const { attempts, dailies, puzzles } = this.#deps;
    const record = puzzles.get(puzzleId);
    if (record === null || dailies.byPuzzle(puzzleId) === null) throw new DailyNotFoundError();
    const { width, height } = record.puzzle.grid;
    const slice = attempts.puzzleBoard(puzzleId, viewerId, limit);
    return board(width * height, record.level, slice, viewerId);
  }

  /** The all-time board of one bucket: each player's best ranked time. */
  forBucket(area: number, level: number, viewerId: string | null, limit: number): Leaderboard {
    const slice = this.#deps.attempts.bucketBoard(area, level, viewerId, limit);
    return board(area, level, slice, viewerId);
  }
}

function board(
  area: number,
  level: number,
  slice: LeaderboardSlice,
  viewerId: string | null,
): Leaderboard {
  const me = slice.entries.find((e) => e.userId === viewerId) ?? null;
  return { area, level, total: slice.total, entries: slice.entries, me };
}
````

**Create `apps/server/src/managers/leaderboard-manager.test.ts`**:

````ts
import { describe, expect, test } from "bun:test";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import type { AttemptRecord } from "../domain.ts";
import { storeDaily } from "../test-support/daily.ts";
import {
  FakeAttemptRepository,
  FakeClock,
  FakeDailyRepository,
  FakeDisplayNameRepository,
  FakePuzzleRepository,
} from "../test-support/fakes.ts";
import { DailyManager } from "./daily-manager.ts";
import { DailyNotFoundError } from "./errors.ts";
import { LeaderboardManager } from "./leaderboard-manager.ts";
import { PuzzleManager } from "./puzzle-manager.ts";

async function setup() {
  const clock = new FakeClock(Date.UTC(2026, 9, 25, 12));
  const dailyRepo = new FakeDailyRepository();
  const names = new FakeDisplayNameRepository();
  const repo = new FakeAttemptRepository(names);
  const puzzles = new PuzzleManager({
    puzzles: new FakePuzzleRepository(),
    blobs: new MemoryBlobStore(),
    clock,
  });
  await storeDaily(dailyRepo, puzzles, "2026-10-24", "d24");
  await storeDaily(dailyRepo, puzzles, "2026-10-25", "d25");
  await storeDaily(dailyRepo, puzzles, "2026-10-26", "d26");
  const dailies = new DailyManager({ dailies: dailyRepo, puzzles, clock });
  const manager = new LeaderboardManager({ attempts: repo, dailies, puzzles });
  /** A finished attempt at the 2×2 daily `puzzleId`. */
  const solve = (userId: string, puzzleId: string, timeMs: number, ranked = true) => {
    const a: AttemptRecord = {
      userId,
      puzzleId,
      day: puzzleId === "d24" ? "2026-10-24" : "2026-10-25",
      area: 4,
      level: 1,
      startedAt: 0,
      finishedAt: timeMs,
      timeMs,
      assisted: !ranked,
      ranked,
    };
    repo.insertOver(a);
  };
  return { names, manager, solve };
}

describe("LeaderboardManager (FR-23)", () => {
  test("a daily's board ranks ranked solves by time and leaves hinted ones out", async () => {
    const { names, manager, solve } = await setup();
    solve("u1", "d25", 9000);
    solve("u2", "d25", 7000);
    solve("u3", "d25", 1000, false);
    names.set("u2", "tsuru", 0);
    expect(manager.forPuzzle("d25", "u1", 10)).toEqual({
      area: 4,
      level: 1,
      total: 2,
      entries: [
        { rank: 1, userId: "u2", name: "tsuru", timeMs: 7000 },
        { rank: 2, userId: "u1", name: null, timeMs: 9000 },
      ],
      me: { rank: 2, userId: "u1", name: null, timeMs: 9000 },
    });
    expect(manager.forPuzzle("d25", "u3", 10).me).toBeNull();
    expect(manager.forPuzzle("d25", null, 1).entries.map((e) => e.rank)).toEqual([1]);
  });

  test("shows the viewer's rank even outside the top", async () => {
    const { manager, solve } = await setup();
    for (let i = 1; i <= 30; i++) solve(`u${i}`, "d25", i * 1000);
    const board = manager.forPuzzle("d25", "u20", 3);
    expect(board.total).toBe(30);
    expect(board.entries.map((e) => e.rank)).toEqual([1, 2, 3, 19, 20, 21]);
    expect(board.me?.rank).toBe(20);
  });

  test("the bucket's all-time board takes each player's best across dailies of that area", async () => {
    const { manager, solve } = await setup();
    solve("u1", "d24", 5000);
    solve("u1", "d25", 3000);
    solve("u2", "d24", 4000);
    expect(manager.forBucket(4, 1, null, 10).entries).toEqual([
      { rank: 1, userId: "u1", name: null, timeMs: 3000 },
      { rank: 2, userId: "u2", name: null, timeMs: 4000 },
    ]);
    expect(manager.forBucket(49, 1, "u1", 10)).toEqual({
      area: 49,
      level: 1,
      total: 0,
      entries: [],
      me: null,
    });
  });

  test("tomorrow's daily and unknown puzzles have no board", async () => {
    const { manager } = await setup();
    expect(() => manager.forPuzzle("d26", null, 10)).toThrow(DailyNotFoundError);
    expect(() => manager.forPuzzle("nope", null, 10)).toThrow(DailyNotFoundError);
  });
});
````

**Create `apps/server/src/managers/display-name-manager.ts`**:

````ts
import type { Clock, DisplayNameRepository, RateLimiter, RateRule } from "../ports.ts";
import { DisplayNameTakenError, InvalidDisplayNameError, RateLimitedError } from "./errors.ts";

/** Name changes one account may make. */
export const NAME_CHANGES_PER_ACCOUNT: RateRule = { limit: 10, windowMs: 60 * 60 * 1000 };

/** Names that would confuse a leaderboard ("You" marks the viewer's own row). */
const RESERVED = new Set(["you", "anonymous"]);

/** Parts that would let a name pass for staff, anywhere in it. */
const RESERVED_PARTS = ["admin", "loophole", "moderator", "official"];

function reserved(name: string): boolean {
  const lower = name.toLowerCase();
  return RESERVED.has(lower) || RESERVED_PARTS.some((part) => lower.includes(part));
}

export interface DisplayNameManagerDeps {
  readonly names: DisplayNameRepository;
  readonly limiter: RateLimiter;
  readonly clock: Clock;
}

/**
 * The names players show on leaderboards (DECISIONS, "Display names"). A player has none until
 * they choose one, and shows as anonymous until then; the name is public, unique ignoring case,
 * and goes with the account.
 */
export class DisplayNameManager {
  readonly #deps: DisplayNameManagerDeps;

  constructor(deps: DisplayNameManagerDeps) {
    this.#deps = deps;
  }

  get(userId: string): string | null {
    return this.#deps.names.get(userId);
  }

  /**
   * Sets the user's name, already checked for length and characters, or removes it with null.
   * Throws `InvalidDisplayNameError` for a reserved name, `DisplayNameTakenError` when another
   * player has it, and `RateLimitedError` past the account's limit.
   */
  set(userId: string, name: string | null): string | null {
    const { names, limiter, clock } = this.#deps;
    const decision = limiter.hit(`display-name:${userId}`, NAME_CHANGES_PER_ACCOUNT);
    if (!decision.allowed) throw new RateLimitedError(decision.retryAfterMs);
    if (name !== null && reserved(name)) {
      throw new InvalidDisplayNameError(`"${name}" can't be used as a name.`);
    }
    if (!names.set(userId, name, clock.now())) throw new DisplayNameTakenError();
    return name;
  }
}
````

**Create `apps/server/src/managers/display-name-manager.test.ts`**:

````ts
import { describe, expect, test } from "bun:test";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import { FakeClock, FakeDisplayNameRepository } from "../test-support/fakes.ts";
import { DisplayNameManager, NAME_CHANGES_PER_ACCOUNT } from "./display-name-manager.ts";
import { DisplayNameTakenError, InvalidDisplayNameError, RateLimitedError } from "./errors.ts";

function setup() {
  const clock = new FakeClock();
  const names = new FakeDisplayNameRepository();
  const manager = new DisplayNameManager({ names, limiter: new MemoryRateLimiter(clock), clock });
  return { names, manager };
}

describe("DisplayNameManager", () => {
  test("a player has no name until they choose one, and can remove it", () => {
    const { manager } = setup();
    expect(manager.get("u1")).toBeNull();
    expect(manager.set("u1", "kuroneko")).toBe("kuroneko");
    expect(manager.get("u1")).toBe("kuroneko");
    expect(manager.set("u1", null)).toBeNull();
    expect(manager.get("u1")).toBeNull();
  });

  test("refuses reserved names and names another player has", () => {
    const { manager } = setup();
    expect(() => manager.set("u1", "You")).toThrow(InvalidDisplayNameError);
    expect(() => manager.set("u1", "anonymous")).toThrow(InvalidDisplayNameError);
    for (const staff of ["Admin_", "admin1", "Loophole-Team", "the.moderator", "OFFICIAL"]) {
      expect(() => manager.set("u1", staff)).toThrow(InvalidDisplayNameError);
    }
    expect(manager.set("u1", "youngblood")).toBe("youngblood");
    manager.set("u1", "Tsuru");
    expect(() => manager.set("u2", "tsuru")).toThrow(DisplayNameTakenError);
  });

  test("limits how often an account changes its name", () => {
    const { manager } = setup();
    for (let i = 0; i < NAME_CHANGES_PER_ACCOUNT.limit; i++) manager.set("u1", `name-${i}`);
    expect(() => manager.set("u1", "one-more")).toThrow(RateLimitedError);
  });
});
````

**Verify:** `bun test apps/server/src/managers && bun run check`.

**Commit:** `feat(server): daily, ranked attempt, leaderboard and display name managers`

### A5 API: hints record assists; daily, attempt, leaderboard and display name routes

`HintManager` now needs the attempt manager (`attempts: Pick<AttemptManager, "recordHint">`), so every place that builds it changes: the composition roots build the daily managers, and the route tests spread `dailyDeps(db, clock, puzzles)` (which includes `hints`) in place of `hints: new HintManager({ puzzles })`. The hint route reads the session (optional) and passes the user id. New routes are in `api/daily.ts`; `app.ts` registers them and maps the new errors to problems (404 daily not found / attempt not found, 409 daily over / name taken, 400 not the solution / name not allowed). After the edits, regenerate the contract.

**Edit `apps/server/src/managers/hint-manager.ts`**: 4 replacements, in order.

1. Find:
````ts
import { decodeEdges, FormatError, findHint, type Hint } from "@loophole/core";
import { InvalidBoardError } from "./errors.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";
````
   Replace with:
````ts
import { decodeEdges, FormatError, findHint, type Hint } from "@loophole/core";
import type { AttemptManager } from "./attempt-manager.ts";
import { InvalidBoardError } from "./errors.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";
````

2. Find:
````ts
export interface HintManagerDeps {
  readonly puzzles: PuzzleManager;
}

/**
 * Hints for published puzzles (PRD FR-6, FR-12): the next deduction from a player's board, worked
 * out against the stored solution, which never leaves the server (FR-25). Ranked play (WT11) will
 * record here that a player took a hint.
 */
export class HintManager {
````
   Replace with:
````ts
export interface HintManagerDeps {
  readonly puzzles: PuzzleManager;
  /** Marks a player's ranked attempt as assisted when they get a hint (PRD FR-12, FR-23). */
  readonly attempts: Pick<AttemptManager, "recordHint">;
}

/**
 * Hints for published puzzles (PRD FR-6, FR-12): the next deduction from a player's board, worked
 * out against the stored solution, which never leaves the server (FR-25). A hint for a logged-in
 * player marks their ranked attempt at the puzzle as assisted.
 */
export class HintManager {
````

3. Find:
````ts
  /**
   * The hint for `edges` (the edge-state encoding) on puzzle `id`, or null when there is no
   * published puzzle with that id. Throws `InvalidBoardError` when `edges` does not fit the puzzle.
   */
  async hint(id: string, edges: string): Promise<Hint | null> {
    const { puzzles } = this.#deps;
    const record = puzzles.get(id);
````
   Replace with:
````ts
  /**
   * The hint for `edges` (the edge-state encoding) on puzzle `id`, or null when there is no
   * published puzzle with that id. `userId` is the logged-in player, if any. Throws
   * `InvalidBoardError` when `edges` does not fit the puzzle.
   */
  async hint(id: string, edges: string, userId: string | null = null): Promise<Hint | null> {
    const { puzzles } = this.#deps;
    const record = puzzles.get(id);
````

4. Find:
````ts
    const solution = await puzzles.getSolution(id);
    if (solution === null) throw new Error(`Puzzle ${id} has no stored solution`);
    return findHint(record.puzzle, solution, board, { timeLimitMs: HINT_TIME_LIMIT_MS });
  }
}
````
   Replace with:
````ts
    const solution = await puzzles.getSolution(id);
    if (solution === null) throw new Error(`Puzzle ${id} has no stored solution`);
    const hint = findHint(record.puzzle, solution, board, { timeLimitMs: HINT_TIME_LIMIT_MS });
    if (hint.kind === "solved") return hint;
    const live = this.#deps.attempts.recordHint(userId, id);
    // On today's daily a mistake hint doesn't count the wrong marks, so one request can't check a
    // whole board against the solution (DECISIONS, "Hints on daily puzzles").
    if (live && hint.kind === "mistake") return { ...hint, count: 1 };
    return hint;
  }
}
````

**Edit `apps/server/src/managers/hint-manager.test.ts`**: 3 replacements, in order.

1. Find:
````ts
const SOLUTION = "112211121121";

async function setup() {
  const blobs = new MemoryBlobStore();
  const puzzles = new PuzzleManager({
````
   Replace with:
````ts
const SOLUTION = "112211121121";

/** Records the hints the attempt manager is told about; `live` says whether the puzzle is today's daily. */
function fakeAttempts(live = false) {
  const calls: [string | null, string][] = [];
  return {
    calls,
    recordHint(userId: string | null, puzzleId: string) {
      calls.push([userId, puzzleId]);
      return live;
    },
  };
}

async function setup(live = false) {
  const blobs = new MemoryBlobStore();
  const puzzles = new PuzzleManager({
````

2. Find:
````ts
    steps: [],
  });
  return { blobs, hints: new HintManager({ puzzles }) };
}
````
   Replace with:
````ts
    steps: [],
  });
  const attempts = fakeAttempts(live);
  return { blobs, attempts, hints: new HintManager({ puzzles, attempts }) };
}
````

3. Find:
````ts
  });

  test("fails loudly when the solution blob is missing", async () => {
    const { blobs, hints } = await setup();
````
   Replace with:
````ts
  });

  test("tells the attempt manager about every hint shown, with the player if logged in (FR-12)", async () => {
    const { attempts, hints } = await setup();
    await hints.hint("p-1", "000000000000", "u1");
    await hints.hint("p-1", "200000000000");
    await hints.hint("p-1", SOLUTION, "u1");
    expect(attempts.calls).toEqual([
      ["u1", "p-1"],
      [null, "p-1"],
    ]);
  });

  test("on today's daily a mistake hint doesn't count the wrong marks", async () => {
    const { hints } = await setup(true);
    expect(await hints.hint("p-1", "220000000000")).toEqual({ kind: "mistake", edge: 0, count: 1 });
    const practice = await setup(false);
    expect(await practice.hints.hint("p-1", "220000000000")).toEqual({
      kind: "mistake",
      edge: 0,
      count: 2,
    });
  });

  test("fails loudly when the solution blob is missing", async () => {
    const { blobs, hints } = await setup();
````

**Replace the whole of `apps/server/src/test-support/daily.ts`** (adds `dailyDeps`) with:

````ts
import type { Database } from "bun:sqlite";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { SqliteAttemptRepository } from "../adapters/db/attempt-repository.ts";
import { SqliteDailyRepository } from "../adapters/db/daily-repository.ts";
import { SqliteDisplayNameRepository } from "../adapters/db/display-name-repository.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import type { GeneratedPuzzle } from "../domain.ts";
import { AttemptManager } from "../managers/attempt-manager.ts";
import { DailyManager } from "../managers/daily-manager.ts";
import { dayStart } from "../managers/days.ts";
import { DisplayNameManager } from "../managers/display-name-manager.ts";
import { HintManager } from "../managers/hint-manager.ts";
import { LeaderboardManager } from "../managers/leaderboard-manager.ts";
import type { PuzzleManager } from "../managers/puzzle-manager.ts";
import type { Clock, DailyRepository } from "../ports.ts";

/** 2×2 all 2s, as a generation job makes it; its only loop runs around the outside. */
export const SMALL_DAILY: GeneratedPuzzle = {
  puzzle: serializePuzzle(
    createPuzzle(2, 2, [2, 2, 2, 2], { seed: "secret-seed", meta: { generator: "1" } }),
  ),
  solution: "112211121121",
  steps: [],
};

/**
 * Stores `SMALL_DAILY` as the daily of `day` for size class `size` under puzzle id `id`, as the
 * worker would, hidden until the day starts.
 */
export async function storeDaily(
  dailies: DailyRepository,
  puzzles: PuzzleManager,
  day: string,
  id: string,
  size = 7,
): Promise<void> {
  await puzzles.saveDaily(id, SMALL_DAILY, dayStart(day));
  dailies.insert({
    day,
    size,
    attempt: 0,
    jobId: id,
    puzzleId: id,
    generatorVersion: "1",
    createdAt: 0,
  });
}

/**
 * The daily side of the API for route tests: SQLite repositories on `db`, the hint manager that
 * records assists, and a rate limiter of its own. Spread the result into `createApp`'s deps.
 */
export function dailyDeps(db: Database, clock: Clock, puzzles: PuzzleManager) {
  const dailyRepo = new SqliteDailyRepository(db);
  const attemptRepo = new SqliteAttemptRepository(db);
  const dailies = new DailyManager({ dailies: dailyRepo, puzzles, clock });
  const attempts = new AttemptManager({ attempts: attemptRepo, dailies, puzzles, clock });
  return {
    dailyRepo,
    dailies,
    attempts,
    hints: new HintManager({ puzzles, attempts }),
    leaderboards: new LeaderboardManager({ attempts: attemptRepo, dailies, puzzles }),
    displayNames: new DisplayNameManager({
      names: new SqliteDisplayNameRepository(db),
      limiter: new MemoryRateLimiter(clock),
      clock,
    }),
  };
}
````

**Create `apps/server/src/api/daily-schemas.ts`**:

````ts
import { z } from "@hono/zod-openapi";
import { isDay } from "../managers/days.ts";
import { EdgesSchema } from "./schemas.ts";

// Request and response bodies of the daily puzzle, ranked attempt, leaderboard and display name
// routes (daily.ts).

const Id = z.string().min(1).max(64);

const Timestamp = z.iso.datetime().openapi({ example: "2026-10-25T12:00:00.000Z" });

/** 100 days, as for saved progress: a safe integer far above any real attempt. */
const MAX_ELAPSED_MS = 100 * 24 * 60 * 60 * 1000;

const Ms = z.int().min(0).max(MAX_ELAPSED_MS);

const Day = z
  .string()
  .refine(isDay, "Expected a calendar day as YYYY-MM-DD.")
  .openapi({ example: "2026-10-25", description: "A UTC day, YYYY-MM-DD." });

export const DailyQuerySchema = z.object({
  day: Day.optional().openapi({ description: "A UTC day up to today; default today." }),
});

export const DailySetSchema = z
  .object({
    day: Day,
    live: z.boolean().openapi({ description: "The day is today, so its puzzles can be ranked." }),
    nextAt: Timestamp.openapi({ description: "When the next day's puzzles come out (00:00 UTC)." }),
    puzzles: z.array(
      z.object({
        size: z.int().min(1).max(100).openapi({ description: "The puzzle is size × size." }),
        puzzleId: z.union([Id, z.null()]).openapi({
          description: "Null while the puzzle isn't ready. Open it with GET /api/puzzles/{id}.",
        }),
      }),
    ),
  })
  .openapi("DailySet", { description: "A day's daily puzzles, one per size class (PRD FR-22)." });

export const UserParamSchema = z.object({
  userId: Id.openapi({
    param: { name: "userId", in: "path" },
    description: "Must be the logged-in user's id; anything else is refused with 403.",
  }),
});

export const AttemptParamSchema = UserParamSchema.extend({
  puzzleId: Id.openapi({ param: { name: "puzzleId", in: "path" } }),
});

export const AttemptSchema = z
  .object({
    puzzleId: Id,
    day: Day,
    area: z.int().min(1).openapi({ description: "Width × height: the leaderboard bucket." }),
    level: z.int(),
    status: z.enum(["playing", "finished"]),
    startedAt: Timestamp,
    finishedAt: z.union([Timestamp, z.null()]),
    elapsedMs: Ms.openapi({
      description:
        "Time on the ranked clock: since the start while playing (measured by the server), the ranked time once finished.",
    }),
    assisted: z.boolean().openapi({ description: "A hint was shown during the attempt." }),
    ranked: z.boolean().openapi({
      description:
        "The finished solve counts on leaderboards: no hint, and not faster than the loop can be drawn. False while playing.",
    }),
    rank: z.union([z.int().min(1), z.null()]).openapi({
      description: "Place on this daily's leaderboard, for a ranked solve.",
    }),
  })
  .openapi("Attempt", { description: "A player's one ranked attempt at a daily puzzle." });

export const AttemptResultSchema = z
  .object({ attempt: z.union([AttemptSchema, z.null()]) })
  .openapi("AttemptResult", { description: "`attempt` is null when none was started." });

export const StartedAttemptSchema = z.object({ attempt: AttemptSchema }).openapi("StartedAttempt");

export const FinishAttemptRequestSchema = z
  .strictObject({
    edges: EdgesSchema,
    elapsedMs: Ms.openapi({
      description:
        "The player's own clock since the attempt started; it counts when it is at most a tenth of the server's time (3 to 15 s) under it.",
    }),
  })
  .openapi("FinishAttemptRequest");

export const DailySummarySchema = z
  .object({
    day: Day,
    streak: z.int().min(0).openapi({
      description: "Consecutive days, up to today, with a finished daily (PRD FR-24).",
    }),
    week: z
      .array(z.object({ day: Day, finished: z.boolean() }))
      .openapi({ description: "The last seven days, oldest first." }),
    attempts: z.array(AttemptSchema).openapi({ description: "Today's attempts." }),
    bests: z
      .array(z.object({ area: z.int(), level: z.int(), timeMs: Ms }))
      .openapi({ description: "Best ranked time per leaderboard bucket." }),
  })
  .openapi("DailySummary");

export const LeaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10).openapi({ example: 10 }),
});

export const PuzzleBoardParamSchema = z.object({
  puzzleId: Id.openapi({ param: { name: "puzzleId", in: "path" } }),
});

export const BucketBoardParamSchema = z.object({
  area: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .openapi({ param: { name: "area", in: "path" }, example: 49 }),
});

export const BucketBoardQuerySchema = LeaderboardQuerySchema.extend({
  level: z.coerce.number().int().min(1).max(100).default(1).openapi({ example: 1 }),
});

const LeaderboardEntrySchema = z
  .object({
    rank: z.int().min(1),
    name: z.union([z.string(), z.null()]).openapi({
      description: "The player's display name; null for a player who hasn't chosen one.",
    }),
    timeMs: Ms,
    me: z.boolean().openapi({ description: "This row is the logged-in player's." }),
  })
  .openapi("LeaderboardEntry");

export const LeaderboardSchema = z
  .object({
    area: z.int(),
    level: z.int(),
    total: z.int().min(0).openapi({ description: "How many players are on the board." }),
    entries: z.array(LeaderboardEntrySchema).openapi({
      description:
        "The top `limit` rows, then the logged-in player's row and its neighbours, by rank.",
    }),
    me: z.union([LeaderboardEntrySchema, z.null()]),
  })
  .openapi("Leaderboard", {
    description: "Ranked solves by time, without hinted ones (PRD FR-23).",
  });

/**
 * ASCII letters and digits, and _ . -, with at least one letter or digit; 3 to 20 characters once
 * trimmed. ASCII only, so names that differ only in case, or look alike in another script, can't
 * pass for each other (DECISIONS, "Display names").
 */
const Name = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.-]{3,20}$/, "Use 3 to 20 of A–Z, 0–9, _ . or -.")
  .refine((name) => /[A-Za-z0-9]/.test(name), "Use at least one letter or digit.");

export const DisplayNameSchema = z
  .object({ displayName: z.union([z.string(), z.null()]) })
  .openapi("DisplayName", { description: "The name shown on leaderboards; null for none." });

export const SetDisplayNameRequestSchema = z
  .strictObject({ displayName: z.union([Name, z.null()]) })
  .openapi("SetDisplayNameRequest");
````

**Create `apps/server/src/api/daily.ts`**:

````ts
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { LeaderboardEntry } from "../domain.ts";
import type { AttemptManager, AttemptView } from "../managers/attempt-manager.ts";
import type { DailyManager } from "../managers/daily-manager.ts";
import type { DisplayNameManager } from "../managers/display-name-manager.ts";
import type { Leaderboard, LeaderboardManager } from "../managers/leaderboard-manager.ts";
import type { SessionManager } from "../managers/session-manager.ts";
import type { RateLimiter, RateRule } from "../ports.ts";
import { tooManyRequests } from "./accounts.ts";
import {
  AttemptParamSchema,
  AttemptResultSchema,
  BucketBoardParamSchema,
  BucketBoardQuerySchema,
  DailyQuerySchema,
  DailySetSchema,
  DailySummarySchema,
  DisplayNameSchema,
  FinishAttemptRequestSchema,
  LeaderboardQuerySchema,
  LeaderboardSchema,
  PuzzleBoardParamSchema,
  SetDisplayNameRequestSchema,
  StartedAttemptSchema,
  UserParamSchema,
} from "./daily-schemas.ts";
import { problem, problemResponse } from "./problem.ts";
import { currentUser } from "./session-cookie.ts";

export interface DailyRouteDeps {
  readonly dailies: DailyManager;
  readonly attempts: AttemptManager;
  readonly leaderboards: LeaderboardManager;
  readonly displayNames: DisplayNameManager;
  readonly sessions: SessionManager;
  readonly limiter: RateLimiter;
}

/** Requests per user to the routes for their own daily data. */
const PLAYER_LIMIT: RateRule = { limit: 120, windowMs: 60_000 };

const notLoggedIn = problemResponse("Not logged in.");
const otherUser = problemResponse(
  "The path names another user, or the request came from another site (CSRF protection).",
);
const unconfirmed = problemResponse(
  "The path names another user, the email isn't confirmed, or the request came from another site (CSRF protection).",
);
const tooMany = problemResponse("Too many requests; `Retry-After` says when to try again.");
const noDaily = problemResponse("No daily puzzle with this id that players can see.");

const dailyRoute = createRoute({
  method: "get",
  path: "/api/daily",
  summary: "A day's daily puzzles, one per size class (today by default)",
  request: { query: DailyQuerySchema },
  responses: {
    200: {
      description: "The puzzles.",
      content: { "application/json": { schema: DailySetSchema } },
    },
    400: problemResponse("Invalid day."),
    404: problemResponse("A day still to come."),
  },
});

const summaryRoute = createRoute({
  method: "get",
  path: "/api/users/{userId}/daily",
  summary: "The logged-in player's streak, last week, today's attempts and best times",
  security: [{ session: [] }],
  request: { params: UserParamSchema },
  responses: {
    200: {
      description: "The summary.",
      content: { "application/json": { schema: DailySummarySchema } },
    },
    400: problemResponse("Invalid id."),
    401: notLoggedIn,
    403: otherUser,
    429: tooMany,
  },
});

const getAttemptRoute = createRoute({
  method: "get",
  path: "/api/users/{userId}/attempts/{puzzleId}",
  summary: "The logged-in player's ranked attempt at a daily puzzle",
  security: [{ session: [] }],
  request: { params: AttemptParamSchema },
  responses: {
    200: {
      description: "The attempt, or null.",
      content: { "application/json": { schema: AttemptResultSchema } },
    },
    400: problemResponse("Invalid id."),
    401: notLoggedIn,
    403: otherUser,
    404: noDaily,
    429: tooMany,
  },
});

const startRoute = createRoute({
  method: "post",
  path: "/api/users/{userId}/attempts/{puzzleId}",
  summary: "Start a ranked attempt at today's daily puzzle",
  description:
    "One attempt per player and daily (PRD FR-25): the clock starts on the server now and doesn't stop. Starting again returns the attempt already started. Needs a confirmed email.",
  security: [{ session: [] }],
  request: { params: AttemptParamSchema },
  responses: {
    200: {
      description: "The attempt.",
      content: { "application/json": { schema: StartedAttemptSchema } },
    },
    400: problemResponse("Invalid id."),
    401: notLoggedIn,
    403: unconfirmed,
    404: noDaily,
    409: problemResponse("The daily's day is over: it can be played, but not ranked."),
    429: tooMany,
  },
});

const finishRoute = createRoute({
  method: "post",
  path: "/api/users/{userId}/attempts/{puzzleId}/finish",
  summary: "Finish a ranked attempt with the solved board",
  description:
    "The server checks the board against the stored solution (PRD FR-17, FR-25) and sets the ranked time: the player's own time, but never more than a tenth of the server's time (3 to 15 s) under it. A solve is ranked unless a hint was used or it was faster than the loop can be drawn. Sending it again returns the finished attempt unchanged.",
  security: [{ session: [] }],
  request: {
    params: AttemptParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: FinishAttemptRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "The finished attempt, with its rank.",
      content: { "application/json": { schema: StartedAttemptSchema } },
    },
    400: problemResponse("Invalid body, a board that doesn't fit, or not the solution."),
    401: notLoggedIn,
    403: unconfirmed,
    404: problemResponse("No such daily, or no attempt started at it."),
    413: problemResponse("Request body larger than 64 KiB."),
    415: problemResponse("Request body is not JSON."),
    429: tooMany,
  },
});

const puzzleBoardRoute = createRoute({
  method: "get",
  path: "/api/leaderboards/daily/{puzzleId}",
  summary: "A daily puzzle's leaderboard",
  description:
    "Ranked solves by time; ties go to whoever finished first. When logged in, the player's own row and its neighbours are included even outside the top.",
  request: { params: PuzzleBoardParamSchema, query: LeaderboardQuerySchema },
  responses: {
    200: {
      description: "The leaderboard.",
      content: { "application/json": { schema: LeaderboardSchema } },
    },
    400: problemResponse("Invalid id or query."),
    404: noDaily,
  },
});

const bucketBoardRoute = createRoute({
  method: "get",
  path: "/api/leaderboards/areas/{area}",
  summary: "The all-time leaderboard of one area and level",
  description:
    "Each player's best ranked time on daily puzzles of this area (width × height) and level (PRD FR-23).",
  request: { params: BucketBoardParamSchema, query: BucketBoardQuerySchema },
  responses: {
    200: {
      description: "The leaderboard.",
      content: { "application/json": { schema: LeaderboardSchema } },
    },
    400: problemResponse("Invalid area or query."),
  },
});

const getNameRoute = createRoute({
  method: "get",
  path: "/api/users/{userId}/display-name",
  summary: "The name the logged-in player shows on leaderboards",
  security: [{ session: [] }],
  request: { params: UserParamSchema },
  responses: {
    200: {
      description: "The name, or null.",
      content: { "application/json": { schema: DisplayNameSchema } },
    },
    400: problemResponse("Invalid id."),
    401: notLoggedIn,
    403: otherUser,
    429: tooMany,
  },
});

const setNameRoute = createRoute({
  method: "put",
  path: "/api/users/{userId}/display-name",
  summary: "Choose, change or remove the name shown on leaderboards",
  description:
    "3 to 20 of A–Z, a–z, 0–9, _ . or -, with at least one letter or digit. Names are public and unique, ignoring case. Null removes it: the player then shows as anonymous.",
  security: [{ session: [] }],
  request: {
    params: UserParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: SetDisplayNameRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "The name now.",
      content: { "application/json": { schema: DisplayNameSchema } },
    },
    400: problemResponse("Invalid body, or a name that can't be used."),
    401: notLoggedIn,
    403: otherUser,
    409: problemResponse("Another player has this name."),
    413: problemResponse("Request body larger than 64 KiB."),
    415: problemResponse("Request body is not JSON."),
    429: tooMany,
  },
});

/** Daily puzzles, ranked attempts, leaderboards and display names (PRD FR-17, FR-22 to FR-25). */
export function registerDailyRoutes(app: OpenAPIHono, deps: DailyRouteDeps): void {
  const { dailies, attempts, leaderboards, displayNames, sessions, limiter } = deps;

  /**
   * The logged-in user when the path names them, or the error response to send (as for saved
   * progress). With `confirmed`, the email must be confirmed too (DECISIONS, "What unconfirmed
   * accounts can do").
   */
  async function owner(c: Context, userId: string, confirmed = false) {
    const user = await currentUser(c, sessions);
    if (user === null) return { error: problem(c, 401, "Not logged in") };
    if (user.id !== userId) {
      return {
        error: problem(c, 403, "Logged in as someone else", {
          detail: "This belongs to another account. Reload the page.",
        }),
      };
    }
    if (confirmed && user.emailVerifiedAt === null) {
      return {
        error: problem(c, 403, "Email not confirmed", {
          detail: "Confirm your email address to play ranked.",
        }),
      };
    }
    const decision = limiter.hit(`daily:${user.id}`, PLAYER_LIMIT);
    if (!decision.allowed) return { error: tooManyRequests(c, decision.retryAfterMs) };
    return { user };
  }

  app.openapi(dailyRoute, (c) => {
    const set = dailies.forDay(c.req.valid("query").day);
    return c.json({ ...set, nextAt: iso(set.nextAt), puzzles: [...set.puzzles] }, 200);
  });

  app.openapi(summaryRoute, async (c) => {
    const { user, error } = await owner(c, c.req.valid("param").userId);
    if (error) return error;
    const s = attempts.summary(user.id);
    return c.json(
      {
        day: s.day,
        streak: s.streak,
        week: [...s.week],
        attempts: s.attempts.map(toAttemptDto),
        bests: [...s.bests],
      },
      200,
    );
  });

  app.openapi(getAttemptRoute, async (c) => {
    const { userId, puzzleId } = c.req.valid("param");
    const { user, error } = await owner(c, userId);
    if (error) return error;
    const view = attempts.get(user.id, puzzleId);
    return c.json({ attempt: view === null ? null : toAttemptDto(view) }, 200);
  });

  app.openapi(startRoute, async (c) => {
    const { userId, puzzleId } = c.req.valid("param");
    const { user, error } = await owner(c, userId, true);
    if (error) return error;
    return c.json({ attempt: toAttemptDto(attempts.start(user.id, puzzleId)) }, 200);
  });

  app.openapi(finishRoute, async (c) => {
    const { userId, puzzleId } = c.req.valid("param");
    const { user, error } = await owner(c, userId, true);
    if (error) return error;
    const view = await attempts.finish(user.id, puzzleId, c.req.valid("json"));
    return c.json({ attempt: toAttemptDto(view) }, 200);
  });

  app.openapi(puzzleBoardRoute, async (c) => {
    const viewer = await currentUser(c, sessions);
    const board = leaderboards.forPuzzle(
      c.req.valid("param").puzzleId,
      viewer?.id ?? null,
      c.req.valid("query").limit,
    );
    return c.json(toLeaderboardDto(board, viewer?.id ?? null), 200);
  });

  app.openapi(bucketBoardRoute, async (c) => {
    const viewer = await currentUser(c, sessions);
    const { level, limit } = c.req.valid("query");
    const board = leaderboards.forBucket(
      c.req.valid("param").area,
      level,
      viewer?.id ?? null,
      limit,
    );
    return c.json(toLeaderboardDto(board, viewer?.id ?? null), 200);
  });

  app.openapi(getNameRoute, async (c) => {
    const { user, error } = await owner(c, c.req.valid("param").userId);
    if (error) return error;
    return c.json({ displayName: displayNames.get(user.id) }, 200);
  });

  app.openapi(setNameRoute, async (c) => {
    const { user, error } = await owner(c, c.req.valid("param").userId);
    if (error) return error;
    const displayName = displayNames.set(user.id, c.req.valid("json").displayName);
    return c.json({ displayName }, 200);
  });
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function toAttemptDto({ attempt: a, elapsedMs, rank }: AttemptView) {
  return {
    puzzleId: a.puzzleId,
    day: a.day,
    area: a.area,
    level: a.level,
    status: a.finishedAt === null ? ("playing" as const) : ("finished" as const),
    startedAt: iso(a.startedAt),
    finishedAt: a.finishedAt === null ? null : iso(a.finishedAt),
    elapsedMs,
    assisted: a.assisted,
    ranked: a.ranked,
    rank,
  };
}

/** Player ids never leave the server: a row says only whether it is the viewer's. */
function toLeaderboardDto(board: Leaderboard, viewerId: string | null) {
  const entry = (e: LeaderboardEntry) => ({
    rank: e.rank,
    name: e.name,
    timeMs: e.timeMs,
    me: e.userId === viewerId,
  });
  return {
    area: board.area,
    level: board.level,
    total: board.total,
    entries: board.entries.map(entry),
    me: board.me === null ? null : entry(board.me),
  };
}
````

**Edit `apps/server/src/api/schemas.ts`**: 1 replacement, in order.

1. Find:
````ts
        description: "The first edge marked differently from the solution.",
      }),
      count: z.int().min(1).openapi({ description: "How many marks are wrong." }),
    }),
    z.object({
````
   Replace with:
````ts
        description: "The first edge marked differently from the solution.",
      }),
      count: z.int().min(1).openapi({
        description:
          "How many marks are wrong. Always 1 on today's daily puzzles, so a hint can't be used to check a whole board.",
      }),
    }),
    z.object({
````

**Edit `apps/server/src/api/app.ts`**: 7 replacements, in order.

1. Find:
````ts
import type { Job, PuzzleRecord } from "../domain.ts";
import {
  CaptchaFailedError,
  InvalidBoardError,
  InvalidCredentialsError,
  InvalidTokenError,
  PuzzleNotFoundError,
  QueueFullError,
  RateLimitedError,
} from "../managers/errors.ts";
import type { HintManager } from "../managers/hint-manager.ts";
````
   Replace with:
````ts
import type { Job, PuzzleRecord } from "../domain.ts";
import {
  AttemptNotFoundError,
  CaptchaFailedError,
  DailyEndedError,
  DailyNotFoundError,
  DisplayNameTakenError,
  InvalidBoardError,
  InvalidCredentialsError,
  InvalidDisplayNameError,
  InvalidTokenError,
  PuzzleNotFoundError,
  QueueFullError,
  RateLimitedError,
  WrongSolutionError,
} from "../managers/errors.ts";
import type { HintManager } from "../managers/hint-manager.ts";
````

2. Find:
````ts
import { type AccountRouteDeps, registerAccountRoutes, tooManyRequests } from "./accounts.ts";
import { sameOriginOnly } from "./csrf.ts";
import { problem, problemResponse } from "./problem.ts";
import { registerProgressRoutes } from "./progress.ts";
````
   Replace with:
````ts
import { type AccountRouteDeps, registerAccountRoutes, tooManyRequests } from "./accounts.ts";
import { sameOriginOnly } from "./csrf.ts";
import { type DailyRouteDeps, registerDailyRoutes } from "./daily.ts";
import { problem, problemResponse } from "./problem.ts";
import { registerProgressRoutes } from "./progress.ts";
````

3. Find:
````ts
import { registerSubmissionRoutes, type SubmissionRouteDeps } from "./submissions.ts";

export interface AppDeps extends AccountRouteDeps, SubmissionRouteDeps, ReportRouteDeps {
  readonly puzzles: PuzzleManager;
  readonly jobs: JobManager;
````
   Replace with:
````ts
import { registerSubmissionRoutes, type SubmissionRouteDeps } from "./submissions.ts";

export interface AppDeps
  extends AccountRouteDeps,
    SubmissionRouteDeps,
    ReportRouteDeps,
    DailyRouteDeps {
  readonly puzzles: PuzzleManager;
  readonly jobs: JobManager;
````

4. Find:
````ts
  summary: "The next hint for a player's board",
  description:
    "Works from the player's marks and the stored solution, which is never sent (PRD FR-12, FR-25).",
  request: {
    params: IdParamSchema,
````
   Replace with:
````ts
  summary: "The next hint for a player's board",
  description:
    "Works from the player's marks and the stored solution, which is never sent (PRD FR-12, FR-25). For a logged-in player, it marks their ranked attempt at the puzzle as assisted.",
  request: {
    params: IdParamSchema,
````

5. Find:
````ts
  app.openapi(hintRoute, async (c) => {
    const hint = await hints.hint(c.req.valid("param").id, c.req.valid("json").edges);
    if (hint === null) return problem(c, 404, "Puzzle not found");
    return c.json(toHintDto(hint), 200);
````
   Replace with:
````ts
  app.openapi(hintRoute, async (c) => {
    const user = await currentUser(c, deps.sessions);
    const { id } = c.req.valid("param");
    const hint = await hints.hint(id, c.req.valid("json").edges, user?.id ?? null);
    if (hint === null) return problem(c, 404, "Puzzle not found");
    return c.json(toHintDto(hint), 200);
````

6. Find:
````ts
  registerSubmissionRoutes(app, deps);
  registerReportRoutes(app, deps);

  app.all("/api/*", (c) => problem(c, 404, "Not found"));
````
   Replace with:
````ts
  registerSubmissionRoutes(app, deps);
  registerReportRoutes(app, deps);
  registerDailyRoutes(app, deps);

  app.all("/api/*", (c) => problem(c, 404, "Not found"));
````

7. Find:
````ts
    if (err instanceof InvalidTokenError)
      return problem(c, 400, "Invalid or expired link", { detail: err.message });
    if (err instanceof RateLimitedError) return tooManyRequests(c, err.retryAfterMs);
    if (err instanceof HTTPException) return problem(c, err.status, err.message);
````
   Replace with:
````ts
    if (err instanceof InvalidTokenError)
      return problem(c, 400, "Invalid or expired link", { detail: err.message });
    if (err instanceof DailyNotFoundError)
      return problem(c, 404, "Daily puzzle not found", { detail: err.message });
    if (err instanceof DailyEndedError)
      return problem(c, 409, "Daily is over", { detail: err.message });
    if (err instanceof AttemptNotFoundError)
      return problem(c, 404, "Attempt not found", { detail: err.message });
    if (err instanceof WrongSolutionError)
      return problem(c, 400, "Not the solution", { detail: err.message });
    if (err instanceof InvalidDisplayNameError)
      return problem(c, 400, "Name not allowed", { detail: err.message });
    if (err instanceof DisplayNameTakenError)
      return problem(c, 409, "Name taken", { detail: err.message });
    if (err instanceof RateLimitedError) return tooManyRequests(c, err.retryAfterMs);
    if (err instanceof HTTPException) return problem(c, err.status, err.message);
````

**Edit `apps/server/src/api/main.ts`**: 4 replacements, in order.

1. Find:
````ts
import { systemClock } from "../adapters/clock.ts";
import { SqliteAccountTokenRepository } from "../adapters/db/account-token-repository.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqliteProgressRepository } from "../adapters/db/progress-repository.ts";
````
   Replace with:
````ts
import { systemClock } from "../adapters/clock.ts";
import { SqliteAccountTokenRepository } from "../adapters/db/account-token-repository.ts";
import { SqliteAttemptRepository } from "../adapters/db/attempt-repository.ts";
import { SqliteDailyRepository } from "../adapters/db/daily-repository.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteDisplayNameRepository } from "../adapters/db/display-name-repository.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqliteProgressRepository } from "../adapters/db/progress-repository.ts";
````

2. Find:
````ts
import { loadConfig } from "../config.ts";
import { AccountManager } from "../managers/account-manager.ts";
import { HintManager } from "../managers/hint-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { ProgressManager } from "../managers/progress-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
````
   Replace with:
````ts
import { loadConfig } from "../config.ts";
import { AccountManager } from "../managers/account-manager.ts";
import { AttemptManager } from "../managers/attempt-manager.ts";
import { DailyManager } from "../managers/daily-manager.ts";
import { DisplayNameManager } from "../managers/display-name-manager.ts";
import { HintManager } from "../managers/hint-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { LeaderboardManager } from "../managers/leaderboard-manager.ts";
import { ProgressManager } from "../managers/progress-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
````

3. Find:
````ts
  publicUrl: config.publicUrl,
});
const hints = new HintManager({ puzzles });
const progress = new ProgressManager({
  progress: new SqliteProgressRepository(db),
````
   Replace with:
````ts
  publicUrl: config.publicUrl,
});
const dailies = new DailyManager({
  dailies: new SqliteDailyRepository(db),
  puzzles,
  clock: systemClock,
});
const attemptRepo = new SqliteAttemptRepository(db);
const attempts = new AttemptManager({
  attempts: attemptRepo,
  dailies,
  puzzles,
  clock: systemClock,
});
const leaderboards = new LeaderboardManager({ attempts: attemptRepo, dailies, puzzles });
const displayNames = new DisplayNameManager({
  names: new SqliteDisplayNameRepository(db),
  limiter,
  clock: systemClock,
});
const hints = new HintManager({ puzzles, attempts });
const progress = new ProgressManager({
  progress: new SqliteProgressRepository(db),
````

4. Find:
````ts
  submissions,
  reports,

  accounts,
  sessions,
````
   Replace with:
````ts
  submissions,
  reports,
  dailies,
  attempts,
  leaderboards,
  displayNames,
  accounts,
  sessions,
````

**Edit `apps/server/src/api/spec.ts`**: 5 replacements, in order.

1. Find:
````ts
import { systemClock } from "../adapters/clock.ts";
import { SqliteAccountTokenRepository } from "../adapters/db/account-token-repository.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqliteProgressRepository } from "../adapters/db/progress-repository.ts";
````
   Replace with:
````ts
import { systemClock } from "../adapters/clock.ts";
import { SqliteAccountTokenRepository } from "../adapters/db/account-token-repository.ts";
import { SqliteAttemptRepository } from "../adapters/db/attempt-repository.ts";
import { SqliteDailyRepository } from "../adapters/db/daily-repository.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteDisplayNameRepository } from "../adapters/db/display-name-repository.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqliteProgressRepository } from "../adapters/db/progress-repository.ts";
````

2. Find:
````ts
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import { AccountManager } from "../managers/account-manager.ts";
import { HintManager } from "../managers/hint-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { ProgressManager } from "../managers/progress-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
````
   Replace with:
````ts
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import { AccountManager } from "../managers/account-manager.ts";
import { AttemptManager } from "../managers/attempt-manager.ts";
import { DailyManager } from "../managers/daily-manager.ts";
import { DisplayNameManager } from "../managers/display-name-manager.ts";
import { HintManager } from "../managers/hint-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { LeaderboardManager } from "../managers/leaderboard-manager.ts";
import { ProgressManager } from "../managers/progress-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
````

3. Find:
````ts
    maxQueued: 1,
  });
  const app = createApp({
    accounts: new AccountManager({
````
   Replace with:
````ts
    maxQueued: 1,
  });
  const dailies = new DailyManager({
    dailies: new SqliteDailyRepository(db),
    puzzles,
    clock: systemClock,
  });
  const attemptRepo = new SqliteAttemptRepository(db);
  const attempts = new AttemptManager({
    attempts: attemptRepo,
    dailies,
    puzzles,
    clock: systemClock,
  });
  const app = createApp({
    accounts: new AccountManager({
````

4. Find:
````ts
    turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
    puzzles,
    hints: new HintManager({ puzzles }),
    progress: new ProgressManager({
      progress: new SqliteProgressRepository(db),
````
   Replace with:
````ts
    turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
    puzzles,
    hints: new HintManager({ puzzles, attempts }),
    dailies,
    attempts,
    leaderboards: new LeaderboardManager({ attempts: attemptRepo, dailies, puzzles }),
    displayNames: new DisplayNameManager({
      names: new SqliteDisplayNameRepository(db),
      limiter,
      clock: systemClock,
    }),
    progress: new ProgressManager({
      progress: new SqliteProgressRepository(db),
````

5. Find:
````ts
      version: "0.1.0",
      description:
        "Puzzles, background jobs, accounts, saved progress, submitted puzzles and reports. Errors are RFC 9457 problem details. State-changing requests from other sites are refused (403).",
    },
  });
````
   Replace with:
````ts
      version: "0.1.0",
      description:
        "Puzzles, background jobs, accounts, saved progress, submitted puzzles and reports, daily puzzles, ranked attempts and leaderboards. Errors are RFC 9457 problem details. State-changing requests from other sites are refused (403).",
    },
  });
````

**Edit `apps/server/src/api/accounts.test.ts`**: 2 replacements, in order.

1. Find:
````ts
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { HintManager } from "../managers/hint-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { sqliteProgress } from "../test-support/progress.ts";
````
   Replace with:
````ts
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps } from "../test-support/daily.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { sqliteProgress } from "../test-support/progress.ts";
````

2. Find:
````ts
  const app = createApp({
    puzzles,
    hints: new HintManager({ puzzles }),
    progress: sqliteProgress(db, puzzles, clock),
    jobs,
````
   Replace with:
````ts
  const app = createApp({
    puzzles,
    ...dailyDeps(db, clock, puzzles),
    progress: sqliteProgress(db, puzzles, clock),
    jobs,
````

**Edit `apps/server/src/api/app.test.ts`**: 2 replacements, in order.

1. Find:
````ts
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { HintManager } from "../managers/hint-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { sqliteProgress } from "../test-support/progress.ts";
````
   Replace with:
````ts
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps } from "../test-support/daily.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { sqliteProgress } from "../test-support/progress.ts";
````

2. Find:
````ts
    jobs,
    ...accountDeps(db, clock),
    hints: new HintManager({ puzzles }),
    progress: sqliteProgress(db, puzzles, clock),
    ...submissionDeps(db, clock, puzzles, jobs),
````
   Replace with:
````ts
    jobs,
    ...accountDeps(db, clock),
    ...dailyDeps(db, clock, puzzles),
    progress: sqliteProgress(db, puzzles, clock),
    ...submissionDeps(db, clock, puzzles, jobs),
````

**Edit `apps/server/src/api/progress.test.ts`**: 2 replacements, in order.

1. Find:
````ts
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { HintManager } from "../managers/hint-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { sqliteProgress } from "../test-support/progress.ts";
````
   Replace with:
````ts
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps } from "../test-support/daily.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { sqliteProgress } from "../test-support/progress.ts";
````

2. Find:
````ts
  const app = createApp({
    puzzles,
    hints: new HintManager({ puzzles }),
    progress: sqliteProgress(db, puzzles, clock),
    jobs,
````
   Replace with:
````ts
  const app = createApp({
    puzzles,
    ...dailyDeps(db, clock, puzzles),
    progress: sqliteProgress(db, puzzles, clock),
    jobs,
````

**Edit `apps/server/src/api/submissions.test.ts`**: 3 replacements, in order.

1. Find:
````ts
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { HintManager } from "../managers/hint-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
````
   Replace with:
````ts
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
````

2. Find:
````ts
import { SUBMISSIONS_PER_ACCOUNT } from "../managers/submission-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { sqliteProgress } from "../test-support/progress.ts";
````
   Replace with:
````ts
import { SUBMISSIONS_PER_ACCOUNT } from "../managers/submission-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps } from "../test-support/daily.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { sqliteProgress } from "../test-support/progress.ts";
````

3. Find:
````ts
    puzzles,
    jobs,
    hints: new HintManager({ puzzles }),
    progress: sqliteProgress(db, puzzles, clock),
    ...submissionDeps(db, clock, puzzles, jobs),
````
   Replace with:
````ts
    puzzles,
    jobs,
    ...dailyDeps(db, clock, puzzles),
    progress: sqliteProgress(db, puzzles, clock),
    ...submissionDeps(db, clock, puzzles, jobs),
````

**Edit `apps/server/src/worker/flow.test.ts`** (the API side; step A6 adds the worker side): 3 replacements, in order.

1. Find:
````ts
import { ThreadTaskRunner } from "../adapters/tasks/thread-task-runner.ts";
import { createApp } from "../api/app.ts";
import { HintManager } from "../managers/hint-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { JobRunManager } from "../managers/job-run-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";
````
   Replace with:
````ts
import { ThreadTaskRunner } from "../adapters/tasks/thread-task-runner.ts";
import { createApp } from "../api/app.ts";
import { JobManager } from "../managers/job-manager.ts";
import { JobRunManager } from "../managers/job-run-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps } from "../test-support/daily.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";
````

2. Find:
````ts
    },
  });
  const hints = new HintManager({ puzzles });
  const accounts = accountDeps(db, systemClock);
  accounts.users.insert({
````
   Replace with:
````ts
    },
  });
  const accounts = accountDeps(db, systemClock);
  accounts.users.insert({
````

3. Find:
````ts
      puzzles,
      jobs,
      hints,
      progress: sqliteProgress(db, puzzles, systemClock),
      submissions,
````
   Replace with:
````ts
      puzzles,
      jobs,
      ...dailyDeps(db, systemClock, puzzles),
      progress: sqliteProgress(db, puzzles, systemClock),
      submissions,
````

**Create `apps/server/src/api/daily.test.ts`**:

````ts
import { describe, expect, test } from "bun:test";
import type { z } from "@hono/zod-openapi";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps, SMALL_DAILY, storeDaily } from "../test-support/daily.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";
import { createApp } from "./app.ts";
import type { DailySetSchema, DailySummarySchema, LeaderboardSchema } from "./daily-schemas.ts";
import type { Problem } from "./problem.ts";
import type { PuzzleSchema } from "./schemas.ts";
import { SESSION_COOKIE } from "./session-cookie.ts";

type DailySet = z.infer<typeof DailySetSchema>;
type DailySummary = z.infer<typeof DailySummarySchema>;
type Leaderboard = z.infer<typeof LeaderboardSchema>;
type Puzzle = z.infer<typeof PuzzleSchema>;

// The test dailies are 2×2 all 2s; the only loop runs around the outside.
const SOLVED = SMALL_DAILY.solution;
const EMPTY = "000000000000";
const MIDNIGHT = Date.UTC(2026, 9, 26);
const T0 = MIDNIGHT - 2 * 60 * 60 * 1000;

async function setup() {
  const db = openDatabase(":memory:");
  const clock = new FakeClock(T0);
  const deps = accountDeps(db, clock);
  const puzzles = new PuzzleManager({
    puzzles: new SqlitePuzzleRepository(db),
    blobs: new MemoryBlobStore(),
    clock,
  });
  const jobs = new JobManager({
    jobs: new SqliteJobQueue(db),
    clock,
    newId: sequentialIds("j"),
    maxQueued: 10,
  });
  const daily = dailyDeps(db, clock, puzzles);
  await storeDaily(daily.dailyRepo, puzzles, "2026-10-24", "d24");
  await storeDaily(daily.dailyRepo, puzzles, "2026-10-25", "d25");
  await storeDaily(daily.dailyRepo, puzzles, "2026-10-26", "d26");
  const app = createApp({
    puzzles,
    jobs,
    progress: sqliteProgress(db, puzzles, clock),
    ...submissionDeps(db, clock, puzzles, jobs),
    ...daily,
    ...deps,
  });

  /** A request as the web app sends it: JSON, same origin, with an optional session cookie. */
  const send = (
    method: string,
    path: string,
    body?: unknown,
    options: { cookie?: string; headers?: Record<string, string> } = {},
  ) => {
    const headers: Record<string, string> = { "Sec-Fetch-Site": "same-origin", ...options.headers };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (options.cookie !== undefined) headers.Cookie = `${SESSION_COOKIE}=${options.cookie}`;
    const env = { requestIP: () => ({ address: "198.51.100.7" }) };
    return app.request(
      path,
      { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      env,
    );
  };

  /** Signs up and logs in `email`, confirming it unless told not to. */
  const player = async (email: string, confirm = true) => {
    await send("POST", "/api/auth/signup", { email, password: "hunter22", captchaToken: "cap" });
    const user = deps.users.getByEmail(email);
    if (user === null) throw new Error("no user");
    if (confirm) deps.users.markEmailVerified(user.id, 1);
    const res = await send("POST", "/api/auth/login", { email, password: "hunter22" });
    const cookie = res.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
      ?.split(";")[0]
      .slice(SESSION_COOKIE.length + 1);
    if (cookie === undefined) throw new Error("no session cookie");
    return { id: user.id, cookie };
  };

  /** Starts and finishes a ranked attempt at d25 after `ms`. */
  const solve = async (who: { id: string; cookie: string }, ms: number) => {
    const path = `/api/users/${who.id}/attempts/d25`;
    await send("POST", path, undefined, { cookie: who.cookie });
    clock.advance(ms);
    return send("POST", `${path}/finish`, { edges: SOLVED, elapsedMs: ms }, { cookie: who.cookie });
  };

  return { db, clock, deps, send, player, solve };
}

async function expectProblem(res: Response, status: number, title?: string): Promise<Problem> {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toStartWith("application/problem+json");
  const body = (await res.json()) as Problem;
  if (title !== undefined) expect(body.title).toBe(title);
  return body;
}

describe("GET /api/daily (FR-22)", () => {
  test("lists today's puzzles by size, and switches at 00:00 UTC", async () => {
    const { clock, send } = await setup();
    expect(await (await send("GET", "/api/daily")).json()).toEqual({
      day: "2026-10-25",
      live: true,
      nextAt: "2026-10-26T00:00:00.000Z",
      puzzles: [
        { size: 7, puzzleId: "d25" },
        { size: 10, puzzleId: null },
        { size: 20, puzzleId: null },
        { size: 40, puzzleId: null },
      ],
    });
    const past = (await (await send("GET", "/api/daily?day=2026-10-24")).json()) as DailySet;
    expect(past).toMatchObject({ day: "2026-10-24", live: false });
    expect(past.puzzles[0]).toEqual({ size: 7, puzzleId: "d24" });
    await expectProblem(await send("GET", "/api/daily?day=2026-10-26"), 404);
    await expectProblem(await send("GET", "/api/daily?day=2026-02-30"), 400);
    clock.time = MIDNIGHT;
    const next = (await (await send("GET", "/api/daily")).json()) as DailySet;
    expect(next).toMatchObject({ day: "2026-10-26", live: true });
    expect(next.puzzles[0]).toEqual({ size: 7, puzzleId: "d26" });
  });

  test("a daily is served with clues only, no seed or generator version, and only from its day (FR-25)", async () => {
    const { clock, send } = await setup();
    const res = await send("GET", "/api/puzzles/d25");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Puzzle;
    expect(body.puzzle).toEqual({ v: 1, width: 2, height: 2, clues: "2222" });
    const text = JSON.stringify(body);
    expect(text).not.toContain("secret-seed");
    expect(text).not.toContain(SOLVED);
    // Tomorrow's is hidden from the puzzle, hint and progress routes until midnight.
    await expectProblem(await send("GET", "/api/puzzles/d26"), 404);
    await expectProblem(await send("POST", "/api/puzzles/d26/hint", { edges: EMPTY }), 404);
    // Dailies aren't in the practice list.
    expect(await (await send("GET", "/api/puzzles")).json()).toEqual({ items: [] });
    clock.time = MIDNIGHT;
    expect((await send("GET", "/api/puzzles/d26")).status).toBe(200);
  });
});

describe("ranked attempts (FR-17, FR-25)", () => {
  test("start, finish with the solution, and read back with a rank", async () => {
    const { clock, send, player } = await setup();
    const ann = await player("ann@example.com");
    const path = `/api/users/${ann.id}/attempts/d25`;
    expect(await (await send("GET", path, undefined, { cookie: ann.cookie })).json()).toEqual({
      attempt: null,
    });
    const started = await send("POST", path, undefined, { cookie: ann.cookie });
    expect(started.status).toBe(200);
    expect(await started.json()).toEqual({
      attempt: {
        puzzleId: "d25",
        day: "2026-10-25",
        area: 4,
        level: 1,
        status: "playing",
        startedAt: new Date(T0).toISOString(),
        finishedAt: null,
        elapsedMs: 0,
        assisted: false,
        ranked: false,
        rank: null,
      },
    });
    clock.advance(65_000);
    const finished = await send(
      "POST",
      `${path}/finish`,
      { edges: SOLVED, elapsedMs: 64_000 },
      { cookie: ann.cookie },
    );
    expect(finished.status).toBe(200);
    expect(await finished.json()).toMatchObject({
      attempt: { status: "finished", elapsedMs: 64_000, ranked: true, rank: 1 },
    });
    const summary = (await (
      await send("GET", `/api/users/${ann.id}/daily`, undefined, { cookie: ann.cookie })
    ).json()) as DailySummary;
    expect(summary).toMatchObject({
      day: "2026-10-25",
      streak: 1,
      attempts: [{ puzzleId: "d25", rank: 1 }],
      bests: [{ area: 4, level: 1, timeMs: 64_000 }],
    });
    expect(summary.week).toHaveLength(7);
  });

  test("a wrong board is refused, and the attempt can still be finished", async () => {
    const { clock, send, player } = await setup();
    const ann = await player("ann@example.com");
    const path = `/api/users/${ann.id}/attempts/d25`;
    await send("POST", path, undefined, { cookie: ann.cookie });
    clock.advance(60_000);
    const wrong = { edges: EMPTY, elapsedMs: 60_000 };
    await expectProblem(
      await send("POST", `${path}/finish`, wrong, { cookie: ann.cookie }),
      400,
      "Not the solution",
    );
    await expectProblem(
      await send("POST", `${path}/finish`, { edges: "12", elapsedMs: 1 }, { cookie: ann.cookie }),
      400,
      "Invalid board",
    );
    await expectProblem(
      await send("POST", `${path}/finish`, { edges: SOLVED }, { cookie: ann.cookie }),
      400,
      "Invalid request",
    );
    const ok = await send(
      "POST",
      `${path}/finish`,
      { edges: SOLVED, elapsedMs: 60_000 },
      { cookie: ann.cookie },
    );
    expect(ok.status).toBe(200);
  });

  test("needs a login, the player's own id, a confirmed email and a same-site request", async () => {
    const { send, player } = await setup();
    const ann = await player("ann@example.com");
    const ben = await player("ben@example.com", false);
    const path = `/api/users/${ann.id}/attempts/d25`;
    await expectProblem(await send("POST", path), 401);
    await expectProblem(await send("GET", `/api/users/${ann.id}/daily`), 401);
    await expectProblem(
      await send("POST", path, undefined, { cookie: ben.cookie }),
      403,
      "Logged in as someone else",
    );
    await expectProblem(
      await send("POST", `/api/users/${ben.id}/attempts/d25`, undefined, { cookie: ben.cookie }),
      403,
      "Email not confirmed",
    );
    // Unconfirmed players can still read their own (empty) summary.
    expect(
      (await send("GET", `/api/users/${ben.id}/daily`, undefined, { cookie: ben.cookie })).status,
    ).toBe(200);
    await expectProblem(
      await send("POST", path, undefined, {
        cookie: ann.cookie,
        headers: { "Sec-Fetch-Site": "cross-site" },
      }),
      403,
      "Cross-site request refused",
    );
  });

  test("only today's daily can be started", async () => {
    const { send, player } = await setup();
    const ann = await player("ann@example.com");
    const start = (id: string) =>
      send("POST", `/api/users/${ann.id}/attempts/${id}`, undefined, { cookie: ann.cookie });
    await expectProblem(await start("d24"), 409, "Daily is over");
    await expectProblem(await start("d26"), 404, "Daily puzzle not found");
    await expectProblem(await start("nope"), 404, "Daily puzzle not found");
    await expectProblem(
      await send(
        "POST",
        `/api/users/${ann.id}/attempts/d25/finish`,
        { edges: SOLVED, elapsedMs: 1 },
        { cookie: ann.cookie },
      ),
      404,
      "Attempt not found",
    );
  });

  test("a hint during the attempt marks it assisted, and it isn't ranked (FR-12)", async () => {
    const { clock, send, player } = await setup();
    const ann = await player("ann@example.com");
    const path = `/api/users/${ann.id}/attempts/d25`;
    await send("POST", path, undefined, { cookie: ann.cookie });
    const hint = await send(
      "POST",
      "/api/puzzles/d25/hint",
      { edges: "220000000000" },
      { cookie: ann.cookie },
    );
    // On today's daily the mistake count is capped, so it can't check a whole board.
    expect(await hint.json()).toEqual({ kind: "mistake", edge: 0, count: 1 });
    clock.advance(60_000);
    const done = await send(
      "POST",
      `${path}/finish`,
      { edges: SOLVED, elapsedMs: 60_000 },
      { cookie: ann.cookie },
    );
    expect(await done.json()).toMatchObject({
      attempt: { assisted: true, ranked: false, rank: null },
    });
    // A guest's hint changes nobody's attempt; yesterday's daily counts every wrong mark.
    expect(
      await (await send("POST", "/api/puzzles/d24/hint", { edges: "220000000000" })).json(),
    ).toEqual({ kind: "mistake", edge: 0, count: 2 });
  });
});

describe("leaderboards (FR-23)", () => {
  test("rank ranked solves by time, name players, mark the viewer and never show ids", async () => {
    const { send, player, solve } = await setup();
    const ann = await player("ann@example.com");
    const ben = await player("ben@example.com");
    await solve(ben, 50_000);
    await solve(ann, 70_000);
    const named = await send(
      "PUT",
      `/api/users/${ben.id}/display-name`,
      { displayName: "  tsuru " },
      { cookie: ben.cookie },
    );
    expect(await named.json()).toEqual({ displayName: "tsuru" });

    const res = await send("GET", "/api/leaderboards/daily/d25", undefined, { cookie: ann.cookie });
    const board = await res.json();
    expect(board).toEqual({
      area: 4,
      level: 1,
      total: 2,
      entries: [
        { rank: 1, name: "tsuru", timeMs: 50_000, me: false },
        { rank: 2, name: null, timeMs: 70_000, me: true },
      ],
      me: { rank: 2, name: null, timeMs: 70_000, me: true },
    });
    const text = JSON.stringify(board);
    expect(text).not.toContain(ann.id);
    expect(text).not.toContain("example.com");

    const guest = (await (
      await send("GET", "/api/leaderboards/areas/4?limit=1")
    ).json()) as Leaderboard;
    expect(guest).toMatchObject({ area: 4, level: 1, total: 2, me: null });
    expect(guest.entries).toEqual([{ rank: 1, name: "tsuru", timeMs: 50_000, me: false }]);
    await expectProblem(await send("GET", "/api/leaderboards/daily/d26"), 404);
    await expectProblem(await send("GET", "/api/leaderboards/areas/0"), 400);
  });

  test("deleting the account takes its entries off the boards and frees its name (NFR-6)", async () => {
    const { send, player, solve } = await setup();
    const ann = await player("ann@example.com");
    const ben = await player("ben@example.com");
    await solve(ann, 50_000);
    await solve(ben, 70_000);
    await send(
      "PUT",
      `/api/users/${ann.id}/display-name`,
      { displayName: "kuroneko" },
      {
        cookie: ann.cookie,
      },
    );
    const deleted = await send(
      "DELETE",
      "/api/account",
      { password: "hunter22" },
      {
        cookie: ann.cookie,
      },
    );
    expect(deleted.status).toBe(204);
    const board = (await (await send("GET", "/api/leaderboards/daily/d25")).json()) as Leaderboard;
    expect(board.entries).toEqual([{ rank: 1, name: null, timeMs: 70_000, me: false }]);
    const taken = await send(
      "PUT",
      `/api/users/${ben.id}/display-name`,
      {
        displayName: "Kuroneko",
      },
      { cookie: ben.cookie },
    );
    expect(taken.status).toBe(200);
  });
});

describe("display names", () => {
  test("are validated, unique ignoring case, and removable", async () => {
    const { send, player } = await setup();
    const ann = await player("ann@example.com", false);
    const ben = await player("ben@example.com");
    const path = `/api/users/${ann.id}/display-name`;
    const put = (displayName: unknown, cookie = ann.cookie, to = path) =>
      send("PUT", to, { displayName }, { cookie });
    expect(await (await send("GET", path, undefined, { cookie: ann.cookie })).json()).toEqual({
      displayName: null,
    });
    // ASCII only: "émile" next to "Émile", or a Cyrillic "а" in "kuroneko", would pass for another.
    for (const bad of [
      "ab",
      "x".repeat(21),
      "has space",
      "a@b.c",
      42,
      "Émile",
      "kurоneko",
      "...",
    ]) {
      await expectProblem(await put(bad), 400, "Invalid request");
    }
    await expectProblem(await put("You"), 400, "Name not allowed");
    expect((await put("Kuroneko")).status).toBe(200);
    await expectProblem(
      await put("kuroneko", ben.cookie, `/api/users/${ben.id}/display-name`),
      409,
      "Name taken",
    );
    await expectProblem(await put("tsuru", ben.cookie), 403);
    expect(await (await put(null)).json()).toEqual({ displayName: null });
    await expectProblem(await send("PUT", path, { displayName: "x1y2z3" }), 401);
  });
});
````

Then run `bun run gen:api` (rewrites `openapi.yaml` and `packages/api-client/src/schema.ts`).

**Verify:** `bun run check` (includes `check:api`). `bun test apps/server/src/api/daily.test.ts` covers auth, CSRF, validation, rollover and leaks.

**Commit:** `feat(server): daily, ranked attempt, leaderboard and display name routes`

### A6 Worker: the scheduler in the loop, daily jobs, settings

`JobRunManager` hands a `generate` job with `input.day` to `DailyStockManager.complete` instead of `saveGenerated` (tests pass `noDailies` or a recording stub). The worker loop runs `dailies.stock()` at start and every `stockMs` (60 s), logs what it queued, and logs an error for a size of today's still missing at two checks in a row. New settings: `DAILY_SEED_SECRET` (min 16 characters; the development default is refused unless `PUBLIC_URL` is on localhost) and `DAILY_DAYS_AHEAD` (1–30, default 3). The settings test that uses a non-localhost `PUBLIC_URL` now sets a real-looking secret.

**Edit `apps/server/src/managers/job-run-manager.ts`**: 3 replacements, in order.

1. Find:
````ts
import type { Job, JobResult, Task, TaskOutput } from "../domain.ts";
import type { Clock, JobEnd, JobQueue, TaskRunner } from "../ports.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";
import type { SubmissionManager } from "./submission-manager.ts";
````
   Replace with:
````ts
import type { Job, JobResult, Task, TaskOutput } from "../domain.ts";
import type { Clock, JobEnd, JobQueue, TaskRunner } from "../ports.ts";
import type { DailyStockManager } from "./daily-stock-manager.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";
import type { SubmissionManager } from "./submission-manager.ts";
````

2. Find:
````ts
  /** Decides the submission a verification was for. */
  readonly submissions: SubmissionManager;
  readonly clock: Clock;
  readonly settings: JobRunSettings;
````
   Replace with:
````ts
  /** Decides the submission a verification was for. */
  readonly submissions: SubmissionManager;
  /** Stores a daily puzzle's generation. */
  readonly dailies: Pick<DailyStockManager, "complete">;
  readonly clock: Clock;
  readonly settings: JobRunSettings;
````

3. Find:
````ts
  /**
   * Stores what a task produced. A generated puzzle takes its job's id; a verification for a
   * submission decides that submission.
   */
  async #store(job: Job, output: TaskOutput): Promise<JobResult> {
    switch (output.kind) {
      case "generate":
        await this.#deps.puzzles.saveGenerated(job.id, output.generated);
        return { kind: "generate", puzzleId: job.id };
      case "verify":
````
   Replace with:
````ts
  /**
   * Stores what a task produced. A generated puzzle takes its job's id, and a daily one goes to its
   * day; a verification for a submission decides that submission.
   */
  async #store(job: Job, output: TaskOutput): Promise<JobResult> {
    switch (output.kind) {
      case "generate":
        if (job.kind === "generate" && job.input.day !== undefined) {
          await this.#deps.dailies.complete(job.id, job.input.day, output.generated);
        } else {
          await this.#deps.puzzles.saveGenerated(job.id, output.generated);
        }
        return { kind: "generate", puzzleId: job.id };
      case "verify":
````

**Edit `apps/server/src/managers/job-run-manager.test.ts`**: 3 replacements, in order.

1. Find:
````ts
    newId: sequentialIds("s"),
  });
  const manager = new JobRunManager({ jobs, tasks: runner, puzzles, submissions, clock, settings });
  const enqueue = (id: string) =>
    jobs.enqueue({
````
   Replace with:
````ts
    newId: sequentialIds("s"),
  });
  /** Daily generations handed to the scheduler, as `job:day`. */
  const dailies: string[] = [];
  const manager = new JobRunManager({
    jobs,
    tasks: runner,
    puzzles,
    submissions,
    dailies: {
      async complete(jobId, day) {
        dailies.push(`${jobId}:${day}`);
      },
    },
    clock,
    settings,
  });
  const enqueue = (id: string) =>
    jobs.enqueue({
````

2. Find:
````ts
      createdAt: clock.now(),
    });
  return { clock, jobs, puzzleRepo, blobs, manager, enqueue };
}
````
   Replace with:
````ts
      createdAt: clock.now(),
    });
  return { clock, jobs, puzzleRepo, blobs, manager, enqueue, dailies };
}
````

3. Find:
````ts
    expect(puzzleRepo.get("j1")?.status).toBe("published");
    expect(await blobs.get("puzzles/j1/solution.txt")).toBe("112211121121");
  });
````
   Replace with:
````ts
    expect(puzzleRepo.get("j1")?.status).toBe("published");
    expect(await blobs.get("puzzles/j1/solution.txt")).toBe("112211121121");
  });

  test("a daily puzzle's generation goes to the daily scheduler, not the practice list", async () => {
    const runner = new FakeTaskRunner(async () => GENERATED);
    const { jobs, puzzleRepo, manager, dailies } = setup(runner);
    jobs.enqueue({
      id: "d1",
      job: { kind: "generate", input: { width: 2, height: 2, seed: "s", day: "2026-10-26" } },
      createdAt: 0,
    });
    expect(await manager.runNext("w")).toBe(true);
    expect(dailies).toEqual(["d1:2026-10-26"]);
    expect(puzzleRepo.get("d1")).toBeNull();
    expect(jobs.get("d1")).toMatchObject({ status: "done", result: { puzzleId: "d1" } });
  });
````

**Edit `apps/server/src/managers/submission-manager.test.ts`**: 2 replacements, in order.

1. Find:
````ts
  FakeSubmissionRepository,
  FakeTaskRunner,
  sequentialIds,
} from "../test-support/fakes.ts";
````
   Replace with:
````ts
  FakeSubmissionRepository,
  FakeTaskRunner,
  noDailies,
  sequentialIds,
} from "../test-support/fakes.ts";
````

2. Find:
````ts
      puzzles,
      submissions: manager,
      clock,
      settings: {
````
   Replace with:
````ts
      puzzles,
      submissions: manager,
      dailies: noDailies,
      clock,
      settings: {
````

**Edit `apps/server/src/worker/flow.test.ts`**: 2 replacements, in order.

1. Find:
````ts
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps } from "../test-support/daily.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";
````
   Replace with:
````ts
import { accountDeps } from "../test-support/accounts.ts";
import { dailyDeps } from "../test-support/daily.ts";
import { noDailies } from "../test-support/fakes.ts";
import { sqliteProgress } from "../test-support/progress.ts";
import { submissionDeps } from "../test-support/submissions.ts";
````

2. Find:
````ts
    puzzles,
    submissions,
    clock: systemClock,
    settings: {
````
   Replace with:
````ts
    puzzles,
    submissions,
    dailies: noDailies,
    clock: systemClock,
    settings: {
````

**Edit `apps/server/src/worker/loop.ts`**: 4 replacements, in order.

1. Find:
````ts
import type { JobRunManager } from "../managers/job-run-manager.ts";

export interface WorkerLoopOptions {
  readonly runs: Pick<JobRunManager, "runNext" | "recoverStale">;
  readonly workerId: string;
  /** How long to wait when the queue is empty. */
````
   Replace with:
````ts
import type { DailyStockManager } from "../managers/daily-stock-manager.ts";
import type { JobRunManager } from "../managers/job-run-manager.ts";

export interface WorkerLoopOptions {
  readonly runs: Pick<JobRunManager, "runNext" | "recoverStale">;
  readonly dailies: Pick<DailyStockManager, "stock">;
  readonly workerId: string;
  /** How long to wait when the queue is empty. */
````

2. Find:
````ts
  /** Least time between two sweeps for abandoned jobs, whether the worker is busy or idle. */
  readonly sweepMs: number;
  /** Stops the loop after the current job. */
  readonly signal: AbortSignal;
````
   Replace with:
````ts
  /** Least time between two sweeps for abandoned jobs, whether the worker is busy or idle. */
  readonly sweepMs: number;
  /** Least time between two checks that the coming days' daily puzzles are generated. */
  readonly stockMs: number;
  /** Stops the loop after the current job. */
  readonly signal: AbortSignal;
````

3. Find:
````ts
 * The worker's main loop: run jobs back to back while there are any; when the queue is empty,
 * wait `pollMs` before looking again. Abandoned jobs are taken back once at start and then every
 * `sweepMs`, busy or idle, so a dead worker's job does not wait for the queue to drain. An error
 * (say, the database staying busy) is logged and the loop carries on after the same wait.
 */
export async function runWorkerLoop({
  runs,
  workerId,
  pollMs,
  sweepMs,
  signal,
  now = () => performance.now(),
}: WorkerLoopOptions) {
  let lastSweep = Number.NEGATIVE_INFINITY;
  while (!signal.aborted) {
    try {
````
   Replace with:
````ts
 * The worker's main loop: run jobs back to back while there are any; when the queue is empty,
 * wait `pollMs` before looking again. Abandoned jobs are taken back once at start and then every
 * `sweepMs`, busy or idle, so a dead worker's job does not wait for the queue to drain. Daily
 * puzzles are stocked at start and then every `stockMs` the same way; one of today's still missing
 * at two checks in a row is late, and logged as an error. An error (say, the database staying busy)
 * is logged and the loop carries on after the same wait.
 */
export async function runWorkerLoop({
  runs,
  dailies,
  workerId,
  pollMs,
  sweepMs,
  stockMs,
  signal,
  now = () => performance.now(),
}: WorkerLoopOptions) {
  let lastSweep = Number.NEGATIVE_INFINITY;
  let lastStock = Number.NEGATIVE_INFINITY;
  let missing = new Set<number>();
  while (!signal.aborted) {
    try {
````

4. Find:
````ts
        const recovered = runs.recoverStale();
        if (recovered > 0) console.log(`Recovered ${recovered} abandoned job(s)`);
      }
      if (await runs.runNext(workerId)) continue;
````
   Replace with:
````ts
        const recovered = runs.recoverStale();
        if (recovered > 0) console.log(`Recovered ${recovered} abandoned job(s)`);
      }
      if (now() - lastStock >= stockMs) {
        lastStock = now();
        const { queued, missingToday } = dailies.stock();
        if (queued > 0) console.log(`Queued ${queued} daily puzzle generation(s)`);
        const late = missingToday.filter((size) => missing.has(size));
        if (late.length > 0) {
          const sizes = late.map((size) => `${size}×${size}`).join(", ");
          console.error(`Today's daily puzzles are late: ${sizes} not generated yet`);
        }
        missing = new Set(missingToday);
      }
      if (await runs.runNext(workerId)) continue;
````

**Edit `apps/server/src/worker/loop.test.ts`**: 5 replacements, in order.

1. Find:
````ts
import { describe, expect, spyOn, test } from "bun:test";
import { runWorkerLoop } from "./loop.ts";

describe("runWorkerLoop", () => {
````
   Replace with:
````ts
import { describe, expect, spyOn, test } from "bun:test";
import type { StockReport } from "../managers/daily-stock-manager.ts";
import { runWorkerLoop } from "./loop.ts";

/** A scheduler that reports nothing to do. */
const stocked = { stock: (): StockReport => ({ queued: 0, missingToday: [] }) };

describe("runWorkerLoop", () => {
````

2. Find:
````ts
    await runWorkerLoop({
      runs,
      workerId: "w",
      pollMs: 60_000,
      sweepMs: 5_000,
      now: () => time,
      signal: controller.signal,
````
   Replace with:
````ts
    await runWorkerLoop({
      runs,
      dailies: stocked,
      workerId: "w",
      pollMs: 60_000,
      sweepMs: 5_000,
      stockMs: 60_000,
      now: () => time,
      signal: controller.signal,
````

3. Find:
````ts
    await runWorkerLoop({
      runs,
      workerId: "w",
      pollMs: 60_000,
      sweepMs: 60_000,
      signal: controller.signal,
    });
````
   Replace with:
````ts
    await runWorkerLoop({
      runs,
      dailies: stocked,
      workerId: "w",
      pollMs: 60_000,
      sweepMs: 60_000,
      stockMs: 60_000,
      signal: controller.signal,
    });
````

4. Find:
````ts
    await runWorkerLoop({
      runs,
      workerId: "w",
      pollMs: 1,
      sweepMs: 60_000,
      signal: controller.signal,
    });
````
   Replace with:
````ts
    await runWorkerLoop({
      runs,
      dailies: stocked,
      workerId: "w",
      pollMs: 1,
      sweepMs: 60_000,
      stockMs: 60_000,
      signal: controller.signal,
    });
````

5. Find:
````ts
    error.mockRestore();
  });
});
````
   Replace with:
````ts
    error.mockRestore();
  });

  test("stocks daily puzzles at start and on a timer, and logs today's that stay missing", async () => {
    const controller = new AbortController();
    const error = spyOn(console, "error").mockImplementation(() => {});
    const log = spyOn(console, "log").mockImplementation(() => {});
    let time = 0;
    const reports: StockReport[] = [
      { queued: 8, missingToday: [7, 10, 20, 40] },
      { queued: 0, missingToday: [40] },
      { queued: 0, missingToday: [] },
    ];
    let stocks = 0;
    const dailies = {
      stock() {
        const report = reports[stocks++];
        if (stocks === reports.length) controller.abort();
        return report;
      },
    };
    const runs = {
      async runNext() {
        time += 30_000;
        return false;
      },
      recoverStale: () => 0,
    };
    await runWorkerLoop({
      runs,
      dailies,
      workerId: "w",
      pollMs: 1,
      sweepMs: 60_000,
      stockMs: 60_000,
      now: () => time,
      signal: controller.signal,
    });
    expect(stocks).toBe(3);
    expect(log).toHaveBeenCalledWith("Queued 8 daily puzzle generation(s)");
    // Only the 40×40, missing at two checks in a row, is late.
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("Today's daily puzzles are late: 40×40 not generated yet");
    error.mockRestore();
    log.mockRestore();
  });
});
````

**Edit `apps/server/src/config.ts`**: 5 replacements, in order.

1. Find:
````ts
import type { SmtpSettings } from "./adapters/mail/smtp-mailer.ts";
import type { JobRunSettings } from "./managers/job-run-manager.ts";

const Port = z.coerce.number().int().min(1).max(65535);
````
   Replace with:
````ts
import type { SmtpSettings } from "./adapters/mail/smtp-mailer.ts";
import type { JobRunSettings } from "./managers/job-run-manager.ts";

/**
 * The daily seed secret for development and tests. Like Turnstile's test keys, it is refused for a
 * site that isn't on localhost: anyone could work out daily puzzles made with it.
 */
export const DEV_DAILY_SEED_SECRET = "loophole-dev-daily-seed-secret";

const Port = z.coerce.number().int().min(1).max(65535);
````

2. Find:
````ts
  SMTP_REQUIRE_TLS: z.stringbool().optional(),
  MAIL_FROM: z.string().min(1).default("Loophole <no-reply@loophole.localhost>"),
});
````
   Replace with:
````ts
  SMTP_REQUIRE_TLS: z.stringbool().optional(),
  MAIL_FROM: z.string().min(1).default("Loophole <no-reply@loophole.localhost>"),
  DAILY_SEED_SECRET: z.string().min(16).default(DEV_DAILY_SEED_SECRET),
  DAILY_DAYS_AHEAD: z.coerce.number().int().min(1).max(30).default(3),
});
````

3. Find:
````ts
  /** How long a login session lasts. */
  readonly sessionTtlMs: number;
}
````
   Replace with:
````ts
  /** How long a login session lasts. */
  readonly sessionTtlMs: number;
  readonly dailies: {
    /** Daily seeds are derived from this, so they can't be guessed (worker only). */
    readonly seedSecret: string;
    /** How many days, today included, the worker keeps generated. */
    readonly daysAhead: number;
    /** How often the worker checks that the coming days are generated. */
    readonly stockMs: number;
  };
}
````

4. Find:
````ts
  const e = parsed.data;
  const publicHost = new URL(e.PUBLIC_URL).hostname;
  if (
    e.TURNSTILE_SECRET_KEY === TURNSTILE_TEST_SECRET_KEY &&
    publicHost !== "localhost" &&
    publicHost !== "127.0.0.1"
  ) {
    // Fail closed: the test secret passes every token, so it must never guard a real site.
    throw new Error(
      `TURNSTILE_SECRET_KEY is Cloudflare's always-pass test key, but PUBLIC_URL (${e.PUBLIC_URL}) is not localhost. Set TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY to a real Turnstile widget's keys.`,
    );
  }
````
   Replace with:
````ts
  const e = parsed.data;
  const publicHost = new URL(e.PUBLIC_URL).hostname;
  const local = publicHost === "localhost" || publicHost === "127.0.0.1";
  if (e.TURNSTILE_SECRET_KEY === TURNSTILE_TEST_SECRET_KEY && !local) {
    // Fail closed: the test secret passes every token, so it must never guard a real site.
    throw new Error(
      `TURNSTILE_SECRET_KEY is Cloudflare's always-pass test key, but PUBLIC_URL (${e.PUBLIC_URL}) is not localhost. Set TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY to a real Turnstile widget's keys.`,
    );
  }
  if (e.DAILY_SEED_SECRET === DEV_DAILY_SEED_SECRET && !local) {
    throw new Error(
      `DAILY_SEED_SECRET is the development value, but PUBLIC_URL (${e.PUBLIC_URL}) is not localhost. Set it to a long random string (for example \`openssl rand -base64 32\`) and keep it secret.`,
    );
  }
````

5. Find:
````ts
    },
    sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  };
}
````
   Replace with:
````ts
    },
    sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
    dailies: { seedSecret: e.DAILY_SEED_SECRET, daysAhead: e.DAILY_DAYS_AHEAD, stockMs: 60_000 },
  };
}
````

**Edit `apps/server/src/config.test.ts`**: 4 replacements, in order.

1. Find:
````ts
      },
      sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
    });
    expect(config.workerId).toContain(String(process.pid));
````
   Replace with:
````ts
      },
      sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
      dailies: { seedSecret: "loophole-dev-daily-seed-secret", daysAhead: 3, stockMs: 60_000 },
    });
    expect(config.workerId).toContain(String(process.pid));
````

2. Find:
````ts
      SMTP_PASSWORD: "pass",
      MAIL_FROM: "Loophole <hi@loophole.example>",
    });
    expect(config).toMatchObject({
````
   Replace with:
````ts
      SMTP_PASSWORD: "pass",
      MAIL_FROM: "Loophole <hi@loophole.example>",
      DAILY_SEED_SECRET: "a-long-random-production-secret",
      DAILY_DAYS_AHEAD: "5",
    });
    expect(config).toMatchObject({
````

3. Find:
````ts
        from: "Loophole <hi@loophole.example>",
      },
    });
  });
````
   Replace with:
````ts
        from: "Loophole <hi@loophole.example>",
      },
      dailies: { seedSecret: "a-long-random-production-secret", daysAhead: 5 },
    });
  });
````

4. Find:
````ts
  });

  test("requires PUBLIC_URL: there is no default", () => {
    expect(() => loadConfig({ ...S3, PUBLIC_URL: undefined })).toThrow(/PUBLIC_URL/);
````
   Replace with:
````ts
  });

  test("refuses the development daily seed secret for a site that isn't on localhost", () => {
    const site = {
      ...S3,
      PUBLIC_URL: "https://loophole.example",
      TURNSTILE_SITE_KEY: "site",
      TURNSTILE_SECRET_KEY: "secret",
    };
    expect(() => loadConfig(site)).toThrow(/DAILY_SEED_SECRET is the development value/);
    expect(() => loadConfig({ ...site, DAILY_SEED_SECRET: "short" })).toThrow(/DAILY_SEED_SECRET/);
  });

  test("requires PUBLIC_URL: there is no default", () => {
    expect(() => loadConfig({ ...S3, PUBLIC_URL: undefined })).toThrow(/PUBLIC_URL/);
````

**Edit `apps/server/src/worker/main.ts`**: 5 replacements, in order.

1. Find:
````ts
import { S3BlobStore } from "../adapters/blob/s3-blob-store.ts";
import { systemClock } from "../adapters/clock.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
````
   Replace with:
````ts
import { S3BlobStore } from "../adapters/blob/s3-blob-store.ts";
import { systemClock } from "../adapters/clock.ts";
import { hmacDailySeeder } from "../adapters/daily-seeds.ts";
import { SqliteDailyRepository } from "../adapters/db/daily-repository.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
````

2. Find:
````ts
import { ThreadTaskRunner } from "../adapters/tasks/thread-task-runner.ts";
import { loadConfig } from "../config.ts";
import { JobManager } from "../managers/job-manager.ts";
import { JobRunManager } from "../managers/job-run-manager.ts";
````
   Replace with:
````ts
import { ThreadTaskRunner } from "../adapters/tasks/thread-task-runner.ts";
import { loadConfig } from "../config.ts";
import { DailyStockManager } from "../managers/daily-stock-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { JobRunManager } from "../managers/job-run-manager.ts";
````

3. Find:
````ts
});
const queue = new SqliteJobQueue(db);
// The worker only decides submissions; queueing them and the per-account limit are the API's.
const submissions = new SubmissionManager({
  submissions: new SqliteSubmissionRepository(db),
  puzzles,
  jobs: new JobManager({
    jobs: queue,
    clock: systemClock,
    newId: () => crypto.randomUUID(),
    maxQueued: config.maxQueuedJobs,
  }),
  limiter: new MemoryRateLimiter(systemClock),
  clock: systemClock,
  newId: () => crypto.randomUUID(),
});
const runs = new JobRunManager({
````
   Replace with:
````ts
});
const queue = new SqliteJobQueue(db);
const jobs = new JobManager({
  jobs: queue,
  clock: systemClock,
  newId: () => crypto.randomUUID(),
  maxQueued: config.maxQueuedJobs,
});
// The worker only decides submissions; queueing them and the per-account limit are the API's.
const submissions = new SubmissionManager({
  submissions: new SqliteSubmissionRepository(db),
  puzzles,
  jobs,
  limiter: new MemoryRateLimiter(systemClock),
  clock: systemClock,
  newId: () => crypto.randomUUID(),
});
// Keeps the coming days' daily puzzles generated (PRD FR-22).
const dailies = new DailyStockManager({
  dailies: new SqliteDailyRepository(db),
  jobs,
  puzzles,
  seeds: hmacDailySeeder(config.dailies.seedSecret),
  clock: systemClock,
  newId: () => crypto.randomUUID(),
  settings: { daysAhead: config.dailies.daysAhead },
});
const runs = new JobRunManager({
````

4. Find:
````ts
  puzzles,
  submissions,
  clock: systemClock,
  settings: config.jobs,
````
   Replace with:
````ts
  puzzles,
  submissions,
  dailies,
  clock: systemClock,
  settings: config.jobs,
````

5. Find:
````ts
await runWorkerLoop({
  runs,
  workerId: config.workerId,
  pollMs: config.pollMs,
  sweepMs: config.jobs.staleMs / 2,
  signal: controller.signal,
});
````
   Replace with:
````ts
await runWorkerLoop({
  runs,
  dailies,
  workerId: config.workerId,
  pollMs: config.pollMs,
  sweepMs: config.jobs.staleMs / 2,
  stockMs: config.dailies.stockMs,
  signal: controller.signal,
});
````

**Edit `.env.example`**: 1 replacement, in order.

1. Find:
````sh
# Behind a reverse proxy, rate limits take the client's address from X-Forwarded-For.
# TRUST_PROXY=true
````
   Replace with:
````sh
# Behind a reverse proxy, rate limits take the client's address from X-Forwarded-For.
# TRUST_PROXY=true

# Daily puzzles
# Daily seeds are derived from this secret so nobody can work out tomorrow's puzzles. The value
# below is for development only and refused unless PUBLIC_URL is on localhost; in production set a
# long random string (openssl rand -base64 32).
DAILY_SEED_SECRET=loophole-dev-daily-seed-secret
# How many days, today included, the worker keeps generated.
# DAILY_DAYS_AHEAD=3
````

**Verify:** `bun run check`.

**Commit:** `feat(server): the worker keeps the coming days' daily puzzles generated`

### A7 Live check with the dev services



Checks the scheduler, a validated ranked solve, the leaderboard and that nothing leaks. Garage and Mailpit must be running (`docker compose up -d`, then `./scripts/garage-init.sh`).

1. Create `apps/server/live-check.ts` (delete it afterwards; don't commit it):

````ts
import { encodeEdges, parsePuzzle, verify } from "@loophole/core";

const API = "http://localhost:3911";
const H = { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" };
let cookie = "";
async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(API + path, {
    method,
    headers: { ...H, Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.getSetCookie().find((c) => c.startsWith("__Host-loophole_session="));
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
}
const daily = await call("GET", "/api/daily");
console.log("daily", daily.status, JSON.stringify(daily.json));
const id7 = daily.json.puzzles[0].puzzleId;
const p = await call("GET", `/api/puzzles/${id7}`);
console.log("puzzle", p.status, "seed?", "seed" in p.json.puzzle, "meta?", "meta" in p.json.puzzle);
const email = `live-${crypto.randomUUID()}@loophole.test`;
const signUp = await call("POST", "/api/auth/signup", {
  email,
  password: "hunter22-live",
  captchaToken: "XXXX.DUMMY.TOKEN.XXXX",
});
console.log("signup", signUp.status);
await Bun.sleep(1500);
const query = encodeURIComponent(`to:"${email}"`);
const search = await (await fetch(`http://127.0.0.1:8025/api/v1/search?query=${query}`)).json();
const mail = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${search.messages[0].ID}`)).json();
const token = mail.Text.match(/#token=(\S+)/)[1];
console.log("verify", (await call("POST", "/api/auth/verify-email", { token })).status);
const login = await call("POST", "/api/auth/login", { email, password: "hunter22-live" });
const uid = login.json.id;
const start = await call("POST", `/api/users/${uid}/attempts/${id7}`);
console.log("start", start.status, JSON.stringify(start.json));
const solution = verify(parsePuzzle(p.json.puzzle)).solutions[0];
const wrong = await call("POST", `/api/users/${uid}/attempts/${id7}/finish`, {
  edges: "0".repeat(solution.length),
  elapsedMs: 1000,
});
console.log("wrong", wrong.status, wrong.json.title);
await Bun.sleep(5500);
const fin = await call("POST", `/api/users/${uid}/attempts/${id7}/finish`, {
  edges: encodeEdges(solution),
  elapsedMs: 5600,
});
console.log("finish", fin.status, JSON.stringify(fin.json));
await call("PUT", `/api/users/${uid}/display-name`, { displayName: "livecheck" });
const board = await call("GET", `/api/leaderboards/daily/${id7}`);
console.log("board", board.status, board.text);
const summary = await call("GET", `/api/users/${uid}/daily`);
console.log("summary", summary.status, summary.text);
const all = [daily.text, p.text, start.text, fin.text, board.text, summary.text].join("\n");
console.log("leaks solution?", all.includes(encodeEdges(solution)));
````

2. Start the API and the worker on a fresh database, in the background, from the worktree root:

```sh
export PATH="$HOME/.bun/bin:$PATH"
export DATABASE_PATH=/tmp/loophole-live.sqlite PUBLIC_URL=http://localhost:3911 PORT=3911 \
  S3_ENDPOINT=http://localhost:3900 S3_REGION=garage S3_BUCKET=loophole-dev \
  S3_ACCESS_KEY_ID=GK1a2b3c4d5e6f708192a3b4c5 \
  S3_SECRET_ACCESS_KEY=8b339f8231fe89196b07eb8766bf6f079805f64a9be09934697b94e0b1aa0a0b \
  SMTP_HOST=127.0.0.1 SMTP_PORT=1025
rm -f /tmp/loophole-live.sqlite*
bun apps/server/src/api/main.ts > /tmp/loophole-api.log 2>&1 &
bun apps/server/src/worker/main.ts > /tmp/loophole-worker.log 2>&1 &
sleep 8; cat /tmp/loophole-worker.log
bun apps/server/live-check.ts
```

Expected: the worker log says `Queued 12 daily puzzle generation(s)`; `daily 200` lists four puzzle ids; `puzzle 200 seed? false meta? false`; `start 200` with `"status":"playing"`; `wrong 400 Not the solution`; `finish 200` with `"ranked":true,"rank":1` and an `elapsedMs` between 5500 and 5600; the board has one row `{"rank":1,"name":"livecheck",…,"me":true}`; the summary has `"streak":1`; `leaks solution? false`.

If the 7×7 `puzzleId` is still null, wait a few seconds and run `bun apps/server/live-check.ts` again.

3. Stop only the two processes you started: list them with `for p in $(pgrep -f "bun apps/server/src/(api|worker)/main.ts"); do echo "$p $(readlink /proc/$p/cwd)"; done` and `kill` the PIDs whose folder is this worktree (other worktrees may run their own). Delete `apps/server/live-check.ts`, `/tmp/loophole-live.sqlite*` and the two logs. If you started the compose services, `docker compose stop` (never `down`, never `-v`).



No commit.

### A8 Docs

Record the decisions and describe the feature. Append the eight DECISIONS entries to the end of the file as shown (the block starts with a blank line). The other doc edits change a phrase or add a paragraph.

**Append to the end of `docs/DECISIONS.md`**:

````markdown

## 2026-10-25 · WT11 `daily-leaderboards` · Daily puzzles
- **Question:** How are the daily puzzles (PRD FR-22) made, kept secret until their day, and recovered when generation fails?
- **Decision:**
  - **Sizes.** 7×7, 10×10, 20×20 and 40×40 (`DAILY_SIZES`), one level (FR-29).
  - **Scheduler.** The worker runs `DailyStockManager.stock` at start and every minute: for today and the next `DAILY_DAYS_AHEAD - 1` days (3 days in all by default) it queues a generation for each size class with no row in the `dailies` table (migration 006). Rows are claimed with an insert or a compare-and-set on `attempt`, so several workers queue each one once. Daily jobs skip the queue cap, so a queue full of players' jobs can't hold them back.
  - **Seeds.** `HMAC-SHA256(DAILY_SEED_SECRET, "loophole-daily:<day>:<size>:<attempt>")`, base64url. Whoever holds the secret can regenerate a daily (the row keeps `attempt` and the generator version); nobody else can work one out ahead of time. The development secret is refused unless `PUBLIC_URL` is on localhost, like Turnstile's test keys.
  - **Storage.** A daily is stored like a generated puzzle but without its seed or generator version (`PuzzleManager.saveDaily`), so no response can leak them, and with `puzzles.release_at` set to 00:00 UTC on its day. `PuzzleManager.get` treats a puzzle before its release time as missing, so the puzzle, hint, progress and report routes all answer 404 for tomorrow's. Dailies are left out of the practice list.
  - **Failures.** A job that failed, timed out or is gone is retried at the next check with the next `attempt`, so the seed changes too: a seed that can't be generated is skipped and a passing outage is ridden out. There is no limit; with three days stocked ahead, a failure has days to clear.
  - **Late.** A size class of today's still missing at two checks in a row is logged as an error ("Today's daily puzzles are late") every minute until it is generated; the API shows it as not ready (`puzzleId: null`) and the home page as "Not ready yet". WT12 should count these log lines as a metric for alerting.
- **Reason:** Generating days ahead keeps a slow or failed job from leaving a day without puzzles, and a 40×40 takes well under a second (WT3), so the stock costs nothing. A release time on the row, rather than a status, keeps "unpublished" meaning removed by an admin (WT10) and needs no rebuild of the `puzzles` table. Leaving the seed out by construction is safer than remembering to hide it in every response (WT6).

## 2026-10-25 · WT11 `daily-leaderboards` · Ranked attempts and timing
- **Question:** How does a ranked daily solve work (PRD FR-17, FR-25), and what timing checks apply?
- **Decision:**
  - **One attempt.** A confirmed player gets one ranked attempt per daily (`attempts` table, keyed by user and puzzle), started on the daily's own UTC day (`POST /api/users/{userId}/attempts/{puzzleId}`, 409 afterwards). Starting again returns the same attempt. It can be finished after midnight.
  - **The clock.** It starts on the server and never stops: ranked play has no pause, and leaving the page doesn't stop it. The play screen sets its clock from the server's `elapsedMs`, so the device's clock doesn't matter.
  - **Finishing.** The client sends the board and its own clock (`…/finish`). The server checks the board's lines against the stored solution (crosses don't matter) and answers 400 for a wrong board. The ranked time is the player's own figure, but never more than the grace under the server's: `min(server, max(client, server − grace))`, where the grace (`rankedGraceMs`) is a tenth of the server's time, at least 3 s and at most 15 s. A retry of a finished attempt returns it unchanged.
  - **Plausibility.** A solve faster than `max(5 s, 0.1 s per cell)` (5 s for 7×7, 160 s for 40×40) is kept but not ranked.
  - **Ranked or not.** A finished attempt is `ranked` unless a hint was used during it or it was too fast. Guests, unconfirmed accounts, an earlier day's daily and replays after a ranked solve play unranked, with progress as usual.
- **Reason:** What the server's clock and board check guarantee is narrow: an edited client can't claim a wrong board, a time longer ago than the attempt started, or more than the grace off the server's time. The grace covers a slow network and a send retried after a short outage; it scales with the time so that on a 7×7, solved in well under a minute, it can't decide the rank by itself, while a 40×40 still gets 15 s. A longer outage costs time: a solve sent an hour late counts at most 15 s under the hour. Pausing would mean trusting the client again.

  Ranked times are therefore trustworthy only against casual cheating. A daily's clues are public from 00:00 UTC (guests play it), so anyone can solve it beforehand with a solver, or by hand while logged out, or take hints without a login or before pressing Start, and then start the attempt and finish at the minimum plausible time. `minRankedMs` and the one attempt per daily are the only backstops. Stronger measures would need clues kept private until a ranked attempt starts, which conflicts with guest play; WT12 or later can revisit it if leaderboards are abused.

## 2026-10-25 · WT11 `daily-leaderboards` · Ranked attempts and saved progress
- **Question:** WT9 suggested keeping ranked attempts apart from progress. Did that hold?
- **Decision:** Yes. `attempts` holds the server's start and finish times, the ranked time, `assisted` and `ranked`; the board a player resumes is still the progress record, synced as for any server puzzle. Leaderboards read only `attempts`. A ranked attempt starts from an empty board: the web app clears the saved board when Start succeeds (WT11b), since an unconfirmed account, a guest import or another device may have saved one before. When the play screen opens an attempt whose saved board is already solved (the finish request was lost), it sends that board at once.
- **Reason:** As WT9 said: the two records answer different questions, and nothing in the progress rules had to bend.

## 2026-10-25 · WT11 `daily-leaderboards` · Hints on daily puzzles
- **Question:** How are hints during a ranked attempt recorded (FR-12, FR-23), and does the hint endpoint need to change for live dailies?
- **Decision:** Hints keep coming from `POST /api/puzzles/{id}/hint`, from any session, guests included. When the request carries a login, `HintManager` tells `AttemptManager.recordHint`, which marks that player's unfinished attempt at the puzzle as assisted (a hint after finishing changes nothing). The web app needs no change: the request already carries the session cookie. On today's daily a mistake hint reports `count: 1` however many marks are wrong, so one request can't check a whole board; earlier days' dailies and practice puzzles report the real count. A hint taken before the attempt starts isn't recorded anywhere; the web app hides the board until Start, so an honest player can't do that by accident.
- **Reason:** Requiring the ranked session for hints would stop guests getting hints on dailies and still not stop a player asking from another browser. Marking the attempt from the hint request is what WT8 planned, and the rest rests on the timing checks.

## 2026-10-25 · WT11 `daily-leaderboards` · Leaderboards
- **Question:** What do the leaderboards rank and show (FR-23)?
- **Decision:** Ranked solves only, by time, ties to whoever finished first, then by user id. Two boards: each daily's own (`GET /api/leaderboards/daily/{puzzleId}`) and an all-time board per area and level of each player's best ranked time on dailies (`GET /api/leaderboards/areas/{area}?level=1`). A board answers the top `limit` rows (default 10) and, for a logged-in viewer, their own row and the rows either side, plus the total, so a player sees their rank outside the top. Rows carry the rank, the display name or null, the time and whether the row is the viewer's; user ids and emails are never sent. Ranks are worked out in SQL with `ROW_NUMBER()`.
- **Reason:** It is what the Solved artboard shows (top three, a gap, the player and their neighbours). Only dailies are ranked, so a bucket's all-time board mixes the same size class across days; areas from player-made puzzles never get ranked times.

## 2026-10-25 · WT11 `daily-leaderboards` · Streaks and personal bests
- **Question:** What counts toward a streak and a personal best (FR-24)?
- **Decision:** A streak is the run of consecutive UTC days, up to today, with at least one finished daily attempt, hinted or too fast included. A streak whose last day is yesterday still shows until today ends. A personal best is a player's best ranked time per area and level. `GET /api/users/{userId}/daily` gives the streak, the last seven days, today's attempts and the bests.
- **Reason:** A streak is about coming back every day, so a hint shouldn't break it; ranking is where hints count. Only finished attempts count, so starting a puzzle and leaving isn't a streak day. Guests have no streak: it needs the server's record.

## 2026-10-25 · WT11 `daily-leaderboards` · Display names
- **Question:** Leaderboards need a public name, which NFR-6 doesn't list. Opt-in or generated?
- **Decision:** Opt-in. A player has no name until they choose one on the account page and shows as "Anonymous" until then; "You" marks the viewer's own row. Names are 3 to 20 ASCII letters, digits, `_`, `.` or `-` after trimming, with at least one letter or digit, unique ignoring case; "you" and "anonymous" are refused, and so is any name containing "admin", "loophole", "moderator" or "official". They live in their own table, `display_names` (migration 006), referencing `users(id) ON DELETE CASCADE`, through `GET` and `PUT /api/users/{userId}/display-name` (null removes it), at most 10 changes an hour per account. There is no profanity filter; reports of names, if needed, are for a later phase.
- **Reason:** NFR-6 allows only the email, the password hash and gameplay data. ASCII only keeps "unique ignoring case" exactly true (SQLite's `NOCASE` folds ASCII only) and stops look-alike letters from another script passing one player off as another or as staff; non-ASCII names could come later with a normalised key. A name a player chose to publish is gameplay data they control; a generated one would be a public handle they never asked for. Nothing identifying is shown unless the player opts in, and deleting the account deletes the name and frees it. A table of its own keeps `users` and every user fixture as they were.

## 2026-10-25 · WT11 `daily-leaderboards` · Account deletion and leaderboards
- **Question:** What happens to a deleted account's leaderboard entries (NFR-6)?
- **Decision:** `attempts` and `display_names` reference `users(id) ON DELETE CASCADE`, so deleting the account deletes its attempts and name; its rows leave every board and the players below move up. The account page says so before deleting. Daily puzzles themselves are never deleted.
- **Reason:** As WT7 set out: deletion is complete by construction. Leaderboard rows are the player's own gameplay data, unlike a published puzzle that others may be playing.
````

**Edit `README.md`**: 2 replacements, in order.

1. Find (this text, which may be part of a line):
````markdown
Daily puzzles and the rest come in later phases; each phase's plan is in [`docs/plans/`](docs/plans/).
````
   Replace with:
````markdown
The worker also makes a daily puzzle for each size class (7×7, 10×10, 20×20 and 40×40) a few days ahead, the same for everyone and hidden until 00:00 UTC on its day, and the API checks ranked solves of them against the stored solution and the clock, keeps leaderboards, streaks and personal bests, and lets players choose a name for the leaderboards; the web app's screens for them come in the next phase. Each phase's plan is in [`docs/plans/`](docs/plans/).
````

2. Find (this text, which may be part of a line):
````markdown
## Scripts
````
   Replace with:
````markdown
### Daily puzzles in development

The worker generates today's daily puzzles and those of the next two days when it starts, and checks every minute that they are there (`DAILY_DAYS_AHEAD`, 3 by default, counts today). Their seeds are derived from `DAILY_SEED_SECRET`: the value in `.env.example` is for development only, and the API and the worker refuse it unless `PUBLIC_URL` is on localhost, so set a long random string (`openssl rand -base64 32`) in production and keep it secret. A daily is served with its clues only (no seed), and only from 00:00 UTC on its day:

```sh
curl -s localhost:3000/api/daily                        # today's puzzle ids by size
curl -s 'localhost:3000/api/daily?day=2026-10-24'       # an earlier day's
curl -s localhost:3000/api/leaderboards/daily/<puzzle id>
curl -s 'localhost:3000/api/leaderboards/areas/49?level=1'
```

Ranked attempts need a logged-in player with a confirmed email: `POST /api/users/<user id>/attempts/<puzzle id>` starts the clock, and `POST /api/users/<user id>/attempts/<puzzle id>/finish` with `{"edges": …, "elapsedMs": …}` sends the solved board. `docs/DECISIONS.md` has the timing rules.

## Scripts
````

**Edit `docs/TESTING.md`**: 1 replacement, in order.

1. Find (this text, which may be part of a line):
````markdown
- The SMTP mailer test sends through Mailpit and reads the message back from Mailpit's API when it answers on 127.0.0.1:8025; otherwise it is skipped. The Turnstile adapter is tested with a fake `fetch`, never against Cloudflare.
````
   Replace with:
````markdown
- The SMTP mailer test sends through Mailpit and reads the message back from Mailpit's API when it answers on 127.0.0.1:8025; otherwise it is skipped. The Turnstile adapter is tested with a fake `fetch`, never against Cloudflare.
- The daily puzzle, ranked attempt, leaderboard and display name managers run on fakes too. `FakeAttemptRepository` ranks by the same rules as the SQL (time, then who finished first), and the SQLite repository tests check the SQL itself. A fake clock takes tests across 00:00 UTC. Route tests build the daily side with `dailyDeps` and store daily puzzles with `storeDaily`, both from the server's test support.
````

**Edit `apps/server/AGENTS.md`**: 1 replacement, in order.

1. Find (this text, which may be part of a line):
````markdown
- An unpublished puzzle is 404 to players wherever it would show up (a route, a list, a hint); only admins can open it.
````
   Replace with:
````markdown
- An unpublished puzzle is 404 to players wherever it would show up (a route, a list, a hint); only admins can open it.
- Daily puzzles are stored without their seed or generator version and with a release time, and `PuzzleManager.get` hides a puzzle before its release time, so reach puzzles players may see through it. Ranked attempts and leaderboards read the `attempts` table, never saved progress.
````

**Verify:** `bun run check`.

**Commit:** `docs: daily puzzles, ranked attempts and leaderboards on the server`

## Acceptance criteria

- **FR-22**: `GET /api/daily` lists one puzzle per size class (7, 10, 20, 40) for today; tomorrow's ids are 404 everywhere until 00:00 UTC (route tests "a daily is served with clues only…" and "lists today's puzzles by size, and switches at 00:00 UTC"; `DailyManager` rollover test). The worker queues 12 generations on a fresh database and nothing more while they run (`DailyStockManager` tests, live check). Failed, timed-out and lost jobs are retried with the next seed; two workers queue each day and size once.
- **Honest limits**: DECISIONS states that ranked times resist casual cheating only (public clues can be pre-solved; hints before Start or logged out aren't recorded).
- **FR-25**: no response for a daily includes the solution, the seed or `meta` (route test, live check "seed? false", "leaks solution? false"); finishing compares lines with the stored solution and refuses a wrong board.
- **FR-17**: a ranked attempt is finished only by the server; the ranked time is `min(server, max(client, server − rankedGraceMs(server)))` and a solve under `minRankedMs` is not ranked (`AttemptManager` tests).
- **FR-12, FR-23**: a hint with a login marks the attempt assisted; assisted solves are not ranked and not on any board; a mistake hint on today's daily has `count: 1` (manager and route tests).
- **FR-23**: per-daily and all-time per-area boards, by time then finish time, with the viewer's rank and neighbours outside the top; no user ids or emails in the response (repository, manager and route tests).
- **FR-24**: streak and bests as specified, including the "ended yesterday still counts" rule and month/year boundaries (`days.test.ts`, `AttemptManager.summary` tests).
- **FR-29**: buckets carry `level` (1 for all).
- **NFR-4**: attempt and display-name routes need a session and the path's own user (401/403), state changes go through the CSRF check (403 cross-site), attempts need a confirmed email (403), bodies are validated (400), and the per-user limit applies (429).
- **Display names**: non-ASCII, punctuation-only and staff-like names are refused (route and manager tests).
- **NFR-6**: deleting an account removes its attempts and display name (repository and route tests); DECISIONS records the display-name decision.
- **Layering**: managers depend only on ports, domain, core and other managers (`bun run lint` passes); routes hold no business logic; adapters implement the new ports; the composition roots wire them. Migration is `006_daily.sql`. `bun run gen:api` leaves no diff (`bun run check:api`).
- `bun run check` passes after every step; `bun run test:e2e` and `bun run test:e2e:auth` still pass (no web changes here).

## DECISIONS entries (added in step A8)

Daily puzzles · Ranked attempts and timing · Ranked attempts and saved progress · Hints on daily puzzles · Leaderboards · Streaks and personal bests · Display names · Account deletion and leaderboards — the full text is in step A8.

## Review responses (plan review 1)

- 11a-1 (DECISIONS overstated the timing guarantee): accepted. "Ranked attempts and timing" now states the real guarantee (edited clients can't claim wrong boards or more than the grace) and that ranked times resist casual cheating only; "Hints on daily puzzles" says a hint before Start isn't recorded.
- 11a-2 (non-ASCII names break case-insensitive uniqueness, allow look-alikes): accepted. Names are ASCII (`^[A-Za-z0-9_.-]{3,20}$`), with tests for "Émile" and a Cyrillic look-alike.
- 11a-3 (reserved names exact-match only; punctuation-only names): accepted. At least one letter or digit is required; names containing admin, loophole, moderator or official are refused; tests added.
- 11a-4 (claim and enqueue not atomic): accepted. `DailyRepository.atomically` wraps the claim and `enqueueDaily` in one transaction; repository test for rollback.
- 11a-5 (15 s grace too large on a 7×7): accepted. The grace is `min(15 s, max(3 s, server ÷ 10))` (`rankedGraceMs`), tested at 3 s, 10 s and 15 s.

## Unresolved questions

- None blocking. Defaults taken: opt-in display names (anonymous until set); streak counts any finished daily, hinted or not; ranked time is the client's clock within a tenth of the server's (3–15 s), no pause; minimum ranked time `max(5 s, 0.1 s per cell)`; retries without a cap, one per minute, with a new seed each time.
