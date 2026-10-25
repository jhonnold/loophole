# WT10 `submissions` — implementation plan

Branch `feat/submissions`, worktree `/home/jhonnold/projects/loophole-wt/submissions`, based on main `452f304` (WT6 server, WT7 accounts and WT8 hints are all in). PRD: G1 and G5 (only proven-unique puzzles are published; anyone can submit), FR-26 (editor with live solver feedback), FR-27 (submit → verify → publish or reject with an explanation; share), FR-28 (report; admins unpublish), FR-4 (verifier statuses), FR-25 (solutions never sent), NFR-1 (30 s verification budget for a 100×100), NFR-4 (CSRF, rate limits, input validation), NFR-6 (account deletion), §6 creator story, §10 metric (share rejected as `unknown`).

## Goal

- **Editor** (`/create`, FR-26), after `docs/design/Editor.dc.html`: grid size 1–100 per side; clues placed by tapping (a tap cycles empty → 0 → 1 → 2 → 3 → empty, or places the clue picked in the palette) or from the keyboard (arrows, 0–3, Backspace); a live verifier card with the four results (`unique`, `multiple`, `none`, `unknown` — "too open to check"), both answers drawn small for `multiple` plus a suggested clue; large grids zoom and pan like the play board; the draft is kept in `localStorage`. The check runs core's `verify` in a **Web Worker** with a 3 s budget, 250 ms after the last edit; a newer edit stops a check still running, so the page never blocks.
- **Submit** (FR-27): `POST /api/submissions` for logged-in accounts with a confirmed email, 20 per account per hour. It stores a `submissions` row and queues a `verify` job that carries the submission id. The worker runs `verify` (30 s budget) inside the 45 s hard limit; `unique` stores the solution and the solver trace as blobs and publishes the puzzle (origin `submitted`, creator set, id = submission id); `none`/`multiple`/`unknown` reject it with that verdict, which the creator sees. Clues already stored are decided at once (`duplicate` → the existing puzzle; `removed` if it was unpublished). The client polls `GET /api/submissions/{id}`. Solutions are never sent (FR-25).
- **Share**: the published puzzle's link is `/play/<id>` (UUID; no short ids), shown in the editor with Copy and Play buttons, and as "Copy link" below a server puzzle's play screen.
- **Report and unpublish** (FR-28): any logged-in player reports a published puzzle with a reason; admins (`is_admin`) see `/admin` (reported puzzles, newest first) and can unpublish (gone from lists, 404 for non-admins) or dismiss.
- **Account deletion**: published submissions stay, with `creator_id` set to null; the account's submissions and reports are deleted (DECISIONS entry).
- **Layering**: `SubmissionManager` and `ReportManager` over new `SubmissionRepository` / `ReportRepository` ports and the existing job queue; routes only check auth and translate; the worker's `JobRunManager` hands a submission's verification to the submission manager. `openapi.yaml` and `packages/api-client` are regenerated.
- **PlayScreen is not changed.** The editor reuses the board renderers (`BoardSvg`, `BoardCanvas`), the overview map, the pointer tracker and the zoom math; the zoom pill and the wheel handling move out of `BoardView` into a shared component and function so both boards use them.

## Follow-ups handled here

- `[WT10 submissions]` (hints plan) *findHint/solve on user-submitted puzzles: pass a time limit.* Hints for submitted puzzles go through `HintManager`, which already passes `HINT_TIME_LIMIT_MS = 500` for every published puzzle (WT8), so nothing changes there. The worker's trace for a submitted puzzle comes from `solve(puzzle, { timeLimitMs: TRACE_TIME_LIMIT_MS })` with 5 s (Step 2), so a puzzle the rules can't finish can't hold the worker past its limit.

## Out of scope

Difficulty or titles for submitted puzzles; editing a published puzzle; republishing an unpublished one; public creator names (WT11 decides display names); moderation queues (PRD §4: no human moderation); short share ids; a "verify job" UI with progress (verification sends no progress); metrics for rejected-as-unknown (WT12 can count verdicts from the `submissions` table); undo/redo in the editor.

## How later worktrees use this

- **WT11 daily-leaderboards**: `PuzzleRecord.creatorId` exists (null for generated). A ranked daily puzzle's clues can't be republished through submissions: a submission with clues already stored is answered `duplicate` and points at the stored puzzle, whatever its status. If ranked puzzles must not be reachable as practice puzzles, keep them out of `listPublished` / `GET /api/puzzles/{id}` as planned there.
- **WT12 launch-hardening**: count verdicts (`SELECT verdict, count(*) FROM submissions GROUP BY verdict`) for PRD §10's "fraction rejected as `unknown`"; the admin health view can link to `/admin`; `onError` already maps `RateLimitedError` (submit/report limits) to 429.

## Design

### Files

```
apps/server/src/
  adapters/db/migrations/005_submissions.sql   puzzles.creator_id, puzzles_by_clues index, submissions, reports
  domain.ts                     + PuzzleRecord.creatorId, VerifyInput.submissionId, VerifyOutcome.steps,
                                  SubmissionRecord, SubmissionStatus, SubmissionVerdict, ReportRecord, ReportedPuzzle
  ports.ts                      + PuzzleRepository.findByClues/setStatus, SubmissionRepository, ReportRepository
  adapters/db/puzzle-repository.ts             + creator_id, findByClues, setStatus          (+ tests)
  adapters/db/submission-repository.ts, report-repository.ts                                 (+ tests)
  adapters/tasks/run-task.ts    verify → also the trace (solve, 5 s) for a unique puzzle     (+ test)
  managers/puzzle-manager.ts    + saveSubmitted, getAny, findByClues, unpublish              (+ tests)
  managers/job-manager.ts       enqueueVerify(puzzle, submissionId?)
  managers/submission-manager.ts  submit, get, listMine, complete (+ settle on read)         (+ tests)
  managers/report-manager.ts    report, listReported, dismiss                                (+ tests)
  managers/job-run-manager.ts   a verify job with a submission id → submissions.complete     (+ test)
  api/submission-schemas.ts     SubmitRequest, Submission, SubmissionList, ReportRequest, ReportedPuzzle(List)
  api/submissions.ts            POST/GET /api/submissions, GET /api/submissions/{id}
  api/reports.ts                POST /api/puzzles/{id}/report, GET /api/admin/reports,
                                POST /api/admin/puzzles/{id}/unpublish, DELETE /api/admin/puzzles/{id}/reports
  api/app.ts                    registers both; GET /api/puzzles/{id} lets admins see unpublished puzzles
  api/main.ts, api/spec.ts, worker/main.ts     wiring
  api/submissions.test.ts       route tests (auth, confirmed, admin, CSRF, rate limits, validation)
  worker/flow.test.ts           + submission → real thread → published / multiple / none / timeout → unknown
  test-support/fakes.ts         + FakeSubmissionRepository, FakeReportRepository, puzzle fake methods
  test-support/submissions.ts   submissionDeps(db, clock, puzzles, jobs) for route tests
apps/web/
  src/lib/editor/draft.ts, keyboard.ts, answers.ts, checker.ts, submit.ts   plain modules (+ tests)
  src/lib/editor/verify.worker.ts, index.ts
  src/lib/puzzles/reports.ts    report / admin client                                          (+ test)
  src/lib/puzzles/source.ts, api.ts, index.ts    summaries carry `origin`; `reports` instance
  src/lib/game/viewport.ts      + wheelView (moved out of BoardView)                           (+ test)
  src/lib/game/geometry.ts      + cellAt                                                       (+ test)
  src/lib/components/ZoomControls.svelte       the zoom pill, moved out of BoardView
  src/lib/components/BoardView.svelte          uses ZoomControls and wheelView (no behaviour change)
  src/lib/components/EditorBoard.svelte, AnswerFigure.svelte, EditorScreen.svelte, PuzzleFooter.svelte
  src/lib/components/SiteHeader.svelte         + "Create" in the main nav
  src/routes/create/+page.svelte, admin/+page.svelte
  src/routes/play/[id]/+page.svelte            PuzzleFooter under PlayScreen for server puzzles
  src/routes/account/+page.svelte              "Your puzzles", admin link, deletion text
  tests/editor.e2e.ts, tests/mailpit.ts, tests/submit.auth-e2e.ts, playwright.auth.config.ts
```

### Data model (`005_submissions.sql`)

- `puzzles.creator_id TEXT REFERENCES users(id) ON DELETE SET NULL` (added column; null for generated puzzles and for deleted accounts).
- `puzzles_by_clues (width, height, clues)`: finds a stored puzzle with the same clues (dedupe).
- `submissions`: `id` (UUID; also the published puzzle's id), `user_id → users ON DELETE CASCADE`, `width`, `height`, `clues`, `status` (`pending`/`published`/`rejected`), `verdict` (`unique`, `duplicate`, `none`, `multiple`, `unknown`, `removed`, `error`; null while pending), `puzzle_id → puzzles ON DELETE SET NULL`, `job_id`, `created_at`, `decided_at`. Index `(user_id, created_at)`.
- `reports`: `(puzzle_id → puzzles ON DELETE CASCADE, reporter_id → users ON DELETE CASCADE)` primary key, `reason` (1–500), `created_at`. Index on `created_at`.

Migration number **005** (003 and 004 are reserved for WT8 and WT9; WT8 added none, and gaps are fine: `migrate` sorts by number).

### API

| Method + path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `POST /api/submissions` | logged in, email confirmed | `{width 1–100, height 1–100, clues}` (`[0-3.]`, exactly width×height; unknown fields rejected) | 202 `Submission` + `Location` (pending; or already decided as `duplicate`/`removed`) | 400, 401, 403 (unconfirmed or cross-site), 413, 415, 429, 503 |
| `GET /api/submissions` | logged in | — | 200 `{items: Submission[]}` (own, newest first, 50) | 401 |
| `GET /api/submissions/{id}` | logged in | — | 200 `Submission` (own only) | 400, 401, 404 |
| `POST /api/puzzles/{id}/report` | logged in (confirmed or not) | `{reason}` (trimmed, 1–500) | 204 | 400, 401, 403, 404 (not published), 413, 415, 429 |
| `GET /api/admin/reports` | admin | — | 200 `{items: ReportedPuzzle[]}` | 401, 403 |
| `POST /api/admin/puzzles/{id}/unpublish` | admin | — | 204 | 400, 401, 403, 404 |
| `DELETE /api/admin/puzzles/{id}/reports` | admin | — | 204 | 400, 401, 403 |
| `GET /api/puzzles/{id}` (changed) | anyone | — | 200; an unpublished puzzle only for admins | 400, 404 |

`Submission` = `{id, width, height, status, verdict | null, puzzleId | null, createdAt, decidedAt | null}` — never a solution. `ReportedPuzzle` = `{puzzleId, width, height, origin, createdAt, count, reports: [{reason, createdAt}] (newest 5)}` — reporters are not shown. `RateLimitedError` → 429 with `Retry-After`; `QueueFullError` → 503 (both already mapped in `app.ts`).

### How a submission is decided

```
POST /api/submissions ──► SubmissionManager.submit
  rate limit (20/h/account) ─► puzzles.findByClues ─► stored? decide now: duplicate (published) / removed (unpublished)
                                                   └► else JobManager.enqueueVerify(wire, submissionId) + submissions row (pending, job_id)
worker: JobRunManager.runNext ─► ThreadTaskRunner (45 s terminate) ─► runTask verify: verify (30 s) + solve trace (5 s, unique only)
        done ─► SubmissionManager.complete(id, outcome)
                  not unique ─► rejected (none | multiple | unknown)
                  unique     ─► findByClues again (duplicate?) ─► PuzzleManager.saveSubmitted (blobs, then row) ─► published
        timeout / failed / stale ─► job row only; GET /api/submissions/{id} settles it: unknown (timeout) / error (failed)
```

### Web

- `lib/editor/` holds the plain, tested logic: `draft.ts` (size, clues, brush, resize, local save), `keyboard.ts` (cell cursor keys), `answers.ts` (the suggested clue), `checker.ts` (`LiveChecker`: debounce, worker restart, hard stop; `answerCheck` for the worker), `submit.ts` (submit, poll, list, verdict words, share URL). Components stay thin.
- `EditorBoard.svelte` is the editor's input surface: taps hit cells (`cellAt`), a one-finger drag pans a zoomable board, two fingers pinch, the wheel zooms/pans (`wheelView`), the keyboard moves a cell cursor; it draws with `BoardSvg`/`BoardCanvas` (no lines), `MiniMap` and `ZoomControls`, and a dashed ai box on the suggested cell.
- `EditorScreen.svelte` lays out the artboard's three columns (size + clue palette + clear | board | verifier), wrapping on narrow screens with the grid first, then the verifier, then the tools. Board sizing follows the play screen's rules (fit the column, 44 px touch / 24 px mouse minimum, zoom below that).
- Publishing: guests get "Log in to publish", unconfirmed accounts "Confirm your email to publish"; the button is disabled for `none`/`multiple` ("Publish — needs a unique answer", as on the artboard) and while checking, and enabled for `unique` and `unknown` ("the server checks for longer"). After a decision the card shows the verdict's words and, when published, the link with Copy link / Play it.

## DECISIONS entries

Added in Step 10 (full text there): how a submission is verified and published; the verification budget and trace; one published puzzle per clue grid; submission limits; share links use the puzzle id; reports and unpublishing; submitted puzzles outlive their creator's account (NFR-6); the editor; the publishing end-to-end test with a worker.

## Commits

One per step, in order: `feat(server): store submissions, reports and puzzle creators`; `feat(server): verify submissions in the worker and publish unique ones`; `feat(server): add submission, report and admin routes`; `refactor(web): share the zoom controls and wheel handling between boards`; `feat(web): editor draft, keys, clue suggestion and live checker`; `feat(web): submission and report clients`; `feat(web): puzzle editor with live verifier and publishing`; `feat(web): share and report puzzles, admin reports page, your puzzles`; `test(web): editor end-to-end and publishing against the API and worker`; `docs: submissions in README, TESTING, AGENTS and DECISIONS`.

## Merge notes

- **WT8 `hints`** is already merged into this base (`452f304`). This plan uses its `HintMarks`-aware renderers by passing `hint={null}` to `BoardSvg`/`BoardCanvas`, and the `BoardView` wheel code is moved as it is after WT8 (clamp ±25, rate 0.01). No conflicts expected.
- **WT9 `progress-sync`** (built in parallel; migration **004**). Expected conflicts when the second of the two merges:
  - `apps/server/src/adapters/db/database.test.ts`: the table list and migration versions. Keep both: tables gain WT9's table(s) and `reports`, `submissions`; versions become `[1, 2, 4, 5]`.
  - `createApp(...)` call sites (`api/app.test.ts`, `api/accounts.test.ts`, `worker/flow.test.ts`, `api/spec.ts`, `api/main.ts`) and `AppDeps` in `api/app.ts`: both add deps; keep both sets.
  - `domain.ts`, `ports.ts`, `test-support/fakes.ts`: both append types/fakes at the end; keep both.
  - `apps/web/src/routes/account/+page.svelte` (WT9 may add sync controls): keep both. Step 8 appends a `<style>` block after `</main>`; if WT9 adds one too, merge them into a single `<style>` block (Svelte allows only one).
  - `apps/web/src/routes/play/[id]/+page.svelte` (WT9 may load saved progress there): keep both; the `{#key}` block must still hold `PlayScreen` and then the `PuzzleFooter` condition.
  - `README.md`, `docs/TESTING.md`, `docs/DECISIONS.md`, `apps/*/AGENTS.md`: keep both texts.
  - `PlayScreen.svelte` and `lib/game/progress.ts` are not touched here, so WT9's changes there merge cleanly.
- After every merge: `bun run gen:api` (regenerates `openapi.yaml` and `packages/api-client/src/schema.ts` from the merged routes; never hand-merge those two files — take either side, then regenerate), then `bun run check`, `bun run test:e2e`, `bun run test:e2e:auth`.

## Environment notes for the implementer

- Start every shell command with `export PATH="$HOME/.bun/bin:$PATH";`. Run commands from the worktree root unless a step says otherwise.
- Don't read `.env*` files with the shell (denied); use the Read tool if needed. Step 11 passes its settings explicitly.
- Docker Compose (Garage, Mailpit) may already be running (`docker compose ps`). If you start it, stop it afterwards with `docker compose down` (never `-v`). Garage needs `./scripts/garage-init.sh` once after a fresh start.
- Biome doesn't format `.svelte` files: copy them exactly as given (two-space indents). `bun run format` after each step must report no fixes.
- Keep test files' contents exactly as given; counts below assume Mailpit is up (the Mailpit mailer test then passes instead of skipping) and Garage is down or up (the Garage test skips itself when down).
- Playwright uses the local Chromium (`bunx playwright install chromium` was run in WT4).

## Steps

Each step lists files to create (full contents), files to replace (full contents), text to append, and edits: replace the first block with the second; each "Replace" block occurs exactly once in the file at that point, and the edits of one file are applied in order. Then run the step's commands, `bun run format` (must change nothing), `bun run check`, and commit with the given message. Code blocks here use four backticks so that files containing three (Markdown) copy cleanly; the fence lines are not part of the file.

### Step 0 — Check the base

```sh
export PATH="$HOME/.bun/bin:$PATH"
git log --oneline -1 452f304          # must exist: WT8 hints is in the base
git merge-base --is-ancestor 452f304 HEAD && echo "base ok"
bun install
bun run check                         # about 508 pass (507 with Mailpit down), 0 fail
```

No commit.

### Step 1 — Submission and report tables, puzzle creators, repositories and fakes

Adds migration 005 (the `creator_id` column, the clue index, the `submissions` and `reports` tables), the domain types and ports, the SQLite repositories with their tests, the fakes, and the puzzle manager's new methods (`saveSubmitted`, `getAny`, `findByClues`, `unpublish`). Nothing calls the new repositories from a route yet. `VerifyOutcome.steps` is added in Step 2, together with the code that fills it.

#### Create `apps/server/src/adapters/db/migrations/005_submissions.sql`

````sql
-- Puzzles players submit (PRD FR-26 to FR-28). Times are milliseconds since the epoch.

-- Who submitted a puzzle; null for generated ones. Deleting the account keeps the published puzzle
-- and drops the link (DECISIONS, "Submitted puzzles outlive their creator's account").
ALTER TABLE puzzles ADD COLUMN creator_id TEXT REFERENCES users (id) ON DELETE SET NULL;

-- Finds a stored puzzle with the same clues, so each clue grid is published once.
CREATE INDEX puzzles_by_clues ON puzzles (width, height, clues);

-- Each submission and the verifier's verdict on it, for its creator to see. They belong to the
-- account and go with it.
CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 100),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 100),
  clues TEXT NOT NULL CHECK (length(clues) = width * height),
  status TEXT NOT NULL CHECK (status IN ('pending', 'published', 'rejected')),
  verdict TEXT CHECK (
    verdict IN ('unique', 'duplicate', 'none', 'multiple', 'unknown', 'removed', 'error')
  ),
  -- The published puzzle: this submission's own, or the earlier one with the same clues.
  puzzle_id TEXT REFERENCES puzzles (id) ON DELETE SET NULL,
  -- The verification job; null when the submission was decided without one (a duplicate).
  job_id TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
) STRICT;

CREATE INDEX submissions_by_user ON submissions (user_id, created_at);

-- Players' reports of published puzzles (FR-28). One per player and puzzle; reporting again
-- replaces the reason.
CREATE TABLE reports (
  puzzle_id TEXT NOT NULL REFERENCES puzzles (id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (puzzle_id, reporter_id)
) STRICT;

CREATE INDEX reports_by_created ON reports (created_at);
````

#### Edit `apps/server/src/domain.ts` (3 edits)


1. Replace

````ts
  /** Milliseconds since the epoch. */
  readonly createdAt: number;
}

````

   with

````ts
  /** Milliseconds since the epoch. */
  readonly createdAt: number;
  /** The player who submitted it; null for generated puzzles and once the account is deleted. */
  readonly creatorId: string | null;
}

````


2. Replace

````ts
  readonly puzzle: PuzzleWireV1;
}
````

   with

````ts
  readonly puzzle: PuzzleWireV1;
  /** Set when the check is for a player's submission, which the worker then decides. */
  readonly submissionId?: string;
}
````


3. Replace

````ts
  readonly purpose: AccountTokenPurpose;
  readonly createdAt: number;
  readonly expiresAt: number;
}
````

   with

````ts
  readonly purpose: AccountTokenPurpose;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export type SubmissionStatus = "pending" | "published" | "rejected";

/**
 * Why a submission was published or rejected (PRD FR-27):
 * - `unique`: verified to have one solution, and published.
 * - `duplicate`: a puzzle with the same clues is already published; the submission points at it.
 * - `none`, `multiple`, `unknown`: the verifier's answer (`unknown`: out of time).
 * - `removed`: a puzzle with the same clues was unpublished by an admin.
 * - `error`: the check failed for another reason.
 */
export type SubmissionVerdict =
  | "unique"
  | "duplicate"
  | "none"
  | "multiple"
  | "unknown"
  | "removed"
  | "error";

/** A player's submitted puzzle and what became of it. */
export interface SubmissionRecord {
  readonly id: string;
  readonly userId: string;
  /** Clues only: no seed or metadata. */
  readonly puzzle: Puzzle;
  readonly status: SubmissionStatus;
  /** Null while pending. */
  readonly verdict: SubmissionVerdict | null;
  /** The published puzzle: this submission's own, or an earlier one with the same clues. */
  readonly puzzleId: string | null;
  /** The verification job, or null when none was needed. */
  readonly jobId: string | null;
  readonly createdAt: number;
  readonly decidedAt: number | null;
}

/** A player's report of a published puzzle (PRD FR-28). */
export interface ReportRecord {
  readonly puzzleId: string;
  readonly reporterId: string;
  readonly reason: string;
  readonly createdAt: number;
}

/** A reported puzzle, for the admins' list. */
export interface ReportedPuzzle {
  readonly puzzle: PuzzleRecord;
  /** How many players reported it. */
  readonly count: number;
  /** The newest reports first, at most a few. */
  readonly reports: readonly ReportRecord[];
}
````


#### Edit `apps/server/src/ports.ts` (4 edits)


1. Replace

````ts
import type {
````

   with

````ts
import type { Puzzle } from "@loophole/core";
import type {
````


2. Replace

````ts
  PuzzleRecord,
  SessionRecord,
  Task,
````

   with

````ts
  PuzzleRecord,
  PuzzleStatus,
  ReportRecord,
  SessionRecord,
  SubmissionRecord,
  SubmissionStatus,
  SubmissionVerdict,
  Task,
````


3. Replace

````ts
  listPublished(limit: number): PuzzleRecord[];
}
````

   with

````ts
  listPublished(limit: number): PuzzleRecord[];
  /** A stored puzzle, published or not, with the same size and clues as `puzzle`; null if none. */
  findByClues(puzzle: Puzzle): PuzzleRecord | null;
  /** Returns false when there is no puzzle with this id. */
  setStatus(id: string, status: PuzzleStatus): boolean;
}
````


4. Replace

````ts
  hit(key: string, rule: RateRule): RateDecision;
}
````

   with

````ts
  hit(key: string, rule: RateRule): RateDecision;
}

/** How a pending submission ended. */
export interface SubmissionDecision {
  readonly status: Exclude<SubmissionStatus, "pending">;
  readonly verdict: SubmissionVerdict;
  readonly puzzleId: string | null;
  readonly decidedAt: number;
}

export interface SubmissionRepository {
  insert(record: SubmissionRecord): void;
  get(id: string): SubmissionRecord | null;
  /** The user's submissions, newest first. */
  listForUser(userId: string, limit: number): SubmissionRecord[];
  /** Records the decision on a pending submission. Returns false when it was not pending. */
  decide(id: string, decision: SubmissionDecision): boolean;
}

export interface ReportRepository {
  /** Stores a report, replacing the reporter's earlier report of the same puzzle. */
  upsert(report: ReportRecord): void;
  /** Reports of puzzles that are still published, newest first. */
  listForPublished(limit: number): ReportRecord[];
  deleteForPuzzle(puzzleId: string): void;
}
````


#### Edit `apps/server/src/adapters/db/puzzle-repository.ts` (7 edits)


1. Replace

````ts
import type { Database } from "bun:sqlite";
import { type PuzzleWireV1, parsePuzzle, serializePuzzle } from "@loophole/core";
import type { PuzzleOrigin, PuzzleRecord, PuzzleStatus } from "../../domain.ts";
````

   with

````ts
import type { Database } from "bun:sqlite";
import { type Puzzle, type PuzzleWireV1, parsePuzzle, serializePuzzle } from "@loophole/core";
import type { PuzzleOrigin, PuzzleRecord, PuzzleStatus } from "../../domain.ts";
````


2. Replace

````ts
  created_at: number;
};

const COLUMNS =
  "id, width, height, clues, seed, generator_version, level, origin, status, solution_key, trace_key, created_at";

````

   with

````ts
  created_at: number;
  creator_id: string | null;
};

const COLUMNS =
  "id, width, height, clues, seed, generator_version, level, origin, status, solution_key, trace_key, created_at, creator_id";

````


3. Replace

````ts
  readonly #listPublished;

  constructor(db: Database) {
    this.#insert = db.query<void, PuzzleRow>(
      `INSERT INTO puzzles (${COLUMNS}) VALUES ($id, $width, $height, $clues, $seed, $generator_version, $level, $origin, $status, $solution_key, $trace_key, $created_at) ON CONFLICT (id) DO NOTHING`,
    );
````

   with

````ts
  readonly #listPublished;
  readonly #findByClues;
  readonly #setStatus;

  constructor(db: Database) {
    this.#insert = db.query<void, PuzzleRow>(
      `INSERT INTO puzzles (${COLUMNS}) VALUES ($id, $width, $height, $clues, $seed, $generator_version, $level, $origin, $status, $solution_key, $trace_key, $created_at, $creator_id) ON CONFLICT (id) DO NOTHING`,
    );
````


4. Replace

````ts
      `SELECT ${COLUMNS} FROM puzzles WHERE status = 'published' ORDER BY created_at DESC, id LIMIT $limit`,
    );
````

   with

````ts
      `SELECT ${COLUMNS} FROM puzzles WHERE status = 'published' ORDER BY created_at DESC, id LIMIT $limit`,
    );
    this.#findByClues = db.query<PuzzleRow, { width: number; height: number; clues: string }>(
      `SELECT ${COLUMNS} FROM puzzles WHERE width = $width AND height = $height AND clues = $clues ORDER BY created_at, id LIMIT 1`,
    );
    this.#setStatus = db.query<void, { id: string; status: PuzzleStatus }>(
      "UPDATE puzzles SET status = $status WHERE id = $id",
    );
````


5. Replace

````ts
    return this.#listPublished.all({ limit }).map(fromRow);
  }
````

   with

````ts
    return this.#listPublished.all({ limit }).map(fromRow);
  }

  findByClues(puzzle: Puzzle): PuzzleRecord | null {
    const { width, height, clues } = serializePuzzle(puzzle);
    const row = this.#findByClues.get({ width, height, clues });
    return row === null ? null : fromRow(row);
  }

  setStatus(id: string, status: PuzzleStatus): boolean {
    return this.#setStatus.run({ id, status }).changes === 1;
  }
````


6. Replace

````ts
    created_at: r.createdAt,
  };
````

   with

````ts
    created_at: r.createdAt,
    creator_id: r.creatorId,
  };
````


7. Replace

````ts
    createdAt: row.created_at,
  };
````

   with

````ts
    createdAt: row.created_at,
    creatorId: row.creator_id,
  };
````


#### Edit `apps/server/src/adapters/db/puzzle-repository.test.ts` (2 edits)


1. Replace

````ts
    createdAt,
  };
````

   with

````ts
    createdAt,
    creatorId: null,
  };
````


2. Replace

````ts

  test("inserting an existing id keeps the first puzzle", () => {
````

   with

````ts

  test("findByClues finds the oldest puzzle with the same size and clues, published or not", () => {
    const repo = new SqlitePuzzleRepository(openDatabase(":memory:"));
    repo.insert(record("hidden", 1, "unpublished"));
    repo.insert(record("later", 2));
    expect(repo.findByClues(createPuzzle(2, 2, [2, 2, 2, -1]))?.id).toBe("hidden");
    expect(repo.findByClues(createPuzzle(2, 2, [2, 2, 2, 2]))).toBeNull();
    expect(repo.findByClues(createPuzzle(4, 1, [2, 2, 2, -1]))).toBeNull();
  });

  test("setStatus changes the status, and says whether the puzzle exists", () => {
    const repo = new SqlitePuzzleRepository(openDatabase(":memory:"));
    repo.insert(record("a", 1));
    expect(repo.setStatus("a", "unpublished")).toBe(true);
    expect(repo.get("a")?.status).toBe("unpublished");
    expect(repo.listPublished(10)).toEqual([]);
    expect(repo.setStatus("nope", "unpublished")).toBe(false);
  });

  test("a submitted puzzle keeps its creator", () => {
    const db = openDatabase(":memory:");
    db.run(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'a@example.com', 'h', 0)",
    );
    const repo = new SqlitePuzzleRepository(db);
    repo.insert({ ...record("s", 1), origin: "submitted", creatorId: "u1" });
    expect(repo.get("s")).toMatchObject({ origin: "submitted", creatorId: "u1" });
    db.run("DELETE FROM users WHERE id = 'u1'");
    expect(repo.get("s")).toMatchObject({ status: "published", creatorId: null });
  });

  test("inserting an existing id keeps the first puzzle", () => {
````


#### Create `apps/server/src/adapters/db/submission-repository.ts`

````ts
import type { Database } from "bun:sqlite";
import { parsePuzzle, serializePuzzle } from "@loophole/core";
import type { SubmissionRecord, SubmissionStatus, SubmissionVerdict } from "../../domain.ts";
import type { SubmissionDecision, SubmissionRepository } from "../../ports.ts";

// A type alias, not an interface, so it satisfies bun:sqlite's binding type.
type SubmissionRow = {
  id: string;
  user_id: string;
  width: number;
  height: number;
  clues: string;
  status: SubmissionStatus;
  verdict: SubmissionVerdict | null;
  puzzle_id: string | null;
  job_id: string | null;
  created_at: number;
  decided_at: number | null;
};

const COLUMNS =
  "id, user_id, width, height, clues, status, verdict, puzzle_id, job_id, created_at, decided_at";

/** Players' submissions in SQLite, with the clues as the wire format's clue string. */
export class SqliteSubmissionRepository implements SubmissionRepository {
  readonly #insert;
  readonly #get;
  readonly #listForUser;
  readonly #decide;

  constructor(db: Database) {
    this.#insert = db.query<void, SubmissionRow>(
      `INSERT INTO submissions (${COLUMNS}) VALUES ($id, $user_id, $width, $height, $clues, $status, $verdict, $puzzle_id, $job_id, $created_at, $decided_at)`,
    );
    this.#get = db.query<SubmissionRow, { id: string }>(
      `SELECT ${COLUMNS} FROM submissions WHERE id = $id`,
    );
    this.#listForUser = db.query<SubmissionRow, { user: string; limit: number }>(
      `SELECT ${COLUMNS} FROM submissions WHERE user_id = $user ORDER BY created_at DESC, id LIMIT $limit`,
    );
    this.#decide = db.query<
      void,
      {
        id: string;
        status: SubmissionStatus;
        verdict: SubmissionVerdict;
        puzzle: string | null;
        at: number;
      }
    >(
      `UPDATE submissions SET status = $status, verdict = $verdict, puzzle_id = $puzzle, decided_at = $at
       WHERE id = $id AND status = 'pending'`,
    );
  }

  insert(record: SubmissionRecord): void {
    this.#insert.run(toRow(record));
  }

  get(id: string): SubmissionRecord | null {
    const row = this.#get.get({ id });
    return row === null ? null : fromRow(row);
  }

  listForUser(userId: string, limit: number): SubmissionRecord[] {
    return this.#listForUser.all({ user: userId, limit }).map(fromRow);
  }

  decide(id: string, d: SubmissionDecision): boolean {
    const result = this.#decide.run({
      id,
      status: d.status,
      verdict: d.verdict,
      puzzle: d.puzzleId,
      at: d.decidedAt,
    });
    return result.changes === 1;
  }
}

function toRow(r: SubmissionRecord): SubmissionRow {
  const { width, height, clues } = serializePuzzle(r.puzzle);
  return {
    id: r.id,
    user_id: r.userId,
    width,
    height,
    clues,
    status: r.status,
    verdict: r.verdict,
    puzzle_id: r.puzzleId,
    job_id: r.jobId,
    created_at: r.createdAt,
    decided_at: r.decidedAt,
  };
}

function fromRow(row: SubmissionRow): SubmissionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    puzzle: parsePuzzle({ v: 1, width: row.width, height: row.height, clues: row.clues }),
    status: row.status,
    verdict: row.verdict,
    puzzleId: row.puzzle_id,
    jobId: row.job_id,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}
````

#### Create `apps/server/src/adapters/db/submission-repository.test.ts`

````ts
import { describe, expect, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import type { SubmissionRecord } from "../../domain.ts";
import { openDatabase } from "./database.ts";
import { SqliteSubmissionRepository } from "./submission-repository.ts";

function setup() {
  const db = openDatabase(":memory:");
  for (const id of ["u1", "u2"]) {
    db.query(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES ($id, $email, 'h', 0)",
    ).run({ id, email: `${id}@example.com` });
  }
  return { db, repo: new SqliteSubmissionRepository(db) };
}

function record(id: string, userId: string, createdAt: number): SubmissionRecord {
  return {
    id,
    userId,
    puzzle: createPuzzle(3, 1, [1, -1, 3]),
    status: "pending",
    verdict: null,
    puzzleId: null,
    jobId: `job-${id}`,
    createdAt,
    decidedAt: null,
  };
}

describe("SqliteSubmissionRepository", () => {
  test("get returns what insert stored, and null for an unknown id", () => {
    const { repo } = setup();
    repo.insert(record("a", "u1", 5));
    const got = repo.get("a");
    expect(got && serializePuzzle(got.puzzle)).toEqual({ v: 1, width: 3, height: 1, clues: "1.3" });
    expect({ ...got, puzzle: null }).toEqual({ ...record("a", "u1", 5), puzzle: null });
    expect(repo.get("nope")).toBeNull();
  });

  test("listForUser is the user's own, newest first, up to the limit", () => {
    const { repo } = setup();
    repo.insert(record("old", "u1", 1));
    repo.insert(record("other", "u2", 2));
    repo.insert(record("new", "u1", 3));
    expect(repo.listForUser("u1", 10).map((r) => r.id)).toEqual(["new", "old"]);
    expect(repo.listForUser("u1", 1).map((r) => r.id)).toEqual(["new"]);
  });

  test("decide records the decision once", () => {
    const { repo } = setup();
    repo.insert(record("a", "u1", 1));
    const decision = {
      status: "rejected",
      verdict: "multiple",
      puzzleId: null,
      decidedAt: 9,
    } as const;
    expect(repo.decide("a", decision)).toBe(true);
    expect(repo.get("a")).toMatchObject(decision);
    expect(repo.decide("a", { ...decision, verdict: "none" })).toBe(false);
    expect(repo.get("a")?.verdict).toBe("multiple");
  });

  test("deleting the account deletes its submissions", () => {
    const { db, repo } = setup();
    repo.insert(record("a", "u1", 1));
    db.run("DELETE FROM users WHERE id = 'u1'");
    expect(repo.get("a")).toBeNull();
  });
});
````

#### Create `apps/server/src/adapters/db/report-repository.ts`

````ts
import type { Database } from "bun:sqlite";
import type { ReportRecord } from "../../domain.ts";
import type { ReportRepository } from "../../ports.ts";

// A type alias, not an interface, so it satisfies bun:sqlite's binding type.
type ReportRow = {
  puzzle_id: string;
  reporter_id: string;
  reason: string;
  created_at: number;
};

/** Players' reports of puzzles in SQLite: one row per reporter and puzzle. */
export class SqliteReportRepository implements ReportRepository {
  readonly #upsert;
  readonly #listForPublished;
  readonly #deleteForPuzzle;

  constructor(db: Database) {
    this.#upsert = db.query<void, ReportRow>(
      `INSERT INTO reports (puzzle_id, reporter_id, reason, created_at)
       VALUES ($puzzle_id, $reporter_id, $reason, $created_at)
       ON CONFLICT (puzzle_id, reporter_id) DO UPDATE SET reason = excluded.reason, created_at = excluded.created_at`,
    );
    this.#listForPublished = db.query<ReportRow, { limit: number }>(
      `SELECT r.puzzle_id, r.reporter_id, r.reason, r.created_at
       FROM reports r JOIN puzzles p ON p.id = r.puzzle_id
       WHERE p.status = 'published'
       ORDER BY r.created_at DESC, r.puzzle_id, r.reporter_id LIMIT $limit`,
    );
    this.#deleteForPuzzle = db.query<void, { puzzle: string }>(
      "DELETE FROM reports WHERE puzzle_id = $puzzle",
    );
  }

  upsert(report: ReportRecord): void {
    this.#upsert.run({
      puzzle_id: report.puzzleId,
      reporter_id: report.reporterId,
      reason: report.reason,
      created_at: report.createdAt,
    });
  }

  listForPublished(limit: number): ReportRecord[] {
    return this.#listForPublished.all({ limit }).map((row) => ({
      puzzleId: row.puzzle_id,
      reporterId: row.reporter_id,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  }

  deleteForPuzzle(puzzleId: string): void {
    this.#deleteForPuzzle.run({ puzzle: puzzleId });
  }
}
````

#### Create `apps/server/src/adapters/db/report-repository.test.ts`

````ts
import { describe, expect, test } from "bun:test";
import { createPuzzle } from "@loophole/core";
import { openDatabase } from "./database.ts";
import { SqlitePuzzleRepository } from "./puzzle-repository.ts";
import { SqliteReportRepository } from "./report-repository.ts";

function setup() {
  const db = openDatabase(":memory:");
  for (const id of ["u1", "u2"]) {
    db.query(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES ($id, $email, 'h', 0)",
    ).run({ id, email: `${id}@example.com` });
  }
  const puzzles = new SqlitePuzzleRepository(db);
  for (const [id, clues] of [
    ["p1", [1, -1]],
    ["p2", [2, -1]],
  ] as const) {
    puzzles.insert({
      id,
      puzzle: createPuzzle(2, 1, clues),
      origin: "generated",
      status: "published",
      level: 1,
      solutionKey: "k",
      traceKey: null,
      createdAt: 0,
      creatorId: null,
    });
  }
  return { db, puzzles, repo: new SqliteReportRepository(db) };
}

describe("SqliteReportRepository", () => {
  test("upsert keeps one report per reporter and puzzle, newest reason", () => {
    const { repo } = setup();
    repo.upsert({ puzzleId: "p1", reporterId: "u1", reason: "first", createdAt: 1 });
    repo.upsert({ puzzleId: "p1", reporterId: "u1", reason: "second", createdAt: 2 });
    repo.upsert({ puzzleId: "p1", reporterId: "u2", reason: "other", createdAt: 3 });
    expect(repo.listForPublished(10)).toEqual([
      { puzzleId: "p1", reporterId: "u2", reason: "other", createdAt: 3 },
      { puzzleId: "p1", reporterId: "u1", reason: "second", createdAt: 2 },
    ]);
  });

  test("listForPublished leaves out unpublished puzzles; deleteForPuzzle clears one puzzle", () => {
    const { puzzles, repo } = setup();
    repo.upsert({ puzzleId: "p1", reporterId: "u1", reason: "a", createdAt: 1 });
    repo.upsert({ puzzleId: "p2", reporterId: "u1", reason: "b", createdAt: 2 });
    puzzles.setStatus("p2", "unpublished");
    expect(repo.listForPublished(10).map((r) => r.puzzleId)).toEqual(["p1"]);
    repo.deleteForPuzzle("p1");
    expect(repo.listForPublished(10)).toEqual([]);
  });

  test("deleting the reporter's account deletes their reports", () => {
    const { db, repo } = setup();
    repo.upsert({ puzzleId: "p1", reporterId: "u1", reason: "a", createdAt: 1 });
    db.run("DELETE FROM users WHERE id = 'u1'");
    expect(repo.listForPublished(10)).toEqual([]);
  });
});
````

#### Edit `apps/server/src/adapters/db/database.test.ts` (2 edits)


1. Replace

````ts
      "puzzles",
      "schema_migrations",
      "sessions",
      "users",
````

   with

````ts
      "puzzles",
      "reports",
      "schema_migrations",
      "sessions",
      "submissions",
      "users",
````


2. Replace

````ts
      .all();
    expect(versions).toEqual([{ version: 1 }, { version: 2 }]);
  });
````

   with

````ts
      .all();
    expect(versions).toEqual([{ version: 1 }, { version: 2 }, { version: 5 }]);
  });
````


#### Edit `apps/server/src/test-support/fakes.ts` (4 edits)


1. Replace

````ts
import type {
  AccountTokenPurpose,
````

   with

````ts
import type { Puzzle } from "@loophole/core";
import type {
  AccountTokenPurpose,
````


2. Replace

````ts
  PuzzleRecord,
  SessionRecord,
  Task,
````

   with

````ts
  PuzzleRecord,
  PuzzleStatus,
  ReportRecord,
  SessionRecord,
  SubmissionRecord,
  Task,
````


3. Replace

````ts
  PuzzleRepository,
  SessionRepository,
  TaskRunner,
````

   with

````ts
  PuzzleRepository,
  ReportRepository,
  SessionRepository,
  SubmissionDecision,
  SubmissionRepository,
  TaskRunner,
````


4. Replace

````ts
      .slice(0, limit);
  }
````

   with

````ts
      .slice(0, limit);
  }

  findByClues(puzzle: Puzzle): PuzzleRecord | null {
    const key = (p: Puzzle) => `${p.grid.width}x${p.grid.height}:${p.clues.join()}`;
    const same = [...this.records.values()].filter((r) => key(r.puzzle) === key(puzzle));
    return same.sort((a, b) => a.createdAt - b.createdAt)[0] ?? null;
  }

  setStatus(id: string, status: PuzzleStatus): boolean {
    const record = this.records.get(id);
    if (record === undefined) return false;
    this.records.set(id, { ...record, status });
    return true;
  }
}

export class FakeSubmissionRepository implements SubmissionRepository {
  readonly records = new Map<string, SubmissionRecord>();

  insert(record: SubmissionRecord): void {
    this.records.set(record.id, record);
  }

  get(id: string): SubmissionRecord | null {
    return this.records.get(id) ?? null;
  }

  listForUser(userId: string, limit: number): SubmissionRecord[] {
    return [...this.records.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  decide(id: string, decision: SubmissionDecision): boolean {
    const record = this.records.get(id);
    if (record?.status !== "pending") return false;
    this.records.set(id, { ...record, ...decision });
    return true;
  }
}

/** Reports in an array. `published` says which puzzles count as published for the list. */
export class FakeReportRepository implements ReportRepository {
  reports: ReportRecord[] = [];

  constructor(private readonly published: (puzzleId: string) => boolean = () => true) {}

  upsert(report: ReportRecord): void {
    this.reports = this.reports.filter(
      (r) => r.puzzleId !== report.puzzleId || r.reporterId !== report.reporterId,
    );
    this.reports.push(report);
  }

  listForPublished(limit: number): ReportRecord[] {
    return this.reports
      .filter((r) => this.published(r.puzzleId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  deleteForPuzzle(puzzleId: string): void {
    this.reports = this.reports.filter((r) => r.puzzleId !== puzzleId);
  }
````


#### Edit `apps/server/src/managers/puzzle-manager.ts` (5 edits)


1. Replace

````ts
import { decodeEdges, parsePuzzle } from "@loophole/core";
import type { GeneratedPuzzle, PuzzleRecord } from "../domain.ts";
import type { BlobStore, Clock, PuzzleRepository } from "../ports.ts";
````

   with

````ts
import { decodeEdges, type Puzzle, parsePuzzle, type Step } from "@loophole/core";
import type { GeneratedPuzzle, PuzzleOrigin, PuzzleRecord } from "../domain.ts";
import type { BlobStore, Clock, PuzzleRepository } from "../ports.ts";
````


2. Replace

````ts
  async saveGenerated(id: string, generated: GeneratedPuzzle): Promise<string> {
    const { puzzles, blobs, clock } = this.#deps;
````

   with

````ts
  async saveGenerated(id: string, generated: GeneratedPuzzle): Promise<string> {
    const { puzzle, solution, steps } = generated;
    return this.#save(id, parsePuzzle(puzzle), solution, steps, "generated", null);
  }

  /**
   * Stores a player's verified puzzle under `id` as published, with `creatorId` as its creator
   * (PRD FR-27). Like `saveGenerated`: blobs first, and saving the same id again changes nothing.
   */
  async saveSubmitted(
    id: string,
    puzzle: Puzzle,
    solution: string,
    steps: readonly Step[],
    creatorId: string,
  ): Promise<string> {
    return this.#save(id, puzzle, solution, steps, "submitted", creatorId);
  }

  async #save(
    id: string,
    puzzle: Puzzle,
    solution: string,
    steps: readonly Step[],
    origin: PuzzleOrigin,
    creatorId: string | null,
  ): Promise<string> {
    const { puzzles, blobs, clock } = this.#deps;
````


3. Replace

````ts
    const traceKey = `puzzles/${id}/trace.json`;
    await blobs.put(solutionKey, generated.solution, "text/plain");
    await blobs.put(traceKey, JSON.stringify({ v: 1, steps: generated.steps }), "application/json");
    puzzles.insert({
      id,
      puzzle: parsePuzzle(generated.puzzle),
      origin: "generated",
      status: "published",
````

   with

````ts
    const traceKey = `puzzles/${id}/trace.json`;
    await blobs.put(solutionKey, solution, "text/plain");
    await blobs.put(traceKey, JSON.stringify({ v: 1, steps }), "application/json");
    puzzles.insert({
      id,
      puzzle,
      origin,
      status: "published",
````


4. Replace

````ts
      createdAt: clock.now(),
    });
````

   with

````ts
      createdAt: clock.now(),
      creatorId,
    });
````


5. Replace

````ts
    return record?.status === "published" ? record : null;
  }
````

   with

````ts
    return record?.status === "published" ? record : null;
  }

  /** A puzzle whether published or not, for admins; null when there is none with this id. */
  getAny(id: string): PuzzleRecord | null {
    return this.#deps.puzzles.get(id);
  }

  /** A stored puzzle, published or not, with the same size and clues; null if none. */
  findByClues(puzzle: Puzzle): PuzzleRecord | null {
    return this.#deps.puzzles.findByClues(puzzle);
  }

  /**
   * Takes a puzzle out of lists and out of reach of players (PRD FR-28). Returns false when there
   * is no puzzle with this id.
   */
  unpublish(id: string): boolean {
    return this.#deps.puzzles.setStatus(id, "unpublished");
  }
````


#### Append to the end of `apps/server/src/managers/puzzle-manager.test.ts`

Add this text after the file's last line (it starts with a blank line):

````ts

describe("PuzzleManager for submitted puzzles", () => {
  test("saveSubmitted stores a published puzzle with its creator", async () => {
    const { puzzles, blobs, manager } = setup();
    const puzzle = createPuzzle(2, 2, [2, 2, 2, 2]);
    expect(await manager.saveSubmitted("s-1", puzzle, "112211121121", [], "u1")).toBe("s-1");
    expect(puzzles.get("s-1")).toMatchObject({
      origin: "submitted",
      status: "published",
      creatorId: "u1",
    });
    expect(await blobs.get("puzzles/s-1/solution.txt")).toBe("112211121121");
  });

  test("unpublish hides a puzzle from players but getAny and findByClues still see it", async () => {
    const { manager, save } = setup();
    const id = await save();
    expect(manager.unpublish(id)).toBe(true);
    expect(manager.get(id)).toBeNull();
    expect(manager.listRecent(10)).toEqual([]);
    expect(manager.getAny(id)?.status).toBe("unpublished");
    expect(manager.findByClues(createPuzzle(2, 2, [2, 2, 2, 2]))?.id).toBe(id);
    expect(manager.unpublish("nope")).toBe(false);
  });
});
````

Run:

```sh
bun test apps/server/src/adapters/db apps/server/src/managers/puzzle-manager.test.ts
bun run format && bun run check          # about 520 pass (519 with Mailpit down), 0 fail
```

Commit: `git add -A && git commit -m "feat(server): store submissions, reports and puzzle creators"`


### Step 2 — Submission and report managers; the worker verifies submissions

The worker side of FR-27: `runTask` adds the trace for a unique puzzle (`TRACE_TIME_LIMIT_MS`, the `[WT10]` follow-up), `SubmissionManager` decides submissions (`submit`, `get`, `listMine`, `complete`, and settling a pending submission whose job ended without deciding it — timed out, failed, abandoned, or done before the row existed), `ReportManager` holds the report logic, and `JobRunManager` passes a submission's verification to `SubmissionManager.complete`. The worker's composition root wires it. The flow test runs real threads: unique → published as `submitted` without its solution in the response, multiple and none → rejected, a 1 ms job limit → `unknown`.

#### Edit `apps/server/src/domain.ts` (1 edit)


1. Replace

````ts
  readonly solutions: readonly string[];
}
````

   with

````ts
  readonly solutions: readonly string[];
  /** For a `unique` puzzle, the rule solver's steps from an empty board (for hints); else empty. */
  readonly steps: readonly Step[];
}
````


#### Edit `apps/server/src/managers/job-manager.ts` (1 edit)


1. Replace

````ts

  /** Queues a uniqueness check of a puzzle (PRD FR-4). Throws `QueueFullError`. */
  enqueueVerify(puzzle: PuzzleWireV1): Job {
    return this.#enqueue({ kind: "verify", input: { puzzle } });
  }
````

   with

````ts

  /**
   * Queues a uniqueness check of a puzzle (PRD FR-4), for the submission `submissionId` when given.
   * Throws `QueueFullError`.
   */
  enqueueVerify(puzzle: PuzzleWireV1, submissionId?: string): Job {
    const input = submissionId === undefined ? { puzzle } : { puzzle, submissionId };
    return this.#enqueue({ kind: "verify", input });
  }
````


#### Edit `apps/server/src/adapters/tasks/run-task.ts` (3 edits)


1. Replace

````ts
import { encodeEdges, generate, parsePuzzle, serializePuzzle, verify } from "@loophole/core";
import type { Task, TaskOutput } from "../../domain.ts";
````

   with

````ts
import { encodeEdges, generate, parsePuzzle, serializePuzzle, solve, verify } from "@loophole/core";
import type { Task, TaskOutput } from "../../domain.ts";
````


2. Replace

````ts
const REMOVAL_SHARE = 0.9;

````

   with

````ts
const REMOVAL_SHARE = 0.9;

/**
 * Time the rule solver gets to record a unique puzzle's steps after verifying it. Verify's 30 s
 * budget plus this stays inside the verification job's 45 s limit (`VERIFY_TIMEOUT_MS`).
 */
export const TRACE_TIME_LIMIT_MS = 5_000;

````


3. Replace

````ts
    case "verify": {
      // Default time budget: 30 s (PRD NFR-1). The task runner's timeout is the outer limit.
      const result = verify(parsePuzzle(task.input.puzzle));
      return {
        kind: "verify",
        verified: { status: result.status, solutions: result.solutions.map(encodeEdges) },
      };
````

   with

````ts
    case "verify": {
      const puzzle = parsePuzzle(task.input.puzzle);
      // Default time budget: 30 s (PRD NFR-1). The task runner's timeout is the outer limit.
      const result = verify(puzzle);
      // The trace of a unique puzzle. One that needs search gets the steps up to where the rules
      // got stuck; hints for it fall back to revealed lines (DECISIONS, WT8).
      const steps =
        result.status === "unique" ? solve(puzzle, { timeLimitMs: TRACE_TIME_LIMIT_MS }).steps : [];
      return {
        kind: "verify",
        verified: { status: result.status, solutions: result.solutions.map(encodeEdges), steps },
      };
````


#### Edit `apps/server/src/adapters/tasks/run-task.test.ts` (2 edits)


1. Replace

````ts
      kind: "verify",
      verified: { status: "unique", solutions: ["112211121121"] },
    });
````

   with

````ts
      kind: "verify",
      verified: {
        status: "unique",
        solutions: ["112211121121"],
        steps: expect.arrayContaining([expect.objectContaining({ rule: expect.any(String) })]),
      },
    });
````


2. Replace

````ts
    expect(out.kind === "verify" && out.verified.status).toBe("multiple");
  });
````

   with

````ts
    expect(out.kind === "verify" && out.verified.status).toBe("multiple");
    expect(out.kind === "verify" && out.verified.steps).toEqual([]);
  });
````


#### Create `apps/server/src/managers/submission-manager.ts`

````ts
import { type Puzzle, serializePuzzle } from "@loophole/core";
import type { PuzzleRecord, SubmissionRecord, VerifyOutcome } from "../domain.ts";
import type {
  Clock,
  RateLimiter,
  RateRule,
  SubmissionDecision,
  SubmissionRepository,
} from "../ports.ts";
import { RateLimitedError } from "./errors.ts";
import type { JobManager } from "./job-manager.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";

/** Submissions one account may make (DECISIONS, "Submission limits"). */
export const SUBMISSIONS_PER_ACCOUNT: RateRule = { limit: 20, windowMs: 60 * 60 * 1000 };

export interface SubmissionManagerDeps {
  readonly submissions: SubmissionRepository;
  readonly puzzles: PuzzleManager;
  readonly jobs: JobManager;
  readonly limiter: RateLimiter;
  readonly clock: Clock;
  readonly newId: () => string;
}

/**
 * Players' puzzles (PRD FR-27): a submission is queued for the verifier, and the worker publishes
 * it when it has exactly one solution or rejects it with the verdict. A clue grid that is already
 * stored is decided at once, without a job.
 */
export class SubmissionManager {
  readonly #deps: SubmissionManagerDeps;

  constructor(deps: SubmissionManagerDeps) {
    this.#deps = deps;
  }

  /**
   * Submits `puzzle` (clues only) for `userId`. Throws `RateLimitedError` past the account's limit
   * and `QueueFullError` when the job queue is full.
   */
  submit(userId: string, puzzle: Puzzle): SubmissionRecord {
    const { submissions, puzzles, jobs, limiter, clock, newId } = this.#deps;
    const decision = limiter.hit(`submit:${userId}`, SUBMISSIONS_PER_ACCOUNT);
    if (!decision.allowed) throw new RateLimitedError(decision.retryAfterMs);
    const id = newId();
    const now = clock.now();
    const base = { id, userId, puzzle, createdAt: now };
    const existing = puzzles.findByClues(puzzle);
    let record: SubmissionRecord;
    if (existing !== null) {
      record = { ...base, ...sameClues(existing, now), jobId: null };
    } else {
      const job = jobs.enqueueVerify(serializePuzzle(puzzle), id);
      record = {
        ...base,
        status: "pending",
        verdict: null,
        puzzleId: null,
        jobId: job.id,
        decidedAt: null,
      };
    }
    submissions.insert(record);
    return record;
  }

  /** The user's own submission, or null when there is none with this id or it is someone else's. */
  get(id: string, userId: string): SubmissionRecord | null {
    const record = this.#deps.submissions.get(id);
    return record === null || record.userId !== userId ? null : this.#settle(record);
  }

  /** The user's submissions, newest first. */
  listMine(userId: string, limit: number): SubmissionRecord[] {
    return this.#deps.submissions.listForUser(userId, limit).map((r) => this.#settle(r));
  }

  /**
   * Decides a pending submission from its verification (called by the worker). A `unique` puzzle
   * is published under the submission's id, unless the same clues were stored meanwhile. Does
   * nothing when the submission is gone (the account was deleted) or already decided.
   */
  async complete(id: string, outcome: VerifyOutcome): Promise<void> {
    const { submissions, puzzles, clock } = this.#deps;
    const record = submissions.get(id);
    if (record === null || record.status !== "pending") return;
    if (outcome.status !== "unique") {
      submissions.decide(id, {
        status: "rejected",
        verdict: outcome.status,
        puzzleId: null,
        decidedAt: clock.now(),
      });
      return;
    }
    const existing = puzzles.findByClues(record.puzzle);
    if (existing !== null && existing.id !== id) {
      submissions.decide(id, sameClues(existing, clock.now()));
      return;
    }
    await puzzles.saveSubmitted(
      id,
      record.puzzle,
      outcome.solutions[0],
      outcome.steps,
      record.userId,
    );
    submissions.decide(id, {
      status: "published",
      verdict: "unique",
      puzzleId: id,
      decidedAt: clock.now(),
    });
  }

  /**
   * A pending submission whose job ended without deciding it is rejected here, when it is next
   * read: `unknown` when the job timed out, `error` when it failed, was abandoned by crashed
   * workers, or finished without finding the submission (a worker that claimed the job in the
   * moment before `submit` stored the row). `complete` always decides before the job is marked
   * done, so a done job with a pending submission never decides it later.
   */
  #settle(record: SubmissionRecord): SubmissionRecord {
    const { submissions, jobs, clock } = this.#deps;
    if (record.status !== "pending" || record.jobId === null) return record;
    const job = jobs.get(record.jobId);
    if (job === null || job.status === "queued" || job.status === "running") return record;
    const decision: SubmissionDecision = {
      status: "rejected",
      verdict: job.status === "timeout" ? "unknown" : "error",
      puzzleId: null,
      decidedAt: clock.now(),
    };
    submissions.decide(record.id, decision);
    return submissions.get(record.id) ?? record;
  }
}

/** The decision for a submission whose clues match the stored puzzle `existing`. */
function sameClues(existing: PuzzleRecord, now: number): SubmissionDecision {
  return existing.status === "published"
    ? { status: "published", verdict: "duplicate", puzzleId: existing.id, decidedAt: now }
    : { status: "rejected", verdict: "removed", puzzleId: null, decidedAt: now };
}
````

#### Create `apps/server/src/managers/submission-manager.test.ts`

````ts
import { describe, expect, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import type { TaskOutcome, VerifyOutcome } from "../domain.ts";
import {
  FakeClock,
  FakeJobQueue,
  FakePuzzleRepository,
  FakeSubmissionRepository,
  FakeTaskRunner,
  sequentialIds,
} from "../test-support/fakes.ts";
import { RateLimitedError } from "./errors.ts";
import { JobManager } from "./job-manager.ts";
import { JobRunManager } from "./job-run-manager.ts";
import { PuzzleManager } from "./puzzle-manager.ts";
import { SUBMISSIONS_PER_ACCOUNT, SubmissionManager } from "./submission-manager.ts";

// 2×2 puzzles: "2222" has one solution (the outer square), an empty grid several.
const UNIQUE = createPuzzle(2, 2, [2, 2, 2, 2]);
const OPEN = createPuzzle(2, 2);
const SOLUTION = "112211121121";

const UNIQUE_OUTCOME: VerifyOutcome = {
  status: "unique",
  solutions: [SOLUTION],
  steps: [{ rule: "clue-satisfied", changes: [{ edge: 0, state: 1 }], cells: [0], dots: [] }],
};

function setup() {
  const clock = new FakeClock(1_000);
  const queue = new FakeJobQueue();
  const puzzleRepo = new FakePuzzleRepository();
  const blobs = new MemoryBlobStore();
  const repo = new FakeSubmissionRepository();
  const puzzles = new PuzzleManager({ puzzles: puzzleRepo, blobs, clock });
  const jobs = new JobManager({ jobs: queue, clock, newId: sequentialIds("j"), maxQueued: 100 });
  const manager = new SubmissionManager({
    submissions: repo,
    puzzles,
    jobs,
    limiter: new MemoryRateLimiter(clock),
    clock,
    newId: sequentialIds("s"),
  });
  return { clock, queue, puzzleRepo, blobs, repo, puzzles, manager };
}

describe("SubmissionManager.submit", () => {
  test("queues a verification for the submission and stores it as pending", () => {
    const { queue, manager } = setup();
    const record = manager.submit("u1", UNIQUE);
    expect(record).toMatchObject({
      id: "s-1",
      userId: "u1",
      status: "pending",
      verdict: null,
      puzzleId: null,
      jobId: "j-1",
      createdAt: 1_000,
      decidedAt: null,
    });
    expect(queue.get("j-1")).toMatchObject({
      kind: "verify",
      input: { puzzle: serializePuzzle(UNIQUE), submissionId: "s-1" },
    });
    expect(manager.get("s-1", "u1")?.status).toBe("pending");
  });

  test("clues already published are decided at once as a duplicate of that puzzle", async () => {
    const { queue, puzzles, manager } = setup();
    await puzzles.saveGenerated("p1", {
      puzzle: serializePuzzle(UNIQUE),
      solution: SOLUTION,
      steps: [],
    });
    expect(manager.submit("u1", UNIQUE)).toMatchObject({
      status: "published",
      verdict: "duplicate",
      puzzleId: "p1",
      jobId: null,
      decidedAt: 1_000,
    });
    expect(queue.jobs.size).toBe(0);
  });

  test("clues of an unpublished puzzle are rejected as removed", async () => {
    const { puzzles, manager } = setup();
    await puzzles.saveGenerated("p1", {
      puzzle: serializePuzzle(UNIQUE),
      solution: SOLUTION,
      steps: [],
    });
    puzzles.unpublish("p1");
    expect(manager.submit("u1", UNIQUE)).toMatchObject({
      status: "rejected",
      verdict: "removed",
      puzzleId: null,
    });
  });

  test("an account gets a limited number of submissions per hour", () => {
    const { clock, manager } = setup();
    for (let i = 0; i < SUBMISSIONS_PER_ACCOUNT.limit; i++) manager.submit("u1", OPEN);
    expect(() => manager.submit("u1", OPEN)).toThrow(RateLimitedError);
    manager.submit("u2", OPEN); // another account is not affected
    clock.advance(SUBMISSIONS_PER_ACCOUNT.windowMs);
    manager.submit("u1", OPEN);
  });
});

describe("SubmissionManager.get and listMine", () => {
  test("only the creator sees a submission, newest first", () => {
    const { clock, manager } = setup();
    manager.submit("u1", UNIQUE);
    clock.advance(10);
    manager.submit("u1", OPEN);
    manager.submit("u2", OPEN);
    expect(manager.get("s-1", "u2")).toBeNull();
    expect(manager.get("nope", "u1")).toBeNull();
    expect(manager.listMine("u1", 10).map((r) => r.id)).toEqual(["s-2", "s-1"]);
  });

  test("a job that finished without deciding its submission reads as error", () => {
    const { clock, queue, manager } = setup();
    manager.submit("u1", UNIQUE);
    // As if a worker had run the job before the submission row existed.
    queue.claimNext("w", clock.now());
    queue.finish("j-1", "w", { status: "done", result: { kind: "verify", status: "unique" } }, 0);
    expect(manager.get("s-1", "u1")).toMatchObject({ status: "rejected", verdict: "error" });
  });

  test("a submission whose job timed out reads as unknown, and a failed one as error", () => {
    const { clock, queue, manager } = setup();
    manager.submit("u1", UNIQUE);
    manager.submit("u1", OPEN);
    for (const [id, status] of [
      ["j-1", "timeout"],
      ["j-2", "failed"],
    ] as const) {
      queue.claimNext("w", clock.now());
      queue.finish(id, "w", { status, error: "stopped" }, clock.now());
    }
    clock.advance(5);
    expect(manager.get("s-1", "u1")).toMatchObject({
      status: "rejected",
      verdict: "unknown",
      decidedAt: 1_005,
    });
    expect(manager.listMine("u1", 10).find((r) => r.id === "s-2")).toMatchObject({
      status: "rejected",
      verdict: "error",
    });
  });
});

describe("SubmissionManager.complete", () => {
  test("a unique puzzle is published under the submission's id with its creator", async () => {
    const { clock, puzzleRepo, blobs, manager } = setup();
    manager.submit("u1", UNIQUE);
    clock.advance(100);
    await manager.complete("s-1", UNIQUE_OUTCOME);
    expect(manager.get("s-1", "u1")).toMatchObject({
      status: "published",
      verdict: "unique",
      puzzleId: "s-1",
      decidedAt: 1_100,
    });
    expect(puzzleRepo.get("s-1")).toMatchObject({
      origin: "submitted",
      status: "published",
      creatorId: "u1",
    });
    expect(await blobs.get("puzzles/s-1/solution.txt")).toBe(SOLUTION);
    expect(JSON.parse((await blobs.get("puzzles/s-1/trace.json")) ?? "")).toEqual({
      v: 1,
      steps: UNIQUE_OUTCOME.steps,
    });
  });

  test("none, multiple and unknown are rejected with that verdict, and nothing is published", async () => {
    for (const status of ["none", "multiple", "unknown"] as const) {
      const { puzzleRepo, manager } = setup();
      manager.submit("u1", OPEN);
      await manager.complete("s-1", { status, solutions: [], steps: [] });
      expect(manager.get("s-1", "u1")).toMatchObject({ status: "rejected", verdict: status });
      expect(puzzleRepo.records.size).toBe(0);
    }
  });

  test("the same clues published while it waited make it a duplicate", async () => {
    const { manager } = setup();
    manager.submit("u1", UNIQUE);
    manager.submit("u2", UNIQUE);
    await manager.complete("s-1", UNIQUE_OUTCOME);
    await manager.complete("s-2", UNIQUE_OUTCOME);
    expect(manager.get("s-2", "u2")).toMatchObject({ verdict: "duplicate", puzzleId: "s-1" });
  });

  test("a deleted or already decided submission is left alone", async () => {
    const { repo, puzzleRepo, manager } = setup();
    await manager.complete("gone", UNIQUE_OUTCOME);
    manager.submit("u1", UNIQUE);
    await manager.complete("s-1", { status: "multiple", solutions: [], steps: [] });
    await manager.complete("s-1", UNIQUE_OUTCOME);
    expect(repo.get("s-1")?.verdict).toBe("multiple");
    expect(puzzleRepo.records.size).toBe(0);
  });

  test("the worker decides the submission when its verification job ends", async () => {
    const { clock, queue, puzzles, manager } = setup();
    const outcome: TaskOutcome = {
      status: "done",
      output: { kind: "verify", verified: UNIQUE_OUTCOME },
    };
    const runs = new JobRunManager({
      jobs: queue,
      tasks: new FakeTaskRunner(async () => outcome),
      puzzles,
      submissions: manager,
      clock,
      settings: {
        generateTimeoutMs: 60_000,
        verifyTimeoutMs: 45_000,
        progressIntervalMs: 500,
        heartbeatMs: 5_000,
        staleMs: 30_000,
        maxAttempts: 3,
      },
    });
    manager.submit("u1", UNIQUE);
    expect(await runs.runNext("w")).toBe(true);
    expect(queue.get("j-1")).toMatchObject({
      status: "done",
      result: { kind: "verify", status: "unique" },
    });
    expect(manager.get("s-1", "u1")?.status).toBe("published");
  });
});
````

#### Create `apps/server/src/managers/report-manager.ts`

````ts
import type { ReportedPuzzle, ReportRecord } from "../domain.ts";
import type { Clock, RateLimiter, RateRule, ReportRepository } from "../ports.ts";
import { RateLimitedError } from "./errors.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";

/** Reports one account may send (DECISIONS, "Reports and unpublishing"). */
export const REPORTS_PER_ACCOUNT: RateRule = { limit: 20, windowMs: 60 * 60 * 1000 };

/** How many reports the admins' list reads, and how many it shows per puzzle. */
const LIST_REPORTS = 500;
const REPORTS_PER_PUZZLE = 5;

export interface ReportManagerDeps {
  readonly reports: ReportRepository;
  readonly puzzles: PuzzleManager;
  readonly limiter: RateLimiter;
  readonly clock: Clock;
}

/** Players report published puzzles; admins see the reports and dismiss them (PRD FR-28). */
export class ReportManager {
  readonly #deps: ReportManagerDeps;

  constructor(deps: ReportManagerDeps) {
    this.#deps = deps;
  }

  /**
   * Records `userId`'s report of a published puzzle, replacing their earlier one. Returns false
   * when there is no published puzzle with this id. Throws `RateLimitedError` past the limit.
   */
  report(userId: string, puzzleId: string, reason: string): boolean {
    const { reports, puzzles, limiter, clock } = this.#deps;
    const decision = limiter.hit(`report:${userId}`, REPORTS_PER_ACCOUNT);
    if (!decision.allowed) throw new RateLimitedError(decision.retryAfterMs);
    if (puzzles.get(puzzleId) === null) return false;
    reports.upsert({ puzzleId, reporterId: userId, reason, createdAt: clock.now() });
    return true;
  }

  /** Published puzzles with reports, the most recently reported first. */
  listReported(): ReportedPuzzle[] {
    const { reports, puzzles } = this.#deps;
    const byPuzzle = new Map<string, ReportRecord[]>();
    for (const r of reports.listForPublished(LIST_REPORTS)) {
      const list = byPuzzle.get(r.puzzleId) ?? [];
      list.push(r);
      byPuzzle.set(r.puzzleId, list);
    }
    const out: ReportedPuzzle[] = [];
    for (const [id, list] of byPuzzle) {
      const puzzle = puzzles.get(id);
      if (puzzle === null) continue;
      out.push({ puzzle, count: list.length, reports: list.slice(0, REPORTS_PER_PUZZLE) });
    }
    return out;
  }

  /** Clears a puzzle's reports, keeping it published. */
  dismiss(puzzleId: string): void {
    this.#deps.reports.deleteForPuzzle(puzzleId);
  }
}
````

#### Create `apps/server/src/managers/report-manager.test.ts`

````ts
import { describe, expect, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import { FakeClock, FakePuzzleRepository, FakeReportRepository } from "../test-support/fakes.ts";
import { RateLimitedError } from "./errors.ts";
import { PuzzleManager } from "./puzzle-manager.ts";
import { REPORTS_PER_ACCOUNT, ReportManager } from "./report-manager.ts";

async function setup() {
  const clock = new FakeClock(1_000);
  const puzzleRepo = new FakePuzzleRepository();
  const puzzles = new PuzzleManager({ puzzles: puzzleRepo, blobs: new MemoryBlobStore(), clock });
  for (const [id, clues] of [
    ["p1", [2, 2, 2, 2]],
    ["p2", [2, 2, 2, -1]],
  ] as const) {
    await puzzles.saveGenerated(id, {
      puzzle: serializePuzzle(createPuzzle(2, 2, clues)),
      solution: "112211121121",
      steps: [],
    });
  }
  const reports = new FakeReportRepository((id) => puzzleRepo.get(id)?.status === "published");
  const manager = new ReportManager({
    reports,
    puzzles,
    limiter: new MemoryRateLimiter(clock),
    clock,
  });
  return { clock, puzzles, reports, manager };
}

describe("ReportManager", () => {
  test("a report of a published puzzle is stored; reporting again replaces the reason", async () => {
    const { clock, reports, manager } = await setup();
    expect(manager.report("u1", "p1", "spells a rude word")).toBe(true);
    clock.advance(10);
    expect(manager.report("u1", "p1", "actually two rude words")).toBe(true);
    expect(reports.reports).toEqual([
      { puzzleId: "p1", reporterId: "u1", reason: "actually two rude words", createdAt: 1_010 },
    ]);
  });

  test("an unknown or unpublished puzzle can't be reported", async () => {
    const { puzzles, manager } = await setup();
    puzzles.unpublish("p2");
    expect(manager.report("u1", "nope", "x")).toBe(false);
    expect(manager.report("u1", "p2", "x")).toBe(false);
  });

  test("an account gets a limited number of reports per hour", async () => {
    const { manager } = await setup();
    for (let i = 0; i < REPORTS_PER_ACCOUNT.limit; i++) manager.report("u1", "p1", `r${i}`);
    expect(() => manager.report("u1", "p1", "again")).toThrow(RateLimitedError);
  });

  test("listReported groups by puzzle, most recently reported first, and skips unpublished ones", async () => {
    const { clock, puzzles, manager } = await setup();
    manager.report("u1", "p1", "first");
    clock.advance(1);
    manager.report("u2", "p2", "second");
    clock.advance(1);
    manager.report("u3", "p1", "third");
    const list = manager.listReported();
    expect(list.map((r) => [r.puzzle.id, r.count, r.reports.map((x) => x.reason)])).toEqual([
      ["p1", 2, ["third", "first"]],
      ["p2", 1, ["second"]],
    ]);
    puzzles.unpublish("p1");
    expect(manager.listReported().map((r) => r.puzzle.id)).toEqual(["p2"]);
  });

  test("dismiss clears a puzzle's reports and keeps it published", async () => {
    const { puzzles, manager } = await setup();
    manager.report("u1", "p1", "meh");
    manager.dismiss("p1");
    expect(manager.listReported()).toEqual([]);
    expect(puzzles.get("p1")).not.toBeNull();
  });
});
````

#### Edit `apps/server/src/managers/job-run-manager.ts` (4 edits)


1. Replace

````ts
import type { PuzzleManager } from "./puzzle-manager.ts";

````

   with

````ts
import type { PuzzleManager } from "./puzzle-manager.ts";
import type { SubmissionManager } from "./submission-manager.ts";

````


2. Replace

````ts
  readonly puzzles: PuzzleManager;
  readonly clock: Clock;
````

   with

````ts
  readonly puzzles: PuzzleManager;
  /** Decides the submission a verification was for. */
  readonly submissions: SubmissionManager;
  readonly clock: Clock;
````


3. Replace

````ts

  /** Stores what a task produced. A generated puzzle takes its job's id. */
  async #store(job: Job, output: TaskOutput): Promise<JobResult> {
````

   with

````ts

  /**
   * Stores what a task produced. A generated puzzle takes its job's id; a verification for a
   * submission decides that submission.
   */
  async #store(job: Job, output: TaskOutput): Promise<JobResult> {
````


4. Replace

````ts
      case "verify":
        return { kind: "verify", status: output.verified.status };
````

   with

````ts
      case "verify":
        if (job.kind === "verify" && job.input.submissionId !== undefined) {
          await this.#deps.submissions.complete(job.input.submissionId, output.verified);
        }
        return { kind: "verify", status: output.verified.status };
````


#### Edit `apps/server/src/managers/job-run-manager.test.ts` (4 edits)


1. Replace

````ts
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import type { TaskOutcome } from "../domain.ts";
````

   with

````ts
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import type { TaskOutcome } from "../domain.ts";
````


2. Replace

````ts
  FakePuzzleRepository,
  FakeTaskRunner,
} from "../test-support/fakes.ts";
import { JobRunManager, type JobRunSettings } from "./job-run-manager.ts";
import { PuzzleManager } from "./puzzle-manager.ts";

````

   with

````ts
  FakePuzzleRepository,
  FakeSubmissionRepository,
  FakeTaskRunner,
  sequentialIds,
} from "../test-support/fakes.ts";
import { JobManager } from "./job-manager.ts";
import { JobRunManager, type JobRunSettings } from "./job-run-manager.ts";
import { PuzzleManager } from "./puzzle-manager.ts";
import { SubmissionManager } from "./submission-manager.ts";

````


3. Replace

````ts
  });
  const manager = new JobRunManager({ jobs, tasks: runner, puzzles, clock, settings });
  const enqueue = (id: string) =>
````

   with

````ts
  });
  const submissions = new SubmissionManager({
    submissions: new FakeSubmissionRepository(),
    puzzles,
    jobs: new JobManager({ jobs, clock, newId: sequentialIds("j"), maxQueued: 10 }),
    limiter: new MemoryRateLimiter(clock),
    clock,
    newId: sequentialIds("s"),
  });
  const manager = new JobRunManager({ jobs, tasks: runner, puzzles, submissions, clock, settings });
  const enqueue = (id: string) =>
````


4. Replace

````ts
      status: "done",
      output: { kind: "verify", verified: { status: "multiple", solutions: ["1", "2"] } },
    }));
````

   with

````ts
      status: "done",
      output: {
        kind: "verify",
        verified: { status: "multiple", solutions: ["1", "2"], steps: [] },
      },
    }));
````


#### Create `apps/server/src/test-support/submissions.ts`

````ts
import type { Database } from "bun:sqlite";
import { SqliteReportRepository } from "../adapters/db/report-repository.ts";
import { SqliteSubmissionRepository } from "../adapters/db/submission-repository.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import type { JobManager } from "../managers/job-manager.ts";
import type { PuzzleManager } from "../managers/puzzle-manager.ts";
import { ReportManager } from "../managers/report-manager.ts";
import { SubmissionManager } from "../managers/submission-manager.ts";
import type { Clock } from "../ports.ts";
import { sequentialIds } from "./fakes.ts";

/**
 * The submission and report side of the API for route tests: SQLite repositories on `db` and a
 * rate limiter of their own. Spread the result into `createApp`'s deps.
 */
export function submissionDeps(
  db: Database,
  clock: Clock,
  puzzles: PuzzleManager,
  jobs: JobManager,
) {
  const limiter = new MemoryRateLimiter(clock);
  const submissions = new SubmissionManager({
    submissions: new SqliteSubmissionRepository(db),
    puzzles,
    jobs,
    limiter,
    clock,
    newId: sequentialIds("s"),
  });
  const reports = new ReportManager({
    reports: new SqliteReportRepository(db),
    puzzles,
    limiter,
    clock,
  });
  return { submissions, reports };
}
````

#### Edit `apps/server/src/worker/main.ts` (2 edits)


1. Replace

````ts
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { ThreadTaskRunner } from "../adapters/tasks/thread-task-runner.ts";
import { loadConfig } from "../config.ts";
import { JobRunManager } from "../managers/job-run-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { runWorkerLoop } from "./loop.ts";
````

   with

````ts
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { SqliteSubmissionRepository } from "../adapters/db/submission-repository.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import { ThreadTaskRunner } from "../adapters/tasks/thread-task-runner.ts";
import { loadConfig } from "../config.ts";
import { JobManager } from "../managers/job-manager.ts";
import { JobRunManager } from "../managers/job-run-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { SubmissionManager } from "../managers/submission-manager.ts";
import { runWorkerLoop } from "./loop.ts";
````


2. Replace

````ts
});
const runs = new JobRunManager({
  jobs: new SqliteJobQueue(db),
  tasks: new ThreadTaskRunner(),
  puzzles,
  clock: systemClock,
````

   with

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
  jobs: queue,
  tasks: new ThreadTaskRunner(),
  puzzles,
  submissions,
  clock: systemClock,
````


#### Edit `apps/server/src/worker/flow.test.ts` (6 edits)


1. Replace

````ts
import { describe, expect, test } from "bun:test";
import { analyzeBoard, GENERATOR_VERSION, parsePuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
````

   with

````ts
import { describe, expect, test } from "bun:test";
import { analyzeBoard, createPuzzle, GENERATOR_VERSION, parsePuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
````


2. Replace

````ts
import { accountDeps } from "../test-support/accounts.ts";

// The whole path in one process: the API queues a generation, the worker's manager runs it in a
// real thread, and the API serves the stored puzzle.
function setup() {
  const db = openDatabase(":memory:");
````

   with

````ts
import { accountDeps } from "../test-support/accounts.ts";
import { submissionDeps } from "../test-support/submissions.ts";

// The whole path in one process: the API queues a generation or a submission's check, the
// worker's manager runs it in a real thread, and the API serves the stored puzzle.
function setup(verifyTimeoutMs = 10_000) {
  const db = openDatabase(":memory:");
````


3. Replace

````ts
  });
  const runs = new JobRunManager({
````

   with

````ts
  });
  const { submissions } = submissionDeps(db, systemClock, puzzles, jobs);
  const runs = new JobRunManager({
````


4. Replace

````ts
    puzzles,
    clock: systemClock,
    settings: {
      generateTimeoutMs: 10_000,
      verifyTimeoutMs: 10_000,
      progressIntervalMs: 0,
````

   with

````ts
    puzzles,
    submissions,
    clock: systemClock,
    settings: {
      generateTimeoutMs: 10_000,
      verifyTimeoutMs,
      progressIntervalMs: 0,
````


5. Replace

````ts
  const hints = new HintManager({ puzzles });
  return {
    app: createApp({ puzzles, jobs, hints, ...accountDeps(db, systemClock) }),
    runs,
    puzzles,
  };
````

   with

````ts
  const hints = new HintManager({ puzzles });
  const accounts = accountDeps(db, systemClock);
  accounts.users.insert({
    id: "u1",
    email: "ann@example.com",
    passwordHash: "x",
    emailVerifiedAt: 1,
    isAdmin: false,
    createdAt: 1,
  });
  return {
    app: createApp({ puzzles, jobs, hints, ...accounts }),
    runs,
    puzzles,
    submissions,
  };
````


6. Replace

````ts
  });
});
````

   with

````ts
  });
});

describe("a submission from queue to verdict (PRD FR-27)", () => {
  test("a unique puzzle is published as submitted and served without its solution", async () => {
    const { app, runs, puzzles, submissions } = setup();
    const { id } = submissions.submit("u1", createPuzzle(2, 2, [2, 2, 2, 2]));
    expect(await runs.runNext("w")).toBe(true);
    expect(submissions.get(id, "u1")).toMatchObject({
      status: "published",
      verdict: "unique",
      puzzleId: id,
    });
    const res = await app.request(`/api/puzzles/${id}`);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({
      id,
      origin: "submitted",
      puzzle: { v: 1, width: 2, height: 2, clues: "2222" },
    });
    expect(text).not.toContain("112211121121");
    expect(Array.from((await puzzles.getSolution(id)) ?? [])).toEqual(
      Array.from("112211121121", Number),
    );
  });

  test("a puzzle with several solutions is rejected as multiple, and none as none", async () => {
    const { runs, puzzles, submissions } = setup();
    const open = submissions.submit("u1", createPuzzle(3, 3));
    const impossible = submissions.submit("u1", createPuzzle(1, 1, [0]));
    await runs.runNext("w");
    await runs.runNext("w");
    expect(submissions.get(open.id, "u1")).toMatchObject({
      status: "rejected",
      verdict: "multiple",
    });
    expect(submissions.get(impossible.id, "u1")).toMatchObject({ verdict: "none" });
    expect(puzzles.listRecent(10)).toEqual([]);
  });

  test("a check stopped at the job's time limit is rejected as unknown", async () => {
    const { runs, submissions } = setup(1);
    const { id } = submissions.submit("u1", createPuzzle(2, 2, [2, 2, 2, 2]));
    await runs.runNext("w");
    expect(submissions.get(id, "u1")).toMatchObject({ status: "rejected", verdict: "unknown" });
  });
});
````


Run:

```sh
bun test apps/server/src/managers apps/server/src/adapters/tasks apps/server/src/worker
bun run format && bun run check          # about 540 pass, 0 fail
```

Commit: `git add -A && git commit -m "feat(server): verify submissions in the worker and publish unique ones"`


### Step 3 — Submission, report and admin routes; OpenAPI

The HTTP entrypoints: request/response schemas, the submission routes (logged in; confirmed email for POST), the report route (any logged-in player) and the admin routes (`isAdmin`, else 403), registered in `app.ts`; `GET /api/puzzles/{id}` lets admins open an unpublished puzzle. Routes only check who is asking, validate with zod and translate records to DTOs; the managers do the rest. Both composition roots (`main.ts`, `spec.ts`) and the existing route tests get the new deps. Then the OpenAPI document and the client are regenerated.

#### Create `apps/server/src/api/submission-schemas.ts`

````ts
import { z } from "@hono/zod-openapi";

// Request and response bodies of the submission and report routes (submissions.ts, reports.ts).

const Id = z.string().min(1).max(64);

const Size = z.int().min(1).max(100);

const Timestamp = z.iso.datetime().openapi({ example: "2026-10-25T12:00:00.000Z" });

export const SubmitRequestSchema = z
  .strictObject({
    width: Size,
    height: Size,
    clues: z
      .string()
      .max(10_000)
      .regex(/^[0-3.]*$/)
      .openapi({ description: "One character per cell, row-major: 0-3 or '.' (docs/FORMAT.md)." }),
  })
  .refine((b) => b.clues.length === b.width * b.height, {
    path: ["clues"],
    message: "must have one character per cell (width × height)",
  })
  .openapi("SubmitRequest", { description: "A puzzle to publish: its size and clues." });

export const SubmissionSchema = z
  .object({
    id: Id,
    width: Size,
    height: Size,
    status: z.enum(["pending", "published", "rejected"]),
    verdict: z
      .enum(["unique", "duplicate", "none", "multiple", "unknown", "removed", "error"])
      .nullable()
      .openapi({
        description:
          "Null while pending. `unique`: published. `duplicate`: the same clues were already published, see `puzzleId`. `none`, `multiple`: no solution, or more than one. `unknown`: the verifier ran out of time. `removed`: the same clues were unpublished by an admin. `error`: the check failed.",
      }),
    puzzleId: Id.nullable().openapi({ description: "The published puzzle to play and share." }),
    createdAt: Timestamp,
    decidedAt: Timestamp.nullable(),
  })
  .openapi("Submission", { description: "A submitted puzzle and the verifier's verdict." });

export const SubmissionListSchema = z
  .object({ items: z.array(SubmissionSchema) })
  .openapi("SubmissionList");

export const ReportRequestSchema = z
  .strictObject({
    reason: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .openapi({ description: "What is wrong with the puzzle, 1 to 500 characters." }),
  })
  .openapi("ReportRequest");

export const ReportedPuzzleSchema = z
  .object({
    puzzleId: Id,
    width: Size,
    height: Size,
    origin: z.enum(["generated", "submitted"]),
    createdAt: Timestamp,
    count: z.int().min(1).openapi({ description: "How many players reported it." }),
    reports: z
      .array(z.object({ reason: z.string(), createdAt: Timestamp }))
      .openapi({ description: "The newest reports first, at most five." }),
  })
  .openapi("ReportedPuzzle");

export const ReportedPuzzleListSchema = z
  .object({ items: z.array(ReportedPuzzleSchema) })
  .openapi("ReportedPuzzleList");
````

#### Create `apps/server/src/api/submissions.ts`

````ts
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { parsePuzzle } from "@loophole/core";
import type { SubmissionRecord } from "../domain.ts";
import type { SessionManager } from "../managers/session-manager.ts";
import type { SubmissionManager } from "../managers/submission-manager.ts";
import { problem, problemResponse } from "./problem.ts";
import { IdParamSchema } from "./schemas.ts";
import { currentUser } from "./session-cookie.ts";
import {
  SubmissionListSchema,
  SubmissionSchema,
  SubmitRequestSchema,
} from "./submission-schemas.ts";

export interface SubmissionRouteDeps {
  readonly submissions: SubmissionManager;
  readonly sessions: SessionManager;
}

/** How many submissions the list returns. */
const LIST_LIMIT = 50;

const notLoggedIn = problemResponse("Not logged in.");

const submitRoute = createRoute({
  method: "post",
  path: "/api/submissions",
  summary: "Submit a puzzle for publishing",
  description:
    "The server checks that the puzzle has exactly one solution in the background (PRD FR-27); poll the returned submission until it is no longer pending. Unique puzzles are published at once. Needs a confirmed email.",
  security: [{ session: [] }],
  request: {
    body: { required: true, content: { "application/json": { schema: SubmitRequestSchema } } },
  },
  responses: {
    202: {
      description: "Accepted. `Location` points at the submission.",
      content: { "application/json": { schema: SubmissionSchema } },
    },
    400: problemResponse("Invalid request body."),
    401: notLoggedIn,
    403: problemResponse("Email not confirmed, or sent from another site (CSRF protection)."),
    413: problemResponse("Request body larger than 64 KiB."),
    415: problemResponse("Request body is not JSON."),
    429: problemResponse("Too many submissions; `Retry-After` says when to try again."),
    503: problemResponse("Too many jobs waiting; try again later."),
  },
});

const listRoute = createRoute({
  method: "get",
  path: "/api/submissions",
  summary: "The logged-in player's submissions, newest first",
  security: [{ session: [] }],
  responses: {
    200: {
      description: "Submissions.",
      content: { "application/json": { schema: SubmissionListSchema } },
    },
    401: notLoggedIn,
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/api/submissions/{id}",
  summary: "One of the logged-in player's submissions",
  security: [{ session: [] }],
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: "The submission.",
      content: { "application/json": { schema: SubmissionSchema } },
    },
    400: problemResponse("Invalid id."),
    401: notLoggedIn,
    404: problemResponse("No submission of yours with this id."),
  },
});

/** Submitting puzzles and following what became of them (PRD FR-27). */
export function registerSubmissionRoutes(app: OpenAPIHono, deps: SubmissionRouteDeps): void {
  const { submissions, sessions } = deps;

  app.openapi(submitRoute, async (c) => {
    const user = await currentUser(c, sessions);
    if (user === null) return problem(c, 401, "Not logged in");
    // DECISIONS, "What unconfirmed accounts can do".
    if (user.emailVerifiedAt === null) {
      return problem(c, 403, "Email not confirmed", {
        detail: "Confirm your email address before submitting puzzles.",
      });
    }
    const { width, height, clues } = c.req.valid("json");
    const record = submissions.submit(user.id, parsePuzzle({ v: 1, width, height, clues }));
    c.header("Location", `/api/submissions/${record.id}`);
    return c.json(toSubmissionDto(record), 202);
  });

  app.openapi(listRoute, async (c) => {
    const user = await currentUser(c, sessions);
    if (user === null) return problem(c, 401, "Not logged in");
    return c.json({ items: submissions.listMine(user.id, LIST_LIMIT).map(toSubmissionDto) }, 200);
  });

  app.openapi(getRoute, async (c) => {
    const user = await currentUser(c, sessions);
    if (user === null) return problem(c, 401, "Not logged in");
    const record = submissions.get(c.req.valid("param").id, user.id);
    if (record === null) return problem(c, 404, "Submission not found");
    return c.json(toSubmissionDto(record), 200);
  });
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function toSubmissionDto(r: SubmissionRecord) {
  return {
    id: r.id,
    width: r.puzzle.grid.width,
    height: r.puzzle.grid.height,
    status: r.status,
    verdict: r.verdict,
    puzzleId: r.puzzleId,
    createdAt: iso(r.createdAt),
    decidedAt: r.decidedAt === null ? null : iso(r.decidedAt),
  };
}
````

#### Create `apps/server/src/api/reports.ts`

````ts
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { ReportedPuzzle } from "../domain.ts";
import type { PuzzleManager } from "../managers/puzzle-manager.ts";
import type { ReportManager } from "../managers/report-manager.ts";
import type { SessionManager } from "../managers/session-manager.ts";
import { problem, problemResponse } from "./problem.ts";
import { IdParamSchema } from "./schemas.ts";
import { currentUser } from "./session-cookie.ts";
import { ReportedPuzzleListSchema, ReportRequestSchema } from "./submission-schemas.ts";

export interface ReportRouteDeps {
  readonly reports: ReportManager;
  readonly puzzles: PuzzleManager;
  readonly sessions: SessionManager;
}

const notLoggedIn = problemResponse("Not logged in.");
const crossSite = problemResponse("Sent from another site (CSRF protection).");
const notAdmin = problemResponse("Not an admin, or sent from another site (CSRF protection).");

const reportRoute = createRoute({
  method: "post",
  path: "/api/puzzles/{id}/report",
  summary: "Report a published puzzle to the admins",
  description: "Reporting the same puzzle again replaces your earlier reason.",
  security: [{ session: [] }],
  request: {
    params: IdParamSchema,
    body: { required: true, content: { "application/json": { schema: ReportRequestSchema } } },
  },
  responses: {
    204: { description: "Reported." },
    400: problemResponse("Invalid id or body."),
    401: notLoggedIn,
    403: crossSite,
    404: problemResponse("No published puzzle with this id."),
    413: problemResponse("Request body larger than 64 KiB."),
    415: problemResponse("Request body is not JSON."),
    429: problemResponse("Too many reports; `Retry-After` says when to try again."),
  },
});

const listReportsRoute = createRoute({
  method: "get",
  path: "/api/admin/reports",
  summary: "Reported puzzles that are still published (admins only)",
  security: [{ session: [] }],
  responses: {
    200: {
      description: "Reported puzzles, the most recently reported first.",
      content: { "application/json": { schema: ReportedPuzzleListSchema } },
    },
    401: notLoggedIn,
    403: problemResponse("Not an admin."),
  },
});

const unpublishRoute = createRoute({
  method: "post",
  path: "/api/admin/puzzles/{id}/unpublish",
  summary: "Unpublish a puzzle (admins only)",
  description: "It leaves every list, and players get 404 for it (PRD FR-28).",
  security: [{ session: [] }],
  request: { params: IdParamSchema },
  responses: {
    204: { description: "Unpublished (also when it already was)." },
    400: problemResponse("Invalid id."),
    401: notLoggedIn,
    403: notAdmin,
    404: problemResponse("No puzzle with this id."),
  },
});

const dismissRoute = createRoute({
  method: "delete",
  path: "/api/admin/puzzles/{id}/reports",
  summary: "Dismiss a puzzle's reports, keeping it published (admins only)",
  security: [{ session: [] }],
  request: { params: IdParamSchema },
  responses: {
    204: { description: "Dismissed." },
    400: problemResponse("Invalid id."),
    401: notLoggedIn,
    403: notAdmin,
  },
});

/** Reports from players and the admins' answers to them (PRD FR-28). */
export function registerReportRoutes(app: OpenAPIHono, deps: ReportRouteDeps): void {
  const { reports, puzzles, sessions } = deps;

  app.openapi(reportRoute, async (c) => {
    const user = await currentUser(c, sessions);
    if (user === null) return problem(c, 401, "Not logged in");
    const found = reports.report(user.id, c.req.valid("param").id, c.req.valid("json").reason);
    if (!found) return problem(c, 404, "Puzzle not found");
    return c.body(null, 204);
  });

  app.openapi(listReportsRoute, async (c) => {
    const user = await currentUser(c, sessions);
    if (user === null) return problem(c, 401, "Not logged in");
    if (!user.isAdmin) return problem(c, 403, "Admins only");
    return c.json({ items: reports.listReported().map(toReportedDto) }, 200);
  });

  app.openapi(unpublishRoute, async (c) => {
    const user = await currentUser(c, sessions);
    if (user === null) return problem(c, 401, "Not logged in");
    if (!user.isAdmin) return problem(c, 403, "Admins only");
    if (!puzzles.unpublish(c.req.valid("param").id)) return problem(c, 404, "Puzzle not found");
    return c.body(null, 204);
  });

  app.openapi(dismissRoute, async (c) => {
    const user = await currentUser(c, sessions);
    if (user === null) return problem(c, 401, "Not logged in");
    if (!user.isAdmin) return problem(c, 403, "Admins only");
    reports.dismiss(c.req.valid("param").id);
    return c.body(null, 204);
  });
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function toReportedDto(r: ReportedPuzzle) {
  return {
    puzzleId: r.puzzle.id,
    width: r.puzzle.puzzle.grid.width,
    height: r.puzzle.puzzle.grid.height,
    origin: r.puzzle.origin,
    createdAt: iso(r.puzzle.createdAt),
    count: r.count,
    reports: r.reports.map((x) => ({ reason: x.reason, createdAt: iso(x.createdAt) })),
  };
}
````

#### Edit `apps/server/src/api/app.ts` (5 edits)


1. Replace

````ts
import { problem, problemResponse } from "./problem.ts";
import {
````

   with

````ts
import { problem, problemResponse } from "./problem.ts";
import { type ReportRouteDeps, registerReportRoutes } from "./reports.ts";
import {
````


2. Replace

````ts
} from "./schemas.ts";

export interface AppDeps extends AccountRouteDeps {
  readonly puzzles: PuzzleManager;
````

   with

````ts
} from "./schemas.ts";
import { currentUser } from "./session-cookie.ts";
import { registerSubmissionRoutes, type SubmissionRouteDeps } from "./submissions.ts";

export interface AppDeps extends AccountRouteDeps, SubmissionRouteDeps, ReportRouteDeps {
  readonly puzzles: PuzzleManager;
````


3. Replace

````ts
    400: problemResponse("Invalid id."),
    404: problemResponse("No published puzzle with this id."),
  },
````

   with

````ts
    400: problemResponse("Invalid id."),
    404: problemResponse("No published puzzle with this id (admins also get unpublished ones)."),
  },
````


4. Replace

````ts

  app.openapi(getPuzzleRoute, (c) => {
    const record = puzzles.get(c.req.valid("param").id);
    if (record === null) return problem(c, 404, "Puzzle not found");
````

   with

````ts

  app.openapi(getPuzzleRoute, async (c) => {
    const id = c.req.valid("param").id;
    let record = puzzles.get(id);
    // Admins can still open an unpublished puzzle, to review it (PRD FR-28).
    if (record === null && (await currentUser(c, deps.sessions))?.isAdmin) {
      record = puzzles.getAny(id);
    }
    if (record === null) return problem(c, 404, "Puzzle not found");
````


5. Replace

````ts
  registerAccountRoutes(app, deps);

````

   with

````ts
  registerAccountRoutes(app, deps);
  registerSubmissionRoutes(app, deps);
  registerReportRoutes(app, deps);

````


#### Edit `apps/server/src/api/main.ts` (4 edits)


1. Replace

````ts
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { SqliteSessionRepository } from "../adapters/db/session-repository.ts";
import { SqliteUserRepository } from "../adapters/db/user-repository.ts";
````

   with

````ts
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { SqliteReportRepository } from "../adapters/db/report-repository.ts";
import { SqliteSessionRepository } from "../adapters/db/session-repository.ts";
import { SqliteSubmissionRepository } from "../adapters/db/submission-repository.ts";
import { SqliteUserRepository } from "../adapters/db/user-repository.ts";
````


2. Replace

````ts
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { SessionManager } from "../managers/session-manager.ts";
import { createApp } from "./app.ts";
````

   with

````ts
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { ReportManager } from "../managers/report-manager.ts";
import { SessionManager } from "../managers/session-manager.ts";
import { SubmissionManager } from "../managers/submission-manager.ts";
import { createApp } from "./app.ts";
````


3. Replace

````ts
const hints = new HintManager({ puzzles });
const app = createApp({
````

   with

````ts
const hints = new HintManager({ puzzles });
const submissions = new SubmissionManager({
  submissions: new SqliteSubmissionRepository(db),
  puzzles,
  jobs,
  limiter,
  clock: systemClock,
  newId: () => crypto.randomUUID(),
});
const reports = new ReportManager({
  reports: new SqliteReportRepository(db),
  puzzles,
  limiter,
  clock: systemClock,
});
const app = createApp({
````


4. Replace

````ts
  hints,
  accounts,
````

   with

````ts
  hints,
  submissions,
  reports,
  accounts,
````


#### Edit `apps/server/src/api/spec.ts` (5 edits)


1. Replace

````ts
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { SqliteSessionRepository } from "../adapters/db/session-repository.ts";
import { SqliteUserRepository } from "../adapters/db/user-repository.ts";
````

   with

````ts
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { SqliteReportRepository } from "../adapters/db/report-repository.ts";
import { SqliteSessionRepository } from "../adapters/db/session-repository.ts";
import { SqliteSubmissionRepository } from "../adapters/db/submission-repository.ts";
import { SqliteUserRepository } from "../adapters/db/user-repository.ts";
````


2. Replace

````ts
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { SessionManager } from "../managers/session-manager.ts";
import { createApp } from "./app.ts";
````

   with

````ts
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { ReportManager } from "../managers/report-manager.ts";
import { SessionManager } from "../managers/session-manager.ts";
import { SubmissionManager } from "../managers/submission-manager.ts";
import { createApp } from "./app.ts";
````


3. Replace

````ts
    clock: systemClock,
  });
````

   with

````ts
    clock: systemClock,
  });
  const jobs = new JobManager({
    jobs: new SqliteJobQueue(db),
    clock: systemClock,
    newId: () => crypto.randomUUID(),
    maxQueued: 1,
  });
````


4. Replace

````ts
    hints: new HintManager({ puzzles }),
    jobs: new JobManager({
      jobs: new SqliteJobQueue(db),
      clock: systemClock,
      newId: () => crypto.randomUUID(),
      maxQueued: 1,
    }),
````

   with

````ts
    hints: new HintManager({ puzzles }),
    jobs,
    submissions: new SubmissionManager({
      submissions: new SqliteSubmissionRepository(db),
      puzzles,
      jobs,
      limiter,
      clock: systemClock,
      newId: () => crypto.randomUUID(),
    }),
    reports: new ReportManager({
      reports: new SqliteReportRepository(db),
      puzzles,
      limiter,
      clock: systemClock,
    }),
````


5. Replace

````ts
      description:
        "Puzzles, background jobs and accounts. Errors are RFC 9457 problem details. State-changing requests from other sites are refused (403).",
    },
````

   with

````ts
      description:
        "Puzzles, background jobs, accounts, submitted puzzles and reports. Errors are RFC 9457 problem details. State-changing requests from other sites are refused (403).",
    },
````


#### Edit `apps/server/src/api/app.test.ts` (2 edits)


1. Replace

````ts
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { createApp } from "./app.ts";
````

   with

````ts
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { submissionDeps } from "../test-support/submissions.ts";
import { createApp } from "./app.ts";
````


2. Replace

````ts
    hints: new HintManager({ puzzles }),
    webDir: options.webDir,
````

   with

````ts
    hints: new HintManager({ puzzles }),
    ...submissionDeps(db, clock, puzzles, jobs),
    webDir: options.webDir,
````


#### Edit `apps/server/src/api/accounts.test.ts` (2 edits)


1. Replace

````ts
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { createApp } from "./app.ts";
````

   with

````ts
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { submissionDeps } from "../test-support/submissions.ts";
import { createApp } from "./app.ts";
````


2. Replace

````ts
  });
  const app = createApp({
    puzzles,
    hints: new HintManager({ puzzles }),
    jobs: new JobManager({
      jobs: new SqliteJobQueue(db),
      clock,
      newId: sequentialIds("j"),
      maxQueued: 10,
    }),
    ...deps,
````

   with

````ts
  });
  const jobs = new JobManager({
    jobs: new SqliteJobQueue(db),
    clock,
    newId: sequentialIds("j"),
    maxQueued: 10,
  });
  const app = createApp({
    puzzles,
    hints: new HintManager({ puzzles }),
    jobs,
    ...submissionDeps(db, clock, puzzles, jobs),
    ...deps,
````


#### Create `apps/server/src/api/submissions.test.ts`

````ts
import { describe, expect, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { HintManager } from "../managers/hint-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { REPORTS_PER_ACCOUNT } from "../managers/report-manager.ts";
import { SUBMISSIONS_PER_ACCOUNT } from "../managers/submission-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { submissionDeps } from "../test-support/submissions.ts";
import { createApp } from "./app.ts";
import type { Problem } from "./problem.ts";
import { SESSION_COOKIE } from "./session-cookie.ts";

const UNIQUE = { width: 2, height: 2, clues: "2222" };

function setup() {
  const db = openDatabase(":memory:");
  const clock = new FakeClock(Date.UTC(2026, 9, 25, 12));
  const deps = accountDeps(db, clock);
  const puzzles = new PuzzleManager({
    puzzles: new SqlitePuzzleRepository(db),
    blobs: new MemoryBlobStore(),
    clock,
  });
  const queue = new SqliteJobQueue(db);
  const jobs = new JobManager({ jobs: queue, clock, newId: sequentialIds("j"), maxQueued: 100 });
  const app = createApp({
    puzzles,
    jobs,
    hints: new HintManager({ puzzles }),
    ...submissionDeps(db, clock, puzzles, jobs),
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
    return app.request(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  /** Signs up and logs in; confirms the email unless told not to. Returns the session cookie. */
  const player = async (
    email: string,
    options: { confirmed?: boolean; admin?: boolean } = {},
  ): Promise<string> => {
    await send("POST", "/api/auth/signup", { email, password: "hunter22", captchaToken: "c" });
    if (options.confirmed ?? true) {
      const token = deps.mailer.sent.at(-1)?.text.match(/#token=(\S+)/)?.[1];
      await send("POST", "/api/auth/verify-email", { token });
    }
    if (options.admin) deps.users.setAdmin(email, true);
    const res = await send("POST", "/api/auth/login", { email, password: "hunter22" });
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    if (cookie === undefined) throw new Error("not logged in");
    return cookie.split(";")[0].slice(SESSION_COOKIE.length + 1);
  };

  const savePuzzle = (id: string, clues = [2, 2, 2, 2]) =>
    puzzles.saveGenerated(id, {
      puzzle: serializePuzzle(createPuzzle(2, 2, clues)),
      solution: "112211121121",
      steps: [],
    });

  return { app, clock, queue, send, player, savePuzzle };
}

async function expectProblem(res: Response, status: number, title?: string): Promise<Problem> {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toStartWith("application/problem+json");
  const body = (await res.json()) as Problem;
  if (title !== undefined) expect(body.title).toBe(title);
  return body;
}

describe("POST /api/submissions", () => {
  test("queues the puzzle's verification and answers 202 with the pending submission", async () => {
    const { send, player, queue } = setup();
    const cookie = await player("ann@example.com");
    const res = await send("POST", "/api/submissions", UNIQUE, { cookie });
    expect(res.status).toBe(202);
    expect(res.headers.get("Location")).toBe("/api/submissions/s-1");
    expect(await res.json()).toEqual({
      id: "s-1",
      width: 2,
      height: 2,
      status: "pending",
      verdict: null,
      puzzleId: null,
      createdAt: "2026-10-25T12:00:00.000Z",
      decidedAt: null,
    });
    expect(queue.get("j-1")).toMatchObject({ kind: "verify", input: { submissionId: "s-1" } });
  });

  test("needs a login (401) and a confirmed email (403)", async () => {
    const { send, player } = setup();
    await expectProblem(await send("POST", "/api/submissions", UNIQUE), 401);
    const cookie = await player("bob@example.com", { confirmed: false });
    await expectProblem(
      await send("POST", "/api/submissions", UNIQUE, { cookie }),
      403,
      "Email not confirmed",
    );
  });

  test("is refused from another site (CSRF)", async () => {
    const { send, player } = setup();
    const cookie = await player("ann@example.com");
    const res = await send("POST", "/api/submissions", UNIQUE, {
      cookie,
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    await expectProblem(res, 403, "Cross-site request refused");
  });

  test("validates the size and clues", async () => {
    const { send, player } = setup();
    const cookie = await player("ann@example.com");
    for (const body of [
      { width: 2, height: 2, clues: "222" },
      { width: 2, height: 2, clues: "22x2" },
      { width: 101, height: 1, clues: "." },
      { width: 0, height: 1, clues: "" },
      { ...UNIQUE, seed: "s" },
    ]) {
      await expectProblem(await send("POST", "/api/submissions", body, { cookie }), 400);
    }
  });

  test("answers 429 with Retry-After past the account's limit", async () => {
    const { send, player } = setup();
    const cookie = await player("ann@example.com");
    for (let i = 0; i < SUBMISSIONS_PER_ACCOUNT.limit; i++) {
      // Distinct clues each time, so none is a duplicate decided without a job.
      const clues = i.toString(4).padStart(4, ".").slice(-4);
      const res = await send("POST", "/api/submissions", { ...UNIQUE, clues }, { cookie });
      expect(res.status).toBe(202);
    }
    const res = await send("POST", "/api/submissions", UNIQUE, { cookie });
    await expectProblem(res, 429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  test("clues that are already published come back published as a duplicate", async () => {
    const { send, player, savePuzzle } = setup();
    await savePuzzle("p1");
    const cookie = await player("ann@example.com");
    const res = await send("POST", "/api/submissions", UNIQUE, { cookie });
    expect(await res.json()).toMatchObject({
      status: "published",
      verdict: "duplicate",
      puzzleId: "p1",
    });
  });
});

describe("GET /api/submissions", () => {
  test("lists and reads only the player's own submissions", async () => {
    const { send, player } = setup();
    const ann = await player("ann@example.com");
    const bob = await player("bob@example.com");
    await send("POST", "/api/submissions", UNIQUE, { cookie: ann });
    const list = (await (
      await send("GET", "/api/submissions", undefined, { cookie: ann })
    ).json()) as {
      items: { id: string }[];
    };
    expect(list.items.map((s) => s.id)).toEqual(["s-1"]);
    expect((await send("GET", "/api/submissions/s-1", undefined, { cookie: ann })).status).toBe(
      200,
    );
    await expectProblem(await send("GET", "/api/submissions/s-1", undefined, { cookie: bob }), 404);
    await expectProblem(await send("GET", "/api/submissions"), 401);
    await expectProblem(await send("GET", "/api/submissions/s-1"), 401);
  });
});

describe("reports and unpublishing", () => {
  test("a logged-in player reports a published puzzle; admins list, dismiss and unpublish", async () => {
    const { send, player, savePuzzle } = setup();
    await savePuzzle("p1");
    const ann = await player("ann@example.com", { confirmed: false });
    const admin = await player("root@example.com", { admin: true });

    const report = await send(
      "POST",
      "/api/puzzles/p1/report",
      { reason: " rude " },
      { cookie: ann },
    );
    expect(report.status).toBe(204);
    const list = await send("GET", "/api/admin/reports", undefined, { cookie: admin });
    expect(await list.json()).toEqual({
      items: [
        {
          puzzleId: "p1",
          width: 2,
          height: 2,
          origin: "generated",
          createdAt: "2026-10-25T12:00:00.000Z",
          count: 1,
          reports: [{ reason: "rude", createdAt: "2026-10-25T12:00:00.000Z" }],
        },
      ],
    });

    expect(
      (await send("DELETE", "/api/admin/puzzles/p1/reports", undefined, { cookie: admin })).status,
    ).toBe(204);
    expect(
      await (await send("GET", "/api/admin/reports", undefined, { cookie: admin })).json(),
    ).toEqual({ items: [] });

    const res = await send("POST", "/api/admin/puzzles/p1/unpublish", undefined, { cookie: admin });
    expect(res.status).toBe(204);
    // Gone for players and from the list; admins can still open it.
    await expectProblem(await send("GET", "/api/puzzles/p1"), 404);
    await expectProblem(await send("GET", "/api/puzzles/p1", undefined, { cookie: ann }), 404);
    expect((await send("GET", "/api/puzzles/p1", undefined, { cookie: admin })).status).toBe(200);
    expect(await (await send("GET", "/api/puzzles")).json()).toEqual({ items: [] });
    await expectProblem(
      await send("POST", "/api/puzzles/p1/report", { reason: "x" }, { cookie: ann }),
      404,
    );
  });

  test("reporting needs a login, a reason and an existing puzzle, and is rate-limited", async () => {
    const { send, player, savePuzzle } = setup();
    await savePuzzle("p1");
    await expectProblem(await send("POST", "/api/puzzles/p1/report", { reason: "x" }), 401);
    const ann = await player("ann@example.com");
    for (const body of [{ reason: "   " }, { reason: "x".repeat(501) }, {}]) {
      await expectProblem(await send("POST", "/api/puzzles/p1/report", body, { cookie: ann }), 400);
    }
    await expectProblem(
      await send("POST", "/api/puzzles/nope/report", { reason: "x" }, { cookie: ann }),
      404,
    );
    for (let i = 1; i < REPORTS_PER_ACCOUNT.limit; i++) {
      await send("POST", "/api/puzzles/p1/report", { reason: `r${i}` }, { cookie: ann });
    }
    await expectProblem(
      await send("POST", "/api/puzzles/p1/report", { reason: "x" }, { cookie: ann }),
      429,
    );
  });

  test("admin routes refuse guests (401), players (403) and other sites (403)", async () => {
    const { send, player, savePuzzle } = setup();
    await savePuzzle("p1");
    const ann = await player("ann@example.com");
    const admin = await player("root@example.com", { admin: true });
    const routes = [
      ["GET", "/api/admin/reports"],
      ["POST", "/api/admin/puzzles/p1/unpublish"],
      ["DELETE", "/api/admin/puzzles/p1/reports"],
    ] as const;
    for (const [method, path] of routes) {
      await expectProblem(await send(method, path), 401);
      await expectProblem(await send(method, path, undefined, { cookie: ann }), 403, "Admins only");
    }
    const crossSite = { cookie: admin, headers: { "Sec-Fetch-Site": "cross-site" } };
    await expectProblem(
      await send("POST", "/api/admin/puzzles/p1/unpublish", undefined, crossSite),
      403,
    );
    await expectProblem(
      await send("POST", "/api/admin/puzzles/nope/unpublish", undefined, { cookie: admin }),
      404,
    );
    expect((await send("GET", "/api/puzzles/p1")).status).toBe(200);
  });
});
````

#### Edit `apps/server/src/worker/flow.test.ts` (2 edits)


1. Replace

````ts
  });
  const { submissions } = submissionDeps(db, systemClock, puzzles, jobs);
  const runs = new JobRunManager({
````

   with

````ts
  });
  const { submissions, reports } = submissionDeps(db, systemClock, puzzles, jobs);
  const runs = new JobRunManager({
````


2. Replace

````ts
  return {
    app: createApp({ puzzles, jobs, hints, ...accounts }),
    runs,
````

   with

````ts
  return {
    app: createApp({ puzzles, jobs, hints, submissions, reports, ...accounts }),
    runs,
````


Run:

```sh
bun run gen:api                          # rewrites openapi.yaml and packages/api-client/src/schema.ts
git status --short openapi.yaml packages/api-client/src/schema.ts   # both modified
bun test apps/server/src/api apps/server/src/worker
bun run format && bun run check          # about 551 pass, 0 fail; check:api says up to date
grep -cE "^  /api/(submissions|admin/|puzzles/\{id\}/report)" openapi.yaml   # 6
```

Commit: `git add -A && git commit -m "feat(server): add submission, report and admin routes"`


### Step 4 — Shared zoom controls, wheel handling and cell hit-testing

A refactor for reuse, with no behaviour change on the play board: the zoom pill moves out of `BoardView` into `ZoomControls.svelte`, the wheel/trackpad maths into `wheelView()` in `viewport.ts` (copied from `BoardView` as WT8 left it), and `cellAt()` (the cell under a point) joins `geometry.ts`. The editor board (Step 7) uses all three. The play and zoom end-to-end tests are the safety net.

#### Create `apps/web/src/lib/components/ZoomControls.svelte`

````svelte
<script lang="ts">
  import { type View, ZOOM_STEP, type ZoomLimits } from "../game/viewport.ts";

  interface Props {
    view: View;
    limits: ZoomLimits;
    /** Zooms by `factor` around the middle of the viewport. */
    onzoom: (factor: number) => void;
  }

  let { view, limits, onzoom }: Props = $props();

  const percent = $derived(Math.round((view.cell / limits.min) * 100));
</script>

<!-- Zoom controls (Night artboard): bottom right of a zoomable board. -->
<div class="zoom">
  <button
    type="button"
    aria-label="Zoom out"
    disabled={view.cell <= limits.min}
    onclick={() => onzoom(1 / ZOOM_STEP)}
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
  </button>
  <span class="percent">{percent}%</span>
  <button
    type="button"
    aria-label="Zoom in"
    disabled={view.cell >= limits.max}
    onclick={() => onzoom(ZOOM_STEP)}
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg>
  </button>
</div>

<style>
  .zoom {
    position: absolute;
    right: 8px;
    bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px;
    background: color-mix(in srgb, var(--ground) 92%, transparent);
    border: 1.5px solid var(--hairline);
    border-radius: 999px;
    z-index: 1;
  }

  .zoom button {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 0;
    background: transparent;
    color: var(--ink);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
  }

  .zoom button:disabled {
    color: var(--disabled);
    cursor: default;
  }

  .percent {
    min-width: 40px;
    font-size: 13px;
    font-weight: 700;
    color: var(--ink-soft);
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
</style>
````

#### Edit `apps/web/src/lib/components/BoardView.svelte` (7 edits)


1. Replace

````svelte
    miniLayout,
    panBy,
    revealRect,
````

   with

````svelte
    miniLayout,
    revealRect,
````


2. Replace

````svelte
    type View,
    ZOOM_STEP,
````

   with

````svelte
    type View,
    wheelView,
    ZOOM_STEP,
````


3. Replace

````svelte
  import MiniMap from "./MiniMap.svelte";

````

   with

````svelte
  import MiniMap from "./MiniMap.svelte";
  import ZoomControls from "./ZoomControls.svelte";

````


4. Replace

````svelte
      if (gesture !== null || zoom === null) return;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? port.height : 1;
      let dx = e.deltaX * unit;
      let dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        // A mouse-wheel notch is about 100 px of delta; clamp it so one notch is about 1.28×, not
        // e×. Trackpad pinches send small deltas, which this rate keeps quick.
        const step = Math.max(-25, Math.min(25, dy));
        onview(zoomAround(grid, view, view.cell * Math.exp(-step * 0.01), local(e), port, zoom));
        return;
      }
      if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
      onview(panBy(grid, view, -dx, -dy, port, zoom));
    };
````

   with

````svelte
      if (gesture !== null || zoom === null) return;
      onview(wheelView(grid, view, e, local(e), port, zoom));
    };
````


5. Replace

````svelte

  const percent = $derived(zoom === null ? 100 : Math.round((view.cell / zoom.min) * 100));
</script>
````

   with

````svelte

</script>
````


6. Replace

````svelte
    />
    <div class="zoom">
      <button
        type="button"
        aria-label="Zoom out"
        disabled={view.cell <= limits.min}
        onclick={() => zoomBy(1 / ZOOM_STEP, centre())}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
      </button>
      <span class="percent">{percent}%</span>
      <button
        type="button"
        aria-label="Zoom in"
        disabled={view.cell >= limits.max}
        onclick={() => zoomBy(ZOOM_STEP, centre())}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg>
      </button>
    </div>
  {/if}
````

   with

````svelte
    />
    <ZoomControls {view} {limits} onzoom={(factor) => zoomBy(factor, centre())} />
  {/if}
````


7. Replace

````svelte
  }

  /* Zoom controls (Night artboard): bottom right of the board. */
  .zoom {
    position: absolute;
    right: 8px;
    bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px;
    background: color-mix(in srgb, var(--ground) 92%, transparent);
    border: 1.5px solid var(--hairline);
    border-radius: 999px;
    z-index: 1;
  }

  .zoom button {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 0;
    background: transparent;
    color: var(--ink);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
  }

  .zoom button:disabled {
    color: var(--disabled);
    cursor: default;
  }

  .percent {
    min-width: 40px;
    font-size: 13px;
    font-weight: 700;
    color: var(--ink-soft);
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
</style>
````

   with

````svelte
  }
</style>
````


#### Edit `apps/web/src/lib/game/viewport.ts` (1 edit)


1. Replace

````ts
}

/**
 * Two-finger pinch: from the view when the second finger landed (`start`, fingers at `a0` and
````

   with

````ts
}

/** What a wheel or trackpad event says, as `WheelEvent` has it. */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  /** 0 pixels, 1 lines, 2 pages. */
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * The view after a wheel or trackpad event at `at` (viewport pixels): Ctrl/⌘ + wheel, and trackpad
 * pinch, which browsers report the same way, zoom around the pointer; the plain wheel and
 * two-finger scroll pan; Shift turns vertical wheel movement sideways.
 */
export function wheelView(
  grid: Grid,
  view: View,
  input: WheelInput,
  at: Point,
  port: Size,
  limits: ZoomLimits,
): View {
  const unit = input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? port.height : 1;
  let dx = input.deltaX * unit;
  let dy = input.deltaY * unit;
  if (input.ctrlKey || input.metaKey) {
    // A mouse-wheel notch is about 100 px of delta; clamp it so one notch is about 1.28×, not
    // e×. Trackpad pinches send small deltas, which this rate keeps quick.
    const step = Math.max(-25, Math.min(25, dy));
    return zoomAround(grid, view, view.cell * Math.exp(-step * 0.01), at, port, limits);
  }
  if (input.shiftKey && dx === 0) [dx, dy] = [dy, 0];
  return panBy(grid, view, -dx, -dy, port, limits);
}

/**
 * Two-finger pinch: from the view when the second finger landed (`start`, fingers at `a0` and
````


#### Edit `apps/web/src/lib/game/viewport.test.ts` (2 edits)


1. Replace

````ts
  visibleCells,
  ZOOM_MAX_CELL,
````

   with

````ts
  visibleCells,
  wheelView,
  ZOOM_MAX_CELL,
````


2. Replace

````ts
    expect(v.y).toBeCloseTo((l.height - port.height) / 2, 9);
  });
});
````

   with

````ts
    expect(v.y).toBeCloseTo((l.height - port.height) / 2, 9);
  });
});

describe("wheelView", () => {
  const view = clampView(grid, { cell: 44, x: 100, y: 100 }, port, limits);
  const wheel = {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  };
  const at = { x: 100, y: 120 };

  test("the wheel pans, by lines in line mode, sideways with Shift", () => {
    expect(wheelView(grid, view, { ...wheel, deltaY: 30 }, at, port, limits)).toEqual(
      panBy(grid, view, 0, -30, port, limits),
    );
    expect(wheelView(grid, view, { ...wheel, deltaY: 2, deltaMode: 1 }, at, port, limits)).toEqual(
      panBy(grid, view, 0, -32, port, limits),
    );
    expect(
      wheelView(grid, view, { ...wheel, deltaY: 30, shiftKey: true }, at, port, limits),
    ).toEqual(panBy(grid, view, -30, 0, port, limits));
  });

  test("Ctrl or ⌘ + wheel zooms around the pointer, one notch about 1.28×", () => {
    for (const key of ["ctrlKey", "metaKey"] as const) {
      const out = wheelView(grid, view, { ...wheel, deltaY: -100, [key]: true }, at, port, limits);
      expect(out.cell / view.cell).toBeCloseTo(Math.exp(0.25), 5);
      expect(out).toEqual(zoomAround(grid, view, out.cell, at, port, limits));
    }
  });
});
````


#### Edit `apps/web/src/lib/game/geometry.ts` (1 edit)


1. Replace

````ts

/** The dot nearest to (x, y), clamped to the board. */
````

   with

````ts

/** The cell under (x, y), in board pixels, or `NONE` outside the dots. */
export function cellAt(grid: Grid, layout: Layout, x: number, y: number): number {
  const col = Math.floor((x - layout.margin) / layout.cell);
  const row = Math.floor((y - layout.margin) / layout.cell);
  if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) return NONE;
  return cellIndex(grid, row, col);
}

/** The dot nearest to (x, y), clamped to the board. */
````


#### Edit `apps/web/src/lib/game/geometry.test.ts` (2 edits)


1. Replace

````ts
import {
  dotAt,
````

   with

````ts
import {
  cellAt,
  dotAt,
````


2. Replace

````ts
    expect(s.dotRadius).toBeCloseTo(0.8, 9);
  });
});
````

   with

````ts
    expect(s.dotRadius).toBeCloseTo(0.8, 9);
  });
});

describe("cellAt", () => {
  const grid = createGrid(3, 2);
  const layout: Layout = { cell: 40, margin: 10, width: 140, height: 100 };

  test("finds the cell under a point, edges included on their top-left side", () => {
    expect(cellAt(grid, layout, 10, 10)).toBe(0);
    expect(cellAt(grid, layout, 49.9, 49.9)).toBe(0);
    expect(cellAt(grid, layout, 50, 50)).toBe(4);
    expect(cellAt(grid, layout, 129, 89)).toBe(5);
  });

  test("is NONE in the margin and beyond", () => {
    for (const [x, y] of [
      [9, 20],
      [20, 9],
      [130, 20],
      [20, 90],
    ]) {
      expect(cellAt(grid, layout, x, y)).toBe(NONE);
    }
  });
});
````


Run:

```sh
bun test apps/web/src/lib/game
bun run format && bun run check          # about 555 pass, 0 fail
bun run test:e2e                         # 57 passed: play, hint and zoom unchanged
```

Commit: `git add -A && git commit -m "refactor(web): share the zoom controls and wheel handling between boards"`


### Step 5 — Editor state, keys, answers and the live checker

The editor's plain modules (no runes, no `$lib`, no DOM; tested by the root `bun test`): the draft and its local save, the cell-cursor keys, the suggested clue for two answers, and `LiveChecker`, which debounces edits and runs `verify` in a worker with a time limit, replacing a busy worker on a newer edit. `verify.worker.ts` is the thread's entry point and has no logic of its own. `checker.test.ts` drives a fake worker and fake timers.

#### Create `apps/web/src/lib/editor/keyboard.ts`

````ts
import { cellCoords, cellIndex, type Grid, NO_CLUE } from "@loophole/core";
import type { Direction } from "../game/keyboard.ts";

/** What a key does to the cell under the editor's keyboard cursor. */
export type CellCommand =
  | { readonly type: "move"; readonly direction: Direction }
  | { readonly type: "set"; readonly clue: number }
  | { readonly type: "erase" }
  | { readonly type: "cycle" };

const ARROWS: Readonly<Record<string, Direction>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** Keys for the editor board (Editor artboard): arrows move, 0–3 place, Backspace erases. */
export function cellCommand(key: string): CellCommand | null {
  const direction = ARROWS[key];
  if (direction !== undefined) return { type: "move", direction };
  if (key === "0" || key === "1" || key === "2" || key === "3") {
    return { type: "set", clue: Number(key) };
  }
  if (key === "Backspace" || key === "Delete" || key === ".") return { type: "erase" };
  if (key === " " || key === "Enter") return { type: "cycle" };
  return null;
}

/** Moves the cell cursor one cell; it stops at the board's sides. */
export function moveCell(grid: Grid, cell: number, direction: Direction): number {
  const { row, col } = cellCoords(grid, cell);
  switch (direction) {
    case "up":
      return row > 0 ? cellIndex(grid, row - 1, col) : cell;
    case "down":
      return row < grid.height - 1 ? cellIndex(grid, row + 1, col) : cell;
    case "left":
      return col > 0 ? cellIndex(grid, row, col - 1) : cell;
    case "right":
      return col < grid.width - 1 ? cellIndex(grid, row, col + 1) : cell;
  }
}

/** What a screen reader hears for the cursor's cell, e.g. "Row 2, column 3: clue 1". */
export function cellLabel(grid: Grid, cell: number, clue: number): string {
  const { row, col } = cellCoords(grid, cell);
  return `Row ${row + 1}, column ${col + 1}: ${clue === NO_CLUE ? "empty" : `clue ${clue}`}`;
}

/** A change to one cell: what a key (or the parent, for a tap) asks for. */
export type CellEdit = Exclude<CellCommand, { readonly type: "move" }>;
````

#### Create `apps/web/src/lib/editor/keyboard.test.ts`

````ts
import { describe, expect, test } from "bun:test";
import { createGrid, NO_CLUE } from "@loophole/core";
import { cellCommand, cellLabel, moveCell } from "./keyboard.ts";

describe("editor keyboard", () => {
  test("arrows move, 0–3 place, Backspace, Delete and . erase, Space and Enter cycle", () => {
    expect(cellCommand("ArrowLeft")).toEqual({ type: "move", direction: "left" });
    expect(["0", "1", "2", "3"].map(cellCommand)).toEqual(
      [0, 1, 2, 3].map((clue) => ({ type: "set", clue })),
    );
    for (const key of ["Backspace", "Delete", "."])
      expect(cellCommand(key)).toEqual({ type: "erase" });
    for (const key of [" ", "Enter"]) expect(cellCommand(key)).toEqual({ type: "cycle" });
    for (const key of ["4", "x", "Tab"]) expect(cellCommand(key)).toBeNull();
  });

  test("the cursor moves one cell and stops at the sides", () => {
    const grid = createGrid(3, 2);
    expect(moveCell(grid, 0, "right")).toBe(1);
    expect(moveCell(grid, 0, "down")).toBe(3);
    expect(moveCell(grid, 0, "up")).toBe(0);
    expect(moveCell(grid, 0, "left")).toBe(0);
    expect(moveCell(grid, 5, "right")).toBe(5);
    expect(moveCell(grid, 5, "down")).toBe(5);
    expect(moveCell(grid, 5, "up")).toBe(2);
  });

  test("the label names the cell and its clue", () => {
    const grid = createGrid(3, 2);
    expect(cellLabel(grid, 4, 2)).toBe("Row 2, column 2: clue 2");
    expect(cellLabel(grid, 0, NO_CLUE)).toBe("Row 1, column 1: empty");
  });
});
````

#### Create `apps/web/src/lib/editor/draft.ts`

````ts
import {
  createPuzzle,
  MAX_SIZE,
  MIN_SIZE,
  NO_CLUE,
  type Puzzle,
  parsePuzzle,
  serializePuzzle,
} from "@loophole/core";
import type { KeyValueStorage } from "../game/progress.ts";
import type { CellEdit } from "./keyboard.ts";

/** The puzzle being made in the editor (PRD FR-26): a size and a clue per cell. */
export interface Draft {
  readonly width: number;
  readonly height: number;
  /** One entry per cell, row-major: 0–3, or `NO_CLUE`. */
  readonly clues: Int8Array;
}

/** Where the editor keeps its one draft, in the wire format (docs/FORMAT.md). */
export const DRAFT_KEY = "loophole:editor-draft";

/** A new draft's size, as on the Editor artboard. */
export const DEFAULT_SIZE = 7;

export function createDraft(width = DEFAULT_SIZE, height = DEFAULT_SIZE): Draft {
  return { width, height, clues: new Int8Array(width * height).fill(NO_CLUE) };
}

/** A whole number from 1 to 100 typed into a size field, or null for anything else. */
export function parseSize(text: string): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null;
  const n = Number(text);
  return n >= MIN_SIZE && n <= MAX_SIZE ? n : null;
}

/** The draft at a new size. Clues in the part both sizes share stay where they were. */
export function resizeDraft(d: Draft, width: number, height: number): Draft {
  if (width === d.width && height === d.height) return d;
  const next = createDraft(width, height);
  for (let r = 0; r < Math.min(height, d.height); r++) {
    for (let c = 0; c < Math.min(width, d.width); c++) {
      next.clues[r * width + c] = d.clues[r * d.width + c];
    }
  }
  return next;
}

/** Sets one cell's clue (0–3, or `NO_CLUE` to erase). Returns `d` itself when nothing changes. */
export function setClue(d: Draft, cell: number, clue: number): Draft {
  if (d.clues[cell] === clue) return d;
  const clues = d.clues.slice();
  clues[cell] = clue;
  return { ...d, clues };
}

/** A tap on a cell: empty → 0 → 1 → 2 → 3 → empty. */
export function cycleClue(d: Draft, cell: number): Draft {
  const clue = d.clues[cell];
  return setClue(d, cell, clue === 3 ? NO_CLUE : clue + 1);
}

/** What a tap does: place the picked clue, erase, or (with nothing picked) cycle. */
export type Brush = 0 | 1 | 2 | 3 | "erase" | null;

export function brushEdit(brush: Brush): CellEdit {
  if (brush === null) return { type: "cycle" };
  if (brush === "erase") return { type: "erase" };
  return { type: "set", clue: brush };
}

/** Applies a key's or a tap's edit to one cell. */
export function editCell(d: Draft, cell: number, edit: CellEdit): Draft {
  switch (edit.type) {
    case "set":
      return setClue(d, cell, edit.clue);
    case "erase":
      return setClue(d, cell, NO_CLUE);
    case "cycle":
      return cycleClue(d, cell);
  }
}

export function clearClues(d: Draft): Draft {
  return createDraft(d.width, d.height);
}

export function clueCount(d: Draft): number {
  let n = 0;
  for (const clue of d.clues) if (clue !== NO_CLUE) n++;
  return n;
}

export function draftPuzzle(d: Draft): Puzzle {
  return createPuzzle(d.width, d.height, d.clues);
}

/** The saved draft, or null when there is none or it can't be read. */
export function loadDraft(storage: KeyValueStorage | null): Draft | null {
  try {
    const text = storage?.getItem(DRAFT_KEY);
    if (!text) return null;
    const puzzle = parsePuzzle(JSON.parse(text));
    return { width: puzzle.grid.width, height: puzzle.grid.height, clues: puzzle.clues };
  } catch {
    return null;
  }
}

/** Saves the draft. Storage errors (private mode, quota) are ignored. */
export function saveDraft(storage: KeyValueStorage | null, d: Draft): void {
  try {
    storage?.setItem(DRAFT_KEY, JSON.stringify(serializePuzzle(draftPuzzle(d))));
  } catch {
    // Losing a draft save must never break the editor.
  }
}
````

#### Create `apps/web/src/lib/editor/draft.test.ts`

````ts
import { describe, expect, test } from "bun:test";
import { NO_CLUE, serializePuzzle } from "@loophole/core";
import { memoryStorage } from "../test-support/memory-storage.ts";
import {
  brushEdit,
  clearClues,
  clueCount,
  createDraft,
  cycleClue,
  DRAFT_KEY,
  draftPuzzle,
  editCell,
  loadDraft,
  parseSize,
  resizeDraft,
  saveDraft,
  setClue,
} from "./draft.ts";

describe("editor draft", () => {
  test("a new draft is 7×7 with no clues", () => {
    const d = createDraft();
    expect([d.width, d.height, clueCount(d)]).toEqual([7, 7, 0]);
    expect(d.clues.every((c) => c === NO_CLUE)).toBe(true);
  });

  test("a tap cycles empty → 0 → 1 → 2 → 3 → empty", () => {
    let d = createDraft(2, 1);
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      d = cycleClue(d, 1);
      seen.push(d.clues[1]);
    }
    expect(seen).toEqual([0, 1, 2, 3, NO_CLUE]);
    expect(d.clues[0]).toBe(NO_CLUE);
  });

  test("setClue places and erases, and returns the same draft when nothing changes", () => {
    const d = setClue(createDraft(2, 2), 3, 2);
    expect(serializePuzzle(draftPuzzle(d)).clues).toBe("...2");
    expect(setClue(d, 3, 2)).toBe(d);
    expect(clueCount(setClue(d, 3, NO_CLUE))).toBe(0);
  });

  test("resizing keeps the clues both sizes share, top left", () => {
    let d = createDraft(3, 2);
    d = setClue(setClue(setClue(d, 0, 1), 2, 3), 5, 0); // "1.3" / "..0"
    expect(serializePuzzle(draftPuzzle(resizeDraft(d, 2, 3))).clues).toBe("1.....");
    expect(serializePuzzle(draftPuzzle(resizeDraft(d, 4, 2))).clues).toBe("1.3...0.");
    expect(resizeDraft(d, 3, 2)).toBe(d);
  });

  test("clear removes every clue and keeps the size", () => {
    const d = clearClues(setClue(createDraft(4, 3), 5, 1));
    expect([d.width, d.height, clueCount(d)]).toEqual([4, 3, 0]);
  });

  test("parseSize takes whole numbers from 1 to 100", () => {
    expect(["1", " 100 ", "7"].map(parseSize)).toEqual([1, 100, 7]);
    expect(["0", "101", "", "7.5", "-3", "abc"].map(parseSize)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  test("a saved draft loads back; a missing or broken one loads as null", () => {
    const storage = memoryStorage();
    expect(loadDraft(storage)).toBeNull();
    const d = setClue(createDraft(3, 2), 4, 3);
    saveDraft(storage, d);
    expect(storage.getItem(DRAFT_KEY)).toBe('{"v":1,"width":3,"height":2,"clues":"....3."}');
    expect(loadDraft(storage)).toEqual(d);
    storage.setItem(DRAFT_KEY, '{"v":1,"width":3,"height":2,"clues":"x"}');
    expect(loadDraft(storage)).toBeNull();
    expect(loadDraft(null)).toBeNull();
    saveDraft(null, d); // no storage: nothing happens
  });
});

describe("editing cells", () => {
  test("a brush turns a tap into placing, erasing or (no brush) cycling", () => {
    expect(brushEdit(2)).toEqual({ type: "set", clue: 2 });
    expect(brushEdit("erase")).toEqual({ type: "erase" });
    expect(brushEdit(null)).toEqual({ type: "cycle" });
  });

  test("editCell applies set, erase and cycle", () => {
    let d = createDraft(2, 1);
    d = editCell(d, 0, { type: "set", clue: 3 });
    d = editCell(d, 1, { type: "cycle" });
    expect(serializePuzzle(draftPuzzle(d)).clues).toBe("30");
    d = editCell(d, 0, { type: "erase" });
    expect(serializePuzzle(draftPuzzle(d)).clues).toBe(".0");
  });
});
````

#### Create `apps/web/src/lib/editor/answers.ts`

````ts
import { deriveClues, NO_CLUE, type Puzzle } from "@loophole/core";

/** A clue that would rule out the second of two answers. */
export interface Suggestion {
  readonly cell: number;
  readonly clue: number;
}

/**
 * For a puzzle with two answers `a` and `b` (edge states): the first empty cell, in reading order,
 * whose side count differs between them, with its count in `a`. That clue keeps `a` and rules out
 * `b`. Null when every empty cell has the same count in both, so no single new clue tells them
 * apart.
 */
export function suggestClue(puzzle: Puzzle, a: Uint8Array, b: Uint8Array): Suggestion | null {
  const { grid, clues } = puzzle;
  const countA = deriveClues(grid, a);
  const countB = deriveClues(grid, b);
  for (let i = 0; i < grid.cellCount; i++) {
    if (clues[i] !== NO_CLUE || countA[i] === countB[i] || countA[i] > 3) continue;
    return { cell: i, clue: countA[i] };
  }
  return null;
}
````

#### Create `apps/web/src/lib/editor/answers.test.ts`

````ts
import { describe, expect, test } from "bun:test";
import { analyzeBoard, createPuzzle, parsePuzzle, verify } from "@loophole/core";
import { suggestClue } from "./answers.ts";

// The Editor artboard's puzzle: a real puzzle with one clue removed, which leaves two answers.
const ARTBOARD = parsePuzzle({
  v: 1,
  width: 7,
  height: 7,
  clues: "..2..1.3.222...1.1..3.....2.110..0.........0.3.0.",
});

describe("suggestClue", () => {
  test("names an empty cell whose clue keeps answer A and rules out answer B", () => {
    const result = verify(ARTBOARD);
    expect(result.status).toBe("multiple");
    const [a, b] = result.solutions;
    const s = suggestClue(ARTBOARD, a, b);
    if (s === null) throw new Error("no suggestion");
    expect(ARTBOARD.clues[s.cell]).toBe(-1);
    const clues = ARTBOARD.clues.slice();
    clues[s.cell] = s.clue;
    const withClue = createPuzzle(7, 7, clues);
    expect(analyzeBoard(withClue, a).solved).toBe(true);
    expect(analyzeBoard(withClue, b).solved).toBe(false);
  });

  test("is null when no empty cell tells the answers apart", () => {
    const open = createPuzzle(2, 2);
    const [a, b] = verify(open).solutions;
    const full = createPuzzle(2, 2, [1, 1, 1, 1]);
    expect(suggestClue(full, a, b)).toBeNull();
    expect(suggestClue(open, a, a)).toBeNull();
  });
});
````

#### Create `apps/web/src/lib/editor/checker.ts`

````ts
import {
  decodeEdges,
  encodeEdges,
  type Puzzle,
  type PuzzleWireV1,
  parsePuzzle,
  serializePuzzle,
  type VerifyStatus,
  verify,
} from "@loophole/core";

/**
 * How long the browser looks for answers before saying "unknown". The server tries for 30 s when
 * the puzzle is submitted (PRD NFR-1), so this only has to keep the feedback quick.
 */
export const CHECK_TIME_LIMIT_MS = 3_000;

/** Wait after the last edit before checking, so typing a row of clues runs one check. */
export const CHECK_DEBOUNCE_MS = 250;

/** Extra time a check may take past its limit before its thread is stopped. */
const HARD_LIMIT_SLACK_MS = 2_000;

/** A message to the check thread. */
export interface CheckRequest {
  readonly id: number;
  readonly puzzle: PuzzleWireV1;
  readonly timeLimitMs: number;
}

/** The check thread's answer, with solutions in the edge-state encoding. */
export interface CheckReply {
  readonly id: number;
  readonly status: VerifyStatus;
  readonly solutions: readonly string[];
}

/** What the verifier says about the draft: its status, and up to two answers as edge states. */
export interface CheckResult {
  readonly status: VerifyStatus;
  readonly solutions: readonly Uint8Array[];
}

/** Runs one check; the check thread calls this. */
export function answerCheck(request: CheckRequest): CheckReply {
  const result = verify(parsePuzzle(request.puzzle), { timeLimitMs: request.timeLimitMs });
  return { id: request.id, status: result.status, solutions: result.solutions.map(encodeEdges) };
}

/** The parts of a Web Worker the checker uses, so tests can pass a fake. */
export interface CheckWorker {
  postMessage(request: CheckRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<CheckReply>) => void) | null;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface LiveCheckerOptions {
  readonly createWorker: () => CheckWorker;
  /** Called with the result for the latest puzzle only. */
  readonly onresult: (result: CheckResult) => void;
  readonly timers?: Timers;
  readonly debounceMs?: number;
  readonly timeLimitMs?: number;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Live solver feedback for the editor (PRD FR-26). Checks run in a worker thread so the page never
 * blocks. A new edit waits out the debounce, then replaces any check still running: that thread
 * is stopped and a fresh one started, so only the latest puzzle is ever answered. A check that
 * overruns its limit is stopped too and reported as unknown.
 */
export class LiveChecker {
  readonly #options: LiveCheckerOptions;
  readonly #timers: Timers;
  #worker: CheckWorker | null = null;
  #busy = false;
  #id = 0;
  #debounce: unknown = null;
  #deadline: unknown = null;

  constructor(options: LiveCheckerOptions) {
    this.#options = options;
    this.#timers = options.timers ?? realTimers;
  }

  /** Checks `puzzle` after the debounce. */
  check(puzzle: Puzzle): void {
    if (this.#debounce !== null) this.#timers.clear(this.#debounce);
    this.#debounce = this.#timers.set(() => {
      this.#debounce = null;
      this.#run(puzzle);
    }, this.#options.debounceMs ?? CHECK_DEBOUNCE_MS);
  }

  /** Stops any check and its thread. */
  dispose(): void {
    if (this.#debounce !== null) this.#timers.clear(this.#debounce);
    this.#debounce = null;
    this.#stop();
  }

  #run(puzzle: Puzzle): void {
    if (this.#busy) this.#stop();
    const timeLimitMs = this.#options.timeLimitMs ?? CHECK_TIME_LIMIT_MS;
    const worker = this.#worker ?? this.#options.createWorker();
    this.#worker = worker;
    const id = ++this.#id;
    worker.onmessage = (event) => {
      if (event.data.id !== this.#id) return;
      this.#settle();
      const solutions = event.data.solutions.map((s) => decodeEdges(puzzle.grid, s));
      this.#options.onresult({ status: event.data.status, solutions });
    };
    this.#busy = true;
    this.#deadline = this.#timers.set(() => {
      this.#stop();
      this.#options.onresult({ status: "unknown", solutions: [] });
    }, timeLimitMs + HARD_LIMIT_SLACK_MS);
    worker.postMessage({ id, puzzle: serializePuzzle(puzzle), timeLimitMs });
  }

  #settle(): void {
    this.#busy = false;
    if (this.#deadline !== null) this.#timers.clear(this.#deadline);
    this.#deadline = null;
  }

  #stop(): void {
    this.#settle();
    this.#worker?.terminate();
    this.#worker = null;
  }
}
````

#### Create `apps/web/src/lib/editor/checker.test.ts`

````ts
import { describe, expect, test } from "bun:test";
import { createPuzzle, encodeEdges, serializePuzzle } from "@loophole/core";
import {
  answerCheck,
  type CheckReply,
  type CheckRequest,
  type CheckResult,
  type CheckWorker,
  LiveChecker,
  type Timers,
} from "./checker.ts";

/** Timers that run only when the test says so. */
function fakeTimers() {
  let now = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  let next = 0;
  const timers: Timers = {
    set(fn, ms) {
      pending.set(++next, { at: now + ms, fn });
      return next;
    },
    clear(handle) {
      pending.delete(handle as number);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
      if (t.at > now) continue;
      pending.delete(id);
      t.fn();
    }
  };
  return { timers, advance };
}

class FakeWorker implements CheckWorker {
  readonly requests: CheckRequest[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<CheckReply>) => void) | null = null;

  postMessage(request: CheckRequest): void {
    this.requests.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Answers the last request the way the real thread would. */
  answer(): void {
    const request = this.requests.at(-1);
    if (request === undefined) throw new Error("nothing to answer");
    this.onmessage?.({ data: answerCheck(request) } as MessageEvent<CheckReply>);
  }
}

function setup() {
  const { timers, advance } = fakeTimers();
  const workers: FakeWorker[] = [];
  const results: CheckResult[] = [];
  const checker = new LiveChecker({
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    onresult: (r) => results.push(r),
    timers,
    debounceMs: 250,
    timeLimitMs: 1_000,
  });
  return { checker, advance, workers, results };
}

const UNIQUE = createPuzzle(2, 2, [2, 2, 2, 2]);
const OPEN = createPuzzle(2, 2);

describe("answerCheck", () => {
  test("verifies the puzzle within the time limit and encodes the answers", () => {
    const reply = answerCheck({ id: 7, puzzle: serializePuzzle(UNIQUE), timeLimitMs: 1_000 });
    expect(reply).toEqual({ id: 7, status: "unique", solutions: ["112211121121"] });
    expect(
      answerCheck({ id: 1, puzzle: serializePuzzle(OPEN), timeLimitMs: 1_000 }).solutions,
    ).toHaveLength(2);
  });
});

describe("LiveChecker", () => {
  test("checks once after the edits stop, in a worker, and decodes the answers", () => {
    const { checker, advance, workers, results } = setup();
    checker.check(OPEN);
    advance(100);
    checker.check(UNIQUE);
    advance(249);
    expect(workers).toHaveLength(0);
    advance(1);
    expect(workers[0].requests).toEqual([
      { id: 1, puzzle: serializePuzzle(UNIQUE), timeLimitMs: 1_000 },
    ]);
    workers[0].answer();
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("unique");
    expect(encodeEdges(results[0].solutions[0])).toBe("112211121121");
  });

  test("an idle worker is reused; a busy one is stopped and replaced, and its answer ignored", () => {
    const { checker, advance, workers, results } = setup();
    checker.check(UNIQUE);
    advance(250);
    workers[0].answer();
    checker.check(OPEN);
    advance(250);
    expect(workers).toHaveLength(1);
    checker.check(UNIQUE);
    advance(250);
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    workers[0].answer(); // the stopped thread's late answer
    expect(results).toHaveLength(1);
    workers[1].answer();
    expect(results.map((r) => r.status)).toEqual(["unique", "unique"]);
  });

  test("a check that overruns its limit is stopped and reported as unknown", () => {
    const { checker, advance, workers, results } = setup();
    checker.check(OPEN);
    advance(250);
    advance(2_999);
    expect(results).toHaveLength(0);
    advance(1);
    expect(workers[0].terminated).toBe(true);
    expect(results).toEqual([{ status: "unknown", solutions: [] }]);
  });

  test("dispose stops a pending check and the worker", () => {
    const { checker, advance, workers } = setup();
    checker.check(OPEN);
    advance(250);
    checker.check(UNIQUE);
    checker.dispose();
    advance(1_000);
    expect(workers).toHaveLength(1);
    expect(workers[0].terminated).toBe(true);
  });
});
````

#### Create `apps/web/src/lib/editor/verify.worker.ts`

````ts
// The editor's check thread: runs the verifier on each draft it is sent (see checker.ts).
import { answerCheck, type CheckRequest } from "./checker.ts";

declare const self: Worker;

self.onmessage = (event: MessageEvent<CheckRequest>) => {
  self.postMessage(answerCheck(event.data));
};
````

Run:

```sh
bun test apps/web/src/lib/editor         # 25 pass
bun run format && bun run check          # about 574 pass, 0 fail
```

Commit: `git add -A && git commit -m "feat(web): editor draft, keys, clue suggestion and live checker"`


### Step 6 — Submission and report clients; server puzzles know their origin

Web clients over the generated API client: submitting, polling and listing submissions with the words for each verdict, and reporting plus the admin calls. Server puzzle summaries now carry `origin` (built-in puzzles have none), and submitted ones are named "Player-made". The tests use a fake `fetch`, like the existing `api.test.ts`.

#### Create `apps/web/src/lib/editor/submit.ts`

````ts
import type { ApiClient, Schemas } from "@loophole/api-client";
import { type Puzzle, serializePuzzle } from "@loophole/core";
import { failureMessage } from "../auth/auth.ts";

export type Submission = Schemas["Submission"];
export type Verdict = NonNullable<Submission["verdict"]>;

export type SubmitResult =
  | { readonly ok: true; readonly submission: Submission }
  | { readonly ok: false; readonly message: string };

const OFFLINE = "Couldn't reach the server. Check your connection and try again.";
const STILL_CHECKING =
  "The server is still checking. Your account page will show the result when it's ready.";

/** Words for a verdict (PRD FR-27: rejections come with an explanation). */
export function verdictText(verdict: Verdict): { readonly title: string; readonly text: string } {
  switch (verdict) {
    case "unique":
      return { title: "Published", text: "Exactly one answer. Anyone with the link can play it." };
    case "duplicate":
      return {
        title: "Already published",
        text: "A puzzle with exactly these clues is already published, so the link goes to it.",
      };
    case "none":
      return {
        title: "No answer",
        text: "No single loop fits these clues. Check for a clue too many.",
      };
    case "multiple":
      return {
        title: "More than one answer",
        text: "At least two loops fit these clues. Add a clue that tells them apart.",
      };
    case "unknown":
      return {
        title: "Too open to check",
        text: "The verifier ran out of time before it could prove there is one answer. Add clues, or try a smaller grid.",
      };
    case "removed":
      return {
        title: "Removed",
        text: "A puzzle with exactly these clues was taken down by a moderator.",
      };
    case "error":
      return { title: "Not checked", text: "Something went wrong while checking. Try again." };
  }
}

/** The address to share for a published puzzle. */
export function shareUrl(origin: string, puzzleId: string): string {
  return `${origin}/play/${encodeURIComponent(puzzleId)}`;
}

export interface WaitOptions {
  readonly intervalMs?: number;
  /** Give up after this long (the server's own limit is 45 s). */
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Submitting puzzles and following them (PRD FR-27), over the generated API client. */
export function createSubmissions(client: ApiClient) {
  async function get(id: string): Promise<SubmitResult> {
    try {
      const { data, error, response } = await client.GET("/api/submissions/{id}", {
        params: { path: { id } },
      });
      if (data === undefined) return { ok: false, message: failureMessage(response.status, error) };
      return { ok: true, submission: data };
    } catch {
      return { ok: false, message: OFFLINE };
    }
  }

  return {
    /** Sends the puzzle's clues. The answer is usually still pending; see `waitFor`. */
    async submit(puzzle: Puzzle): Promise<SubmitResult> {
      const { width, height, clues } = serializePuzzle(puzzle);
      try {
        const { data, error, response } = await client.POST("/api/submissions", {
          body: { width, height, clues },
        });
        if (data === undefined) {
          return { ok: false, message: failureMessage(response.status, error) };
        }
        return { ok: true, submission: data };
      } catch {
        return { ok: false, message: OFFLINE };
      }
    },

    get,

    /** Polls a submission until it is decided, or gives up after `timeoutMs`. */
    async waitFor(id: string, options: WaitOptions = {}): Promise<SubmitResult> {
      const interval = options.intervalMs ?? 1_000;
      const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
      for (let waited = 0; waited < (options.timeoutMs ?? 90_000); waited += interval) {
        await sleep(interval);
        const result = await get(id);
        if (!result.ok || result.submission.status !== "pending") return result;
      }
      return { ok: false, message: STILL_CHECKING };
    },

    /** The logged-in player's submissions, newest first, or null when they can't be read. */
    async list(): Promise<Submission[] | null> {
      try {
        const { data } = await client.GET("/api/submissions");
        return data?.items ?? null;
      } catch {
        return null;
      }
    },
  };
}

export type Submissions = ReturnType<typeof createSubmissions>;
````

#### Create `apps/web/src/lib/editor/submit.test.ts`

````ts
import { describe, expect, test } from "bun:test";
import { createApiClient } from "@loophole/api-client";
import { createPuzzle } from "@loophole/core";
import { createSubmissions, type Submission, shareUrl, verdictText } from "./submit.ts";

const PENDING: Submission = {
  id: "s1",
  width: 2,
  height: 2,
  status: "pending",
  verdict: null,
  puzzleId: null,
  createdAt: "2026-10-25T12:00:00.000Z",
  decidedAt: null,
};
const PUBLISHED: Submission = {
  ...PENDING,
  status: "published",
  verdict: "unique",
  puzzleId: "s1",
  decidedAt: "2026-10-25T12:00:01.000Z",
};

/** A client whose fetch answers each request with the next of `answers` and records them. */
function clientFor(answers: [number, unknown][]) {
  const requests: { method: string; path: string; body: unknown }[] = [];
  const fetch = (async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "POST" ? await input.json() : undefined;
    requests.push({ method: input.method, path: url.pathname, body });
    const [status, answer] = answers.shift() ?? [500, { title: "No answer" }];
    return new Response(JSON.stringify(answer), {
      status,
      headers: { "Content-Type": status < 400 ? "application/json" : "application/problem+json" },
    });
  }) as typeof globalThis.fetch;
  return { client: createApiClient({ baseUrl: "http://api.test", fetch }), requests };
}

describe("submissions client", () => {
  test("submit posts the size and clues", async () => {
    const { client, requests } = clientFor([[202, PENDING]]);
    const result = await createSubmissions(client).submit(createPuzzle(2, 2, [2, -1, -1, 3]));
    expect(result).toEqual({ ok: true, submission: PENDING });
    expect(requests).toEqual([
      { method: "POST", path: "/api/submissions", body: { width: 2, height: 2, clues: "2..3" } },
    ]);
  });

  test("a refusal comes back with the server's explanation", async () => {
    const { client } = clientFor([
      [
        403,
        { title: "Email not confirmed", detail: "Confirm your email address first.", status: 403 },
      ],
      [429, { title: "Too many requests", status: 429 }],
    ]);
    const s = createSubmissions(client);
    expect(await s.submit(createPuzzle(1, 1))).toEqual({
      ok: false,
      message: "Confirm your email address first.",
    });
    expect((await s.submit(createPuzzle(1, 1))).ok).toBe(false);
  });

  test("waitFor polls until the submission is decided", async () => {
    const { client, requests } = clientFor([
      [200, PENDING],
      [200, PUBLISHED],
    ]);
    const slept: number[] = [];
    const result = await createSubmissions(client).waitFor("s1", {
      intervalMs: 500,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    expect(result).toEqual({ ok: true, submission: PUBLISHED });
    expect(slept).toEqual([500, 500]);
    expect(requests.map((r) => r.path)).toEqual(["/api/submissions/s1", "/api/submissions/s1"]);
  });

  test("waitFor gives up after its timeout", async () => {
    const { client } = clientFor([
      [200, PENDING],
      [200, PENDING],
    ]);
    const result = await createSubmissions(client).waitFor("s1", {
      intervalMs: 500,
      timeoutMs: 1_000,
      sleep: async () => {},
    });
    expect(result.ok).toBe(false);
  });

  test("list returns the items, or null when they can't be read", async () => {
    const { client } = clientFor([
      [200, { items: [PUBLISHED] }],
      [401, { title: "Not logged in", status: 401 }],
    ]);
    const s = createSubmissions(client);
    expect(await s.list()).toEqual([PUBLISHED]);
    expect(await s.list()).toBeNull();
  });

  test("every verdict has words, and the share link points at the play page", () => {
    for (const v of [
      "unique",
      "duplicate",
      "none",
      "multiple",
      "unknown",
      "removed",
      "error",
    ] as const) {
      expect(verdictText(v).title.length).toBeGreaterThan(0);
    }
    expect(shareUrl("https://loophole.test", "a b")).toBe("https://loophole.test/play/a%20b");
  });
});
````

#### Create `apps/web/src/lib/editor/index.ts`

````ts
import { createApiClient } from "@loophole/api-client";
import { createSubmissions } from "./submit.ts";

/** The app's submissions client. */
export const submissions = createSubmissions(createApiClient());
````

#### Create `apps/web/src/lib/puzzles/reports.ts`

````ts
import type { ApiClient, Schemas } from "@loophole/api-client";
import { type AuthResult, failureMessage } from "../auth/auth.ts";

export type ReportedPuzzle = Schemas["ReportedPuzzle"];

const OFFLINE = "Couldn't reach the server. Check your connection and try again.";

/** Reporting puzzles, and the admins' side of reports (PRD FR-28). */
export function createReports(client: ApiClient) {
  async function run(
    request: () => Promise<{ response: Response; error?: unknown }>,
  ): Promise<AuthResult> {
    try {
      const { response, error } = await request();
      return response.ok
        ? { ok: true }
        : { ok: false, message: failureMessage(response.status, error) };
    } catch {
      return { ok: false, message: OFFLINE };
    }
  }

  return {
    report: (puzzleId: string, reason: string) =>
      run(() =>
        client.POST("/api/puzzles/{id}/report", {
          params: { path: { id: puzzleId } },
          body: { reason },
        }),
      ),

    /** Reported puzzles for an admin, or null when they can't be read (not an admin, offline). */
    async list(): Promise<ReportedPuzzle[] | null> {
      try {
        const { data } = await client.GET("/api/admin/reports");
        return data?.items ?? null;
      } catch {
        return null;
      }
    },

    unpublish: (puzzleId: string) =>
      run(() =>
        client.POST("/api/admin/puzzles/{id}/unpublish", { params: { path: { id: puzzleId } } }),
      ),

    dismiss: (puzzleId: string) =>
      run(() =>
        client.DELETE("/api/admin/puzzles/{id}/reports", { params: { path: { id: puzzleId } } }),
      ),
  };
}
````

#### Create `apps/web/src/lib/puzzles/reports.test.ts`

````ts
import { describe, expect, test } from "bun:test";
import { createApiClient } from "@loophole/api-client";
import { createReports } from "./reports.ts";

function clientFor(answers: [number, unknown][]) {
  const requests: string[] = [];
  const fetch = (async (input: Request) => {
    const body = input.method === "POST" && input.body ? await input.text() : "";
    requests.push(`${input.method} ${new URL(input.url).pathname} ${body}`.trim());
    const [status, answer] = answers.shift() ?? [500, { title: "No answer" }];
    return new Response(status === 204 ? null : JSON.stringify(answer), {
      status,
      headers: { "Content-Type": status < 400 ? "application/json" : "application/problem+json" },
    });
  }) as typeof globalThis.fetch;
  return { client: createApiClient({ baseUrl: "http://api.test", fetch }), requests };
}

describe("reports client", () => {
  test("report, unpublish and dismiss call their routes", async () => {
    const { client, requests } = clientFor([
      [204, null],
      [204, null],
      [204, null],
    ]);
    const reports = createReports(client);
    expect(await reports.report("p1", "rude")).toEqual({ ok: true });
    expect(await reports.unpublish("p1")).toEqual({ ok: true });
    expect(await reports.dismiss("p1")).toEqual({ ok: true });
    expect(requests).toEqual([
      'POST /api/puzzles/p1/report {"reason":"rude"}',
      "POST /api/admin/puzzles/p1/unpublish",
      "DELETE /api/admin/puzzles/p1/reports",
    ]);
  });

  test("a failure carries a message, and the list is null for non-admins", async () => {
    const { client } = clientFor([
      [401, { title: "Not logged in", status: 401 }],
      [403, { title: "Admins only", status: 403 }],
    ]);
    const reports = createReports(client);
    expect(await reports.report("p1", "x")).toEqual({ ok: false, message: "Not logged in" });
    expect(await reports.list()).toBeNull();
  });
});
````

#### Replace the whole of `apps/web/src/lib/puzzles/index.ts` with

````ts
import { createApiClient } from "@loophole/api-client";
import { apiSource } from "./api.ts";
import { withServer } from "./combined.ts";
import { fixtureSource } from "./fixtures.ts";
import { createReports } from "./reports.ts";
import type { PuzzleSource } from "./source.ts";

export type { ReportedPuzzle } from "./reports.ts";
export { type PuzzleEntry, type PuzzleSource, type PuzzleSummary, puzzleTitle } from "./source.ts";

/** The puzzle source the screens use: the built-in fixtures, then puzzles from the API. */
export const puzzleSource: PuzzleSource = withServer(fixtureSource, apiSource(createApiClient()));

/** Reporting puzzles and the admins' list of reports. */
export const reports = createReports(createApiClient());
````

#### Edit `apps/web/src/lib/puzzles/source.ts` (1 edit)


1. Replace

````ts
  readonly height: number;
}
````

   with

````ts
  readonly height: number;
  /** Where a server puzzle came from; built-in puzzles have none. */
  readonly origin?: "generated" | "submitted";
}
````


#### Edit `apps/web/src/lib/puzzles/api.ts` (1 edit)


1. Replace

````ts
    id: p.id,
    name: "Generated",
    subtitle: "Practice · 練習",
    width: p.width,
    height: p.height,
  };
````

   with

````ts
    id: p.id,
    name: p.origin === "submitted" ? "Player-made" : "Generated",
    subtitle: "Practice · 練習",
    width: p.width,
    height: p.height,
    origin: p.origin,
  };
````


#### Edit `apps/web/src/lib/puzzles/api.test.ts` (1 edit)


1. Replace

````ts
    expect(await apiSource(client).list()).toEqual([
      { id: "p1", name: "Generated", subtitle: "Practice · 練習", width: 10, height: 7 },
    ]);
    expect(urls).toEqual(["/api/puzzles?limit=20"]);
  });
````

   with

````ts
    expect(await apiSource(client).list()).toEqual([
      {
        id: "p1",
        name: "Generated",
        subtitle: "Practice · 練習",
        width: 10,
        height: 7,
        origin: "generated",
      },
    ]);
    expect(urls).toEqual(["/api/puzzles?limit=20"]);
  });

  test("a submitted puzzle is listed as player-made", async () => {
    const { client } = clientFor({
      "/api/puzzles": [
        200,
        { items: [{ id: "s1", width: 5, height: 5, origin: "submitted", createdAt: "x" }] },
      ],
    });
    expect(await apiSource(client).list()).toMatchObject([
      { id: "s1", name: "Player-made", origin: "submitted" },
    ]);
  });
````


Run:

```sh
bun test apps/web/src/lib/editor apps/web/src/lib/puzzles
bun run format && bun run check          # about 583 pass, 0 fail
```

Commit: `git add -A && git commit -m "feat(web): submission and report clients"`


### Step 7 — The editor page

The editor page after `docs/design/Editor.dc.html`: `EditorBoard` (cell taps, cursor, pinch/drag/wheel zoom, suggested-cell box), `AnswerFigure` (the 133 px answer boards), `EditorScreen` (size, palette, board, verifier card, publishing) and the `/create` route, plus "Create" in the site header's main nav (with the shu underline on the current page). The worker is created with `new Worker(new URL("../editor/verify.worker.ts", import.meta.url), { type: "module" })`, which Vite bundles as its own chunk.

#### Create `apps/web/src/lib/components/EditorBoard.svelte`

````svelte
<script lang="ts">
  import { analyzeBoard, NONE, type Puzzle } from "@loophole/core";
  import { type CellEdit, cellCommand, cellLabel, moveCell } from "../editor/keyboard.ts";
  import { cellAt, cellPoint, type Layout, type Point } from "../game/geometry.ts";
  import { BoardPointers } from "../game/pointers.ts";
  import {
    miniJump,
    miniLayout,
    panBy,
    revealRect,
    type Size,
    SVG_MAX_SIZE,
    type View,
    wheelView,
    ZOOM_STEP,
    type ZoomLimits,
    zoomAround,
  } from "../game/viewport.ts";
  import BoardCanvas from "./BoardCanvas.svelte";
  import BoardSvg from "./BoardSvg.svelte";
  import MiniMap from "./MiniMap.svelte";
  import ZoomControls from "./ZoomControls.svelte";

  interface Props {
    /** The draft: clues only. */
    puzzle: Puzzle;
    /** Cells to mark with a dashed ai box, such as a suggested clue's cell (Editor artboard). */
    highlight: readonly number[];
    layout: Layout;
    view: View;
    port: Size;
    zoom: ZoomLimits | null;
    /** A tap on a cell; the editor decides what it does. */
    ontap: (cell: number) => void;
    /** A key's edit to the cursor's cell. */
    onkey: (cell: number, edit: CellEdit) => void;
    onview: (view: View) => void;
  }

  let { puzzle, highlight, layout, view, port, zoom, ontap, onkey, onview }: Props = $props();

  // The editor's board is drawn by the play board's renderers, with no lines.
  const grid = $derived(puzzle.grid);
  const S = $derived(layout.cell);
  const canvas = $derived(grid.width > SVG_MAX_SIZE || grid.height > SVG_MAX_SIZE);
  const edges = $derived(new Uint8Array(grid.edgeCount));
  const analysis = $derived(analyzeBoard(puzzle, edges));
  const marks = $derived(
    highlight.map((cell) => {
      const p = cellPoint(grid, layout, cell);
      return { cell, x: p.x - S / 2 - view.x + 2, y: p.y - S / 2 - view.y + 2, size: S - 4 };
    }),
  );

  // Keyboard cursor (NFR-5): a cell, shown while the board has focus and the keyboard was used last.
  let surface: HTMLDivElement | undefined = $state();
  let cursor = $state(0);
  let focused = $state(false);
  let keyboardMode = $state(false);
  const showCursor = $derived(focused && keyboardMode);
  const cursorLabel = $derived(cellLabel(grid, cursor, puzzle.clues[cursor]));
  const cursorBox = $derived.by(() => {
    const p = cellPoint(grid, layout, cursor);
    return { x: p.x - S / 2 - view.x + 2, y: p.y - S / 2 - view.y + 2, size: S - 4 };
  });

  // One finger (or the mouse) taps a cell; dragging past the slop pans a zoomable board instead;
  // a second finger pinches.
  const pointers = new BoardPointers();
  let press: Point | null = null;
  let last: Point | null = null;

  function local(e: { clientX: number; clientY: number }): Point {
    const r = (surface as HTMLDivElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onpointerdown(e: PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = local(e);
    const started = pointers.down(e.pointerId, p, view, zoom !== null && e.pointerType !== "mouse");
    if (started === null) return;
    surface?.setPointerCapture(e.pointerId);
    keyboardMode = false;
    press = started === "draw" ? p : null;
    last = p;
  }

  function onpointermove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    if (zoom !== null) {
      const pinched = pointers.move(e.pointerId, p, grid, port, zoom);
      if (pinched !== null) {
        onview(pinched);
        return;
      }
    }
    if (!pointers.drawing || last === null) return;
    if (press !== null && Math.hypot(p.x - press.x, p.y - press.y) > Math.max(8, S / 4)) {
      press = null;
    }
    if (press === null && zoom !== null) onview(panBy(grid, view, p.x - last.x, p.y - last.y, port, zoom));
    last = p;
  }

  function onpointerup(e: PointerEvent) {
    if (!pointers.up(e.pointerId) || press === null) return;
    const cell = cellAt(grid, layout, press.x + view.x, press.y + view.y);
    press = null;
    if (cell === NONE) return;
    cursor = cell;
    ontap(cell);
  }

  function onpointercancel(e: PointerEvent) {
    pointers.up(e.pointerId);
    press = null;
  }

  // Wheel and trackpad, as on the play board; added by hand so it can stop page zoom and scroll.
  let boardEl: HTMLDivElement | undefined = $state();
  const zoomable = $derived(zoom !== null);
  $effect(() => {
    const el = boardEl;
    if (el === undefined || !zoomable) return;
    const onwheel = (e: WheelEvent) => {
      e.preventDefault();
      if (zoom !== null) onview(wheelView(grid, view, e, local(e), port, zoom));
    };
    el.addEventListener("wheel", onwheel, { passive: false });
    return () => el.removeEventListener("wheel", onwheel);
  });

  function zoomBy(factor: number, at: Point) {
    if (zoom !== null) onview(zoomAround(grid, view, view.cell * factor, at, port, zoom));
  }

  function centre(): Point {
    return { x: port.width / 2, y: port.height / 2 };
  }

  /** Pans so the cursor's cell is on screen and clear of the overlays. */
  function reveal(cell: number) {
    if (zoom === null) return;
    const p = cellPoint(grid, layout, cell);
    onview(revealRect(grid, view, { x: p.x - S, y: p.y - S, width: 2 * S, height: 2 * S }, port, zoom));
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (zoom !== null && (e.key === "+" || e.key === "=" || e.key === "-")) {
      e.preventDefault();
      const p = cellPoint(grid, layout, cursor);
      zoomBy(e.key === "-" ? 1 / ZOOM_STEP : ZOOM_STEP, { x: p.x - view.x, y: p.y - view.y });
      return;
    }
    const cmd = cellCommand(e.key);
    if (cmd === null) return;
    e.preventDefault();
    keyboardMode = true;
    if (cmd.type === "move") {
      cursor = moveCell(grid, cursor, cmd.direction);
      reveal(cursor);
    } else {
      onkey(cursor, cmd);
    }
  }
</script>

<div bind:this={boardEl} class="board" style:width="{port.width}px" style:height="{port.height}px">
  <!-- One focusable widget, like the play board: taps are hit-tested by geometry and the keyboard
       moves a cell cursor. The data attributes give tests the board's geometry. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={surface}
    class="surface"
    role="application"
    aria-label="Puzzle grid, {grid.width} by {grid.height}. Arrow keys move between cells; type 0 to 3 to place a clue, Backspace to erase."
    aria-describedby="editor-cursor"
    tabindex={0}
    data-cell={layout.cell}
    data-margin={layout.margin}
    data-x={view.x}
    data-y={view.y}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    {onpointercancel}
    {onkeydown}
    onfocus={() => {
      focused = true;
      keyboardMode = surface?.matches(":focus-visible") ?? false;
      if (keyboardMode) reveal(cursor);
    }}
    onblur={() => (focused = false)}
  >
    {#if canvas}
      <BoardCanvas {puzzle} {edges} {analysis} {layout} {view} {port} hint={null} />
    {:else}
      <BoardSvg {puzzle} {edges} {analysis} {layout} {view} {port} hint={null} />
    {/if}
    {#if showCursor || marks.length > 0}
      <svg class="overlay" width={port.width} height={port.height} aria-hidden="true">
        {#each marks as m (m.cell)}
          <rect class="mark" x={m.x} y={m.y} width={m.size} height={m.size} rx="4" />
        {/each}
        {#if showCursor}
          <rect class="cursor" x={cursorBox.x} y={cursorBox.y} width={cursorBox.size} height={cursorBox.size} rx="4" />
        {/if}
      </svg>
    {/if}
  </div>
  {#if zoom !== null}
    {@const limits = zoom}
    <MiniMap
      {grid}
      {edges}
      {view}
      {port}
      onjump={(x, y) => onview(miniJump(grid, view, x, y, miniLayout(grid), port, limits))}
    />
    <ZoomControls {view} {limits} onzoom={(factor) => zoomBy(factor, centre())} />
  {/if}
  <p id="editor-cursor" class="visually-hidden" aria-live="polite">{showCursor ? cursorLabel : ""}</p>
</div>

<style>
  .board {
    position: relative;
  }

  .surface {
    position: relative;
    width: 100%;
    height: 100%;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    cursor: pointer;
    outline: none;
  }

  .overlay {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
  }

  .mark {
    fill: var(--hint-wash);
    stroke: var(--ai);
    stroke-width: 2.5;
    stroke-dasharray: 6 4;
  }

  .cursor {
    fill: none;
    stroke: var(--ai);
    stroke-width: 3;
  }
</style>
````

#### Create `apps/web/src/lib/components/AnswerFigure.svelte`

````svelte
<script lang="ts">
  import { EdgeState, type Grid } from "@loophole/core";
  import { cellPoint, dotPoint, edgeSegment, type Layout } from "../game/geometry.ts";

  interface Props {
    grid: Grid;
    /** One answer, as edge states. */
    edges: Uint8Array;
    /** A cell to mark with a dashed ai box, or null. */
    highlight: number | null;
    name: string;
  }

  let { grid, edges, highlight, name }: Props = $props();

  // The Editor artboard's small answer boards: 133px square, lines and dots, no clues.
  const BOX = 133;
  const layout: Layout = $derived.by(() => {
    const margin = 7;
    const cell = (BOX - 2 * margin) / Math.max(grid.width, grid.height);
    return { cell, margin, width: grid.width * cell + 2 * margin, height: grid.height * cell + 2 * margin };
  });
  const line = $derived(Math.max(1, Math.min(2.5, layout.cell * 0.15)));
  const lines = $derived.by(() => {
    let d = "";
    for (let e = 0; e < grid.edgeCount; e++) {
      if (edges[e] !== EdgeState.Line) continue;
      const s = edgeSegment(grid, layout, e);
      d += `M${s.x1} ${s.y1}L${s.x2} ${s.y2}`;
    }
    return d;
  });
  // Dots only while they stay apart.
  const dots = $derived.by(() => {
    if (layout.cell < 6) return [];
    return Array.from({ length: grid.dotCount }, (_, d) => dotPoint(grid, layout, d));
  });
  const mark = $derived(highlight === null ? null : cellPoint(grid, layout, highlight));
</script>

<figure>
  <svg width={layout.width} height={layout.height} aria-hidden="true">
    {#if mark}
      <rect
        class="mark"
        x={mark.x - layout.cell / 2 + 1}
        y={mark.y - layout.cell / 2 + 1}
        width={layout.cell - 2}
        height={layout.cell - 2}
        rx="2"
      />
    {/if}
    <path class="line" d={lines} stroke-width={line} />
    {#each dots as p, i (i)}
      <circle class="dot" cx={p.x} cy={p.y} r={Math.max(1, layout.cell * 0.05)} />
    {/each}
  </svg>
  <figcaption>{name}</figcaption>
</figure>

<style>
  figure {
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }

  svg {
    display: block;
    background: var(--ground);
    border: 1.5px solid var(--hairline);
  }

  .line {
    fill: none;
    stroke: var(--ink);
    stroke-linecap: round;
  }

  .dot {
    fill: var(--ink);
  }

  .mark {
    fill: var(--hint-wash);
    stroke: var(--ai);
    stroke-width: 1.5;
    stroke-dasharray: 3 2;
  }

  figcaption {
    font-size: 13px;
    font-weight: 700;
  }
</style>
````

#### Create `apps/web/src/lib/components/EditorScreen.svelte`

````svelte
<script lang="ts">
  import type { VerifyStatus } from "@loophole/core";
  import { onMount } from "svelte";
  import { auth } from "../auth/index.ts";
  import { suggestClue } from "../editor/answers.ts";
  import { type CheckResult, LiveChecker } from "../editor/checker.ts";
  import {
    type Brush,
    brushEdit,
    clearClues,
    clueCount,
    createDraft,
    DEFAULT_SIZE,
    type Draft,
    draftPuzzle,
    editCell,
    loadDraft,
    parseSize,
    resizeDraft,
    saveDraft,
  } from "../editor/draft.ts";
  import { submissions } from "../editor/index.ts";
  import { type SubmitResult, shareUrl, verdictText } from "../editor/submit.ts";
  import { fitLayout, MAX_CELL, POINTER_MIN_CELL, TOUCH_MIN_CELL } from "../game/geometry.ts";
  import { browserStorage } from "../game/progress.ts";
  import { clampView, type View, viewLayout, zoomLimits } from "../game/viewport.ts";
  import AnswerFigure from "./AnswerFigure.svelte";
  import EditorBoard from "./EditorBoard.svelte";

  let draft: Draft = $state.raw(createDraft());
  let widthText = $state(String(DEFAULT_SIZE));
  let heightText = $state(String(DEFAULT_SIZE));
  let brush: Brush = $state(null);
  let ready = $state(false);
  const puzzle = $derived(draftPuzzle(draft));
  const grid = $derived(puzzle.grid);

  // Live feedback (FR-26): "checking" from the edit until the worker answers for that draft.
  let result = $state.raw<CheckResult | null>(null);
  const status: VerifyStatus | "checking" = $derived(result?.status ?? "checking");
  let checker: LiveChecker | null = null;

  const answers = $derived(
    result?.status === "multiple" && result.solutions.length === 2 ? result.solutions : null,
  );
  const suggestion = $derived(answers === null ? null : suggestClue(puzzle, answers[0], answers[1]));
  const highlight = $derived(suggestion === null ? [] : [suggestion.cell]);

  const VERDICTS: Record<VerifyStatus | "checking", { title: string; text: string }> = {
    checking: { title: "Checking…", text: "The verifier is looking for answers to your clues." },
    unique: {
      title: "Exactly one answer",
      text: "Only one loop fits your clues. It's ready to publish.",
    },
    none: { title: "No answer", text: "No single loop fits these clues. Check for a clue too many." },
    multiple: { title: "More than one answer", text: "These two loops both fit your clues." },
    unknown: {
      title: "Too open to check",
      text: "This browser couldn't settle it in time. Add clues; on publishing, the server tries for longer.",
    },
  };
  const verdict = $derived(VERDICTS[status]);

  // Publishing (FR-27).
  let publishing = $state(false);
  let outcome = $state.raw<SubmitResult | null>(null);
  let copied = $state(false);
  const canPublish = $derived(status === "unique" || status === "unknown");

  async function publish() {
    publishing = true;
    outcome = null;
    copied = false;
    const sent = draft;
    let r = await submissions.submit(puzzle);
    if (r.ok && r.submission.status === "pending") r = await submissions.waitFor(r.submission.id);
    // An edit while waiting clears the card; the account page still lists the submission.
    if (draft === sent) outcome = r;
    publishing = false;
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      copied = false;
    }
  }

  function update(next: Draft) {
    if (next === draft) return;
    draft = next;
    outcome = null;
  }

  // Sizes apply on change (Enter, leaving the field, the spinner), not on every keystroke: typing
  // "12" must not pass through 1, which would drop every column but the first.
  function setSize(w: string, h: string) {
    const width = parseSize(w);
    const height = parseSize(h);
    if (width === null || height === null) return;
    if (width !== draft.width || height !== draft.height) zoomed = null;
    update(resizeDraft(draft, width, height));
  }

  function pick(value: Brush) {
    brush = brush === value ? null : value;
  }

  // Every change is checked and saved on this device.
  $effect(() => {
    const p = puzzle;
    if (!ready) return;
    result = null;
    checker?.check(p);
    saveDraft(browserStorage(), draft);
  });

  // Board sizing: the board fits its column's width, and zooms when cells would be too small.
  let stageWidth = $state(0);
  let windowHeight = $state(0);
  let coarse = $state(false);
  const FRAME = 4;
  const minCell = $derived(coarse ? TOUCH_MIN_CELL : POINTER_MIN_CELL);
  const roomWidth = $derived(stageWidth - FRAME);
  const roomHeight = $derived(Math.max(5 * minCell, windowHeight - 160));
  let zoomed: View | null = $state.raw(null);
  const frame = $derived.by(() => {
    if (stageWidth <= 0) return null;
    const fitted = fitLayout(grid.width, grid.height, roomWidth, roomHeight, minCell, MAX_CELL);
    if (fitted.cell >= minCell) {
      return {
        layout: fitted,
        view: { cell: fitted.cell, x: 0, y: 0 },
        port: { width: fitted.width, height: fitted.height },
        zoom: null,
      };
    }
    const port = {
      width: roomWidth,
      height: Math.min(roomHeight, viewLayout(grid, minCell).height),
    };
    const zoom = zoomLimits(grid, port);
    const view = clampView(grid, zoomed ?? { cell: minCell, x: 0, y: 0 }, port, zoom);
    return { layout: viewLayout(grid, view.cell), view, port, zoom };
  });

  onMount(() => {
    coarse = matchMedia("(pointer: coarse)").matches;
    const saved = loadDraft(browserStorage());
    if (saved !== null) {
      draft = saved;
      widthText = String(saved.width);
      heightText = String(saved.height);
    }
    checker = new LiveChecker({
      createWorker: () =>
        new Worker(new URL("../editor/verify.worker.ts", import.meta.url), { type: "module" }),
      onresult: (r) => {
        result = r;
      },
    });
    ready = true;
    return () => checker?.dispose();
  });
</script>

<svelte:window bind:innerHeight={windowHeight} />

<main class="editor">
  <div class="heading">
    <h1>New puzzle</h1>
    <span class="lede">作問 · place clues; the verifier checks every change</span>
  </div>

  <div class="columns">
    <aside class="tools">
      <section class="card" aria-labelledby="size-h">
        <h2 id="size-h">Grid size</h2>
        <div class="size">
          <label>
            Width
            <input
              type="number"
              min="1"
              max="100"
              inputmode="numeric"
              bind:value={widthText}
              onchange={() => setSize(widthText, heightText)}
              onblur={() => (widthText = String(draft.width))}
            />
          </label>
          <span class="times" aria-hidden="true">×</span>
          <label>
            Height
            <input
              type="number"
              min="1"
              max="100"
              inputmode="numeric"
              bind:value={heightText}
              onchange={() => setSize(widthText, heightText)}
              onblur={() => (heightText = String(draft.height))}
            />
          </label>
        </div>
        <span class="note">Up to 100 per side.</span>
      </section>

      <section class="card" aria-labelledby="clue-h">
        <h2 id="clue-h">Clue</h2>
        <fieldset class="palette">
          <legend class="visually-hidden">Clue to place</legend>
          {#each [0, 1, 2, 3] as const as n (n)}
            <button type="button" aria-pressed={brush === n} onclick={() => pick(n)}>{n}</button>
          {/each}
          <button type="button" aria-label="Erase clue" aria-pressed={brush === "erase"} onclick={() => pick("erase")}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20H9L4 15l10-10 7 7-6 6" /></svg>
          </button>
        </fieldset>
        <span class="note">
          Tap a cell to cycle 0–3, or pick a clue to place it. On a keyboard, move with the arrows
          and type 0–3; Backspace erases.
        </span>
      </section>

      <button type="button" class="outline" disabled={clueCount(draft) === 0} onclick={() => update(clearClues(draft))}>
        Clear all clues
      </button>
    </aside>

    <section class="grid-col" aria-label="Puzzle grid">
      <div class="stage" bind:clientWidth={stageWidth}>
        {#if frame}
          <div class="frame" style:width="{frame.port.width + FRAME}px" style:height="{frame.port.height + FRAME}px">
            {#key `${grid.width}x${grid.height}`}
              <EditorBoard
                {puzzle}
                {highlight}
                layout={frame.layout}
                view={frame.view}
                port={frame.port}
                zoom={frame.zoom}
                ontap={(cell) => update(editCell(draft, cell, brushEdit(brush)))}
                onkey={(cell, edit) => update(editCell(draft, cell, edit))}
                onview={(v) => (zoomed = v)}
              />
            {/key}
          </div>
        {/if}
      </div>
      <span class="caption">
        {clueCount(draft)} clues · {draft.width}×{draft.height} · draft saved on this device
        {#if frame?.zoom}· pinch or use +/− to zoom{/if}
      </span>
    </section>

    <aside class="side">
      <section class="card verifier" aria-labelledby="verdict-h">
        <div class="verifier-head">
          <h2 id="verdict-h">Verifier</h2>
          <span class="live"><span class="live-dot" class:busy={status === "checking"} aria-hidden="true"></span>live</span>
        </div>
        <ol class="statuses" aria-label="Possible results">
          {#each ["unique", "multiple", "none", "unknown"] as const as s (s)}
            <li class={s} aria-current={status === s ? "true" : undefined}>
              {#if status === s}<span class="pip" aria-hidden="true">●</span>{/if}{s}
            </li>
          {/each}
        </ol>
        <div class="verdict" role="status">
          <span class="verdict-title">{verdict.title}</span>
          <span class="verdict-text">{verdict.text}</span>
        </div>
        {#if answers}
          <div class="answers">
            <AnswerFigure {grid} edges={answers[0]} highlight={suggestion?.cell ?? null} name="Answer A" />
            <AnswerFigure {grid} edges={answers[1]} highlight={suggestion?.cell ?? null} name="Answer B" />
          </div>
          <p class="suggestion">
            {#if suggestion}
              <b>Suggestion:</b> a <b>{suggestion.clue}</b> in the highlighted cell rules out Answer B.
            {:else}
              <b>Suggestion:</b> no single new clue tells these apart; change one of your clues.
            {/if}
          </p>
        {/if}

        {#if $auth.status !== "user"}
          <a class="publish link" href="/login">Log in to publish</a>
        {:else if !$auth.user.emailVerified}
          <a class="publish link" href="/account">Confirm your email to publish</a>
        {:else}
          <button type="button" class="publish" disabled={!canPublish || publishing} onclick={publish}>
            {#if publishing}
              Checking on the server…
            {:else if status === "none" || status === "multiple"}
              Publish — needs a unique answer
            {:else if status === "unknown"}
              Publish — the server checks for longer
            {:else}
              Publish
            {/if}
          </button>
        {/if}

        {#if outcome}
          {#if !outcome.ok}
            <p class="result error" role="alert">{outcome.message}</p>
          {:else if outcome.submission.verdict}
            {@const words = verdictText(outcome.submission.verdict)}
            {@const id = outcome.submission.puzzleId}
            <div class="result" class:error={id === null} role="status">
              <b>{words.title}</b>
              <span>{words.text}</span>
              {#if id !== null}
                {@const url = shareUrl(location.origin, id)}
                <input class="share" readonly value={url} aria-label="Link to share" onfocus={(e) => e.currentTarget.select()} />
                <div class="result-actions">
                  <button type="button" class="outline small" onclick={() => copy(url)}>{copied ? "Copied" : "Copy link"}</button>
                  <a class="outline small" href="/play/{id}">Play it</a>
                </div>
              {/if}
            </div>
          {/if}
        {/if}
      </section>
      <p class="aside-note">
        Unique puzzles publish straight away. “Unknown” means the verifier ran out of time proving it;
        try a smaller grid or more clues.
      </p>
    </aside>
  </div>
</main>

<style>
  .editor {
    max-width: 1280px;
    margin: 0 auto;
    padding: 20px 16px calc(32px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .heading {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px 16px;
  }

  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 28px;
  }

  .lede {
    font-size: 15px;
    font-weight: 500;
    color: var(--ink-soft);
  }

  .columns {
    display: flex;
    flex-wrap: wrap;
    gap: 20px 28px;
    align-items: flex-start;
  }

  .tools {
    flex: 1 1 220px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .grid-col {
    flex: 999 1 488px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .side {
    flex: 1 1 320px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .card {
    background: var(--sheet);
    border: 2px solid var(--ink);
    border-radius: 6px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  h2 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 18px;
  }

  .size {
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }

  .size label {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    font-weight: 700;
    color: var(--ink-soft);
  }

  .size input {
    height: 44px;
    width: 100%;
    border: 2px solid var(--ink);
    border-radius: 6px;
    background: var(--sheet);
    padding: 0 10px;
    font: inherit;
    font-size: 17px;
    font-weight: 700;
    color: var(--ink);
  }

  .times {
    height: 44px;
    display: flex;
    align-items: center;
    font-weight: 700;
  }

  .note,
  .caption,
  .aside-note {
    font-size: 13px;
    line-height: 1.5;
    color: var(--ink-soft);
  }

  .caption {
    font-size: 14px;
  }

  .aside-note {
    margin: 0;
  }

  .palette {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px;
  }

  .palette button {
    height: 48px;
    border-radius: 6px;
    border: 2px solid var(--hairline);
    background: var(--sheet);
    color: var(--ink);
    font-size: 22px;
    font-weight: 500;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
  }

  .palette button[aria-pressed="true"] {
    border-color: var(--ink);
    background: var(--ink);
    color: var(--on-ink);
  }

  .outline {
    height: 48px;
    padding: 0 20px;
    border-radius: 999px;
    border: 2px solid var(--ink);
    background: transparent;
    color: var(--ink);
    font-size: 15px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .outline:disabled {
    color: var(--disabled);
    border-color: var(--hairline);
    cursor: default;
  }

  .outline.small {
    height: 40px;
    padding: 0 16px;
    font-size: 14px;
  }

  .stage {
    width: 100%;
  }

  .frame {
    position: relative;
    background: var(--sheet);
    border: 2px solid var(--ink);
    box-shadow: 4px 4px 0 var(--frame-shadow);
  }

  .verifier {
    padding: 18px;
    gap: 14px;
  }

  .verifier-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .live {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--ink-soft);
  }

  .live-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ai);
  }

  .live-dot.busy {
    animation: pulse 1s ease-in-out infinite alternate;
  }

  @keyframes pulse {
    to {
      opacity: 0.25;
    }
  }

  .statuses {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }

  .statuses li {
    text-align: center;
    padding: 8px 2px;
    border-radius: 6px;
    border: 2px solid var(--hairline);
    font-size: 13px;
    font-weight: 700;
    color: var(--ink-soft);
  }

  .pip {
    display: block;
    font-size: 10px;
    line-height: 1.2;
  }

  /* The current result: shu for the ones that block publishing, ai for the others. */
  .statuses li[aria-current="true"] {
    border-color: var(--shu);
    background: color-mix(in srgb, var(--shu) 8%, transparent);
    color: var(--shu);
  }

  .statuses li.unique[aria-current="true"],
  .statuses li.unknown[aria-current="true"] {
    border-color: var(--ai);
    background: var(--ai-wash);
    color: var(--ai);
  }

  .verdict {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .verdict-title {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 22px;
  }

  .verdict-text {
    font-size: 15px;
    line-height: 1.5;
    color: var(--ink-soft);
  }

  .answers {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .suggestion {
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
    padding: 10px 12px;
    border-radius: 6px;
    background: var(--ai-wash);
  }

  .suggestion b:first-child {
    color: var(--ai);
  }

  .publish {
    height: 52px;
    border-radius: 999px;
    border: 0;
    background: var(--ink);
    color: var(--on-ink);
    font-size: 16px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .publish:disabled {
    background: var(--hairline);
    color: var(--ink-soft);
    cursor: default;
  }

  .publish.link:hover {
    color: var(--on-ink);
  }

  .result {
    margin: 0;
    padding: 12px 14px;
    border: 2px solid var(--ink);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 15px;
    line-height: 1.45;
  }

  .result.error {
    border-color: var(--shu);
  }

  .share {
    height: 40px;
    padding: 0 10px;
    border: 2px solid var(--hairline);
    border-radius: 6px;
    background: var(--ground);
    color: var(--ink);
    font: inherit;
    font-size: 14px;
  }

  .result-actions {
    display: flex;
    gap: 8px;
  }

  /* Phones: the grid first, then the verifier, then the size and clue tools. */
  @media (max-width: 899px) {
    .grid-col {
      order: -2;
    }

    .side {
      order: -1;
    }
  }

  @media (min-width: 900px) {
    .editor {
      padding: 28px 24px 40px;
      gap: 20px;
    }

    h1 {
      font-size: 34px;
    }

    .lede {
      font-size: 16px;
    }

    .tools {
      max-width: 260px;
    }

    .side {
      max-width: 380px;
    }

    .frame {
      box-shadow: 6px 6px 0 var(--frame-shadow);
    }
  }
</style>
````

#### Create `apps/web/src/routes/create/+page.svelte`

````svelte
<script lang="ts">
  import EditorScreen from "$lib/components/EditorScreen.svelte";
  import SiteHeader from "$lib/components/SiteHeader.svelte";
</script>

<svelte:head>
  <title>New puzzle · Loophole</title>
</svelte:head>

<SiteHeader />
<EditorScreen />
````

#### Edit `apps/web/src/lib/components/SiteHeader.svelte` (3 edits)


1. Replace

````svelte
<script lang="ts">
  import AccountLink from "./AccountLink.svelte";
````

   with

````svelte
<script lang="ts">
  import { page } from "$app/state";
  import AccountLink from "./AccountLink.svelte";
````


2. Replace

````svelte
  <div class="top-inner">
    <a class="brand" href="/">
      <svg width="24" height="30" viewBox="0 0 196 252" aria-hidden="true">
        <polyline points="14,14 182,14 182,126 126,126 126,238 70,238 70,126 14,126" fill="none" stroke="currentColor" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" />
        <line x1="14" y1="126" x2="14" y2="14" stroke="var(--shu)" stroke-width="24" stroke-linecap="round" />
      </svg>
      <span>Loophole</span>
    </a>
    <nav class="nav">
````

   with

````svelte
  <div class="top-inner">
    <div class="start">
      <a class="brand" href="/">
        <svg width="24" height="30" viewBox="0 0 196 252" aria-hidden="true">
          <polyline points="14,14 182,14 182,126 126,126 126,238 70,238 70,126 14,126" fill="none" stroke="currentColor" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" />
          <line x1="14" y1="126" x2="14" y2="14" stroke="var(--shu)" stroke-width="24" stroke-linecap="round" />
        </svg>
        <span>Loophole</span>
      </a>
      <nav class="main" aria-label="Main">
        <a href="/create" aria-current={page.url.pathname === "/create" ? "page" : undefined}>Create</a>
      </nav>
    </div>
    <nav class="nav">
````


3. Replace

````svelte

  .nav {
````

   with

````svelte

  .start {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  /* Main navigation (Editor artboard): the current page is underlined in shu. */
  .main a {
    height: 44px;
    padding: 0 6px;
    display: inline-flex;
    align-items: center;
    font-size: 15px;
    font-weight: 700;
    color: var(--ink-soft);
    border-bottom: 3px solid transparent;
  }

  .main a[aria-current="page"] {
    color: var(--ink);
    border-bottom-color: var(--shu);
  }

  .nav {
````


Run:

```sh
bun run format && bun run check          # about 583 pass, 0 fail (svelte-check: 0 errors, 0 warnings)
bun run --cwd apps/web build
ls apps/web/build/_app/immutable/workers/   # one verify.worker-*.js file
```

Optional look: `bun run --cwd apps/web preview --port 4173` and open http://localhost:4173/create.

Commit: `git add -A && git commit -m "feat(web): puzzle editor with live verifier and publishing"`


### Step 8 — Share and report on the play page, the admin page, your puzzles

Below the play screen of a server puzzle (`entry.origin` set), a footer with "Copy link" and "Report this puzzle" (a reason form for logged-in players, a log-in link for guests). `PlayScreen` itself is not changed. `/admin` lists reported puzzles for admins with Unpublish and Dismiss. The account page lists the player's puzzles and their verdicts, links admins to `/admin`, and says that published puzzles stay when the account is deleted.

#### Create `apps/web/src/lib/components/PuzzleFooter.svelte`

````svelte
<script lang="ts">
  import { auth } from "../auth/index.ts";
  import { shareUrl } from "../editor/submit.ts";
  import { reports } from "../puzzles/index.ts";
  import type { PuzzleEntry } from "../puzzles/source.ts";

  interface Props {
    entry: PuzzleEntry;
  }

  let { entry }: Props = $props();

  let copied = $state(false);
  let reporting = $state(false);
  let reason = $state("");
  let busy = $state(false);
  let sent = $state(false);
  let error = $state("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl(location.origin, entry.id));
      copied = true;
    } catch {
      copied = false;
    }
  }

  async function send(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = "";
    const result = await reports.report(entry.id, reason);
    busy = false;
    if (result.ok) sent = true;
    else error = result.message;
  }
</script>

<!-- Below the play screen, for server puzzles only: share (FR-27) and report (FR-28). -->
<footer class="puzzle-footer">
  <div class="row">
    <span class="soft">{entry.origin === "submitted" ? "Made by a player" : "Generated"} · {entry.width}×{entry.height}</span>
    <button type="button" class="outline" onclick={copy}>{copied ? "Link copied" : "Copy link"}</button>
    {#if !reporting && !sent}
      <button type="button" class="text" onclick={() => (reporting = true)}>Report this puzzle</button>
    {/if}
  </div>
  {#if sent}
    <p class="done" role="status">Thanks. An admin will take a look.</p>
  {:else if reporting}
    {#if $auth.status === "user"}
      <form onsubmit={send}>
        <label>
          What's wrong with it?
          <textarea required maxlength="500" rows="3" bind:value={reason}></textarea>
        </label>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <div class="row">
          <button type="submit" class="outline" disabled={busy}>Send report</button>
          <button type="button" class="text" onclick={() => (reporting = false)}>Cancel</button>
        </div>
      </form>
    {:else}
      <p class="soft"><a href="/login">Log in</a> to report a puzzle.</p>
    {/if}
  {/if}
</footer>

<style>
  .puzzle-footer {
    max-width: 1280px;
    margin: 0 auto;
    padding: 16px 16px calc(24px + env(safe-area-inset-bottom));
    border-top: 2px solid var(--hairline);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
  }

  .soft {
    margin: 0;
    font-size: 14px;
    color: var(--ink-soft);
  }

  .soft a {
    color: var(--ai);
    font-weight: 700;
  }

  .outline {
    height: 44px;
    padding: 0 18px;
    border-radius: 999px;
    border: 2px solid var(--ink);
    background: transparent;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
  }

  .text {
    height: 44px;
    padding: 0 4px;
    border: 0;
    background: none;
    color: var(--ink-soft);
    font-size: 14px;
    font-weight: 700;
    text-decoration: underline;
    cursor: pointer;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 440px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-weight: 700;
  }

  textarea {
    padding: 10px 12px;
    border: 2px solid var(--ink);
    border-radius: 6px;
    background: var(--sheet);
    color: var(--ink);
    font: inherit;
    font-size: 16px;
  }

  .error,
  .done {
    margin: 0;
    padding: 10px 12px;
    border-left: 4px solid var(--shu);
    background: var(--sheet);
  }

  .done {
    border-left-color: var(--ai);
  }
</style>
````

#### Edit `apps/web/src/routes/play/[id]/+page.svelte` (2 edits)


1. Replace

````svelte
  import PlayScreen from "$lib/components/PlayScreen.svelte";
  import { puzzleTitle } from "$lib/puzzles/index.ts";
````

   with

````svelte
  import PlayScreen from "$lib/components/PlayScreen.svelte";
  import PuzzleFooter from "$lib/components/PuzzleFooter.svelte";
  import { puzzleTitle } from "$lib/puzzles/index.ts";
````


2. Replace

````svelte
  <PlayScreen entry={data.entry} />
{/key}
````

   with

````svelte
  <PlayScreen entry={data.entry} />
  {#if data.entry.origin !== undefined}
    <PuzzleFooter entry={data.entry} />
  {/if}
{/key}
````


#### Create `apps/web/src/routes/admin/+page.svelte`

````svelte
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
````

#### Edit `apps/web/src/routes/account/+page.svelte` (4 edits)


1. Replace

````svelte
  import SiteHeader from "$lib/components/SiteHeader.svelte";

````

   with

````svelte
  import SiteHeader from "$lib/components/SiteHeader.svelte";
  import { submissions } from "$lib/editor/index.ts";
  import { type Submission, verdictText } from "$lib/editor/submit.ts";

````


2. Replace

````svelte
  let busy = $state(false);

````

   with

````svelte
  let busy = $state(false);
  let mine: Submission[] | null = $state(null);

  // The player's submitted puzzles and their verdicts (PRD FR-27).
  $effect(() => {
    if ($auth.status === "user" && mine === null) {
      submissions.list().then((list) => {
        mine = list ?? [];
      });
    }
  });

````


3. Replace

````svelte
    {#if logOutError}<p class="error" role="alert">{logOutError}</p>{/if}

    <h2>Delete account</h2>
    <p>
      This removes your email, password and everything saved for your account, for good. Progress
      saved in this browser stays.
    </p>
````

   with

````svelte
    {#if logOutError}<p class="error" role="alert">{logOutError}</p>{/if}
    {#if user.isAdmin}<p><a href="/admin">Reported puzzles</a></p>{/if}

    <h2>Your puzzles</h2>
    {#if mine === null}
      <p role="status">Loading…</p>
    {:else if mine.length === 0}
      <p>None yet. <a href="/create">Make one</a>.</p>
    {:else}
      <ul class="mine">
        {#each mine as s (s.id)}
          <li>
            <b>{s.width}×{s.height}</b> ·
            {#if s.verdict === null}
              Checking…
            {:else}
              {verdictText(s.verdict).title}
              {#if s.puzzleId !== null}· <a href="/play/{s.puzzleId}">Play</a>{/if}
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <h2>Delete account</h2>
    <p>
      This removes your email, password and everything saved for your account, for good. Puzzles
      you published stay up for others to play, no longer linked to you. Progress saved in this
      browser stays.
    </p>
````


4. Replace

````svelte
</main>
````

   with

````svelte
</main>

<style>
  .mine {
    margin: 0 0 14px;
    padding-left: 20px;
    color: var(--ink-soft);
  }

  .mine b {
    color: var(--ink);
  }
</style>
````


Run:

```sh
bun run format && bun run check          # about 583 pass, 0 fail
bun run --cwd apps/web build
```

Commit: `git add -A && git commit -m "feat(web): share and report puzzles, admin reports page, your puzzles"`


### Step 9 — End-to-end tests

`tests/editor.e2e.ts` runs with the main `bun run test:e2e` (no server): `multiple` shows both answers and the suggestion and the missing clue makes it `unique`; typing "12" into Width keeps a clue in column 5 (sizes apply on change, not per keystroke); a 1×1 `0` is `none`; the header links to the editor; on both phone sizes taps cycle, keys place and erase, the draft survives a reload, there is no horizontal scroll, and a 60×60 grid zooms with 44 px cells and a canvas. The auth config now starts a worker next to the API on a shared temporary database file, and `tests/submit.auth-e2e.ts` publishes a freshly generated puzzle (a new seed each run, so retries and repeats are never `duplicate`) from the editor and opens its link. The Mailpit helpers move to `tests/mailpit.ts`.

#### Create `apps/web/tests/editor.e2e.ts`

````ts
import { expect, type Page, test } from "@playwright/test";
import { board, boardView, scrollsSideways } from "./board.ts";

// The Editor artboard's puzzle: a real puzzle with the 3 in row 6, column 5 taken out, which leaves
// two answers. Putting it back makes the answer unique.
const ARTBOARD = {
  v: 1,
  width: 7,
  height: 7,
  clues: "..2..1.3.222...1.1..3.....2.110..0.........0.3.0.",
};

/** Opens the editor with `draft` already saved on this device. */
async function openWith(page: Page, draft: object) {
  await page.addInitScript((text) => {
    if (!localStorage.getItem("loophole:editor-draft"))
      localStorage.setItem("loophole:editor-draft", text);
  }, JSON.stringify(draft));
  await page.goto("/create");
  await expect(board(page)).toBeVisible();
}

/** Page coordinates of the middle of cell (row, col), with the board scrolled into view. */
async function cellPoint(page: Page, row: number, col: number) {
  await board(page).scrollIntoViewIfNeeded();
  const v = await boardView(page);
  return {
    x: v.box.x + v.margin + (col + 0.5) * v.cell - v.x,
    y: v.box.y + v.margin + (row + 0.5) * v.cell - v.y,
  };
}

async function clickCell(page: Page, row: number, col: number) {
  const p = await cellPoint(page, row, col);
  await page.mouse.click(p.x, p.y);
}

function current(page: Page) {
  return page.getByRole("list", { name: "Possible results" }).locator("[aria-current=true]");
}

function clues(page: Page) {
  return page.locator("[role=application] text.clue");
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("multiple shows both answers and a suggestion; the missing clue makes it unique (FR-26)", async ({
    page,
  }) => {
    await openWith(page, ARTBOARD);
    await expect(current(page)).toHaveText(/multiple/);
    await expect(page.getByText("More than one answer")).toBeVisible();
    await expect(page.getByText("Answer A", { exact: true })).toBeVisible();
    await expect(page.getByText("Answer B", { exact: true })).toBeVisible();
    await expect(page.getByText(/in the highlighted cell rules out Answer B/)).toBeVisible();
    await expect(page.getByText("17 clues · 7×7")).toBeVisible();

    await page.getByRole("button", { name: "3", exact: true }).click();
    await clickCell(page, 5, 4);
    await expect(current(page)).toHaveText(/unique/);
    await expect(page.getByText("Exactly one answer")).toBeVisible();
    await expect(page.getByText("Answer A", { exact: true })).toHaveCount(0);
    // Guests are sent to log in before publishing (FR-27).
    await expect(page.getByRole("link", { name: "Log in to publish" })).toBeVisible();
  });

  test("typing a bigger size keeps the clues (FR-26)", async ({ page }) => {
    await openWith(page, { v: 1, width: 7, height: 7, clues: `....2..${".".repeat(42)}` });
    const width = page.getByLabel("Width");
    await width.click();
    await width.press("Control+a");
    await width.pressSequentially("12");
    await width.press("Tab");
    await expect(page.getByText("1 clues · 12×7")).toBeVisible();
    await expect(clues(page)).toHaveText(["2"]);
  });

  test("a clue no loop can satisfy shows none", async ({ page }) => {
    await openWith(page, { v: 1, width: 1, height: 1, clues: "." });
    await clickCell(page, 0, 0); // empty → 0: the only loop has four sides
    await expect(current(page)).toHaveText(/none/);
    await expect(page.getByText("No answer", { exact: true })).toBeVisible();
  });

  test("the header links to the editor", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Create" }).click();
    await expect(page).toHaveURL(/\/create$/);
    await expect(page.getByRole("heading", { name: "New puzzle" })).toBeVisible();
  });
});

for (const [width, height] of [
  [360, 560],
  [390, 664],
] as const) {
  test.describe(`phone ${width}×${height}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true, isMobile: true });

    test("taps cycle, keys place, and the draft survives a reload", async ({ page }) => {
      await openWith(page, { v: 1, width: 3, height: 2, clues: "......" });
      const p = await cellPoint(page, 0, 0);
      await page.touchscreen.tap(p.x, p.y);
      await page.touchscreen.tap(p.x, p.y);
      await expect(clues(page)).toHaveText(["1"]);
      await board(page).focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("3");
      await expect(clues(page)).toHaveText(["1", "3"]);
      await page.keyboard.press("Backspace");
      await expect(clues(page)).toHaveText(["1"]);
      await page.reload();
      await expect(clues(page)).toHaveText(["1"]);
      expect(await scrollsSideways(page)).toBe(false);
    });

    test("a large grid zooms instead of shrinking (FR-13)", async ({ page }) => {
      await openWith(page, { v: 1, width: 7, height: 7, clues: ".".repeat(49) });
      await page.getByLabel("Width").fill("60");
      await page.getByLabel("Height").fill("60");
      await page.getByLabel("Height").blur();
      await expect(page.getByText("0 clues · 60×60")).toBeVisible();
      await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
      await expect(page.locator("[role=application] canvas")).toBeVisible();
      expect((await boardView(page)).cell).toBeGreaterThanOrEqual(44);
      expect(await scrollsSideways(page)).toBe(false);
    });
  });
}
````

#### Create `apps/web/tests/mailpit.ts`

````ts
import { expect } from "@playwright/test";

const MAILPIT_API = "http://127.0.0.1:8025/api/v1";

/** Whether `url` answers at all within two seconds. */
export async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

/** Whether the auth end-to-end tests can run: Mailpit, and Cloudflare for the CAPTCHA check. */
export async function canSignUp(): Promise<boolean> {
  return (
    (await reachable(`${MAILPIT_API}/info`)) &&
    (await reachable("https://challenges.cloudflare.com/turnstile/v0/siteverify"))
  );
}

/** The path and fragment of the link in the newest mail to `to`, once it arrives. */
export async function mailedLink(to: string): Promise<string> {
  let link = "";
  await expect
    .poll(
      async () => {
        const res = await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:"${to}"`)}`);
        const { messages } = (await res.json()) as { messages: { ID: string }[] };
        if (messages.length === 0) return "";
        const message = (await (
          await fetch(`${MAILPIT_API}/message/${messages[0].ID}`)
        ).json()) as {
          Text: string;
        };
        link = message.Text.match(/http:\/\/localhost:4174(\/\S+#token=\S+)/)?.[1] ?? "";
        return link;
      },
      { timeout: 10_000 },
    )
    .not.toBe("");
  return link;
}
````

#### Edit `apps/web/tests/accounts.auth-e2e.ts` (2 edits)


1. Replace

````ts
import { expect, test } from "@playwright/test";

const MAILPIT_API = "http://127.0.0.1:8025/api/v1";

````

   with

````ts
import { expect, test } from "@playwright/test";
import { canSignUp, mailedLink } from "./mailpit.ts";

````


2. Replace

````ts

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

/** The path and fragment of the link in the newest mail to `to`, once it arrives. */
async function mailedLink(to: string): Promise<string> {
  let link = "";
  await expect
    .poll(
      async () => {
        const res = await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:"${to}"`)}`);
        const { messages } = (await res.json()) as { messages: { ID: string }[] };
        if (messages.length === 0) return "";
        const message = (await (
          await fetch(`${MAILPIT_API}/message/${messages[0].ID}`)
        ).json()) as {
          Text: string;
        };
        link = message.Text.match(/http:\/\/localhost:4174(\/\S+#token=\S+)/)?.[1] ?? "";
        return link;
      },
      { timeout: 10_000 },
    )
    .not.toBe("");
  return link;
}

test.beforeAll(async () => {
  // The API mails through Mailpit and checks the CAPTCHA token with Cloudflare (test keys).
  test.skip(
    !(await reachable(`${MAILPIT_API}/info`)) ||
      !(await reachable("https://challenges.cloudflare.com/turnstile/v0/siteverify")),
    "needs Mailpit (docker compose up -d) and access to challenges.cloudflare.com",
````

   with

````ts

test.beforeAll(async () => {
  // The API mails through Mailpit and checks the CAPTCHA token with Cloudflare (test keys).
  test.skip(
    !(await canSignUp()),
    "needs Mailpit (docker compose up -d) and access to challenges.cloudflare.com",
````


#### Create `apps/web/tests/submit.auth-e2e.ts`

````ts
import { generate, serializePuzzle } from "@loophole/core";
import { expect, test } from "@playwright/test";
import { canSignUp, mailedLink, reachable } from "./mailpit.ts";

test.beforeAll(async () => {
  // Publishing also needs the worker (started by the config) and Garage for the solution.
  test.skip(
    !(await canSignUp()) || !(await reachable("http://localhost:3903/health")),
    "needs Mailpit and Garage (docker compose up -d) and access to challenges.cloudflare.com",
  );
});

test("a confirmed player publishes a unique puzzle and opens its share link (FR-27)", async ({
  page,
}) => {
  // Sign up, confirm and log in through the API; the account test covers those pages.
  const email = `e2e-${crypto.randomUUID()}@loophole.test`;
  const password = "hunter22-e2e";
  const signUp = await page.request.post("/api/auth/signup", {
    data: { email, password, captchaToken: "XXXX.DUMMY.TOKEN.XXXX" },
  });
  expect(signUp.status()).toBe(204);
  const token = new URLSearchParams((await mailedLink(email)).split("#")[1]).get("token");
  expect((await page.request.post("/api/auth/verify-email", { data: { token } })).status()).toBe(
    204,
  );
  expect((await page.request.post("/api/auth/login", { data: { email, password } })).status()).toBe(
    200,
  );

  // A new unique puzzle every time, so a retry or a repeat isn't answered "Already published".
  const { clues } = serializePuzzle(
    generate({ width: 5, height: 5, seed: crypto.randomUUID() }).puzzle,
  );
  await page.addInitScript(
    (text) => {
      localStorage.setItem("loophole:editor-draft", text);
    },
    JSON.stringify({ v: 1, width: 5, height: 5, clues }),
  );
  await page.goto("/create");
  await expect(page.getByText("Exactly one answer")).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published", { exact: true })).toBeVisible({ timeout: 30_000 });

  const link = await page.getByLabel("Link to share").inputValue();
  expect(link).toMatch(/^http:\/\/localhost:4174\/play\/[0-9a-f-]{36}$/);
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Player-made · 5×5" })).toBeVisible();
  await expect(page.getByRole("application")).toBeVisible();

  await page.goto("/account");
  await expect(page.getByText("Published · Play")).toBeVisible();
});
````

#### Replace the whole of `apps/web/playwright.auth.config.ts` with

````ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// End-to-end tests of accounts and publishing against the real API, which also serves the built
// app (as in production), and the job worker. Needs Mailpit and, for publishing, Garage
// (`docker compose up -d`), and access to Cloudflare's Turnstile check; the tests skip themselves
// without them. Run with `bun run test:e2e:auth` from this package.

// A fresh database file for every run, shared by the API and the worker.
const env = {
  DATABASE_PATH: join(mkdtempSync(join(tmpdir(), "loophole-e2e-")), "e2e.sqlite"),
  PUBLIC_URL: "http://localhost:4174",
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
  // Garage's development bucket and key (scripts/garage-init.sh, .env.example).
  S3_ENDPOINT: "http://localhost:3900",
  S3_REGION: "garage",
  S3_BUCKET: "loophole-dev",
  S3_ACCESS_KEY_ID: "GK1a2b3c4d5e6f708192a3b4c5",
  S3_SECRET_ACCESS_KEY: "8b339f8231fe89196b07eb8766bf6f079805f64a9be09934697b94e0b1aa0a0b",
};

export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.auth-e2e.ts",
  reporter: "list",
  use: {
    baseURL: "http://localhost:4174",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      // From the repo root, like the other server scripts.
      command: "bun run build && cd ../.. && bun apps/server/src/api/main.ts",
      url: "http://localhost:4174/api/health",
      reuseExistingServer: false,
      env: { ...env, PORT: "4174", WEB_DIR: "apps/web/build" },
    },
    {
      command: "cd ../.. && bun apps/server/src/worker/main.ts",
      wait: { stdout: /polling for jobs/ },
      reuseExistingServer: false,
      env,
    },
  ],
});
````

Run:

```sh
bun run format && bun run check          # about 583 pass, 0 fail
bun run test:e2e                         # 65 passed (57 + 8 editor tests); no API needed
docker compose ps                        # Mailpit and Garage up for the next command
bun run test:e2e:auth                    # 2 passed (skipped, not failed, without Mailpit, Garage or Cloudflare)
bun run test:perf                        # 2 passed
```

Commit: `git add -A && git commit -m "test(web): editor end-to-end and publishing against the API and worker"`


### Step 10 — Docs

README (status, publishing in development, admin page, scripts), TESTING (the auth config with a worker, the checker's fakes, the editor e2e), the server and web AGENTS.md (one bullet each), and the DECISIONS entries for this worktree.

#### Edit `README.md` (4 edits)


1. Replace

````markdown

Early development. The repo has the build tooling, the local dev services, the design kit, the puzzle engine (the grid model, the wire format, rule checks for play, a brute-force solution counter for tests, a seeded random number generator, a rule-based solver that records each deduction for hints, a verifier that says whether a puzzle has one solution, none, several, or could not be decided in time, and a generator that makes a puzzle with exactly one solution from a seed) and a first web app. The web app plays a few built-in puzzles on phones and desktops: tap or drag to draw, keyboard play, undo and redo, a pausable timer, error highlighting, solve detection, light and dark themes, and progress saved in the browser. A Hint button (or H) shows the next forced deduction from the player's board, with the rule's name, a one-line explanation and its pattern drawn small, or points out a mark that doesn't fit; using one marks the attempt as assisted. Boards too big for the screen zoom and pan (pinch, wheel or the zoom buttons) with an overview map, and boards over 30×30 draw on a canvas. The server has its foundation: an HTTP API that serves puzzles, gives hints from each puzzle's stored solution and queues generation jobs, and a worker that generates puzzles in the background with progress and a time limit, keeping each solution in blob storage. The web app lists the server's puzzles after its built-in ones. Players can sign up with an email and password (behind a CAPTCHA, with email confirmation), log in and out, reset a forgotten password and delete their account; guests play exactly as before. Daily puzzles and the rest come in later phases; each phase's plan is in [`docs/plans/`](docs/plans/).

````

   with

````markdown

Early development. The repo has the build tooling, the local dev services, the design kit, the puzzle engine (the grid model, the wire format, rule checks for play, a brute-force solution counter for tests, a seeded random number generator, a rule-based solver that records each deduction for hints, a verifier that says whether a puzzle has one solution, none, several, or could not be decided in time, and a generator that makes a puzzle with exactly one solution from a seed) and a first web app. The web app plays a few built-in puzzles on phones and desktops: tap or drag to draw, keyboard play, undo and redo, a pausable timer, error highlighting, solve detection, light and dark themes, and progress saved in the browser. A Hint button (or H) shows the next forced deduction from the player's board, with the rule's name, a one-line explanation and its pattern drawn small, or points out a mark that doesn't fit; using one marks the attempt as assisted. Boards too big for the screen zoom and pan (pinch, wheel or the zoom buttons) with an overview map, and boards over 30×30 draw on a canvas. The server has its foundation: an HTTP API that serves puzzles, gives hints from each puzzle's stored solution and queues generation jobs, and a worker that generates puzzles in the background with progress and a time limit, keeping each solution in blob storage. The web app lists the server's puzzles after its built-in ones. Players can sign up with an email and password (behind a CAPTCHA, with email confirmation), log in and out, reset a forgotten password and delete their account; guests play exactly as before. Anyone can make a puzzle in the editor (Create), which says as they place clues whether it has one answer, none or several, and shows two answers side by side when there are several; players with a confirmed email publish it, the worker proves it has one solution before it goes up, and its link can be shared. Players can report a puzzle, and admins see the reports and can unpublish it. Daily puzzles and the rest come in later phases; each phase's plan is in [`docs/plans/`](docs/plans/).

````


2. Replace

````markdown

There is no admin UI. To make an account an admin (for unpublishing puzzles and the health view in later phases), run from the repo root:

````

   with

````markdown

To make an account an admin (for the reported puzzles page at `/admin` and, later, the health view), run from the repo root:

````


3. Replace

````markdown

`bun run test:e2e:auth` builds the web app, starts the API serving it on port 4174 with a fresh database, and goes through sign-up, the emailed link, login and logout in Chromium. It needs Mailpit running and access to challenges.cloudflare.com, and skips itself without them.

````

   with

````markdown

### Publishing puzzles in development

Run the API and the worker (Server above) and `bun run dev:web`, log in with a confirmed account and open http://localhost:5173/create. The editor checks the draft in the browser as you go and keeps it on this device. Publish sends it to the API, and the worker verifies it (within `VERIFY_TIMEOUT_MS`, 45 s by default) and publishes it if it has exactly one solution; the page waits for the verdict and then shows the link to share. Your account page lists your puzzles and their verdicts. Each account can submit 20 puzzles an hour.

`bun run test:e2e:auth` builds the web app, starts the API serving it on port 4174 and a worker, sharing a fresh database, and goes through sign-up, the emailed link, login and logout, then publishes a puzzle from the editor and opens its link, in Chromium. It needs Mailpit running and access to challenges.cloudflare.com, and skips itself without them; the publishing test also needs Garage.

````


4. Replace

````markdown
| `bun run test:perf` | Build the web app and run its frame-time checks |
| `bun run test:e2e:auth` | Build the web app, serve it from the API and run the account end-to-end test (needs Mailpit) |
| `bun run admin <email>` | Make an account an admin; `--revoke` takes it away |
````

   with

````markdown
| `bun run test:perf` | Build the web app and run its frame-time checks |
| `bun run test:e2e:auth` | Build the web app, serve it from the API with a worker and run the account and publishing end-to-end tests (needs Mailpit; publishing also Garage) |
| `bun run admin <email>` | Make an account an admin; `--revoke` takes it away |
````


#### Edit `docs/TESTING.md` (1 edit)


1. Replace

````markdown

The account end-to-end test (`tests/accounts.auth-e2e.ts`) has its own config, `playwright.auth.config.ts`: it builds the app and starts the real API serving it on port 4174, with a fresh database, Mailpit for mail and Turnstile's test keys. It replaces Cloudflare's widget script with a stub and reads the confirmation link from Mailpit's API. Run it with `bun run test:e2e:auth`; it skips itself when Mailpit or challenges.cloudflare.com can't be reached.

````

   with

````markdown

The account and publishing end-to-end tests (`tests/*.auth-e2e.ts`) have their own config, `playwright.auth.config.ts`: it builds the app and starts the real API serving it on port 4174 and a worker, sharing a fresh database file in the temp folder, with Mailpit for mail, Garage for solutions and Turnstile's test keys. The account test replaces Cloudflare's widget script with a stub and reads the confirmation link from Mailpit's API; the publishing test signs up through the API, publishes a puzzle from the editor and opens its link. Run them with `bun run test:e2e:auth`; they skip themselves when Mailpit or challenges.cloudflare.com can't be reached, and the publishing test also when Garage can't.

The editor's live check runs in a Web Worker; its logic (`lib/editor/checker.ts`) takes the worker and the timers as parameters, so its tests drive a fake worker and fake timers. `tests/editor.e2e.ts` covers the editor in Chromium with no server.

````


#### Edit `apps/server/AGENTS.md` (1 edit)


1. Replace

````markdown
- Routes that need a logged-in user call `currentUser(c, sessions)` from the session cookie module and answer 401 when it is null; routes for confirmed accounts only also check `emailVerifiedAt`. Every state-changing request under `/api` goes through the CSRF check, so list a 403 response on new POST, PUT and DELETE routes. A route without a request body isn't covered by the JSON-only rule, so it relies on that check and SameSite alone.
- A table that holds a user's data references `users(id) ON DELETE CASCADE`, so deleting the account deletes it (PRD NFR-6).
- In a schema, write "this registered schema or null" as `z.union([Schema, z.null()])`. `.nullable()` on a schema registered with `.openapi("Name")` makes the shared component itself nullable.
````

   with

````markdown
- Routes that need a logged-in user call `currentUser(c, sessions)` from the session cookie module and answer 401 when it is null; routes for confirmed accounts only also check `emailVerifiedAt`. Every state-changing request under `/api` goes through the CSRF check, so list a 403 response on new POST, PUT and DELETE routes. A route without a request body isn't covered by the JSON-only rule, so it relies on that check and SameSite alone.
- A table that holds a user's data references `users(id) ON DELETE CASCADE`, so deleting the account deletes it (PRD NFR-6). Published puzzles are the exception: their `creator_id` is set to null instead.
- A player's submission is checked by a `verify` job that carries the submission's id; the worker hands the outcome to the submission manager, which publishes a unique puzzle or records the verdict. Unpublishing only changes a puzzle's status: it leaves every list and answers 404, except to admins.
- In a schema, write "this registered schema or null" as `z.union([Schema, z.null()])`. `.nullable()` on a schema registered with `.openapi("Name")` makes the shared component itself nullable.
````


#### Edit `apps/web/AGENTS.md` (1 edit)


1. Replace

````markdown
- End-to-end tests end in `.e2e.ts` and run with `bun run test:e2e`. They need a local Chromium and are not part of `bun run check`. Frame-time checks are tagged `@perf` and run with `bun run test:perf` instead. The account test ends in `.auth-e2e.ts` and runs against the real API with its own config (`bun run test:e2e:auth`).
- The large fixtures are generated by a script; change the script and regenerate them rather than editing them by hand.
````

   with

````markdown
- End-to-end tests end in `.e2e.ts` and run with `bun run test:e2e`. They need a local Chromium and are not part of `bun run check`. Frame-time checks are tagged `@perf` and run with `bun run test:perf` instead. The account test ends in `.auth-e2e.ts` and runs against the real API with its own config (`bun run test:e2e:auth`).
- The puzzle editor's logic (draft, keys, live check, submitting) lives in plain, tested modules under `lib/editor`; its components stay thin, and its board reuses the play board's renderers.
- The large fixtures are generated by a script; change the script and regenerate them rather than editing them by hand.
````


#### Append to the end of `docs/DECISIONS.md`

Add this text after the file's last line (it starts with a blank line):

````markdown

## 2026-10-25 · WT10 `submissions` · How a submission is verified and published
- **Question:** How does a submitted puzzle get from the editor to published or rejected (PRD FR-27), and what does the creator see?
- **Decision:** `POST /api/submissions` (`{width, height, clues}`, confirmed accounts only) stores a row in a new `submissions` table (`pending`, with the creator, the clues and the job id) and queues a `verify` job whose input carries the submission id. The worker runs `verify` with its default 30 s budget in a thread under the 45 s `VERIFY_TIMEOUT_MS` and hands the outcome to `SubmissionManager.complete`: `unique` stores the solution and the solver's steps as blobs and publishes the puzzle under the submission's id with origin `submitted` and the creator; `none`, `multiple` and `unknown` reject it with that verdict. A job that times out, fails, is abandoned by crashed workers, or finishes without finding its submission (a worker that claimed it in the moment before `submit` stored the row) leaves the submission pending, and the next read rejects it (`unknown` for a timeout, `error` otherwise), so every way a job can end is covered in one place. The client polls `GET /api/submissions/{id}` (the creator's own only, 404 for anyone else) every second until it is decided; `GET /api/submissions` lists the creator's submissions, newest first, on the account page. The submission answer carries the verdict, never a solution, and the published puzzle is served with clues only, like any other (FR-25).
- **Reason:** A table of its own keeps the verdict for the creator after the job row is gone or reused, and lets the account delete its submissions with it. Polling the submission rather than the job gives the client the one thing it needs (the verdict and the puzzle id) in one call. Settling on read needs no change to the stale-job sweep.

## 2026-10-25 · WT10 `submissions` · Verification budget for submissions and the trace
- **Question:** What time limits apply to checking a submission, in the worker and in the editor, and where does a submitted puzzle's solver trace come from?
- **Decision:** In the worker: `verify` with its default 30 s budget (NFR-1), then, for a `unique` puzzle, `solve` from an empty board with `timeLimitMs: 5000` (`TRACE_TIME_LIMIT_MS`) for the trace; 30 + 5 s stays inside the 45 s hard limit. A puzzle the rules can't finish gets the steps up to where they got stuck. Hints for submitted puzzles come from `POST /api/puzzles/{id}/hint` like any server puzzle, which already caps the search at 500 ms (the `[WT10]` follow-up). In the editor: the same `verify` in a Web Worker with a 3 s budget (`CHECK_TIME_LIMIT_MS`), 250 ms after the last edit; the thread is stopped if it overruns by 2 s, and a newer edit stops a check still running. `unknown` in the editor still allows publishing, because the server tries ten times longer; `none` and `multiple` don't.
- **Reason:** The trace is only for hints, so it may be partial, and a wall-clock limit there doesn't touch the determinism rule (that is for generation). A 3 s check keeps the editor responsive on phones; an empty 100×100 grid takes about 1.8 s to come back `multiple` in Bun on the dev host. PRD §10's metric (the fraction rejected as `unknown`) can be read from the `submissions` table.

## 2026-10-25 · WT10 `submissions` · One published puzzle per clue grid
- **Question:** What happens when someone submits clues that are already stored?
- **Decision:** Two puzzles are the same when their width, height and clue string are equal (indexed as `puzzles_by_clues`). On submit, and again just before the worker publishes, the submission manager looks for any stored puzzle with the same clues, generated or submitted. A published one decides the submission at once as `duplicate`, pointing at that puzzle (no job is queued); an unpublished one rejects it as `removed`. Otherwise it goes to the verifier. The second check closes the gap between two identical submissions waiting at once; two workers deciding both in the same few milliseconds could still publish two copies, which is harmless and not guarded further.
- **Reason:** The exact clue string is already a canonical form, so no hash is needed. Matching every origin stops a copy of a generated puzzle (later, a ranked daily) from being republished as a practice puzzle with its own hints, and matching unpublished ones stops a removed puzzle from coming back by being submitted again. A unique index can't be used, because two generated tiny grids may legitimately share clues.

## 2026-10-25 · WT10 `submissions` · Submission limits
- **Question:** PRD §4 and the build plan's defaults say no submission rate limits. Should submissions and reports be limited anyway?
- **Decision:** 20 submissions per account per hour and 20 reports per account per hour, counted in the managers through the existing `RateLimiter` (429 with `Retry-After`), on top of the job queue's cap of 100 waiting jobs (503). Sizes stay 1 to 100 per side; request bodies are already capped at 64 KiB.
- **Reason:** This deliberately overrides the build plan's default. One submission can hold a worker for up to 45 s and the 100-job queue is shared with generation, so one account must not be able to fill it; NFR-4 asks for rate limits on the endpoints abuse would aim at. The limiter already exists, and 20 an hour is far above what a person making puzzles needs.

## 2026-10-25 · WT10 `submissions` · Share links use the puzzle id
- **Question:** Should published puzzles get short share ids?
- **Decision:** No. The share link is `PUBLIC_URL/play/<id>`, the same page every server puzzle opens on; a submitted puzzle's id is its submission's UUID. The editor shows the link with Copy and Play buttons once the puzzle is published, and the play page of a server puzzle has Copy link and Report below the board.
- **Reason:** The links are pasted, not typed, so their length doesn't matter, and a second id space would need a column, collision handling and a lookup route. A short alias can be added later without changing these links.

## 2026-10-25 · WT10 `submissions` · Reports and unpublishing
- **Question:** Who can report a puzzle, what do admins see, and what does unpublishing do (FR-28)?
- **Decision:** Any logged-in player, confirmed or not, can report a published puzzle with a reason of 1 to 500 characters (`POST /api/puzzles/{id}/report`); one report per player and puzzle, a new one replacing the reason. Admins (`is_admin`) get `GET /api/admin/reports`: published puzzles with reports, the most recently reported first, with the count and the five newest reasons (reporters are not shown), read from the newest 500 reports. They can unpublish (`POST /api/admin/puzzles/{id}/unpublish`), which sets the puzzle's status to `unpublished`: it leaves every list, `GET /api/puzzles/{id}` and its hints answer 404 to everyone else, and an admin can still open it; or dismiss (`DELETE /api/admin/puzzles/{id}/reports`), which deletes its reports and keeps it published. There is no republish. The web app has a minimal `/admin` page, linked from the account page for admins.
- **Reason:** Reports don't change anything by themselves, so letting unconfirmed accounts send them costs nothing, and the per-account limit bounds spam. Keeping the row on unpublish keeps the clue grid known, so the same puzzle can't be submitted again (it is rejected as `removed`), and keeps links in other players' saved progress from pointing at nothing.

## 2026-10-25 · WT10 `submissions` · Submitted puzzles outlive their creator's account
- **Question:** When an account is deleted, what happens to the puzzles it published, its submissions and its reports (NFR-6)?
- **Decision:** Published puzzles stay published and their `creator_id` is set to null (`ON DELETE SET NULL`), as WT7 planned. The account's `submissions` rows (including rejected ones) and its `reports` go with it (`ON DELETE CASCADE`). The account page says so before deleting. A submission still being checked when its account is deleted is dropped: the worker finds no submission and publishes nothing.
- **Reason:** NFR-6 limits what is stored about a person to the email, the password hash and gameplay data, and asks for deletion. Once the link is gone, a published puzzle is only a clue grid with no personal data, and other players may be playing it or have it in their progress; deleting it would break their links. The creator's drafts and verdicts are their own gameplay data and go.

## 2026-10-25 · WT10 `submissions` · The editor
- **Question:** How does the editor work (FR-26), where the Editor artboard leaves details open?
- **Decision:** `/create`, linked as Create in the site header. Size fields take 1 to 100 per side; a new size keeps the clues of the part both sizes share. A tap on a cell cycles empty → 0 → 1 → 2 → 3 → empty; picking a clue in the palette (or the eraser) makes taps place it instead, and picking it again goes back to cycling. On a keyboard the arrows move a cell cursor, 0–3 place a clue, Backspace, Delete or `.` erase, Space or Enter cycle. One draft is kept in `localStorage` (`loophole:editor-draft`, in the wire format) after every change. The verifier card shows the four results; for `multiple` it draws both answers small and suggests a clue: the first empty cell, in reading order, whose side count differs between the two answers, with its count in answer A ("rules out Answer B"; it may still leave other answers), marked with a dashed ai box on the board and both answers, or says that no single new clue tells them apart. Guests see "Log in to publish", unconfirmed accounts "Confirm your email to publish". Boards whose cells would be too small zoom and pan like the play board; a one-finger drag pans instead of drawing. On phones the grid comes first, then the verifier, then the size and clue tools.
- **Reason:** Cycling matches FR-13's tap-to-cycle on the play board and needs no mode, while the palette gives the artboard's place-a-clue workflow for filling many cells with one value. The artboard's own suggestion ("leaves exactly one answer") would need another verification per candidate; one that is always true and costs nothing is enough to show where the answers differ. Putting the grid first on phones keeps the board and its verdict on screen while editing.

## 2026-10-25 · WT10 `submissions` · Publishing end-to-end test with a worker
- **Question:** How is publishing tested in a browser, when it needs the worker and blob storage?
- **Decision:** `playwright.auth.config.ts` starts a worker next to the API, both on a fresh SQLite file in the temp folder (an in-memory database can't be shared between processes), with Garage's development bucket and key. `tests/submit.auth-e2e.ts` signs up, confirms and logs in through the API, publishes a unique puzzle from the editor and opens its share link; it skips itself without Mailpit, Cloudflare or Garage. The account test is unchanged apart from sharing its Mailpit helpers. A puzzle with several answers can't be published from the editor, so rejection is covered by the server's route and worker tests, and by the plan's live run with `curl`.
- **Reason:** It runs the whole path a creator takes, with the real worker thread, blob store and cookies, while `bun run test:e2e` stays offline.
````

Run:

```sh
bun run format && bun run check          # about 583 pass, 0 fail
```

Commit: `git add -A && git commit -m "docs: submissions in README, TESTING, AGENTS and DECISIONS"`


### Step 11 — Live run with Garage (no commit)

Proves the whole path on real processes: a unique puzzle is published (solution in Garage, served without it, hints work), a puzzle with two answers is rejected as `multiple`, the same clues again come back as `duplicate`, and report → admin list → unpublish → 404 for everyone but admins. Needs Garage (`docker compose up -d`; `./scripts/garage-init.sh` once after a fresh start). The user is written straight into a throwaway database, so no mail or CAPTCHA is involved.

```sh
export PATH="$HOME/.bun/bin:$PATH"
LIVE=$(mktemp -d)
export PORT=4180 HOST=127.0.0.1 PUBLIC_URL=http://localhost:4180 DATABASE_PATH=$LIVE/live.sqlite
export S3_ENDPOINT=http://localhost:3900 S3_REGION=garage S3_BUCKET=loophole-dev
export S3_ACCESS_KEY_ID=GK1a2b3c4d5e6f708192a3b4c5
export S3_SECRET_ACCESS_KEY=8b339f8231fe89196b07eb8766bf6f079805f64a9be09934697b94e0b1aa0a0b
export SMTP_HOST=127.0.0.1 SMTP_PORT=1025
bun -e '
import { openDatabase } from "./apps/server/src/adapters/db/database.ts";
const db = openDatabase(process.env.DATABASE_PATH);
const hash = await Bun.password.hash("hunter22", { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 });
db.query("INSERT INTO users (id, email, password_hash, email_verified_at, is_admin, created_at) VALUES ($id, $e, $h, 1, 1, 1)")
  .run({ id: "u-live", e: "ann@example.com", h: hash });
db.close();'
bun apps/server/src/api/main.ts > $LIVE/api.log 2>&1 & API=$!
bun apps/server/src/worker/main.ts > $LIVE/worker.log 2>&1 & WORKER=$!
sleep 2
B=http://127.0.0.1:4180; J='-H content-type:application/json'; C="-b $LIVE/jar -c $LIVE/jar"
curl -s $C -X POST $B/api/auth/login $J -d '{"email":"ann@example.com","password":"hunter22"}' -o /dev/null -w "login %{http_code}\n"
ONE='..2..1.3.222...1.1..3.....2.110..0.....3...0.3.0.'   # the Editor artboard's puzzle: one answer
TWO='..2..1.3.222...1.1..3.....2.110..0.........0.3.0.'   # the same with one 3 removed: two answers
U=$(curl -s $C -X POST $B/api/submissions $J -d "{\"width\":7,\"height\":7,\"clues\":\"$ONE\"}" | sed 's/.*"id":"\([^"]*\)".*/\1/' | head -c 36)
M=$(curl -s $C -X POST $B/api/submissions $J -d "{\"width\":7,\"height\":7,\"clues\":\"$TWO\"}" | sed 's/.*"id":"\([^"]*\)".*/\1/' | head -c 36)
sleep 3
curl -s $C $B/api/submissions/$U; echo
curl -s $C $B/api/submissions/$M; echo
curl -s $B/api/puzzles/$U; echo
curl -s -X POST $B/api/puzzles/$U/hint $J -d "{\"edges\":\"$(printf '0%.0s' $(seq 112))\"}"; echo
curl -s $C -X POST $B/api/submissions $J -d "{\"width\":7,\"height\":7,\"clues\":\"$ONE\"}"; echo
curl -s $C -X POST $B/api/puzzles/$U/report $J -d '{"reason":"live test"}' -o /dev/null -w "report %{http_code}\n"
curl -s $C $B/api/admin/reports; echo
curl -s $C -X POST $B/api/admin/puzzles/$U/unpublish -o /dev/null -w "unpublish %{http_code}\n"
curl -s $B/api/puzzles/$U -o /dev/null -w "guest %{http_code}\n"
curl -s $C $B/api/puzzles/$U -o /dev/null -w "admin %{http_code}\n"
kill $API $WORKER
sleep 1
rm -rf "$LIVE"
```

Expected (ids and times differ):

```
login 200
{"id":"<U>","width":7,"height":7,"status":"published","verdict":"unique","puzzleId":"<U>",...}
{"id":"<M>","width":7,"height":7,"status":"rejected","verdict":"multiple","puzzleId":null,...}
{"id":"<U>","puzzle":{"v":1,"width":7,"height":7,"clues":"..2..1.3.222...1.1..3.....2.110..0.....3...0.3.0."},"origin":"submitted","createdAt":"..."}
{"kind":"step","rule":"clue-zero",...}
{"id":"...","width":7,"height":7,"status":"published","verdict":"duplicate","puzzleId":"<U>",...}
report 204
{"items":[{"puzzleId":"<U>","width":7,"height":7,"origin":"submitted",...,"count":1,"reports":[{"reason":"live test",...}]}]}
unpublish 204
guest 404
admin 200
```

The puzzle response has clues only (no solution, FR-25). If the first submission comes back `rejected` with verdict `error`, the worker couldn't write to Garage (its job's error is "an unexpected error has occurred"): start Compose, run `./scripts/garage-init.sh` and try again. That is also the `error` verdict working as intended. Then, optionally, with the API and worker running again on the same settings plus `WEB_DIR=apps/web/build` (after `bun run --cwd apps/web build`), log in at http://localhost:4180/login (ann@example.com / hunter22), open `/create`, publish the 5×5 `..0.......3.1.0.3.1......`, follow "Play it", report it from the footer, and see it on `/admin` (create the user again first: the script deletes its database at the end).

### Step 12 — Final check (no commit)

```sh
export PATH="$HOME/.bun/bin:$PATH"
bun run format          # no fixes
bun run check           # about 583 pass, 0 fail
bun run test:e2e        # 65 passed
bun run test:e2e:auth   # 2 passed with Mailpit, Garage and Cloudflare reachable
bun run test:perf       # 2 passed
git status --short      # clean
git log --oneline 452f304..HEAD   # the plan commit and the 10 step commits
```

## Acceptance criteria

| # | Criterion | PRD / rule | How it's checked |
|---|---|---|---|
| 1 | Editor sets the grid size (1–100 per side, keeping shared clues) and places/clears clues 0–3 by tap (cycle or palette) and keyboard | FR-26 | `draft.test.ts` (cycle, set, resize, parseSize, brushEdit, editCell), `keyboard.test.ts`, `editor.e2e.ts` "taps cycle, keys place…" on both phones and "typing a bigger size keeps the clues" (keys typed one by one) |
| 2 | Live feedback from the solver in a Web Worker with a time limit; the UI never blocks; a newer edit replaces a running check | FR-26, NFR-2 | `checker.test.ts` (debounce, worker reuse/replace, stale answers ignored, overrun → `unknown`, dispose); the worker chunk in the build (Step 7) |
| 3 | Statuses unique / none / multiple / unknown shown; `multiple` shows both answers and a suggestion | FR-4, FR-26, Editor artboard | `editor.e2e.ts` (multiple → answers A/B and suggestion → unique after the 3; 1×1 `0` → none); `answers.test.ts` (the suggested clue keeps A and rules out B; null when none exists); `checker.test.ts` (unknown) |
| 4 | Large grids use the zoomable board | FR-13, NFR-2 | `editor.e2e.ts` "a large grid zooms…" (zoom buttons, canvas, ≥ 44 px cells, no sideways scroll) |
| 5 | Drafts saved locally | FR-26 | `draft.test.ts` save/load; `editor.e2e.ts` reload keeps the clues |
| 6 | Submitting needs a login and a confirmed email; rate-limited | FR-27, NFR-4, DECISIONS "What unconfirmed accounts can do" | `submissions.test.ts` (401, 403 "Email not confirmed", 429 with `Retry-After`); `submission-manager.test.ts` (limit per account, window resets) |
| 7 | The worker verifies within the 30 s budget inside the 45 s hard limit; a timeout is `unknown` | FR-27, NFR-1 | `run-task.ts` uses `verify` with its default budget and `TRACE_TIME_LIMIT_MS` 5 s; `flow.test.ts` "a check stopped at the job's time limit is rejected as unknown"; `submission-manager.test.ts` settle: timeout → unknown, failed → error, done without a decision → error |
| 8 | `unique` is published at once: origin `submitted`, creator set, solution and trace in blobs | FR-27, G1, G5 | `submission-manager.test.ts` "a unique puzzle is published…"; `flow.test.ts` (real thread, served, solution read back); Step 11 |
| 9 | `none` / `multiple` / `unknown` are rejected with the verdict stored for the creator, with an explanation | FR-27 | `submission-manager.test.ts`; `flow.test.ts` (multiple, none); `submit.ts` `verdictText` (all seven verdicts, `submit.test.ts`); account page "Your puzzles"; Step 11 |
| 10 | Identical clue grids are published once | FR-27, DECISIONS "One published puzzle per clue grid" | `submission-manager.test.ts` (duplicate at submit, removed, duplicate while waiting); `submissions.test.ts` duplicate route; `puzzle-repository.test.ts` findByClues; Step 11 |
| 11 | A submitted puzzle's solution is never sent to clients | FR-25 | `flow.test.ts` asserts the puzzle response doesn't contain the solution string; the `Submission` DTO has no solution field (`submission-schemas.ts`); hints are server-side with a 500 ms cap |
| 12 | Share a published submission by link | FR-27 | `submit.test.ts` `shareUrl`; `submit.auth-e2e.ts` opens the link from the editor; PuzzleFooter "Copy link" |
| 13 | Any logged-in player reports a puzzle with a reason | FR-28 | `report-manager.test.ts`; `submissions.test.ts` "reports and unpublishing", "reporting needs a login, a reason…" (401, 400, 404, 429); `reports.test.ts` |
| 14 | Admins list reports, unpublish and dismiss; an unpublished puzzle leaves every list and is 404 to non-admins | FR-28 | `submissions.test.ts` (list, dismiss, unpublish, guest 404, player 404, admin 200, list empty; 401/403 for non-admins); `puzzle-manager.test.ts` unpublish; Step 11 |
| 15 | Account deletion keeps published submissions anonymised and deletes the account's submissions and reports | NFR-6 | `puzzle-repository.test.ts` "a submitted puzzle keeps its creator" (null after delete), `submission-repository.test.ts` and `report-repository.test.ts` cascade tests; DECISIONS "Submitted puzzles outlive…"; account page text |
| 16 | New state-changing routes are behind the CSRF check; inputs validated; SQL parameterised | NFR-4 | `submissions.test.ts` cross-site POST (403) for submit and unpublish; validation cases (short/long clues, bad characters, size 0 and 101, unknown field, blank/long reason); repositories use `db.query` with named parameters only |
| 17 | Layering: routes translate/validate, managers hold the logic over ports, adapters do I/O, composition roots wire | master plan | `api/submissions.ts` and `api/reports.ts` call only managers; managers import only `ports.ts`, `domain.ts`, core and other managers (Biome overrides pass in `bun run check`); manager tests use fakes; `SqliteSubmissionRepository`/`SqliteReportRepository` behind ports |
| 18 | OpenAPI contract and client regenerated | master plan | `bun run check:api` in the gate; six new path entries (Step 3) |
| 19 | The main `test:e2e` stays green with no API | — | Step 9: 65 passed against `vite preview` (no proxy) |
| 20 | No horizontal scroll at 360 px; keyboard editing | NFR-2, NFR-5 | `editor.e2e.ts` on 360×560 and 390×664; keys test |
| 21 | Hints on submitted puzzles are time-limited | `[WT10]` follow-up | `HintManager` (WT8) passes 500 ms for every published puzzle; Step 11 hint answer; trace solve capped at 5 s |
| 22 | PlayScreen unchanged; board rendering reused | scope | `git diff 452f304 -- apps/web/src/lib/components/PlayScreen.svelte` is empty; `EditorBoard` renders through `BoardSvg`/`BoardCanvas`/`MiniMap`/`ZoomControls` |

## Prototype

Built in a scratch clone of main `452f304` (first on main plus the WT8 branch, then rebased onto `452f304` when WT8 merged; the merged tree matched). Every step of this plan was then committed separately from the prototype's files, and `bun run check` passed at each commit: 519, 539, 550, 554, 573, 582, 582, 582, 582, 582 tests passing with Mailpit down (baseline 507; one more each with Mailpit up), 0 failing. The step instructions in this document were generated from those commits and replayed by script into a fresh branch from `452f304`; the result matched the prototype file for file, including `openapi.yaml` and `packages/api-client/src/schema.ts` after `bun run gen:api`.

Also run in the prototype: `bun run test:e2e` (65 passed), `bun run test:e2e:auth` (2 passed, and 6 of 6 with `--repeat-each=3` after review round 1, with Mailpit, Garage and Cloudflare reachable), `bun run test:perf` (2 passed before review round 1, p95 16.7 ms for both checks; after it, with the host at load average 16 from other worktrees, the checks missed their thresholds, which this round's changes don't touch); the Step 11 script against Garage (output as above); the built app served by the API with a worker, in Chromium: publish from `/create`, "Play it", report from the footer, `/admin` and the account page's list. Screenshots of `/create` at 1440×900 and 390×664 were compared with `Editor.dc.html`: same three columns, cards, palette, status pills, verdict text, two 133 px answer boards with a dashed ai box, suggestion box and pill button. Differences on purpose: cells are at most 58 px (the play board's maximum; the artboard uses 64), the suggestion says "rules out Answer B" rather than "leaves exactly one answer" (it is not re-verified), the caption says "saved on this device", and the header nav has only "Create" (Today/Library/Ranks come with WT11). On phones the grid comes first.

Found while prototyping and kept in the plan: `{ "Answer B" }` text also appears in the suggestion, so the e2e uses `exact: true`; on phones the board sits below the tools unless reordered, which hid it from the first tap; `LiveChecker` must compare a reply with the latest request id (not the one captured when the worker was set up), or a stopped worker's late reply would be taken; the flow test's 1 ms job limit reliably times out before a thread starts; the auth e2e needs a database file (not `:memory:`) so the API and the worker share it, and Playwright 1.62's `webServer.wait.stdout` starts the worker without a URL to poll.

## Unresolved questions

1. The editor's in-browser check gives up after 3 s (then `unknown`, publishing still allowed). Default: keep 3 s; tune after phone testing.
2. The suggestion only promises to rule out Answer B, not uniqueness (the artboard says "leaves exactly one answer"). Default: keep; an extra verification per suggestion can come later.
3. 20 submissions and 20 reports per account per hour, though PRD §4 defers submission limits. Default: keep (cheap insurance for the shared worker).
4. Unconfirmed accounts may report. Default: allow (reports change nothing by themselves).
5. No republish after unpublish, and no admin view of unpublished puzzles beyond opening them by link. Default: none for v1.
6. A submission marked `duplicate` (or `unique`) keeps pointing at its puzzle after an admin unpublishes it, so the creator's list still says "Published" with a link that 404s. Default: accept (rare); WT12 can show the puzzle's status.
7. Submitting a copy of a generated puzzle answers `duplicate` and links to the generated one. Default: keep.
8. Share links are UUID-based; no short ids. Default: keep.
9. The auth e2e config hard-codes Garage's public development key (already in `.env.example`). Default: keep.

## Review responses

Round 1 (`plan-review-1.md`). All changed steps (2, 7, 9, 10) were rebuilt in the prototype, every step was gated again, the plan was regenerated and replayed into a fresh branch (identical to the prototype at every step), and the Step 11 live script was re-run with Garage (same output as above), then `docker compose down`.

1. **major, typing a size resizes on every keystroke.** Accepted. The size fields apply on `change` (Enter, leaving the field, the spinner) instead of `input`, so "12" no longer passes through 1 (Step 7, `EditorScreen.svelte`, with a comment). New e2e "typing a bigger size keeps the clues": a clue in column 5 of a 7×7, `pressSequentially("12")` into Width, Tab, then "1 clues · 12×7" and the clue still there. The large-grid e2e blurs the Height field after `fill`, since `fill` alone fires no `change`.
2. **minor, a job done before the row existed leaves the submission pending.** Accepted as suggested: `#settle` now rejects as `error` whenever the job has ended (`done`, `failed`, `timeout`) and the submission is still pending; `complete` always decides before the job is marked done. New manager test "a job that finished without deciding its submission reads as error". The DECISIONS entry names this case.
3. **minor, the publish e2e is not repeatable.** Accepted: the test generates a 5×5 with a random seed (`generate` from core) for its draft. `--repeat-each=3` now passes 6 of 6.
4. **minor, a late publish result can land on an edited draft.** Accepted: `publish()` keeps the draft it sent and sets the card only if the draft is unchanged when the answer comes.
5. **minor, artboard fidelity.** (a) and (c) were already fixed in the prototype after those screenshots (the pip is a block above the word; "Create" sits on the brand row, so at 390 px the header has the same two rows as before WT10). (b) The screenshots predated the overlay: the suggested cell is now drawn in the board's overlay SVG with the dashed ai stroke over both renderers. Re-checked with new screenshots at 1440×900 and 390×664 (and the home page at 390 px).
6. **minor, merge notes.** Added the play route and the single-`<style>` note for the account page.
7. **minor, "Submission limits" wording.** Reworded: the question cites PRD §4 and the build plan's default, and the reason says this deliberately overrides it, for NFR-4 and the shared 100-job queue.
8. **minor, web AGENTS.md bullet.** Trimmed to the convention: editor logic in plain, tested modules under `lib/editor`, thin components, the board reuses the play board's renderers.

While re-validating, the main e2e suite twice ran into another worktree's `vite preview` holding port 4173 (Playwright then tested that server). Run on a free port, it passed 65 of 65. If `bun run test:e2e` reports "Port 4173 is already in use", wait for the other run to finish rather than chasing the failures.
