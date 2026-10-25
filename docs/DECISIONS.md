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

## 2026-10-25 · WT7 `accounts` · Account API
- **Question:** Which endpoints do accounts need, and what do they answer?
- **Decision:** `GET /api/auth/config` (`{turnstileSiteKey}`), `GET /api/session` (`{user}`, null when logged out), and, all with JSON bodies: `POST /api/auth/signup` (`{email, password, captchaToken}` → 204), `POST /api/auth/login` (→ 200 user, sets the cookie), `POST /api/auth/logout` (→ 204), `POST /api/auth/verify-email` and `POST /api/auth/reset-password` (mailed token, → 204 or 400), `POST /api/auth/resend-verification` and `POST /api/auth/forgot-password` (`{email}` → always 204), `DELETE /api/account` (`{password}` → 204). The user DTO is `{id, email, emailVerified, isAdmin, createdAt}`. Passwords are 8 to 128 characters, emails at most 254. Errors are problem details: 400 invalid body, CAPTCHA or link; 401 wrong credentials or not logged in; 403 cross-site; 429 with `Retry-After`. The routes live in `api/accounts.ts`; `AccountManager` and `SessionManager` hold the logic.
- **Reason:** Small, JSON-only and enough for the six web pages. Keeping the account routes in their own module keeps `app.ts` small for the phases that add routes next.

## 2026-10-25 · WT7 `accounts` · Sessions: opaque cookie tokens
- **Question:** How are logins kept (NFR-4)?
- **Decision:** Login sets `__Host-loophole_session` to 32 random bytes (base64url) with `HttpOnly; Secure; SameSite=Lax; Path=/`, expiring 30 days after login, with no sliding renewal. The `__Host-` prefix makes browsers refuse a `Domain` attribute, so a sibling subdomain can't set the cookie (cookie tossing). The `sessions` table stores only the token's SHA-256 with the user id and expiry. Every login issues a new token and ends the session of any cookie sent with it; logout deletes the row and clears the cookie; a password reset ends every session of the account. Expired rows are deleted when looked up and whenever a session starts. `Secure` is always on: Chromium and curl accept it on `http://localhost`.
- **Reason:** A server-side token can be revoked, unlike a signed one; storing a hash means a leaked database logs nobody in; a new token per login rules out session fixation. A fixed lifetime keeps the code small.

## 2026-10-25 · WT7 `accounts` · CSRF: Fetch Metadata, SameSite and JSON-only bodies
- **Question:** How are state-changing requests protected from other sites (NFR-4)?
- **Decision:** Three layers, no CSRF token. (1) Middleware on every `/api` request except GET, HEAD and OPTIONS: allowed when `Sec-Fetch-Site` is `same-origin` or `none`, refused with a 403 problem when it is `same-site` or `cross-site`; without that header, allowed when there is no `Origin` or its host equals the request's, refused otherwise (including `Origin: null`). This is the rule of Go 1.25's `CrossOriginProtection`. (2) The session cookie is `SameSite=Lax`, so another site's POST carries no session. (3) Routes that take a body require `application/json` (415 otherwise), which an HTML form can't send and a cross-origin `fetch` can't send without a CORS preflight the API never grants. Routes without a body (logout, and later ones such as report or unpublish) rely on (1) and (2) alone.
- **Reason:** Current browsers send `Sec-Fetch-Site` on every request and older ones send `Origin` on cross-origin POSTs, so the check needs no state and no client code. A request with neither header doesn't come from a browser and carries no victim's cookies, so curl and scripts keep working. Refusing `same-site` too stops a sibling subdomain from acting for a user.

## 2026-10-25 · WT7 `accounts` · Rate limits on the auth endpoints
- **Question:** What limits apply, and where are they counted (NFR-4)?
- **Decision:** Fixed-window counters in the API process's memory (`MemoryRateLimiter` behind the `RateLimiter` port). Per client address, in the routes: sign-up 10 per hour; login 20 per 15 minutes; resend-verification and forgot-password 10 per hour together; verify-email and reset-password 20 per 15 minutes together; account deletion 10 per 15 minutes. Per email, in the account manager: 10 login or deletion attempts per 15 minutes from anywhere, and at most 3 mails per address per hour (more are dropped silently, so the answer doesn't change). The cap is checked before a token is issued, so a request over it leaves the last mailed link working. Over a limit: 429 problem with `Retry-After` in seconds. The address is the socket's peer, or with `TRUST_PROXY=true` the last `X-Forwarded-For` entry; IPv6 addresses count by their /64 prefix. Once 10,000 keys are held, ended windows are dropped, at most once a minute; at 100,000 keys a new key evicts the oldest one, so a flood can't lock other clients out (a flood can reset its own counters, which the per-email login limit and the argon2 check bound). With `TRUST_PROXY=true`, set it only when the API is reachable solely through the proxy: otherwise a client can choose its own address.
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
- **Decision:** Cloudflare Turnstile (free plan, PRD §14 question 3). The sign-up page loads `api.js?render=explicit` and renders the widget with the site key from `GET /api/auth/config`; the API checks the token with siteverify (form POST of `secret`, `response` and `remoteip`, 5 s timeout) through the `CaptchaVerifier` port. A refused token, an HTTP error and a network failure all fail the sign-up with a 400. With real keys, a token whose siteverify `hostname` isn't `PUBLIC_URL`'s host is refused too. Serve the site on the single `PUBLIC_URL` host (redirect any others), or sign-ups from other hosts fail the hostname check. `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` default to Cloudflare's always-pass test keys (`1x00000000000000000000AA`, `1x0000000000000000000000000000000AA`), but the settings refuse the test secret unless `PUBLIC_URL` is on `localhost` or `127.0.0.1`, so a deployment that forgets the keys doesn't start; on localhost the API warns at startup. `PUBLIC_URL` has no default, so a deployment that forgets it doesn't start either. Unit tests use a fake verifier; the end-to-end test swaps the widget script for a stub that returns the dummy token `XXXX.DUMMY.TOKEN.XXXX`, which the test secret accepts.
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
- **Decision:** `nodemailer` 10.1.0 (no dependencies, ships its own types, so no `@types/nodemailer`), configured by `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_REQUIRE_TLS` and `MAIL_FROM`, behind the `Mailer` port. STARTTLS is required unless the host is loopback (`localhost`, `::1` or `127.x.x.x`); `SMTP_REQUIRE_TLS` overrides that default either way. Mail is plain text. The API wraps the SMTP mailer in `BackgroundMailer`, which hands the message off and returns at once: the answer doesn't wait for SMTP, and a failure is logged (without the message, which holds a token) instead of becoming a 500; "Send a new link" recovers a lost mail. Mailpit catches mail in development; tests use the in-memory mailer, and one integration test sends through Mailpit when it is running.
- **Reason:** 10.1.0 is the newest release more than two weeks old (10.2.1 is three days old, and 10.1.x had seven releases in one day). Waiting for SMTP inside the request would let its latency and errors tell registered emails from unknown ones. A mail lost when the process stops mid-send is acceptable; a durable queue can come later.

## 2026-10-25 · WT7 `accounts` · Account end-to-end test against the real API
- **Question:** How is sign-up → confirm → login → logout tested in a browser without making `test:e2e` depend on a server?
- **Decision:** A second Playwright config, `playwright.auth.config.ts` (`bun run test:e2e:auth`), builds the app and starts the API serving it (`WEB_DIR`) on port 4174 with a fresh in-memory database. The test stubs Cloudflare's widget script, reads the link from Mailpit's API, and skips itself when Mailpit or challenges.cloudflare.com can't be reached. Its file ends in `.auth-e2e.ts`, so `test:e2e` doesn't pick it up.
- **Reason:** The guest tests stay offline and fast, and the account test runs cookies, CSRF headers and mail the way production does.

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
- **Decision:** Any logged-in player, confirmed or not, can report a published puzzle with a reason of 1 to 500 characters (`POST /api/puzzles/{id}/report`); one report per player and puzzle, a new one replacing the reason. Admins (`is_admin`) get `GET /api/admin/reports`: published puzzles with reports, the most recently reported first, with the count and the five newest reasons (reporters are not shown), read from the newest 500 reports. They can unpublish (`POST /api/admin/puzzles/{id}/unpublish`), which sets the puzzle's status to `unpublished`: it leaves every list, `GET /api/puzzles/{id}` and its hints answer 404 to everyone else, and an admin can still open it; or dismiss (`DELETE /api/admin/puzzles/{id}/reports`), which deletes its reports and keeps it published. There is no republish. A submission whose puzzle is unpublished reads as `removed`, with no puzzle link, in its creator's list and when read by id, so the creator never gets a Play link that 404s. The web app has a minimal `/admin` page, linked from the account page for admins.
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

## 2026-10-25 · WT9 `progress-sync` · Saved progress API
- **Question:** How is a logged-in player's progress stored and served (FR-21, NFR-4, NFR-6)?
- **Decision:** Migration 004 adds `progress`, one row per user and puzzle: the edge-state string, play time, `solved`, `assisted`, `version`, `device`, `created_at` and `updated_at`, referencing `users(id)` and `puzzles(id)` with `ON DELETE CASCADE`. Routes: `GET /api/users/{userId}/progress?limit=` (unsolved, most recent first, with sizes), and `GET`, `PUT` and `DELETE /api/users/{userId}/progress/{puzzleId}`. Every route needs a session and answers 403 when `userId` isn't the logged-in user. They share a limit of 120 requests a minute per user. `PUT` takes `{edges, elapsedMs, assisted, baseVersion, device}` and answers `{progress, accepted}`. The edge string must fit the puzzle (400), play time is a whole number of milliseconds up to 100 days, and `solved` is worked out on the server with `analyzeBoard`. Unknown or unpublished puzzles answer 404. `ProgressManager` holds the rules and `SqliteProgressRepository` the SQL. `InvalidBoardError` moved to the shared manager errors, and `PuzzleNotFoundError` joined it. Only puzzles on the server sync: the built-in puzzles live in the web app, so their progress stays in the browser's guest store even when logged in. Migration 003 was set aside for hints, which needed none, so the numbers go 001, 002, 004.
- **Reason:** With the user in the path, a page that still shows an earlier login (another tab logged in as someone else) gets a 403 instead of writing into, or reading from, the other account. That is the same-account check guest import relies on. The server can only check a board against puzzles it holds. Working out `solved` on the server keeps a client from storing a solve it didn't make. The limit leaves room for several tabs and for bringing in a guest's saves.

## 2026-10-25 · WT9 `progress-sync` · Progress conflicts
- **Question:** Two devices can save different boards for one puzzle. Which one is kept?
- **Decision:** Every save names the `version` it continued from (`baseVersion`, null when the client had none) and a random id for its browser (`device`, kept in `localStorage` under `loophole:device`). The server decides in this order:
  1. With no stored record, the save is stored as a new attempt. Its version is the server's time in milliseconds, not 1, so no later attempt reuses a version an older device still holds.
  2. A solved stored record is kept (only `DELETE`, "Start over", removes it).
  3. The stored board sent again, as when a tab is hidden or left without a move, is accepted without a new version. It keeps the stored device and takes the larger play time.
  4. A different board replaces the record, with the version plus one, when it is solved, when it continues from the stored version, or when the same device made the stored record.
  5. Otherwise the stored record is kept and sent back with `accepted: false`, and the client shows that board.

  `assisted` only ever turns on: a refused save that saw a hint still marks the record, without a new version. The web app sends one request per puzzle at a time, so one page's saves reach the server in order.
- **Reason:** The common conflict is a stale tab: a phone left on the puzzle while the player went on at a laptop. Last-write-wins by client time would let that tab overwrite the laptop's work as soon as it was touched, and clocks on different devices disagree anyway. "More play time wins" fails the same way, because a visible tab left idle keeps its clock running. Versions spot staleness exactly. Rule 3 keeps a glance at another device from making the playing device stale. The device id means a save whose answer was lost (the page closed mid-request) can be sent again with the old version. A solve is never lost to an unsolved board. A cleared board is a move like any other, so a stale device can't overwrite it.

  Costs:
  - A device that played offline, while another device carried on from the same version, loses its offline moves for that puzzle when it comes back. The player sees "Picked up your progress from another device".
  - After "Start over" (the record is deleted), a stale device that still shows the old unsolved board and makes a move stores it as a new record, which the first device then picks up. That needs a device left open on the puzzle from before it was solved. A tombstone row would prevent it, at the cost of a flag that every read would have to respect.
  - Two tabs of one browser share a device id, so they never refuse each other's saves. The last one to save wins, and the other tab learns of it only when it is hidden and shown again.

## 2026-10-25 · WT9 `progress-sync` · Syncing in the web app
- **Question:** When does the web app save to the server, and what happens offline?
- **Decision:** This applies to a logged-in player's server puzzles.
  - **Saving.** Each save goes at once to `localStorage` under the account's own keys (`loophole:user:<id>:progress:<puzzle>`), and the puzzle is marked unsent. The save goes to the API 2 s after the last change. A first save of an empty board is skipped, because opening a puzzle isn't progress.
  - **Leaving.** When the tab is hidden, or the page is hidden or closed, unsent saves go out at once with `fetch(..., {keepalive: true})`, since a JSON `PUT` can't go through `sendBeacon`. Only one request per puzzle runs at a time: a later save waits for it and then sends the newest board. A flush skips a puzzle whose request is still out; that request sends the newer board when it finishes.
  - **Retries.** Failed saves stay marked. They are retried after 5 s, 15 s, then every 60 s, when the browser comes back online, and when the account is next known on app start. A "Start over" made offline is remembered and sent before any later save.
  - **Opening.** Opening a puzzle sends this device's unsent save first, and otherwise reads the server's board. Every request a screen waits on (opening, coming back to the tab, importing) gives up after 4 s and uses the device copy; the save stays marked. If the server has nothing, the device copy is cleared: the puzzle was started over elsewhere.
  - **Coming back.** When the tab comes back into sight, the screen asks the server again. It takes a newer board while still paused, and ignores an answer older than a save it made meanwhile.
  - **Losing the login.** A 401 or 403 refreshes the auth store and keeps unsent saves for that account's next login.
  - **Logout and deletion.** Logging out from the account page removes the account's synced boards from this browser and keeps only unsent ones. Deleting the account removes all of them.
  - **Structure.** The play screen's progress code lives in the sync module (`$lib/sync`). The screen only opens a saves handle and adopts boards it is given.
- **Reason:** Writing locally first keeps FR-21's auto-save working with no network, and per-account keys keep one person's progress out of another's on a shared browser. Debouncing keeps a drag from sending a request per edge. One request per puzzle keeps two saves from crossing and leaving the server on the older board. The keepalive request is the one way to send a JSON body while a page is closing, and the 64 KiB keepalive budget fits a 100×100 board (about 20 KB). The timeouts keep a hanging network from locking the board.

## 2026-10-25 · WT9 `progress-sync` · Guest progress into an account
- **Question:** How does a guest's progress join an account without a stale or unexpected session taking it (FR-21, accounts review)?
- **Decision:** Only when the player asks.
  - **The offer.** After login, the home page shows "Progress from before you logged in", naming the account's email, with "Add to my account" and "Not now". The account page shows the same offer without "Not now".
  - **What is sent.** Each guest save of a server puzzle, with at least one mark, goes as a `PUT` from a new random device with no `baseVersion`. So the account keeps a board it already has unless the guest's is solved or the same. The result names how many boards were added and how many the account kept.
  - **Same-account checks.** The import refuses to run if the logged-in user is no longer the one the offer named, and the path check refuses it on the server too.
  - **Cleanup.** Each guest save leaves guest storage once the server has answered for it (taken, kept, or puzzle gone). A network failure stops the run and leaves the rest for another try. Running it again only sends what is left, and a repeat of a save already taken changes nothing.
  - **Built-in puzzles** are left out.
- **Reason:** Moving guest progress silently on login would let a session the player didn't mean to use (a shared computer, a stale tab) take this browser's saves. An explicit button that names the account rules that out. Treating guest saves as a device that has never synced reuses the conflict rule instead of adding a merge just for imports. Because a puzzle only opened while logged in leaves no record, it doesn't block an import.

## 2026-10-25 · WT9 `progress-sync` · How ranked play builds on progress
- **Question:** How should daily ranked play (WT11), with server-validated solves and timing, use the progress records?
- **Decision:** Keep ranked attempts in their own table (for example `ranked_attempts`, keyed by user and puzzle, with server start and finish times, the validated result and assists recorded through the hint endpoint), referencing `users(id) ON DELETE CASCADE`. The progress row stays the board a player resumes on any device, daily puzzles included. Leaderboards never read `progress.elapsedMs`, `solved` or `assisted`: play time comes from the player's clock, and `assisted` from what the client says. Ranked mode can still save the board through these routes.
- **Reason:** The two records answer different questions: where did I leave this board, and what counts for the leaderboard. Keeping them apart means no migration of `progress` and no rule here bending for ranking.

## 2026-10-25 · WT9 `progress-sync` · Progress end-to-end test
- **Question:** How is cross-device sync tested in a browser, when it needs a puzzle stored on the server?
- **Decision:** The progress test uses the API, worker, fresh database and Garage keys that `playwright.auth.config.ts` sets up (WT10, "Publishing end-to-end test with a worker"). `tests/progress.auth-e2e.ts` signs up through the API, has the worker generate a 5×5 puzzle, and plays it in two browser contexts logged in to the same account. It also brings a guest's save into an account through the button. It skips itself when Garage or challenges.cloudflare.com can't be reached; Mailpit isn't needed, since login works before the email is confirmed. `bun run test:e2e` is unchanged and needs no API.
- **Reason:** A real generated puzzle tests the path production takes, without test-only seeding code in the server. Later phases (submissions, daily puzzles) need the worker in end-to-end tests too.

## 2026-10-25 · WT11 `daily-leaderboards` · Daily puzzles
- **Question:** How are the daily puzzles (PRD FR-22) made, kept secret until their day, and recovered when generation fails?
- **Decision:**
  - **Sizes.** 7×7, 10×10, 20×20 and 40×40 (`DAILY_SIZES`), one level (FR-29).
  - **Scheduler.** The worker runs `DailyStockManager.stock` at start and every minute: for today and the next `DAILY_DAYS_AHEAD - 1` days (3 days in all by default) it queues a generation for each size class with no row in the `dailies` table (migration 006). Rows are claimed with an insert or a compare-and-set on `attempt`, so several workers queue each one once. Daily jobs skip the queue cap, so a queue full of players' jobs can't hold them back.
  - **Seeds.** `HMAC-SHA256(DAILY_SEED_SECRET, "loophole-daily:<day>:<size>:<attempt>")`, base64url. Whoever holds the secret can regenerate a daily (the row keeps `attempt` and the generator version); nobody else can work one out ahead of time. The development secret is refused unless `PUBLIC_URL` is on localhost, like Turnstile's test keys.
  - **Storage.** A daily is stored like a generated puzzle but without its seed or generator version (`PuzzleManager.saveDaily`), so no response can leak them, and with `puzzles.release_at` set to 00:00 UTC on its day. `PuzzleManager.get` treats a puzzle before its release time as missing, so the puzzle, hint, progress and report routes all answer 404 for tomorrow's. Dailies are left out of the practice list.
  - **Failures.** A job that failed, timed out or is gone is retried at the next check with the next `attempt`, so the seed changes too: a seed that can't be generated is skipped and a passing outage is ridden out. There is no limit; with three days stocked ahead, a failure has days to clear.
  - **Late.** A size class of today's still missing at two checks in a row is logged as an error ("Today's daily puzzles are late") every minute until it is generated; the API shows it as not ready (`puzzleId: null`) and the home page as "Not ready yet". WT12 should count these log lines as a metric for alerting.
- **Reason:** Generating days ahead keeps a slow or failed job from leaving a day without puzzles, and a 40×40 takes well under a second (WT3), so the stock costs nothing. A release time on the row, rather than a status, keeps "unpublished" meaning removed by an admin (WT10) and needs no rebuild of the `puzzles` table. Leaving the seed out by construction is safer than remembering to hide it in every response (WT6).

## 2026-10-25 · WT11 `daily-leaderboards` · Ranked attempts and timing
- **Question:** How does a ranked daily solve work (PRD FR-17, FR-25), and what timing checks apply?
- **Decision:**
  - **One attempt.** A confirmed player gets one ranked attempt per daily (`attempts` table, keyed by user and puzzle), started on the daily's own UTC day (`POST /api/users/{userId}/attempts/{puzzleId}`, 409 afterwards). Starting again returns the same attempt. It can be finished after midnight.
  - **The clock.** It starts on the server and never stops: ranked play has no pause, and leaving the page doesn't stop it. The play screen sets its clock from the server's `elapsedMs`, so the device's clock doesn't matter.
  - **Finishing.** The client sends the board and its own clock (`…/finish`). The server checks the board's lines against the stored solution (crosses don't matter) and answers 400 for a wrong board. The ranked time is the player's own figure, but never more than the grace under the server's: `min(server, max(client, server − grace))`, where the grace (`rankedGraceMs`) is a tenth of the server's time, at least 3 s and at most 15 s. A retry of a finished attempt returns it unchanged.
  - **Plausibility.** A solve faster than `max(5 s, 0.1 s per cell)` (5 s for 7×7, 160 s for 40×40) is kept but not ranked.
  - **Ranked or not.** A finished attempt is `ranked` unless a hint was used during it or it was too fast. Guests, unconfirmed accounts, an earlier day's daily and replays after a ranked solve play unranked, with progress as usual.
- **Reason:** What the server's clock and board check guarantee is narrow: an edited client can't claim a wrong board, a time longer ago than the attempt started, or more than the grace off the server's time. The grace covers a slow network and a send retried after a short outage; it scales with the time so that on a 7×7, solved in well under a minute, it can't decide the rank by itself, while a 40×40 still gets 15 s. A longer outage costs time: a solve sent an hour late counts at most 15 s under the hour. Pausing would mean trusting the client again.

  Ranked times are therefore trustworthy only against casual cheating. A daily's clues are public from 00:00 UTC (guests play it), so anyone can solve it beforehand with a solver, or by hand while logged out, or take hints without a login or before pressing Start, and then start the attempt and finish at the minimum plausible time. `minRankedMs` and the one attempt per daily are the only backstops. Stronger measures would need clues kept private until a ranked attempt starts, which conflicts with guest play; WT12 or later can revisit it if leaderboards are abused.

## 2026-10-25 · WT11 `daily-leaderboards` · Ranked attempts and saved progress
- **Question:** WT9 suggested keeping ranked attempts apart from progress. Did that hold?
- **Decision:** Yes. `attempts` holds the server's start and finish times, the ranked time, `assisted` and `ranked`; the board a player resumes is still the progress record, synced as for any server puzzle. Leaderboards read only `attempts`. A ranked attempt starts from an empty board: the web app clears the saved board when Start succeeds (WT11b), since an unconfirmed account, a guest import or another device may have saved one before. When the play screen opens an attempt whose saved board is already solved (the finish request was lost), it sends that board at once.
- **Reason:** As WT9 said: the two records answer different questions, and nothing in the progress rules had to bend.

## 2026-10-25 · WT11 `daily-leaderboards` · Hints on daily puzzles
- **Question:** How are hints during a ranked attempt recorded (FR-12, FR-23), and does the hint endpoint need to change for live dailies?
- **Decision:** Hints keep coming from `POST /api/puzzles/{id}/hint`, from any session, guests included. When the request carries a login, `HintManager` tells `AttemptManager.recordHint`, which marks that player's unfinished attempt at the puzzle as assisted (a hint after finishing changes nothing). The web app needs no change: the request already carries the session cookie. On today's daily a mistake hint reports `count: 1` however many marks are wrong, so one request can't check a whole board; earlier days' dailies and practice puzzles report the real count. A hint taken before the attempt starts isn't recorded anywhere; the web app hides the board until Start, so an honest player can't do that by accident.
- **Reason:** Requiring the ranked session for hints would stop guests getting hints on dailies and still not stop a player asking from another browser. Marking the attempt from the hint request is what WT8 planned, and the rest rests on the timing checks.

## 2026-10-25 · WT11 `daily-leaderboards` · Leaderboards
- **Question:** What do the leaderboards rank and show (FR-23)?
- **Decision:** Ranked solves only, by time, ties to whoever finished first, then by user id. Two boards: each daily's own (`GET /api/leaderboards/daily/{puzzleId}`) and an all-time board per area and level of each player's best ranked time on dailies (`GET /api/leaderboards/areas/{area}?level=1`). A board answers the top `limit` rows (default 10) and, for a logged-in viewer, their own row and the rows either side, plus the total, so a player sees their rank outside the top. Rows carry the rank, the display name or null, the time and whether the row is the viewer's; user ids and emails are never sent. Ranks are worked out in SQL with `ROW_NUMBER()`.
- **Reason:** It is what the Solved artboard shows (top three, a gap, the player and their neighbours). Only dailies are ranked, so a bucket's all-time board mixes the same size class across days; areas from player-made puzzles never get ranked times.

## 2026-10-25 · WT11 `daily-leaderboards` · Streaks and personal bests
- **Question:** What counts toward a streak and a personal best (FR-24)?
- **Decision:** A streak is the run of consecutive UTC days, up to today, with at least one finished daily attempt, hinted or too fast included. A streak whose last day is yesterday still shows until today ends. A personal best is a player's best ranked time per area and level. `GET /api/users/{userId}/daily` gives the streak, the last seven days, today's attempts and the bests.
- **Reason:** A streak is about coming back every day, so a hint shouldn't break it; ranking is where hints count. Only finished attempts count, so starting a puzzle and leaving isn't a streak day. Guests have no streak: it needs the server's record.

## 2026-10-25 · WT11 `daily-leaderboards` · Display names
- **Question:** Leaderboards need a public name, which NFR-6 doesn't list. Opt-in or generated?
- **Decision:** Opt-in. A player has no name until they choose one on the account page and shows as "Anonymous" until then; "You" marks the viewer's own row. Names are 3 to 20 ASCII letters, digits, `_`, `.` or `-` after trimming, with at least one letter or digit, unique ignoring case; "you" and "anonymous" are refused, and so is any name containing "admin", "loophole", "moderator" or "official". They live in their own table, `display_names` (migration 006), referencing `users(id) ON DELETE CASCADE`, through `GET` and `PUT /api/users/{userId}/display-name` (null removes it), at most 10 changes an hour per account. There is no profanity filter; reports of names, if needed, are for a later phase.
- **Reason:** NFR-6 allows only the email, the password hash and gameplay data. ASCII only keeps "unique ignoring case" exactly true (SQLite's `NOCASE` folds ASCII only) and stops look-alike letters from another script passing one player off as another or as staff; non-ASCII names could come later with a normalised key. A name a player chose to publish is gameplay data they control; a generated one would be a public handle they never asked for. Nothing identifying is shown unless the player opts in, and deleting the account deletes the name and frees it. A table of its own keeps `users` and every user fixture as they were.

## 2026-10-25 · WT11 `daily-leaderboards` · Account deletion and leaderboards
- **Question:** What happens to a deleted account's leaderboard entries (NFR-6)?
- **Decision:** `attempts` and `display_names` reference `users(id) ON DELETE CASCADE`, so deleting the account deletes its attempts and name; its rows leave every board and the players below move up. The account page says so before deleting. Daily puzzles themselves are never deleted.
- **Reason:** As WT7 set out: deletion is complete by construction. Leaderboard rows are the player's own gameplay data, unlike a published puzzle that others may be playing.
