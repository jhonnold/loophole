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

## 2026-10-25 · WT0 `scaffold` · Merge gate without branch protection
- **Question:** NFR-3 says CI blocks merges, but worktrees merge into main locally and push directly. What enforces the gate?
- **Decision:** The orchestrator runs `bun run check` on the merged main before every push; CI on push is a second signal. Branch protection on GitHub is left to the repo owner.
- **Reason:** Changing repository settings is outside the build agents' remit; the local gate gives the same guarantee for this build flow.

## 2026-10-25 · WT1 `core-model` · Edge numbering
- **Question:** How are cells, dots and edges numbered?
- **Decision:** Row-major cells (`r·W + c`) and dots (`r·(W+1) + c`). One edge index space: all horizontal edges first, row by row (`r·W + c`), then all vertical edges, row by row (`(H+1)·W + r·(W+1) + c`). Adjacency is precomputed in `Int32Array` tables on the grid object, with -1 for "off the board". Specified in `docs/FORMAT.md`.
- **Reason:** It matches the design kit's prototype, the edge-state wire string uses the same order, and flat typed arrays keep the solver's inner loops free of allocation.

## 2026-10-25 · WT1 `core-model` · Puzzle wire format is a JSON object
- **Question:** Should FR-2's wire format be a compact string (like `7x7:...`) or a JSON object?
- **Decision:** A JSON object `{v, width, height, clues, seed?, meta?}`, with `v: 1` required and unknown fields rejected. `meta` is string-to-string, at most 32 entries (keys ≤ 64, values ≤ 1024 characters); `seed` is 1–128 characters. A canonical text form (fixed field order, sorted meta keys, no whitespace) is defined.
- **Reason:** The API and SQLite already speak JSON, the server validates DTOs with zod and can hand the object straight to the core parser, and a version field makes later changes explicit. The size limits cover NFR-4's input validation of uploads.

## 2026-10-25 · WT1 `core-model` · Edge-state encoding
- **Question:** How are board states and solutions stored and sent?
- **Decision:** One character per edge in edge index order: `0` unknown, `1` line, `2` cross. The grid size is not repeated; the string always goes with its puzzle. A later encoding will start with a character other than `0`–`2`.
- **Reason:** Simple to read in tests and to check. A 100×100 board is about 20 KB, which is fine for v1; a compact encoding can come later if saved-progress sync (FR-21) shows it matters.

## 2026-10-25 · WT1 `core-model` · Parse errors throw
- **Question:** Should the parser return a result object or throw, and report one error or all of them?
- **Decision:** `parsePuzzle` throws a `FormatError` with a `path` (the field, such as `clues` or `meta.title`) and a message saying what was expected. It stops at the first problem. Programmer errors in trusted code (bad sizes passed to `createGrid`) throw `RangeError` instead.
- **Reason:** One error with a precise field is enough for an API 400 or an editor message, and throwing keeps the call sites short.

## 2026-10-25 · WT1 `core-model` · Which violations are flagged
- **Question:** FR-15 lists four definite violations. Are others (such as a dot with one line and three crosses) flagged too, and what is highlighted for a closed loop?
- **Decision:** Only the four: dots with 3+ lines, clue cells with more lines than the clue, clue cells whose lines plus unknown sides are fewer than the clue, and closed loops when the board is not solved. For a closed loop every edge of that loop is reported. A figure-eight touching at one dot counts as a dot violation, not a closed loop. Completion ignores crosses: exactly one closed loop of lines and every clue met.
- **Reason:** It follows the PRD and the design kit's error states. A property test checks that no board agreeing with a real solution is ever flagged.

## 2026-10-25 · WT1 `core-model` · Brute force by inside/outside colourings
- **Question:** How should the test oracle for FR-5 enumerate solutions?
- **Decision:** Try all 2^(W·H) inside/outside colourings of the cells, take each colouring's boundary as the line set, and keep the ones that are a single closed loop meeting every clue. Grids are capped at 20 cells (about half a second at the cap).
- **Reason:** Every single loop is the boundary of exactly one inside set, so this finds each solution exactly once with no search logic to get wrong, and it shares nothing with the rule solver. Edge subsets (2^edges) would be far slower.

## 2026-10-25 · WT1 `core-model` · Seeded PRNG
- **Question:** Which deterministic generator should seeds use (FR-10)?
- **Decision:** sfc32, seeded with the cyrb128 hash of the seed string (by UTF-16 code units), discarding the first 15 outputs. `int(n)` uses rejection sampling so it has no modulo bias. Golden-value tests freeze the sequence.
- **Reason:** Small, fast, well-tested in JavaScript, and identical on every engine because it uses only 32-bit integer operations. Changing it would change every seeded puzzle, hence the golden tests.

## 2026-10-25 · WT1 `core-model` · Core sources typecheck without Bun types
- **Question:** The base tsconfig loads Bun's types everywhere, so Bun globals would typecheck in core's runtime code. How is that prevented?
- **Decision:** Core's main tsconfig sets `types: []` and excludes tests and the test-support folder; a second config, `tsconfig.test.json`, checks everything with Bun's types. The package's `typecheck` script runs both.
- **Reason:** The compiler then rejects `Bun`, `console` and DOM globals in shipped core code, with no extra lint rules.

## 2026-10-25 · WT4 `web-board` · SvelteKit 2, not 3
- **Question:** Which SvelteKit major should the web app use?
- **Decision:** `@sveltejs/kit` 2.70.3 with `@sveltejs/adapter-static` 3.0.10, `@sveltejs/vite-plugin-svelte` 7.3.1, Vite 8.3.4 and Svelte 5.57.2.
- **Reason:** Kit 3.x needs Node 22.17 or later, and the dev host runs Node 20. Kit 2.70 supports Vite 8, Svelte 5 runes and TypeScript 6. Moving to Kit 3 later is a version bump plus its migration notes.

## 2026-10-25 · WT4 `web-board` · Web tests: plain modules under bun, components under Playwright
- **Question:** The root `bun test` collects every `*.test.ts`, but Bun can't load `.svelte` files or `$lib`/`$app` imports. How are web tests run?
- **Decision:** Game logic lives in plain TypeScript modules that import only relative paths and `@loophole/core`; their tests run in the root `bun test`. Components are covered by Playwright tests (`*.e2e.ts`), run with `bun run test:e2e`, outside the gate. `@playwright/test` is pinned to 1.62.1 because that release uses the Chromium build already installed on the dev host.
- **Reason:** One test runner for unit tests, no second config for the gate, and no browser download in CI. The end-to-end tests still cover the 360×560 and 390×664 checks from the design kit.

## 2026-10-25 · WT4 `web-board` · Web app type-checks without Bun types
- **Question:** The base tsconfig loads Bun's types, which would let Bun globals typecheck in browser code.
- **Decision:** The web app's main tsconfig sets `types: []` and leaves out tests and test helpers; `tsconfig.test.json` adds Bun's types for them. The `typecheck` script runs `svelte-check` with the first and `tsc` with the second.
- **Reason:** Same approach as the core package: a stray `Bun.` in app code fails the typecheck.

## 2026-10-25 · WT4 `web-board` · Biome lints Svelte files but doesn't format them
- **Question:** Should Biome cover `.svelte` files?
- **Decision:** `html.experimentalFullSupportEnabled` is on, so Biome lints `.svelte` files with the template in view (no false "unused" reports for variables used in markup). Its HTML formatter stays off, so `.svelte` files are not formatted.
- **Reason:** Biome 2.6's Svelte formatter is experimental and rewrites markup whitespace; linting with full support works without false positives.

## 2026-10-25 · WT4 `web-board` · Self-hosted fonts
- **Question:** Load Zen Maru Gothic and Zen Kaku Gothic New from Google Fonts or self-host them?
- **Decision:** Self-host with the `@fontsource` packages (Kaku 400/500/700, Maru 700/900).
- **Reason:** No request to a third party on every visit, and the end-to-end tests work offline. The build carries about 20 MB of font subsets, but each browser downloads only the `unicode-range` subsets a page uses.

## 2026-10-25 · WT4 `web-board` · Tap, drag and keyboard input
- **Question:** How exactly do tap, drag and the keyboard cursor behave (FR-13, NFR-5)?
- **Decision:** A press that moves less than max(8 px, a quarter cell) is a tap: on release, the edge whose diamond holds the press point cycles line → cross → empty. A longer move is a drag stroke that follows the dots nearest the pointer and marks the edge between each pair of consecutive dots; it erases lines if its first edge was a line and draws lines otherwise (drawing over crosses). A stroke is one undo step. Only one pointer is tracked; pinch-zoom comes with the large-grid work. The keyboard cursor moves along rows that alternate between horizontal and vertical edges: left and right stay in the row, up and down step to the next row on the left side of the column. Space or Enter cycles, X crosses, Backspace or Delete empties; Z and Y (or Ctrl/⌘+Z, Ctrl/⌘+Shift+Z, Ctrl+Y) undo and redo, P pauses.
- **Reason:** Dot-to-dot strokes ignore finger wobble across neighbouring diamonds, and erasing from a line makes mistakes easy to fix with the same gesture. Every edge is reachable with the arrow keys, and each key does what the Desktop artboard lists.

## 2026-10-25 · WT4 `web-board` · Board size
- **Question:** How big are cells on each screen?
- **Decision:** The board fits the space under the header: cells up to 58 px (the Desktop artboard), at least 44 px on touch screens and 24 px with a mouse. The board never gets wider than the screen (NFR-2): a 10×10 on a 360 px phone gets 30 px cells until pinch-zoom arrives. On phones the board's size depends only on the viewport, not on the notes under it, so it doesn't jump while you play. Phones narrower than 380 px use a 14 px gutter so a 7×7 keeps 44 px cells, as on the Small artboard.
- **Reason:** Follows the design kit's sizes; the 44 px minimum for wide boards on small phones needs zoom and pan, which is the next web phase.

## 2026-10-25 · WT4 `web-board` · Timer, pause and guest progress
- **Question:** When does the clock run, and what is saved for guests (FR-14, FR-21)?
- **Decision:** The clock starts when the puzzle opens, stops on pause and on solve, and pauses (hiding the board) when the tab is hidden. Guest progress is saved in `localStorage` under `loophole:progress:<puzzle id>` as `{v: 1, edges, elapsedMs, solved}`, with edges in the wire format's edge-state encoding, after every move, pause, solve, tab hide and page exit. Undo history is not saved. A solved puzzle opens solved and locked, with a "Start over" button that clears its progress.
- **Reason:** Leaving the tab shouldn't count as solve time, and a phone may discard a hidden tab without warning. The stored object has a version so a later format (or the sync in FR-21) can tell it apart.

## 2026-10-25 · WT4 `web-board` · Theme details the design kit leaves open
- **Question:** The kit gives no dark solved wash, and its Night artboard frame has no shadow. How is the theme chosen and stored?
- **Decision:** In Night the solved wash is shu at 16% opacity and the board frame has no offset shadow. The choice (Paper, Night or System) is stored under `loophole:theme`; no value means follow the system. A small inline script in the page head applies it before first paint.
- **Reason:** A shu tint keeps the "inside is warm" reading of the Paper wash on a dark sheet, and applying the theme before paint avoids a light flash for dark-mode users.

## 2026-10-25 · WT4 `web-board` · Built-in puzzles and no Hint button yet
- **Question:** Which puzzles does the app ship before the server exists, and what goes in the tool tray?
- **Decision:** Three fixtures in wire format: a 5×5 made for this phase, the 7×7 from the Play artboard and the 10×10 from the Night and Desktop artboards. Each has one solution, checked by a search before they were added. Their solutions live only in the test helpers. The tray has Undo, Redo and Clear; the Hint button arrives with hints.
- **Reason:** Real unique puzzles at the kit's sizes exercise the same paths as served ones, and a Hint button that does nothing would mislead.

## 2026-10-25 · WT2 `core-solver` · One deduction engine for solve and verify
- **Question:** How should the rule solver, lookahead and the verifier's search share state?
- **Decision:** One internal `Engine` (`packages/core/src/engine.ts`, not exported) over a `Uint8Array` of edge states. It tracks path ends (for each end dot, the other end and the path length) so closing a loop is checked in O(1), keeps a trail with mark/undo, and runs local rules from a worklist of cells and dots. Rules come in four tiers (local; 3s patterns; parity plus a connectivity check; lookahead), and after any change it goes back to the local rules.
- **Reason:** Undo instead of copying makes lookahead probes and search nodes cheap on 100×100 boards, and going back to the cheapest tier keeps steps in rough easiest-first order for hints.

## 2026-10-25 · WT2 `core-solver` · Rule ids and what a step carries
- **Question:** Which deductions, under which ids, and what does each recorded step hold?
- **Decision:** 14 ids in `RULE_IDS`, each with one plain sentence in `RULE_TEXT`: `clue-zero`, `clue-satisfied`, `clue-needs-all`, `dot-full`, `dot-continue`, `dot-dead-end`, `corner-1`, `corner-3`, `adjacent-3s`, `diagonal-3s`, `premature-loop`, `loop-complete`, `parity`, `lookahead`. A step is `{rule, changes, cells, dots}`; `cells` and `dots` are what a hint highlights. Parity steps name only the two cells, lookahead steps name the edge's dots and where the contradiction showed, `loop-complete` names nothing.
- **Reason:** FR-3's list plus the bookkeeping rules a hint needs to explain every move. The text has no placeholders, so the UI can show it as is.

## 2026-10-25 · WT2 `core-solver` · Adjacent 3s leave the shared side alone
- **Question:** The usual pattern says two 3s side by side always have their shared side as a line. Do we apply it?
- **Decision:** No. `adjacent-3s` sets only the two outer sides parallel to the shared side (lines) and the edges that continue the shared side (crosses).
- **Reason:** The usual pattern is wrong when the whole loop is the rectangle around the two cells (2×1 `"33"` has its shared side crossed). The rest follows from dot degree alone; when the shared side is forced, other rules find it.

## 2026-10-25 · WT2 `core-solver` · Corner rule covers any closed-off corner
- **Question:** Does "a 1 or 3 in a corner" mean board corners only?
- **Decision:** Any corner of a 1 or 3 whose two outside edges are crossed or off the board: a 1 gets both its sides there crossed, a 3 gets both as lines.
- **Reason:** The same argument holds (a line on one side there must continue on the other), and it also catches corners closed off while solving.

## 2026-10-25 · WT2 `core-solver` · Lookahead is one level deep
- **Question:** How is "bounded lookahead" bounded?
- **Decision:** Depth 1: assume a state for one open edge, run only the worklist rules (no parity, connectivity or nested lookahead), and on a contradiction set the other state. Open edges are tried round-robin; the tier ends when a full scan finds nothing. Every probe checks the time budget.
- **Reason:** Parity and connectivity cost O(edges) each and would multiply the cost of every probe. With depth 1, a 50×50 puzzle reduced to a minimal rule-solvable clue set solves in about 25 ms.

## 2026-10-25 · WT2 `core-solver` · How the verifier searches
- **Question:** What does the verifier do when the rules get stuck?
- **Decision:** Depth-first search with an explicit stack, branching on the first open edge in reading order, cross first. Each node runs the rules without lookahead plus a connectivity check (from a line, every other line and an open side of every clue above 0 must be reachable over edges that are not crossed). It stops at the second solution.
- **Reason:** Of the variants measured (branching at a path end or in reading order, line or cross first, with or without the connectivity check, lookahead at every node), this one left the fewest under-clued boards `unknown` within 1 s: 0 of 30 at 10×10, 1 of 30 at 15×15, 2 of 30 at 20×20 and 10 of 30 at 30×30, on boards keeping 10–30% of their clues. Heavily under-clued large boards can still end `unknown`, which FR-4 and PRD §9 allow.

## 2026-10-25 · WT2 `core-solver` · Verification budget
- **Question:** How is the verification time limit enforced and tested?
- **Decision:** `verify` takes `timeLimitMs` (default `DEFAULT_VERIFY_TIME_LIMIT_MS` = 30 000), an injectable clock `now` (default `Date.now`) and `maxNodes`. The deadline is checked once per lookahead probe and once per search node; running out returns `unknown` with any solution already found. `solve` takes the same time options plus `maxSteps`. The worker's `terminate()` (WT6) stays the outer hard limit.
- **Reason:** A fake clock makes the budget tests deterministic. `performance.now` is not available to core's typecheck (no DOM or Bun types); `Date.now` is plain ECMAScript.

## 2026-10-25 · WT2 `core-solver` · What "brute force on all small grids" covers
- **Question:** How far do the FR-5 agreement tests go?
- **Decision:** Every clue assignment on every grid of at most 6 cells (70,930 puzzles; the whole agreement file runs in about 3 s), plus fast-check: 1000 planted-solution puzzles up to 4×4, 20 up to 5×4 and 1000 random clue grids up to 4×4. Each checks `verify`'s status and solutions, and that every edge `solve` decides matches every brute-force solution. All 937,500 puzzles on 2×4, 4×2, 1×7 and 7×1 also pass, but take 25 s, so they are not in the gate.
- **Reason:** It keeps `bun run check` at about 3–5 s and catches every seeded rule mutation in the plan's mutation check. A bug fast-check found in the prototype (the connectivity check seeded from a clue before any line existed, on a 2×4 board) is pinned as a unit test.

## 2026-10-25 · WT2 `core-solver` · Hints start from the player's board
- **Question:** How will hints (WT8) get the next deduction for a player?
- **Decision:** `solve(puzzle, { initial: board, maxSteps: 1 })`. Deductions are sound for the board they start from, so the caller first drops player edges that disagree with the stored solution. Use `steps[0]` when present (status is then `incomplete`, because `maxSteps` was hit). No step with status `stuck` means no rule applies; `solved` with no steps means the board was already complete.
- **Reason:** One solver serves both uses, and its step already holds what a hint shows.

## 2026-10-25 · WT2 `core-solver` · Deterministic generation must not depend on wall-clock budgets
- **Question:** `solve` and `verify` accept `timeLimitMs`. May the generator (WT3) use it to accept or reject candidates?
- **Decision:** No. Anything that must give the same puzzle for the same seed uses `solve` with no time limit, or `verify` with `maxNodes` and `timeLimitMs: Infinity`. Wall-clock limits belong to the outer job timeout (WT6).
- **Reason:** A time limit makes the result depend on machine speed and load, so the same seed could produce different puzzles on different hosts. A node count is the same everywhere.

## 2026-10-25 · WT3 `core-generator` · Loop thresholds and how loops grow
- **Question:** How does the generator build a loop that is big enough (FR-8), and what happens on boards too small for the thresholds?
- **Decision:** `LOOP_THRESHOLDS` is 40% of the cells enclosed and a bounding box spanning 80% of the rows and 80% of the columns, each rounded up to a whole count and at least 1. `generateLoop` grows one region of cells from a random cell in the middle half of the board, adding random neighbouring cells only when the region and the outside both stay in one piece with no cells meeting only at a corner, and stops as soon as all three thresholds hold. The loop is the region's boundary. The whole board always qualifies, so every size works: 1×1 and 1×2 get the loop around the edge, 2×2 an L shape.
- **Reason:** Growing until the thresholds hold makes them a stopping rule instead of a filter. In the benchmark 100% of loops met them on every size measured (1×1 to 100×100, 100×10 and 1×100); PRD §10 asks for 95%. Coverage lands between 40% and about 65%.

## 2026-10-25 · WT3 `core-generator` · Clue removal: a local test, then put clues back where the solver gets stuck
- **Question:** How are clues removed (FR-9) fast enough for 100×100, where removing one clue at a time and re-solving the whole board took about 30 minutes?
- **Decision:** In random order, a clue is removed if the rule solver can still decide the 7×7 window of cells around it with every edge outside the window taken from the solution. Then the whole puzzle is solved from an empty board; while it gets stuck, removed clues in cells next to open edges are put back (each round's picks at least 3 cells apart) and it is solved again. If the rules cannot solve a loop's full clue set (two loops can share every clue, as the L shapes on a 2×2 board do), the loop is dropped and the next one grows one more cell past the thresholds.
- **Reason:** The local test costs about 1 ms on a 100×100 board instead of hundreds, and putting clues back takes 1 to 6 whole-board solves (3 to 5 typical from 30×30 up). Measured with `bench:generate`: p95 6 ms at 7×7, 9 ms at 10×10, 46 ms at 20×20, 164 ms at 30×30 (NFR-1 allows 5 s), 394 ms at 40×40, and about 13 s at 100×100; 32–42% of cells keep a clue; every result verified `unique`. Also measured: a whole-board solve per clue (about 30 minutes at 100×100); whole-board checks started from a per-tile base state (proven at every step, about 15% clues, but 114 s at 100×100); and a second pass retrying the put-back clues with whole-board solves (about 18% clues at 30×30 for 4 times the time, and far too slow at 100×100). Fewer clues make harder puzzles and difficulty is deferred (PRD §14), so the fast, moderately clued version was chosen. The final puzzle is solved by the rules from an empty board, which proves it has one solution (PRD §9) and gives hints a complete step log.

## 2026-10-25 · WT3 `core-generator` · Generator version and determinism
- **Question:** What makes generation reproducible (FR-10), and how is the version recorded?
- **Decision:** `generate` takes a required seed (the server picks one when a user gives none) and draws only from `createRng(seed)`, with no clock and no time limit. The puzzle carries `seed` and `meta.generator` set to `GENERATOR_VERSION`, a whole number as a string, now `"1"`. The version goes up whenever any output changes, including through a change to the solver's rules or to `createRng`; golden-value tests catch such changes. Custom thresholds are not recorded in the puzzle; the server uses the defaults.
- **Reason:** The same seed, size and version give the same puzzle on every machine, so a daily puzzle can be regenerated or checked later. The solver decides which clues can go, so changing its rules changes puzzles.

## 2026-10-25 · WT3 `core-generator` · Generation progress and cancellation
- **Question:** How does a background job (FR-11, WT6) report progress and stop a generation early?
- **Decision:** `onProgress({ done, total })` is called after every clue removal test; `total` is the number of clues in the full puzzle. It never affects the result. Throwing from it stops `generate`, and the error propagates. The worker's `terminate()` stays the hard time limit and is how a user cancels: `generate` is synchronous, so a cancel message to a Worker is never seen while it runs. Stopping from inside `onProgress` needs state the worker can read synchronously, such as a deadline check or a `SharedArrayBuffer` flag. `done === total` does not mean finished: whole-board solves follow (about 1 s at 100×100) and make no progress calls.
- **Reason:** Removal tests are nearly all of the work, so their count makes an honest progress bar. A throwing callback gives cooperative cancellation without an `AbortSignal` type, which core's typecheck (no DOM types) does not have.

## 2026-10-25 · WT5 `web-large-grids` · Large boards zoom instead of shrinking
- **Question:** WT4 let wide boards shrink below 44 px cells on phones. How do they reach 44 px (FR-13), and what does zooming cover?
- **Decision:** A board zooms when the WT4 fit gives cells under the minimum (44 px on touch, 24 px with a mouse), which depends only on the screen's width. Its viewport then takes the height left on the screen (on phones the space between the status line and the notes and tray, at least five cells; on desktops the window's height below the header), never the board's own size, so it follows rotation and browser bars. On phones the notes keep room for a one-message error card, so the board's height only changes when a second kind of error shows; when it does change, the view keeps its offset, so the board doesn't move under a finger. The board opens at the minimum cell size at the top-left corner and zooms from "whole board on screen" up to 88 px cells. It may be pulled past its top-left corner by up to 104 px and past its bottom-right corner by up to 68 px, but never further than it overflows the viewport, so edges under the overview map and the zoom controls can be brought out and tapped, the keyboard cursor pans out from under them, and zoomed all the way out the whole board is still on screen. Zooming out below 44 px is allowed for looking around, and taps still work there with the same nearest-edge diamonds. The view is kept while paused but not saved across reloads. Boards that fit are drawn exactly as in WT4.
- **Reason:** It keeps every board readable and tappable at the kit's 44 px while the whole board is still one pinch away, and leaves small boards untouched.

## 2026-10-25 · WT5 `web-large-grids` · Telling drawing from panning
- **Question:** On a zoomable board, how does a finger draw, and how does the player pan and zoom (FR-13)?
- **Decision:** One finger (or the mouse) always taps and draws, as before. A second finger turns the gesture into a pinch: the stroke stops (a tap never fires, and lines a stroke already drew stay), and the two fingers zoom with their distance and pan with their midpoint until both are up. On desktops Ctrl/⌘ + wheel and trackpad pinch zoom around the pointer, the wheel and two-finger trackpad scroll pan, `+`/`=` and `-` zoom around the edge cursor, and arrow keys pan to keep the cursor's edge in view. The `−`/`+` buttons and an overview map (tap or drag to move the view) sit on the board as on the Night artboard. Board keys are ignored while a pointer stroke is held. A solved board still pinches, wheels and pans, but takes no keys (it leaves the Tab order, as in WT4), so the `+ / −` row of the keyboard help is hidden then.
- **Reason:** Drawing is the main action and stays one finger with no mode switch; two fingers for pan and zoom is what phone maps do. A pinch almost always lands before the first finger passes the drag slop, so undoing stray strokes isn't worth the extra state.

## 2026-10-25 · WT5 `web-large-grids` · Canvas above 30×30, SVG zoom by transform
- **Question:** How are large boards drawn, and how does the SVG board stay smooth while zooming (NFR-2)?
- **Decision:** Boards wider or taller than 30 draw on a canvas at the device pixel ratio, painting only the cells in the viewport plus a one-cell border, at most once per animation frame, with colours read from the theme's CSS properties (repainted when the theme or the clue font changes). Below 8 px cells clue digits are left out, and dots and lines never take more than 0.4 of a cell; neither rule changes anything from 10 px cells up. The SVG board scales one `<g>` with a transform while the zoom changes and lays its marks out again at the kit's sizes 150 ms after it stops. The 4× CPU-throttled frame check measured p95 16.7 ms for drawing on a zoomed 30×30 SVG board and for pinching and panning a 100×100 canvas board.
- **Reason:** A 100×100 board has 30 000 marks, too many DOM nodes to move every frame; culling keeps a frame to a few hundred. One transform per frame keeps SVG pinch-zoom cheap without giving up crisp marks at rest.

## 2026-10-25 · WT5 `web-large-grids` · Large practice fixtures with every clue shown
- **Question:** (Written before WT3 merged.) Where do 20×20 to 100×100 boards for layout and performance work come from?
- **Decision:** `apps/web/scripts/large-fixtures.ts` grows and reshapes a random region with core's seeded generator (each step keeps the boundary one simple loop), takes the boundary as the solution and shows every clue. It writes four fixtures (20×20, 30×30, 40×40, 100×100) and their solutions; the output is deterministic. The fixture test checks with core's `verify` (node budget, no time limit) that every fixture has exactly one solution; the rules alone solve the large ones, with no search.
- **Reason:** Real loops give realistic line density for rendering and timing, and full clues make uniqueness easy to prove. They are easy puzzles; generated ones replace them when the server serves puzzles.

## 2026-10-25 · WT5 `web-large-grids` · Frame-time check outside the gate
- **Question:** How is "60 fps drawing up to 30×30, smooth large boards" (NFR-2) checked?
- **Decision:** `tests/perf.e2e.ts`, tagged `@perf`, slows the CPU 4× through the Chrome DevTools Protocol and records animation-frame intervals while drawing on a zoomed 30×30 SVG board and while pinching and panning the 100×100 canvas board. It fails if the 95th percentile reaches 20 ms or any frame reaches 50 ms. `bun run test:perf` runs it; `bun run test:e2e` skips it.
- **Reason:** Frame timing depends on the machine, so it can't be a reliable gate, but a scripted check catches large regressions and prints numbers to compare.

## 2026-10-25 · WT6 `server-foundation` · Server layers and how they are checked
- **Question:** How is the server split into entrypoints, managers and adapters, and what keeps the layers apart?
- **Decision:** `apps/server/src` has `api/` and `worker/` (entrypoints, each with a `main.ts` composition root), `managers/`, `adapters/`, plus `domain.ts` (domain types) and `ports.ts` (the adapter interfaces managers depend on). Biome `noRestrictedImports` overrides enforce the direction: managers can't import adapters, entrypoints, `bun:sqlite`, Hono or zod; entrypoints other than the composition roots (`main.ts`, `spec.ts`) can't import adapters; adapters can't import managers or entrypoints. Tests are exempt. The API process uses `JobManager` (queue and report); the worker uses `JobRunManager` (claim, run, store), so the API never holds a task runner.
- **Reason:** The lint makes a layering slip fail the gate instead of waiting for review. Keeping interfaces in one module outside `adapters/` lets the manager rule be a plain "no imports from adapters".

## 2026-10-25 · WT6 `server-foundation` · Server scripts run from the repo root
- **Question:** Bun loads `.env` only from the working directory, but workspace scripts run in their package's folder. How do the server processes get the root `.env`?
- **Decision:** The server's scripts (`dev:api`, `dev:worker`, `gen:api`, `check:api`) live in the root `package.json` and call the entrypoints by path, so they run in the repo root, Bun loads the root `.env`, and relative settings (`DATABASE_PATH=data/loophole.sqlite`, `WEB_DIR`) resolve against the root. `.env.example` and the README say so.
- **Reason:** One `.env`, no `--env-file=../../.env` in every script, and paths in settings mean the same thing from every script. `data/` is git-ignored.

## 2026-10-25 · WT6 `server-foundation` · Synchronous repositories, asynchronous blob store
- **Question:** Should the repository and queue interfaces return promises?
- **Decision:** No. `PuzzleRepository` and `JobQueue` are synchronous, like `bun:sqlite`; `BlobStore` and `TaskRunner` are asynchronous. Statements are prepared once per repository with `db.query` and named parameters (`strict: true`). Migrations are numbered `.sql` files applied in order, each in an immediate transaction, recorded in `schema_migrations`. `openDatabase` sets `busy_timeout` (5 s) first, then switches to WAL, retrying "database is locked" for up to about a second.
- **Reason:** SQLite calls are synchronous and fast; promises would add ceremony with no gain. A move to another database would change the interfaces anyway. Switching a new file to WAL takes an exclusive lock that SQLite does not wait for, so the API and the worker starting together on a new database could crash one of them (reproduced in review: about half of simultaneous starts); the retry fixes that, and the immediate transaction then serializes the migrations.

## 2026-10-25 · WT6 `server-foundation` · Puzzle storage and blob keys
- **Question:** What goes in SQLite and what goes in the blob store?
- **Decision:** The `puzzles` row holds the clue string (wire format), size, seed, generator version, `level` (1 for all, FR-29), `origin` (generated/submitted), `status` (published/unpublished), the blob keys and `created_at` (ms). Solutions go to `puzzles/<id>/solution.txt` (edge-state encoding) and the solver's steps to `puzzles/<id>/trace.json` (`{"v":1,"steps":[...]}`, about 1.3 MB at 100×100), written before the row so a row never points at a missing blob. `GET /api/puzzles/{id}` returns clues only; `PuzzleManager.getSolution` reads a solution server-side. Job ids, and seeds the user leaves out, are random UUIDs; a generated puzzle takes the id of the job that made it, and inserting an existing puzzle id does nothing, so a job that runs twice (a worker recovered while still finishing) stores one puzzle. Only `meta.generator` is kept from a puzzle's metadata. Ranked and unpublished-until-release puzzles (WT11) must not expose `seed` or `meta` in public responses, since the seed and generator version let anyone rebuild a generated solution.
- **Reason:** Clues are small and served on every play; solutions and traces are only needed for checks and hints (FR-25, FR-6). A failed blob write leaves at most an orphaned blob, never a broken row.

## 2026-10-25 · WT6 `server-foundation` · Job queue: claiming, heartbeats, retries
- **Question:** How do workers share the jobs table, and what happens to jobs that crash, fail or run too long?
- **Decision:** `claimNext` is one `UPDATE … WHERE id = (SELECT … oldest queued) AND status = 'queued' RETURNING *`. Every later update names the claiming worker and does nothing if another worker holds the job. A running job sends a heartbeat every 5 s; progress writes count as heartbeats. When idle, a worker requeues running jobs with no heartbeat for 30 s, and fails them once they have been claimed 3 times. A job that fails or times out is not retried, since generation is deterministic and would do the same again. The worker loop logs an error from the database (or anything else) and carries on after its poll wait instead of exiting; a failed heartbeat is logged and skipped. `jobs.kind` has no CHECK constraint (validated in code), so new kinds need no table rebuild; `status` does.
- **Reason:** SQLite runs each statement atomically under its write lock, so no two workers can claim one job (tested with four threads on one file). Heartbeats separate a crashed worker from a slow job.

## 2026-10-25 · WT6 `server-foundation` · Job time limits and progress
- **Question:** What limits apply to generation and verification jobs, and how is progress reported (FR-11, NFR-1)?
- **Decision:** Each task runs in a fresh Bun `Worker`; the time limit is `terminate()` (generate is synchronous, so a stop can't be cooperative). Limits: 60 s for generation (100×100 takes about 13 s) and 45 s for verification, which runs `verify` with its default 30 s budget inside. Both are settings (`GENERATE_TIMEOUT_MS`, `VERIFY_TIMEOUT_MS`). The thread maps generation progress to 0–0.9 (clue removal tests are about 90% of the time; whole-board solves follow with no progress calls) and posts only when the whole percent changes; the worker writes progress to the job row at most every 500 ms. A timed-out or failed job keeps its last progress. On SIGINT/SIGTERM the worker finishes the job in hand, then exits.
- **Reason:** A hard outer limit holds even for code that never yields. Throttling at both ends keeps 10,000 progress calls on a 100×100 board down to a handful of database writes.

## 2026-10-25 · WT6 `server-foundation` · HTTP API shape and errors
- **Question:** What do the first endpoints look like, and how are errors reported?
- **Decision:** `GET /api/health`; `GET /api/puzzles?limit=` (recent published, newest first, default 20, at most 100); `GET /api/puzzles/{id}`; `POST /api/jobs/generate` (`{width, height, seed?}`, unknown fields rejected) answering 202 with the job and a `Location` header; `GET /api/jobs/{id}` (`status`, `progress` 0–1, `result.puzzleId` when done, `error`). Times are ISO 8601 strings. Every error is RFC 9457 problem details (`application/problem+json`, `{type, title, status, detail?, errors?}`), with `errors` listing each invalid field for 400s. While 100 jobs are queued, new ones get 503. Request bodies under `/api` are capped at 64 KiB (413), enough for a 100×100 puzzle; `Bun.serve` caps every body at 1 MiB. With `WEB_DIR` set, the API also serves the built web app with `index.html` for unknown non-API paths.
- **Reason:** One error shape for validation, missing resources and server faults. The body cap stops one request from making the server read and parse many megabytes (Bun's default limit is 128 MB). The queue cap stops an open endpoint from piling up unbounded CPU work before accounts and rate limits exist.

## 2026-10-25 · WT6 `server-foundation` · OpenAPI document and generated client
- **Question:** Where do the spec and the client live, and how does the gate catch a stale one?
- **Decision:** `bun run gen:api` builds the app over in-memory adapters, writes the OpenAPI 3.1 document to `openapi.yaml` at the repo root, and writes `openapi-typescript` types to `packages/api-client/src/schema.ts`; the package wraps them with `openapi-fetch`. `bun run check:api` (in `bun run check`, after typecheck) regenerates in memory and fails if either file differs. The generated `schema.ts` is excluded from Biome. Versions: `hono` 4.13.13 (4.13.14 is a day old), `@hono/zod-openapi` 1.6.3, `zod` 4.6.7, `openapi-typescript` 7.13.0, `openapi-fetch` 0.17.0, `yaml` 2.9.1.
- **Reason:** Comparing with the files on disk, not `git diff`, lets the gate pass on uncommitted but regenerated work. `openapi-typescript` declares a TypeScript 5 peer range; it works with 6.0.3 and Bun only warns.

## 2026-10-25 · WT6 `server-foundation` · Web app: built-in puzzles first, then the API
- **Question:** How does the web app get server puzzles while keeping the fixtures (including `giant-100` for `test:perf`)?
- **Decision:** `puzzleSource` combines the fixture source and an API source built on the generated client: the list is the fixtures followed by up to 20 recent server puzzles ("Generated"), or just the fixtures if the API can't be reached; `get` looks up fixture ids locally before asking the API. Vite proxies `/api` to `localhost:3000` in `vite dev`; `vite preview` has no proxy.
- **Reason:** The end-to-end and frame-time tests keep their boards with no server, and the screens did not change. Without a preview proxy the Playwright runs never depend on whether an API happens to be running.

## 2026-10-25 · WT8 `hints` · Where hints are worked out
- **Question:** Should the hint come from the client (core's solver from the player's board) or from a server endpoint?
- **Decision:** Both call one pure core function, `findHint(puzzle, solution, board)`. Built-in puzzles work it out in the browser: the fixture source finds the solution once per puzzle with `verify` (from the clues, so nothing is revealed that the client could not compute; `medium-10` needs search, so `solve` alone would not do) and keeps it in memory. Server puzzles use `POST /api/puzzles/{id}/hint` with the board in the edge-state encoding; a `HintManager` reads the stored solution through the puzzle manager, which stays on the server. No migration: nothing is stored per player yet.
- **Reason:** The server already has every served puzzle's solution, so phones never verify a large generated board (about 280 ms for a 100×100 in Bun, more on a phone). The endpoint is where ranked play (WT11) records an assist against the signed-in ranked attempt (FR-12, FR-23). It cannot catch help from elsewhere (another session, or a solver run on the clues, which alone determine the solution), so leaderboard integrity still rests on FR-25's server validation and timing checks. The search is capped at 500 ms per request, after which the hint is a revealed line, so a puzzle that needs search cannot hold the API thread. Built-in puzzles keep working with no server, as the end-to-end tests need.

## 2026-10-25 · WT8 `hints` · Wrong marks come first; a line from the solution when no rule applies
- **Question:** Hints start from the player's board (WT2), but deductions are only sound on a board that agrees with the solution. What does a hint show when the board has a wrong mark, and when no rule applies?
- **Decision:** If any mark disagrees with the solution, the hint names the lowest such edge ("This line doesn't fit" or "This × doesn't fit"), washes its two dots, says how many other marks don't fit, and offers to erase it (not to draw the right state). Otherwise it is the solver's next step from the board (`solve` with `initial` and `maxSteps: 1`). If no rule applies, it shows one line of the solution, preferring one that extends a line already on the board ("No rule applies here").
- **Reason:** A deduction drawn next to a wrong mark would contradict what the player sees. Pointing out one wrong mark only when asked keeps FR-15's rule that merely-wrong guesses are never flagged on their own. A board that needs search (some submitted puzzles, `medium-10` part way) would otherwise get no help at all.

## 2026-10-25 · WT8 `hints` · The hint card and the assisted flag
- **Question:** How does the hint card behave, and what counts as an assisted solve?
- **Decision:** The card replaces the tool tray (Hint artboard). Apply makes the hint's move as one undo step; "I'll draw it" or Escape closes the card and leaves the washes and ghosts on the board until the move is made or one of its edges is marked to something else. H asks for a hint; focus goes to the card's first button and back to the board when it closes. A zoomed board pans the hint into view. Seeing a hint marks the attempt assisted: guest progress stores `assisted` (an optional field of the v1 object; older saves load as not assisted), Start over clears it, and a "Hint used" tag shows in the status line, the desktop time card and the solved card. The tag takes the zoom tip's place in the status line. Rule titles live in core next to the rule text (`RULE_TITLE`); the small rule pictures live in the web app.
- **Reason:** It follows the design kit (hints replace the tray, ai wash, dashed ghost), keeps every action reachable from the keyboard (NFR-5), and the words on the card and tag carry the meaning, not the colour. Counting a hint that was only looked at is the simplest rule that cannot be gamed by dismissing the card. Practice puzzles are never ranked, so the tag says "Hint used"; ranked play (WT11) adds "unranked". On phones the card is compacted (floated figure, smaller type, no figure on the smallest phones) so the longest hint fits under a 7×7 without scrolling or moving the board; an end-to-end test checks every rule small-7 uses at 360×560 and 390×664. Each rule's figure shows the reason for the move, not only the move; lookahead has no figure.
