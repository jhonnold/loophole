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
