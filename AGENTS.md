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
