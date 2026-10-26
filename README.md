# Loophole

Loophole is a web app for Slitherlink, the Japanese loop puzzle: draw one closed loop along the grid lines so that every numbered cell has exactly that many of its sides on the loop. Every puzzle Loophole serves, whether generated or submitted by a player, is checked to have exactly one solution. It plays well on phones and desktops, with optional accounts, a daily puzzle for each size, and leaderboards.

## Status

Early development. The repo has the build tooling, the local dev services, the design kit, the puzzle engine (the grid model, the wire format, rule checks for play, a brute-force solution counter for tests, a seeded random number generator, a rule-based solver that records each deduction for hints, a verifier that says whether a puzzle has one solution, none, several, or could not be decided in time, and a generator that makes a puzzle with exactly one solution from a seed) and a first web app. The web app plays a few built-in puzzles on phones and desktops: tap or drag to draw, keyboard play, undo and redo, a pausable timer, error highlighting, solve detection, light and dark themes, and progress saved in the browser. A Hint button (or H) shows the next forced deduction from the player's board, with the rule's name, a one-line explanation and its pattern drawn small, or points out a mark that doesn't fit; using one marks the attempt as assisted. Boards too big for the screen zoom and pan (pinch, wheel or the zoom buttons) with an overview map, and boards over 30×30 draw on a canvas. The server has its foundation: an HTTP API that serves puzzles, gives hints from each puzzle's stored solution and queues generation jobs, and a worker that generates puzzles in the background with progress and a time limit, keeping each solution in blob storage. The web app lists the server's puzzles after its built-in ones. Players can sign up with an email and password (behind a CAPTCHA, with email confirmation), log in and out, reset a forgotten password and delete their account; guests play exactly as before. Logged-in players' progress on server puzzles syncs to their account, so they can leave a puzzle on one device and carry on on another (a "Continue" list on the home page shows unsolved ones), and they can bring progress they saved as a guest into their account. Anyone can make a puzzle in the editor (Create), which says as they place clues whether it has one answer, none or several, and shows two answers side by side when there are several; players with a confirmed email publish it, the worker proves it has one solution before it goes up, and its link can be shared. Players can report a puzzle, and admins see the reports and can unpublish it. The worker also makes a daily puzzle for each size class (7×7, 10×10, 20×20 and 40×40) a few days ahead, the same for everyone and hidden until 00:00 UTC on its day, and the API checks ranked solves of them against the stored solution and the clock, keeps leaderboards, streaks and personal bests, and lets players choose a name for the leaderboards. The home page shows today's puzzles as book covers with a countdown to the next ones and, for logged-in players, their streak. A confirmed player gets one ranked try at each daily, on a clock that doesn't stop, and the Solved screen shows the time, the rank and the leaderboard of that size; guests play the dailies unranked. The leaderboard page (Ranks) shows each size's board for today and of all time. For launch, the API and the worker export Prometheus metrics and write JSON logs, the API has a readiness check, and there is a production Docker image with a Compose file and a database backup script. Admins see system health on the admin page, and end-to-end suites cover the PRD's user stories and check accessibility in both themes. Each phase's plan is in [`docs/plans/`](docs/plans/).

## Quickstart

You need:

- [Bun](https://bun.sh) 1.3.13
- Docker with Compose (for the local services)

Install dependencies and run the full check (lint, typecheck, tests):

```sh
bun install
bun run check
```

### Web app

```sh
bun run dev:web
```

Then open http://localhost:5173. The list shows the built-in puzzles, then any from the API if it is running (see Server below; Vite forwards `/api` to it). `bun run --cwd apps/web build` writes the static site to `apps/web/build/`; `bun run --cwd apps/web preview` serves that build.

The end-to-end tests drive the built app in Chromium at the design kit's phone sizes (360×560 and 390×664) and on a desktop. They are not part of `bun run check`. The first time, install the browser:

```sh
cd apps/web && bunx playwright install chromium
```

Then run them from the repo root:

```sh
bun run test:e2e
```

They serve the build on port 4173; set `E2E_PORT` to use another, for example while another checkout runs its own tests.

They include accessibility checks (axe-core's WCAG 2.2 A and AA rules, contrast among them) on the main screens in both themes, and CI runs them too.

`bun run test:perf` runs the frame-time checks for drawing and zooming large boards, with the CPU slowed to stand in for a mid-range phone, and the time to first interaction on a phone with a slow network (PRD §10). They are kept apart because their timings depend on the machine; run them on an idle host. A puzzle takes its first move in about 1.2 s there, and Home, once its session and today's set have answered, in about 1.9 s, under the 2 s target; only the fonts' Latin subsets hold up the first paint (`docs/DECISIONS.md`, "Time to first interaction").

### Local services

Start Garage (S3-compatible blob storage) and Mailpit (catches outgoing mail), then bootstrap Garage's bucket and key:

```sh
docker compose up -d
./scripts/garage-init.sh
```

The init script is safe to run again. To pick up the dev settings, copy `.env.example` to `.env` at the repo root. Bun loads `.env` from the directory a command runs in, so run the scripts below from the repo root.

| Service | Address | Notes |
|---|---|---|
| Garage S3 API | http://localhost:3900 | Region `garage`, bucket `loophole-dev`; credentials in `.env.example` |
| Garage admin API | http://localhost:3903 | `/health`; `/metrics` needs `Authorization: Bearer loophole-dev-metrics-token` |
| Mailpit SMTP | localhost:1025 | No auth |
| Mailpit web UI | http://localhost:8025 | Shows captured mail, such as verification and password reset links |

All of these credentials are for local development only. `docker compose down` stops the services. `docker compose down -v` also deletes their data, so run the init script again afterwards.

### Server

With the local services running and `.env` in place, start the API and the worker, each in its own terminal, from the repo root:

```sh
bun run dev:api      # http://localhost:3000
bun run dev:worker
```

Both restart when a file changes. They share the SQLite database at `data/loophole.sqlite` (created on first start) and keep solutions in Garage. Ask for a puzzle, poll the job, then fetch the puzzle:

```sh
curl -s -X POST localhost:3000/api/jobs/generate -H 'content-type: application/json' -d '{"width":10,"height":10}'
curl -s localhost:3000/api/jobs/<job id>        # status, progress, then result.puzzleId
curl -s localhost:3000/api/puzzles/<puzzle id>  # clues only
curl -s -X POST localhost:3000/api/puzzles/<puzzle id>/hint -H 'content-type: application/json' -d '{"edges":"<edge string>"}'
```

The hint takes the player's board in the edge-state encoding (docs/FORMAT.md) and answers with a wrong mark, the next deduction, a line from the solution when no rule applies, or "solved". The API is described in [`openapi.yaml`](openapi.yaml). To serve the built web app from the API as in production, build it (`bun run --cwd apps/web build`) and set `WEB_DIR=apps/web/build` in `.env`.

### Accounts in development

With the API and `bun run dev:web` running, open http://localhost:5173/signup. The sign-up check is Cloudflare Turnstile with Cloudflare's test keys from `.env.example`, so it always passes and the widget says "For testing only". In production, set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` to a real widget's keys (Turnstile's free plan is enough). The API refuses to start with the test secret unless `PUBLIC_URL` is on `localhost` or `127.0.0.1`, and warns while it is in use there. Verification and password reset mail goes to Mailpit: open http://localhost:8025 and follow the link. Links point at `PUBLIC_URL`.

Mail goes over SMTP (the `SMTP_*` settings). Off loopback the connection must upgrade to TLS with STARTTLS, and a server that doesn't offer it is refused. For a relay on a private network that doesn't offer STARTTLS (such as a Docker service named `mailpit`), set `SMTP_REQUIRE_TLS=false`; set it to `true` to require STARTTLS on loopback too.

The session cookie is always `Secure`. Chromium and curl accept it on `http://localhost`, so development needs no HTTPS. In production, serve the site over HTTPS, and set `TRUST_PROXY=true` when a reverse proxy sits in front of the API, so rate limits see each client's own address. Set it only when the API is reachable solely through that proxy (bind `HOST` to loopback or the internal network): otherwise a client can send its own `X-Forwarded-For` and choose its rate-limit address.

To make an account an admin (for the admin page at `/admin`: system health and reported puzzles), run from the repo root:

```sh
bun run admin you@example.com            # grant
bun run admin you@example.com --revoke   # take away
```

### Publishing puzzles in development

Run the API and the worker (Server above) and `bun run dev:web`, log in with a confirmed account and open http://localhost:5173/create. The editor checks the draft in the browser as you go and keeps it on this device. Publish sends it to the API, and the worker verifies it (within `VERIFY_TIMEOUT_MS`, 45 s by default) and publishes it if it has exactly one solution; the page waits for the verdict and then shows the link to share. Your account page lists your puzzles and their verdicts. Each account can submit 20 puzzles an hour.

`bun run test:e2e:auth` builds the web app, starts the API serving it on port 4174 (`E2E_AUTH_PORT` to change it) and a worker, sharing a fresh database, and goes through sign-up, the emailed link, login and logout, then publishes a puzzle from the editor and opens its link, in Chromium. It needs Mailpit running and access to challenges.cloudflare.com, and skips itself without them; the publishing and progress tests also need Garage. The progress test plays a generated puzzle in one browser and carries on in another, and brings a guest's progress into an account. The daily test waits for the worker to generate today's puzzles, solves the 7×7 ranked and checks its rank.

`bun run test:e2e:stories` runs one test for each user story in the PRD (§6) on the same stack: a guest starts and solves a puzzle in one tap on a phone; a player resumes on another device; a hint names and explains its rule; a ranked solve shows its rank among boards of the same size; a creator is told when a puzzle has one answer, none or several, and publishes it; a daily solve starts a streak. It needs the same services as `test:e2e:auth` and skips itself without them.

### Saved progress

Guests' progress stays in the browser, as before. For a logged-in player, progress on server puzzles is kept in the browser under their account and sent to the API a couple of seconds after each change, and when the tab is hidden or closed; saves that fail are sent again later. Opening a puzzle takes the account's board from the API (or the browser's copy when offline), and coming back to a tab picks up a board saved meanwhile on another device. The built-in puzzles aren't on the server, so their progress stays in the browser even when logged in. After logging in, the home page and the account page offer to add progress saved as a guest in this browser to the account; nothing moves until the player says so. `docs/DECISIONS.md` has the rules for conflicting saves.

### Daily puzzles in development

The worker generates today's daily puzzles and those of the next two days when it starts, and checks every minute that they are there (`DAILY_DAYS_AHEAD`, 3 by default, counts today). Their seeds are derived from `DAILY_SEED_SECRET`: the value in `.env.example` is for development only, and the API and the worker refuse it unless `PUBLIC_URL` is on localhost, so set a long random string (`openssl rand -base64 32`) in production and keep it secret. A daily is served with its clues only (no seed), and only from 00:00 UTC on its day:

```sh
curl -s localhost:3000/api/daily                        # today's puzzle ids by size
curl -s 'localhost:3000/api/daily?day=2026-10-24'       # an earlier day's
curl -s localhost:3000/api/leaderboards/daily/<puzzle id>
curl -s 'localhost:3000/api/leaderboards/areas/49?level=1'
```

Ranked attempts need a logged-in player with a confirmed email: `POST /api/users/<user id>/attempts/<puzzle id>` starts the clock, and `POST /api/users/<user id>/attempts/<puzzle id>/finish` with `{"edges": …, "elapsedMs": …}` sends the solved board. `docs/DECISIONS.md` has the timing rules.

## Production

Loophole runs as one Docker image with two commands, the API (which also serves the built web app) and the worker, next to Garage, all on one host with `compose.prod.yml`. Hosting is up to you (PRD §14); the host needs Docker with Compose and a TLS reverse proxy such as Caddy or nginx.

1. Copy `.env.production.example` to `.env.production` and `.env.garage.example` to `.env.garage`, and fill in every value: in the first, the https `PUBLIC_URL`, real Turnstile keys, a random `DAILY_SEED_SECRET`, your SMTP server and a Garage key of your own for the app; in the second, Garage's own secrets (each file says how to make its values). Only the API and the worker read `.env.production`, and only Garage reads `.env.garage`. The API and the worker refuse to start with development values (Turnstile's test keys, the development daily secret, Garage's development key, an http `PUBLIC_URL`, no `SMTP_HOST`, the development `MAIL_FROM`). For a mail relay inside the Docker network that doesn't offer STARTTLS (such as a `mailpit` service), set `SMTP_REQUIRE_TLS=false`.
2. Build the image and start Garage, then create its layout, the app's key and bucket:

   ```sh
   export COMPOSE_FILE=compose.prod.yml APP_VERSION=$(git rev-parse --short HEAD)
   docker compose build
   docker compose up -d garage
   set -a; . ./.env.production; set +a
   ./scripts/garage-init.sh
   ```

3. Start everything and check it:

   ```sh
   docker compose up -d
   curl -s localhost:3000/api/health/ready   # {"status":"ok","database":true,"blobs":true}
   docker compose exec api bun run admin you@example.com
   ```

4. Point the reverse proxy at `127.0.0.1:3000` with TLS and compression on (for Caddy: `reverse_proxy 127.0.0.1:3000` and `encode zstd gzip`). The API trusts the last `X-Forwarded-For` entry (`TRUST_PROXY=true` in the Compose file), so nothing but the proxy may reach port 3000: Compose publishes it on 127.0.0.1 only. If the proxy runs on another machine, publish it on the private interface the proxy uses, never on 0.0.0.0.

The database lives in the `loophole-data` volume (`/data/loophole.sqlite`), blobs in `garage-data` and `garage-meta`. To update, pull the code, run `docker compose build` and `docker compose up -d`; migrations run when the API and the worker start. `GET /api/health` says the process is up; `GET /api/health/ready` also checks the database and Garage and answers 503 when either fails, which the Compose health checks use. Logs are one JSON object per line (`docker compose logs api`), with a request id that the API also sends back as `X-Request-Id`; they never hold emails, tokens or passwords.

## Monitoring

The API and the worker each serve Prometheus metrics on a port of their own, off the public site: in `compose.prod.yml` the API's on `127.0.0.1:9470/metrics` and the worker's on `127.0.0.1:9471/metrics` (the worker's also answers `/health`). In development they are off; set `API_METRICS_PORT` and `WORKER_METRICS_PORT` in `.env` to turn them on. Garage's own metrics are on its admin port, `127.0.0.1:3903/metrics`, with `Authorization: Bearer <GARAGE_METRICS_TOKEN>`.

| Metric | From | What it counts |
|---|---|---|
| `loophole_http_requests_total{method,route,status}` | API | Answered requests by route template (`/api/puzzles/:id`), so 429s show rate limiting |
| `loophole_http_request_duration_seconds{method,route}` | API | Time to answer |
| `loophole_auth_failures_total{reason}` | API | Refused logins, CAPTCHA checks, mailed links and cross-site requests |
| `loophole_mail_failures_total` | API | Mails that could not be sent |
| `loophole_rate_limit_evictions_total` | API | Rate-limit counters dropped during a flood of new clients |
| `loophole_jobs_finished_total{kind,status}`, `loophole_job_duration_seconds{kind,status}` | worker | Jobs whose end this worker stored (done, failed, timeout) and how long they ran; a job taken back by recovery is counted when it is run again |
| `loophole_jobs_lost_total` | worker | Jobs failed for good because their worker stopped on every attempt. Not in `loophole_jobs_finished_total`, which counts only the ends this worker stored |
| `loophole_jobs{status}` | worker | Jobs queued and running now |
| `loophole_daily_days_stocked{size}` | worker | Days in a row, from today, whose daily puzzle is generated (0: today's is missing) |
| `loophole_daily_generation_failures_total{size}` | worker | Daily generations that failed and will be retried |
| `loophole_submissions{verdict}` | worker | Decided player submissions by verdict (PRD §10: the share rejected as `unknown`) |
| `loophole_build_info{version,runtime}` | both | Which build is running |

Both also export the standard process metrics (CPU, memory, event loop). `ops/prometheus.yml` is a sample scrape config for a Prometheus on the same host and `ops/alerts.yml` has example alerts (a target down, today's daily missing or the stock low, daily generations failing, mail failing, job timeouts, jobs lost on their last attempt, a queue backlog, server errors, rate-limit floods, many auth failures). Dashboards are left to you. Admins also see a summary at `/admin`: the database and Garage checks with their errors, the job queue, the daily stock, recent failed jobs and the versions.

## Backups

`./scripts/backup-sqlite.sh [folder]` copies the database while the API and the worker keep running (SQLite's `VACUUM INTO`), checks the copy and gzips it into the folder (`backups/` by default), keeping the newest 14 (`KEEP` to change). Run it with `COMPOSE_FILE=compose.prod.yml` in production, for example daily from cron:

```sh
15 3 * * * cd /srv/loophole && COMPOSE_FILE=compose.prod.yml ./scripts/backup-sqlite.sh /srv/backups/loophole
```

To restore, stop the API and the worker, put the backup in place and start them again:

```sh
export COMPOSE_FILE=compose.prod.yml
docker compose stop api worker
docker compose run --rm -T --no-deps api \
  sh -c 'cat >/tmp/restore.sqlite.gz && bun apps/server/scripts/restore-db.ts /tmp/restore.sqlite.gz' \
  </srv/backups/loophole/loophole-<time>.sqlite.gz
docker compose start api worker
```

The backup is streamed into the container, so it needs no read access for the container's user.

In development, `bun apps/server/scripts/restore-db.ts backups/loophole-<time>.sqlite.gz` does the same for `DATABASE_PATH`, with the dev servers stopped.

Garage holds each puzzle's solution and solver steps, which the database points at. Blobs are written before the row that points at them and never change, so back the database up first and the bucket second: every puzzle in that database backup then has its blobs in the bucket backup. Copy the bucket with rclone over the Compose network, with a read-only key made once:

```sh
docker compose exec garage /garage key create loophole-backup          # note its Key ID and Secret key
docker compose exec garage /garage bucket allow --read loophole --key <key id>
docker run --rm --network loophole-prod_default -v /srv/backups/loophole-blobs:/data rclone/rclone:1.75.1 \
  sync :s3:loophole /data --s3-provider Other --s3-endpoint http://garage:3900 --s3-region garage \
  --s3-access-key-id <key id> --s3-secret-access-key <secret key>
```

Or stop Garage and archive the `garage-data` and `garage-meta` volumes. `infra/garage/garage.prod.toml` also has Garage snapshot its metadata every 6 hours under `/var/lib/garage/meta/snapshots`. A puzzle whose blobs are lost still plays, but its hints and ranked checks fail.

## Scripts

| Command | What it does |
|---|---|
| `bun run check` | Lint, typecheck every workspace, check the API contract is current and run all tests. CI runs this. |
| `bun run lint` | Biome lint and format check |
| `bun run format` | Apply Biome fixes |
| `bun run typecheck` | Run each workspace's `typecheck` script |
| `bun run test` | Run all tests with `bun test` |
| `bun run dev:web` | Start the web app's dev server on port 5173 |
| `bun run dev:api` | Start the HTTP API on port 3000, restarting on changes |
| `bun run dev:worker` | Start the job worker, restarting on changes |
| `bun run gen:api` | Regenerate `openapi.yaml` and the API client from the server's routes |
| `bun run check:api` | Fail if `openapi.yaml` or the API client is out of date (part of the check) |
| `bun run test:e2e` | Build the web app and run its Playwright tests |
| `bun run test:perf` | Build the web app and run its frame-time checks |
| `bun run test:e2e:auth` | Build the web app, serve it from the API with a worker and run the account, publishing and progress end-to-end tests (needs Mailpit; publishing and progress also Garage) |
| `bun run test:e2e:stories` | The same stack, running one end-to-end test per PRD §6 user story (needs Mailpit and Garage) |
| `bun run admin <email>` | Make an account an admin; `--revoke` takes it away |
| `bun run bench:jobs` | Time generations and verifications as the worker runs them and fail if NFR-1's budgets are missed (10 to 25 minutes; `--quick` for a shorter run; not part of the check) |
| `./scripts/test-under-load.sh [copies] [rounds]` | Run `bun test` several times at once to shake out timing-sensitive tests |
| `./scripts/backup-sqlite.sh [folder]` | Back up the SQLite database (see Backups) |
| `bun run --cwd packages/core bench` | Time puzzle verification on 10×10 to 100×100 boards (not part of the check) |
| `bun run --cwd packages/core bench:generate` | Time puzzle generation on 7×7 to 100×100 boards and measure loop shape and acceptance (not part of the check) |
| `bun run --cwd packages/core bench:clue-gaps` | Measure which kept clues the rule solver needs on generated 5×5 to 20×20 puzzles, against how few clues one solution allows (`--rules=` and `--no-lookahead` measure fewer rules, `--write-corpus` rewrites the test corpus; not part of the check) |

## Repository layout

```
packages/core        Puzzle engine shared by server and web
packages/api-client  Typed API client generated from openapi.yaml
apps/server          HTTP API and job worker
apps/web             Player web app (SvelteKit, single-page)
openapi.yaml         The API contract, generated from the server's routes
Dockerfile           Production image (API and worker)
compose.prod.yml     Production services: API, worker, Garage
infra/garage/        Garage config for development and production
ops/                 Sample Prometheus scrape config and alert rules
scripts/             Helper scripts (Garage setup, backups, tests under load)
docs/PRD.md          Product requirements
docs/FORMAT.md       Puzzle and board-state wire format
docs/design/         Design kit; open docs/design/index.html
docs/plans/          Implementation plan for each phase
docs/TESTING.md      How tests are organized
docs/DECISIONS.md    Log of decisions made during the build
```

## Docs

- [Product requirements](docs/PRD.md)
- [Wire format](docs/FORMAT.md)
- [Design kit](docs/design/README.md)
- [Testing](docs/TESTING.md)
- [Decision log](docs/DECISIONS.md)
- [AGENTS.md](AGENTS.md) holds the working notes for coding agents.
