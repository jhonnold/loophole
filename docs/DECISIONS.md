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
