# Loophole

Loophole is a web app for Slitherlink, the Japanese loop puzzle: draw one closed loop along the grid lines so that every numbered cell has exactly that many of its sides on the loop. Every puzzle Loophole serves, whether generated or submitted by a player, is checked to have exactly one solution. It plays well on phones and desktops, with optional accounts, a daily puzzle for each size, and leaderboards.

## Status

Early development. The repo has the build tooling, the local dev services, the design kit, the puzzle engine (the grid model, the wire format, rule checks for play, a brute-force solution counter for tests, a seeded random number generator, a rule-based solver that records each deduction for hints, a verifier that says whether a puzzle has one solution, none, several, or could not be decided in time, and a generator that makes a puzzle with exactly one solution from a seed) and a first web app. The web app plays a few built-in puzzles on phones and desktops: tap or drag to draw, keyboard play, undo and redo, a pausable timer, error highlighting, solve detection, light and dark themes, and progress saved in the browser. A Hint button (or H) shows the next forced deduction from the player's board, with the rule's name, a one-line explanation and its pattern drawn small, or points out a mark that doesn't fit; using one marks the attempt as assisted. Boards too big for the screen zoom and pan (pinch, wheel or the zoom buttons) with an overview map, and boards over 30×30 draw on a canvas. The server has its foundation: an HTTP API that serves puzzles, gives hints from each puzzle's stored solution and queues generation jobs, and a worker that generates puzzles in the background with progress and a time limit, keeping each solution in blob storage. The web app lists the server's puzzles after its built-in ones. Accounts, daily puzzles and the rest come in later phases; each phase's plan is in [`docs/plans/`](docs/plans/).

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

`bun run test:perf` runs the frame-time checks for drawing and zooming large boards, with the CPU slowed to stand in for a mid-range phone. They are kept apart because their timings depend on the machine.

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
| Mailpit web UI | http://localhost:8025 | Shows captured mail |

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
| `bun run --cwd packages/core bench` | Time puzzle verification on 10×10 to 100×100 boards (not part of the check) |
| `bun run --cwd packages/core bench:generate` | Time puzzle generation on 7×7 to 100×100 boards and measure loop acceptance (not part of the check) |

## Repository layout

```
packages/core        Puzzle engine shared by server and web
packages/api-client  Typed API client generated from openapi.yaml
apps/server          HTTP API and job worker
apps/web             Player web app (SvelteKit, single-page)
openapi.yaml         The API contract, generated from the server's routes
infra/garage/        Garage config for local development
scripts/             Dev helper scripts
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
