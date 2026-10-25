# web

The Loophole player app: a SvelteKit single-page app (Svelte 5 runes, static adapter with an `index.html` fallback, no server-side rendering). Boards up to 30×30 render as SVG and take touch, mouse and keyboard input.

- Game logic (edge history, stopwatch, hit-testing, drag strokes, keyboard cursor, saved progress, theme choice) lives in plain TypeScript modules with `bun:test` tests beside them. Keep those modules free of runes, `$lib`/`$app` imports and DOM access so the root `bun test` runs them. Components stay thin; the Playwright end-to-end tests cover them.
- Rule checks and completion come from the core package (`analyzeBoard`), not from code here.
- Screens get puzzles through the puzzle source interface, so the built-in fixtures can be replaced by the API without touching the screens.
- Theme colours come from the CSS custom properties in the app stylesheet, which follow the design kit (`docs/design/README.md`). Book-cover tints are the one exception: they are the same in both themes.
- App code type-checks without Bun's types; tests and test helpers use a second config that adds them.
- End-to-end tests end in `.e2e.ts` and run with `bun run test:e2e`. They need a local Chromium and are not part of `bun run check`.
- Biome lints `.svelte` files but does not format them, because its Svelte formatter is still experimental. Follow the style of the existing components.
