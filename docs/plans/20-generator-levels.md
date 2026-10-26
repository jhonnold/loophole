# WT20 `generator-levels` — implementation plan

Branch `feat/generator-levels`, worktree `/home/jhonnold/projects/loophole-wt/generator-levels` (main with WT13–19). PRD: FR-3 (rule-based solver; rule groups), FR-6/FR-12 (hints from the solver's steps), FR-7 (generation inputs), FR-9 (clues removed while the puzzle stays unique), FR-10 (deterministic per seed and version), NFR-1 (generation time), NFR-3 (unit and property tests), §14 Q1 (which techniques define levels). Roadmap: WT20 row and the user's Decisions in `~/.claude/plans/read-through-the-prd-noble-squirrel.md` (difficulty = clue count, more is easier, plus which rules the solver may use, simpler is easier; loop shape fixed; levels stored in `meta`, hints use only the level's rules; server/web exposure is WT21).

## Goal

`generate({ level })` with three levels, chosen by measurement (revised after plan review 1: parity is out of easy):

| Level | Rule groups (`SolveOptions.rules`) | Parity (`SolveOptions.parity`, new) | Lookahead | `minClueShare` | What the player needs |
|---|---|---|---|---|---|
| `easy` | none: only the local rules (clue 0 / satisfied / needs-all, dot rules, 1 and 3 in a corner, 3s side by side and corner to corner, premature loop, loop complete) | no | no | 0.55 | the basics, plenty of clues |
| `medium` | `corners` | yes | no | 0.45 | + inside/outside parity and the corner rules (line into a 1's/3's corner, a 2 passes it on, 2 in a corner, 1s side by side, 3 diagonal to a 1, corner chains) |
| `hard` (default) | `corners`, `colouring`, `connectivity` (= `RULE_GROUPS`) | yes | yes | 0 | everything: today's output, byte-identical |

0. **`solve(puzzle, { parity: false })`.** Parity is outside every rule group, so a new option (default true) makes the engine skip the parity tier (`Engine` option `parity`, one `if` in `propagate`). Colouring works on parity's union-find, and connectivity's `two-exits` assumes parity has settled the edges between two faces, so either without parity throws `RangeError` (in the `Engine` constructor, hence from `solve`; connectivity added after plan review 2). Soundness without parity is added to the brute-force agreement tests.
1. **A level is two knobs.** (a) The solver rule set (groups, parity, lookahead) used for the full-clue check, every removal test, the restore safeguard and the final (recorded) solve, so a level-L puzzle is solved from empty by L's rules (which proves it unique). (b) A clue floor: after removal, put back removed clues in a seeded random order until `minClueShare` of the cells have one (`addClues`).
2. **Default level = hard = today.** `meta.level` is left out at the default level and `addClues` draws nothing when the share is 0, so the default output is byte-identical (puzzle, solution, steps, stats) and `GENERATOR_VERSION` stays `"6"`; existing goldens unchanged.
3. **`meta.level`** (`easy` / `medium`) on puzzles below the default; `puzzleLevel(puzzle)` reads it (absent or unknown → hard). Documented in `docs/FORMAT.md`.
4. **Hints use the puzzle's level** (`findHint` passes the level's groups and lookahead to `solve`). Hard and unlabelled puzzles (server today, editor, built-in fixtures) get exactly today's hints.
5. **Tiny boards** whose loops the level's rules cannot solve even with every clue (1×1 at easy/medium; 2×2 and some 2×3 at easy) fall back to the next level up, from a fresh RNG, so the result is exactly that level's puzzle and `meta.level` says which.
6. `bench:generate --level=` (also prints the hint-step mix per group) and `bench:clue-gaps --level=`; DECISIONS (2 entries), PRD FR-3/FR-7/FR-12/§14 Q1, FORMAT, README, core AGENTS.

**Revised after plan review 1** (verdict REVISE): parity taken out of easy (new `SolveOptions.parity`, step 1; easy re-measured and its digest re-frozen; medium and hard unchanged); `hintWalk` capped; `bench:clue-gaps --write-corpus` refused below the default level; DECISIONS wording (medium = parity + corners); WT21 handoff points from the review added to assumption 7. Orchestrator decisions kept: floors 55% / 45%, `meta.level` left out at hard.

Out of scope (WT21): the server's generate request field, storing/serving `meta.level` (the puzzle repository keeps only `meta.generator`; its integer `level` column is 1 for all = hard), daily level per size, leaderboard buckets, web UI, `gen:api` (no API-visible type changes here; `check:api` passes untouched).

## Measured (this machine: 16 cores, Bun 1.3.13; the code in this plan)

Scratch: `/tmp/claude-1000/-home-jhonnold-projects-loophole/a34715f6-7810-5a69-ba81-edd46bda034d/scratchpad/generator-levels/` (`proto.ts` = main's `generate` with a config knob, `measure.ts`/`measure2.ts` = step-mix measurement, `cross.ts` = cross-level solving, `compare.ts` = byte-identity check, `small.ts` = tiny boards; outputs in `out/`). The validated diff is `wt20-final.diff` there.

### `bench:generate --level=<level>` (seeds `bench-<n>`; n = 20, 40×40 n = 10, 100×100 n = 3; medium full run and hard `--quick` ran concurrently with three `bench:clue-gaps`; easy (without parity, after review 1) ran beside about 12 other measurement jobs)

Every result `unique`, first attempt 100%, `restored=0.0%` on every line.

| Size | easy clues / median / p95 | medium clues / median / p95 | hard clues / median / p95 |
|---|---|---|---|
| 7×7 | 55.1% / 2 ms / 6 ms | 47.1% / 6 ms / 10 ms | 39.9% / 15 ms / 27 ms |
| 10×10 | 55.0% / 4 ms / 6 ms | 45.1% / 11 ms / 15 ms | 39.8% / 28 ms / 43 ms |
| 20×20 | 55.0% / 39 ms / 44 ms | 45.0% / 137 ms / 174 ms | 39.8% / 459 ms / 603 ms |
| 30×30 | 55.0% / 190 ms / 198 ms | 45.0% / 629 ms / 710 ms | 40.0% / 2.27 s / 2.72 s |
| 40×40 | 55.0% / 621 ms / 665 ms | 45.0% / 1.98 s / 2.23 s | 40.6% / 6.2 s / 8.9 s |
| 100×100 | 55.0% / 23.2 s / max 23.4 s | 45.0% / 67.7 s / max 68.3 s | 41.0%, `bench-0` 233 s (one seed, run beside 14 other jobs; WT18/19 recorded 282–1 047 s) |

The slowest level is hard (unchanged code path; 100×100 is well inside the 30-minute `GENERATE_TIMEOUT_MS`). Easy and medium are 3–10× faster than hard (no lookahead). Easy with parity (the first version of this plan) was 2–2.5× slower than easy without it: p95 8 ms, 112 ms, 554 ms, 1.55 s at 10/20/30/40, 100×100 54–55 s, same 55.0% density. NFR-1 holds at every level.

### Hint-step mix per level (the result's `solve.steps`, share of steps; `measure2.ts`)

"tier 1" = clue-zero/satisfied/needs-all, dot rules, loop-complete; "patterns" = corner-1, corner-3, adjacent-3s, diagonal-3s.

| Level, size | tier 1 | patterns | premature loop | parity | corners | colouring | connectivity | lookahead | steps/puzzle |
|---|---|---|---|---|---|---|---|---|---|
| easy 10×10 | 86.8 | 8.8 | 4.4 | – | – | – | – | – | 167 |
| easy 20×20 | 88.5 | 7.2 | 4.3 | – | – | – | – | – | 632 |
| easy 40×40 | 89.7 | 6.4 | 3.9 | – | – | – | – | – | 2434 |
| medium 10×10 | 78.6 | 6.0 | 5.1 | 1.7 | 8.5 | – | – | – | 167 |
| medium 20×20 | 78.2 | 4.5 | 5.3 | 3.1 | 8.9 | – | – | – | 634 |
| medium 40×40 | 78.3 | 4.0 | 4.7 | 3.8 | 9.2 | – | – | – | 2416 |
| hard 10×10 | 73.6 | 3.5 | 4.2 | 1.5 | 9.6 | 1.8 | 1.4 | 4.4 | 173 |
| hard 20×20 | 73.0 | 2.7 | 4.7 | 2.1 | 9.7 | 1.5 | 1.5 | 4.8 | 657 |
| hard 40×40 | 74.3 | 2.7 | 4.2 | 2.2 | 9.9 | 1.4 | 1.3 | 3.9 | 2477 |
| hard 100×100 (`bench-0`) | 73.8 | 2.6 | 3.6 | 2.2 | 10.9 | 1.1 | 1.5 | 4.2 | 14801 |

With parity still in easy (the first version), easy 20×20 had 1.3% parity steps and all 20 of 20 puzzles needed at least one (plan review 1), which is why it went.

### The levels are far apart (`cross.ts`: each level's puzzles solved with each level's rules; 20 puzzles per cell, none solved below its own level)

| Puzzles made at | easy rules decide | medium rules decide | hard rules decide |
|---|---|---|---|
| easy (10×10 / 20×20) | 100% / 100% | 100% / 100% | 100% / 100% |
| medium | 33.0% / 27.8% of edges | 100% / 100% | 100% / 100% |
| hard | 19.1% / 17.7% | 34.7% / 31.9% | 100% / 100% |

### Rule sets alone barely move density (no extra clues; `proto.ts` sweep, same seeds)

| Rule set (no lookahead unless said) | 7×7 | 10×10 | 20×20 | 30×30 | 40×40 | 20×20 p95 |
|---|---|---|---|---|---|---|
| no group, no parity (easy's rules) | 44.4% | 44.6% | 45.2% | 45.8% | 45.9% | 106 ms* |
| no group | 43.7% | 44.3% | 44.3% | 44.6% | 44.8% | 494 ms* |
| corners | 41.2% | 41.6% | 41.5% | 42.4% | 42.1% | 781 ms* |
| corners + colouring | 41.0% | 41.6% | 41.1% | 41.8% | 41.2% | 690 ms* |
| corners + connectivity | 40.9% | 41.4% | 41.0% | 41.7% | 41.3% | 666 ms* |
| every group | 40.3% | 41.0% | 40.3% | 41.0% | 40.8% | 792 ms* |
| every group + lookahead (hard) | 39.9% | 39.8% | 39.8% | 40.1% | 40.7% | 594 ms |

(*14 jobs at once; times only indicative.) So the rule set mainly changes *which techniques* a puzzle needs (tables above), and the clue floor is what makes easy and medium keep visibly more clues.

### Clue-retention policies tried (measured with the first version's easy rule set, parity included; 10×10 n=20 / 20×20 n=20 / 40×40 n=5)

| Policy | Density | Note |
|---|---|---|
| none | 44.3 / 44.3 / 44.8% | the rule set's own floor |
| **put back to a share of cells, 0.55** (chosen) | 56.0* / 55.3* / 55.1% | *prototype rounded up with a float bug; the final code (`thresholdCount`) gives exactly 55.0% |
| put back to 0.50 | 50.1 / 50.0 / 50.0% | too close to medium's 45% |
| keep each clue untested with p = 0.25 / 0.4 | 50.8 / 49.8 / 51.3%; 55.0 / 55.5 / 56.0% | density only on average; a floor is easier to state and test |
| medium rules (corners + connectivity) put back to 0.45 | 45.4 / 45.0 / 45.0% | connectivity dropped from medium (DECISIONS) |

Step mix barely changes with the extra clues (easy 20×20: parity 2.4% → 1.0–1.3%, patterns 5.8% → 7.4%); the clues make more of the board start from direct clue deductions.

### `bench:clue-gaps --level=<level>` (seeded, node budgets; "removable" below hard counts the clues put back on purpose)

| Level | 5×5 clues / solver floor / verify floor | 7×7 | 10×10 | 15×15 | 20×20 clues / solver floor |
|---|---|---|---|---|---|
| easy | 56.0 / 44.6 / 40.5% | 55.2 / 44.0 / 38.1% | 55.0 / 42.8 / 37.5% | 55.1 / 42.8 / 37.1% | 55.0 / 44.7% |
| medium | 48.4 / 42.8 / 40.3% | 47.3 / 41.7 / 38.8% | 45.4 / 41.7 / 38.2% | 45.3 / 39.5 / 37.3% | 45.2 / 42.9% |
| hard | 41.1 / 41.1 / 41.0% | 39.9 / 39.9 / 39.6% | 39.7 / 39.7 / 39.0% | 38.9 / 38.9 / 38.4% | 41.1 / 41.1% |

Hard's line equals WT17/18's numbers (removable 0.0%, gap 0.2 / 0.8 / 2.2 / 1.6 / 2.6%). (The easy/medium solver floor starts from the generated puzzle, so its greedy order differs from the generator's; it is a measure, not a target.)

### Byte identity of the default level (`compare.ts`)

126 boards (1×1, 2×2, 2×3, 3×3, 5×5, 7×7, 10×10, 4×13, 20×20, 30×15, 1×100, 100×2; 2–20 seeds each): `generate(opts)` and `generate({ ...opts, level: "hard" })` against main's `generate`, comparing serialized puzzle, solution, `solve` (status, steps, edges) and stats: 0 differences, before and after the parity option (plan review 1 found 0 differences in 144 more on fresh seeds). The existing goldens and the medium digest pass unchanged; only the easy digest was re-frozen. → No `GENERATOR_VERSION` bump.

### Tiny boards (`small.ts`: every size 1×1 to 10×10, 10 seeds each, per level, before the fallback existed)

`generate` threw "no usable loop after 100 attempts" for: easy 1×1 (10/10 seeds), 2×2 (10/10), 2×3 (3/10); medium 1×1 (10/10). Everything else succeeded, at most 2 attempts. With the fallback and easy without parity (`small2.ts`, the same 2 000 boards): fallbacks easy 1×1 → hard (10), 2×2 → medium (10), 2×3 → medium (3), medium 1×1 → hard (10), the same set as with parity; every result solved and unique, `restored` 0, at most 2 attempts. (Plan review 1, 60 seeds of every size to 8×8: also 3×2 → medium at easy, 10 of 60.) 1×1 has no clue (its clue would be 4), and no rule outside lookahead says the loop must exist. The 2×2 square (all 2s) needs `two-in-corner` (corners group). With the fallback, `generate({ width: 2, height: 2, level: "easy" })` returns the medium puzzle (meta.level `medium`), 1×1 the hard puzzle.

### Gate cost

`bun run check` green: 857 pass, 3 skip (was 844 + new 13). `generate.test.ts` + `hint.test.ts` + `level.test.ts` 3.4 s (main's first two: 2.5–3.6 s across runs); `agreement.test.ts` 5.8 → 6.7 s with the two parity-off rule sets.

## What was found (for DECISIONS)

- Parity at easy was the one thing review 1 changed: every easy 20×20 needed a parity step (a global inside/outside argument). Leaving it out costs no density (the floor binds), no new fallbacks and makes easy 2–2.5× faster to generate.
- Rule groups shift density by only ~4 points between "no group" and "hard" (44% → 40%), because lookahead and the rules outside the groups already do most of the work on these windy loops; what the groups change is *which techniques* the puzzle needs. With easy's rules a medium puzzle gets only ~30% of its edges, a hard one ~18%, so the levels are genuinely different to solve even where densities are close.
- A clue floor (put removed clues back, random order, up to a share of cells) gives exact, testable densities (55.0% / 45.0% at every size ≥ 10×10) and leaves removal and its progress reporting untouched.
- Leaving `meta.level` out at the default level keeps every existing generated and stored puzzle meaningful without a version bump; `puzzleLevel` treats absence as hard.

## Design

### Files

| File | Change |
|---|---|
| `packages/core/src/engine.ts` | `EngineOptions.parity` (default true); `RangeError` when colouring or connectivity is on without it; `propagate` skips `parity()` without it |
| `packages/core/src/solver.ts` | `SolveOptions.parity` (default true), passed to the engine |
| `packages/core/src/solver.test.ts` | parity left out: no `parity` step, same edges with and without steps, `RangeError` with colouring or connectivity |
| `packages/core/src/agreement.test.ts` | brute-force agreement also with `{ rules: [], parity: false, lookahead: false }` (easy) and `{ rules: ["corners"], parity: false }`, and same status without steps |
| `packages/core/src/level.ts` (new) | `LEVELS`, `Level`, `DEFAULT_LEVEL`, `LevelSettings`, `LEVEL_SETTINGS`, `isLevel`, `puzzleLevel` |
| `packages/core/src/level.test.ts` (new) | level table invariants, `puzzleLevel` |
| `packages/core/src/test-support/levels.ts` (new) | `levelRuleIds(level)`: rule ids a level's solve can record (tests only) |
| `packages/core/src/index.ts` | `export * from "./level.ts"` |
| `packages/core/src/generate.ts` | `GenerateOptions.level`; `generateAt` per level with fallback; `addClues`; the level's `RuleSolver`; final solve with the level's rules; `meta.level` below default; `ALL_RULES` removed |
| `packages/core/src/generate.test.ts` | `checkResult` takes a level (meta, steps only from the level's rules); new `generate: levels` describe (7 tests); bad level in the rejects test |
| `packages/core/src/hint.ts` | `findHint` solves with the puzzle's level's rules |
| `packages/core/src/hint.test.ts` | `hintWalk` helper (capped at `edgeCount + 1` hints); 2 tests |
| `packages/core/bench/generate.ts` | `--level=`, step mix per group, level in the line |
| `packages/core/bench/clue-gaps.ts` | `--level=`; default solver = the level's rules (`--rules=` runs with parity); `--write-corpus` refused below the default level |
| `docs/DECISIONS.md` | 2 entries |
| `docs/PRD.md` | FR-3, FR-7, FR-12, §14 Q1 |
| `docs/FORMAT.md` | known `meta` keys (`generator`, `level`) |
| `README.md` | status sentence; two bench rows |
| `packages/core/AGENTS.md` | one sentence on levels |

Not changed: `rules.ts` (parity keeps its id and stays outside `RULE_GROUPS`, so `rules: []` and the clue-gap goldens mean what they did), `verify.ts`, `puzzle.ts`, `format.ts` (meta is free-form; no wire-format version change), the server (`run-task.ts` still calls `generate` without a level → hard), the web app, `openapi.yaml`/api-client, `GENERATOR_VERSION`, goldens.

### API (core)

```ts
// level.ts
export const LEVELS = ["easy", "medium", "hard"] as const;
export type Level = (typeof LEVELS)[number];
export const DEFAULT_LEVEL: Level = "hard";
export interface LevelSettings { readonly rules: readonly RuleGroup[]; readonly parity: boolean; readonly lookahead: boolean; readonly minClueShare: number }
export const LEVEL_SETTINGS: Readonly<Record<Level, LevelSettings>>;
export function isLevel(value: unknown): value is Level;
export function puzzleLevel(puzzle: Puzzle): Level; // meta.level if it names a level, else DEFAULT_LEVEL

// solver.ts
export interface SolveOptions { …; readonly parity?: boolean } // default true; false + colouring or connectivity group → RangeError

// generate.ts
export interface GenerateOptions { …; readonly level?: Level } // RangeError for a value not in LEVELS
```

### Algorithm (`generate`)

```
validate thresholds (as today); level = options.level ?? DEFAULT_LEVEL; RangeError unless isLevel(level)
grid = createPuzzle(width, height, undefined, { seed }).grid           # checks size and seed first
for each L from level up to the hardest (LEVELS order):
    result = generateAt(grid, seed, L, thresholds, onProgress)
    if result: return result
throw Error("no usable loop after 100 attempts")                       # as before; never seen at hard

generateAt(grid, seed, L):
    { rules: groups, parity, lookahead, minClueShare } = LEVEL_SETTINGS[L]
    rules(p, initial) = solve(p, { rules: groups, parity, lookahead, initial, steps: false })
    meta = { generator: GENERATOR_VERSION } plus level: L when L != DEFAULT_LEVEL
    rng = createRng(seed)                                               # fresh per level
    for attempts = 1..MAX_ATTEMPTS (100):
        solution = generateLoop(grid, rng, thresholds, attempts - 1)    # unchanged
        full = clues of solution (4 → NO_CLUE); clues = copy
        if rules(full) not solved: continue
        checks = removeClues(work, rng, rules, onProgress)              # unchanged, level's rules
        addClues(work, full, rng, minClueShare)                         # NEW step 4
        restored = restoreClues(work, full, rng, rules)                 # unchanged safeguard, now step 5
        return { puzzle (seed, meta), solution, solve: solve(work, { rules: groups, parity, lookahead }), stats }
    return null

addClues(puzzle, full, rng, share):
    if share == 0: return                                               # no rng draw → hard byte-identical
    removed = cells with full clue but no clue now (cell order); count = cells with a clue
    want = min(len(removed), thresholdCount(share, cellCount) - count)  # thresholdCount: ceil with 1e-9 epsilon
    if want <= 0: return
    shuffle(removed, rng); put back removed[0 .. want-1]
```

- `thresholdCount` (from `loop.ts`) avoids `ceil(0.55 × 100) = 56` float error (the prototype hit it).
- The restore safeguard runs after `addClues`, so if the added clues ever broke monotonicity it would still repair; it put back nothing in any run.
- The fallback tries each harder level from a fresh `createRng(seed)`: a level's puzzle does not depend on whether an easier level was tried first. Attempts at failed levels make no progress calls (removal never starts). `stats.attempts` counts the loops at the level the puzzle has.
- `onProgress` and `total` are unchanged per level (one call per removal test; `addClues` makes none).

### Hints

`findHint(puzzle, solution, board, options)`: `const { rules, parity, lookahead } = LEVEL_SETTINGS[puzzleLevel(puzzle)]` and `solve(puzzle, { ...options, rules, parity, lookahead, initial: board, maxSteps: 1 })`. For hard / unlabelled puzzles that is exactly `solve`'s defaults, so server and web hints do not change today. An easy puzzle's hint walk from an empty board reaches the solution with easy rules and no reveal (test); a hard puzzle labelled easy gets reveals where easy rules stop (test).

## Rules for the implementer

- Mode EXECUTE; follow the steps in order. Prefix commands with `export PATH="$HOME/.bun/bin:$PATH";`. Work in `/home/jhonnold/projects/loophole-wt/generator-levels`; run `bun install --frozen-lockfile` first if `node_modules` is missing. Do not clone the repo (`/tmp` is a small tmpfs); scratch goes in your scratchpad.
- The code below is exact: it was applied to this worktree, formatted with Biome, and `bun run check` passed (857 pass, 3 skip; on main, step 1 alone: 845 pass; steps 1–2: 855). The planner's full diff is `/tmp/claude-1000/-home-jhonnold-projects-loophole/a34715f6-7810-5a69-ba81-edd46bda034d/scratchpad/generator-levels/wt20-final.diff`; a step may be applied with `git apply --include='<path>' …/wt20-final.diff` for its own paths, but commit per step. New files are given in full; edits to existing files as unified diffs against main (`d77a339`). What was built differs from these blocks in three ways: connectivity without parity throws like colouring (plan review 2), so the engine guard, the `SolveOptions`/`EngineOptions`/`LevelSettings` comments, the solver test, a separate level-table test and the agreement set (`{ rules: ["corners"], parity: false }`) follow suit, and `bun run check` has 858 pass; after the code review, `generate` and `findHint` pass a level's settings less `minClueShare` to `solve` as one object; and `bench:generate` counts parity steps in their own column instead of `other`.
- If a golden or digest differs, you did not copy something exactly: fix the code, never the expected value. The default level's goldens must pass **unchanged**; `GENERATOR_VERSION` stays `"6"`.
- No `console`, `Date`, `performance` or Bun APIs in `packages/core/src/` outside tests and `test-support`.
- Run `bun run format` after editing, then `bun run check`; commit at each boundary with the given conventional-commit message. Do not push.
- Benchmarks are not part of the gate. Step 3 says what to run (optional re-measure); the 100×100 hard seed takes 4–18 minutes, run it in the background if at all.

## Step 1 — `solve` can leave out parity (FR-3, FR-5)

### 1.1 `packages/core/src/engine.ts` (exact diff against main)

```diff
--- a/packages/core/src/engine.ts
+++ b/packages/core/src/engine.ts
@@ -11,7 +11,7 @@
  * 2. the 3s patterns, which depend only on the clues and are applied once
  * 3. corners (optional): for every corner of a 1, 2 or 3, which pairs of states its two sides
  *    there can still take, narrowed at the clue and at the dot in turn (a worklist)
- * 4. inside/outside parity, a union-find over cells (global); when it decides nothing,
+ * 4. inside/outside parity (optional), a union-find over cells (global); when it decides nothing,
  *    colouring (optional): the relations each 1, 2 or 3 forces among its neighbours' sides, added
  *    to the same union-find (global); then connectivity (optional): the loop is one cycle, so it
  *    stays inside one block of the edges that are not crossed, and it uses both or neither of two
@@ -132,6 +132,11 @@ export interface EngineOptions {
   readonly corners?: boolean;
   /** Run the colouring rule (rule group "colouring"). Default true. */
   readonly colouring?: boolean;
+  /**
+   * Run the parity tier. Default true. Colouring works on parity's union-find, so leaving parity out
+   * with colouring on throws `RangeError`.
+   */
+  readonly parity?: boolean;
   /**
    * Run colouring only once lookahead finds nothing, instead of right after parity. Default false.
    * The fixpoint is the same and only the order of steps changes (hints would prefer lookahead to
@@ -304,6 +309,7 @@ export class Engine {
 
   private readonly cornersOn: boolean;
   private readonly colourOn: boolean;
+  private readonly parityOn: boolean;
   private readonly colourLast: boolean;
   private connectOn: boolean;
   private probeCorners: boolean;
@@ -315,6 +321,8 @@ export class Engine {
   ) {
     this.cornersOn = options.corners ?? true;
     this.colourOn = options.colouring ?? true;
+    this.parityOn = options.parity ?? true;
+    if (this.colourOn && !this.parityOn) throw new RangeError("the colouring group needs parity");
     this.colourLast = options.colourLast ?? false;
     this.connectOn = options.connectivity ?? true;
     this.probeCorners = options.probeCorners ?? false;
@@ -378,9 +386,11 @@ export class Engine {
         if (c < 0) return false;
         if (c > 0) continue;
       }
-      const p = this.parity();
-      if (p < 0) return false;
-      if (p > 0) continue;
+      if (this.parityOn) {
+        const p = this.parity();
+        if (p < 0) return false;
+        if (p > 0) continue;
+      }
       // Colouring works on the union-find parity just built; nothing below changes it.
       const last = this.colourLast && lookahead;
       if (this.colourOn && !last) {
```

### 1.2 `packages/core/src/solver.ts` (exact diff against main)

```diff
--- a/packages/core/src/solver.ts
+++ b/packages/core/src/solver.ts
@@ -23,6 +23,11 @@ export interface SolveOptions {
    * A difficulty level can leave groups out; deductions are sound either way.
    */
   readonly rules?: readonly RuleGroup[];
+  /**
+   * Use the inside/outside parity rule. Default true. The colouring group works on what parity
+   * builds, so `parity: false` with colouring among `rules` throws `RangeError`.
+   */
+  readonly parity?: boolean;
   /**
    * Record steps. Default true. Without them `steps` comes back empty and `maxSteps` does nothing,
    * and solving is faster; generation's clue removal tests read only the status and edges.
@@ -61,6 +66,7 @@ export function solve(puzzle: Puzzle, options: SolveOptions = {}): SolveResult {
     corners: rules.includes("corners"),
     colouring: rules.includes("colouring"),
     connectivity: rules.includes("connectivity"),
+    parity: options.parity ?? true,
   });
   const steps: Step[] = [];
   engine.steps = options.steps === false ? null : steps;
```

### 1.3 `packages/core/src/solver.test.ts` (exact diff against main)

```diff
--- a/packages/core/src/solver.test.ts
+++ b/packages/core/src/solver.test.ts
@@ -130,6 +130,18 @@ describe("solve: each rule", () => {
     expect(solve(p).steps[0].rule).toBe("corner-chain");
   });
 
+  test("parity can be left out, but not under colouring", () => {
+    const p = puzzle(2, 3, "..33..");
+    expect(solve(p).steps.some((s) => s.rule === "parity")).toBe(true);
+    const without = solve(p, { rules: [], parity: false, lookahead: false });
+    expect(without.steps.some((s) => s.rule === "parity")).toBe(false);
+    expect(solve(p, { rules: [], parity: false, lookahead: false, steps: false }).edges).toEqual(
+      without.edges,
+    );
+    expect(() => solve(p, { parity: false })).toThrow(RangeError);
+    expect(() => solve(p, { rules: ["colouring"], parity: false })).toThrow(RangeError);
+  });
+
   test("without steps it reaches the same edges and records none", () => {
     const p = puzzle(3, 3, "0...11.3.");
     const full = solve(p);
```

### 1.4 `packages/core/src/agreement.test.ts` (exact diff against main)

```diff
--- a/packages/core/src/agreement.test.ts
+++ b/packages/core/src/agreement.test.ts
@@ -7,7 +7,7 @@ import { bruteForceSolutions } from "./bruteforce.ts";
 import { encodeEdges } from "./format.ts";
 import { EdgeState } from "./grid.ts";
 import { createPuzzle, NO_CLUE, type Puzzle } from "./puzzle.ts";
-import { solve } from "./solver.ts";
+import { type SolveOptions, solve } from "./solver.ts";
 import { arbPuzzleWithSolution } from "./test-support/arbitraries.ts";
 import { verify } from "./verify.ts";
 
@@ -32,9 +32,20 @@ function checkAgainstBruteForce(p: Puzzle): void {
   }
 
   // Every edge the rule solver decides agrees with every solution, with every rule group, with
-  // each group alone and with none.
-  for (const rules of [undefined, ["corners"], ["colouring"], ["connectivity"], []] as const) {
-    const r = solve(p, { rules });
+  // each group alone and with none, and without parity: as the easy level solves, and with the
+  // groups that don't need it.
+  const sets: SolveOptions[] = [
+    {},
+    { rules: ["corners"] },
+    { rules: ["colouring"] },
+    { rules: ["connectivity"] },
+    { rules: [] },
+    { rules: [], parity: false, lookahead: false },
+    { rules: ["corners", "connectivity"], parity: false },
+  ];
+  for (const options of sets) {
+    const { rules } = options;
+    const r = solve(p, options);
     r.edges.forEach((state, e) => {
       if (state === EdgeState.Unknown) return;
       for (const s of all) expect(s[e]).toBe(state);
@@ -43,9 +54,9 @@ function checkAgainstBruteForce(p: Puzzle): void {
     if (r.status === "contradiction") expect(all.length).toBe(0);
     expect(r.status).not.toBe("incomplete");
     // Without steps the engine works incrementally (DECISIONS, WT19) but finds the same status,
-    // with every group and with none.
-    if (rules === undefined || rules.length === 0) {
-      expect(solve(p, { rules, steps: false }).status).toBe(r.status);
+    // with every group, with none and without parity.
+    if (rules === undefined || rules.length === 0 || options.parity === false) {
+      expect(solve(p, { ...options, steps: false }).status).toBe(r.status);
     }
   }
 }
```

The agreement tests check every edge both new rule sets decide against every brute-force solution (70 930 exhaustive puzzles plus the fast-check sets), and that `steps: false` reaches the same status. With parity on, every output is unchanged (`solve`'s default; hard byte-identical).

Verify: `bun run format && bun run check` (845 pass, 3 skip).

Commit: `feat(core): solve can leave out the parity rule`

## Step 2 — Levels in the generator (FR-3, FR-7, FR-9, FR-10)

### 2.1 `packages/core/src/level.ts` (new, exact)

```ts
import type { Puzzle } from "./puzzle.ts";
import { RULE_GROUPS, type RuleGroup } from "./rules.ts";

/**
 * Difficulty levels, easiest first. A level decides which rules the generator's solver may use and
 * how many clues a puzzle keeps (`LEVEL_SETTINGS`); hints for a puzzle use its level's rules.
 */
export const LEVELS = ["easy", "medium", "hard"] as const;

export type Level = (typeof LEVELS)[number];

/** The level `generate` makes by default, and the level of a puzzle without `meta.level`. */
export const DEFAULT_LEVEL: Level = "hard";

export interface LevelSettings {
  /**
   * Rule groups the solver may use (`SolveOptions.rules`); the rules outside every group always
   * run, apart from parity (next).
   */
  readonly rules: readonly RuleGroup[];
  /** Whether the solver may use the inside/outside parity rule (`SolveOptions.parity`). */
  readonly parity: boolean;
  /** Whether the solver may use lookahead (`SolveOptions.lookahead`). */
  readonly lookahead: boolean;
  /**
   * Share of cells, 0 to 1, that keep a clue at least: after removing every clue its rules allow,
   * `generate` puts back removed clues, chosen at random, up to this share.
   */
  readonly minClueShare: number;
}

/** What each level allows (measured in DECISIONS, WT20). Hard is every rule and no extra clues. */
export const LEVEL_SETTINGS: Readonly<Record<Level, LevelSettings>> = {
  easy: { rules: [], parity: false, lookahead: false, minClueShare: 0.55 },
  medium: { rules: ["corners"], parity: true, lookahead: false, minClueShare: 0.45 },
  hard: { rules: RULE_GROUPS, parity: true, lookahead: true, minClueShare: 0 },
};

export function isLevel(value: unknown): value is Level {
  return (LEVELS as readonly unknown[]).includes(value);
}

/**
 * The level of `puzzle`: its `meta.level` when that names a level, otherwise `DEFAULT_LEVEL`
 * (puzzles generated at the default level, before levels existed, or made in the editor).
 */
export function puzzleLevel(puzzle: Puzzle): Level {
  const level = puzzle.meta?.level;
  return isLevel(level) ? level : DEFAULT_LEVEL;
}
```

### 2.2 `packages/core/src/index.ts`

```diff
--- a/packages/core/src/index.ts
+++ b/packages/core/src/index.ts
@@ -4,6 +4,7 @@ export * from "./format.ts";
 export * from "./generate.ts";
 export * from "./grid.ts";
 export * from "./hint.ts";
+export * from "./level.ts";
 export * from "./loop.ts";
 export * from "./puzzle.ts";
 export * from "./rng.ts";
```

### 2.3 `packages/core/src/generate.ts` (exact diff against main)

```diff
--- a/packages/core/src/generate.ts
+++ b/packages/core/src/generate.ts
@@ -1,5 +1,6 @@
 import { EdgeState, type Grid } from "./grid.ts";
-import { generateLoop, LOOP_THRESHOLDS, type LoopThresholds } from "./loop.ts";
+import { DEFAULT_LEVEL, isLevel, LEVEL_SETTINGS, LEVELS, type Level } from "./level.ts";
+import { generateLoop, LOOP_THRESHOLDS, type LoopThresholds, thresholdCount } from "./loop.ts";
 import { createPuzzle, deriveClues, NO_CLUE, type Puzzle } from "./puzzle.ts";
 import { createRng, type Rng } from "./rng.ts";
 import { type SolveResult, solve } from "./solver.ts";
@@ -23,13 +24,11 @@ const MAX_ATTEMPTS = 100;
 
 /**
  * Solves `puzzle` from `initial` (every edge unknown when left out). Generation judges every clue
- * removal by one of these, so the rules it allows decide which clues can go.
+ * removal by one of these, so the rules it allows (the level's) decide which clues can go. Records
+ * no steps: the tests read only the status and edges.
  */
 type RuleSolver = (puzzle: Puzzle, initial?: Uint8Array) => SolveResult;
 
-/** Every rule, lookahead included. Records no steps: the tests read only the status and edges. */
-const ALL_RULES: RuleSolver = (puzzle, initial) => solve(puzzle, { initial, steps: false });
-
 export interface GenerateProgress {
   /** Clue removal tests done so far. */
   readonly done: number;
@@ -44,6 +43,13 @@ export interface GenerateOptions {
   readonly seed: string;
   /** Default `LOOP_THRESHOLDS`. */
   readonly thresholds?: LoopThresholds;
+  /**
+   * Difficulty, default `DEFAULT_LEVEL`: the rules that judge every clue removal and solve the
+   * result, and the share of cells that keep a clue (`LEVEL_SETTINGS`). A board whose loops the
+   * level's rules cannot solve even with every clue (1×1 below hard; 2×2 and some 2×3 at easy) gets
+   * the next level up, and `puzzle.meta.level` says so.
+   */
+  readonly level?: Level;
   /**
    * Called after every clue removal test. Purely informational: it does not change the result.
    * Throw from it to stop generation; the error propagates out of `generate`.
@@ -52,7 +58,7 @@ export interface GenerateOptions {
 }
 
 export interface GenerateStats {
-  /** Loops made, counting rejected ones. 1 unless a loop was rejected. */
+  /** Loops made at the puzzle's level, counting rejected ones. 1 unless a loop was rejected. */
   readonly attempts: number;
   readonly clueCount: number;
   /** Clue removal tests made. */
@@ -62,11 +68,17 @@ export interface GenerateStats {
 }
 
 export interface GenerateResult {
-  /** Has `seed` and `meta.generator` = `GENERATOR_VERSION`. */
+  /**
+   * Has `seed`, `meta.generator` = `GENERATOR_VERSION` and, below `DEFAULT_LEVEL`, `meta.level`
+   * (`puzzleLevel` reads it).
+   */
   readonly puzzle: Puzzle;
   /** The only solution, as edge states (`Line` and `Cross`). */
   readonly solution: Uint8Array;
-  /** `solve(puzzle)` from an empty board: status `solved`, steps for hints (FR-6). */
+  /**
+   * `solve(puzzle)` with the level's rules from an empty board: status `solved`, steps for hints
+   * (FR-6).
+   */
   readonly solve: SolveResult;
   readonly stats: GenerateStats;
 }
@@ -80,13 +92,15 @@ export interface GenerateResult {
  *    try a new loop, with one more cell added after shaping than the last.
  * 3. In a seeded order, block by block, remove each clue if the rules still solve the whole puzzle
  *    without it (`removeClues`).
- * 4. Solve the whole puzzle from scratch. While it gets stuck, put back removed clues next to the
+ * 4. Put back removed clues, chosen at random, until the level's share of cells has one
+ *    (`addClues`; easier levels keep more clues).
+ * 5. Solve the whole puzzle from scratch. While it gets stuck, put back removed clues next to the
  *    open edges, spread out, and solve again. A safeguard: step 3's tests reach the same end as
  *    solving from scratch, so this has not been needed in the benchmarks.
  *
- * The result is solved by the rules alone, which proves it has one solution (PRD §9). Uses only the
- * seeded generator and no clock, so it is deterministic. Throws `RangeError` for a bad size, seed or
- * thresholds.
+ * "The rules" are the level's (`LEVEL_SETTINGS`). The result is solved by them alone, which proves
+ * it has one solution (PRD §9). Uses only the seeded generator and no clock, so it is
+ * deterministic. Throws `RangeError` for a bad size, seed, thresholds or level.
  */
 export function generate(options: GenerateOptions): GenerateResult {
   const { width, height, seed, onProgress } = options;
@@ -98,28 +112,56 @@ export function generate(options: GenerateOptions): GenerateResult {
       throw new RangeError(`thresholds.${name} must be from 0 to 1, got ${share}`);
     }
   }
-  const meta = { generator: GENERATOR_VERSION };
+  const level = options.level ?? DEFAULT_LEVEL;
+  if (!isLevel(level)) {
+    throw new RangeError(`level must be one of ${LEVELS.join(", ")}, got ${String(level)}`);
+  }
   // Checks the size and seed before any work.
-  const grid = createPuzzle(width, height, undefined, { seed, meta }).grid;
+  const grid = createPuzzle(width, height, undefined, { seed }).grid;
+  for (let i = LEVELS.indexOf(level); i < LEVELS.length; i++) {
+    const result = generateAt(grid, seed, LEVELS[i], thresholds, onProgress);
+    if (result !== null) return result;
+  }
+  throw new Error(`no usable loop after ${MAX_ATTEMPTS} attempts`);
+}
+
+/**
+ * `generate` at one level, from a fresh seeded generator: null when the level's rules solve no
+ * loop's full clue set in `MAX_ATTEMPTS` loops.
+ */
+function generateAt(
+  grid: Grid,
+  seed: string,
+  level: Level,
+  thresholds: LoopThresholds,
+  onProgress: GenerateOptions["onProgress"],
+): GenerateResult | null {
+  const { rules: groups, parity, lookahead, minClueShare } = LEVEL_SETTINGS[level];
+  const rules: RuleSolver = (puzzle, initial) =>
+    solve(puzzle, { rules: groups, parity, lookahead, initial, steps: false });
+  // The default level leaves `meta.level` out, so its puzzles are the ones made before levels.
+  const meta: Record<string, string> = { generator: GENERATOR_VERSION };
+  if (level !== DEFAULT_LEVEL) meta.level = level;
   const rng = createRng(seed);
   for (let attempts = 1; attempts <= MAX_ATTEMPTS; attempts++) {
     const solution = generateLoop(grid, rng, thresholds, attempts - 1);
     const full = deriveClues(grid, solution).map((k) => (k === 4 ? NO_CLUE : k));
     const clues = full.slice();
     const work: Puzzle = { grid, clues };
-    if (ALL_RULES(work).status !== "solved") continue;
-    const checks = removeClues(work, rng, ALL_RULES, onProgress);
-    const restored = restoreClues(work, full, rng, ALL_RULES);
+    if (rules(work).status !== "solved") continue;
+    const checks = removeClues(work, rng, rules, onProgress);
+    addClues(work, full, rng, minClueShare);
+    const restored = restoreClues(work, full, rng, rules);
     let clueCount = 0;
     for (const k of clues) if (k !== NO_CLUE) clueCount++;
     return {
-      puzzle: createPuzzle(width, height, clues, { seed, meta }),
+      puzzle: createPuzzle(grid.width, grid.height, clues, { seed, meta }),
       solution,
-      solve: solve(work),
+      solve: solve(work, { rules: groups, parity, lookahead }),
       stats: { attempts, clueCount, checks, restored },
     };
   }
-  throw new Error(`no usable loop after ${MAX_ATTEMPTS} attempts`);
+  return null;
 }
 
 /**
@@ -197,7 +239,27 @@ function hiddenBase(
 }
 
 /**
- * Step 4: solve from scratch; while stuck, put back removed clues of cells next to an open edge
+ * Step 4: puts back removed clues (in `full`, not in `puzzle.clues`), in a seeded random order,
+ * until at least `share` of the cells have a clue or none is left. Draws nothing from `rng` when
+ * `share` is 0, so the default level's puzzles are the same as before levels.
+ */
+function addClues(puzzle: Puzzle, full: Int8Array, rng: Rng, share: number): void {
+  if (share === 0) return;
+  const { clues } = puzzle;
+  const removed: number[] = [];
+  let count = 0;
+  for (let i = 0; i < clues.length; i++) {
+    if (clues[i] !== NO_CLUE) count++;
+    else if (full[i] !== NO_CLUE) removed.push(i);
+  }
+  const want = Math.min(removed.length, thresholdCount(share, clues.length) - count);
+  if (want <= 0) return;
+  shuffle(removed, rng);
+  for (let n = 0; n < want; n++) clues[removed[n]] = full[removed[n]];
+}
+
+/**
+ * Step 5: solve from scratch; while stuck, put back removed clues of cells next to an open edge
  * (or, if there are none, any removed clues), keeping each round's picks spread out. Terminates
  * because each round puts back at least one clue and the full clue set solves. Returns how many it
  * put back.
```

### 2.4 `packages/core/src/test-support/levels.ts` (new, exact)

```ts
import { LEVEL_SETTINGS, type Level } from "../level.ts";
import { GROUP_RULES, RULE_GROUPS, RULE_IDS, type RuleId } from "../rules.ts";

/** The rule ids a solve with `level`'s settings can record. */
export function levelRuleIds(level: Level): Set<RuleId> {
  const { rules, parity, lookahead } = LEVEL_SETTINGS[level];
  const ids = new Set<RuleId>(RULE_IDS);
  for (const g of RULE_GROUPS) {
    if (!rules.includes(g)) for (const id of GROUP_RULES[g]) ids.delete(id);
  }
  if (!parity) ids.delete("parity");
  if (!lookahead) ids.delete("lookahead");
  return ids;
}
```

### 2.5 `packages/core/src/level.test.ts` (new, exact)

```ts
import { describe, expect, test } from "bun:test";
import { DEFAULT_LEVEL, isLevel, LEVEL_SETTINGS, LEVELS, puzzleLevel } from "./level.ts";
import { createPuzzle } from "./puzzle.ts";
import { RULE_GROUPS } from "./rules.ts";

describe("levels", () => {
  test("the default level is hard: every rule group, parity, lookahead and no extra clues", () => {
    // So `generate` without a level makes the same puzzles as before levels (GENERATOR_VERSION).
    expect(DEFAULT_LEVEL).toBe("hard");
    expect(LEVEL_SETTINGS.hard).toEqual({
      rules: RULE_GROUPS,
      parity: true,
      lookahead: true,
      minClueShare: 0,
    });
  });

  test("each level allows no more rules and keeps no fewer clues than the next", () => {
    for (let i = 0; i + 1 < LEVELS.length; i++) {
      const easier = LEVEL_SETTINGS[LEVELS[i]];
      const harder = LEVEL_SETTINGS[LEVELS[i + 1]];
      for (const g of easier.rules) expect(harder.rules).toContain(g);
      if (easier.parity) expect(harder.parity).toBe(true);
      if (easier.lookahead) expect(harder.lookahead).toBe(true);
      // Colouring works on parity's union-find (`SolveOptions.parity`).
      if (!easier.parity) expect(easier.rules).not.toContain("colouring");
      expect(easier.minClueShare).toBeGreaterThan(harder.minClueShare);
      expect(easier.minClueShare).toBeLessThanOrEqual(1);
    }
  });

  test("a puzzle's level is its meta.level, or the default level", () => {
    const at = (meta?: Record<string, string>) =>
      puzzleLevel(createPuzzle(2, 2, undefined, { meta }));
    for (const level of LEVELS) expect(at({ generator: "6", level })).toBe(level);
    expect(at()).toBe(DEFAULT_LEVEL);
    expect(at({ generator: "6" })).toBe(DEFAULT_LEVEL);
    expect(at({ level: "expert" })).toBe(DEFAULT_LEVEL);
    expect(at({ level: "" })).toBe(DEFAULT_LEVEL);
    expect(isLevel("easy")).toBe(true);
    expect(isLevel("Easy")).toBe(false);
    expect(isLevel(undefined)).toBe(false);
  });
});
```

### 2.6 `packages/core/src/generate.test.ts` (exact diff against main)

```diff
--- a/packages/core/src/generate.test.ts
+++ b/packages/core/src/generate.test.ts
@@ -2,26 +2,37 @@ import { describe, expect, test } from "bun:test";
 import fc from "fast-check";
 import { analyzeBoard } from "./analyze.ts";
 import { countSolutions } from "./bruteforce.ts";
-import { encodeEdges, serializePuzzleJson } from "./format.ts";
+import { encodeEdges, parsePuzzleJson, serializePuzzleJson } from "./format.ts";
 import {
   GENERATOR_VERSION,
   type GenerateProgress,
   type GenerateResult,
   generate,
 } from "./generate.ts";
+import { DEFAULT_LEVEL, LEVEL_SETTINGS, LEVELS, type Level, puzzleLevel } from "./level.ts";
 import { LOOP_THRESHOLDS, type LoopThresholds, thresholdCount } from "./loop.ts";
 import { deriveClues, NO_CLUE } from "./puzzle.ts";
 import { hashSeed } from "./rng.ts";
 import { solve } from "./solver.ts";
+import { levelRuleIds } from "./test-support/levels.ts";
 import { loopCoverage } from "./test-support/loops.ts";
 import { verify } from "./verify.ts";
 
-/** Everything FR-7 to FR-9 promise about one result. */
-function checkResult(r: GenerateResult, seed: string, thresholds = LOOP_THRESHOLDS) {
+/** Everything FR-7 to FR-9 promise about one result, made at `level`. */
+function checkResult(
+  r: GenerateResult,
+  seed: string,
+  thresholds = LOOP_THRESHOLDS,
+  level: Level = DEFAULT_LEVEL,
+) {
   const { puzzle, solution } = r;
   const { grid } = puzzle;
   expect(puzzle.seed).toBe(seed);
-  expect(puzzle.meta).toEqual({ generator: GENERATOR_VERSION });
+  expect(puzzle.meta).toEqual(
+    level === DEFAULT_LEVEL
+      ? { generator: GENERATOR_VERSION }
+      : { generator: GENERATOR_VERSION, level },
+  );
   // The solution is one loop meeting the thresholds, and every clue agrees with it.
   expect(analyzeBoard(puzzle, solution).solved).toBe(true);
   const { area, rows, cols } = loopCoverage(grid, solution);
@@ -36,8 +47,11 @@ function checkResult(r: GenerateResult, seed: string, thresholds = LOOP_THRESHOL
     expect(puzzle.clues[i]).toBe(derived[i]);
   }
   expect(r.stats.clueCount).toBe(clueCount);
-  // The rules alone solve it from an empty board, so it is unique (PRD §9), and the verifier agrees.
+  // The level's rules alone solve it from an empty board, so it is unique (PRD §9), and the
+  // verifier agrees.
   expect(r.solve.status).toBe("solved");
+  const allowed = levelRuleIds(level);
+  expect(r.solve.steps.map((s) => s.rule).filter((rule) => !allowed.has(rule))).toEqual([]);
   expect(encodeEdges(r.solve.edges)).toBe(encodeEdges(solution));
   const v = verify(puzzle, { timeLimitMs: Number.POSITIVE_INFINITY });
   expect(v.status).toBe("unique");
@@ -182,8 +196,104 @@ describe("generate: properties", () => {
   });
 });
 
+describe("generate: levels", () => {
+  // Frozen output for GENERATOR_VERSION "6" below the default level, as digests of the serialized
+  // puzzle and its solution (the default level's goldens are above).
+  test('10x10 seed "golden" at easy and medium (digests)', () => {
+    const digest = (level: Level) => {
+      const r = generate({ width: 10, height: 10, seed: "golden", level });
+      return hashSeed(serializePuzzleJson(r.puzzle) + encodeEdges(r.solution));
+    };
+    expect(digest("easy")).toEqual([886490681, 133261979, 733940933, 3331014347]);
+    expect(digest("medium")).toEqual([3032055185, 730214522, 3796690882, 2962293742]);
+  });
+
+  test("small boards at every level: unique, solved by the level's rules, deterministic", () => {
+    fc.assert(
+      fc.property(
+        fc.integer({ min: 1, max: 8 }),
+        fc.integer({ min: 1, max: 8 }),
+        fc.string({ minLength: 1, maxLength: 12 }),
+        fc.constantFrom(...LEVELS),
+        (width, height, seed, level) => {
+          const r = generate({ width, height, seed, level });
+          // A board too small for the level's rules gets a harder level, never an easier one.
+          const made = puzzleLevel(r.puzzle);
+          expect(LEVELS.indexOf(made)).toBeGreaterThanOrEqual(LEVELS.indexOf(level));
+          checkResult(r, seed, LOOP_THRESHOLDS, made);
+          const again = generate({ width, height, seed, level });
+          expect(serializePuzzleJson(again.puzzle)).toBe(serializePuzzleJson(r.puzzle));
+          expect(encodeEdges(again.solution)).toBe(encodeEdges(r.solution));
+        },
+      ),
+      { numRuns: 40 },
+    );
+  });
+
+  test("medium boards at every level verify unique", () => {
+    for (const level of LEVELS) {
+      const seed = `levels-${level}`;
+      checkResult(generate({ width: 20, height: 20, seed, level }), seed, LOOP_THRESHOLDS, level);
+    }
+  });
+
+  test("easier levels keep more clues (10 boards of 10×10)", () => {
+    const sums: Record<Level, number> = { easy: 0, medium: 0, hard: 0 };
+    for (let n = 0; n < 10; n++) {
+      const count: Record<string, number> = {};
+      for (const level of LEVELS) {
+        const { puzzle, stats } = generate({ width: 10, height: 10, seed: `density-${n}`, level });
+        expect(puzzleLevel(puzzle)).toBe(level);
+        expect(stats.restored).toBe(0);
+        const share = LEVEL_SETTINGS[level].minClueShare;
+        if (share > 0) expect(stats.clueCount).toBeGreaterThanOrEqual(thresholdCount(share, 100));
+        count[level] = stats.clueCount;
+        sums[level] += stats.clueCount;
+      }
+      expect(count.easy).toBeGreaterThan(count.medium);
+    }
+    expect(sums.easy).toBeGreaterThan(sums.medium);
+    expect(sums.medium).toBeGreaterThan(sums.hard);
+    expect(sums.easy / 1000).toBeLessThanOrEqual(0.6);
+    expect(sums.medium / 1000).toBeLessThanOrEqual(0.5);
+  });
+
+  test("the default level is hard, and its puzzles have no meta.level", () => {
+    const plain = generate({ width: 8, height: 6, seed: "default-level" });
+    const hard = generate({ width: 8, height: 6, seed: "default-level", level: "hard" });
+    expect(plain.puzzle.meta).toEqual({ generator: GENERATOR_VERSION });
+    expect(serializePuzzleJson(hard.puzzle)).toBe(serializePuzzleJson(plain.puzzle));
+    expect(encodeEdges(hard.solution)).toBe(encodeEdges(plain.solution));
+    expect(hard.solve).toEqual(plain.solve);
+  });
+
+  test("meta.level survives the wire format", () => {
+    for (const level of LEVELS) {
+      const { puzzle } = generate({ width: 6, height: 6, seed: "wire", level });
+      const back = parsePuzzleJson(serializePuzzleJson(puzzle));
+      expect(back.meta).toEqual(puzzle.meta);
+      expect(puzzleLevel(back)).toBe(level);
+    }
+  });
+
+  test("a board too small for a level's rules gets the next level up", () => {
+    // A 1×1 needs lookahead (no rule says the loop exists); the 2×2 square, all 2s, needs a corner
+    // rule. Each falls back to the next level, so it is the puzzle that level makes.
+    const at = (width: number, height: number, level?: Level) =>
+      generate({ width, height, seed: "golden", level });
+    for (const level of ["easy", "medium"] as const) {
+      expect(serializePuzzleJson(at(1, 1, level).puzzle)).toBe(
+        serializePuzzleJson(at(1, 1).puzzle),
+      );
+    }
+    const small = at(2, 2, "easy");
+    expect(puzzleLevel(small.puzzle)).toBe("medium");
+    expect(serializePuzzleJson(small.puzzle)).toBe(serializePuzzleJson(at(2, 2, "medium").puzzle));
+  });
+});
+
 describe("generate: options", () => {
-  test("rejects a bad size, seed or thresholds before doing any work", () => {
+  test("rejects a bad size, seed, thresholds or level before doing any work", () => {
     const bad: Parameters<typeof generate>[0][] = [
       { width: 0, height: 5, seed: "s" },
       { width: 5, height: 101, seed: "s" },
@@ -192,6 +302,7 @@ describe("generate: options", () => {
       { width: 5, height: 5, seed: "s", thresholds: { minCoverage: 1.5, minSpan: 0.8 } },
       { width: 5, height: 5, seed: "s", thresholds: { minCoverage: 0.4, minSpan: Number.NaN } },
       { width: 5, height: 5, seed: "s", thresholds: { minCoverage: 0.4 } as LoopThresholds },
+      { width: 5, height: 5, seed: "s", level: "expert" as Level },
     ];
     for (const options of bad) {
       let calls = 0;
```

Test cases added (all deterministic except the fast-check property, which shrinks):

| Test | Checks | FR |
|---|---|---|
| `checkResult(r, seed, thresholds, level)` | meta has `level` iff below default; every recorded step's rule is allowed at the level (no `parity` at easy); solved from empty; `verify` unique | FR-3, FR-9 |
| `10x10 seed "golden" at easy and medium (digests)` | frozen easy/medium output (easy 55 clues, medium 45; easy re-frozen without parity, medium unchanged) | FR-10 |
| `small boards at every level …` (fast-check, 40 runs, 1–8 × 1–8, any level) | made level ≥ requested; `checkResult` at the made level; same seed → same puzzle | FR-7, FR-9, FR-10 |
| `medium boards at every level verify unique` | 20×20 per level | FR-9 |
| `easier levels keep more clues (10 boards of 10×10)` | per seed easy > medium; sums easy > medium > hard; each ≥ its floor; `restored` 0; easy mean ≤ 0.60, medium ≤ 0.50 | roadmap decision |
| `the default level is hard, and its puzzles have no meta.level` | `generate()` ≡ `generate({ level: "hard" })` incl. `solve` | FR-10 |
| `meta.level survives the wire format` | serialize → parse keeps meta; `puzzleLevel` round-trips | FR-2 |
| `a board too small for a level's rules gets the next level up` | 1×1 easy/medium = default puzzle; 2×2 easy = medium puzzle | FR-7 |
| rejects test | `level: "expert"` → `RangeError` before any progress call | FR-7 |

`level.test.ts`: hard is every group, parity, lookahead, share 0; each easier level's groups ⊆ the next's, parity ⇒ next has parity, lookahead ⇒ next has lookahead, share strictly larger; no level has colouring or connectivity without parity (its own test); `puzzleLevel` for each level, absent, unknown and empty values.

Verify: `bun run format && bun run check` (855 pass, 3 skip).

Commit: `feat(core): difficulty levels for generate (rule set and clue floor per level)`

## Step 3 — Hints use the puzzle's level (FR-6, FR-12)

### 3.1 `packages/core/src/hint.ts` (exact diff against main)

```diff
--- a/packages/core/src/hint.ts
+++ b/packages/core/src/hint.ts
@@ -1,5 +1,6 @@
 import { analyzeBoard } from "./analyze.ts";
 import { EdgeState, type Grid } from "./grid.ts";
+import { LEVEL_SETTINGS, puzzleLevel } from "./level.ts";
 import type { Puzzle } from "./puzzle.ts";
 import type { Step } from "./rules.ts";
 import { solve } from "./solver.ts";
@@ -10,7 +11,8 @@ import { solve } from "./solver.ts";
  * - `mistake`: `edge` is marked differently from the solution (the lowest such edge); `count` is how
  *   many marks are wrong in all. Mistakes come first, because deductions from a board with a wrong
  *   mark would not make sense to the player.
- * - `step`: the next deduction from the player's board, as the rule solver records it.
+ * - `step`: the next deduction from the player's board, as the rule solver records it with the
+ *   rules of the puzzle's level (`puzzleLevel`), so an easy puzzle's hints name only easy rules.
  * - `reveal`: no rule applies, so `edge` is one line of the solution, preferably one that extends a
  *   line already on the board.
  */
@@ -60,7 +62,15 @@ export function findHint(
 
   // Every mark agrees with the solution, so the solver's deductions from the board are sound. A
   // solve stopped by the time limit has no step and falls through to a revealed line.
-  const result = solve(puzzle, { ...options, initial: board, maxSteps: 1 });
+  const { rules, parity, lookahead } = LEVEL_SETTINGS[puzzleLevel(puzzle)];
+  const result = solve(puzzle, {
+    ...options,
+    rules,
+    parity,
+    lookahead,
+    initial: board,
+    maxSteps: 1,
+  });
   const step = result.steps[0];
   if (step !== undefined) return { kind: "step", step };
   return { kind: "reveal", edge: revealEdge(grid, solution, board) };
```

### 3.2 `packages/core/src/hint.test.ts` (exact diff against main)

```diff
--- a/packages/core/src/hint.test.ts
+++ b/packages/core/src/hint.test.ts
@@ -3,15 +3,41 @@ import fc from "fast-check";
 import { analyzeBoard } from "./analyze.ts";
 import { countSolutions } from "./bruteforce.ts";
 import { decodeEdges, parsePuzzle } from "./format.ts";
+import { generate } from "./generate.ts";
 import { EdgeState, hEdgeIndex } from "./grid.ts";
 import { findHint } from "./hint.ts";
+import type { Puzzle } from "./puzzle.ts";
+import type { RuleId } from "./rules.ts";
 import { solve } from "./solver.ts";
 import { arbPuzzleWithSolution } from "./test-support/arbitraries.ts";
+import { levelRuleIds } from "./test-support/levels.ts";
 
 function puzzle(width: number, height: number, clues: string) {
   return parsePuzzle({ v: 1, width, height, clues });
 }
 
+/** Takes every hint from an empty board to the end: the rules the steps named, and the reveals. */
+function hintWalk(p: Puzzle, solution: Uint8Array): { rules: Set<RuleId>; reveals: number } {
+  const board = new Uint8Array(p.grid.edgeCount);
+  const rules = new Set<RuleId>();
+  let reveals = 0;
+  // Each hint decides at least one edge; the cap turns a regression into a failure, not a hang.
+  for (let n = 0; n <= p.grid.edgeCount; n++) {
+    const hint = findHint(p, solution, board);
+    if (hint.kind === "solved") return { rules, reveals };
+    if (hint.kind === "step") {
+      rules.add(hint.step.rule);
+      for (const { edge, state } of hint.step.changes) board[edge] = state;
+    } else if (hint.kind === "reveal") {
+      reveals++;
+      board[hint.edge] = EdgeState.Line;
+    } else {
+      throw new Error(`unexpected ${hint.kind}`);
+    }
+  }
+  throw new Error("the hints did not reach the solution");
+}
+
 describe("findHint", () => {
   test("names the next rule from an empty board", () => {
     // 2×2 with a 0 in the top-left cell: the 0's four sides are crossed first.
@@ -100,6 +126,31 @@ describe("findHint", () => {
     expect(late.kind).toBe("reveal");
   });
 
+  test("uses only the rules of the puzzle's level", () => {
+    // The default level's 10×10 "golden" puzzle needs corner rules and lookahead. Labelled easy, its
+    // hints may use only the rules every level has, and reveal lines where those get stuck.
+    const { puzzle: hard, solution } = generate({ width: 10, height: 10, seed: "golden" });
+    const easy = levelRuleIds("easy");
+    const fromHard = hintWalk(hard, solution);
+    expect(fromHard.reveals).toBe(0);
+    expect(fromHard.rules.has("lookahead")).toBe(true);
+    expect([...fromHard.rules].some((rule) => rule !== "lookahead" && !easy.has(rule))).toBe(true);
+    const labelled = { ...hard, meta: { ...hard.meta, level: "easy" } };
+    const fromLabelled = hintWalk(labelled, solution);
+    expect([...fromLabelled.rules].filter((rule) => !easy.has(rule))).toEqual([]);
+    expect(fromLabelled.reveals).toBeGreaterThan(0);
+  });
+
+  test("an easy or medium puzzle's hints reach the solution with its own rules", () => {
+    for (const level of ["easy", "medium"] as const) {
+      const { puzzle: p, solution } = generate({ width: 10, height: 10, seed: "hints", level });
+      const walk = hintWalk(p, solution);
+      expect(walk.reveals).toBe(0);
+      const allowed = levelRuleIds(level);
+      expect([...walk.rules].filter((rule) => !allowed.has(rule))).toEqual([]);
+    }
+  });
+
   test("rejects boards of the wrong size", () => {
     const p = puzzle(2, 2, "2222");
     expect(() => findHint(p, new Uint8Array(12), new Uint8Array(3))).toThrow(RangeError);
```

- `hintWalk` stops with an error after `edgeCount + 1` hints (each hint decides at least one edge), so a regression fails instead of hanging.
- `uses only the rules of the puzzle's level`: the hard 10×10 "golden" puzzle's hint walk uses lookahead and a non-easy rule with 0 reveals; the same puzzle labelled `easy` names only easy rules (no parity) and needs ≥ 1 reveal.
- `an easy or medium puzzle's hints reach the solution with its own rules`: 0 reveals, only allowed rules.

Verify: `bun run check` (857 pass, 3 skip). The web hint e2e (`apps/web/tests/hint.e2e.ts`) and daily mocks use puzzles without `meta.level` → unchanged.

Commit: `feat(core): hints use only the rules of the puzzle's level`

## Step 4 — Benchmarks take a level

### 4.1 `packages/core/bench/generate.ts` (exact diff against main)

```diff
--- a/packages/core/bench/generate.ts
+++ b/packages/core/bench/generate.ts
@@ -6,14 +6,19 @@
  *    and the share of loops that meet the default thresholds (PRD §10, target ≥ 95%).
  * 2. Generation time per size (NFR-1: p95 under 10 s up to 30×30 and under 30 s at 40×40),
  *    first-attempt rate (loops whose full clue set the rules solve), clue density, clues put back
- *    by the safeguard, and `verify` on every result. 100×100 takes 6 to 18 minutes a puzzle (WT18:
- *    374 to 1 047 s for seeds `bench-0` to `bench-2`, next to other jobs).
- * Pass `--quick` to skip 100×100.
+ *    by the safeguard, the share of the hint steps (the result's solve) from each rule group, from
+ *    lookahead and from the rules that always run (`other`), and `verify` on every result. 100×100
+ *    takes 4 to 18 minutes a puzzle at the hard level (WT18: 374 to 1 047 s for seeds `bench-0` to
+ *    `bench-2`, next to other jobs; WT20: `bench-0` 233 s), about 25 s at easy and 70 s at medium.
+ * Pass `--quick` to skip 100×100, and `--level=<easy|medium|hard>` to generate at that level
+ * (default `DEFAULT_LEVEL`, hard).
  */
 import { generate } from "../src/generate.ts";
 import { createGrid } from "../src/grid.ts";
+import { DEFAULT_LEVEL, isLevel, LEVELS } from "../src/level.ts";
 import { generateLoop, LOOP_THRESHOLDS, loopShape, thresholdCount } from "../src/loop.ts";
 import { createRng } from "../src/rng.ts";
+import { GROUP_RULES, RULE_GROUPS, type RuleId } from "../src/rules.ts";
 import { loopCoverage } from "../src/test-support/loops.ts";
 import { verify } from "../src/verify.ts";
 
@@ -22,6 +27,13 @@ function percentile(sorted: number[], p: number): number {
 }
 
 const quick = process.argv.includes("--quick");
+const level =
+  process.argv.find((a) => a.startsWith("--level="))?.slice("--level=".length) ?? DEFAULT_LEVEL;
+if (!isLevel(level)) throw new Error(`unknown level ${level} (one of ${LEVELS.join(", ")})`);
+/** What a hint step counts as: its rule group, `lookahead`, or `other` (rules that always run). */
+const stepKind = new Map<RuleId, string>([["lookahead", "lookahead"]]);
+for (const g of RULE_GROUPS) for (const id of GROUP_RULES[g]) stepKind.set(id, g);
+const STEP_KINDS = ["other", ...RULE_GROUPS, "lookahead"];
 
 const LOOP_SIZES: [number, number, number][] = [
   [1, 1, 200],
@@ -81,22 +93,31 @@ for (const [size, count] of GEN_SIZES) {
   let firstAttempt = 0;
   let clues = 0;
   let restored = 0;
+  const steps: Record<string, number> = {};
+  let stepCount = 0;
   for (let n = 0; n < count; n++) {
     const t0 = performance.now();
-    const r = generate({ width: size, height: size, seed: `bench-${n}` });
+    const r = generate({ width: size, height: size, seed: `bench-${n}`, level });
     times.push(performance.now() - t0);
     if (r.stats.attempts === 1) firstAttempt++;
     clues += r.stats.clueCount;
     restored += r.stats.restored;
+    for (const { rule } of r.solve.steps) {
+      const kind = stepKind.get(rule) ?? "other";
+      steps[kind] = (steps[kind] ?? 0) + 1;
+      stepCount++;
+    }
     const status = verify(r.puzzle).status;
     statuses[status] = (statuses[status] ?? 0) + 1;
   }
   times.sort((a, b) => a - b);
   const cells = count * size * size;
+  const mix = STEP_KINDS.map((k) => `${k}=${((100 * (steps[k] ?? 0)) / stepCount).toFixed(1)}%`);
   console.log(
-    `generate ${size}×${size}: n=${count} median=${percentile(times, 0.5).toFixed(0)}ms ` +
+    `generate ${level} ${size}×${size}: n=${count} median=${percentile(times, 0.5).toFixed(0)}ms ` +
       `p95=${percentile(times, 0.95).toFixed(0)}ms max=${times[times.length - 1].toFixed(0)}ms ` +
       `first-attempt=${((100 * firstAttempt) / count).toFixed(0)}% clues=${((100 * clues) / cells).toFixed(1)}% ` +
-      `restored=${((100 * restored) / cells).toFixed(1)}% verify=${JSON.stringify(statuses)}`,
+      `restored=${((100 * restored) / cells).toFixed(1)}% steps: ${mix.join(" ")} ` +
+      `verify=${JSON.stringify(statuses)}`,
   );
 }
```

### 4.2 `packages/core/bench/clue-gaps.ts` (exact diff against main)

```diff
--- a/packages/core/bench/clue-gaps.ts
+++ b/packages/core/bench/clue-gaps.ts
@@ -16,18 +16,23 @@
  * Everything is seeded and uses node budgets, never time, so every run prints the same numbers
  * apart from the times. Takes about 3 minutes.
  *
- * `--rules=<groups>` (comma-separated `RULE_GROUPS`, empty for none) and `--no-lookahead` measure
- * the rule solver with fewer rules. The puzzles are still generated with every rule, so with either
- * flag the solver floor starts from the full clue set instead of the generated puzzle.
+ * `--level=<easy|medium|hard>` generates the puzzles at that level (default `DEFAULT_LEVEL`, hard)
+ * and measures them with its rules; below hard, `removable` counts the clues the level put back on
+ * purpose (`LEVEL_SETTINGS.minClueShare`), so the solver floor is the line to read.
+ * `--rules=<groups>` (comma-separated `RULE_GROUPS`, empty for none; with parity) and
+ * `--no-lookahead` measure the rule solver with other rules than the level's. The puzzles are still
+ * generated with the level's rules, so with either flag the solver floor starts from the full clue
+ * set instead of the generated puzzle.
  *
- * `--write-corpus` also rewrites `src/test-support/clue-gaps.json`: the first gap cases from the
- * smallest sizes, each the generated puzzle without that clue plus the edges the solver decided
- * before it got stuck. `clue-gaps.test.ts` checks them. The committed file is the WT14 baseline;
- * later work keeps it as it is, since rewriting it after the generator or the rules change gives
- * different boards.
+ * `--write-corpus` (default level only) also rewrites `src/test-support/clue-gaps.json`: the first
+ * gap cases from the smallest sizes, each the generated puzzle without that clue plus the edges the
+ * solver decided before it got stuck. `clue-gaps.test.ts` checks them. The committed file is the
+ * WT14 baseline; later work keeps it as it is, since rewriting it after the generator or the rules
+ * change gives different boards.
  */
 import { encodeEdges, serializePuzzle } from "../src/format.ts";
 import { generate } from "../src/generate.ts";
+import { DEFAULT_LEVEL, isLevel, LEVEL_SETTINGS, LEVELS } from "../src/level.ts";
 import { createPuzzle, deriveClues, NO_CLUE, type Puzzle } from "../src/puzzle.ts";
 import { createRng } from "../src/rng.ts";
 import { RULE_GROUPS, type RuleGroup } from "../src/rules.ts";
@@ -49,14 +54,22 @@ const CORPUS_SIZES = [5, 7, 10];
 const CORPUS_PER_PUZZLE = 2;
 const CORPUS_FILE = new URL("../src/test-support/clue-gaps.json", import.meta.url);
 
+const level =
+  process.argv.find((a) => a.startsWith("--level="))?.slice("--level=".length) ?? DEFAULT_LEVEL;
+if (!isLevel(level)) throw new Error(`unknown level ${level} (one of ${LEVELS.join(", ")})`);
 const rulesArg = process.argv.find((a) => a.startsWith("--rules="))?.slice("--rules=".length);
 const rules = rulesArg?.split(",").filter((g) => g !== "") as RuleGroup[] | undefined;
 for (const g of rules ?? []) {
   if (!(RULE_GROUPS as readonly string[]).includes(g)) throw new Error(`unknown rule group ${g}`);
 }
-const options: SolveOptions = { rules, lookahead: !process.argv.includes("--no-lookahead") };
-/** Fewer rules than `generate` used: the floor then starts from the full clue set. */
-const fewerRules = rules !== undefined || !options.lookahead;
+const noLookahead = process.argv.includes("--no-lookahead");
+const options: SolveOptions = {
+  rules: rules ?? LEVEL_SETTINGS[level].rules,
+  parity: rules !== undefined || LEVEL_SETTINGS[level].parity,
+  lookahead: noLookahead ? false : LEVEL_SETTINGS[level].lookahead,
+};
+/** Other rules than `generate` used: the floor then starts from the full clue set. */
+const fewerRules = rules !== undefined || noLookahead;
 
 /** The one place the harness runs the rule solver, with the rules the flags chose. */
 function runRules(puzzle: Puzzle): SolveResult {
@@ -88,6 +101,9 @@ function greedyFloor(puzzle: Puzzle, seed: string, keeps: (p: Puzzle) => boolean
 }
 
 const writeCorpus = process.argv.includes("--write-corpus");
+if (writeCorpus && level !== DEFAULT_LEVEL) {
+  throw new Error(`--write-corpus takes puzzles of the default level (${DEFAULT_LEVEL}) only`);
+}
 const corpus: ClueGapEntry[] = [];
 const pct = (n: number, of: number) => `${((100 * n) / of).toFixed(1)}%`;
 
@@ -103,7 +119,7 @@ for (const [size, count, withVerifyFloor] of SIZES) {
   let sizeCorpus = 0;
   for (let n = 0; n < count; n++) {
     const seed = `clue-gaps-${size}-${n}`;
-    const { puzzle, solution, stats } = generate({ width: size, height: size, seed });
+    const { puzzle, solution, stats } = generate({ width: size, height: size, seed, level });
     const { grid } = puzzle;
     cells += grid.cellCount;
     restored += stats.restored;
@@ -157,7 +173,7 @@ for (const [size, count, withVerifyFloor] of SIZES) {
   }
   const seconds = ((performance.now() - t0) / 1000).toFixed(1);
   console.log(
-    `clue-gaps ${size}×${size}: n=${count} clues=${pct(kept, cells)} restored=${pct(restored, cells)} ` +
+    `clue-gaps ${level} ${size}×${size}: n=${count} clues=${pct(kept, cells)} restored=${pct(restored, cells)} ` +
       `removable=${pct(classes.removable, kept)} gap=${pct(classes.gap, kept)} ` +
       `needed=${pct(classes.needed, kept)} unknown=${classes.unknown} ` +
       `solver-floor=${pct(solverFloor, cells)} ` +
```

Verify: `bun run check`; optionally `bun run --cwd packages/core bench:generate --quick --level=easy` (under a minute with the loop section; lines like `generate easy 20×20: … clues=55.0% restored=0.0% steps: other=100.0% corners=0.0% …`), and `bun run --cwd packages/core bench:clue-gaps --level=easy --write-corpus` must fail at once with "--write-corpus takes puzzles of the default level (hard) only" and leave `clue-gaps.json` untouched.

Commit: `feat(core): bench:generate and bench:clue-gaps take --level`

## Step 5 — Docs

### 5.1 `docs/DECISIONS.md` — append verbatim (after the last WT19 entry, one blank line between entries)

```markdown
## 2026-10-26 · WT20 `generator-levels` · Three levels: the rules the solver may use, and a share of cells that keep a clue
- **Question:** Difficulty is driven by clue count (more is easier) and by which rules the solver may use when deciding removals (a simpler set is easier); loop shape stays fixed (user, 2026-10-26). How many levels, and what does each allow?
- **Decision:** `LEVELS = ["easy", "medium", "hard"]` in `level.ts`, `DEFAULT_LEVEL = "hard"`, and `LEVEL_SETTINGS`: easy uses only the local rules (tier 1, the 3s and corner patterns, premature loop), without parity, groups or lookahead, and keeps at least 55% of cells clued; medium adds inside/outside parity and the `corners` group, no lookahead, at least 45%; hard is every group with parity and lookahead and no extra clues, today's output. Parity is outside every rule group, so `solve` gets a `parity` option (default true; the engine skips the parity tier without it, and colouring, which works on parity's union-find, throws `RangeError` without it). `generate({ level })` judges the full-clue check, every removal test, the restore safeguard and the final (recorded) solve with the level's rules, so a puzzle made at a level is solved by that level's rules from an empty board, which proves it unique. After removal, a new step puts back removed clues in a seeded random order until the share is reached (`addClues`; a share of 0 draws nothing from the generator). No "expert" level: the only stronger solver measured (WT18's corner probes) kept 0.2–0.4 points fewer clues at 1.7–2.5× the time.
- **Reason:** Measured (`bench:generate --level=…`, seeds `bench-<n>`, 20 per size, 10 at 40×40, 3 at 100×100; every result `unique`, first attempt 100%, restored 0.0%), clues / p95 time: easy 55.1% / 6 ms (7×7), 55.0% / 6 ms (10×10), 55.0% / 44 ms (20×20), 55.0% / 198 ms (30×30), 55.0% / 665 ms (40×40), 55.0% / 23 s (100×100); medium 47.1% / 10 ms, 45.1% / 15 ms, 45.0% / 174 ms, 45.0% / 710 ms, 45.0% / 2.2 s, 45.0% / 68 s; hard 39.9% / 27 ms, 39.8% / 43 ms, 39.8% / 603 ms, 40.0% / 2.7 s, 40.6% / 8.9 s, 41.0% / 233 s (seed `bench-0`, run next to other jobs). Hint steps (the result's solve, 20×20): easy 88.5% tier 1, 7.2% patterns, 4.3% premature loop; medium 78%, 4.5%, 5%, parity 3%, corners 9%; hard 73%, 3%, 5%, parity 2%, corners 10%, colouring 1.5%, connectivity 1.5%, lookahead 4.8%. The levels are far apart: with easy's rules a medium puzzle gets 28–33% of its edges and a hard one 18–19%, with medium's a hard one 32–35% (10×10 and 20×20, 20 puzzles each; none solved). The rule sets alone barely move density (generated with each set and no extra clues, 20×20: 45.2% local rules only, 44.3% with parity, 41.5% with parity and corners, 41.0% adding connectivity, 40.3% with every group, 39.8% with lookahead too), so the share is what makes easy and medium keep more clues. Easy without parity, as in the roadmap (plan review 1): with parity every easy 20×20 puzzle needed at least one parity step, a global argument; without it easy keeps the same 55.0%, has the same small-board fallbacks and generates 2–2.5× faster. Medium is parity and corners, as in the roadmap: connectivity added 1.6% of steps and 0.2–0.8 points, and "only ways across" is not a medium technique. Alternatives: keeping each clue untested with a probability (p 0.4 gave 55.0–56.0%, a density only on average, where the share is a floor every puzzle meets); easy at 50% (judged too close to medium). Not tried: stopping removal at a target density, which would leave the blocks visited last fully clued.

## 2026-10-26 · WT20 `generator-levels` · `meta.level`, left out at the default level; hints use the puzzle's level
- **Question:** How do the server and the web app know a puzzle's level, how do hints pick their rules, and does the default output change?
- **Decision:** A generated puzzle below the default level has `meta.level` (`easy` or `medium`, `docs/FORMAT.md`); at hard it is left out, so the default output is byte-identical to before levels and `GENERATOR_VERSION` stays `"6"` (the version covers every level; changing a level's settings later changes its output and needs a bump). `puzzleLevel(puzzle)` reads `meta.level` and falls back to hard, which also covers puzzles from the editor and from before levels. `findHint` solves with the rules of the puzzle's level, so an easy puzzle's hints name only easy rules; a board those rules cannot move on gets a revealed line, as before. A board too small for a level's rules (no loop's full clue set solved by them in 100 loops: 1×1 at easy and medium, since no rule says the loop exists and only lookahead finds it; the 2×2 square, all 2s, and some 2×3 and 3×2 loops at easy) gets the next level up, from a fresh generator, so it is exactly that level's puzzle and `meta.level` says so. The server keeps only `meta.generator` today, so served puzzles count as hard until WT21 stores the level (its `level` column holds 1 for every puzzle, which is hard). WT21 has to rebuild `meta.level` from what it stores when it loads a puzzle (or hints stay hard), take the level from `puzzleLevel(result.puzzle)` rather than the request, never from a submitted puzzle's `meta`, and keep today's `level = 1` rows hard.
- **Reason:** Left out at the default, no generated puzzle changes (126 boards from 1×1 to 100×2 compared with the generator before levels, puzzle, solution, steps and stats, and 144 more on other seeds in plan review 1; the goldens are unchanged) and a stored puzzle without the key means what it meant. Hints with every rule on an easy puzzle would name parity, lookahead or corner rules the puzzle never needed; with the level's rules a hint walk on a generated easy and a generated medium 10×10 reaches the solution with no reveal (`hint.test.ts`). Throwing for a tiny board instead would make the level option fail for sizes the API allows.
```

### 5.2 `docs/PRD.md` (exact diff)

```diff
--- a/docs/PRD.md
+++ b/docs/PRD.md
@@ -62,20 +62,20 @@ Priority: **P0** = required for launch, **P1** = soon after.
 - FR-2 (P0). Wire format for a puzzle: width, height, clue string (row-major, `.` for empty), plus optional seed and metadata. Specified and versioned in `docs/FORMAT.md`.
 
 ### 7.2 Solver and verifier
-- FR-3 (P0). A rule-based solver applies named deductions (clue-0, clue-satisfied/saturated, dot degree 0/2, corner and adjacent/diagonal 3 patterns, inside/outside parity, premature-loop prevention, bounded lookahead) until stuck, recording which rule fired at each step.
+- FR-3 (P0). A rule-based solver applies named deductions (clue-0, clue-satisfied/saturated, dot degree 0/2, corner and adjacent/diagonal 3 patterns, inside/outside parity, premature-loop prevention, bounded lookahead) until stuck, recording which rule fired at each step. Rule groups (corner rules, colouring, connectivity), parity and lookahead can be left out, so a difficulty level can use a smaller set: easy uses only the local rules (clues, dots, the 3s and corner patterns, premature loop), medium adds parity and the corner rules, hard uses every rule and lookahead.
 - FR-4 (P0). A verifier returns one of: `unique`, `none`, `multiple`, or `unknown` (time/size budget exhausted). Only `unique` puzzles can be published.
 - FR-5 (P0). Verification must be correct: a property-based test suite compares it against brute force on all small grids.
 - FR-6 (P1). The solver's step record powers hints (see FR-12).
 
 ### 7.3 Generator
-- FR-7 (P0). Generation inputs: width, height, optional seed. Output: clue grid, solution, and the solver result.
+- FR-7 (P0). Generation inputs: width, height, optional seed, optional level (easy, medium or hard; default hard). Output: clue grid, solution, and the solver result. A level decides which rules judge each clue removal and solve the result, and how many clues stay (at least 55% of cells at easy, 45% at medium; hard keeps only what its rules need, about 40%). The puzzle records its level (`meta.level`, `docs/FORMAT.md`).
 - FR-8 (P0). The generator builds a random loop and rejects loops that are too small or thin. Defaults (tunable): the loop must enclose at least ~40% of cells, and its bounding box must span at least ~80% of both dimensions. Thresholds live in config and have tests.
 - FR-9 (P0). Clues are derived from the loop and then removed while uniqueness still holds, so the final puzzle has the same solution and is `unique`.
 - FR-10 (P0). Generation is deterministic for a given seed and version.
 - FR-11 (P0). Large grids are generated by background jobs with progress and a timeout; they are never generated in the request path.
 
 ### 7.4 Player client
-- FR-12 (P1). Hint: highlights the cells involved in the next forced deduction and explains the rule in words. Using a hint marks the solve as assisted and excludes it from ranked leaderboards.
+- FR-12 (P1). Hint: highlights the cells involved in the next forced deduction, using only the rules of the puzzle's level, and explains the rule in words. Using a hint marks the solve as assisted and excludes it from ranked leaderboards.
 - FR-13 (P0). Input: tap/click an edge to cycle line → X → empty; drag to draw. Hit targets are at least 44px on touch devices; pinch-zoom and pan for large grids.
 - FR-14 (P0). Undo/redo, timer, pause, and clear.
 - FR-15 (P0). Error highlighting only for definite violations: a dot with 3+ lines, a cell with more lines than its clue, a closed loop that is not a full solution, or a clue that can no longer be satisfied. Merely-wrong guesses are not flagged.
@@ -157,7 +157,7 @@ Working name: **Loophole** (pun on the loop you draw and the "way out" of a logi
 
 ## 14. Open questions
 
-1. Difficulty: which techniques define levels? Revisit once the solver exists and puzzle statistics are available. Until then, one level.
+1. Difficulty: which techniques define levels? Answered for the generator (WT20, `docs/DECISIONS.md`): three levels, easy, medium and hard, set by the rules the solver may use and how many clues stay (FR-3, FR-7). Serving them (the generate request, the daily level, leaderboard buckets) is still open; until then the server makes and serves one level, hard.
 2. Hosting target and database choice (Postgres assumed).
 3. CAPTCHA provider (e.g. hCaptcha, Cloudflare Turnstile).
 4. SMTP provider for verification and reset emails.
```

### 5.3 `docs/FORMAT.md` (exact diff)

```diff
--- a/docs/FORMAT.md
+++ b/docs/FORMAT.md
@@ -44,6 +44,13 @@ A puzzle is a JSON object:
 
 Lengths are counted in UTF-16 code units (JavaScript string length).
 
+`meta` keys the core writes and reads (others are kept as they are):
+
+| Key | Meaning |
+|---|---|
+| `generator` | The generator version (`GENERATOR_VERSION`) of a generated puzzle. |
+| `level` | The difficulty level a generated puzzle was made at, `easy` or `medium`. Left out at the default level, `hard`. A puzzle without it, or with a value that names no level, counts as `hard` (`puzzleLevel`), and its hints use every rule. |
+
 A reader rejects a puzzle that breaks any rule, including one with a field not listed above. The error names the field (`width`, `clues`, `meta.title`) and says what was expected.
 
 **Canonical form.** Writers emit the fields in the order of the table, leave out absent optional fields, sort `meta` keys by UTF-16 code unit (JavaScript keeps integer-like keys first, in numeric order), and add no whitespace. `serializePuzzleJson` produces this form, so equal puzzles give identical text.
```

### 5.4 `README.md` (exact diff)

```diff
--- a/README.md
+++ b/README.md
@@ -4,7 +4,7 @@ Loophole is a web app for Slitherlink, the Japanese loop puzzle: draw one closed
 
 ## Status
 
-Early development. The repo has the build tooling, the local dev services, the design kit, the puzzle engine (the grid model, the wire format, rule checks for play, a brute-force solution counter for tests, a seeded random number generator, a rule-based solver that records each deduction for hints, a verifier that says whether a puzzle has one solution, none, several, or could not be decided in time, and a generator that makes a puzzle with exactly one solution from a seed) and a first web app. The web app plays a few built-in puzzles on phones and desktops: tap or drag to draw, keyboard play, undo and redo, a pausable timer, error highlighting, solve detection, light and dark themes, and progress saved in the browser. A Hint button (or H) shows the next forced deduction from the player's board, with the rule's name, a one-line explanation and its pattern drawn small, or points out a mark that doesn't fit; using one marks the attempt as assisted. Boards too big for the screen zoom and pan (pinch, wheel or the zoom buttons) with an overview map, and boards over 30×30 draw on a canvas. The server has its foundation: an HTTP API that serves puzzles, gives hints from each puzzle's stored solution and queues generation jobs, and a worker that generates puzzles in the background with progress and a time limit, keeping each solution in blob storage. The web app lists the server's puzzles after its built-in ones. Players can sign up with an email and password (behind a CAPTCHA, with email confirmation), log in and out, reset a forgotten password and delete their account; guests play exactly as before. Logged-in players' progress on server puzzles syncs to their account, so they can leave a puzzle on one device and carry on on another (a "Continue" list on the home page shows unsolved ones), and they can bring progress they saved as a guest into their account. Anyone can make a puzzle in the editor (Create), which says as they place clues whether it has one answer, none or several, and shows two answers side by side when there are several; players with a confirmed email publish it, the worker proves it has one solution before it goes up, and its link can be shared. Players can report a puzzle, and admins see the reports and can unpublish it. The worker also makes a daily puzzle for each size class (7×7, 10×10, 20×20 and 40×40) a few days ahead, the same for everyone and hidden until 00:00 UTC on its day, and the API checks ranked solves of them against the stored solution and the clock, keeps leaderboards, streaks and personal bests, and lets players choose a name for the leaderboards. The home page shows today's puzzles as book covers with a countdown to the next ones and, for logged-in players, their streak. A confirmed player gets one ranked try at each daily, on a clock that doesn't stop, and the Solved screen shows the time, the rank and the leaderboard of that size; guests play the dailies unranked. The leaderboard page (Ranks) shows each size's board for today and of all time. For launch, the API and the worker export Prometheus metrics and write JSON logs, the API has a readiness check, and there is a production Docker image with a Compose file and a database backup script. Admins see system health on the admin page, and end-to-end suites cover the PRD's user stories and check accessibility in both themes. Each phase's plan is in [`docs/plans/`](docs/plans/).
+Early development. The repo has the build tooling, the local dev services, the design kit, the puzzle engine (the grid model, the wire format, rule checks for play, a brute-force solution counter for tests, a seeded random number generator, a rule-based solver that records each deduction for hints, a verifier that says whether a puzzle has one solution, none, several, or could not be decided in time, and a generator that makes a puzzle with exactly one solution from a seed, at one of three levels: easy, medium or hard, which differ in the rules the solver may use and in how many clues stay) and a first web app. The web app plays a few built-in puzzles on phones and desktops: tap or drag to draw, keyboard play, undo and redo, a pausable timer, error highlighting, solve detection, light and dark themes, and progress saved in the browser. A Hint button (or H) shows the next forced deduction from the player's board, with the rule's name, a one-line explanation and its pattern drawn small, or points out a mark that doesn't fit; using one marks the attempt as assisted. Boards too big for the screen zoom and pan (pinch, wheel or the zoom buttons) with an overview map, and boards over 30×30 draw on a canvas. The server has its foundation: an HTTP API that serves puzzles, gives hints from each puzzle's stored solution and queues generation jobs, and a worker that generates puzzles in the background with progress and a time limit, keeping each solution in blob storage. The web app lists the server's puzzles after its built-in ones. Players can sign up with an email and password (behind a CAPTCHA, with email confirmation), log in and out, reset a forgotten password and delete their account; guests play exactly as before. Logged-in players' progress on server puzzles syncs to their account, so they can leave a puzzle on one device and carry on on another (a "Continue" list on the home page shows unsolved ones), and they can bring progress they saved as a guest into their account. Anyone can make a puzzle in the editor (Create), which says as they place clues whether it has one answer, none or several, and shows two answers side by side when there are several; players with a confirmed email publish it, the worker proves it has one solution before it goes up, and its link can be shared. Players can report a puzzle, and admins see the reports and can unpublish it. The worker also makes a daily puzzle for each size class (7×7, 10×10, 20×20 and 40×40) a few days ahead, the same for everyone and hidden until 00:00 UTC on its day, and the API checks ranked solves of them against the stored solution and the clock, keeps leaderboards, streaks and personal bests, and lets players choose a name for the leaderboards. The home page shows today's puzzles as book covers with a countdown to the next ones and, for logged-in players, their streak. A confirmed player gets one ranked try at each daily, on a clock that doesn't stop, and the Solved screen shows the time, the rank and the leaderboard of that size; guests play the dailies unranked. The leaderboard page (Ranks) shows each size's board for today and of all time. For launch, the API and the worker export Prometheus metrics and write JSON logs, the API has a readiness check, and there is a production Docker image with a Compose file and a database backup script. Admins see system health on the admin page, and end-to-end suites cover the PRD's user stories and check accessibility in both themes. Each phase's plan is in [`docs/plans/`](docs/plans/).
 
 ## Quickstart
 
@@ -232,8 +232,8 @@ Or stop Garage and archive the `garage-data` and `garage-meta` volumes. `infra/g
 | `./scripts/test-under-load.sh [copies] [rounds]` | Run `bun test` several times at once to shake out timing-sensitive tests |
 | `./scripts/backup-sqlite.sh [folder]` | Back up the SQLite database (see Backups) |
 | `bun run --cwd packages/core bench` | Time puzzle verification on 10×10 to 100×100 boards (not part of the check) |
-| `bun run --cwd packages/core bench:generate` | Time puzzle generation on 7×7 to 100×100 boards and measure loop shape and acceptance (not part of the check) |
-| `bun run --cwd packages/core bench:clue-gaps` | Measure which kept clues the rule solver needs on generated 5×5 to 20×20 puzzles, against how few clues one solution allows (`--rules=` and `--no-lookahead` measure fewer rules, `--write-corpus` rewrites the test corpus; not part of the check) |
+| `bun run --cwd packages/core bench:generate` | Time puzzle generation on 7×7 to 100×100 boards and measure loop shape, acceptance, clue density and which rules the hints use (`--level=` for a level other than hard; not part of the check) |
+| `bun run --cwd packages/core bench:clue-gaps` | Measure which kept clues the rule solver needs on generated 5×5 to 20×20 puzzles, against how few clues one solution allows (`--level=` for a level other than hard, `--rules=` and `--no-lookahead` measure other rules, `--write-corpus` rewrites the test corpus; not part of the check) |
 
 ## Repository layout
 
```

### 5.5 `packages/core/AGENTS.md` (exact diff)

```diff
--- a/packages/core/AGENTS.md
+++ b/packages/core/AGENTS.md
@@ -7,5 +7,5 @@ The puzzle engine shared by the server and the web app: grid and edge model, wir
 - Correctness matters most here. Back solver, verifier and generator behaviour with fast-check property tests (see `docs/TESTING.md`).
 - Source files are type-checked without Bun or DOM types, so a stray `Bun.` or `console` fails the typecheck. Tests and the shared test helpers (fast-check arbitraries, fixture puzzles with known solution counts) have their own config that adds Bun's types.
 - The brute-force solution counter is the reference that solver and verifier tests compare against. Keep it simple and free of solver code.
-- `solve` and `verify` share one internal deduction engine. Every rule must be sound: what it decides holds in every solution. A new rule gets an id, a short title and a one-sentence explanation alongside the others, because hint cards show them to players (the web app also draws a small pattern for each rule). A rule a difficulty level may leave out belongs to a rule group (`RULE_GROUPS`), and the agreement tests run with and without each group. Generation's clue tests solve without recording steps (`steps: false`); only the final solve, whose steps become hints, records them. Without recorded steps (the verifier, those clue tests) the engine keeps parity's union-find between passes and undoes it with the edges, so only the fixpoint is the same, not the order of deductions; a rule that touches the union-find has to work both ways (`engine.test.ts` runs the two in lockstep). The brute-force agreement tests are the safety net, and the package's benchmark script shows whether an engine change slowed verification.
+- `solve` and `verify` share one internal deduction engine. Every rule must be sound: what it decides holds in every solution. A new rule gets an id, a short title and a one-sentence explanation alongside the others, because hint cards show them to players (the web app also draws a small pattern for each rule). A rule a difficulty level may leave out belongs to a rule group (`RULE_GROUPS`), and the agreement tests run with and without each group. A level (`LEVEL_SETTINGS`) is a set of groups, parity and lookahead on or off, and a share of cells that keep a clue: `generate` judges every clue removal and the final solve with its level's rules, and `findHint` uses the rules of the puzzle's level (`meta.level`; none means the default, hard). Generation's clue tests solve without recording steps (`steps: false`); only the final solve, whose steps become hints, records them. Without recorded steps (the verifier, those clue tests) the engine keeps parity's union-find between passes and undoes it with the edges, so only the fixpoint is the same, not the order of deductions; a rule that touches the union-find has to work both ways (`engine.test.ts` runs the two in lockstep). The brute-force agreement tests are the safety net, and the package's benchmark script shows whether an engine change slowed verification.
 - Generated puzzles are frozen per `GENERATOR_VERSION`. A change that alters them, including through the solver's rules or the seeded generator, bumps the version and the generator's golden values. Generation uses no clock or time limit (DECISIONS). `bench:generate` shows its speed.
```

Verify: `bun run check` (green; docs only).

Commit: `docs: WT20 difficulty levels (DECISIONS, PRD, FORMAT, README)`

## Final checks

- `bun run check` green after each of the 5 commits; nothing pushed; `git status` clean.
- `git diff main -- packages/core/src/generate.test.ts` leaves the default-level golden block (`[1, 1, …]` … `20x20 seed "golden" (digest)`) unchanged; `GENERATOR_VERSION` is `"6"`.
- `grep -n "ALL_RULES" packages/core/src` finds nothing.
- `git diff main --stat -- apps openapi.yaml packages/api-client` is empty.

## Acceptance criteria

1. **FR-7 / roadmap decision:** `generate({ level })` accepts `easy`, `medium`, `hard` (default hard) and rejects anything else with `RangeError` before any work.
2. **FR-3 / FR-9:** a puzzle made at level L is solved from an empty board by L's rule set (`result.solve.status === "solved"` with L's groups, parity and lookahead; every recorded step's rule is allowed at L) and `verify` says `unique` — tested per level (property 1–8 × 1–8, 20×20 per level).
3. **Density ordering (roadmap):** easy ≥ 55% and medium ≥ 45% of cells clued on every board where enough clues exist; on fixed seeds easy > medium per board and easy > medium > hard on the sum (measured 55.0 / 45.0 / 39.8% at 10×10 and 20×20).
4. **FR-10:** same seed and level → same puzzle (property test); default level byte-identical to main (goldens unchanged, 126-board comparison), no `GENERATOR_VERSION` bump; easy and medium frozen by digests.
5. **FR-2:** `meta.level` written below the default level, documented in `docs/FORMAT.md`, survives serialize/parse; `puzzleLevel` maps absent/unknown to hard.
6. **FR-6 / FR-12:** `findHint` uses only the puzzle's level's rules (tested both ways); hints for hard/unlabelled puzzles unchanged.
7. **NFR-1:** generation p95 at every level within budget (≤ 2.7 s at 30×30, ≤ 8.9 s at 40×40; 100×100 easy 23 s, medium 68 s, hard 233 s for `bench-0`).
8. **Docs:** 2 DECISIONS entries, PRD FR-3/FR-7/FR-12/§14 Q1, FORMAT, README, core AGENTS; `bench:generate`/`bench:clue-gaps` take `--level=`.
9. **FR-3 / FR-5:** `solve(…, { parity: false })` is sound (brute-force agreement with easy's rule set and with corners alone without parity) and refuses colouring or connectivity without parity (`RangeError`).

## Assumptions and open questions (resolved by assumption; the orchestrator may override)

1. **Three levels, hard = today.** No "expert": the only stronger solver measured (WT18 corner probes in `solve`) bought 0.2–0.4 points of density at 1.7–2.5× generation time. Adding one later appends to `LEVELS` and keeps `DEFAULT_LEVEL` = hard.
2. **Medium = parity + corners** (as in the roadmap example: "medium: + parity/corner-parity"). Corners + connectivity was measured (density 41.0% vs 41.5% before the floor; connectivity 1.6% of steps); "only ways across" reads as an advanced technique. Changing medium's groups later changes medium output only, but needs a `GENERATOR_VERSION` bump + new digests (the version covers every level).
3. **Floors 0.55 / 0.45** are a judgment from the measurements (easy 50% felt too close to medium; pre-WT15 puzzles at ~51–57% were "flat", which suits easy). They are one constant each in `LEVEL_SETTINGS`.
4. **`meta.level` omitted at hard** (preferred by the brief: byte-identical, no bump). Alternative: always write it (bump to "7", new goldens, old stored v6 puzzles would still lack it, so `puzzleLevel`'s fallback is needed either way).
5. **Tiny-board fallback** instead of throwing: `generate({1×1, easy})` returns the hard puzzle with no `meta.level`. WT21 should store the level from `meta`, not from the request.
6. **Parity is an option, not a rule group** (plan review 1). A new `RULE_GROUPS` entry would change what `rules: []` means and the clue-gap goldens (`SOLVED_WITHOUT_GROUPS`); `SolveOptions.parity` is the smaller change. Colouring needs parity, so the combination throws instead of silently doing less.
7. **WT21 handoff:** the server's `puzzles.level` integer column holds 1 for every existing puzzle, which is hard; WT21 maps names to numbers (or migrates) without turning those rows into easy, rebuilds `meta.level` from the stored level when loading a puzzle (otherwise `HintManager` keeps hard's rules for easy puzzles), takes the level from `puzzleLevel(result.puzzle)` (the fallback), never from a submitted puzzle's `meta` (editor puzzles are hard), and adds the generate-request field, daily level per size, leaderboard buckets, Home/Play display, `gen:api`, PRD FR-29/§4/§14 serving text. `run-task.ts` should pass `level` to `generate` and store `meta.level`; `HintManager` already gets level-aware hints once the stored puzzle carries `meta.level`.
