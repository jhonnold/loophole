# Loophole

Loophole is a web app for Slitherlink, the Japanese loop puzzle: draw one closed loop along the grid lines so that every numbered cell has exactly that many of its sides on the loop. Every puzzle Loophole serves, whether generated or submitted by a player, is checked to have exactly one solution. It plays well on phones and desktops, with optional accounts, a daily puzzle for each size, and leaderboards.

## Status

Early development. The repo has the build tooling, the local dev services, the design kit, the puzzle engine (the grid model, the wire format, rule checks for play, a brute-force solution counter for tests, a seeded random number generator, a rule-based solver that records each deduction for hints, a verifier that says whether a puzzle has one solution, none, several, or could not be decided in time, and a generator that makes a puzzle with exactly one solution from a seed) and a first web app. The web app plays a few built-in puzzles on phones and desktops: tap or drag to draw, keyboard play, undo and redo, a pausable timer, error highlighting, solve detection, light and dark themes, and progress saved in the browser. Boards too big for the screen zoom and pan (pinch, wheel or the zoom buttons) with an overview map, and boards over 30×30 draw on a canvas. The server is being built in phases; each phase's plan is in [`docs/plans/`](docs/plans/).

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

Then open http://localhost:5173. Puzzles come from a few built-in fixtures until the server exists. `bun run --cwd apps/web build` writes the static site to `apps/web/build/`; `bun run --cwd apps/web preview` serves that build.

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

The init script is safe to run again. To pick up the dev settings, copy `.env.example` to `.env`; Bun loads `.env` automatically.

| Service | Address | Notes |
|---|---|---|
| Garage S3 API | http://localhost:3900 | Region `garage`, bucket `loophole-dev`; credentials in `.env.example` |
| Garage admin API | http://localhost:3903 | `/health`; `/metrics` needs `Authorization: Bearer loophole-dev-metrics-token` |
| Mailpit SMTP | localhost:1025 | No auth |
| Mailpit web UI | http://localhost:8025 | Shows captured mail |

All of these credentials are for local development only. `docker compose down` stops the services. `docker compose down -v` also deletes their data, so run the init script again afterwards.

## Scripts

| Command | What it does |
|---|---|
| `bun run check` | Lint, typecheck every workspace and run all tests. CI runs this. |
| `bun run lint` | Biome lint and format check |
| `bun run format` | Apply Biome fixes |
| `bun run typecheck` | Run each workspace's `typecheck` script |
| `bun run test` | Run all tests with `bun test` |
| `bun run dev:web` | Start the web app's dev server on port 5173 |
| `bun run test:e2e` | Build the web app and run its Playwright tests |
| `bun run test:perf` | Build the web app and run its frame-time checks |
| `bun run --cwd packages/core bench` | Time puzzle verification on 10×10 to 100×100 boards (not part of the check) |
| `bun run --cwd packages/core bench:generate` | Time puzzle generation on 7×7 to 100×100 boards and measure loop acceptance (not part of the check) |

## Repository layout

```
packages/core      Puzzle engine shared by server and web
apps/web           Player web app (SvelteKit, single-page)
apps/              The server comes in a later phase
infra/garage/      Garage config for local development
scripts/           Dev helper scripts
docs/PRD.md        Product requirements
docs/FORMAT.md     Puzzle and board-state wire format
docs/design/       Design kit; open docs/design/index.html
docs/plans/        Implementation plan for each phase
docs/TESTING.md    How tests are organized
docs/DECISIONS.md  Log of decisions made during the build
```

## Docs

- [Product requirements](docs/PRD.md)
- [Wire format](docs/FORMAT.md)
- [Design kit](docs/design/README.md)
- [Testing](docs/TESTING.md)
- [Decision log](docs/DECISIONS.md)
- [AGENTS.md](AGENTS.md) holds the working notes for coding agents.
