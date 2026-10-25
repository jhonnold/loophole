# WT0 `scaffold` — implementation plan

Branch `feat/scaffold`, worktree `/home/jhonnold/projects/loophole-wt/scaffold`. PRD: NFR-3 (CI blocks merges on failing tests).

## Goal

Set up the repo so later worktrees only add code:

- a Bun workspaces monorepo with strict TypeScript, Biome, and one gate (`bun run check`) that passes;
- GitHub Actions running that gate;
- a dev `docker-compose.yml` with Garage (S3) and Mailpit, plus an idempotent Garage bootstrap script;
- the PRD moved to `docs/`, a human README, a root `AGENTS.md` with `CLAUDE.md` symlinked to it, `docs/TESTING.md`, and `docs/DECISIONS.md`.

Out of scope: SvelteKit, the server, any real puzzle code.

## Rules for the implementer

- Run every command from the worktree root: `cd /home/jhonnold/projects/loophole-wt/scaffold`.
- Bun is not on PATH by default. Start every shell command that uses `bun` or `bunx` with `export PATH="$HOME/.bun/bin:$PATH";`.
- Create each file with exactly the content given (2-space indent, LF line endings, a final newline). Code blocks fenced with `~~~~` contain file contents verbatim.
- Use these versions and no others (all checked 2026-10-25): Bun `1.3.13`, `@biomejs/biome` `2.6.3`, `typescript` `6.0.3`, `@types/bun` `1.3.13`, `fast-check` `4.10.2`, image `dxflrs/garage:v2.5.0`, image `axllent/mailpit:v1.32.0`, `actions/checkout@v7`, `oven-sh/setup-bun@v2`.
  - TypeScript 7 is the latest release, but `svelte-check` and `@sveltejs/kit` both require `^6.0.0`, so we pin 6.0.3.
- Leave `docs/plans/00-scaffold.md` (this file) unchanged.
- Make the five commits listed below, in order, with the exact messages given. Do not push.
- If a verification command prints something other than what is expected, fix the cause before you go on. Do not skip the check.

---

## Step 1 — Move the PRD

1. Run `git mv PRD.md docs/PRD.md`
2. In `docs/design/README.md`, line 3, replace `[`PRD.md`](../../PRD.md)` with `[`PRD.md`](../PRD.md)`. Change nothing else in that file.

Verify:
```sh
test -f docs/PRD.md && test ! -e PRD.md && echo OK
grep -n '](../PRD.md)' docs/design/README.md   # expect exactly one hit on line 3
grep -rn '../../PRD.md' docs || echo "no stale links"
git add docs/design/README.md   # git mv staged the rename; this stages the link fix
git status --short              # expect: "R  PRD.md -> docs/PRD.md" and "M  docs/design/README.md"
```

Commit: `docs: move PRD into docs/`

---

## Step 2 — Root tooling files

### 2.1 `package.json` (new)
~~~~json
{
  "name": "loophole",
  "private": true,
  "type": "module",
  "packageManager": "bun@1.3.13",
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
  "scripts": {
    "lint": "biome check .",
    "format": "biome check --write .",
    "typecheck": "bun run --filter '*' typecheck",
    "test": "bun test",
    "check": "bun run lint && bun run typecheck && bun run test"
  },
  "devDependencies": {
    "@biomejs/biome": "2.6.3",
    "@types/bun": "1.3.13",
    "fast-check": "4.10.2",
    "typescript": "6.0.3"
  }
}
~~~~
How the scripts are meant to work: each workspace defines its own `typecheck` script, and the root runs them all with `--filter '*'` (the web app will use `svelte-check` later). `bun test` at the root finds every `*.test.ts` in the repo.

### 2.2 `tsconfig.base.json` (new)
~~~~json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "Preserve",
    "moduleResolution": "bundler",
    "lib": ["ESNext"],
    "types": ["bun"],
    "strict": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
~~~~

### 2.3 `biome.json` (new)
~~~~json
{
  "$schema": "https://biomejs.dev/schemas/2.6.3/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": true,
    "includes": ["**", "!docs/design", "!**/*.md"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "preset": "recommended"
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always",
      "trailingCommas": "all"
    }
  },
  "assist": {
    "enabled": true,
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  }
}
~~~~
Why the excludes: `docs/design` is the exported design kit, which we don't lint. Biome 2.6 also formats Markdown, and it would rewrite every table in `docs/PRD.md`, so Markdown is excluded too.

### 2.4 `.gitignore` (new)
~~~~
node_modules/
dist/
coverage/
*.log
.DS_Store
.env
.env.*
!.env.example
~~~~

### 2.5 `.editorconfig` (new)
~~~~ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.md]
trim_trailing_whitespace = false
~~~~

---

## Step 3 — Placeholder `packages/core`

This gives lint, typecheck and test something to run. WT1 deletes `add` and its test.

### 3.1 `packages/core/package.json` (new)
~~~~json
{
  "name": "@loophole/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc -p ."
  }
}
~~~~

### 3.2 `packages/core/tsconfig.json` (new)
~~~~json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
~~~~

### 3.3 `packages/core/src/index.ts` (new)
~~~~ts
/** Placeholder so the workspace has code to lint, typecheck and test. Delete when real exports land. */
export function add(a: number, b: number): number {
  return a + b;
}
~~~~

### 3.4 `packages/core/src/index.test.ts` (new)
~~~~ts
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { add } from "./index.ts";

describe("add", () => {
  test("adds two numbers", () => {
    expect(add(2, 3)).toBe(5);
  });

  test("is commutative", () => {
    fc.assert(fc.property(fc.integer(), fc.integer(), (a, b) => add(a, b) === add(b, a)));
  });
});
~~~~

---

## Step 4 — Install and run the gate

```sh
export PATH="$HOME/.bun/bin:$PATH"
bun install                  # creates bun.lock and node_modules/
bun run format               # expect "No fixes applied." (or a few files fixed)
bun run check; echo "rc=$?"  # expect rc=0, "2 pass", "0 fail", "@loophole/core typecheck: Exited with code 0"
bun install --frozen-lockfile; echo "rc=$?"   # expect rc=0, "no changes"
```

Check that failures fail the gate, then undo the change:
```sh
export PATH="$HOME/.bun/bin:$PATH"
echo 'export const bad: number = "x";' >> packages/core/src/index.ts
bun run check >/dev/null 2>&1; echo "rc=$?"   # expect a non-zero rc (2)
sed -i '$d' packages/core/src/index.ts       # removes the line just added
cat packages/core/src/index.ts                # must match 3.3 exactly again
bun run check >/dev/null 2>&1; echo "rc=$?"   # expect rc=0
```

```sh
git status --short   # expect: .editorconfig .gitignore biome.json bun.lock package.json packages/ tsconfig.base.json — and NO node_modules
```

Commit everything from steps 2–4 (`git add .editorconfig .gitignore biome.json bun.lock package.json tsconfig.base.json packages`):
`build: add bun workspaces, typescript, biome and check gate`

---

## Step 5 — CI workflow

### 5.1 `.github/workflows/ci.yml` (new)
~~~~yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: package.json
      - run: bun install --frozen-lockfile
      - run: bun run check
~~~~
`bun-version-file: package.json` reads the `packageManager` field (`bun@1.3.13`), so CI and local use the same Bun.

Verify:
```sh
export PATH="$HOME/.bun/bin:$PATH"
bun run lint; echo "rc=$?"   # expect rc=0 (Biome also formats YAML; if it complains, run `bun run format` and re-check)
```

Commit (`git add .github`): `ci: run bun run check on push and pull requests`

---

## Step 6 — Dev services: Garage and Mailpit

The dev credentials are fixed and committed on purpose, so every checkout gets the same bucket and key. They are dev-only. The repo is public, so these values are public too: compose publishes every port on `127.0.0.1` only, which keeps the services off the LAN.

| Value | Content |
|---|---|
| RPC secret | `af910c754932c5a2d70ea4be0f07513557e698d2a738d09609e1dfb791849cd5` |
| Admin token | `loophole-dev-admin-token` |
| Metrics token | `loophole-dev-metrics-token` |
| S3 access key ID | `GK1a2b3c4d5e6f708192a3b4c5` (`GK` followed by 24 hex characters, as Garage requires) |
| S3 secret key | `8b339f8231fe89196b07eb8766bf6f079805f64a9be09934697b94e0b1aa0a0b` (64 hex characters) |
| Bucket | `loophole-dev` |
| Region | `garage` |

### 6.1 `infra/garage/garage.toml` (new)
~~~~toml
# Garage single-node config for local development only. All secrets here are dev-only.
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"

replication_factor = 1

rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "af910c754932c5a2d70ea4be0f07513557e698d2a738d09609e1dfb791849cd5"

[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"
root_domain = ".s3.garage.localhost"

[admin]
api_bind_addr = "[::]:3903"
admin_token = "loophole-dev-admin-token"
metrics_token = "loophole-dev-metrics-token"
~~~~

### 6.2 `docker-compose.yml` (new)
~~~~yaml
# Local development services. Not for production.
name: loophole

services:
  garage:
    image: dxflrs/garage:v2.5.0
    restart: unless-stopped
    ports:
      - "127.0.0.1:3900:3900" # S3 API
      - "127.0.0.1:3903:3903" # admin API: /health, /metrics (bearer metrics_token)
    volumes:
      - ./infra/garage/garage.toml:/etc/garage.toml:ro
      - garage-meta:/var/lib/garage/meta
      - garage-data:/var/lib/garage/data

  mailpit:
    image: axllent/mailpit:v1.32.0
    restart: unless-stopped
    ports:
      - "127.0.0.1:1025:1025" # SMTP
      - "127.0.0.1:8025:8025" # web UI and API

volumes:
  garage-meta:
  garage-data:
~~~~

### 6.3 `scripts/garage-init.sh` (new, executable)
~~~~bash
#!/usr/bin/env bash
# Idempotent bootstrap of the dev Garage node: layout, access key, bucket.
# Usage: docker compose up -d && ./scripts/garage-init.sh
set -euo pipefail

cd "$(dirname "$0")/.."

KEY_ID="GK1a2b3c4d5e6f708192a3b4c5"
SECRET="8b339f8231fe89196b07eb8766bf6f079805f64a9be09934697b94e0b1aa0a0b"
BUCKET="loophole-dev"

garage() {
  docker compose exec -T -e RUST_LOG=warn garage /garage "$@"
}

echo "Waiting for Garage..."
for _ in $(seq 1 30); do
  if garage status >/dev/null 2>&1; then break; fi
  sleep 1
done
garage status >/dev/null

if garage layout show 2>/dev/null | grep -q "No nodes currently have a role"; then
  node_id="$(garage node id -q 2>/dev/null | cut -d@ -f1)"
  echo "Assigning layout to node ${node_id:0:16}"
  garage layout assign -z dc1 -c 1G "$node_id" >/dev/null
  current="$(garage layout show 2>/dev/null | sed -n 's/^Current cluster layout version: //p')"
  garage layout apply --version "$((current + 1))" >/dev/null
else
  echo "Layout already applied"
fi

if garage key info "$KEY_ID" >/dev/null 2>&1; then
  echo "Key $KEY_ID already exists"
else
  echo "Importing key $KEY_ID"
  garage key import --yes -n loophole-dev "$KEY_ID" "$SECRET" >/dev/null
fi

if garage bucket info "$BUCKET" >/dev/null 2>&1; then
  echo "Bucket $BUCKET already exists"
else
  echo "Creating bucket $BUCKET"
  garage bucket create "$BUCKET" >/dev/null
fi

garage bucket allow --read --write --owner "$BUCKET" --key "$KEY_ID" >/dev/null
echo "Garage ready: bucket=$BUCKET key=$KEY_ID endpoint=http://localhost:3900 region=garage"
~~~~
Then run `chmod +x scripts/garage-init.sh`.

Notes: the Garage image has no shell, so the script runs on the host and calls `/garage` inside the container. `garage key import` is used, not `key create`, so the key ID and secret stay the same across resets.

### 6.4 `.env.example` (new)
The variable names are the ones `Bun.S3Client` / `Bun.s3` read by default. Later worktrees add their own variables here.
~~~~
# Dev defaults matching docker-compose.yml and scripts/garage-init.sh. Copy to .env (Bun loads it automatically).
S3_ENDPOINT=http://localhost:3900
S3_REGION=garage
S3_BUCKET=loophole-dev
S3_ACCESS_KEY_ID=GK1a2b3c4d5e6f708192a3b4c5
S3_SECRET_ACCESS_KEY=8b339f8231fe89196b07eb8766bf6f079805f64a9be09934697b94e0b1aa0a0b
SMTP_HOST=localhost
SMTP_PORT=1025
~~~~

### Verify step 6 (all of these must pass)
```sh
export PATH="$HOME/.bun/bin:$PATH"
docker compose config -q && echo "compose OK"
docker compose up -d
./scripts/garage-init.sh; echo "rc=$?"   # expect "Assigning layout…", "Importing key…", "Creating bucket…", "Garage ready…", rc=0
./scripts/garage-init.sh; echo "rc=$?"   # second run: "Layout already applied", "Key … already exists", "Bucket … already exists", rc=0

# S3 round trip through Bun's S3 client, using .env.example
bun --env-file=.env.example -e 'await Bun.s3.write("smoke.txt","ok"); console.log(await Bun.s3.file("smoke.txt").text()); await Bun.s3.delete("smoke.txt")'
# expect: ok

curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3903/health   # expect 200
curl -s -H 'Authorization: Bearer loophole-dev-metrics-token' http://localhost:3903/metrics | head -2   # expect "# HELP …" lines

curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8025/   # expect 200
printf 'Subject: smoke\r\n\r\nhello\r\n' > /tmp/loophole-smoke.eml
curl -s smtp://localhost:1025 --mail-from dev@loophole.local --mail-rcpt test@loophole.local -T /tmp/loophole-smoke.eml && rm /tmp/loophole-smoke.eml
curl -s http://localhost:8025/api/v1/messages | grep -o '"Subject":"smoke"'   # expect "Subject":"smoke"

docker compose down -v   # leave no containers or volumes running
bun run lint; echo "rc=$?"   # expect rc=0 (Biome checks docker-compose.yml)
git add docker-compose.yml infra scripts .env.example
git ls-files -s scripts/garage-init.sh   # mode must be 100755
```
If ports 3900, 3903, 1025 or 8025 are taken, stop whatever holds them. Do not change the ports.

Commit (files staged above): `build: add dev compose with garage and mailpit`

---

## Step 7 — Docs, AGENTS.md, CLAUDE.md symlinks

### 7.1 `README.md` (new, at repo root)
~~~~markdown
# Loophole

Loophole is a web app for Slitherlink, the Japanese loop puzzle: draw one closed loop along the grid lines so that every numbered cell has exactly that many of its sides on the loop. Every puzzle Loophole serves, whether generated or submitted by a player, is checked to have exactly one solution. It plays well on phones and desktops, with optional accounts, a daily puzzle for each size, and leaderboards.

## Status

Early development. The repo has the build tooling, the local dev services and the design kit. The puzzle engine, server and web app are being built in phases; each phase's plan is in [`docs/plans/`](docs/plans/).

## Quickstart

You need:

- [Bun](https://bun.sh) 1.3.13
- Docker with Compose (for the local services)

Install dependencies and run the full check (lint, typecheck, tests):

```sh
bun install
bun run check
```

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

## Repository layout

```
packages/core      Puzzle engine shared by server and web (placeholder for now)
apps/              Server and web app (coming in later phases)
infra/garage/      Garage config for local development
scripts/           Dev helper scripts
docs/PRD.md        Product requirements
docs/design/       Design kit; open docs/design/index.html
docs/plans/        Implementation plan for each phase
docs/TESTING.md    How tests are organized
docs/DECISIONS.md  Log of decisions made during the build
```

## Docs

- [Product requirements](docs/PRD.md)
- [Design kit](docs/design/README.md)
- [Testing](docs/TESTING.md)
- [Decision log](docs/DECISIONS.md)
- [AGENTS.md](AGENTS.md) holds the working notes for coding agents.
~~~~

### 7.2 `AGENTS.md` (new, at repo root)
~~~~markdown
# Loophole

Loophole is a Slitherlink web app that generates and verifies puzzles with exactly one solution and lets people play them on phones and desktops, with accounts, daily puzzles and leaderboards.

This is a TypeScript monorepo using Bun workspaces. Use Bun as the package manager, script runner and test runner.

## Checking your work

`bun run check` is the single gate: Biome lint and format check, type checking in every workspace, then all tests. CI runs the same command, so it should pass before you commit. `bun run format` applies Biome's fixes.

## How the pieces fit

- The core package is pure TypeScript with no runtime dependencies. It holds the grid model, the wire format, the solver, the verifier and the generator, and both the server and the web app use it.
- The server package has two entrypoints, an HTTP API and a background job worker. They share a SQLite database and S3-compatible blob storage (Garage).
- The web app is a SvelteKit single-page app that talks to the API.

Not all of these exist yet. The README's status section says what's there.

Local dev services (Garage, Mailpit) run with Docker Compose; the README has the commands.

## Commits

Use conventional commits, for example `feat:`, `fix:`, `test:`, `docs:`, `build:`, `ci:`, `refactor:`, `chore:`.

## Further reading

- For requirement ids (FR-n, NFR-n) and product scope, see `docs/PRD.md`.
- Before writing or reorganizing tests, read `docs/TESTING.md`.
- For colours, type and board anatomy in UI work, see `docs/design/README.md`.
- Decisions made during the build, and why, are logged in `docs/DECISIONS.md`. Add an entry when you settle a question the docs don't answer.
- Each phase's implementation plan is in `docs/plans/`.
~~~~

### 7.3 `packages/core/AGENTS.md` (new)
~~~~markdown
# core

The puzzle engine shared by the server and the web app: grid and edge model, wire format, rule checks, solver, verifier and generator.

- It is pure TypeScript with no runtime dependencies, and it has to run unchanged in the browser, on the server and in Bun workers. Keep I/O, DOM, Node and Bun APIs out of `src/`. Tests may use `bun:test`.
- Anything random takes an explicit seed so results can be reproduced.
- Correctness matters most here. Back solver, verifier and generator behaviour with fast-check property tests (see `docs/TESTING.md`).
~~~~

### 7.4 Symlinks
```sh
ln -s AGENTS.md CLAUDE.md
ln -s AGENTS.md packages/core/CLAUDE.md
```

### 7.5 `docs/TESTING.md` (new)
~~~~markdown
# Testing

## Runner

Tests run with `bun test`, Bun's built-in, Jest-compatible runner. Put test files next to the code they test and name them `*.test.ts`. Import `describe`, `test` and `expect` from `bun:test`.

Running a subset:

```sh
bun test packages/core        # one workspace
bun test -t "is commutative"  # tests whose name matches
```

`bun test` also picks up `*.spec.ts`, so Playwright end-to-end tests use a different suffix (for example `*.e2e.ts` with Playwright's `testMatch`).

## Property tests

Use [fast-check](https://fast-check.dev) for properties that should hold for every input, especially in the core package (PRD NFR-3: the solver, verifier and generator have unit and property tests):

```ts
import fc from "fast-check";

test("is commutative", () => {
  fc.assert(fc.property(fc.integer(), fc.integer(), (a, b) => add(a, b) === add(b, a)));
});
```

When a property fails, fast-check prints a `seed` and `path`. To replay that exact case while debugging, pass them back: `fc.assert(prop, { seed, path })`. Turn the shrunk counterexample into a plain unit test so it stays covered.

## The gate

`bun run check` runs, in order:

1. `bun run lint`: Biome lint and format check
2. `bun run typecheck`: each workspace's `typecheck` script. Every workspace defines a `typecheck` script; one without it is skipped silently.
3. `bun run test`: `bun test` over the whole repo

GitHub Actions runs `bun install --frozen-lockfile` and then `bun run check` on every push to `main` and on every pull request.
~~~~

### 7.6 `docs/DECISIONS.md` (new)
~~~~markdown
# Decision log

Questions settled during the build that the PRD and design kit don't answer. Add new entries at the bottom.

Entry format:

```
## YYYY-MM-DD · WTn `name` · short title
- **Question:** what had to be decided
- **Decision:** what was chosen
- **Reason:** why
```

## 2026-10-25 · WT0 `scaffold` · TypeScript 6, not 7
- **Question:** Which TypeScript version should we pin?
- **Decision:** `typescript` 6.0.3.
- **Reason:** 7.x (the native port) is the latest, but `svelte-check` and `@sveltejs/kit` declare a `typescript` peer range of `^6.0.0`.

## 2026-10-25 · WT0 `scaffold` · Biome skips Markdown
- **Question:** Should Biome format Markdown?
- **Decision:** No. `**/*.md` and `docs/design` are excluded in `biome.json`.
- **Reason:** Biome 2.6 would rewrite every table in the PRD and the design kit's README. The design kit is exported artwork, not source.

## 2026-10-25 · WT0 `scaffold` · Fixed dev credentials for Garage
- **Question:** How do dev environments get S3 credentials?
- **Decision:** `scripts/garage-init.sh` imports a fixed, committed dev key into a fixed bucket, `loophole-dev`. The values are in `.env.example`.
- **Reason:** Every checkout and test run gets the same settings with no manual copying. The values are dev-only and never used in production. Compose binds all ports to 127.0.0.1 because the values are public.

## 2026-10-25 · WT0 `scaffold` · Strictness flags
- **Question:** Which compiler checks go beyond `strict`?
- **Decision:** `noImplicitOverride` and `noFallthroughCasesInSwitch`. Not `noUncheckedIndexedAccess` or `exactOptionalPropertyTypes`.
- **Reason:** The core package indexes typed arrays in hot loops, where `noUncheckedIndexedAccess` would force a non-null assertion on every access. A later worktree can turn on stricter flags if they prove worth it.
~~~~

### Verify step 7
```sh
export PATH="$HOME/.bun/bin:$PATH"
test -L CLAUDE.md && [ "$(readlink CLAUDE.md)" = "AGENTS.md" ] && echo "root symlink OK"
test -L packages/core/CLAUDE.md && [ "$(readlink packages/core/CLAUDE.md)" = "AGENTS.md" ] && echo "core symlink OK"
head -1 CLAUDE.md   # expect "# Loophole"
bun run check; echo "rc=$?"   # expect rc=0
```

Commit (`git add README.md AGENTS.md CLAUDE.md packages/core/AGENTS.md packages/core/CLAUDE.md docs/TESTING.md docs/DECISIONS.md`):
`docs: add readme, agents guide, testing guide and decision log`

---

## Step 8 — Final check

```sh
export PATH="$HOME/.bun/bin:$PATH"
git status --short                    # expect empty (docs/plans/00-scaffold.md is committed by the orchestrator)
git log --oneline main..HEAD          # expect the 5 commits above, plus the orchestrator's plan commit
rm -rf node_modules && bun install --frozen-lockfile && bun run check; echo "rc=$?"   # expect rc=0
```

## Acceptance criteria

1. `bun install --frozen-lockfile && bun run check` exits 0 from a clean clone. Output shows Biome passing, `@loophole/core typecheck: Exited with code 0`, and `2 pass, 0 fail`.
2. A type error or a failing test in `packages/core` makes `bun run check` exit non-zero.
3. `.github/workflows/ci.yml` runs `bun install --frozen-lockfile` and `bun run check` on push to `main` and on pull requests, with Bun taken from `packageManager` (1.3.13).
4. `docker compose up -d && ./scripts/garage-init.sh` exits 0, and a second run also exits 0 and reports that everything already exists. `docker compose ps` shows every port published on `127.0.0.1` only.
5. With `.env.example`, `Bun.s3` can write, read and delete an object in `loophole-dev`. `GET :3903/health` returns 200, and `/metrics` with the bearer token returns Prometheus text.
6. Mailpit UI on :8025 returns 200, and mail sent to SMTP :1025 shows up in `/api/v1/messages`.
7. `PRD.md` is now `docs/PRD.md` (history kept by `git mv`), and the design README links to `../PRD.md`.
8. `CLAUDE.md` and `packages/core/CLAUDE.md` are symlinks to `AGENTS.md`. The root `AGENTS.md` has no directory tree and no "always/never" or all-caps rules.
9. `README.md`, `docs/TESTING.md` and `docs/DECISIONS.md` exist with the content above. `scripts/garage-init.sh` is committed with mode 100755.
10. Five commits with exactly these messages, in order:
    1. `docs: move PRD into docs/`
    2. `build: add bun workspaces, typescript, biome and check gate`
    3. `ci: run bun run check on push and pull requests`
    4. `build: add dev compose with garage and mailpit`
    5. `docs: add readme, agents guide, testing guide and decision log`

## Unresolved questions

None blocking. Defaults chosen (and logged in `docs/DECISIONS.md`): TS 6.0.3, Biome skips Markdown, fixed dev Garage credentials, no `noUncheckedIndexedAccess`.
