# WT7 `accounts` — implementation plan

Branch `feat/accounts`, worktree `/home/jhonnold/projects/loophole-wt/accounts` (based on main `3542be0`, which includes WT6). PRD: FR-18 (email + password, argon2id), FR-19 (CAPTCHA on sign-up), FR-20 (email verification and password reset), NFR-4 (argon2id, CSRF protection, secure cookies, rate limits on auth endpoints, parameterized queries, input validation), NFR-6 (store only email, password hash and gameplay data; account deletion), §5 personas (Guest, Player, Admin).

## Goal

Accounts on top of the WT6 server, in its layers:

- **Sign-up and login** with email and password, hashed with argon2id (`Bun.password`, behind a `PasswordHasher` port). Sign-up is behind Cloudflare Turnstile, checked server-side through a `CaptchaVerifier` adapter; dev and tests use Cloudflare's documented test keys and a fake, and the settings refuse the test secret for any `PUBLIC_URL` that isn't localhost (fail closed).
- **Email verification and password reset** through a `Mailer` port: nodemailer over SMTP from settings, wrapped in a `BackgroundMailer` so mail goes out after the answer; Mailpit in development, an in-memory mailer in tests. Tokens are single-use, expire, and are stored as SHA-256 hashes.
- **Sessions**: an opaque random token in a `Secure; HttpOnly; SameSite=Lax` cookie, stored hashed in SQLite with an expiry, a new token on every login, logout.
- **CSRF protection** on every state-changing `/api` request (Fetch Metadata / Origin check), on top of SameSite and JSON-only bodies.
- **Rate limits** per client address (routes) and per email (manager) through a `RateLimiter` port with an in-memory adapter; 429 with `Retry-After`.
- **Account deletion** removes the user and, by `ON DELETE CASCADE`, everything that belongs to them. An `is_admin` flag, set by `bun run admin <email>`, for WT10/WT12.
- **No answer reveals whether an email has an account.**
- **Web**: sign-up (Turnstile widget), login, logout, confirm-email landing, forgot / new password, an account page with delete, and a header that shows "Log in" or "Account". The guest flow is unchanged; the play screen and its tray are not touched.
- **Contract**: the routes are in the OpenAPI document; `openapi.yaml` and `packages/api-client` are regenerated.

## Follow-ups handled here

None: `FOLLOWUPS.md` has no `[WT7]` items.

## Out of scope

Progress sync and guest-to-account migration (WT9), submissions and admin unpublish (WT10), leaderboards (WT11), metrics, the admin health view, the production Dockerfile and HTTPS (WT12); changing email or password while logged in (a reset covers a forgotten password); "remember me" or sliding session renewal; HTML mail; OAuth or passkeys; purging unconfirmed accounts.

## How later worktrees use this

- **WT9 progress sync**: `currentUser(c, sessions)` from `apps/server/src/api/session-cookie.ts` gives the `UserRecord` or null (answer 401). The progress table references `users(id) ON DELETE CASCADE` so account deletion removes it. Unconfirmed accounts may sync. For guest → account migration, the web app can react to the auth store (`$lib/auth`) turning from guest to user after `logIn` and upload local progress then.
- **WT10 submissions**: submitting needs a confirmed email (`user.emailVerifiedAt !== null`, else 403). Admin unpublish checks `user.isAdmin` (else 403); admins are made with `bun run admin <email>`. Store the author as `author_id … REFERENCES users(id) ON DELETE SET NULL`, so a deleted account's puzzles stay. New POST routes automatically get the CSRF check; list a 403 response in their route definitions.
- **WT11 leaderboards**: entries per user reference `users(id) ON DELETE CASCADE`; posting needs a confirmed email. The public leaderboard must not show emails (the only personal data); WT11 decides on a display name (needs a new column and a DECISIONS entry, since NFR-6 lists what may be stored).
- **WT12 metrics and health**: count auth failures where `app.ts`'s `onError` maps `InvalidCredentialsError`, `CaptchaFailedError` and `RateLimitedError`; the admin health view checks `isAdmin`. Production must set real `TURNSTILE_*` keys (the API won't start with the test secret unless `PUBLIC_URL` is on localhost), `PUBLIC_URL`, the SMTP settings, and `TRUST_PROXY=true` behind a reverse proxy.

## Design

### Packages and versions (checked with `npm view` on 2026-10-25)

| Package | Version | Where | Why this one |
|---|---|---|---|
| `nodemailer` | 10.1.0 | server | Published 2026-10-10. 10.2.1 (latest) is three days old and 10.1.x had seven releases in one day; 10.1.0 is the newest release more than two weeks old. No dependencies. Ships its own types (`dist/cjs/nodemailer.d.ts`), so `@types/nodemailer` (8.0.2, which types the older API) is not added. |

Everything else is already there: `Bun.password` (argon2id) and `crypto.subtle` in Bun 1.3.13, `hono/cookie`, zod 4's `z.stringbool()`, `svelte/store`, `@playwright/test`.

### Files

```
apps/server/
  scripts/set-admin.ts                    bun run admin <email> [--revoke]
  src/
    domain.ts                             + UserRecord, SessionRecord, AccountTokenRecord
    ports.ts                              + UserRepository, SessionRepository, AccountTokenRepository,
                                            PasswordHasher, CaptchaVerifier, Mailer, RateLimiter
    config.ts                             + PUBLIC_URL, TRUST_PROXY, TURNSTILE_*, SMTP_*, MAIL_FROM;
                                            refuses the Turnstile test secret off localhost
    adapters/
      db/migrations/002_accounts.sql      users, sessions, account_tokens
      db/user-repository.ts, session-repository.ts, account-token-repository.ts   (+ tests)
      password-hasher.ts, random-token.ts, rate-limiter.ts                         (+ tests)
      mail/smtp-mailer.ts, mail/memory-mailer.ts                                   (+ Mailpit test)
      mail/background-mailer.ts           sends after the answer; logs failures   (+ test)
      captcha/turnstile.ts                                                         (+ test)
    managers/
      errors.ts                           + InvalidCredentialsError, CaptchaFailedError, InvalidTokenError, RateLimitedError
      hash-token.ts                       SHA-256 hex of a token (crypto.subtle)
      session-manager.ts, account-manager.ts                                       (+ tests)
    api/
      account-schemas.ts                  request/response schemas of the account routes
      accounts.ts                         the account routes + per-address rate limits   (+ tests)
      csrf.ts                             sameOriginOnly middleware
      session-cookie.ts                   cookie helpers, currentUser(c, sessions)
      client-address.ts                   socket peer or X-Forwarded-For; IPv6 → /64 for limits (+ test)
      problem.ts                          + problemResponse (moved from app.ts)
      app.ts, main.ts, spec.ts            wiring
    test-support/fakes.ts                 + fake users/sessions/tokens repos, fake hasher, fake CAPTCHA
    test-support/accounts.ts              accountDeps(db, clock) for route tests
apps/web/
  playwright.auth.config.ts, tests/accounts.auth-e2e.ts
  src/app.d.ts                            + Turnstile's window API
  src/app.css                             + .auth form styles
  src/lib/auth/auth.ts, index.ts, auth.test.ts
  src/lib/components/SiteHeader.svelte, AccountLink.svelte, Turnstile.svelte
  src/routes/+layout.svelte               refresh the auth store once
  src/routes/+page.svelte                 header → <SiteHeader />
  src/routes/{signup,login,verify-email,forgot-password,reset-password,account}/+page.svelte
```

Layer rules: the new adapters sit under `adapters/`, so the existing `**/adapters/**` patterns cover them; `nodemailer` is added to the forbidden imports of managers and of entrypoints. Managers import only `ports.ts`, `domain.ts` and other managers (`crypto.subtle` and `TextEncoder` are web globals, not Node APIs). Routes call managers and take the rate limiter by its port type. The admin script, like `gen-api.ts`, is a composition root outside the rules.

### Data model (`002_accounts.sql`)

- `users`: `id` (UUID), `email` (trimmed, lower-cased, UNIQUE), `password_hash` (argon2id PHC string), `email_verified_at` (ms or NULL), `is_admin` (0/1), `created_at`. Nothing else (NFR-6).
- `sessions`: `token_hash` (SHA-256 hex, PK), `user_id` → users ON DELETE CASCADE, `created_at`, `expires_at`. Indexes on `user_id` and `expires_at`.
- `account_tokens`: `token_hash` (PK), `user_id` → users ON DELETE CASCADE, `purpose` (`verify-email` | `reset-password`), `created_at`, `expires_at`. Indexes on `(user_id, purpose)` and `expires_at`.

Migration number **002**; WT8 `hints` uses 003 if it needs one.

### API

| Method + path | Body | Success | Errors |
|---|---|---|---|
| `GET /api/auth/config` | — | 200 `{turnstileSiteKey}` | — |
| `GET /api/session` | — | 200 `{user: User \| null}`; clears a stale cookie | — |
| `POST /api/auth/signup` | `{email, password 8–128, captchaToken}` | 204 (same for a taken email; does not log in) | 400 (body, CAPTCHA), 403, 429 |
| `POST /api/auth/login` | `{email, password}` | 200 `User` + `Set-Cookie` (new token; ends the session of the cookie sent) | 400, 401, 403, 429 |
| `POST /api/auth/logout` | — | 204, cookie cleared | 403 |
| `POST /api/auth/verify-email` | `{token}` | 204 | 400 (body, bad link), 403, 429 |
| `POST /api/auth/resend-verification` | `{email}` | 204 always | 400, 403, 429 |
| `POST /api/auth/forgot-password` | `{email}` | 204 always | 400, 403, 429 |
| `POST /api/auth/reset-password` | `{token, password 8–128}` | 204; every session of the account ends | 400, 403, 429 |
| `DELETE /api/account` | `{password}` | 204, cookie cleared, user and their rows gone | 400, 401 (no session, wrong password), 403, 429 |

`User` = `{id, email, emailVerified, isAdmin, createdAt}`. All errors are RFC 9457 problems as in WT6; 429 carries `Retry-After` (seconds). `POST /api/jobs/generate` gains a documented 403 (the CSRF check applies to it too).

### Security choices (details in the DECISIONS entries of Step 10)

- **Cookie** `loophole_session`: 43-character base64url token (32 random bytes), `HttpOnly; Secure; SameSite=Lax; Path=/; Expires=` login + 30 days. Stored as SHA-256. Login rotates it.
- **CSRF** (`api/csrf.ts`), on every `/api/*` request but GET/HEAD/OPTIONS: `Sec-Fetch-Site` `same-origin`/`none` → allow; `same-site`/`cross-site` → 403. No `Sec-Fetch-Site`: no `Origin` → allow (not a browser); `Origin` host equal to the request's → allow; else (including `null`) → 403. Plus SameSite=Lax and JSON-only bodies (415 otherwise).
- **Rate limits**: per address (IPv6 by /64) — signup 10/h, login 20/15 min, mail requests 10/h, token uses 20/15 min, delete 10/15 min; per email — 10 login/delete attempts per 15 min, 3 mails per hour (extra mails dropped silently). The per-email login limit lets anyone who knows an email lock that account out of login while they keep trying; accepted and documented.
- **Turnstile fails closed**: `loadConfig` throws when the secret is Cloudflare's always-pass test key and `PUBLIC_URL` isn't on `localhost`/`127.0.0.1`; with real keys, siteverify's `hostname` must equal `PUBLIC_URL`'s host.
- **Enumeration**: uniform 204s for sign-up, resend and forgot; one 401 for every login failure, with a throwaway hash checked for unknown emails. Mail is sent after the answer (`BackgroundMailer`), so SMTP latency and SMTP errors don't differ between registered and unknown emails; a failed send is logged without the message.
- **Unconfirmed accounts** can log in, play, sync (WT9) and delete themselves; submissions (WT10) and leaderboards (WT11) need a confirmed email. A reset link confirms the email too.
- **Mailed links** carry the token in the URL fragment (`#token=`); 24 h for verification, 1 h for reset; single use.

### Web

- `$lib/auth/auth.ts` (plain module, tested under `bun test`): `createAuth(client)` returns a `svelte/store` readable of `{status: "loading" | "guest" | "user", user?}` plus `refresh`, `turnstileSiteKey`, `signUp`, `logIn`, `logOut`, `verifyEmail`, `resendVerification`, `requestPasswordReset`, `resetPassword`, `deleteAccount`. Actions return `{ok: true}` or `{ok: false, message}`. Anything but a JSON answer from `/api/session` (no server, `vite preview`) means guest, so the guest flow and `test:e2e` don't change. `$lib/auth/index.ts` holds the app's one instance.
- `+layout.svelte` calls `auth.refresh()` once on mount. `SiteHeader` (brand, `AccountLink`, `ThemeSwitch`) replaces the header markup in the home page and is used by every account page. `PlayScreen` keeps its own bar, unchanged.
- `Turnstile.svelte` loads `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` once, renders the widget with the site key from `/api/auth/config` (`theme: "auto"`), and reports the token; the sign-up page resets it after a failed attempt (tokens are single-use).
- Pages are plain forms using the browser's own validation (`type=email`, `required`, `minlength=8`, `maxlength`) and the `.auth` styles appended to `app.css` (design-kit tokens: ink borders, pill buttons, shu for errors and the delete button, ai for links). The verify and reset pages remove `#token=…` from the address bar with `history.replaceState` before calling the API.

## Merge notes (WT8 `hints` is built in parallel)

- **Contract files**: never hand-merge `openapi.yaml` or `packages/api-client/src/schema.ts`. On a conflict, take either side, run `bun run gen:api`, and commit the result; `bun run check:api` must pass.
- **Migrations**: this WT adds `002_accounts.sql`; hints uses `003_*.sql`. `apps/server/src/adapters/db/database.test.ts` "creates the tables and records each migration once" lists the tables and versions; if both branches change it, keep every table (sorted by name) and every version (`[{ version: 1 }, { version: 2 }, { version: 3 }]`).
- **`apps/server/src/api/app.ts`**: this WT replaces it (imports, `AppDeps extends AccountRouteDeps`, `app.use("/api/*", sameOriginOnly)`, `registerAccountRoutes(app, deps)` before the `/api/*` 404, four `onError` mappings) and moves `problemResponse` to `problem.ts`. When merging hints' routes, keep both sets of changes; hints code that used the local `problemResponse` now imports it from `./problem.ts`. Hints' new POST routes get the CSRF check automatically; list `403` in their responses.
- **Tests that call `createApp`** (hints' route tests) need the account dependencies: spread `...accountDeps(db, clock)` from `../test-support/accounts.ts`, as `app.test.ts` does. The typecheck points at any that are missing.
- **`apps/server/src/api/spec.ts`, `main.ts`, `ports.ts`, `domain.ts`, `test-support/fakes.ts`**: both branches may add to them; keep both sides.
- **Web**: this WT changes `routes/+page.svelte` (header only), `routes/+layout.svelte`, `app.css` (appended block), `app.d.ts`, and adds `lib/auth`, three components and six routes. It does not touch `PlayScreen.svelte`, `ToolBar.svelte` or the board components.
- **Docs**: README status sentence and Scripts table, `docs/DECISIONS.md` (both append; keep both, in merge order), `docs/TESTING.md`, nested `AGENTS.md` files: keep both sides.
- **`bun.lock`**: on a conflict, take main's and run `bun install` to re-add `nodemailer`.
- After merging: `bun run gen:api`, `bun run check`, and `bun run test:e2e`.

## Environment notes for the implementer

- Run every command from the worktree root `/home/jhonnold/projects/loophole-wt/accounts` with `export PATH="$HOME/.bun/bin:$PATH";` first. Use absolute paths; the shell's working directory resets between calls.
- Create directories before writing files into them (`mkdir -p`).
- Copy every file below exactly, including comments. `.svelte` files are not formatted by Biome; keep them as given.
- `.env.example` (and `.env`) may only be readable and writable with the Read, Edit and Write tools; shell commands that read `.env*` files can be denied.
- `bun add` prints `incorrect peer dependency "typescript@6.0.3"` for `openapi-typescript`. Expected; ignore.
- bun:sqlite binds `{ id }`-style parameters to `$id` placeholders because the database is opened with `strict: true`. Row types passed as statement parameters must be `type` aliases, not `interface`s (comments in the files say so).
- The Mailpit test (`smtp-mailer.test.ts`) and the account end-to-end test skip themselves when Mailpit isn't running. Start it with `docker compose up -d mailpit` (or `docker compose up -d` for Garage too). Compose's project name is `loophole` for every checkout, and the `hints` worktree may be using it at the same time: don't stop it while someone else needs it, and never run `docker compose down -v`.
- Ports: the `hints` worktree may be running its own API on 3000 and Vite on 5173. Check with `ss -ltn | grep -E ':(3000|3100|4174|5173)\b'` before starting servers; Step 11 uses port 3100. The account e2e test uses 4174.
- Stop servers by pid (`kill <pid>`, pids from `ps -eo pid,args | grep '[b]un '`), never with `pkill -f <pattern>` (it matches your own shell).
- Playwright's Chromium is already installed (`bun run test:e2e` works). If not: `cd apps/web && bunx playwright install chromium`.
- `bun run check` takes about 15–20 s. It must pass after every step.

## Steps

Each step lists files to create (full contents), files to replace (full contents), text to append and edits (replace the old text with the new; each old text occurs exactly once). Then run the step's commands, then `bun run check`, then commit with the given message (`git add -A && git commit -m "…"`). The contents below are already formatted for Biome; `bun run format` afterwards must change nothing.

### Step 1 — Account tables, domain types, ports and the layering lint

Adds migration `002_accounts.sql` (users, sessions, mailed tokens), the domain types and the port interfaces the managers will use, and teaches the layer rules about `nodemailer`. Nothing uses the new interfaces yet.

#### Create `apps/server/src/adapters/db/migrations/002_accounts.sql`

```sql
-- Accounts (PRD FR-18, FR-20, NFR-6): only the email, the password hash and gameplay data are
-- stored. Rows that belong to a user reference users(id) ON DELETE CASCADE, so deleting the user
-- deletes them. Times are milliseconds since the epoch.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  -- Trimmed and lower-cased by the account manager.
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_verified_at INTEGER,
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  created_at INTEGER NOT NULL
) STRICT;

-- Login sessions. Only a SHA-256 hash of the cookie's token is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX sessions_by_user ON sessions (user_id);
CREATE INDEX sessions_by_expiry ON sessions (expires_at);

-- Single-use email verification and password reset tokens, stored as SHA-256 hashes.
CREATE TABLE account_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify-email', 'reset-password')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX account_tokens_by_user ON account_tokens (user_id, purpose);
CREATE INDEX account_tokens_by_expiry ON account_tokens (expires_at);
```

#### Append to the end of `apps/server/src/domain.ts`

```ts
/** A registered player (PRD §5). Holds only what NFR-6 allows: the email and the password hash. */
export interface UserRecord {
  readonly id: string;
  /** Trimmed and lower-cased; unique. */
  readonly email: string;
  /** argon2id, in PHC string format. */
  readonly passwordHash: string;
  /** When the email was confirmed, or null while it is unverified. */
  readonly emailVerifiedAt: number | null;
  /** Set only by the admin script (`bun run admin`), for unpublishing and system health. */
  readonly isAdmin: boolean;
  readonly createdAt: number;
}

/** A login session. The cookie holds the token; only its hash is stored. */
export interface SessionRecord {
  readonly tokenHash: string;
  readonly userId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export type AccountTokenPurpose = "verify-email" | "reset-password";

/** A single-use token mailed to a user. Only its hash is stored. */
export interface AccountTokenRecord {
  readonly tokenHash: string;
  readonly userId: string;
  readonly purpose: AccountTokenPurpose;
  readonly createdAt: number;
  readonly expiresAt: number;
}
```

Keep one blank line between the file's last existing line and the appended text.

#### Replace the whole of `apps/server/src/ports.ts` with

```ts
import type {
  AccountTokenPurpose,
  AccountTokenRecord,
  Job,
  JobInput,
  JobResult,
  PuzzleRecord,
  SessionRecord,
  Task,
  TaskOutcome,
  UserRecord,
} from "./domain.ts";

/**
 * The interfaces managers depend on. Adapters implement them; the composition roots
 * (`api/main.ts`, `worker/main.ts`) pick the implementations.
 */

export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
}

export interface PuzzleRepository {
  /** Stores a new puzzle. Does nothing when a puzzle with this id already exists. */
  insert(record: PuzzleRecord): void;
  get(id: string): PuzzleRecord | null;
  /** Published puzzles, newest first. */
  listPublished(limit: number): PuzzleRecord[];
}

/** Text blobs by key, such as solutions and solver traces. */
export interface BlobStore {
  put(key: string, body: string, contentType: string): Promise<void>;
  /** Resolves to null when there is no blob under `key`. */
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}

export interface NewJob {
  readonly id: string;
  readonly job: JobInput;
  readonly createdAt: number;
}

/**
 * The jobs table. Updates to a running job name the worker that claimed it and do nothing when
 * another worker holds the job or it is no longer running.
 */
export interface JobQueue {
  enqueue(job: NewJob): Job;
  get(id: string): Job | null;
  countQueued(): number;
  /** Atomically takes the oldest queued job for `workerId`, or returns null when there is none. */
  claimNext(workerId: string, now: number): Job | null;
  /** Stores progress (0 to 1); also counts as a heartbeat. */
  setProgress(id: string, workerId: string, progress: number, now: number): void;
  heartbeat(id: string, workerId: string, now: number): void;
  /** Ends a running job. Returns false when the worker no longer holds it. */
  finish(id: string, workerId: string, end: JobEnd, now: number): boolean;
  /**
   * Running jobs whose last heartbeat is before `staleBefore` go back to the queue, or fail once
   * they have been claimed `maxAttempts` times. Returns how many jobs it changed.
   */
  recoverStale(staleBefore: number, maxAttempts: number, now: number): number;
}

export type JobEnd =
  | { readonly status: "done"; readonly result: JobResult }
  | { readonly status: "failed" | "timeout"; readonly error: string };

export interface TaskRunOptions {
  /** The task is stopped and reported as `timeout` after this long. */
  readonly timeoutMs: number;
  /** Called with progress from 0 to 1, at most about once per percent. */
  readonly onProgress: (progress: number) => void;
}

/** Runs CPU-heavy tasks (generation, verification) off the caller's thread. */
export interface TaskRunner {
  run(task: Task, options: TaskRunOptions): Promise<TaskOutcome>;
}

export interface UserRepository {
  /** Stores a new user. Returns false, storing nothing, when the email is already taken. */
  insert(user: UserRecord): boolean;
  get(id: string): UserRecord | null;
  /** `email` must already be normalized (trimmed, lower-cased). */
  getByEmail(email: string): UserRecord | null;
  setPasswordHash(id: string, passwordHash: string): void;
  /** Marks the email verified at `at`, unless it already is. */
  markEmailVerified(id: string, at: number): void;
  /** Returns false when no user has this email. */
  setAdmin(email: string, isAdmin: boolean): boolean;
  /** Deletes the user and, through ON DELETE CASCADE, every row that belongs to them. */
  delete(id: string): void;
}

export interface SessionRepository {
  insert(session: SessionRecord): void;
  get(tokenHash: string): SessionRecord | null;
  delete(tokenHash: string): void;
  deleteForUser(userId: string): void;
  /** Removes sessions that expired at or before `now`. */
  deleteExpired(now: number): void;
}

export interface AccountTokenRepository {
  /** Stores `token` and drops the user's other tokens for the same purpose. */
  replace(token: AccountTokenRecord): void;
  /** Removes and returns the token with this hash and purpose, expired or not; null if none. */
  take(tokenHash: string, purpose: AccountTokenPurpose): AccountTokenRecord | null;
  /** Removes tokens that expired at or before `now`. */
  deleteExpired(now: number): void;
}

/** Password hashing (argon2id in production). */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

/** Server-side check of a CAPTCHA token from the sign-up form (Cloudflare Turnstile). */
export interface CaptchaVerifier {
  /** False when the token is invalid, expired, already used, or the check could not be made. */
  verify(token: string, remoteIp: string | null): Promise<boolean>;
}

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  /** Plain text body. */
  readonly text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** At most `limit` hits per `windowMs`. */
export interface RateRule {
  readonly limit: number;
  readonly windowMs: number;
}

export type RateDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterMs: number };

/** Counts attempts per key, for the limits on the auth endpoints (NFR-4). */
export interface RateLimiter {
  /** Counts one hit under `key` and says whether it is within `rule`. */
  hit(key: string, rule: RateRule): RateDecision;
}
```

#### Edit `apps/server/src/adapters/db/database.test.ts`

In `apps/server/src/adapters/db/database.test.ts`, replace

```ts
    expect(tables).toEqual(["jobs", "puzzles", "schema_migrations"]);
```

with

```ts
    expect(tables).toEqual([
      "account_tokens",
      "jobs",
      "puzzles",
      "schema_migrations",
      "sessions",
      "users",
    ]);
```

#### Edit `apps/server/src/adapters/db/database.test.ts`

In `apps/server/src/adapters/db/database.test.ts`, replace

```ts
    expect(versions).toEqual([{ version: 1 }]);
```

with

```ts
    expect(versions).toEqual([{ version: 1 }, { version: 2 }]);
```

#### Edit `biome.json`

In `biome.json`, replace

```json
                  "zod": "Input is validated at the entrypoints, before it reaches a manager."
```

with

```json
                  "zod": "Input is validated at the entrypoints, before it reaches a manager.",
                  "nodemailer": "Managers send mail through the Mailer interface in ports.ts."
```

#### Edit `biome.json`

In `biome.json`, replace

```json
                  "bun:sqlite": "Entrypoints call managers; only the composition roots build adapters."
```

with

```json
                  "bun:sqlite": "Entrypoints call managers; only the composition roots build adapters.",
                  "nodemailer": "Entrypoints call managers; only the composition roots build adapters."
```

#### Check

```sh
bun test apps/server/src/adapters/db/database.test.ts   # 5 pass
bun run check
```

#### Commit

```sh
git add -A && git commit -m "feat(server): add account tables, domain types and ports"
```

### Step 2 — SQLite repositories for users, sessions and mailed tokens

Prepared statements with named parameters, like the puzzle repository. Deleting a user cascades to their sessions and tokens (tested).

#### Create `apps/server/src/adapters/db/user-repository.ts`

```ts
import type { Database } from "bun:sqlite";
import type { UserRecord } from "../../domain.ts";
import type { UserRepository } from "../../ports.ts";

// A type alias, not an interface, so it satisfies bun:sqlite's binding type.
type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  email_verified_at: number | null;
  is_admin: number;
  created_at: number;
};

const COLUMNS = "id, email, password_hash, email_verified_at, is_admin, created_at";

/** Users in SQLite. Deleting a user cascades to their sessions, tokens and gameplay rows. */
export class SqliteUserRepository implements UserRepository {
  readonly #insert;
  readonly #get;
  readonly #getByEmail;
  readonly #setPasswordHash;
  readonly #markEmailVerified;
  readonly #setAdmin;
  readonly #delete;

  constructor(db: Database) {
    this.#insert = db.query<void, UserRow>(
      `INSERT INTO users (${COLUMNS}) VALUES ($id, $email, $password_hash, $email_verified_at, $is_admin, $created_at) ON CONFLICT (email) DO NOTHING`,
    );
    this.#get = db.query<UserRow, { id: string }>(`SELECT ${COLUMNS} FROM users WHERE id = $id`);
    this.#getByEmail = db.query<UserRow, { email: string }>(
      `SELECT ${COLUMNS} FROM users WHERE email = $email`,
    );
    this.#setPasswordHash = db.query<void, { id: string; hash: string }>(
      "UPDATE users SET password_hash = $hash WHERE id = $id",
    );
    this.#markEmailVerified = db.query<void, { id: string; at: number }>(
      "UPDATE users SET email_verified_at = $at WHERE id = $id AND email_verified_at IS NULL",
    );
    this.#setAdmin = db.query<void, { email: string; admin: number }>(
      "UPDATE users SET is_admin = $admin WHERE email = $email",
    );
    this.#delete = db.query<void, { id: string }>("DELETE FROM users WHERE id = $id");
  }

  insert(user: UserRecord): boolean {
    return this.#insert.run(toRow(user)).changes === 1;
  }

  get(id: string): UserRecord | null {
    const row = this.#get.get({ id });
    return row === null ? null : fromRow(row);
  }

  getByEmail(email: string): UserRecord | null {
    const row = this.#getByEmail.get({ email });
    return row === null ? null : fromRow(row);
  }

  setPasswordHash(id: string, passwordHash: string): void {
    this.#setPasswordHash.run({ id, hash: passwordHash });
  }

  markEmailVerified(id: string, at: number): void {
    this.#markEmailVerified.run({ id, at });
  }

  setAdmin(email: string, isAdmin: boolean): boolean {
    return this.#setAdmin.run({ email, admin: isAdmin ? 1 : 0 }).changes === 1;
  }

  delete(id: string): void {
    this.#delete.run({ id });
  }
}

function toRow(u: UserRecord): UserRow {
  return {
    id: u.id,
    email: u.email,
    password_hash: u.passwordHash,
    email_verified_at: u.emailVerifiedAt,
    is_admin: u.isAdmin ? 1 : 0,
    created_at: u.createdAt,
  };
}

function fromRow(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    emailVerifiedAt: row.email_verified_at,
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
  };
}
```

#### Create `apps/server/src/adapters/db/user-repository.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import type { UserRecord } from "../../domain.ts";
import { openDatabase } from "./database.ts";
import { SqliteUserRepository } from "./user-repository.ts";

function user(id: string, email: string): UserRecord {
  return {
    id,
    email,
    passwordHash: `hash-${id}`,
    emailVerifiedAt: null,
    isAdmin: false,
    createdAt: 1000,
  };
}

describe("SqliteUserRepository", () => {
  test("get and getByEmail return what insert stored; unknown ones are null", () => {
    const repo = new SqliteUserRepository(openDatabase(":memory:"));
    const u = user("u1", "a@example.com");
    expect(repo.insert(u)).toBe(true);
    expect(repo.get("u1")).toEqual(u);
    expect(repo.getByEmail("a@example.com")).toEqual(u);
    expect(repo.get("nope")).toBeNull();
    expect(repo.getByEmail("b@example.com")).toBeNull();
  });

  test("insert refuses a taken email and keeps the first user", () => {
    const repo = new SqliteUserRepository(openDatabase(":memory:"));
    repo.insert(user("u1", "a@example.com"));
    expect(repo.insert(user("u2", "a@example.com"))).toBe(false);
    expect(repo.get("u2")).toBeNull();
    expect(repo.getByEmail("a@example.com")?.id).toBe("u1");
  });

  test("updates the password hash, the verified time (once) and the admin flag", () => {
    const repo = new SqliteUserRepository(openDatabase(":memory:"));
    repo.insert(user("u1", "a@example.com"));
    repo.setPasswordHash("u1", "new-hash");
    repo.markEmailVerified("u1", 5000);
    repo.markEmailVerified("u1", 9000);
    expect(repo.setAdmin("a@example.com", true)).toBe(true);
    expect(repo.setAdmin("b@example.com", true)).toBe(false);
    expect(repo.get("u1")).toMatchObject({
      passwordHash: "new-hash",
      emailVerifiedAt: 5000,
      isAdmin: true,
    });
    repo.setAdmin("a@example.com", false);
    expect(repo.get("u1")?.isAdmin).toBe(false);
  });

  test("delete removes the user together with their sessions and tokens", () => {
    const db = openDatabase(":memory:");
    const repo = new SqliteUserRepository(db);
    repo.insert(user("u1", "a@example.com"));
    repo.insert(user("u2", "b@example.com"));
    for (const id of ["u1", "u2"]) {
      db.run(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, 1, 2)",
        [`s-${id}`, id],
      );
      db.run(
        "INSERT INTO account_tokens (token_hash, user_id, purpose, created_at, expires_at) VALUES (?, ?, 'verify-email', 1, 2)",
        [`t-${id}`, id],
      );
    }
    repo.delete("u1");
    expect(repo.get("u1")).toBeNull();
    const left = (table: string) =>
      db
        .query<{ user_id: string }, []>(`SELECT user_id FROM ${table}`)
        .all()
        .map((r) => r.user_id);
    expect(left("sessions")).toEqual(["u2"]);
    expect(left("account_tokens")).toEqual(["u2"]);
  });
});
```

#### Create `apps/server/src/adapters/db/session-repository.ts`

```ts
import type { Database } from "bun:sqlite";
import type { SessionRecord } from "../../domain.ts";
import type { SessionRepository } from "../../ports.ts";

// A type alias, not an interface, so it satisfies bun:sqlite's binding type.
type SessionRow = {
  token_hash: string;
  user_id: string;
  created_at: number;
  expires_at: number;
};

const COLUMNS = "token_hash, user_id, created_at, expires_at";

/** Login sessions in SQLite, keyed by the hash of the cookie's token. */
export class SqliteSessionRepository implements SessionRepository {
  readonly #insert;
  readonly #get;
  readonly #delete;
  readonly #deleteForUser;
  readonly #deleteExpired;

  constructor(db: Database) {
    this.#insert = db.query<void, SessionRow>(
      `INSERT INTO sessions (${COLUMNS}) VALUES ($token_hash, $user_id, $created_at, $expires_at)`,
    );
    this.#get = db.query<SessionRow, { hash: string }>(
      `SELECT ${COLUMNS} FROM sessions WHERE token_hash = $hash`,
    );
    this.#delete = db.query<void, { hash: string }>(
      "DELETE FROM sessions WHERE token_hash = $hash",
    );
    this.#deleteForUser = db.query<void, { userId: string }>(
      "DELETE FROM sessions WHERE user_id = $userId",
    );
    this.#deleteExpired = db.query<void, { now: number }>(
      "DELETE FROM sessions WHERE expires_at <= $now",
    );
  }

  insert(s: SessionRecord): void {
    this.#insert.run({
      token_hash: s.tokenHash,
      user_id: s.userId,
      created_at: s.createdAt,
      expires_at: s.expiresAt,
    });
  }

  get(tokenHash: string): SessionRecord | null {
    const row = this.#get.get({ hash: tokenHash });
    return row === null
      ? null
      : {
          tokenHash: row.token_hash,
          userId: row.user_id,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
        };
  }

  delete(tokenHash: string): void {
    this.#delete.run({ hash: tokenHash });
  }

  deleteForUser(userId: string): void {
    this.#deleteForUser.run({ userId });
  }

  deleteExpired(now: number): void {
    this.#deleteExpired.run({ now });
  }
}
```

#### Create `apps/server/src/adapters/db/session-repository.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { openDatabase } from "./database.ts";
import { SqliteSessionRepository } from "./session-repository.ts";
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
  return new SqliteSessionRepository(db);
}

describe("SqliteSessionRepository", () => {
  test("get returns what insert stored; delete removes it", () => {
    const repo = setup();
    const s = { tokenHash: "h1", userId: "u1", createdAt: 10, expiresAt: 20 };
    repo.insert(s);
    expect(repo.get("h1")).toEqual(s);
    expect(repo.get("h2")).toBeNull();
    repo.delete("h1");
    expect(repo.get("h1")).toBeNull();
  });

  test("deleteForUser removes only that user's sessions", () => {
    const repo = setup();
    repo.insert({ tokenHash: "a", userId: "u1", createdAt: 0, expiresAt: 100 });
    repo.insert({ tokenHash: "b", userId: "u1", createdAt: 0, expiresAt: 100 });
    repo.insert({ tokenHash: "c", userId: "u2", createdAt: 0, expiresAt: 100 });
    repo.deleteForUser("u1");
    expect([repo.get("a"), repo.get("b"), repo.get("c")?.tokenHash]).toEqual([null, null, "c"]);
  });

  test("deleteExpired removes sessions that expired at or before now", () => {
    const repo = setup();
    repo.insert({ tokenHash: "old", userId: "u1", createdAt: 0, expiresAt: 50 });
    repo.insert({ tokenHash: "edge", userId: "u1", createdAt: 0, expiresAt: 60 });
    repo.insert({ tokenHash: "live", userId: "u1", createdAt: 0, expiresAt: 61 });
    repo.deleteExpired(60);
    expect([repo.get("old"), repo.get("edge"), repo.get("live")?.tokenHash]).toEqual([
      null,
      null,
      "live",
    ]);
  });

  test("a session must belong to an existing user", () => {
    const repo = setup();
    expect(() =>
      repo.insert({ tokenHash: "x", userId: "ghost", createdAt: 0, expiresAt: 1 }),
    ).toThrow(/FOREIGN KEY/);
  });
});
```

#### Create `apps/server/src/adapters/db/account-token-repository.ts`

```ts
import type { Database } from "bun:sqlite";
import type { AccountTokenPurpose, AccountTokenRecord } from "../../domain.ts";
import type { AccountTokenRepository } from "../../ports.ts";

// A type alias, not an interface, so it satisfies bun:sqlite's binding type.
type TokenRow = {
  token_hash: string;
  user_id: string;
  purpose: AccountTokenPurpose;
  created_at: number;
  expires_at: number;
};

const COLUMNS = "token_hash, user_id, purpose, created_at, expires_at";

/** Email verification and password reset tokens in SQLite, keyed by the token's hash. */
export class SqliteAccountTokenRepository implements AccountTokenRepository {
  readonly #replace;
  readonly #take;
  readonly #deleteExpired;

  constructor(db: Database) {
    const dropOthers = db.query<void, { user_id: string; purpose: AccountTokenPurpose }>(
      "DELETE FROM account_tokens WHERE user_id = $user_id AND purpose = $purpose",
    );
    const insert = db.query<void, TokenRow>(
      `INSERT INTO account_tokens (${COLUMNS}) VALUES ($token_hash, $user_id, $purpose, $created_at, $expires_at)`,
    );
    this.#replace = db.transaction((row: TokenRow) => {
      dropOthers.run({ user_id: row.user_id, purpose: row.purpose });
      insert.run(row);
    });
    this.#take = db.query<TokenRow, { hash: string; purpose: AccountTokenPurpose }>(
      `DELETE FROM account_tokens WHERE token_hash = $hash AND purpose = $purpose RETURNING ${COLUMNS}`,
    );
    this.#deleteExpired = db.query<void, { now: number }>(
      "DELETE FROM account_tokens WHERE expires_at <= $now",
    );
  }

  replace(t: AccountTokenRecord): void {
    this.#replace({
      token_hash: t.tokenHash,
      user_id: t.userId,
      purpose: t.purpose,
      created_at: t.createdAt,
      expires_at: t.expiresAt,
    });
  }

  take(tokenHash: string, purpose: AccountTokenPurpose): AccountTokenRecord | null {
    const row = this.#take.get({ hash: tokenHash, purpose });
    return row === null
      ? null
      : {
          tokenHash: row.token_hash,
          userId: row.user_id,
          purpose: row.purpose,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
        };
  }

  deleteExpired(now: number): void {
    this.#deleteExpired.run({ now });
  }
}
```

#### Create `apps/server/src/adapters/db/account-token-repository.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import type { AccountTokenRecord } from "../../domain.ts";
import { SqliteAccountTokenRepository } from "./account-token-repository.ts";
import { openDatabase } from "./database.ts";
import { SqliteUserRepository } from "./user-repository.ts";

function setup() {
  const db = openDatabase(":memory:");
  new SqliteUserRepository(db).insert({
    id: "u1",
    email: "a@example.com",
    passwordHash: "h",
    emailVerifiedAt: null,
    isAdmin: false,
    createdAt: 0,
  });
  return new SqliteAccountTokenRepository(db);
}

const token = (
  tokenHash: string,
  purpose: AccountTokenRecord["purpose"],
  expiresAt = 100,
): AccountTokenRecord => ({ tokenHash, userId: "u1", purpose, createdAt: 0, expiresAt });

describe("SqliteAccountTokenRepository", () => {
  test("take returns a token once, and only for its purpose", () => {
    const repo = setup();
    repo.replace(token("v1", "verify-email"));
    expect(repo.take("v1", "reset-password")).toBeNull();
    expect(repo.take("v1", "verify-email")).toEqual(token("v1", "verify-email"));
    expect(repo.take("v1", "verify-email")).toBeNull();
    expect(repo.take("nope", "verify-email")).toBeNull();
  });

  test("replace drops the user's earlier token for the same purpose only", () => {
    const repo = setup();
    repo.replace(token("v1", "verify-email"));
    repo.replace(token("r1", "reset-password"));
    repo.replace(token("v2", "verify-email"));
    expect(repo.take("v1", "verify-email")).toBeNull();
    expect(repo.take("v2", "verify-email")?.tokenHash).toBe("v2");
    expect(repo.take("r1", "reset-password")?.tokenHash).toBe("r1");
  });

  test("take still returns an expired token (the manager rejects it); deleteExpired drops it", () => {
    const repo = setup();
    repo.replace(token("old", "verify-email", 50));
    repo.replace(token("live", "reset-password", 51));
    repo.deleteExpired(50);
    expect(repo.take("old", "verify-email")).toBeNull();
    expect(repo.take("live", "reset-password")?.expiresAt).toBe(51);
    repo.replace(token("late", "verify-email", 10));
    expect(repo.take("late", "verify-email")?.expiresAt).toBe(10);
  });
});
```

#### Check

```sh
bun test apps/server/src/adapters/db   # all pass, including 11 new tests
bun run check
```

#### Commit

```sh
git add -A && git commit -m "feat(server): add user, session and account token repositories"
```

### Step 3 — Adapters: argon2id, random tokens, rate limiter, SMTP mailer, Turnstile

Installs `nodemailer` and adds the remaining adapters with their tests. The SMTP test runs against Mailpit when it is up and skips otherwise. `BackgroundMailer` wraps the SMTP mailer in the API so mail goes out after the answer (no timing or error difference between registered and unknown emails).

#### Run

```sh
bun add --cwd apps/server --exact nodemailer@10.1.0
```

#### Create `apps/server/src/adapters/password-hasher.ts`

```ts
import type { PasswordHasher } from "../ports.ts";

/**
 * argon2id through `Bun.password` (PRD FR-18), with OWASP's minimum settings: 19 MiB of memory,
 * two passes. The hash string records its settings, so they can be raised later.
 */
export const argon2idHasher: PasswordHasher = {
  hash: (password) =>
    Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 }),
  verify: (password, hash) => Bun.password.verify(password, hash),
};
```

#### Create `apps/server/src/adapters/random-token.ts`

```ts
/** 32 random bytes (256 bits) as base64url: session and email tokens. */
export function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}
```

#### Create `apps/server/src/adapters/password-hasher.test.ts`

```ts
import { expect, test } from "bun:test";
import { argon2idHasher } from "./password-hasher.ts";
import { randomToken } from "./random-token.ts";

test("hashes with argon2id and verifies only the right password", async () => {
  const hash = await argon2idHasher.hash("correct horse");
  expect(hash).toStartWith("$argon2id$v=19$m=19456,t=2,");
  expect(await argon2idHasher.verify("correct horse", hash)).toBe(true);
  expect(await argon2idHasher.verify("wrong horse", hash)).toBe(false);
  expect(await argon2idHasher.hash("correct horse")).not.toBe(hash); // salted
});

test("random tokens are 32 bytes of base64url and don't repeat", () => {
  const tokens = new Set(Array.from({ length: 100 }, randomToken));
  expect(tokens.size).toBe(100);
  for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
});
```

#### Create `apps/server/src/adapters/rate-limiter.ts`

```ts
import type { Clock, RateDecision, RateLimiter, RateRule } from "../ports.ts";

/** From this many keys on, ended windows are dropped, at most once per `PRUNE_EVERY_MS`. */
const PRUNE_AT = 10_000;
const PRUNE_EVERY_MS = 60_000;

/**
 * Fixed-window counters in memory. Enough for the single API process; the counts reset when it
 * restarts.
 */
export class MemoryRateLimiter implements RateLimiter {
  readonly #clock: Clock;
  readonly #windows = new Map<string, { start: number; windowMs: number; count: number }>();
  #lastPruneAt = Number.NEGATIVE_INFINITY;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  /** How many keys are being counted. */
  get size(): number {
    return this.#windows.size;
  }

  hit(key: string, rule: RateRule): RateDecision {
    const now = this.#clock.now();
    if (this.#windows.size >= PRUNE_AT && now - this.#lastPruneAt >= PRUNE_EVERY_MS) {
      this.#lastPruneAt = now;
      this.#prune(now);
    }
    let w = this.#windows.get(key);
    if (w === undefined || now >= w.start + w.windowMs) {
      w = { start: now, windowMs: rule.windowMs, count: 0 };
      this.#windows.set(key, w);
    }
    w.count++;
    return w.count <= rule.limit
      ? { allowed: true }
      : { allowed: false, retryAfterMs: w.start + w.windowMs - now };
  }

  #prune(now: number): void {
    for (const [key, w] of this.#windows) {
      if (now >= w.start + w.windowMs) this.#windows.delete(key);
    }
  }
}
```

#### Create `apps/server/src/adapters/rate-limiter.test.ts`

```ts
import { expect, test } from "bun:test";
import { FakeClock } from "../test-support/fakes.ts";
import { MemoryRateLimiter } from "./rate-limiter.ts";

const RULE = { limit: 3, windowMs: 1000 };

test("allows `limit` hits per window, then says how long to wait", () => {
  const clock = new FakeClock(0);
  const limiter = new MemoryRateLimiter(clock);
  for (let i = 0; i < 3; i++) expect(limiter.hit("k", RULE)).toEqual({ allowed: true });
  clock.advance(400);
  expect(limiter.hit("k", RULE)).toEqual({ allowed: false, retryAfterMs: 600 });
  clock.advance(600);
  expect(limiter.hit("k", RULE)).toEqual({ allowed: true });
});

test("counts each key on its own", () => {
  const limiter = new MemoryRateLimiter(new FakeClock(0));
  for (let i = 0; i < 3; i++) limiter.hit("a", RULE);
  expect(limiter.hit("a", RULE).allowed).toBe(false);
  expect(limiter.hit("b", RULE).allowed).toBe(true);
});

test("drops ended windows once it holds many keys, at most once a minute", () => {
  const clock = new FakeClock(0);
  const limiter = new MemoryRateLimiter(clock);
  for (let i = 0; i < 10_000; i++) limiter.hit(`k${i}`, RULE);
  clock.advance(1000);
  limiter.hit("a", RULE); // all 10,000 windows have ended: pruned
  expect(limiter.size).toBe(1);
  for (let i = 0; i < 10_000; i++) limiter.hit(`m${i}`, RULE);
  clock.advance(1000);
  limiter.hit("b", RULE); // less than a minute since the last prune: no scan
  expect(limiter.size).toBe(10_002);
  clock.advance(60_000);
  limiter.hit("c", RULE);
  expect(limiter.size).toBe(1);
});
```

#### Create `apps/server/src/adapters/mail/smtp-mailer.ts`

```ts
import { createTransport } from "nodemailer";
import type { Mailer, MailMessage } from "../../ports.ts";

export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  /** TLS from the start (port 465). Otherwise STARTTLS is used when the server offers it. */
  readonly secure: boolean;
  /** Both or neither; Mailpit needs none. */
  readonly user: string | undefined;
  readonly password: string | undefined;
  /** The From header, such as `Loophole <no-reply@example.com>`. */
  readonly from: string;
}

/** Sends mail over SMTP with nodemailer: Mailpit in development, any SMTP server in production. */
export class SmtpMailer implements Mailer {
  readonly #transport;
  readonly #from: string;

  constructor(settings: SmtpSettings) {
    this.#from = settings.from;
    this.#transport = createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth:
        settings.user === undefined
          ? undefined
          : { user: settings.user, pass: settings.password ?? "" },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.#transport.sendMail({
      from: this.#from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}
```

#### Create `apps/server/src/adapters/mail/memory-mailer.ts`

```ts
import type { Mailer, MailMessage } from "../../ports.ts";

/** Keeps sent mail in a list, for tests and the OpenAPI document. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}
```

#### Create `apps/server/src/adapters/mail/background-mailer.ts`

```ts
import type { Mailer, MailMessage } from "../../ports.ts";

/**
 * Hands mail to `inner` without waiting for it: `send` resolves at once, and a failure is only
 * logged. The API then answers before the SMTP round trip, so neither its timing nor an SMTP error
 * shows whether an email has an account. The log line leaves out the message, which holds a token.
 */
export class BackgroundMailer implements Mailer {
  readonly #inner: Mailer;

  constructor(inner: Mailer) {
    this.#inner = inner;
  }

  async send(message: MailMessage): Promise<void> {
    this.#inner.send(message).catch((err: unknown) => {
      console.error(`Sending mail failed: ${reason(err)}`);
    });
  }
}

/** A short reason. A refused connection is an AggregateError with an empty message but a code. */
function reason(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = (err as { code?: unknown }).code;
  return err.message || (typeof code === "string" ? code : err.name);
}
```

#### Create `apps/server/src/adapters/mail/background-mailer.test.ts`

```ts
import { expect, spyOn, test } from "bun:test";
import type { Mailer, MailMessage } from "../../ports.ts";
import { BackgroundMailer } from "./background-mailer.ts";

const MESSAGE: MailMessage = {
  to: "ann@example.com",
  subject: "Confirm your email for Loophole",
  text: "http://web.test/verify-email#token=secret-token",
};

test("resolves before the inner mailer is done, and passes the message on", async () => {
  const sent: MailMessage[] = [];
  let finish = () => {};
  const inner: Mailer = {
    send: (message) =>
      new Promise<void>((resolve) => {
        finish = () => {
          sent.push(message);
          resolve();
        };
      }),
  };
  await new BackgroundMailer(inner).send(MESSAGE);
  expect(sent).toEqual([]);
  finish();
  expect(sent).toEqual([MESSAGE]);
});

test("a failure is logged without the message and never reaches the caller", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  const inner: Mailer = {
    send: async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:1025");
    },
  };
  await new BackgroundMailer(inner).send(MESSAGE);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(log).toHaveBeenCalledTimes(1);
  const line = String(log.mock.calls[0][0]);
  expect(line).toBe("Sending mail failed: connect ECONNREFUSED 127.0.0.1:1025");
  expect(line).not.toContain("secret-token");
  expect(line).not.toContain(MESSAGE.to);
  log.mockRestore();
});

test("a refused connection is logged by its code", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  const refused = Object.assign(new AggregateError([], ""), { code: "ECONNREFUSED" });
  const inner: Mailer = { send: () => Promise.reject(refused) };
  await new BackgroundMailer(inner).send(MESSAGE);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(log.mock.calls[0][0]).toBe("Sending mail failed: ECONNREFUSED");
  log.mockRestore();
});
```

#### Create `apps/server/src/adapters/mail/smtp-mailer.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { SmtpMailer } from "./smtp-mailer.ts";

// Sends through Mailpit from docker-compose.yml and reads the message back from its API. Skipped
// when Mailpit isn't running, as in CI.
const MAILPIT_API = "http://127.0.0.1:8025/api/v1";

async function reachable(): Promise<boolean> {
  try {
    return (await fetch(`${MAILPIT_API}/info`, { signal: AbortSignal.timeout(500) })).ok;
  } catch {
    return false;
  }
}

const available = await reachable();

describe.skipIf(!available)("SmtpMailer against Mailpit", () => {
  test("delivers a plain-text message", async () => {
    const to = `mailer-${crypto.randomUUID()}@loophole.test`;
    const mailer = new SmtpMailer({
      host: "127.0.0.1",
      port: 1025,
      secure: false,
      user: undefined,
      password: undefined,
      from: "Loophole <no-reply@loophole.test>",
    });
    await mailer.send({
      to,
      subject: "Hello from the test",
      text: "Line one\nhttp://x.test/#token=abc",
    });

    const search = await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await search.json()) as { messages: { ID: string; Subject: string }[] };
    expect(messages.map((m) => m.Subject)).toEqual(["Hello from the test"]);
    const message = (await (await fetch(`${MAILPIT_API}/message/${messages[0].ID}`)).json()) as {
      From: { Address: string };
      Text: string;
    };
    expect(message.From.Address).toBe("no-reply@loophole.test");
    expect(message.Text).toContain("http://x.test/#token=abc");
    await fetch(`${MAILPIT_API}/messages`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ IDs: [messages[0].ID] }),
    });
  });
});
```

#### Create `apps/server/src/adapters/captcha/turnstile.ts`

```ts
import type { CaptchaVerifier } from "../../ports.ts";

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Cloudflare's documented test keys: the site key always passes and the secret accepts it. */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
export const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

export interface TurnstileOptions {
  readonly secretKey: string;
  /** Default the global `fetch`. Tests pass their own. */
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  /**
   * The site's hostname. When set, a token solved on another site is refused. Leave it out with
   * the test secret, which answers for "example.com".
   */
  readonly expectedHostname?: string;
}

/** Checks Turnstile tokens with Cloudflare's siteverify endpoint (PRD FR-19). */
export class TurnstileVerifier implements CaptchaVerifier {
  readonly #secretKey: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #expectedHostname: string | undefined;

  constructor(options: TurnstileOptions) {
    this.#secretKey = options.secretKey;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    this.#expectedHostname = options.expectedHostname;
  }

  async verify(token: string, remoteIp: string | null): Promise<boolean> {
    const body = new URLSearchParams({ secret: this.#secretKey, response: token });
    if (remoteIp !== null) body.set("remoteip", remoteIp);
    try {
      const res = await this.#fetch(TURNSTILE_VERIFY_URL, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (!res.ok) {
        console.error(`Turnstile siteverify answered HTTP ${res.status}`);
        return false;
      }
      const data = (await res.json()) as { success?: unknown; hostname?: unknown };
      if (data.success !== true) return false;
      return this.#expectedHostname === undefined || data.hostname === this.#expectedHostname;
    } catch (err) {
      console.error("Turnstile siteverify failed:", err);
      return false;
    }
  }
}
```

#### Create `apps/server/src/adapters/captcha/turnstile.test.ts`

```ts
import { describe, expect, spyOn, test } from "bun:test";
import { TURNSTILE_VERIFY_URL, TurnstileVerifier } from "./turnstile.ts";

/** A fetch that answers with `status` and `body` and records what it was sent. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; form: URLSearchParams }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, form: init.body as URLSearchParams });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("TurnstileVerifier", () => {
  test("posts the secret, token and address to siteverify and reads `success`", async () => {
    const { fetch, calls } = fakeFetch(200, { success: true, "error-codes": [] });
    const verifier = new TurnstileVerifier({ secretKey: "secret", fetch });
    expect(await verifier.verify("tok", "203.0.113.5")).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TURNSTILE_VERIFY_URL);
    expect(Object.fromEntries(calls[0].form)).toEqual({
      secret: "secret",
      response: "tok",
      remoteip: "203.0.113.5",
    });
  });

  test("with an expected hostname, refuses a token solved on another site", async () => {
    const ours = fakeFetch(200, { success: true, hostname: "loophole.example" });
    const theirs = fakeFetch(200, { success: true, hostname: "evil.example" });
    const options = { secretKey: "s", expectedHostname: "loophole.example" };
    expect(await new TurnstileVerifier({ ...options, fetch: ours.fetch }).verify("t", null)).toBe(
      true,
    );
    expect(await new TurnstileVerifier({ ...options, fetch: theirs.fetch }).verify("t", null)).toBe(
      false,
    );
  });

  test("leaves out an unknown address", async () => {
    const { fetch, calls } = fakeFetch(200, { success: true });
    await new TurnstileVerifier({ secretKey: "s", fetch }).verify("tok", null);
    expect(calls[0].form.has("remoteip")).toBe(false);
  });

  test("a refused token, an HTTP error or a network failure is false", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    const refused = fakeFetch(200, { success: false, "error-codes": ["invalid-input-response"] });
    expect(
      await new TurnstileVerifier({ secretKey: "s", fetch: refused.fetch }).verify("t", null),
    ).toBe(false);
    const broken = fakeFetch(500, {});
    expect(
      await new TurnstileVerifier({ secretKey: "s", fetch: broken.fetch }).verify("t", null),
    ).toBe(false);
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;
    expect(await new TurnstileVerifier({ secretKey: "s", fetch: offline }).verify("t", null)).toBe(
      false,
    );
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
});
```

#### Check

```sh
grep '"nodemailer": "10.1.0"' apps/server/package.json
bun test apps/server/src/adapters   # 0 fail; 13 new tests, the SMTP one skipped unless Mailpit runs
bun run check
```

#### Commit

```sh
git add -A && git commit -m "feat(server): add password, mail, CAPTCHA and rate limit adapters"
```

### Step 4 — Session and account managers, with fakes

The business logic: sign-up, login, verification, reset and deletion in `AccountManager`; cookie sessions in `SessionManager`. Only ports, domain types and other managers are imported, so the manager lint rule holds. `fakes.ts` gains in-memory users, sessions and tokens, a fake hasher and a fake CAPTCHA.

#### Append to the end of `apps/server/src/managers/errors.ts`

```ts
/** The email and password don't match an account. Says nothing about which one was wrong. */
export class InvalidCredentialsError extends Error {
  constructor() {
    super("The email or password is wrong.");
    this.name = "InvalidCredentialsError";
  }
}

/** The sign-up form's CAPTCHA token was refused. */
export class CaptchaFailedError extends Error {
  constructor() {
    super("The CAPTCHA check failed. Try again.");
    this.name = "CaptchaFailedError";
  }
}

/** An email verification or password reset link is unknown, used or expired. */
export class InvalidTokenError extends Error {
  constructor() {
    super("This link is invalid or has expired.");
    this.name = "InvalidTokenError";
  }
}

/** Too many attempts for this account or address; try again after `retryAfterMs`. */
export class RateLimitedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("Too many attempts. Try again later.");
    this.name = "RateLimitedError";
  }
}
```

Keep one blank line between the file's last existing line and the appended text.

#### Create `apps/server/src/managers/hash-token.ts`

```ts
/**
 * SHA-256 of a random token, as hex. Session and email tokens are stored only as this hash, so a
 * leaked database can't be used to log in or reset passwords. A fast hash is enough because the
 * tokens are 256-bit random values, not passwords.
 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
```

#### Create `apps/server/src/managers/session-manager.ts`

```ts
import type { UserRecord } from "../domain.ts";
import type { Clock, SessionRepository, UserRepository } from "../ports.ts";
import { hashToken } from "./hash-token.ts";

export interface SessionManagerDeps {
  readonly sessions: SessionRepository;
  readonly users: UserRepository;
  readonly clock: Clock;
  /** A new random token (256 bits). */
  readonly newToken: () => string;
  /** How long a session lasts from login. */
  readonly ttlMs: number;
}

export interface NewSession {
  /** Goes in the cookie; never stored. */
  readonly token: string;
  readonly expiresAt: number;
}

/**
 * Login sessions: an opaque random token in the cookie, its hash in the database, a fixed
 * lifetime from login.
 */
export class SessionManager {
  readonly #deps: SessionManagerDeps;

  constructor(deps: SessionManagerDeps) {
    this.#deps = deps;
  }

  /** Starts a session for `userId`. Also clears out expired sessions. */
  async create(userId: string): Promise<NewSession> {
    const { sessions, clock, newToken, ttlMs } = this.#deps;
    const now = clock.now();
    sessions.deleteExpired(now);
    const token = newToken();
    const expiresAt = now + ttlMs;
    sessions.insert({ tokenHash: await hashToken(token), userId, createdAt: now, expiresAt });
    return { token, expiresAt };
  }

  /** The user a session token belongs to, or null when it is unknown or expired. */
  async authenticate(token: string): Promise<UserRecord | null> {
    const { sessions, users, clock } = this.#deps;
    const tokenHash = await hashToken(token);
    const session = sessions.get(tokenHash);
    if (session === null) return null;
    if (session.expiresAt <= clock.now()) {
      sessions.delete(tokenHash);
      return null;
    }
    return users.get(session.userId);
  }

  /** Ends one session (logout). Unknown tokens are ignored. */
  async end(token: string): Promise<void> {
    this.#deps.sessions.delete(await hashToken(token));
  }

  /** Ends every session of a user, such as after a password reset. */
  endAll(userId: string): void {
    this.#deps.sessions.deleteForUser(userId);
  }
}
```

#### Create `apps/server/src/managers/account-manager.ts`

```ts
import type { AccountTokenPurpose, UserRecord } from "../domain.ts";
import type {
  AccountTokenRepository,
  CaptchaVerifier,
  Clock,
  Mailer,
  PasswordHasher,
  RateLimiter,
  RateRule,
  UserRepository,
} from "../ports.ts";
import {
  CaptchaFailedError,
  InvalidCredentialsError,
  InvalidTokenError,
  RateLimitedError,
} from "./errors.ts";
import { hashToken } from "./hash-token.ts";
import type { NewSession, SessionManager } from "./session-manager.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Login attempts per email, whoever makes them (also counts account deletion attempts). It stops
 * password guessing spread over many addresses, at a price: anyone who knows an email can keep
 * that account from logging in by sending 10 bad attempts every 15 minutes (DECISIONS).
 */
export const LOGIN_PER_EMAIL: RateRule = { limit: 10, windowMs: 15 * MINUTE };
/** Mails per address; more are dropped silently, so nobody can flood an inbox. */
export const MAIL_PER_EMAIL: RateRule = { limit: 3, windowMs: HOUR };
export const VERIFY_TOKEN_TTL_MS = 24 * HOUR;
export const RESET_TOKEN_TTL_MS = HOUR;

export interface AccountManagerDeps {
  readonly users: UserRepository;
  readonly tokens: AccountTokenRepository;
  readonly sessions: SessionManager;
  readonly passwords: PasswordHasher;
  readonly captcha: CaptchaVerifier;
  readonly mailer: Mailer;
  readonly limiter: RateLimiter;
  readonly clock: Clock;
  readonly newId: () => string;
  /** A new random token (256 bits). */
  readonly newToken: () => string;
  /** Origin of the web app, without a trailing slash, for links in mail. */
  readonly publicUrl: string;
}

export interface SignUpRequest {
  readonly email: string;
  readonly password: string;
  readonly captchaToken: string;
  /** The client's address, passed on to the CAPTCHA check when known. */
  readonly remoteIp: string | null;
}

/** Emails are compared trimmed and lower-cased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Sign-up, login, email verification, password reset and account deletion (PRD FR-18 to FR-20,
 * NFR-6). Answers never reveal whether an email has an account: sign-up, resend and reset requests
 * all look the same from outside, and a wrong email fails login exactly like a wrong password.
 */
export class AccountManager {
  readonly #deps: AccountManagerDeps;
  #dummyHash: Promise<string> | null = null;

  constructor(deps: AccountManagerDeps) {
    this.#deps = deps;
  }

  /**
   * Creates an unverified account and mails a verification link. When the email already has an
   * account, mails that account a note instead. Throws `CaptchaFailedError`.
   */
  async signUp(request: SignUpRequest): Promise<void> {
    const { users, passwords, captcha, clock, newId } = this.#deps;
    if (!(await captcha.verify(request.captchaToken, request.remoteIp))) {
      throw new CaptchaFailedError();
    }
    const email = normalizeEmail(request.email);
    // Hash before looking at the email, so both outcomes take the same time.
    const passwordHash = await passwords.hash(request.password);
    const user: UserRecord = {
      id: newId(),
      email,
      passwordHash,
      emailVerifiedAt: null,
      isAdmin: false,
      createdAt: clock.now(),
    };
    if (users.insert(user)) await this.#sendVerification(user);
    else await this.#mail(email, alreadyRegisteredMail(this.#deps.publicUrl));
  }

  /**
   * Checks the password and starts a new session, ending `previousToken`'s session if one was
   * sent (a new token on every login). Throws `InvalidCredentialsError` or `RateLimitedError`.
   */
  async logIn(
    emailInput: string,
    password: string,
    previousToken: string | null,
  ): Promise<{ user: UserRecord; session: NewSession }> {
    const { users, sessions } = this.#deps;
    const email = normalizeEmail(emailInput);
    this.#limit(`login:${email}`, LOGIN_PER_EMAIL);
    const user = users.getByEmail(email);
    if (!(await this.#checkPassword(user, password)) || user === null) {
      throw new InvalidCredentialsError();
    }
    if (previousToken !== null) await sessions.end(previousToken);
    return { user, session: await sessions.create(user.id) };
  }

  /** Marks the email of the link's account verified. Throws `InvalidTokenError`. */
  async verifyEmail(token: string): Promise<void> {
    const userId = await this.#takeToken(token, "verify-email");
    this.#deps.users.markEmailVerified(userId, this.#deps.clock.now());
  }

  /** Mails a new verification link if the email has an unverified account; otherwise nothing. */
  async resendVerification(emailInput: string): Promise<void> {
    const user = this.#deps.users.getByEmail(normalizeEmail(emailInput));
    if (user !== null && user.emailVerifiedAt === null) await this.#sendVerification(user);
  }

  /** Mails a password reset link if the email has an account; otherwise nothing. */
  async requestPasswordReset(emailInput: string): Promise<void> {
    const user = this.#deps.users.getByEmail(normalizeEmail(emailInput));
    if (user === null) return;
    const token = await this.#issueToken(user.id, "reset-password", RESET_TOKEN_TTL_MS);
    await this.#mail(
      user.email,
      resetMail(`${this.#deps.publicUrl}/reset-password#token=${token}`),
    );
  }

  /**
   * Sets a new password from a reset link and ends every session of the account. The link proves
   * the user reads that inbox, so the email counts as verified too. Throws `InvalidTokenError`.
   */
  async resetPassword(token: string, password: string): Promise<void> {
    const { users, passwords, sessions, clock } = this.#deps;
    const userId = await this.#takeToken(token, "reset-password");
    users.setPasswordHash(userId, await passwords.hash(password));
    users.markEmailVerified(userId, clock.now());
    sessions.endAll(userId);
  }

  /**
   * Deletes the account and everything stored for it (NFR-6), after checking the password.
   * Throws `InvalidCredentialsError` or `RateLimitedError`.
   */
  async deleteAccount(userId: string, password: string): Promise<void> {
    const { users } = this.#deps;
    const user = users.get(userId);
    if (user === null) throw new InvalidCredentialsError();
    this.#limit(`login:${user.email}`, LOGIN_PER_EMAIL);
    if (!(await this.#checkPassword(user, password))) throw new InvalidCredentialsError();
    users.delete(userId);
  }

  /** Verifies against a throwaway hash when there is no user, so unknown emails take as long. */
  async #checkPassword(user: UserRecord | null, password: string): Promise<boolean> {
    const { passwords } = this.#deps;
    if (user !== null) return passwords.verify(password, user.passwordHash);
    this.#dummyHash ??= passwords.hash("not anybody's password");
    await passwords.verify(password, await this.#dummyHash);
    return false;
  }

  async #sendVerification(user: UserRecord): Promise<void> {
    const token = await this.#issueToken(user.id, "verify-email", VERIFY_TOKEN_TTL_MS);
    await this.#mail(user.email, verifyMail(`${this.#deps.publicUrl}/verify-email#token=${token}`));
  }

  async #issueToken(userId: string, purpose: AccountTokenPurpose, ttlMs: number): Promise<string> {
    const { tokens, clock, newToken } = this.#deps;
    const now = clock.now();
    tokens.deleteExpired(now);
    const token = newToken();
    tokens.replace({
      tokenHash: await hashToken(token),
      userId,
      purpose,
      createdAt: now,
      expiresAt: now + ttlMs,
    });
    return token;
  }

  /** Uses up a token and returns its user's id. Throws `InvalidTokenError`. */
  async #takeToken(token: string, purpose: AccountTokenPurpose): Promise<string> {
    const { tokens, clock } = this.#deps;
    const record = tokens.take(await hashToken(token), purpose);
    if (record === null || record.expiresAt <= clock.now()) throw new InvalidTokenError();
    return record.userId;
  }

  async #mail(to: string, mail: { subject: string; text: string }): Promise<void> {
    if (!this.#deps.limiter.hit(`mail:${to}`, MAIL_PER_EMAIL).allowed) return;
    await this.#deps.mailer.send({ to, ...mail });
  }

  #limit(key: string, rule: RateRule): void {
    const decision = this.#deps.limiter.hit(key, rule);
    if (!decision.allowed) throw new RateLimitedError(decision.retryAfterMs);
  }
}

function verifyMail(link: string) {
  return {
    subject: "Confirm your email for Loophole",
    text: `Welcome to Loophole.\n\nOpen this link to confirm your email address. It works once and expires in 24 hours.\n\n${link}\n\nIf you didn't sign up, ignore this email.\n`,
  };
}

function resetMail(link: string) {
  return {
    subject: "Reset your Loophole password",
    text: `Someone asked to reset the password for this email address on Loophole.\n\nOpen this link to choose a new password. It works once and expires in 1 hour.\n\n${link}\n\nIf it wasn't you, ignore this email; your password stays as it is.\n`,
  };
}

function alreadyRegisteredMail(publicUrl: string) {
  return {
    subject: "You already have a Loophole account",
    text: `Someone tried to sign up for Loophole with this email address, but it already has an account.\n\nLog in: ${publicUrl}/login\nForgot your password? ${publicUrl}/forgot-password\n\nIf it wasn't you, ignore this email.\n`,
  };
}
```

#### Replace the whole of `apps/server/src/test-support/fakes.ts` with

```ts
import type {
  AccountTokenPurpose,
  AccountTokenRecord,
  Job,
  PuzzleRecord,
  SessionRecord,
  Task,
  TaskOutcome,
  UserRecord,
} from "../domain.ts";
import type {
  AccountTokenRepository,
  CaptchaVerifier,
  Clock,
  JobEnd,
  JobQueue,
  NewJob,
  PasswordHasher,
  PuzzleRepository,
  SessionRepository,
  TaskRunner,
  TaskRunOptions,
  UserRepository,
} from "../ports.ts";

/** A clock that only moves when told to. */
export class FakeClock implements Clock {
  constructor(public time = 1_000_000) {}

  now(): number {
    return this.time;
  }

  advance(ms: number): void {
    this.time += ms;
  }
}

/** Ids "id-1", "id-2", … in order. */
export function sequentialIds(prefix = "id"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

export class FakePuzzleRepository implements PuzzleRepository {
  readonly records = new Map<string, PuzzleRecord>();

  insert(record: PuzzleRecord): void {
    if (!this.records.has(record.id)) this.records.set(record.id, record);
  }

  get(id: string): PuzzleRecord | null {
    return this.records.get(id) ?? null;
  }

  listPublished(limit: number): PuzzleRecord[] {
    return [...this.records.values()]
      .filter((r) => r.status === "published")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }
}

/** The jobs table in a Map, with the same claim rules as the SQLite queue. */
export class FakeJobQueue implements JobQueue {
  readonly jobs = new Map<string, Job>();
  /** Every progress write, in order. */
  readonly progressWrites: { id: string; progress: number; at: number }[] = [];
  heartbeats = 0;

  enqueue({ id, job, createdAt }: NewJob): Job {
    const stored = {
      ...job,
      id,
      status: "queued",
      progress: 0,
      result: null,
      error: null,
      attempts: 0,
      claimedBy: null,
      createdAt,
      startedAt: null,
      heartbeatAt: null,
      finishedAt: null,
    } as Job;
    this.jobs.set(id, stored);
    return stored;
  }

  get(id: string): Job | null {
    return this.jobs.get(id) ?? null;
  }

  countQueued(): number {
    return [...this.jobs.values()].filter((j) => j.status === "queued").length;
  }

  claimNext(workerId: string, now: number): Job | null {
    const next = [...this.jobs.values()].find((j) => j.status === "queued");
    if (next === undefined) return null;
    return this.#update(next.id, {
      status: "running",
      claimedBy: workerId,
      attempts: next.attempts + 1,
      startedAt: now,
      heartbeatAt: now,
      progress: 0,
    });
  }

  setProgress(id: string, workerId: string, progress: number, now: number): void {
    if (!this.#holds(id, workerId)) return;
    this.progressWrites.push({ id, progress, at: now });
    this.#update(id, { progress, heartbeatAt: now });
  }

  heartbeat(id: string, workerId: string, now: number): void {
    if (!this.#holds(id, workerId)) return;
    this.heartbeats++;
    this.#update(id, { heartbeatAt: now });
  }

  finish(id: string, workerId: string, end: JobEnd, now: number): boolean {
    if (!this.#holds(id, workerId)) return false;
    this.#update(
      id,
      end.status === "done"
        ? { status: "done", progress: 1, result: end.result, finishedAt: now }
        : { status: end.status, error: end.error, finishedAt: now },
    );
    return true;
  }

  recoverStale(staleBefore: number, maxAttempts: number, now: number): number {
    let changed = 0;
    for (const job of this.jobs.values()) {
      if (job.status !== "running" || (job.heartbeatAt ?? 0) >= staleBefore) continue;
      changed++;
      if (job.attempts >= maxAttempts) {
        this.#update(job.id, { status: "failed", error: "stale", finishedAt: now });
      } else {
        this.#update(job.id, { status: "queued", claimedBy: null, progress: 0 });
      }
    }
    return changed;
  }

  #holds(id: string, workerId: string): boolean {
    const job = this.jobs.get(id);
    return job?.status === "running" && job.claimedBy === workerId;
  }

  #update(id: string, changes: Partial<Job>): Job {
    const job = { ...this.jobs.get(id), ...changes } as Job;
    this.jobs.set(id, job);
    return job;
  }
}

/** A task runner whose behaviour each test scripts. Records the tasks and options it got. */
export class FakeTaskRunner implements TaskRunner {
  readonly calls: { task: Task; options: TaskRunOptions }[] = [];

  constructor(
    private readonly behave: (task: Task, options: TaskRunOptions) => Promise<TaskOutcome>,
  ) {}

  run(task: Task, options: TaskRunOptions): Promise<TaskOutcome> {
    this.calls.push({ task, options });
    return this.behave(task, options);
  }
}

/** "Hashes" by prefixing, so tests stay fast and can read what was stored. */
export const fakePasswordHasher: PasswordHasher = {
  hash: async (password) => `hashed:${password}`,
  verify: async (password, hash) => hash === `hashed:${password}`,
};

/** Accepts every token while `ok` is true. Records the calls. */
export class FakeCaptcha implements CaptchaVerifier {
  readonly calls: { token: string; remoteIp: string | null }[] = [];

  constructor(public ok = true) {}

  async verify(token: string, remoteIp: string | null): Promise<boolean> {
    this.calls.push({ token, remoteIp });
    return this.ok;
  }
}

export class FakeUserRepository implements UserRepository {
  readonly users = new Map<string, UserRecord>();

  insert(user: UserRecord): boolean {
    if (this.getByEmail(user.email) !== null) return false;
    this.users.set(user.id, user);
    return true;
  }

  get(id: string): UserRecord | null {
    return this.users.get(id) ?? null;
  }

  getByEmail(email: string): UserRecord | null {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }

  setPasswordHash(id: string, passwordHash: string): void {
    this.#update(id, { passwordHash });
  }

  markEmailVerified(id: string, at: number): void {
    if (this.users.get(id)?.emailVerifiedAt === null) this.#update(id, { emailVerifiedAt: at });
  }

  setAdmin(email: string, isAdmin: boolean): boolean {
    const user = this.getByEmail(email);
    if (user === null) return false;
    this.#update(user.id, { isAdmin });
    return true;
  }

  delete(id: string): void {
    this.users.delete(id);
  }

  #update(id: string, changes: Partial<UserRecord>): void {
    const user = this.users.get(id);
    if (user !== undefined) this.users.set(id, { ...user, ...changes });
  }
}

export class FakeSessionRepository implements SessionRepository {
  readonly sessions = new Map<string, SessionRecord>();

  insert(session: SessionRecord): void {
    this.sessions.set(session.tokenHash, session);
  }

  get(tokenHash: string): SessionRecord | null {
    return this.sessions.get(tokenHash) ?? null;
  }

  delete(tokenHash: string): void {
    this.sessions.delete(tokenHash);
  }

  deleteForUser(userId: string): void {
    for (const s of this.sessions.values()) if (s.userId === userId) this.delete(s.tokenHash);
  }

  deleteExpired(now: number): void {
    for (const s of this.sessions.values()) if (s.expiresAt <= now) this.delete(s.tokenHash);
  }
}

export class FakeAccountTokenRepository implements AccountTokenRepository {
  readonly tokens = new Map<string, AccountTokenRecord>();

  replace(token: AccountTokenRecord): void {
    for (const t of this.tokens.values()) {
      if (t.userId === token.userId && t.purpose === token.purpose) this.tokens.delete(t.tokenHash);
    }
    this.tokens.set(token.tokenHash, token);
  }

  take(tokenHash: string, purpose: AccountTokenPurpose): AccountTokenRecord | null {
    const token = this.tokens.get(tokenHash);
    if (token === undefined || token.purpose !== purpose) return null;
    this.tokens.delete(tokenHash);
    return token;
  }

  deleteExpired(now: number): void {
    for (const t of this.tokens.values()) if (t.expiresAt <= now) this.tokens.delete(t.tokenHash);
  }
}
```

#### Create `apps/server/src/managers/session-manager.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import {
  FakeClock,
  FakeSessionRepository,
  FakeUserRepository,
  sequentialIds,
} from "../test-support/fakes.ts";
import { hashToken } from "./hash-token.ts";
import { SessionManager } from "./session-manager.ts";

function setup() {
  const clock = new FakeClock(1_000);
  const users = new FakeUserRepository();
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
  const repo = new FakeSessionRepository();
  const sessions = new SessionManager({
    sessions: repo,
    users,
    clock,
    newToken: sequentialIds("tok"),
    ttlMs: 500,
  });
  return { clock, repo, sessions };
}

describe("SessionManager", () => {
  test("create stores only the token's hash; authenticate finds the user", async () => {
    const { repo, sessions } = setup();
    expect(await sessions.create("u1")).toEqual({ token: "tok-1", expiresAt: 1_500 });
    expect([...repo.sessions.keys()]).toEqual([await hashToken("tok-1")]);
    expect((await sessions.authenticate("tok-1"))?.id).toBe("u1");
    expect(await sessions.authenticate("tok-2")).toBeNull();
  });

  test("hashToken is SHA-256 in hex", async () => {
    expect(await hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("an expired session no longer authenticates and is removed", async () => {
    const { clock, repo, sessions } = setup();
    await sessions.create("u1");
    clock.advance(499);
    expect(await sessions.authenticate("tok-1")).not.toBeNull();
    clock.advance(1);
    expect(await sessions.authenticate("tok-1")).toBeNull();
    expect(repo.sessions.size).toBe(0);
  });

  test("end logs one session out; endAll logs a user out everywhere", async () => {
    const { sessions } = setup();
    await sessions.create("u1");
    await sessions.create("u1");
    await sessions.create("u2");
    await sessions.end("tok-1");
    expect(await sessions.authenticate("tok-1")).toBeNull();
    expect(await sessions.authenticate("tok-2")).not.toBeNull();
    sessions.endAll("u1");
    expect(await sessions.authenticate("tok-2")).toBeNull();
    expect((await sessions.authenticate("tok-3"))?.id).toBe("u2");
  });

  test("create clears out expired sessions", async () => {
    const { clock, repo, sessions } = setup();
    await sessions.create("u1");
    clock.advance(600);
    await sessions.create("u2");
    expect(repo.sessions.size).toBe(1);
  });
});
```

#### Create `apps/server/src/managers/account-manager.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { MemoryMailer } from "../adapters/mail/memory-mailer.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import {
  FakeAccountTokenRepository,
  FakeCaptcha,
  FakeClock,
  FakeSessionRepository,
  FakeUserRepository,
  fakePasswordHasher,
  sequentialIds,
} from "../test-support/fakes.ts";
import {
  AccountManager,
  normalizeEmail,
  RESET_TOKEN_TTL_MS,
  VERIFY_TOKEN_TTL_MS,
} from "./account-manager.ts";
import {
  CaptchaFailedError,
  InvalidCredentialsError,
  InvalidTokenError,
  RateLimitedError,
} from "./errors.ts";
import { SessionManager } from "./session-manager.ts";

function setup() {
  const clock = new FakeClock(1_000_000);
  const users = new FakeUserRepository();
  const tokens = new FakeAccountTokenRepository();
  const sessions = new SessionManager({
    sessions: new FakeSessionRepository(),
    users,
    clock,
    newToken: sequentialIds("session"),
    ttlMs: 60_000,
  });
  const mailer = new MemoryMailer();
  const captcha = new FakeCaptcha();
  const accounts = new AccountManager({
    users,
    tokens,
    sessions,
    passwords: fakePasswordHasher,
    captcha,
    mailer,
    limiter: new MemoryRateLimiter(clock),
    clock,
    newId: sequentialIds("u"),
    newToken: sequentialIds("mailed"),
    publicUrl: "http://web.test",
  });
  const signUp = (email = " Ann@Example.com", password = "hunter22") =>
    accounts.signUp({ email, password, captchaToken: "cap", remoteIp: "203.0.113.5" });
  return { clock, users, tokens, sessions, mailer, captcha, accounts, signUp };
}

/** The token from the link in the last mail. */
function lastLinkToken(mailer: MemoryMailer): string {
  const match = mailer.sent.at(-1)?.text.match(/#token=(\S+)/);
  if (!match) throw new Error("no link in the last mail");
  return match[1];
}

describe("AccountManager sign-up and verification", () => {
  test("normalizeEmail trims and lower-cases", () => {
    expect(normalizeEmail("  Ann@Example.COM ")).toBe("ann@example.com");
  });

  test("signUp stores an unverified user with a hashed password and mails a link", async () => {
    const { users, mailer, captcha, signUp } = setup();
    await signUp();
    expect(captcha.calls).toEqual([{ token: "cap", remoteIp: "203.0.113.5" }]);
    expect(users.get("u-1")).toEqual({
      id: "u-1",
      email: "ann@example.com",
      passwordHash: "hashed:hunter22",
      emailVerifiedAt: null,
      isAdmin: false,
      createdAt: 1_000_000,
    });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe("ann@example.com");
    expect(mailer.sent[0].subject).toBe("Confirm your email for Loophole");
    expect(mailer.sent[0].text).toContain("http://web.test/verify-email#token=mailed-1");
  });

  test("a failed CAPTCHA stores and mails nothing", async () => {
    const { users, mailer, captcha, signUp } = setup();
    captcha.ok = false;
    await expect(signUp()).rejects.toBeInstanceOf(CaptchaFailedError);
    expect(users.users.size).toBe(0);
    expect(mailer.sent).toHaveLength(0);
  });

  test("signing up with a taken email changes nothing and mails the owner a note", async () => {
    const { users, mailer, signUp } = setup();
    await signUp();
    await signUp("ann@example.com", "other-password");
    expect(users.users.size).toBe(1);
    expect(users.get("u-1")?.passwordHash).toBe("hashed:hunter22");
    expect(mailer.sent.at(-1)).toMatchObject({
      to: "ann@example.com",
      subject: "You already have a Loophole account",
    });
    expect(mailer.sent.at(-1)?.text).toContain("http://web.test/forgot-password");
    expect(mailer.sent.at(-1)?.text).not.toContain("#token=");
  });

  test("verifyEmail marks the email verified, once", async () => {
    const { clock, users, mailer, accounts, signUp } = setup();
    await signUp();
    const token = lastLinkToken(mailer);
    clock.advance(5);
    await accounts.verifyEmail(token);
    expect(users.get("u-1")?.emailVerifiedAt).toBe(1_000_005);
    await expect(accounts.verifyEmail(token)).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(accounts.verifyEmail("made-up")).rejects.toBeInstanceOf(InvalidTokenError);
  });

  test("a verification link expires after 24 hours", async () => {
    const { clock, users, mailer, accounts, signUp } = setup();
    await signUp();
    clock.advance(VERIFY_TOKEN_TTL_MS);
    await expect(accounts.verifyEmail(lastLinkToken(mailer))).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
    expect(users.get("u-1")?.emailVerifiedAt).toBeNull();
  });

  test("resendVerification replaces the link, and mails only unverified accounts", async () => {
    const { mailer, accounts, signUp } = setup();
    await signUp();
    const first = lastLinkToken(mailer);
    await accounts.resendVerification("ANN@example.com");
    const second = lastLinkToken(mailer);
    expect(second).not.toBe(first);
    await expect(accounts.verifyEmail(first)).rejects.toBeInstanceOf(InvalidTokenError);
    await accounts.verifyEmail(second);
    await accounts.resendVerification("ann@example.com");
    await accounts.resendVerification("nobody@example.com");
    expect(mailer.sent).toHaveLength(2);
  });

  test("at most 3 mails per address per hour; more are dropped silently", async () => {
    const { clock, mailer, accounts, signUp } = setup();
    await signUp();
    for (let i = 0; i < 5; i++) await accounts.resendVerification("ann@example.com");
    expect(mailer.sent).toHaveLength(3);
    clock.advance(60 * 60_000);
    await accounts.resendVerification("ann@example.com");
    expect(mailer.sent).toHaveLength(4);
  });
});

describe("AccountManager login", () => {
  test("logIn checks the password and starts a session, verified or not", async () => {
    const { accounts, sessions, signUp } = setup();
    await signUp();
    const { user, session } = await accounts.logIn("Ann@example.com", "hunter22", null);
    expect(user.id).toBe("u-1");
    expect(session.token).toBe("session-1");
    expect((await sessions.authenticate("session-1"))?.id).toBe("u-1");
  });

  test("a wrong password and an unknown email fail the same way", async () => {
    const { accounts, signUp } = setup();
    await signUp();
    await expect(accounts.logIn("ann@example.com", "nope", null)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    await expect(accounts.logIn("bob@example.com", "hunter22", null)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  test("logging in again replaces the session sent with the request", async () => {
    const { accounts, sessions, signUp } = setup();
    await signUp();
    await accounts.logIn("ann@example.com", "hunter22", null);
    await accounts.logIn("ann@example.com", "hunter22", "session-1");
    expect(await sessions.authenticate("session-1")).toBeNull();
    expect(await sessions.authenticate("session-2")).not.toBeNull();
  });

  test("after 10 attempts in 15 minutes an email is locked for the rest of the window", async () => {
    const { clock, accounts, signUp } = setup();
    await signUp();
    for (let i = 0; i < 10; i++) {
      await expect(accounts.logIn("ann@example.com", "nope", null)).rejects.toBeInstanceOf(
        InvalidCredentialsError,
      );
    }
    clock.advance(60_000);
    const locked = accounts.logIn("ann@example.com", "hunter22", null);
    await expect(locked).rejects.toBeInstanceOf(RateLimitedError);
    await expect(locked).rejects.toMatchObject({ retryAfterMs: 14 * 60_000 });
    clock.advance(14 * 60_000);
    expect((await accounts.logIn("ann@example.com", "hunter22", null)).user.id).toBe("u-1");
  });
});

describe("AccountManager password reset and deletion", () => {
  test("a reset link sets the new password, verifies the email and logs out everywhere", async () => {
    const { mailer, users, accounts, sessions, signUp } = setup();
    await signUp();
    await accounts.logIn("ann@example.com", "hunter22", null);
    await accounts.requestPasswordReset(" ann@EXAMPLE.com");
    expect(mailer.sent.at(-1)?.subject).toBe("Reset your Loophole password");
    expect(mailer.sent.at(-1)?.text).toContain("http://web.test/reset-password#token=");
    const token = lastLinkToken(mailer);
    await accounts.resetPassword(token, "new-password");
    expect(users.get("u-1")?.passwordHash).toBe("hashed:new-password");
    expect(users.get("u-1")?.emailVerifiedAt).not.toBeNull();
    expect(await sessions.authenticate("session-1")).toBeNull();
    await expect(accounts.logIn("ann@example.com", "hunter22", null)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    await accounts.logIn("ann@example.com", "new-password", null);
    await expect(accounts.resetPassword(token, "again-again")).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  test("reset links expire after an hour and are not verification links", async () => {
    const { clock, mailer, accounts, signUp } = setup();
    await signUp();
    await accounts.requestPasswordReset("ann@example.com");
    const token = lastLinkToken(mailer);
    await expect(accounts.verifyEmail(token)).rejects.toBeInstanceOf(InvalidTokenError);
    await accounts.requestPasswordReset("ann@example.com");
    clock.advance(RESET_TOKEN_TTL_MS);
    await expect(
      accounts.resetPassword(lastLinkToken(mailer), "new-password"),
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });

  test("a reset request for an unknown email mails nothing", async () => {
    const { mailer, accounts } = setup();
    await accounts.requestPasswordReset("nobody@example.com");
    expect(mailer.sent).toHaveLength(0);
  });

  test("deleteAccount needs the password, then removes the user", async () => {
    const { users, accounts, sessions, signUp } = setup();
    await signUp();
    await accounts.logIn("ann@example.com", "hunter22", null);
    await expect(accounts.deleteAccount("u-1", "nope")).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(users.get("u-1")).not.toBeNull();
    await accounts.deleteAccount("u-1", "hunter22");
    expect(users.get("u-1")).toBeNull();
    expect(await sessions.authenticate("session-1")).toBeNull();
    await expect(accounts.deleteAccount("u-1", "hunter22")).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });
});
```

#### Check

```sh
bun test apps/server/src/managers   # 0 fail; 21 new tests
bun run check
```

#### Commit

```sh
git add -A && git commit -m "feat(server): add session and account managers"
```

### Step 5 — Settings, account routes, CSRF check, wiring, OpenAPI

New settings with dev defaults; the account routes in their own module (`api/accounts.ts`) with their own schemas; the CSRF middleware on every `/api` request; the session cookie helpers; both composition roots wired; tests. `problemResponse` moves from `app.ts` to `problem.ts` so both route modules share it. Then regenerate the contract.

#### Replace the whole of `apps/server/src/config.ts` with

```ts
import { hostname } from "node:os";
import { z } from "zod";
import type { S3Settings } from "./adapters/blob/s3-blob-store.ts";
import {
  TURNSTILE_TEST_SECRET_KEY,
  TURNSTILE_TEST_SITE_KEY,
} from "./adapters/captcha/turnstile.ts";
import type { SmtpSettings } from "./adapters/mail/smtp-mailer.ts";
import type { JobRunSettings } from "./managers/job-run-manager.ts";

const Port = z.coerce.number().int().min(1).max(65535);
const Ms = z.coerce.number().int().positive();

const EnvSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: Port.default(3000),
  DATABASE_PATH: z.string().min(1).default("data/loophole.sqlite"),
  WEB_DIR: z.string().min(1).optional(),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  WORKER_ID: z.string().min(1).optional(),
  GENERATE_TIMEOUT_MS: Ms.default(60_000),
  VERIFY_TIMEOUT_MS: Ms.default(45_000),
  PUBLIC_URL: z.url().default("http://localhost:5173"),
  TRUST_PROXY: z.stringbool().default(false),
  TURNSTILE_SITE_KEY: z.string().min(1).default(TURNSTILE_TEST_SITE_KEY),
  TURNSTILE_SECRET_KEY: z.string().min(1).default(TURNSTILE_TEST_SECRET_KEY),
  SMTP_HOST: z.string().min(1).default("localhost"),
  SMTP_PORT: Port.default(1025),
  SMTP_SECURE: z.stringbool().default(false),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).default("Loophole <no-reply@loophole.localhost>"),
});

export interface Config {
  readonly host: string;
  readonly port: number;
  /** Relative paths resolve against the working directory: the repo root for the root scripts. */
  readonly databasePath: string;
  readonly webDir: string | undefined;
  readonly s3: S3Settings;
  /** Unique per process: the name (WORKER_ID, or the host) plus the pid, so a reclaimed job's old worker can't match the new one. */
  readonly workerId: string;
  /** How long an idle worker waits before looking for jobs again. */
  readonly pollMs: number;
  /** New jobs are refused while this many are waiting. */
  readonly maxQueuedJobs: number;
  readonly jobs: JobRunSettings;
  /** Origin of the web app, without a trailing slash; links in mail point here. */
  readonly publicUrl: string;
  /** Behind a reverse proxy: take the client's address from the last X-Forwarded-For entry. */
  readonly trustProxy: boolean;
  readonly turnstile: { readonly siteKey: string; readonly secretKey: string };
  readonly smtp: SmtpSettings;
  /** How long a login session lasts. */
  readonly sessionTtlMs: number;
}

/** Reads the server's settings from environment variables (see `.env.example`). Throws on bad values. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(
      `Invalid server settings (copy .env.example to .env at the repo root):\n  ${problems.join("\n  ")}`,
    );
  }
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
  return {
    host: e.HOST,
    port: e.PORT,
    databasePath: e.DATABASE_PATH,
    webDir: e.WEB_DIR,
    s3: {
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      bucket: e.S3_BUCKET,
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
    },
    workerId: `${e.WORKER_ID ?? hostname()}-${process.pid}`,
    pollMs: 500,
    maxQueuedJobs: 100,
    jobs: {
      generateTimeoutMs: e.GENERATE_TIMEOUT_MS,
      verifyTimeoutMs: e.VERIFY_TIMEOUT_MS,
      progressIntervalMs: 500,
      heartbeatMs: 5_000,
      staleMs: 30_000,
      maxAttempts: 3,
    },
    publicUrl: e.PUBLIC_URL.replace(/\/+$/, ""),
    trustProxy: e.TRUST_PROXY,
    turnstile: { siteKey: e.TURNSTILE_SITE_KEY, secretKey: e.TURNSTILE_SECRET_KEY },
    smtp: {
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE,
      user: e.SMTP_USER,
      password: e.SMTP_PASSWORD,
      from: e.MAIL_FROM,
    },
    sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  };
}
```

#### Edit `apps/server/src/config.test.ts`

In `apps/server/src/config.test.ts`, replace

```ts
      jobs: { generateTimeoutMs: 60_000, verifyTimeoutMs: 45_000 },
    });
    expect(config.workerId)
```

with

```ts
      jobs: { generateTimeoutMs: 60_000, verifyTimeoutMs: 45_000 },
      publicUrl: "http://localhost:5173",
      trustProxy: false,
      turnstile: {
        siteKey: "1x00000000000000000000AA",
        secretKey: "1x0000000000000000000000000000000AA",
      },
      smtp: {
        host: "localhost",
        port: 1025,
        secure: false,
        user: undefined,
        password: undefined,
        from: "Loophole <no-reply@loophole.localhost>",
      },
      sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
    });
    expect(config.workerId)
```

#### Edit `apps/server/src/config.test.ts`

In `apps/server/src/config.test.ts`, replace

```ts
  test("names every missing or bad setting", () => {
```

with

```ts
  test("reads the account and mail settings", () => {
    const config = loadConfig({
      ...S3,
      PUBLIC_URL: "https://loophole.example/",
      TRUST_PROXY: "true",
      TURNSTILE_SITE_KEY: "site",
      TURNSTILE_SECRET_KEY: "secret",
      SMTP_HOST: "smtp.example",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
      SMTP_USER: "user",
      SMTP_PASSWORD: "pass",
      MAIL_FROM: "Loophole <hi@loophole.example>",
    });
    expect(config).toMatchObject({
      publicUrl: "https://loophole.example",
      trustProxy: true,
      turnstile: { siteKey: "site", secretKey: "secret" },
      smtp: {
        host: "smtp.example",
        port: 465,
        secure: true,
        user: "user",
        password: "pass",
        from: "Loophole <hi@loophole.example>",
      },
    });
  });

  test("refuses Turnstile's test secret for a site that isn't on localhost", () => {
    expect(() => loadConfig({ ...S3, PUBLIC_URL: "https://loophole.example" })).toThrow(
      /TURNSTILE_SECRET_KEY is Cloudflare's always-pass test key/,
    );
    expect(loadConfig({ ...S3, PUBLIC_URL: "http://127.0.0.1:4174" }).turnstile.secretKey).toBe(
      "1x0000000000000000000000000000000AA",
    );
  });

  test("names every missing or bad setting", () => {
```

#### Replace the whole of `apps/server/src/api/problem.ts` with

```ts
import type { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ProblemSchema } from "./schemas.ts";

export type Problem = z.infer<typeof ProblemSchema>;

/**
 * An `application/problem+json` response (RFC 9457). Built with `c.json` so route handlers
 * type-check against their declared error responses; the header overrides the content type.
 */
export function problem<S extends ContentfulStatusCode>(
  c: Context,
  status: S,
  title: string,
  extra: Pick<Problem, "detail" | "errors"> = {},
) {
  const body: Problem = { type: "about:blank", title, status, ...extra };
  return c.json(body, status, { "Content-Type": "application/problem+json" });
}

/** An error response in a route's OpenAPI definition. */
export const problemResponse = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: ProblemSchema } },
});
```

#### Create `apps/server/src/api/account-schemas.ts`

```ts
import { z } from "@hono/zod-openapi";

// Request and response bodies of the account and session routes (accounts.ts).

const Email = z.email().max(254).openapi({ example: "player@example.com" });

/** Rules for a new password. Login takes any non-empty password up to the same length. */
const NewPassword = z.string().min(8).max(128).openapi({ description: "8 to 128 characters." });

const Password = z.string().min(1).max(128);

const MailedToken = z
  .string()
  .min(1)
  .max(128)
  .openapi({ description: "The token from the link in the email (after `#token=`)." });

export const UserSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
    isAdmin: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .openapi("User", { description: "The logged-in player. Only the email is personal data." });

export const SessionSchema = z
  .object({ user: z.union([UserSchema, z.null()]) })
  .openapi("Session", { description: "`user` is null when no one is logged in." });

export const AuthConfigSchema = z
  .object({
    turnstileSiteKey: z.string().openapi({ description: "Site key for the sign-up CAPTCHA." }),
  })
  .openapi("AuthConfig");

export const SignUpRequestSchema = z
  .strictObject({
    email: Email,
    password: NewPassword,
    captchaToken: z
      .string()
      .min(1)
      .max(2048)
      .openapi({ description: "The token from the Turnstile widget." }),
  })
  .openapi("SignUpRequest");

export const LogInRequestSchema = z
  .strictObject({ email: Email, password: Password })
  .openapi("LogInRequest");

export const EmailRequestSchema = z.strictObject({ email: Email }).openapi("EmailRequest");

export const VerifyEmailRequestSchema = z
  .strictObject({ token: MailedToken })
  .openapi("VerifyEmailRequest");

export const ResetPasswordRequestSchema = z
  .strictObject({ token: MailedToken, password: NewPassword })
  .openapi("ResetPasswordRequest");

export const DeleteAccountRequestSchema = z
  .strictObject({ password: Password })
  .openapi("DeleteAccountRequest");
```

#### Create `apps/server/src/api/client-address.ts`

```ts
import type { Context } from "hono";

/** What `Bun.serve` passes to `fetch` as the second argument, which Hono exposes as `c.env`. */
interface BunServer {
  requestIP?(request: Request): { address: string } | null;
}

/**
 * The client's IP address, for rate limits: the socket's peer address, or behind a trusted
 * reverse proxy the last X-Forwarded-For entry (the one that proxy added). "unknown" when there
 * is neither, as in tests through `app.request`.
 */
export function clientAddress(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const last = c.req.header("X-Forwarded-For")?.split(",").at(-1)?.trim();
    if (last) return last;
  }
  const server = c.env as BunServer | undefined;
  return server?.requestIP?.(c.req.raw)?.address ?? "unknown";
}

/**
 * The part of an address that rate limits count by: an IPv4 address as is (also when written as
 * IPv4-mapped IPv6), an IPv6 address by its /64 prefix, since one client usually holds a whole /64
 * and could otherwise rotate through fresh addresses.
 */
export function rateLimitKey(address: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped) return mapped[1];
  if (!address.includes(":")) return address;
  const halves = address.toLowerCase().split("%")[0].split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(":") : [];
  const gap = halves.length > 1 ? Math.max(0, 8 - left.length - right.length) : 0;
  const groups = [...left, ...Array<string>(gap).fill("0"), ...right];
  const prefix = groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, ""));
  return `${prefix.join(":")}::/64`;
}
```

#### Create `apps/server/src/api/client-address.test.ts`

```ts
import { expect, test } from "bun:test";
import { rateLimitKey } from "./client-address.ts";

test("IPv4 addresses are counted one by one", () => {
  expect(rateLimitKey("198.51.100.7")).toBe("198.51.100.7");
  expect(rateLimitKey("::ffff:198.51.100.7")).toBe("198.51.100.7");
  expect(rateLimitKey("unknown")).toBe("unknown");
});

test("IPv6 addresses are counted by their /64", () => {
  expect(rateLimitKey("2001:db8:abcd:12:1:2:3:4")).toBe("2001:db8:abcd:12::/64");
  expect(rateLimitKey("2001:0DB8:ABCD:0012:ffff::1")).toBe("2001:db8:abcd:12::/64");
  expect(rateLimitKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
  expect(rateLimitKey("::1")).toBe("0:0:0:0::/64");
  expect(rateLimitKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
});
```

#### Create `apps/server/src/api/csrf.ts`

```ts
import type { MiddlewareHandler } from "hono";
import { problem } from "./problem.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Whether a request comes from this site's own pages (or from no browser at all). Browsers send
 * Sec-Fetch-Site on every request; older ones send at least Origin on a cross-origin POST.
 * Without either header the request isn't from a browser, so it carries no victim's cookies.
 */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site !== null) return site === "same-origin" || site === "none";
  const origin = request.headers.get("Origin");
  if (origin === null) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false; // "null" and other opaque origins
  }
}

/**
 * CSRF protection (NFR-4): refuses state-changing requests made from other sites. It backs up the
 * session cookie's SameSite=Lax and the JSON-only request bodies. See DECISIONS, "CSRF".
 */
export const sameOriginOnly: MiddlewareHandler = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method) || isSameOrigin(c.req.raw)) return next();
  return problem(c, 403, "Cross-site request refused", {
    detail: "State-changing requests must come from this site's own pages.",
  });
};
```

#### Create `apps/server/src/api/session-cookie.ts`

```ts
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { UserRecord } from "../domain.ts";
import type { NewSession, SessionManager } from "../managers/session-manager.ts";

export const SESSION_COOKIE = "loophole_session";

/** Real tokens are 43 characters; anything much longer is not worth hashing. */
const MAX_TOKEN_LENGTH = 128;

const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: "Lax", path: "/" } as const;

/** The session token from the request's cookie, or null. */
export function sessionToken(c: Context): string | null {
  const token = getCookie(c, SESSION_COOKIE);
  return token !== undefined && token.length > 0 && token.length <= MAX_TOKEN_LENGTH ? token : null;
}

/** Secure, HttpOnly, SameSite=Lax, for the whole site, until the session expires. */
export function setSessionCookie(c: Context, session: NewSession): void {
  setCookie(c, SESSION_COOKIE, session.token, {
    ...COOKIE_OPTIONS,
    expires: new Date(session.expiresAt),
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, COOKIE_OPTIONS);
}

/**
 * The logged-in user, or null. A cookie whose session is gone or expired is cleared. Routes that
 * need a user (progress sync, submissions, leaderboards) call this and answer 401 on null.
 */
export async function currentUser(
  c: Context,
  sessions: SessionManager,
): Promise<UserRecord | null> {
  const token = sessionToken(c);
  if (token === null) return null;
  const user = await sessions.authenticate(token);
  if (user === null) clearSessionCookie(c);
  return user;
}
```

#### Create `apps/server/src/api/accounts.ts`

```ts
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import type { UserRecord } from "../domain.ts";
import type { AccountManager } from "../managers/account-manager.ts";
import type { SessionManager } from "../managers/session-manager.ts";
import type { RateLimiter, RateRule } from "../ports.ts";
import {
  AuthConfigSchema,
  DeleteAccountRequestSchema,
  EmailRequestSchema,
  LogInRequestSchema,
  ResetPasswordRequestSchema,
  SessionSchema,
  SignUpRequestSchema,
  UserSchema,
  VerifyEmailRequestSchema,
} from "./account-schemas.ts";
import { clientAddress, rateLimitKey } from "./client-address.ts";
import { problem, problemResponse } from "./problem.ts";
import {
  clearSessionCookie,
  currentUser,
  sessionToken,
  setSessionCookie,
} from "./session-cookie.ts";

export interface AccountRouteDeps {
  readonly accounts: AccountManager;
  readonly sessions: SessionManager;
  readonly limiter: RateLimiter;
  /** Take the client's address from X-Forwarded-For (see `clientAddress`). */
  readonly trustProxy: boolean;
  readonly turnstileSiteKey: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Limits per client address (NFR-4). The account manager also limits per email. */
export const ADDRESS_LIMITS = {
  signup: { limit: 10, windowMs: HOUR },
  login: { limit: 20, windowMs: 15 * MINUTE },
  mail: { limit: 10, windowMs: HOUR },
  token: { limit: 20, windowMs: 15 * MINUTE },
  deleteAccount: { limit: 10, windowMs: 15 * MINUTE },
} satisfies Record<string, RateRule>;

const json = <T>(schema: T) => ({ content: { "application/json": { schema } }, required: true });

const noContent = (description: string) => ({ description });

const crossSite = problemResponse("Sent from another site (CSRF protection).");
const tooMany = problemResponse("Too many attempts; `Retry-After` says when to try again.");
const invalid = problemResponse("Invalid request body.");

const configRoute = createRoute({
  method: "get",
  path: "/api/auth/config",
  summary: "Settings the sign-up form needs",
  responses: {
    200: {
      description: "Settings.",
      content: { "application/json": { schema: AuthConfigSchema } },
    },
  },
});

const sessionRoute = createRoute({
  method: "get",
  path: "/api/session",
  summary: "Who is logged in",
  responses: {
    200: {
      description: "The logged-in user, or null.",
      content: { "application/json": { schema: SessionSchema } },
    },
  },
});

const signUpRoute = createRoute({
  method: "post",
  path: "/api/auth/signup",
  summary: "Create an account",
  description:
    "Mails a verification link. The answer is the same whether or not the email already has an account; such an account gets a note instead. Does not log in.",
  request: { body: json(SignUpRequestSchema) },
  responses: {
    204: noContent("Accepted; check your email."),
    400: problemResponse("Invalid body, or the CAPTCHA check failed."),
    403: crossSite,
    429: tooMany,
  },
});

const logInRoute = createRoute({
  method: "post",
  path: "/api/auth/login",
  summary: "Log in",
  description: "Sets a new session cookie and ends the session of the cookie sent, if any.",
  request: { body: json(LogInRequestSchema) },
  responses: {
    200: {
      description: "Logged in.",
      content: { "application/json": { schema: UserSchema } },
    },
    400: invalid,
    401: problemResponse("Wrong email or password."),
    403: crossSite,
    429: tooMany,
  },
});

const logOutRoute = createRoute({
  method: "post",
  path: "/api/auth/logout",
  summary: "Log out",
  responses: { 204: noContent("Logged out (also when no one was)."), 403: crossSite },
});

const verifyEmailRoute = createRoute({
  method: "post",
  path: "/api/auth/verify-email",
  summary: "Confirm an email address with the mailed token",
  request: { body: json(VerifyEmailRequestSchema) },
  responses: {
    204: noContent("Verified."),
    400: problemResponse("Invalid body, or the link is invalid, used or expired."),
    403: crossSite,
    429: tooMany,
  },
});

const resendRoute = createRoute({
  method: "post",
  path: "/api/auth/resend-verification",
  summary: "Mail a new verification link",
  description: "Same answer whether or not the email has an unverified account.",
  request: { body: json(EmailRequestSchema) },
  responses: { 204: noContent("Accepted."), 400: invalid, 403: crossSite, 429: tooMany },
});

const forgotRoute = createRoute({
  method: "post",
  path: "/api/auth/forgot-password",
  summary: "Mail a password reset link",
  description: "Same answer whether or not the email has an account.",
  request: { body: json(EmailRequestSchema) },
  responses: { 204: noContent("Accepted."), 400: invalid, 403: crossSite, 429: tooMany },
});

const resetRoute = createRoute({
  method: "post",
  path: "/api/auth/reset-password",
  summary: "Set a new password with the mailed token",
  description: "Logs the account out everywhere. Does not log in.",
  request: { body: json(ResetPasswordRequestSchema) },
  responses: {
    204: noContent("Password changed."),
    400: problemResponse("Invalid body, or the link is invalid, used or expired."),
    403: crossSite,
    429: tooMany,
  },
});

const deleteAccountRoute = createRoute({
  method: "delete",
  path: "/api/account",
  summary: "Delete the logged-in account and all its data",
  security: [{ session: [] }],
  request: { body: json(DeleteAccountRequestSchema) },
  responses: {
    204: noContent("Deleted and logged out."),
    400: invalid,
    401: problemResponse("Not logged in, or wrong password."),
    403: crossSite,
    429: tooMany,
  },
});

/** Sign-up, login, logout, email verification, password reset, account deletion. */
export function registerAccountRoutes(app: OpenAPIHono, deps: AccountRouteDeps): void {
  const { accounts, sessions, limiter, trustProxy } = deps;

  app.openAPIRegistry.registerComponent("securitySchemes", "session", {
    type: "apiKey",
    in: "cookie",
    name: "loophole_session",
  });

  const byAddress =
    (name: keyof typeof ADDRESS_LIMITS): MiddlewareHandler =>
    async (c, next) => {
      const key = `${name}:${rateLimitKey(clientAddress(c, trustProxy))}`;
      const decision = limiter.hit(key, ADDRESS_LIMITS[name]);
      if (decision.allowed) return next();
      return tooManyRequests(c, decision.retryAfterMs);
    };

  app.use("/api/auth/signup", byAddress("signup"));
  app.use("/api/auth/login", byAddress("login"));
  app.use("/api/auth/resend-verification", byAddress("mail"));
  app.use("/api/auth/forgot-password", byAddress("mail"));
  app.use("/api/auth/verify-email", byAddress("token"));
  app.use("/api/auth/reset-password", byAddress("token"));
  app.on("DELETE", "/api/account", byAddress("deleteAccount"));

  app.openapi(configRoute, (c) => c.json({ turnstileSiteKey: deps.turnstileSiteKey }, 200));

  app.openapi(sessionRoute, async (c) => {
    const user = await currentUser(c, sessions);
    return c.json({ user: user === null ? null : toUserDto(user) }, 200);
  });

  app.openapi(signUpRoute, async (c) => {
    const { email, password, captchaToken } = c.req.valid("json");
    const address = clientAddress(c, trustProxy);
    await accounts.signUp({
      email,
      password,
      captchaToken,
      remoteIp: address === "unknown" ? null : address,
    });
    return c.body(null, 204);
  });

  app.openapi(logInRoute, async (c) => {
    const { email, password } = c.req.valid("json");
    const { user, session } = await accounts.logIn(email, password, sessionToken(c));
    setSessionCookie(c, session);
    return c.json(toUserDto(user), 200);
  });

  app.openapi(logOutRoute, async (c) => {
    const token = sessionToken(c);
    if (token !== null) await sessions.end(token);
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  app.openapi(verifyEmailRoute, async (c) => {
    await accounts.verifyEmail(c.req.valid("json").token);
    return c.body(null, 204);
  });

  app.openapi(resendRoute, async (c) => {
    await accounts.resendVerification(c.req.valid("json").email);
    return c.body(null, 204);
  });

  app.openapi(forgotRoute, async (c) => {
    await accounts.requestPasswordReset(c.req.valid("json").email);
    return c.body(null, 204);
  });

  app.openapi(resetRoute, async (c) => {
    const { token, password } = c.req.valid("json");
    await accounts.resetPassword(token, password);
    return c.body(null, 204);
  });

  app.openapi(deleteAccountRoute, async (c) => {
    const user = await currentUser(c, sessions);
    if (user === null) return problem(c, 401, "Not logged in");
    await accounts.deleteAccount(user.id, c.req.valid("json").password);
    clearSessionCookie(c);
    return c.body(null, 204);
  });
}

/** A 429 problem with `Retry-After` in whole seconds. */
export function tooManyRequests(c: Context, retryAfterMs: number) {
  c.header("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  return problem(c, 429, "Too many requests", {
    detail: "Too many attempts. Wait a little and try again.",
  });
}

function toUserDto(u: UserRecord) {
  return {
    id: u.id,
    email: u.email,
    emailVerified: u.emailVerifiedAt !== null,
    isAdmin: u.isAdmin,
    createdAt: new Date(u.createdAt).toISOString(),
  };
}
```

#### Replace the whole of `apps/server/src/api/app.ts` with

```ts
import type { Hook } from "@hono/zod-openapi";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { serializePuzzle } from "@loophole/core";
import type { Env } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serveStatic } from "hono/bun";
import { HTTPException } from "hono/http-exception";
import type { Job, PuzzleRecord } from "../domain.ts";
import {
  CaptchaFailedError,
  InvalidCredentialsError,
  InvalidTokenError,
  QueueFullError,
  RateLimitedError,
} from "../managers/errors.ts";
import type { JobManager } from "../managers/job-manager.ts";
import type { PuzzleManager } from "../managers/puzzle-manager.ts";
import { type AccountRouteDeps, registerAccountRoutes, tooManyRequests } from "./accounts.ts";
import { sameOriginOnly } from "./csrf.ts";
import { problem, problemResponse } from "./problem.ts";
import {
  GenerateRequestSchema,
  HealthSchema,
  IdParamSchema,
  JobSchema,
  PuzzleListQuerySchema,
  PuzzleListSchema,
  PuzzleSchema,
} from "./schemas.ts";

export interface AppDeps extends AccountRouteDeps {
  readonly puzzles: PuzzleManager;
  readonly jobs: JobManager;
  /** Folder of the built web app to serve at `/`, with `index.html` for unknown paths. */
  readonly webDir?: string;
}

/** Largest request body the API reads. Leaves room for a 100×100 puzzle (about 10 KB). */
const MAX_BODY_BYTES = 64 * 1024;

const healthRoute = createRoute({
  method: "get",
  path: "/api/health",
  summary: "Liveness check",
  responses: {
    200: {
      description: "The API is up.",
      content: { "application/json": { schema: HealthSchema } },
    },
  },
});

const listPuzzlesRoute = createRoute({
  method: "get",
  path: "/api/puzzles",
  summary: "Recent published puzzles, newest first",
  request: { query: PuzzleListQuerySchema },
  responses: {
    200: { description: "Puzzles.", content: { "application/json": { schema: PuzzleListSchema } } },
    400: problemResponse("Invalid query."),
  },
});

const getPuzzleRoute = createRoute({
  method: "get",
  path: "/api/puzzles/{id}",
  summary: "A published puzzle's clues (never its solution)",
  request: { params: IdParamSchema },
  responses: {
    200: { description: "The puzzle.", content: { "application/json": { schema: PuzzleSchema } } },
    400: problemResponse("Invalid id."),
    404: problemResponse("No published puzzle with this id."),
  },
});

const generateRoute = createRoute({
  method: "post",
  path: "/api/jobs/generate",
  summary: "Queue a puzzle generation",
  description: "Generation runs in the background; poll the returned job until it is done.",
  request: {
    body: { required: true, content: { "application/json": { schema: GenerateRequestSchema } } },
  },
  responses: {
    202: {
      description: "Queued. `Location` points at the job.",
      content: { "application/json": { schema: JobSchema } },
    },
    400: problemResponse("Invalid request body."),
    413: problemResponse("Request body larger than 64 KiB."),
    415: problemResponse("Request body is not JSON."),
    403: problemResponse("Sent from another site (CSRF protection)."),
    503: problemResponse("Too many jobs waiting; try again later."),
  },
});

const getJobRoute = createRoute({
  method: "get",
  path: "/api/jobs/{id}",
  summary: "A job's status, progress and result",
  request: { params: IdParamSchema },
  responses: {
    200: { description: "The job.", content: { "application/json": { schema: JobSchema } } },
    400: problemResponse("Invalid id."),
    404: problemResponse("No job with this id."),
  },
});

/** Turns zod validation failures into 400 problem responses. */
const validationHook: Hook<unknown, Env, string, unknown> = (result, c) => {
  if (result.success) return;
  const errors = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  return problem(c, 400, "Invalid request", {
    detail: errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join("; "),
    errors,
  });
};

/** The HTTP API: routes translate between wire shapes and domain types; managers do the work. */
export function createApp(deps: AppDeps): OpenAPIHono {
  const { puzzles, jobs } = deps;
  const app = new OpenAPIHono({ defaultHook: validationHook });

  app.use(
    "/api/*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => problem(c, 413, "Request body too large"),
    }),
  );
  app.use("/api/*", sameOriginOnly);

  app.openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));

  app.openapi(listPuzzlesRoute, (c) => {
    const { limit } = c.req.valid("query");
    return c.json({ items: puzzles.listRecent(limit).map(toPuzzleSummary) }, 200);
  });

  app.openapi(getPuzzleRoute, (c) => {
    const record = puzzles.get(c.req.valid("param").id);
    if (record === null) return problem(c, 404, "Puzzle not found");
    return c.json(toPuzzleDto(record), 200);
  });

  app.openapi(generateRoute, (c) => {
    const job = jobs.enqueueGenerate(c.req.valid("json"));
    c.header("Location", `/api/jobs/${job.id}`);
    return c.json(toJobDto(job), 202);
  });

  app.openapi(getJobRoute, (c) => {
    const job = jobs.get(c.req.valid("param").id);
    if (job === null) return problem(c, 404, "Job not found");
    return c.json(toJobDto(job), 200);
  });

  registerAccountRoutes(app, deps);

  app.all("/api/*", (c) => problem(c, 404, "Not found"));

  if (deps.webDir !== undefined) {
    app.use("*", serveStatic({ root: deps.webDir }));
    app.get("*", serveStatic({ root: deps.webDir, path: "index.html" }));
  }

  app.notFound((c) => problem(c, 404, "Not found"));

  app.onError((err, c) => {
    if (err instanceof QueueFullError)
      return problem(c, 503, "Queue full", { detail: err.message });
    if (err instanceof InvalidCredentialsError)
      return problem(c, 401, "Wrong email or password", { detail: err.message });
    if (err instanceof CaptchaFailedError)
      return problem(c, 400, "CAPTCHA check failed", { detail: err.message });
    if (err instanceof InvalidTokenError)
      return problem(c, 400, "Invalid or expired link", { detail: err.message });
    if (err instanceof RateLimitedError) return tooManyRequests(c, err.retryAfterMs);
    if (err instanceof HTTPException) return problem(c, err.status, err.message);
    console.error(err);
    return problem(c, 500, "Internal server error");
  });

  return app;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function toPuzzleDto(r: PuzzleRecord) {
  return {
    id: r.id,
    puzzle: serializePuzzle(r.puzzle),
    origin: r.origin,
    createdAt: iso(r.createdAt),
  };
}

function toPuzzleSummary(r: PuzzleRecord) {
  return {
    id: r.id,
    width: r.puzzle.grid.width,
    height: r.puzzle.grid.height,
    origin: r.origin,
    createdAt: iso(r.createdAt),
  };
}

function toJobDto(job: Job) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    result: job.result?.kind === "generate" ? { puzzleId: job.result.puzzleId } : null,
    error: job.error,
    createdAt: iso(job.createdAt),
    startedAt: job.startedAt === null ? null : iso(job.startedAt),
    finishedAt: job.finishedAt === null ? null : iso(job.finishedAt),
  };
}
```

#### Replace the whole of `apps/server/src/api/main.ts` with

```ts
// Composition root of the HTTP API process: reads the settings, builds the adapters and managers,
// and serves the app.
import { S3BlobStore } from "../adapters/blob/s3-blob-store.ts";
import { TURNSTILE_TEST_SECRET_KEY, TurnstileVerifier } from "../adapters/captcha/turnstile.ts";
import { systemClock } from "../adapters/clock.ts";
import { SqliteAccountTokenRepository } from "../adapters/db/account-token-repository.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { SqliteSessionRepository } from "../adapters/db/session-repository.ts";
import { SqliteUserRepository } from "../adapters/db/user-repository.ts";
import { BackgroundMailer } from "../adapters/mail/background-mailer.ts";
import { SmtpMailer } from "../adapters/mail/smtp-mailer.ts";
import { argon2idHasher } from "../adapters/password-hasher.ts";
import { randomToken } from "../adapters/random-token.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import { loadConfig } from "../config.ts";
import { AccountManager } from "../managers/account-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { SessionManager } from "../managers/session-manager.ts";
import { createApp } from "./app.ts";

const config = loadConfig(process.env);
const db = openDatabase(config.databasePath);
// loadConfig refuses the test secret unless PUBLIC_URL is on localhost.
const testCaptcha = config.turnstile.secretKey === TURNSTILE_TEST_SECRET_KEY;

const puzzles = new PuzzleManager({
  puzzles: new SqlitePuzzleRepository(db),
  blobs: new S3BlobStore(config.s3),
  clock: systemClock,
});
const jobs = new JobManager({
  jobs: new SqliteJobQueue(db),
  clock: systemClock,
  newId: () => crypto.randomUUID(),
  maxQueued: config.maxQueuedJobs,
});
const users = new SqliteUserRepository(db);
const sessions = new SessionManager({
  sessions: new SqliteSessionRepository(db),
  users,
  clock: systemClock,
  newToken: randomToken,
  ttlMs: config.sessionTtlMs,
});
const limiter = new MemoryRateLimiter(systemClock);
const accounts = new AccountManager({
  users,
  tokens: new SqliteAccountTokenRepository(db),
  sessions,
  passwords: argon2idHasher,
  captcha: new TurnstileVerifier({
    secretKey: config.turnstile.secretKey,
    // The test secret answers for "example.com", so the hostname check is for real keys only.
    expectedHostname: testCaptcha ? undefined : new URL(config.publicUrl).hostname,
  }),
  // Mail goes out after the answer, so its timing and errors don't show who has an account.
  mailer: new BackgroundMailer(new SmtpMailer(config.smtp)),
  limiter,
  clock: systemClock,
  newId: () => crypto.randomUUID(),
  newToken: randomToken,
  publicUrl: config.publicUrl,
});
const app = createApp({
  puzzles,
  jobs,
  accounts,
  sessions,
  limiter,
  trustProxy: config.trustProxy,
  turnstileSiteKey: config.turnstile.siteKey,
  webDir: config.webDir,
});
if (testCaptcha) {
  console.warn(
    "Using Turnstile's test keys: the sign-up CAPTCHA always passes. Not for production.",
  );
}

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  // Outer cap; the app itself refuses API bodies over 64 KiB.
  maxRequestBodySize: 1024 * 1024,
  fetch: app.fetch,
});
console.log(`API listening on ${server.url}`);
```

#### Replace the whole of `apps/server/src/api/spec.ts` with

```ts
// Composition root for the OpenAPI document: builds the app over in-memory adapters, only to read
// its route definitions. `scripts/gen-api.ts` writes the result to openapi.yaml.
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import {
  TURNSTILE_TEST_SECRET_KEY,
  TURNSTILE_TEST_SITE_KEY,
  TurnstileVerifier,
} from "../adapters/captcha/turnstile.ts";
import { systemClock } from "../adapters/clock.ts";
import { SqliteAccountTokenRepository } from "../adapters/db/account-token-repository.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { SqliteSessionRepository } from "../adapters/db/session-repository.ts";
import { SqliteUserRepository } from "../adapters/db/user-repository.ts";
import { MemoryMailer } from "../adapters/mail/memory-mailer.ts";
import { argon2idHasher } from "../adapters/password-hasher.ts";
import { randomToken } from "../adapters/random-token.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import { AccountManager } from "../managers/account-manager.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { SessionManager } from "../managers/session-manager.ts";
import { createApp } from "./app.ts";

export function openApiDocument() {
  const db = openDatabase(":memory:");
  const users = new SqliteUserRepository(db);
  const sessions = new SessionManager({
    sessions: new SqliteSessionRepository(db),
    users,
    clock: systemClock,
    newToken: randomToken,
    ttlMs: 1,
  });
  const limiter = new MemoryRateLimiter(systemClock);
  const app = createApp({
    accounts: new AccountManager({
      users,
      tokens: new SqliteAccountTokenRepository(db),
      sessions,
      passwords: argon2idHasher,
      captcha: new TurnstileVerifier({ secretKey: TURNSTILE_TEST_SECRET_KEY }),
      mailer: new MemoryMailer(),
      limiter,
      clock: systemClock,
      newId: () => crypto.randomUUID(),
      newToken: randomToken,
      publicUrl: "http://localhost",
    }),
    sessions,
    limiter,
    trustProxy: false,
    turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
    puzzles: new PuzzleManager({
      puzzles: new SqlitePuzzleRepository(db),
      blobs: new MemoryBlobStore(),
      clock: systemClock,
    }),
    jobs: new JobManager({
      jobs: new SqliteJobQueue(db),
      clock: systemClock,
      newId: () => crypto.randomUUID(),
      maxQueued: 1,
    }),
  });
  const doc = app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Loophole API",
      version: "0.1.0",
      description:
        "Puzzles, background jobs and accounts. Errors are RFC 9457 problem details. State-changing requests from other sites are refused (403).",
    },
  });
  db.close();
  return doc;
}
```

#### Create `apps/server/src/test-support/accounts.ts`

```ts
import type { Database } from "bun:sqlite";
import { SqliteAccountTokenRepository } from "../adapters/db/account-token-repository.ts";
import { SqliteSessionRepository } from "../adapters/db/session-repository.ts";
import { SqliteUserRepository } from "../adapters/db/user-repository.ts";
import { MemoryMailer } from "../adapters/mail/memory-mailer.ts";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import { AccountManager } from "../managers/account-manager.ts";
import { SessionManager } from "../managers/session-manager.ts";
import type { Clock } from "../ports.ts";
import { FakeCaptcha, fakePasswordHasher, sequentialIds } from "./fakes.ts";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The account side of the API for route tests: SQLite repositories on `db`, fake password hashing
 * and CAPTCHA, mail kept in memory. Spread the result into `createApp`'s deps.
 */
export function accountDeps(db: Database, clock: Clock) {
  const users = new SqliteUserRepository(db);
  const sessions = new SessionManager({
    sessions: new SqliteSessionRepository(db),
    users,
    clock,
    newToken: sequentialIds("token"),
    ttlMs: SESSION_TTL_MS,
  });
  const limiter = new MemoryRateLimiter(clock);
  const mailer = new MemoryMailer();
  const captcha = new FakeCaptcha();
  const accounts = new AccountManager({
    users,
    tokens: new SqliteAccountTokenRepository(db),
    sessions,
    passwords: fakePasswordHasher,
    captcha,
    mailer,
    limiter,
    clock,
    newId: sequentialIds("u"),
    newToken: sequentialIds("mailed"),
    publicUrl: "http://web.test",
  });
  return {
    accounts,
    sessions,
    limiter,
    trustProxy: false,
    turnstileSiteKey: "test-site-key",
    users,
    mailer,
    captcha,
  };
}
```

#### Edit `apps/server/src/api/app.test.ts`

In `apps/server/src/api/app.test.ts`, replace

```ts
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
```

with

```ts
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
```

#### Edit `apps/server/src/api/app.test.ts`

In `apps/server/src/api/app.test.ts`, replace

```ts
  const app = createApp({ puzzles, jobs, webDir: options.webDir });
```

with

```ts
  const app = createApp({ puzzles, jobs, ...accountDeps(db, clock), webDir: options.webDir });
```

#### Edit `apps/server/src/worker/flow.test.ts`

In `apps/server/src/worker/flow.test.ts`, replace

```ts
import { PuzzleManager } from "../managers/puzzle-manager.ts";

```

with

```ts
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";

```

#### Edit `apps/server/src/worker/flow.test.ts`

In `apps/server/src/worker/flow.test.ts`, replace

```ts
  return { app: createApp({ puzzles, jobs }), runs, puzzles };
```

with

```ts
  return { app: createApp({ puzzles, jobs, ...accountDeps(db, systemClock) }), runs, puzzles };
```

#### Create `apps/server/src/api/accounts.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { MemoryBlobStore } from "../adapters/blob/memory-blob-store.ts";
import { openDatabase } from "../adapters/db/database.ts";
import { SqliteJobQueue } from "../adapters/db/job-queue.ts";
import { SqlitePuzzleRepository } from "../adapters/db/puzzle-repository.ts";
import { JobManager } from "../managers/job-manager.ts";
import { PuzzleManager } from "../managers/puzzle-manager.ts";
import { accountDeps } from "../test-support/accounts.ts";
import { FakeClock, sequentialIds } from "../test-support/fakes.ts";
import { createApp } from "./app.ts";
import type { Problem } from "./problem.ts";
import { SESSION_COOKIE } from "./session-cookie.ts";

function setup(options: { trustProxy?: boolean } = {}) {
  const db = openDatabase(":memory:");
  const clock = new FakeClock(Date.UTC(2026, 9, 25, 12));
  const deps = accountDeps(db, clock);
  const app = createApp({
    puzzles: new PuzzleManager({
      puzzles: new SqlitePuzzleRepository(db),
      blobs: new MemoryBlobStore(),
      clock,
    }),
    jobs: new JobManager({
      jobs: new SqliteJobQueue(db),
      clock,
      newId: sequentialIds("j"),
      maxQueued: 10,
    }),
    ...deps,
    trustProxy: options.trustProxy ?? false,
  });

  /** A request as the web app sends it: JSON, same origin, with an optional session cookie. */
  const send = (
    method: string,
    path: string,
    body?: unknown,
    options: { cookie?: string; headers?: Record<string, string>; address?: string } = {},
  ) => {
    const headers: Record<string, string> = { "Sec-Fetch-Site": "same-origin", ...options.headers };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (options.cookie !== undefined) headers.Cookie = `${SESSION_COOKIE}=${options.cookie}`;
    const env = { requestIP: () => ({ address: options.address ?? "198.51.100.7" }) };
    return app.request(
      path,
      { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      env,
    );
  };

  const signUp = (email = "ann@example.com", password = "hunter22") =>
    send("POST", "/api/auth/signup", { email, password, captchaToken: "cap" });

  const logIn = async (email = "ann@example.com", password = "hunter22", cookie?: string) => {
    const res = await send("POST", "/api/auth/login", { email, password }, { cookie });
    expect(res.status).toBe(200);
    return sessionCookie(res);
  };

  /** The token from the last mail's link. */
  const mailedToken = () => {
    const match = deps.mailer.sent.at(-1)?.text.match(/#token=(\S+)/);
    if (!match) throw new Error("no link in the last mail");
    return match[1];
  };

  return { app, clock, deps, send, signUp, logIn, mailedToken };
}

/** The session cookie a response sets: its value and attributes. */
function setCookie(res: Response): string {
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (cookie === undefined) throw new Error("no session cookie set");
  return cookie;
}

function sessionCookie(res: Response): string {
  return setCookie(res)
    .split(";")[0]
    .slice(SESSION_COOKIE.length + 1);
}

async function expectProblem(res: Response, status: number, title?: string): Promise<Problem> {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toStartWith("application/problem+json");
  const body = (await res.json()) as Problem;
  expect(body.status).toBe(status);
  if (title !== undefined) expect(body.title).toBe(title);
  return body;
}

describe("sign-up, verification, login and logout", () => {
  test("the whole path, with the cookie's security attributes", async () => {
    const { send, signUp, mailedToken } = setup();
    const created = await signUp();
    expect(created.status).toBe(204);
    expect(created.headers.getSetCookie()).toEqual([]); // sign-up doesn't log in

    expect((await send("POST", "/api/auth/verify-email", { token: mailedToken() })).status).toBe(
      204,
    );

    const login = await send("POST", "/api/auth/login", {
      email: "Ann@Example.com",
      password: "hunter22",
    });
    expect(login.status).toBe(200);
    expect(await login.json()).toEqual({
      id: "u-1",
      email: "ann@example.com",
      emailVerified: true,
      isAdmin: false,
      createdAt: "2026-10-25T12:00:00.000Z",
    });
    const cookie = setCookie(login);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Expires=Tue, 24 Nov 2026 12:00:00 GMT"); // 30 days
    const token = sessionCookie(login);

    const session = await send("GET", "/api/session", undefined, { cookie: token });
    expect(((await session.json()) as { user: { email: string } }).user.email).toBe(
      "ann@example.com",
    );

    const logout = await send("POST", "/api/auth/logout", undefined, { cookie: token });
    expect(logout.status).toBe(204);
    expect(setCookie(logout)).toContain("Max-Age=0");
    const after = await send("GET", "/api/session", undefined, { cookie: token });
    expect(await after.json()).toEqual({ user: null });
  });

  test("GET /api/auth/config gives the Turnstile site key", async () => {
    const res = await setup().send("GET", "/api/auth/config");
    expect(await res.json()).toEqual({ turnstileSiteKey: "test-site-key" });
  });

  test("an unknown session cookie means logged out and is cleared", async () => {
    const res = await setup().send("GET", "/api/session", undefined, { cookie: "stale" });
    expect(await res.json()).toEqual({ user: null });
    expect(setCookie(res)).toContain("Max-Age=0");
  });

  test("an unverified account can log in", async () => {
    const { send, signUp, logIn } = setup();
    await signUp();
    const token = await logIn();
    const res = await send("GET", "/api/session", undefined, { cookie: token });
    expect(await res.json()).toMatchObject({ user: { emailVerified: false } });
  });

  test("signing up with a taken email answers exactly like a new sign-up", async () => {
    const { signUp, deps } = setup();
    const first = await signUp();
    const second = await signUp("ANN@example.com", "something-else");
    expect(second.status).toBe(first.status);
    expect(await second.text()).toBe(await first.text());
    expect(deps.mailer.sent.map((m) => m.subject)).toEqual([
      "Confirm your email for Loophole",
      "You already have a Loophole account",
    ]);
  });

  test("a failed CAPTCHA is a 400 problem", async () => {
    const { signUp, deps } = setup();
    deps.captcha.ok = false;
    await expectProblem(await signUp(), 400, "CAPTCHA check failed");
    expect(deps.captcha.calls[0]).toEqual({ token: "cap", remoteIp: "198.51.100.7" });
  });

  test("sign-up validates the body", async () => {
    const { send } = setup();
    for (const body of [
      { email: "not-an-email", password: "hunter22", captchaToken: "c" },
      { email: "a@example.com", password: "short", captchaToken: "c" },
      { email: "a@example.com", password: "x".repeat(129), captchaToken: "c" },
      { email: "a@example.com", password: "hunter22" },
      { email: "a@example.com", password: "hunter22", captchaToken: "c", admin: true },
    ]) {
      await expectProblem(await send("POST", "/api/auth/signup", body), 400, "Invalid request");
    }
  });

  test("a wrong password and an unknown email get the same 401", async () => {
    const { send, signUp } = setup();
    await signUp();
    const wrong = await send("POST", "/api/auth/login", {
      email: "ann@example.com",
      password: "nope-nope",
    });
    const unknown = await send("POST", "/api/auth/login", {
      email: "bob@example.com",
      password: "hunter22",
    });
    const a = await expectProblem(wrong, 401, "Wrong email or password");
    const b = await expectProblem(unknown, 401, "Wrong email or password");
    expect(a).toEqual(b);
  });

  test("logging in with a session cookie replaces that session", async () => {
    const { send, signUp, logIn } = setup();
    await signUp();
    const first = await logIn();
    const second = await logIn("ann@example.com", "hunter22", first);
    expect(second).not.toBe(first);
    const old = await send("GET", "/api/session", undefined, { cookie: first });
    expect(await old.json()).toEqual({ user: null });
  });

  test("a used or made-up verification token is a 400 problem", async () => {
    const { send, signUp, mailedToken } = setup();
    await signUp();
    const token = mailedToken();
    await send("POST", "/api/auth/verify-email", { token });
    await expectProblem(
      await send("POST", "/api/auth/verify-email", { token }),
      400,
      "Invalid or expired link",
    );
  });

  test("resend and forgot-password answer 204 for unknown emails too, mailing nothing", async () => {
    const { send, deps } = setup();
    for (const path of ["/api/auth/resend-verification", "/api/auth/forgot-password"]) {
      expect((await send("POST", path, { email: "nobody@example.com" })).status).toBe(204);
    }
    expect(deps.mailer.sent).toHaveLength(0);
  });
});

describe("password reset and account deletion", () => {
  test("a reset sets the new password and logs out every session", async () => {
    const { send, signUp, logIn, mailedToken } = setup();
    await signUp();
    const token = await logIn();
    expect(
      (await send("POST", "/api/auth/forgot-password", { email: "ann@example.com" })).status,
    ).toBe(204);
    const reset = await send("POST", "/api/auth/reset-password", {
      token: mailedToken(),
      password: "brand-new-pw",
    });
    expect(reset.status).toBe(204);
    const old = await send("GET", "/api/session", undefined, { cookie: token });
    expect(await old.json()).toEqual({ user: null });
    await logIn("ann@example.com", "brand-new-pw");
  });

  test("deleting the account needs a session and the password", async () => {
    const { send, signUp, logIn, deps } = setup();
    await signUp();
    const token = await logIn();
    await expectProblem(
      await send("DELETE", "/api/account", { password: "hunter22" }),
      401,
      "Not logged in",
    );
    await expectProblem(
      await send("DELETE", "/api/account", { password: "nope-nope" }, { cookie: token }),
      401,
      "Wrong email or password",
    );
    const res = await send("DELETE", "/api/account", { password: "hunter22" }, { cookie: token });
    expect(res.status).toBe(204);
    expect(setCookie(res)).toContain("Max-Age=0");
    expect(deps.users.getByEmail("ann@example.com")).toBeNull();
    await expectProblem(
      await send("POST", "/api/auth/login", { email: "ann@example.com", password: "hunter22" }),
      401,
    );
  });
});

describe("CSRF protection", () => {
  const login = { email: "ann@example.com", password: "hunter22" };

  test("refuses state-changing requests from other sites", async () => {
    const { send } = setup();
    for (const headers of [{ "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" }]) {
      await expectProblem(
        await send("POST", "/api/auth/login", login, { headers }),
        403,
        "Cross-site request refused",
      );
    }
    await expectProblem(
      await send(
        "POST",
        "/api/jobs/generate",
        { width: 5, height: 5 },
        {
          headers: { "Sec-Fetch-Site": "cross-site" },
        },
      ),
      403,
    );
  });

  test("without Sec-Fetch-Site, the Origin must match the request's host", async () => {
    const { app } = setup();
    const post = (headers: Record<string, string>) =>
      app.request("http://loophole.test/api/auth/logout", { method: "POST", headers });
    await expectProblem(await post({ Origin: "http://evil.test" }), 403);
    await expectProblem(await post({ Origin: "null" }), 403);
    expect((await post({ Origin: "http://loophole.test" })).status).toBe(204);
    expect((await post({})).status).toBe(204); // not a browser: no cookies to abuse
  });

  test("reads are never refused", async () => {
    const res = await setup().send("GET", "/api/session", undefined, {
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(res.status).toBe(200);
  });
});

describe("rate limits", () => {
  test("sign-ups are limited per address, with Retry-After", async () => {
    const { send } = setup();
    const signUp = (n: number, address: string) =>
      send(
        "POST",
        "/api/auth/signup",
        { email: `p${n}@example.com`, password: "hunter22", captchaToken: "c" },
        { address },
      );
    for (let i = 0; i < 10; i++) expect((await signUp(i, "198.51.100.7")).status).toBe(204);
    const limited = await signUp(10, "198.51.100.7");
    await expectProblem(limited, 429, "Too many requests");
    expect(limited.headers.get("Retry-After")).toBe("3600");
    expect((await signUp(11, "198.51.100.8")).status).toBe(204);
  });

  test("login attempts are limited per email across addresses", async () => {
    const { send, signUp } = setup();
    await signUp();
    for (let i = 0; i < 10; i++) {
      const res = await send(
        "POST",
        "/api/auth/login",
        { email: "ann@example.com", password: "nope-nope" },
        { address: `203.0.113.${i}` },
      );
      expect(res.status).toBe(401);
    }
    const limited = await send(
      "POST",
      "/api/auth/login",
      { email: "ann@example.com", password: "hunter22" },
      { address: "203.0.113.99" },
    );
    await expectProblem(limited, 429);
    expect(limited.headers.get("Retry-After")).toBe("900");
  });

  test("behind a trusted proxy the last X-Forwarded-For entry is the address", async () => {
    const { send } = setup({ trustProxy: true });
    const forgot = (forwarded: string) =>
      send(
        "POST",
        "/api/auth/forgot-password",
        { email: "a@example.com" },
        { headers: { "X-Forwarded-For": forwarded } },
      );
    for (let i = 0; i < 10; i++) expect((await forgot(`10.0.0.${i}, 192.0.2.1`)).status).toBe(204);
    expect((await forgot("10.0.0.1, 192.0.2.1")).status).toBe(429);
    expect((await forgot("192.0.2.1, 192.0.2.2")).status).toBe(204);
  });
});
```

#### Run

```sh
bun run gen:api
```

#### Check

```sh
bun test apps/server   # 0 fail; 23 new tests
bun run check:api      # up to date
grep -c '^  /api/auth/' openapi.yaml   # 8
bun run check
```

#### Commit

```sh
git add -A && git commit -m "feat(server): add sign-up, login, sessions and CSRF protection to the API"
```

### Step 6 — Admin script

`bun run admin <email> [--revoke]` sets the `is_admin` flag. It is a small composition root of its own (settings, database, user repository), outside the layer rules like `gen-api.ts`.

#### Create `apps/server/scripts/set-admin.ts`

```ts
// Grants or revokes admin rights (PRD §5: admins unpublish content and view system health). There
// is no UI for this on purpose. Run from the repo root, so the root settings apply:
//   bun run admin <email>            grant
//   bun run admin <email> --revoke   revoke
import { openDatabase } from "../src/adapters/db/database.ts";
import { SqliteUserRepository } from "../src/adapters/db/user-repository.ts";
import { loadConfig } from "../src/config.ts";
import { normalizeEmail } from "../src/managers/account-manager.ts";

const args = process.argv.slice(2);
const revoke = args.includes("--revoke");
const emails = args.filter((a) => a !== "--revoke");
if (emails.length !== 1) {
  console.error("Usage: bun run admin <email> [--revoke]");
  process.exit(2);
}

const config = loadConfig(process.env);
const db = openDatabase(config.databasePath);
const email = normalizeEmail(emails[0]);
const found = new SqliteUserRepository(db).setAdmin(email, !revoke);
db.close();
if (!found) {
  console.error(`No account with the email ${email}.`);
  process.exit(1);
}
console.log(`${email} is ${revoke ? "no longer an admin" : "now an admin"}.`);
```

#### Edit `package.json`

In `package.json`, replace

```json
    "check:api": "bun apps/server/scripts/gen-api.ts --check"
```

with

```json
    "check:api": "bun apps/server/scripts/gen-api.ts --check",
    "admin": "bun apps/server/scripts/set-admin.ts"
```

#### Check

```sh
DATABASE_PATH=/tmp/wt7-admin.sqlite S3_ENDPOINT=http://x S3_REGION=r S3_BUCKET=b S3_ACCESS_KEY_ID=k S3_SECRET_ACCESS_KEY=s bun run admin nobody@example.com; echo "exit $?"   # "No account with the email nobody@example.com.", exit 1
rm -f /tmp/wt7-admin.sqlite*
bun run check
```

#### Commit

```sh
git add -A && git commit -m "feat(server): add a script that grants and revokes admin rights"
```

### Step 7 — Web: the auth store

A plain TypeScript module (no runes, no `$lib`/`$app`, no DOM), so the root `bun test` runs its tests. It wraps the generated client and holds who is logged in as a `svelte/store` readable.

#### Create `apps/web/src/lib/auth/auth.ts`

```ts
import type { ApiClient, Schemas } from "@loophole/api-client";
import { type Readable, writable } from "svelte/store";

export type User = Schemas["User"];

/** Who is using the app. "loading" until the first answer from the API. */
export type AuthState =
  | { readonly status: "loading" }
  | { readonly status: "guest" }
  | { readonly status: "user"; readonly user: User };

/** Outcome of an account action, with a message to show when it failed. */
export type AuthResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** The logged-in user as a store, plus the account actions (PRD FR-18 to FR-20, NFR-6). */
export interface Auth extends Readable<AuthState> {
  /** Asks the API who is logged in. Anything but an answer (no server, say) counts as a guest. */
  refresh(): Promise<void>;
  /** The Turnstile site key for the sign-up form, or null if the API can't be reached. */
  turnstileSiteKey(): Promise<string | null>;
  signUp(email: string, password: string, captchaToken: string): Promise<AuthResult>;
  logIn(email: string, password: string): Promise<AuthResult>;
  logOut(): Promise<void>;
  verifyEmail(token: string): Promise<AuthResult>;
  resendVerification(email: string): Promise<AuthResult>;
  requestPasswordReset(email: string): Promise<AuthResult>;
  resetPassword(token: string, password: string): Promise<AuthResult>;
  deleteAccount(password: string): Promise<AuthResult>;
}

const OFFLINE = "Couldn't reach the server. Check your connection and try again.";
const TOO_MANY = "Too many attempts. Wait a few minutes and try again.";

/** The message for a failed request, from its problem details. */
export function failureMessage(status: number, problem: unknown): string {
  if (status === 429) return TOO_MANY;
  const p = (problem ?? {}) as { title?: unknown; detail?: unknown };
  if (status === 400 && p.title === "Invalid request") return "Check the form and try again.";
  if (typeof p.detail === "string") return p.detail;
  if (typeof p.title === "string") return p.title;
  return `Something went wrong (HTTP ${status}).`;
}

/** The token in a mailed link's fragment (`#token=…`), or null. */
export function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token === null || token === "" ? null : token;
}

export function createAuth(client: ApiClient): Auth {
  const state = writable<AuthState>({ status: "loading" });
  const guest = () => state.set({ status: "guest" });

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

  async function refresh(): Promise<void> {
    try {
      const { data } = await client.GET("/api/session");
      if (data?.user) state.set({ status: "user", user: data.user });
      else guest();
    } catch {
      guest();
    }
  }

  return {
    subscribe: state.subscribe,
    refresh,

    async turnstileSiteKey() {
      try {
        const { data } = await client.GET("/api/auth/config");
        return data?.turnstileSiteKey ?? null;
      } catch {
        return null;
      }
    },

    signUp: (email, password, captchaToken) =>
      run(() => client.POST("/api/auth/signup", { body: { email, password, captchaToken } })),

    async logIn(email, password) {
      try {
        const { data, error, response } = await client.POST("/api/auth/login", {
          body: { email, password },
        });
        if (data === undefined)
          return { ok: false, message: failureMessage(response.status, error) };
        state.set({ status: "user", user: data });
        return { ok: true };
      } catch {
        return { ok: false, message: OFFLINE };
      }
    },

    async logOut() {
      await run(() => client.POST("/api/auth/logout"));
      guest();
    },

    async verifyEmail(token) {
      const result = await run(() => client.POST("/api/auth/verify-email", { body: { token } }));
      if (result.ok) await refresh();
      return result;
    },

    resendVerification: (email) =>
      run(() => client.POST("/api/auth/resend-verification", { body: { email } })),

    requestPasswordReset: (email) =>
      run(() => client.POST("/api/auth/forgot-password", { body: { email } })),

    async resetPassword(token, password) {
      const result = await run(() =>
        client.POST("/api/auth/reset-password", { body: { token, password } }),
      );
      // A reset logs the account out everywhere, this tab included.
      if (result.ok) guest();
      return result;
    },

    async deleteAccount(password) {
      const result = await run(() => client.DELETE("/api/account", { body: { password } }));
      if (result.ok) guest();
      return result;
    },
  };
}
```

#### Create `apps/web/src/lib/auth/index.ts`

```ts
import { createApiClient } from "@loophole/api-client";
import { createAuth } from "./auth.ts";

export { type AuthResult, type AuthState, tokenFromHash, type User } from "./auth.ts";

/** The app's one auth store. The root layout refreshes it when the app starts. */
export const auth = createAuth(createApiClient());
```

#### Create `apps/web/src/lib/auth/auth.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { createApiClient } from "@loophole/api-client";
import { get } from "svelte/store";
import { createAuth, failureMessage, tokenFromHash, type User } from "./auth.ts";

const USER: User = {
  id: "u1",
  email: "ann@example.com",
  emailVerified: false,
  isAdmin: false,
  createdAt: "2026-10-25T12:00:00.000Z",
};

type Reply = [status: number, body?: unknown];

/**
 * An auth store over a fake API: `routes` maps "METHOD /path" to a reply (or a function giving
 * one). Records each request as "METHOD /path" with its JSON body.
 */
function setup(routes: Record<string, Reply | (() => Reply)>) {
  const requests: { route: string; body: unknown }[] = [];
  const fetch = (async (input: Request) => {
    const route = `${input.method} ${new URL(input.url).pathname}`;
    const text = await input.text();
    requests.push({ route, body: text ? JSON.parse(text) : undefined });
    const entry = routes[route];
    const [status, body] =
      typeof entry === "function" ? entry() : (entry ?? [404, { title: "Not found" }]);
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": status < 400 ? "application/json" : "application/problem+json" },
    });
  }) as typeof globalThis.fetch;
  const auth = createAuth(createApiClient({ baseUrl: "http://api.test", fetch }));
  return { auth, requests };
}

describe("auth store", () => {
  test("starts loading; refresh sets the user or guest", async () => {
    let user: User | null = USER;
    const { auth } = setup({ "GET /api/session": () => [200, { user }] });
    expect(get(auth)).toEqual({ status: "loading" });
    await auth.refresh();
    expect(get(auth)).toEqual({ status: "user", user: USER });
    user = null;
    await auth.refresh();
    expect(get(auth)).toEqual({ status: "guest" });
  });

  test("a missing or unreachable API means guest", async () => {
    const { auth } = setup({ "GET /api/session": [500, { title: "Internal server error" }] });
    await auth.refresh();
    expect(get(auth)).toEqual({ status: "guest" });
    const offline = createAuth(
      createApiClient({
        baseUrl: "http://api.test",
        fetch: (async () => {
          throw new TypeError("Failed to fetch");
        }) as unknown as typeof globalThis.fetch,
      }),
    );
    await offline.refresh();
    expect(get(offline)).toEqual({ status: "guest" });
    expect(await offline.logIn("a@example.com", "pw")).toEqual({
      ok: false,
      message: "Couldn't reach the server. Check your connection and try again.",
    });
    expect(await offline.turnstileSiteKey()).toBeNull();
  });

  test("logIn sends the credentials and stores the user", async () => {
    const { auth, requests } = setup({ "POST /api/auth/login": [200, USER] });
    expect(await auth.logIn("ann@example.com", "hunter22")).toEqual({ ok: true });
    expect(requests).toEqual([
      { route: "POST /api/auth/login", body: { email: "ann@example.com", password: "hunter22" } },
    ]);
    expect(get(auth)).toEqual({ status: "user", user: USER });
  });

  test("a failed login reports the server's message and changes nothing", async () => {
    const { auth } = setup({
      "POST /api/auth/login": [
        401,
        {
          type: "about:blank",
          title: "Wrong email or password",
          status: 401,
          detail: "The email or password is wrong.",
        },
      ],
    });
    expect(await auth.logIn("ann@example.com", "nope")).toEqual({
      ok: false,
      message: "The email or password is wrong.",
    });
    expect(get(auth)).toEqual({ status: "loading" });
  });

  test("logOut, a password reset and account deletion all leave a guest", async () => {
    const { auth, requests } = setup({
      "POST /api/auth/login": [200, USER],
      "POST /api/auth/logout": [204],
      "POST /api/auth/reset-password": [204],
      "DELETE /api/account": [204],
    });
    await auth.logIn("ann@example.com", "hunter22");
    await auth.logOut();
    expect(get(auth)).toEqual({ status: "guest" });
    await auth.logIn("ann@example.com", "hunter22");
    expect(await auth.resetPassword("tok", "new-password")).toEqual({ ok: true });
    expect(get(auth)).toEqual({ status: "guest" });
    await auth.logIn("ann@example.com", "hunter22");
    expect(await auth.deleteAccount("hunter22")).toEqual({ ok: true });
    expect(get(auth)).toEqual({ status: "guest" });
    expect(requests.at(-1)).toEqual({
      route: "DELETE /api/account",
      body: { password: "hunter22" },
    });
  });

  test("verifying an email refreshes the logged-in user", async () => {
    const { auth } = setup({
      "POST /api/auth/verify-email": [204],
      "GET /api/session": [200, { user: { ...USER, emailVerified: true } }],
    });
    expect(await auth.verifyEmail("tok")).toEqual({ ok: true });
    expect(get(auth)).toMatchObject({ status: "user", user: { emailVerified: true } });
  });

  test("sign-up, resend and reset requests pass their fields through", async () => {
    const { auth, requests } = setup({
      "POST /api/auth/signup": [204],
      "POST /api/auth/resend-verification": [204],
      "POST /api/auth/forgot-password": [204],
      "GET /api/auth/config": [200, { turnstileSiteKey: "site" }],
    });
    expect(await auth.signUp("a@example.com", "hunter22", "cap")).toEqual({ ok: true });
    expect(await auth.resendVerification("a@example.com")).toEqual({ ok: true });
    expect(await auth.requestPasswordReset("a@example.com")).toEqual({ ok: true });
    expect(await auth.turnstileSiteKey()).toBe("site");
    expect(requests.map((r) => r.body)).toEqual([
      { email: "a@example.com", password: "hunter22", captchaToken: "cap" },
      { email: "a@example.com" },
      { email: "a@example.com" },
      undefined,
    ]);
  });
});

describe("helpers", () => {
  test("failureMessage", () => {
    expect(failureMessage(429, { title: "Too many requests" })).toBe(
      "Too many attempts. Wait a few minutes and try again.",
    );
    expect(failureMessage(400, { title: "Invalid request", detail: "password: Too small" })).toBe(
      "Check the form and try again.",
    );
    expect(
      failureMessage(400, {
        title: "CAPTCHA check failed",
        detail: "The CAPTCHA check failed. Try again.",
      }),
    ).toBe("The CAPTCHA check failed. Try again.");
    expect(failureMessage(403, { title: "Cross-site request refused" })).toBe(
      "Cross-site request refused",
    );
    expect(failureMessage(502, undefined)).toBe("Something went wrong (HTTP 502).");
  });

  test("tokenFromHash", () => {
    expect(tokenFromHash("#token=abc_-1")).toBe("abc_-1");
    expect(tokenFromHash("token=abc")).toBe("abc");
    expect(tokenFromHash("")).toBeNull();
    expect(tokenFromHash("#token=")).toBeNull();
    expect(tokenFromHash("#other=1")).toBeNull();
  });
});
```

#### Check

```sh
bun test apps/web/src/lib/auth   # 9 pass
bun run check
```

#### Commit

```sh
git add -A && git commit -m "feat(web): add the auth store"
```

### Step 8 — Web: header, Turnstile widget and the account pages

The home page's header moves into `SiteHeader` (brand, a Log in / Account link, the theme switch), which the account pages share. The play screen and its tray are untouched. Six pages: sign-up, login, confirm email, forgot password, new password, account. Form styles go at the end of the app stylesheet under `.auth`.

#### Replace the whole of `apps/web/src/app.d.ts` with

```ts
// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {}

  /** Cloudflare Turnstile's browser API (https://developers.cloudflare.com/turnstile/). */
  interface TurnstileApi {
    render(
      container: HTMLElement,
      options: {
        sitekey: string;
        theme?: "light" | "dark" | "auto";
        callback?: (token: string) => void;
        "expired-callback"?: () => void;
        "error-callback"?: () => void;
      },
    ): string;
    reset(widgetId: string): void;
    remove(widgetId: string): void;
  }

  interface Window {
    turnstile?: TurnstileApi;
  }
}

export {};
```

#### Create `apps/web/src/lib/components/AccountLink.svelte`

```svelte
<script lang="ts">
  import { auth } from "../auth/index.ts";
</script>

{#if $auth.status === "user"}
  <a class="account" href="/account">Account</a>
{:else if $auth.status === "guest"}
  <a class="account" href="/login">Log in</a>
{/if}

<style>
  .account {
    height: 40px;
    padding: 0 14px;
    display: inline-flex;
    align-items: center;
    border: 2px solid var(--ink);
    border-radius: 999px;
    font-size: 14px;
    font-weight: 700;
    white-space: nowrap;
  }
</style>
```

#### Create `apps/web/src/lib/components/SiteHeader.svelte`

```svelte
<script lang="ts">
  import AccountLink from "./AccountLink.svelte";
  import ThemeSwitch from "./ThemeSwitch.svelte";
</script>

<header class="top">
  <div class="top-inner">
    <a class="brand" href="/">
      <svg width="24" height="30" viewBox="0 0 196 252" aria-hidden="true">
        <polyline points="14,14 182,14 182,126 126,126 126,238 70,238 70,126 14,126" fill="none" stroke="currentColor" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" />
        <line x1="14" y1="126" x2="14" y2="14" stroke="var(--shu)" stroke-width="24" stroke-linecap="round" />
      </svg>
      <span>Loophole</span>
    </a>
    <nav class="nav">
      <AccountLink />
      <ThemeSwitch />
    </nav>
  </div>
</header>

<style>
  .top {
    background: var(--sheet);
    border-bottom: 2px solid var(--ink);
  }

  .top-inner {
    max-width: 960px;
    margin: 0 auto;
    min-height: 56px;
    padding: 6px 16px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 24px;
    letter-spacing: -0.01em;
  }

  .nav {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
</style>
```

#### Create `apps/web/src/lib/components/Turnstile.svelte`

```svelte
<script lang="ts" module>
  const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  let loading: Promise<TurnstileApi> | null = null;

  /** Loads Cloudflare's script once per page. */
  function loadTurnstile(): Promise<TurnstileApi> {
    loading ??= new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = () =>
        window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile missing"));
      script.onerror = () => {
        loading = null;
        reject(new Error("Turnstile failed to load"));
      };
      document.head.append(script);
    });
    return loading;
  }
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { auth } from "../auth/index.ts";

  interface Props {
    /** Called with a token when the check passes. */
    onverify: (token: string) => void;
    /** Called when the token expires or the check fails; a new token is needed. */
    onexpire: () => void;
  }

  let { onverify, onexpire }: Props = $props();
  let box: HTMLDivElement;
  let failed = $state(false);
  let api: TurnstileApi | null = null;
  let widgetId: string | null = null;

  /** Starts a new check, after the server used up the last token. */
  export function reset() {
    if (api !== null && widgetId !== null) api.reset(widgetId);
  }

  onMount(() => {
    let gone = false;
    (async () => {
      const siteKey = await auth.turnstileSiteKey();
      const loaded = siteKey === null ? null : await loadTurnstile().catch(() => null);
      if (gone) return;
      if (siteKey === null || loaded === null) {
        failed = true;
        return;
      }
      api = loaded;
      widgetId = api.render(box, {
        sitekey: siteKey,
        theme: "auto",
        callback: onverify,
        "expired-callback": onexpire,
        "error-callback": onexpire,
      });
    })();
    return () => {
      gone = true;
      if (api !== null && widgetId !== null) api.remove(widgetId);
    };
  });
</script>

<div class="turnstile" bind:this={box}></div>
{#if failed}
  <p class="error" role="alert">The anti-spam check couldn't load. Reload the page to try again.</p>
{/if}

<style>
  .turnstile {
    min-height: 65px;
  }
</style>
```

#### Replace the whole of `apps/web/src/routes/+layout.svelte` with

```svelte
<script lang="ts">
  import "@fontsource/zen-kaku-gothic-new/400.css";
  import "@fontsource/zen-kaku-gothic-new/500.css";
  import "@fontsource/zen-kaku-gothic-new/700.css";
  import "@fontsource/zen-maru-gothic/700.css";
  import "@fontsource/zen-maru-gothic/900.css";
  import { onMount } from "svelte";
  import { auth } from "$lib/auth/index.ts";
  import "../app.css";

  let { children } = $props();

  // Find out once who is logged in; the header and the account pages read the store.
  onMount(() => {
    auth.refresh();
  });
</script>

{@render children()}
```

#### Edit `apps/web/src/routes/+page.svelte`

In `apps/web/src/routes/+page.svelte`, replace

```svelte
  import ThemeSwitch from "$lib/components/ThemeSwitch.svelte";
```

with

```svelte
  import SiteHeader from "$lib/components/SiteHeader.svelte";
```

#### Edit `apps/web/src/routes/+page.svelte`

In `apps/web/src/routes/+page.svelte`, replace

```svelte
<header class="top">
  <div class="top-inner">
    <a class="brand" href="/">
      <svg width="24" height="30" viewBox="0 0 196 252" aria-hidden="true">
        <polyline points="14,14 182,14 182,126 126,126 126,238 70,238 70,126 14,126" fill="none" stroke="currentColor" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" />
        <line x1="14" y1="126" x2="14" y2="14" stroke="var(--shu)" stroke-width="24" stroke-linecap="round" />
      </svg>
      <span>Loophole</span>
    </a>
    <ThemeSwitch />
  </div>
</header>
```

with

```svelte
<SiteHeader />
```

#### Edit `apps/web/src/routes/+page.svelte`

In `apps/web/src/routes/+page.svelte`, replace

```svelte
  .top {
    background: var(--sheet);
    border-bottom: 2px solid var(--ink);
  }

  .top-inner {
    max-width: 960px;
    margin: 0 auto;
    min-height: 56px;
    padding: 6px 16px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 24px;
    letter-spacing: -0.01em;
  }

```

with nothing (delete it).

#### Append to the end of `apps/web/src/app.css`

```css
/* Account pages (sign-up, login, password reset, account): one narrow column of plain forms. */
.auth {
  max-width: 440px;
  margin: 0 auto;
  padding: 24px 16px calc(32px + env(safe-area-inset-bottom));
}

.auth h1 {
  margin: 0 0 8px;
  font-family: var(--font-display);
  font-weight: 900;
  font-size: 32px;
  line-height: 1.15;
}

.auth h2 {
  margin: 28px 0 8px;
  font-family: var(--font-display);
  font-weight: 900;
  font-size: 22px;
}

.auth p {
  margin: 0 0 14px;
  color: var(--ink-soft);
}

.auth p b {
  color: var(--ink);
}

.auth a:not(.button) {
  color: var(--ai);
  font-weight: 700;
}

.auth form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 16px 0;
}

.auth label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-weight: 700;
}

.auth input {
  height: 48px;
  padding: 0 12px;
  border: 2px solid var(--ink);
  border-radius: 6px;
  background: var(--sheet);
  color: var(--ink);
  font: inherit;
  /* 16px or more stops iOS Safari zooming into the field. */
  font-size: 16px;
}

.auth .hint {
  font-size: 13px;
  font-weight: 400;
  color: var(--ink-soft);
}

.auth .primary,
.auth .secondary,
.auth .danger {
  align-self: flex-start;
  height: 44px;
  padding: 0 20px;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}

.auth .primary {
  border: 0;
  background: var(--ink);
  color: var(--on-ink);
}

.auth .secondary {
  border: 2px solid var(--ink);
  background: transparent;
}

.auth .danger {
  border: 2px solid var(--shu);
  background: transparent;
  color: var(--shu);
}

.auth button:disabled {
  opacity: 0.6;
  cursor: default;
}

.auth .error {
  margin: 0;
  padding: 10px 12px;
  border-left: 4px solid var(--shu);
  background: var(--sheet);
  color: var(--ink);
}

.auth .done {
  padding: 12px 14px;
  border: 2px solid var(--ink);
  border-radius: 6px;
  background: var(--sheet);
  color: var(--ink);
}
```

Keep one blank line between the file's last existing line and the appended text.

#### Create `apps/web/src/routes/signup/+page.svelte`

```svelte
<script lang="ts">
  import { auth } from "$lib/auth/index.ts";
  import SiteHeader from "$lib/components/SiteHeader.svelte";
  import Turnstile from "$lib/components/Turnstile.svelte";

  let email = $state("");
  let password = $state("");
  let captchaToken = $state("");
  let error = $state("");
  let busy = $state(false);
  let sentTo = $state("");
  let turnstile: { reset(): void } | undefined = $state();

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (captchaToken === "") {
      error = "Wait for the anti-spam check below to finish.";
      return;
    }
    busy = true;
    error = "";
    const result = await auth.signUp(email, password, captchaToken);
    busy = false;
    if (result.ok) {
      sentTo = email;
      return;
    }
    error = result.message;
    // Each token works once, so a new check is needed for the next try.
    captchaToken = "";
    turnstile?.reset();
  }
</script>

<svelte:head>
  <title>Sign up · Loophole</title>
</svelte:head>

<SiteHeader />

<main class="auth">
  <h1>Sign up</h1>
  {#if sentTo}
    <p class="done" role="status">
      Check your inbox at <b>{sentTo}</b>. Open the link we sent to confirm your email, then
      <a href="/login">log in</a>.
    </p>
  {:else}
    <p>Accounts are optional: every puzzle plays without one.</p>
    <form onsubmit={submit}>
      <label>
        Email
        <input type="email" autocomplete="email" required maxlength="254" bind:value={email} />
      </label>
      <label>
        Password
        <input type="password" autocomplete="new-password" required minlength="8" maxlength="128" bind:value={password} />
        <span class="hint">At least 8 characters.</span>
      </label>
      <Turnstile bind:this={turnstile} onverify={(token) => (captchaToken = token)} onexpire={() => (captchaToken = "")} />
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="primary" type="submit" disabled={busy}>Create account</button>
    </form>
    <p>Already have an account? <a href="/login">Log in</a></p>
  {/if}
</main>
```

#### Create `apps/web/src/routes/login/+page.svelte`

```svelte
<script lang="ts">
  import { goto } from "$app/navigation";
  import { auth } from "$lib/auth/index.ts";
  import SiteHeader from "$lib/components/SiteHeader.svelte";

  let email = $state("");
  let password = $state("");
  let error = $state("");
  let busy = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = "";
    const result = await auth.logIn(email, password);
    busy = false;
    if (result.ok) await goto("/");
    else error = result.message;
  }
</script>

<svelte:head>
  <title>Log in · Loophole</title>
</svelte:head>

<SiteHeader />

<main class="auth">
  <h1>Log in</h1>
  <form onsubmit={submit}>
    <label>
      Email
      <input type="email" autocomplete="email" required maxlength="254" bind:value={email} />
    </label>
    <label>
      Password
      <input type="password" autocomplete="current-password" required maxlength="128" bind:value={password} />
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="primary" type="submit" disabled={busy}>Log in</button>
  </form>
  <p><a href="/forgot-password">Forgot your password?</a></p>
  <p>New here? <a href="/signup">Sign up</a></p>
</main>
```

#### Create `apps/web/src/routes/verify-email/+page.svelte`

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { auth, tokenFromHash } from "$lib/auth/index.ts";
  import SiteHeader from "$lib/components/SiteHeader.svelte";

  let status: "checking" | "done" | "failed" = $state("checking");
  let error = $state("");
  let email = $state("");
  let resent = $state(false);

  onMount(async () => {
    const token = tokenFromHash(location.hash);
    // Keep the token out of the history and out of any shared URL.
    history.replaceState(history.state, "", location.pathname);
    if (token === null) {
      status = "failed";
      error = "This link is incomplete. Copy the whole link from the email.";
      return;
    }
    const result = await auth.verifyEmail(token);
    if (result.ok) status = "done";
    else {
      status = "failed";
      error = result.message;
    }
  });

  async function resend(event: SubmitEvent) {
    event.preventDefault();
    const result = await auth.resendVerification(email);
    if (result.ok) resent = true;
    else error = result.message;
  }
</script>

<svelte:head>
  <title>Confirm email · Loophole</title>
</svelte:head>

<SiteHeader />

<main class="auth">
  <h1>Confirm email</h1>
  {#if status === "checking"}
    <p role="status">Checking your link…</p>
  {:else if status === "done"}
    <p class="done" role="status">Your email is confirmed.</p>
    {#if $auth.status === "user"}
      <p><a href="/">Back to the puzzles</a></p>
    {:else}
      <p><a href="/login">Log in</a></p>
    {/if}
  {:else}
    <p class="error" role="alert">{error}</p>
    {#if resent}
      <p class="done" role="status">If that email has an unconfirmed account, a new link is on its way.</p>
    {:else}
      <form onsubmit={resend}>
        <label>
          Send a new link to
          <input type="email" autocomplete="email" required maxlength="254" bind:value={email} />
        </label>
        <button class="secondary" type="submit">Send link</button>
      </form>
    {/if}
  {/if}
</main>
```

#### Create `apps/web/src/routes/forgot-password/+page.svelte`

```svelte
<script lang="ts">
  import { auth } from "$lib/auth/index.ts";
  import SiteHeader from "$lib/components/SiteHeader.svelte";

  let email = $state("");
  let error = $state("");
  let busy = $state(false);
  let sent = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = "";
    const result = await auth.requestPasswordReset(email);
    busy = false;
    if (result.ok) sent = true;
    else error = result.message;
  }
</script>

<svelte:head>
  <title>Forgot password · Loophole</title>
</svelte:head>

<SiteHeader />

<main class="auth">
  <h1>Forgot password</h1>
  {#if sent}
    <p class="done" role="status">
      If <b>{email}</b> has an account, a link to reset its password is on its way. It works once,
      for an hour.
    </p>
  {:else}
    <p>We'll email you a link to choose a new password.</p>
    <form onsubmit={submit}>
      <label>
        Email
        <input type="email" autocomplete="email" required maxlength="254" bind:value={email} />
      </label>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="primary" type="submit" disabled={busy}>Send link</button>
    </form>
  {/if}
  <p><a href="/login">Back to log in</a></p>
</main>
```

#### Create `apps/web/src/routes/reset-password/+page.svelte`

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { auth, tokenFromHash } from "$lib/auth/index.ts";
  import SiteHeader from "$lib/components/SiteHeader.svelte";

  let token: string | null = $state(null);
  let ready = $state(false);
  let password = $state("");
  let confirm = $state("");
  let error = $state("");
  let busy = $state(false);
  let done = $state(false);

  onMount(() => {
    token = tokenFromHash(location.hash);
    // Keep the token out of the history and out of any shared URL.
    history.replaceState(history.state, "", location.pathname);
    ready = true;
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (token === null) return;
    if (password !== confirm) {
      error = "The two passwords don't match.";
      return;
    }
    busy = true;
    error = "";
    const result = await auth.resetPassword(token, password);
    busy = false;
    if (result.ok) done = true;
    else error = result.message;
  }
</script>

<svelte:head>
  <title>New password · Loophole</title>
</svelte:head>

<SiteHeader />

<main class="auth">
  <h1>New password</h1>
  {#if done}
    <p class="done" role="status">Your password is changed, and you're logged out everywhere.</p>
    <p><a href="/login">Log in</a></p>
  {:else if ready && token === null}
    <p class="error" role="alert">This link is incomplete. Copy the whole link from the email.</p>
    <p><a href="/forgot-password">Ask for a new link</a></p>
  {:else if ready}
    <form onsubmit={submit}>
      <label>
        New password
        <input type="password" autocomplete="new-password" required minlength="8" maxlength="128" bind:value={password} />
        <span class="hint">At least 8 characters.</span>
      </label>
      <label>
        Type it again
        <input type="password" autocomplete="new-password" required minlength="8" maxlength="128" bind:value={confirm} />
      </label>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="primary" type="submit" disabled={busy}>Change password</button>
    </form>
    <p><a href="/forgot-password">Ask for a new link</a></p>
  {/if}
</main>
```

#### Create `apps/web/src/routes/account/+page.svelte`

```svelte
<script lang="ts">
  import { goto } from "$app/navigation";
  import { auth } from "$lib/auth/index.ts";
  import SiteHeader from "$lib/components/SiteHeader.svelte";

  let resent = $state(false);
  let password = $state("");
  let error = $state("");
  let busy = $state(false);

  async function resend(email: string) {
    const result = await auth.resendVerification(email);
    if (result.ok) resent = true;
  }

  async function logOut() {
    await auth.logOut();
    await goto("/");
  }

  async function deleteAccount(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = "";
    const result = await auth.deleteAccount(password);
    busy = false;
    if (result.ok) await goto("/");
    else error = result.message;
  }
</script>

<svelte:head>
  <title>Account · Loophole</title>
</svelte:head>

<SiteHeader />

<main class="auth">
  <h1>Account</h1>
  {#if $auth.status === "loading"}
    <p role="status">Loading…</p>
  {:else if $auth.status === "guest"}
    <p>You're not logged in. <a href="/login">Log in</a> or <a href="/signup">sign up</a>.</p>
  {:else}
    {@const user = $auth.user}
    <p>Logged in as <b>{user.email}</b>.</p>
    {#if !user.emailVerified}
      {#if resent}
        <p class="done" role="status">A new confirmation link is on its way to {user.email}.</p>
      {:else}
        <p>
          Your email isn't confirmed yet. You can play as usual; confirming it will let you submit
          puzzles and appear on leaderboards when those arrive.
        </p>
        <button class="secondary" type="button" onclick={() => resend(user.email)}>Send a new link</button>
      {/if}
    {/if}
    <p><button class="primary" type="button" onclick={logOut}>Log out</button></p>

    <h2>Delete account</h2>
    <p>
      This removes your email, password and everything saved for your account, for good. Progress
      saved in this browser stays.
    </p>
    <form onsubmit={deleteAccount}>
      <label>
        Password
        <input type="password" autocomplete="current-password" required maxlength="128" bind:value={password} />
      </label>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="danger" type="submit" disabled={busy}>Delete my account</button>
    </form>
  {/if}
</main>
```

#### Check

```sh
bun run --cwd apps/web typecheck   # 0 errors, 0 warnings
bun run test:e2e                     # all 40 guest tests still pass (needs Chromium)
bun run check
```

#### Commit

```sh
git add -A && git commit -m "feat(web): add sign-up, login, password reset and account pages"
```

### Step 9 — Web: account end-to-end test

A second Playwright config that serves the built app from the real API on port 4174; `test:e2e` is unchanged and still runs with no server.

#### Create `apps/web/playwright.auth.config.ts`

```ts
import { defineConfig } from "@playwright/test";

// End-to-end test of accounts against the real API, which also serves the built app (as in
// production). Needs Mailpit (`docker compose up -d`) and access to Cloudflare's Turnstile check;
// the test skips itself without them. Run with `bun run test:e2e:auth` from this package.
export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.auth-e2e.ts",
  reporter: "list",
  use: {
    baseURL: "http://localhost:4174",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    // From the repo root, like the other server scripts.
    command: "bun run build && cd ../.. && bun apps/server/src/api/main.ts",
    url: "http://localhost:4174/api/health",
    reuseExistingServer: false,
    env: {
      PORT: "4174",
      WEB_DIR: "apps/web/build",
      // A fresh database for every run, gone when the server stops.
      DATABASE_PATH: ":memory:",
      PUBLIC_URL: "http://localhost:4174",
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1025",
      // The blob store isn't used by these pages, but the API needs settings for it.
      S3_ENDPOINT: "http://localhost:3900",
      S3_REGION: "garage",
      S3_BUCKET: "loophole-dev",
      S3_ACCESS_KEY_ID: "unused",
      S3_SECRET_ACCESS_KEY: "unused",
    },
  },
});
```

#### Create `apps/web/tests/accounts.auth-e2e.ts`

```ts
import { expect, test } from "@playwright/test";

const MAILPIT_API = "http://127.0.0.1:8025/api/v1";

/** A stand-in for Cloudflare's widget script: passes at once with Turnstile's dummy test token. */
const TURNSTILE_STUB = `window.turnstile = {
  render(el, options) { setTimeout(() => options.callback("XXXX.DUMMY.TOKEN.XXXX"), 0); return "stub"; },
  reset() {},
  remove() {},
};`;

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
  );
});

test("sign up, confirm the email, log in and log out", async ({ page }) => {
  await page.route("https://challenges.cloudflare.com/turnstile/**", (route) =>
    route.fulfill({ contentType: "text/javascript", body: TURNSTILE_STUB }),
  );
  const email = `e2e-${crypto.randomUUID()}@loophole.test`;

  await page.goto("/");
  await page.getByRole("link", { name: "Log in" }).click();
  await page.getByRole("link", { name: "Sign up" }).click();
  // The login page has the same fields; wait for the sign-up page before typing.
  await expect(page.getByRole("heading", { name: "Sign up" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("hunter22-e2e");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText(`Check your inbox at ${email}`);

  await page.goto(await mailedLink(email));
  await expect(page.getByRole("status")).toHaveText("Your email is confirmed.");
  expect(new URL(page.url()).hash).toBe(""); // the token is gone from the address bar

  await page.getByRole("link", { name: "Log in" }).last().click();
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("hunter22-e2e");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/");
  await page.getByRole("link", { name: "Account" }).click();
  await expect(page.getByText(`Logged in as ${email}.`)).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
});
```

#### Replace the whole of `apps/web/tsconfig.test.json` with

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["bun"]
  },
  "include": [
    "src/**/*.ts",
    "tests",
    "scripts",
    "playwright.config.ts",
    "playwright.auth.config.ts"
  ],
  "exclude": []
}
```

#### Edit `apps/web/package.json`

In `apps/web/package.json`, replace

```json
    "test:perf": "playwright test --grep @perf"
```

with

```json
    "test:perf": "playwright test --grep @perf",
    "test:e2e:auth": "playwright test --config playwright.auth.config.ts"
```

#### Edit `package.json`

In `package.json`, replace

```json
    "test:perf": "bun run --cwd apps/web test:perf",
```

with

```json
    "test:perf": "bun run --cwd apps/web test:perf",
    "test:e2e:auth": "bun run --cwd apps/web test:e2e:auth",
```

#### Check

```sh
docker compose up -d mailpit
bun run test:e2e:auth   # 1 passed (or 1 skipped if Mailpit or Cloudflare can't be reached)
bun run check
```

#### Commit

```sh
git add -A && git commit -m "test(web): add an end-to-end test of sign-up, confirmation, login and logout"
```

### Step 10 — Docs: README, TESTING, AGENTS, .env.example, DECISIONS

#### Edit `README.md`

In `README.md`, replace

```md
The web app lists the server's puzzles after its built-in ones. Accounts, hints, daily puzzles and the rest come in later phases;
```

with

```md
The web app lists the server's puzzles after its built-in ones. Players can sign up with an email and password (behind a CAPTCHA, with email confirmation), log in and out, reset a forgotten password and delete their account; guests play exactly as before. Hints, daily puzzles and the rest come in later phases;
```

In `README.md`, replace

```md
| Mailpit web UI | http://localhost:8025 | Shows captured mail |
```

with

```md
| Mailpit web UI | http://localhost:8025 | Shows captured mail, such as verification and password reset links |
```

In `README.md`, replace

```md
The API is described in [`openapi.yaml`](openapi.yaml). To serve the built web app from the API as in production, build it (`bun run --cwd apps/web build`) and set `WEB_DIR=apps/web/build` in `.env`.
```

with

````md
The API is described in [`openapi.yaml`](openapi.yaml). To serve the built web app from the API as in production, build it (`bun run --cwd apps/web build`) and set `WEB_DIR=apps/web/build` in `.env`.

### Accounts in development

With the API and `bun run dev:web` running, open http://localhost:5173/signup. The sign-up check is Cloudflare Turnstile with Cloudflare's test keys from `.env.example`, so it always passes and the widget says "For testing only". In production, set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` to a real widget's keys (Turnstile's free plan is enough). The API refuses to start with the test secret unless `PUBLIC_URL` is on `localhost` or `127.0.0.1`, and warns while it is in use there. Verification and password reset mail goes to Mailpit: open http://localhost:8025 and follow the link. Links point at `PUBLIC_URL`.

The session cookie is always `Secure`. Chromium and curl accept it on `http://localhost`, so development needs no HTTPS. In production, serve the site over HTTPS, and set `TRUST_PROXY=true` when a reverse proxy sits in front of the API, so rate limits see each client's own address.

There is no admin UI. To make an account an admin (for unpublishing puzzles and the health view in later phases), run from the repo root:

```sh
bun run admin you@example.com            # grant
bun run admin you@example.com --revoke   # take away
```

`bun run test:e2e:auth` builds the web app, starts the API serving it on port 4174 with a fresh database, and goes through sign-up, the emailed link, login and logout in Chromium. It needs Mailpit running and access to challenges.cloudflare.com, and skips itself without them.
````

In `README.md`, replace

```md
| `bun run test:perf` | Build the web app and run its frame-time checks |
```

with

```md
| `bun run test:perf` | Build the web app and run its frame-time checks |
| `bun run test:e2e:auth` | Build the web app, serve it from the API and run the account end-to-end test (needs Mailpit) |
| `bun run admin <email>` | Make an account an admin; `--revoke` takes it away |
```

#### Edit `docs/TESTING.md`

In `docs/TESTING.md`, replace

```md
- The S3 blob store test runs against Garage when the `S3_*` settings are set (from `.env`) and Garage answers; otherwise it is skipped, as in CI. Start Garage (README, Local services) to run it.
```

with

```md
- The S3 blob store test runs against Garage when the `S3_*` settings are set (from `.env`) and Garage answers; otherwise it is skipped, as in CI. Start Garage (README, Local services) to run it.
- The account and session managers run on fakes too (users, sessions, mailed tokens, password hashing, CAPTCHA) with the in-memory mailer and rate limiter. Route tests build the account side with `accountDeps` from the server's test support and pass a client address as `app.request`'s third argument.
- The SMTP mailer test sends through Mailpit and reads the message back from Mailpit's API when it answers on 127.0.0.1:8025; otherwise it is skipped. The Turnstile adapter is tested with a fake `fetch`, never against Cloudflare.
```

In `docs/TESTING.md`, replace

```md
Frame-time checks (`tests/perf.e2e.ts`, tagged `@perf`)
```

with

```md
The account end-to-end test (`tests/accounts.auth-e2e.ts`) has its own config, `playwright.auth.config.ts`: it builds the app and starts the real API serving it on port 4174, with a fresh database, Mailpit for mail and Turnstile's test keys. It replaces Cloudflare's widget script with a stub and reads the confirmation link from Mailpit's API. Run it with `bun run test:e2e:auth`; it skips itself when Mailpit or challenges.cloudflare.com can't be reached.

Frame-time checks (`tests/perf.e2e.ts`, tagged `@perf`)
```

#### Edit `apps/server/AGENTS.md`

In `apps/server/AGENTS.md`, replace

```md
- Adapters implement those interfaces (SQLite repositories and job queue, blob stores, the thread task runner, the clock) and convert rows and objects to domain types.
```

with

```md
- Adapters implement those interfaces (SQLite repositories and job queue, blob stores, the thread task runner, the clock, the mailer, the CAPTCHA check, password hashing, the rate limiter) and convert rows and objects to domain types.
```

In `apps/server/AGENTS.md`, replace

```md
- Tests: managers with fakes,
```

with

```md
- Routes that need a logged-in user call `currentUser(c, sessions)` from `api/session-cookie.ts` and answer 401 when it is null; routes for confirmed accounts only also check `emailVerifiedAt`. Every state-changing request under `/api` goes through the CSRF check in `api/csrf.ts`, so list a 403 response on new POST, PUT and DELETE routes. A route without a request body isn't covered by the JSON-only rule, so it relies on that check and SameSite alone.
- A table that holds a user's data references `users(id) ON DELETE CASCADE`, so deleting the account deletes it (PRD NFR-6).
- In a schema, write "this registered schema or null" as `z.union([Schema, z.null()])`. `.nullable()` on a schema registered with `.openapi("Name")` makes the shared component itself nullable.
- Tests: managers with fakes,
```

#### Edit `apps/web/AGENTS.md`

In `apps/web/AGENTS.md`, replace

```md
- End-to-end tests end in `.e2e.ts`
```

with

```md
- Who is logged in comes from the auth store in `$lib/auth`, a plain module over the generated client with tests beside it. The root layout refreshes it once; the shared site header shows it. The account pages are plain forms styled by the `.auth` rules in the app stylesheet.
- End-to-end tests end in `.e2e.ts`
```

In `apps/web/AGENTS.md`, replace

```md
Frame-time checks are tagged `@perf` and run with `bun run test:perf` instead.
```

with

```md
Frame-time checks are tagged `@perf` and run with `bun run test:perf` instead. The account test ends in `.auth-e2e.ts` and runs against the real API with its own config (`bun run test:e2e:auth`).
```

#### Edit `.env.example`

Use the Read and Edit tools for this file (shell commands that read `.env*` files may be denied). Replace

```sh
# Mail (Mailpit)
SMTP_HOST=localhost
SMTP_PORT=1025
```

with

```sh
# Mail (Mailpit: see the captured mail at http://localhost:8025)
SMTP_HOST=localhost
SMTP_PORT=1025
# For a real SMTP server: TLS from the start (port 465) and a login.
# SMTP_SECURE=true
# SMTP_USER=
# SMTP_PASSWORD=
MAIL_FROM="Loophole <no-reply@loophole.localhost>"

# Accounts
# Where the web app is, for the links in verification and reset mail (the Vite dev server here).
PUBLIC_URL=http://localhost:5173
# Cloudflare Turnstile's test keys: the sign-up check always passes. Use real keys in production.
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
# Behind a reverse proxy, rate limits take the client's address from X-Forwarded-For.
# TRUST_PROXY=true
```

#### Append to the end of `docs/DECISIONS.md`

Keep one blank line after the last existing entry.

```md
## 2026-10-25 · WT7 `accounts` · Account API
- **Question:** Which endpoints do accounts need, and what do they answer?
- **Decision:** `GET /api/auth/config` (`{turnstileSiteKey}`), `GET /api/session` (`{user}`, null when logged out), and, all with JSON bodies: `POST /api/auth/signup` (`{email, password, captchaToken}` → 204), `POST /api/auth/login` (→ 200 user, sets the cookie), `POST /api/auth/logout` (→ 204), `POST /api/auth/verify-email` and `POST /api/auth/reset-password` (mailed token, → 204 or 400), `POST /api/auth/resend-verification` and `POST /api/auth/forgot-password` (`{email}` → always 204), `DELETE /api/account` (`{password}` → 204). The user DTO is `{id, email, emailVerified, isAdmin, createdAt}`. Passwords are 8 to 128 characters, emails at most 254. Errors are problem details: 400 invalid body, CAPTCHA or link; 401 wrong credentials or not logged in; 403 cross-site; 429 with `Retry-After`. The routes live in `api/accounts.ts`; `AccountManager` and `SessionManager` hold the logic.
- **Reason:** Small, JSON-only and enough for the six web pages. Keeping the account routes in their own module keeps `app.ts` small for the phases that add routes next.

## 2026-10-25 · WT7 `accounts` · Sessions: opaque cookie tokens
- **Question:** How are logins kept (NFR-4)?
- **Decision:** Login sets `loophole_session` to 32 random bytes (base64url) with `HttpOnly; Secure; SameSite=Lax; Path=/`, expiring 30 days after login, with no sliding renewal. The `sessions` table stores only the token's SHA-256 with the user id and expiry. Every login issues a new token and ends the session of any cookie sent with it; logout deletes the row and clears the cookie; a password reset ends every session of the account. Expired rows are deleted when looked up and whenever a session starts. `Secure` is always on: Chromium and curl accept it on `http://localhost`.
- **Reason:** A server-side token can be revoked, unlike a signed one; storing a hash means a leaked database logs nobody in; a new token per login rules out session fixation. A fixed lifetime keeps the code small.

## 2026-10-25 · WT7 `accounts` · CSRF: Fetch Metadata, SameSite and JSON-only bodies
- **Question:** How are state-changing requests protected from other sites (NFR-4)?
- **Decision:** Three layers, no CSRF token. (1) Middleware on every `/api` request except GET, HEAD and OPTIONS: allowed when `Sec-Fetch-Site` is `same-origin` or `none`, refused with a 403 problem when it is `same-site` or `cross-site`; without that header, allowed when there is no `Origin` or its host equals the request's, refused otherwise (including `Origin: null`). This is the rule of Go 1.25's `CrossOriginProtection`. (2) The session cookie is `SameSite=Lax`, so another site's POST carries no session. (3) Routes that take a body require `application/json` (415 otherwise), which an HTML form can't send and a cross-origin `fetch` can't send without a CORS preflight the API never grants. Routes without a body (logout, and later ones such as report or unpublish) rely on (1) and (2) alone.
- **Reason:** Current browsers send `Sec-Fetch-Site` on every request and older ones send `Origin` on cross-origin POSTs, so the check needs no state and no client code. A request with neither header doesn't come from a browser and carries no victim's cookies, so curl and scripts keep working. Refusing `same-site` too stops a sibling subdomain from acting for a user.

## 2026-10-25 · WT7 `accounts` · Rate limits on the auth endpoints
- **Question:** What limits apply, and where are they counted (NFR-4)?
- **Decision:** Fixed-window counters in the API process's memory (`MemoryRateLimiter` behind the `RateLimiter` port). Per client address, in the routes: sign-up 10 per hour; login 20 per 15 minutes; resend-verification and forgot-password 10 per hour together; verify-email and reset-password 20 per 15 minutes together; account deletion 10 per 15 minutes. Per email, in the account manager: 10 login or deletion attempts per 15 minutes from anywhere, and at most 3 mails per address per hour (more are dropped silently, so the answer doesn't change). Over a limit: 429 problem with `Retry-After` in seconds. The address is the socket's peer, or with `TRUST_PROXY=true` the last `X-Forwarded-For` entry; IPv6 addresses count by their /64 prefix. Once 10,000 keys are held, ended windows are dropped, at most once a minute.
- **Reason:** There is one API process, so memory is enough, and counts lost on a restart don't matter for abuse limits. Per-email limits stop password guessing spread over many addresses and inbox flooding. Only the entry the trusted proxy added is believed, so clients can't pick their own address, and counting a /64 as one client stops rotation through an IPv6 block. The per-email login limit has a cost, accepted for now: anyone who knows an email can keep that account from logging in (or deleting itself) by sending 10 bad attempts every 15 minutes. If that is abused, key the strict limit on email plus address and keep a looser per-email ceiling.

## 2026-10-25 · WT7 `accounts` · No answer reveals whether an email has an account
- **Question:** How do sign-up, login and the mail requests avoid telling who is registered?
- **Decision:** Sign-up doesn't log in and always answers 204. A new email gets a verification link; a taken one gets a "You already have a Loophole account" note with links to log in and reset the password. The password is hashed in both cases. Login gives the same 401 for an unknown email and a wrong password, and checks unknown emails against a throwaway hash so both take about as long. Resend-verification and forgot-password always answer 204. Mail is handed off and sent after the answer (`BackgroundMailer`), so neither the SMTP round trip nor an SMTP error shows which addresses got mail. Emails are trimmed and lower-cased before they are stored or compared.
- **Reason:** Uniform answers keep the address list private. The cost is one extra step after sign-up (confirm, then log in), which is also the path the end-to-end test takes.

## 2026-10-25 · WT7 `accounts` · What unconfirmed accounts can do
- **Question:** What may an account do before its email is confirmed?
- **Decision:** Log in, play, sync progress (WT9) and delete itself. Submitting puzzles (WT10) and leaderboard entries (WT11) need a confirmed email: those routes answer 403 while `emailVerifiedAt` is null. A password reset link also confirms the email. Unconfirmed accounts are not purged.
- **Reason:** Confirmation guards the features that publish under an account, which are the ones abuse would aim at; blocking play would only add friction. If someone signs up with another person's address, the owner takes it over with "Forgot password", which confirms the email and ends the squatter's sessions.

## 2026-10-25 · WT7 `accounts` · Mailed tokens
- **Question:** How do verification and reset links work?
- **Decision:** Each token is 32 random bytes, stored as its SHA-256 in `account_tokens` with its purpose and expiry: 24 hours for verification, 1 hour for a reset. Using a token deletes it (`DELETE … RETURNING`), so a link works once, and a new link for the same purpose replaces the old one. Links carry the token in the fragment (`/verify-email#token=…`, `/reset-password#token=…`); the page takes it out of the address bar before calling the API.
- **Reason:** A fragment never reaches a server log or a `Referer` header. Single use and short lifetimes limit what a leaked mail is worth; hashing means the table alone can't be used.

## 2026-10-25 · WT7 `accounts` · Turnstile for the sign-up CAPTCHA
- **Question:** How is FR-19 met, and how do development and tests run without a Cloudflare account?
- **Decision:** Cloudflare Turnstile (free plan, PRD §14 question 3). The sign-up page loads `api.js?render=explicit` and renders the widget with the site key from `GET /api/auth/config`; the API checks the token with siteverify (form POST of `secret`, `response` and `remoteip`, 5 s timeout) through the `CaptchaVerifier` port. A refused token, an HTTP error and a network failure all fail the sign-up with a 400. With real keys, a token whose siteverify `hostname` isn't `PUBLIC_URL`'s host is refused too. `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` default to Cloudflare's always-pass test keys (`1x00000000000000000000AA`, `1x0000000000000000000000000000000AA`), but the settings refuse the test secret unless `PUBLIC_URL` is on `localhost` or `127.0.0.1`, so a deployment that forgets the keys doesn't start; on localhost the API warns at startup. Unit tests use a fake verifier; the end-to-end test swaps the widget script for a stub that returns the dummy token `XXXX.DUMMY.TOKEN.XXXX`, which the test secret accepts.
- **Reason:** Free and works with no setup in a fresh checkout, while a public site can't run with a CAPTCHA that always passes. Failing closed when Cloudflare can't be reached keeps bots out at the cost of sign-ups during an outage.

## 2026-10-25 · WT7 `accounts` · Password hashing settings
- **Question:** Which argon2id settings, and which password rules?
- **Decision:** `Bun.password` with argon2id, 19 MiB of memory and 2 passes (OWASP's minimum), about 20 ms per hash on the dev host, behind the `PasswordHasher` port. Passwords are 8 to 128 characters with no other rules. Manager tests use a fake hasher that prefixes the password.
- **Reason:** Bun's default of 64 MiB would let a burst of logins take a lot of memory on a small server. The hash string records its settings, so they can be raised later and old hashes still verify.

## 2026-10-25 · WT7 `accounts` · Account deletion and admins
- **Question:** What does deleting an account remove, and how does someone become an admin (NFR-6, PRD §5)?
- **Decision:** `DELETE /api/account` with the password deletes the `users` row, and its sessions and tokens go with it through `ON DELETE CASCADE`. Every later table that holds a user's data must reference `users(id) ON DELETE CASCADE` as well (WT9 progress, WT11 leaderboard entries). Puzzles a user submitted (WT10) should stay published with their author link set to null (`ON DELETE SET NULL`), since others may have played them. `users` holds only id, email, password hash, confirmation time, admin flag and creation time. Admins are set with `bun run admin <email>` (`--revoke` to remove); there is no UI.
- **Reason:** Cascades make deletion complete by construction rather than by a list of deletes to keep in step. An admin flag set from the command line is enough for the few admins WT10 and WT12 need.

## 2026-10-25 · WT7 `accounts` · Mail over SMTP with nodemailer 10.1.0
- **Question:** Which mail library and version, and how is mail sent?
- **Decision:** `nodemailer` 10.1.0 (no dependencies, ships its own types, so no `@types/nodemailer`), configured by `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM`, behind the `Mailer` port. Mail is plain text. The API wraps the SMTP mailer in `BackgroundMailer`, which hands the message off and returns at once: the answer doesn't wait for SMTP, and a failure is logged (without the message, which holds a token) instead of becoming a 500; "Send a new link" recovers a lost mail. Mailpit catches mail in development; tests use the in-memory mailer, and one integration test sends through Mailpit when it is running.
- **Reason:** 10.1.0 is the newest release more than two weeks old (10.2.1 is three days old, and 10.1.x had seven releases in one day). Waiting for SMTP inside the request would let its latency and errors tell registered emails from unknown ones. A mail lost when the process stops mid-send is acceptable; a durable queue can come later.

## 2026-10-25 · WT7 `accounts` · Account end-to-end test against the real API
- **Question:** How is sign-up → confirm → login → logout tested in a browser without making `test:e2e` depend on a server?
- **Decision:** A second Playwright config, `playwright.auth.config.ts` (`bun run test:e2e:auth`), builds the app and starts the API serving it (`WEB_DIR`) on port 4174 with a fresh in-memory database. The test stubs Cloudflare's widget script, reads the link from Mailpit's API, and skips itself when Mailpit or challenges.cloudflare.com can't be reached. Its file ends in `.auth-e2e.ts`, so `test:e2e` doesn't pick it up.
- **Reason:** The guest tests stay offline and fast, and the account test runs cookies, CSRF headers and mail the way production does.
```

#### Check

```sh
bun run check
```

#### Commit

```sh
git add -A && git commit -m "docs: describe accounts, the dev mail flow and the admin script"
```

### Step 11 — live end-to-end run (no commit)

From the worktree root, with Docker running and port 3100 free (`ss -ltn | grep ':3100\b'` prints nothing). Save this as `/tmp/wt7-live.sh`:

```sh
export PATH="$HOME/.bun/bin:$PATH"
docker compose up -d mailpit
mkdir -p /tmp/wt7-live && rm -f /tmp/wt7-live/*
SETTINGS="DATABASE_PATH=/tmp/wt7-live/db.sqlite S3_ENDPOINT=http://localhost:3900 S3_REGION=garage S3_BUCKET=loophole-dev S3_ACCESS_KEY_ID=unused S3_SECRET_ACCESS_KEY=unused"
env PORT=3100 $SETTINGS bun apps/server/src/api/main.ts > /tmp/wt7-live/api.log 2>&1 &
sleep 2; cat /tmp/wt7-live/api.log
E=live-$RANDOM@loophole.test; J=/tmp/wt7-live/jar; A=localhost:3100/api; H='content-type: application/json'
link() { curl -s "127.0.0.1:8025/api/v1/search?query=to:%22$E%22" | python3 -c 'import json,re,sys,urllib.request; m=json.load(sys.stdin)["messages"][0]; t=json.load(urllib.request.urlopen("http://127.0.0.1:8025/api/v1/message/"+m["ID"]))["Text"]; print(re.search(r"#token=([\w-]+)", t).group(1))'; }
curl -s -o /dev/null -w "signup %{http_code}\n" -X POST $A/auth/signup -H "$H" -d "{\"email\":\"$E\",\"password\":\"hunter22\",\"captchaToken\":\"XXXX.DUMMY.TOKEN.XXXX\"}"
sleep 1; TOK=$(link)
curl -s -o /dev/null -w "verify %{http_code}\n" -X POST $A/auth/verify-email -H "$H" -d "{\"token\":\"$TOK\"}"
curl -s -i -c $J -X POST $A/auth/login -H "$H" -d "{\"email\":\"$E\",\"password\":\"hunter22\"}" | grep -iE '^HTTP|^set-cookie'
curl -s -b $J $A/session; echo
curl -s -o /dev/null -w "forgot %{http_code}\n" -X POST $A/auth/forgot-password -H "$H" -d "{\"email\":\"$E\"}"
sleep 1; TOK=$(link)
curl -s -o /dev/null -w "reset %{http_code}\n" -X POST $A/auth/reset-password -H "$H" -d "{\"token\":\"$TOK\",\"password\":\"newpass99\"}"
curl -s -b $J $A/session; echo
curl -s -o /dev/null -w "old password %{http_code}\n" -X POST $A/auth/login -H "$H" -d "{\"email\":\"$E\",\"password\":\"hunter22\"}"
env $SETTINGS bun run admin "$E"
curl -s -c $J -X POST $A/auth/login -H "$H" -d "{\"email\":\"$E\",\"password\":\"newpass99\"}"; echo
curl -s -o /dev/null -w "cross-site %{http_code}\n" -X POST $A/auth/logout -H 'Origin: http://evil.test'
curl -s -o /dev/null -w "delete %{http_code}\n" -b $J -c $J -X DELETE $A/account -H "$H" -d '{"password":"newpass99"}'
curl -s -b $J $A/session; echo
sqlite3 /tmp/wt7-live/db.sqlite 'SELECT count(*) FROM users; SELECT count(*) FROM sessions; SELECT count(*) FROM account_tokens;'
```

Run it with `bash /tmp/wt7-live.sh` from the worktree root. Expected output, in order (this is what the prototype printed):

```
Using Turnstile's test keys: the sign-up CAPTCHA always passes. Not for production.
API listening on http://127.0.0.1:3100/
signup 204                       # the API called Cloudflare's siteverify with the test secret
verify 204                       # link read from Mailpit
HTTP/1.1 200 OK
set-cookie: loophole_session=…; Path=/; Expires=<30 days on>; HttpOnly; Secure; SameSite=Lax
{"user":{…,"emailVerified":true,"isAdmin":false,…}}
forgot 204
reset 204
{"user":null}                    # the reset ended every session
old password 401
… is now an admin.
{…,"isAdmin":true,…}
cross-site 403
delete 204
{"user":null}
0
0
0                                # users, sessions, account_tokens all empty
```

Also open http://localhost:8025 and read the two mails to the address (confirm, then reset). Then stop the API: `kill $(ps -eo pid,args | grep '[b]un apps/server/src/api/main.ts' | awk '{print $1}')` (check the pid is yours if the hints worktree runs an API too), and `rm -rf /tmp/wt7-live /tmp/wt7-live.sh`.

Optionally, only if no other worktree is using Mailpit: `docker compose stop mailpit`, then `bun test apps/server/src/adapters/mail` (1 skip) and `bun run test:e2e:auth` (1 skipped), then `docker compose start mailpit` if it was running before. Never `docker compose down -v`. Record anything unexpected in your final report.

### Step 12 — final check

`bun run check` passes; `bun run test:e2e` passes (40 tests); `bun run test:e2e:auth` passes with Mailpit up; `git status` is clean; `git log --oneline main..` shows the 10 commits above (plus the plan commit made by the orchestrator).

## Acceptance criteria

| # | Criterion | How it's checked |
|---|---|---|
| 1 | FR-18: sign-up and login with email + password; passwords hashed with argon2id | `password-hasher.test.ts` (`$argon2id$v=19$m=19456,t=2,` prefix, verify true/false, salted); `account-manager.test.ts` "signUp stores…", "logIn checks the password…"; `accounts.test.ts` "the whole path…"; Step 11 |
| 2 | FR-19: sign-up needs a CAPTCHA, checked server-side, failing closed | `turnstile.test.ts` (form fields, `success`, failures → false, wrong hostname → false); `config.test.ts` "refuses Turnstile's test secret for a site that isn't on localhost"; `account-manager.test.ts` "a failed CAPTCHA stores and mails nothing"; `accounts.test.ts` "a failed CAPTCHA is a 400 problem"; Step 11 calls the real siteverify with the test secret; e2e uses the widget flow |
| 3 | FR-20: email verification | `account-manager.test.ts` verify once, 24 h expiry, resend replaces; `accounts.test.ts` used token → 400; `smtp-mailer.test.ts` against Mailpit; e2e reads the link from Mailpit and confirms |
| 4 | FR-20: password reset; logs out everywhere; single-use, 1 h | `account-manager.test.ts` reset tests; `accounts.test.ts` "a reset sets the new password and logs out every session"; Step 11 |
| 5 | Tokens are single-use, expiring and stored hashed | `account-token-repository.test.ts` (take once, replace); `session-manager.test.ts` "create stores only the token's hash"; tables hold `token_hash` only (`002_accounts.sql`) |
| 6 | NFR-4: session cookie is Secure, HttpOnly, SameSite=Lax; rotated on login; logout | `accounts.test.ts` "the whole path…" (attributes, 30-day Expires, Max-Age=0 on logout), "logging in with a session cookie replaces that session"; Step 11 |
| 7 | NFR-4: CSRF protection on state-changing requests | `accounts.test.ts` "CSRF protection" (cross-site and same-site → 403, Origin mismatch/`null` → 403, same origin and no-browser requests pass, GETs never refused, `/api/jobs/generate` covered); Step 11 `cross-site 403` |
| 8 | NFR-4: rate limits on auth endpoints | `rate-limiter.test.ts` (windows, keys, pruning at most once a minute); `client-address.test.ts` (IPv6 counted by /64); `accounts.test.ts` "rate limits" (per address with `Retry-After: 3600`, per email across addresses with `Retry-After: 900`, X-Forwarded-For only when trusted); `account-manager.test.ts` login lock and mail cap |
| 9 | NFR-4: parameterized queries and input validation | the three repositories use `db.query` with named parameters only; `accounts.test.ts` "sign-up validates the body" (bad email, short and long password, missing token, unknown field → 400) |
| 10 | No email enumeration | `accounts.test.ts` "signing up with a taken email answers exactly like a new sign-up", "a wrong password and an unknown email get the same 401", "resend and forgot-password answer 204 for unknown emails too"; `background-mailer.test.ts` (resolves before SMTP finishes, failures logged and never returned); `main.ts` wraps the SMTP mailer in `BackgroundMailer` |
| 11 | NFR-6: only email, password hash (and gameplay data) stored; account deletion removes the user's data | `002_accounts.sql` columns; `user-repository.test.ts` "delete removes the user together with their sessions and tokens"; `accounts.test.ts` "deleting the account needs a session and the password"; Step 11 counts 0/0/0 |
| 12 | Admin flag for WT10/WT12, set without UI | `user-repository.test.ts` setAdmin; Step 6 and Step 11 (`bun run admin`), `isAdmin` in the User DTO |
| 13 | Unconfirmed accounts: defined and documented | `accounts.test.ts` "an unverified account can log in"; DECISIONS "What unconfirmed accounts can do"; account page text |
| 14 | Layering: routes translate and validate; managers hold the logic over ports; adapters do I/O; composition roots wire | `api/accounts.ts` only calls `AccountManager`/`SessionManager` and the `RateLimiter` port; Biome overrides (checked in the prototype by adding `import "nodemailer"` and an adapter import to a manager and to `api/accounts.ts`: all three fail the lint); manager tests use fakes only |
| 15 | Contract regenerated | `bun run check:api` in the gate; `openapi.yaml` lists the 10 new operations and the `session` cookie security scheme |
| 16 | Web: sign-up with Turnstile, login, logout, verify landing, forgot/reset, account with delete, header shows auth state | `auth.test.ts` (9 tests); `accounts.auth-e2e.ts` (sign-up → mail → confirm → login → Account → logout); prototype checked the real Turnstile widget through the Vite proxy |
| 17 | The guest flow is unchanged | `bun run test:e2e` (40 pass, no server); `auth.refresh()` treats a missing API as guest (`auth.test.ts`) |
| 18 | Mailer integration test skips when Mailpit is down; the e2e skips without Mailpit or Cloudflare | Step 11 optional part (1 skip / 1 skipped), checked in the prototype |

## Prototype

The whole plan was built in a scratch clone of `feat/accounts` (`3542be0`) and then replayed from this document's steps, by script, in a second fresh clone: `bun run check` passed after every one of Steps 1–10 (384 → 395 → 408 → 429 → 452 → 452 → 461 → 461 → 461 → 461 tests passing with Mailpit up, plus the 2 skipped Garage tests), and the final tree matched the prototype file for file, including `bun.lock`, `openapi.yaml` and `packages/api-client/src/schema.ts`. Also run in the prototype: the Step 11 script against Mailpit and Cloudflare's real siteverify (output above); `bun run test:e2e:auth` four times in a row (1 passed each, about 9 s); `bun run test:e2e` (40 passed); the real Turnstile widget with the test site key in Chromium through `bun run dev:web` and the Vite proxy (widget showed "Success!", sign-up went through, login stored a `Secure; HttpOnly; SameSite=Lax` cookie on `http://localhost:5173`); the home, sign-up and account pages at 360 px (no horizontal scroll); the Mailpit test and the account e2e with Mailpit stopped (skipped); argon2id at 19 MiB / t=2 measured about 20 ms per login on this host.

After review round 1 the changed steps (3, 4, 5, 9, 10) were rebuilt in the prototype and the whole plan replayed again in a fresh clone (counts above, final tree identical). Re-run live: the Step 11 script (same output as above, now with `sleep 1` before reading Mailpit); the API with `SMTP_PORT=1` (sign-up and both forgot-password requests answered 204 in 0.5–2 ms, and the log showed only `Sending mail failed: ESOCKET`); the API with `PUBLIC_URL=https://loophole.example` and the test keys (refused to start with the Turnstile message, exit 1); `bun run test:e2e:auth` twice (passed, now on an in-memory database, so no files are left in the temp folder).

One thing found while prototyping and kept in the plan: `UserSchema.nullable()` on a schema registered with `.openapi("User")` made the shared `User` component itself nullable in `openapi.yaml`; `z.union([UserSchema, z.null()])` gives the intended `anyOf`. The server's AGENTS.md now says so.

## Unresolved questions

1. Sessions last a fixed 30 days from login, with no sliding renewal. Default: keep; revisit if players complain about being logged out.
2. When Cloudflare can't be reached, sign-up fails (fail closed). Default: keep.
3. Mail handed to `BackgroundMailer` is lost if the API stops mid-send (the user asks for a new link). Default: keep; move mail to the jobs table if it matters.
4. The per-email login limit lets anyone who knows an email keep it locked out of login and deletion. Default: accept and document (review finding 4, option a); switch to email+address keys with a looser per-email ceiling if it is abused.
5. Unconfirmed accounts are never purged. Default: keep (a reset takes over a squatted address).
6. Leaderboards (WT11) will need a public name that isn't the email, which NFR-6 doesn't list. Default: WT11 decides and logs it.
7. Safari's handling of a `Secure` cookie on `http://localhost` in development is untested (Chromium and curl work). Default: document Chromium for local development; production is HTTPS anyway.

## Review responses

Round 1 (`plan-review-1.md`):

1. **major, mail timing and SMTP errors reveal accounts.** Accepted. New adapter `adapters/mail/background-mailer.ts` (Step 3) hands mail to the SMTP mailer and resolves at once; failures are logged as `Sending mail failed: <reason>` with no recipient and no text. The reason falls back to the error's `code`, because a refused connection is an AggregateError with an empty message. There are 3 tests: resolves before the inner send finishes; a failure never rejects and logs without the token or address; ECONNREFUSED is logged by code. `api/main.ts` wires `new BackgroundMailer(new SmtpMailer(config.smtp))`; managers and their tests are unchanged. Checked live with SMTP down: registered and unknown emails both got 204 in about 1 ms. The remaining difference is one token write, under 2 ms. DECISIONS "No answer reveals…" and "Mail over SMTP…" are updated, the old unresolved question 3 is replaced (mail lost if the process stops mid-send), and the Step 11 sleeps are raised to 1 s. I did not add the optional route test with a throwing mailer: `accountDeps` builds its own `MemoryMailer`, and the adapter test covers the behaviour.
2. **major, Turnstile fails open.** Accepted, with one change: the check sits in `loadConfig` (Step 5) rather than in `main.ts`, so `config.test.ts` covers it ("refuses Turnstile's test secret for a site that isn't on localhost") and the worker refuses the same misconfiguration. The defaults stay, so the dev, e2e and Step 6/11 commands are unchanged. The optional hostname check is also in: `TurnstileVerifier` takes `expectedHostname`, and `main.ts` passes `PUBLIC_URL`'s host except with the test secret (which answers `example.com`). It has one test. README, DECISIONS "Turnstile…" and the unresolved questions are updated (old question 4 removed).
3. **minor, pruning cost and IPv6 rotation.** Accepted. `MemoryRateLimiter` prunes at most once a minute once it holds 10,000 keys, and gains a `size` getter with a test covering both rules. `rateLimitKey` in `api/client-address.ts` reduces IPv6 to its /64 (zone ids stripped, `::` expanded, and IPv4-mapped addresses read as IPv4) and is used for the per-address keys. It has 2 tests in `client-address.test.ts`. The CAPTCHA still gets the full address.
4. **minor, lockout by per-email login limit.** Option (a): the trade-off is in the `LOGIN_PER_EMAIL` comment, the DECISIONS "Rate limits" entry, the Design section and unresolved question 4, with option (b) named as the fix if it is abused.
5. **minor, "JSON-only" covers only routes with a body.** Accepted. The DECISIONS CSRF entry now says routes that take a body require JSON and that body-less routes rely on Fetch Metadata/Origin and SameSite. The server AGENTS.md CSRF bullet says the same.

Also changed while re-validating: `playwright.auth.config.ts` now uses `DATABASE_PATH=":memory:"` instead of a timestamped file in the temp folder. Each run had left three SQLite files behind.
