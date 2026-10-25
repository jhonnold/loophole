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

## Web app

The web app's game logic is plain TypeScript with `*.test.ts` files beside it, so the root `bun test` runs those tests with everything else. Bun can't load `.svelte` files or SvelteKit's `$lib` and `$app` aliases, which only resolve inside Vite, so the tested modules import neither; Svelte components hold as little logic as possible.

The components are covered by Playwright end-to-end tests (`*.e2e.ts` in the web app's `tests` folder). They build the app, serve it and drive it in Chromium at the design kit's phone sizes and on a desktop. Run them with `bun run test:e2e`. They are not part of `bun run check` because they need a local Chromium (`bunx playwright install chromium` in the web app folder).
