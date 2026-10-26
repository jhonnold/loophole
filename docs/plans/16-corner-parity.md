# WT16 `corner-parity` — implementation plan

Branch `feat/corner-parity`, worktree `/home/jhonnold/projects/loophole-wt/corner-parity` (at `main` with WT13 windy loops, WT14 clue-gap harness, WT15 clue removal). PRD: FR-3 (named deductions, recorded per step), FR-4/FR-5 (verifier correct, agreement with brute force), FR-6/FR-12 (steps power hints: cells highlighted, rule explained), FR-10 (deterministic generation per version), NFR-1 (verification must not get slower), NFR-3 (unit and property tests). Roadmap: WT16 row, "Each rules WT", "Per-rule plumbing" and Decisions in `~/.claude/plans/read-through-the-prd-noble-squirrel.md` (difficulty = clue count + allowed rule set, so new rules sit behind a rule-set option).

## Goal

Add sound human "corner" reasoning to the engine, so fewer deductions fall back to lookahead and hints name the rules people use:

1. **Corner masks.** For every corner of a 1, 2 or 3 (the two sides of the cell that meet at one dot) the engine keeps a 4-bit mask of which of the four (h, v) state pairs are still possible. "Odd" (exactly one is a line: the loop passes through the corner) and "even" (both or neither) are masks; so are "not both" (a 1) and "not neither" (a 3). This is the edge-pair parity relation of the roadmap, made a little stronger (it also keeps "at most one" / "at least one"), stored per corner rather than in a union-find.
2. **Two local rules on a worklist** (a new tier between the 3s patterns and parity): at a clue cell, enumerate the side sets with the clue's number of lines that fit the edges and the four masks; at a dot, enumerate the line sets (none or two) that fit the edges and the up-to-four masks of the clue cells around it. Each narrows masks to what survives and decides any edge that is the same in all survivors. Together they cover every pattern on the list: line into a 1's corner, line into a 3's corner, 2s passing the corner state on (diagonal 2-chains, 3-2-…-3, 3-2-…-1), 1-1 on the border, 3 diagonal to a 1, 2 in a corner, and more.
3. **Seven new rule ids** with titles, one-sentence texts and web patterns. A corner step records the clue cells and dots its reason rests on (tracked while steps are recorded), and a small classifier names it.
4. **Rule-set option.** `solve(puzzle, { rules })` with `RULE_GROUPS = ["corners"]`; default every group. `verify` and `generate` keep using every rule. Agreement and soundness tests run with the default and with the corners group off.
5. `GENERATOR_VERSION` "3" → "4" and goldens; `bench:clue-gaps --rules=… --no-lookahead`; a small engine fast path (no hint arrays built while steps are not recorded); DECISIONS entries with the numbers.

Out of scope: lookahead probes running the corner rules (WT18), parity ↔ corner coupling and incremental parity (WT17/WT19; measured below), difficulty levels (WT20–21), PRD FR-3 text (WT20 per roadmap).

## Measured (this machine, 16 cores, Bun 1.3.13; the code in this plan unless marked "prototype")

All "before" numbers are `main` at 38068b5 run from a copy of `packages/core` (same seeds, same commands).

### `bench:clue-gaps` (every rule), before → after

| Size | clues | gap | needed | unknown | solver floor | verifier floor | time |
|---|---|---|---|---|---|---|---|
| 5×5 (100) | 41.3% → 41.2% | 1.2% → 0.7% | 98.8% → 99.3% | 0 → 0 | 41.3% → 41.2% | 40.9% → 41.0% | 0.8 → 1.0 s |
| 7×7 (100) | 40.3% → 40.1% | 2.4% → 1.2% | 97.6% → 98.8% | 0 → 0 | 40.3% → 40.1% | 39.6% → 39.6% | 3.2 → 3.1 s |
| 10×10 (50) | 40.2% → 40.1% | 5.0% → 4.0% | 94.3% → 95.8% | 15 → 5 | 40.2% → 40.1% | 38.8% (31 unknown) → 38.9% (5) | 15.1 → 9.2 s |
| 15×15 (10) | 39.2% → 39.2% | 1.8% → 2.5% | 88.4% → 91.4% | 86 → 54 | 39.2% → 39.2% | 38.5% (98) → 38.4% (53) | 34.6 → 28.2 s |
| 20×20 (10) | 41.7% → 41.5% | 2.8% → 3.1% | 75.6% → 87.3% | 359 → 159 | 41.7% → 41.5% | – | 109 → 73 s |

`removable` and `restored` stay 0.0% everywhere (generation is still exact; see "Monotonicity"). Generated density barely moves: lookahead already found what the corner rules find, so the corner rules shorten the reasoning rather than remove clues. Fewer `unknown`s because the rules at each search node are stronger, so the same 10 000-node budget runs out less often.

### Solver floor from the full clue set (new `--rules=` / `--no-lookahead` flags)

| Size | no lookahead, corners off (= main) | no lookahead, corners on | lookahead, corners off (= main) | lookahead, corners on |
|---|---|---|---|---|
| 5×5 | 45.9% | **44.5%** | 42.4% | 42.1% |
| 7×7 | 44.7% | **43.7%** | 41.3% | 41.2% |
| 10×10 | 43.7% | **43.4%** | 41.5% | 41.3% |
| 15×15 | 42.8% | **41.8%** | 39.7% | 39.9% |
| 20×20 | 44.8% | **44.1%** | 42.9% | 43.2% |

Commands: `bun run --cwd packages/core bench:clue-gaps --no-lookahead --rules=` / `--no-lookahead` / `--rules=` / `--rules=corners`. The corners-off columns reproduce main exactly (cross-checked with a scratch script on the main copy). The no-lookahead floor drops 0.3–1.4 points (WT14/15 baseline "about 44–46%"); with lookahead the floor is unchanged within the noise of one greedy order.

### Clue-gap corpus (`clue-gaps.test.ts` `SOLVED`)

3 → **23** of 36 solved (corners off: the same 3 as before). Without lookahead: 0 → 4 (`clue-gaps-5-41#4`, `clue-gaps-5-44#16`, `clue-gaps-5-81#1`, `clue-gaps-10-4#35`).

### Hint steps on generated puzzles (`solve` from an empty board, seeds `bench-<n>`)

| Size | steps/puzzle | `lookahead` share | corner rules share |
|---|---|---|---|
| 10×10 (20) | 185 → 178 | 13.9% → **6.8%** | 9.7% (two-passes-on 5.8, line-into-1 1.7, line-into-3 0.9, ones-side-by-side 0.6, corner-chain 0.5, two-in-corner 0.1, three-diagonal-one 0.1) |
| 20×20 (10) | 704 → 679 | 14.9% → **7.2%** | 9.7% |
| 40×40 (3) | 2691 → 2587 | 14.1% → **6.3%** | 10.2% |

The `corner-chain` fallback is about 0.5% of all steps (5% of corner steps).

### Verification speed

`bench` (verify), median of three alternating runs each (ms; the bench prints one decimal):

| Case | before median (p95) | after median (p95) |
|---|---|---|
| 10×10 full | 0.1 (0.3) | 0.1 (0.3) |
| 30×30 full | 0.3 (0.4–0.5) | 0.3 (0.4–0.5) |
| 100×100 full | 2.5–2.7 (3.1–4.6) | **2.1–2.3** (2.6–3.6) |
| 10×10 70% | 0.1 (0.3) | 0.1 (0.3–0.4) |
| 30×30 70% | 0.4 (0.7) | 0.5–0.6 (0.8–1.1), see below |
| 100×100 70% | 16.3–17.7 (19.7–26.0) | **14.0–14.5** (22.3–30.6) |
| 10×10 minimal | 0.3 (0.6–0.7) | 0.2–0.3 (0.4–0.7) |
| 30×30 minimal | 5.6–5.8 (6.1–8.2) | **4.1–4.8** (4.6–6.9) |

The 30×30 70% line is the first case in the bench where the new corner code runs a lot, so it pays the code's warm-up (JIT) once: with a warm-up pass over the 70% cases first (scratch copy of the bench), the second pass reads 0.3–0.4 before and 0.3 after. Steady-state, paired A/B (both engines in one process, alternating, median of 40 rounds of the whole set; same-engine A/A spread ±2%):

| Set | after / before |
|---|---|
| blob loops, all clues: 10×10 (50), 30×30 (20), 100×100 (5) | 0.91, 0.98, 0.89 |
| blob loops, 70% of clues: 10×10, 30×30, 100×100 | 0.98, 1.02–1.05, 0.85–0.88 |
| empty 8×8 boards (30; 1950 search nodes, no clues) | 1.05–1.07 |
| windy 8×8 at 60% of clues (30), 12×12 at 65% (10) | 0.77–0.79, 0.57–0.62 |
| clue-gap corpus (36; search nodes 669 → 108) | **0.49** |
| generated v3 20×20 (10), 40×40 (3) (lookahead probes 21 019 → 9 897, 63 881 → 30 546) | **0.57**, **0.49–0.51** |

So verification is about twice as fast on the puzzles it exists for (unique, sparse), and within a few percent elsewhere. Boards with no clues pay ~5% per search node (the corner trail and queue checks in `undo` and `propagate`; the rules themselves never run); that is an empty editor draft, about 0.14 ms for 8×8. The fast path of step 1 (not building hint arrays when no steps are recorded) is part of these numbers: alone, on main, it is worth about 2–5% (empty 8×8 0.96–0.99, 30×30 70% 0.95).

### `bench:generate --quick`, before → after

| Size | p95 | median | clues |
|---|---|---|---|
| 7×7 | 15 → 14 ms | 6 → 8 ms | 40.1% → 40.0% |
| 10×10 | 35 → 43 ms | 23 → 25 ms | 40.3% → 40.3% |
| 20×20 | 558 → 463 ms | 340 → 364 ms | 40.5% → 40.2% |
| 30×30 | 2.7 → 2.4 s | 2.0 → 1.9 s | 40.9% → 40.5% |
| 40×40 | 9.8 → 6.6 s | 6.3 → 5.2 s | 41.2% → 41.0% |

Every result verified `unique`, first attempt 100%, restored 0.0%. (The "after" lines ran next to two 100×100 generations, so they are slightly pessimistic.) 100×100 seed `bench-0` (scratch, both engines side by side): generation 340 → 254 s, clues 41.6% → 41.3%, nothing restored, `verify` of the result 1.4 → 0.7 s, hint trace 15 929 → 15 395 steps with 14.5% → 6.5% lookahead (WT15 measured 327–359 s for this seed).

### Monotonicity (generation's exactness depends on it; WT15 DECISIONS)

Removal tests start from block bases, which is exact only if solving from a sound partial board ends where solving from scratch does. Checked in scratch: generated puzzles (seeds `mono-<size>-<n>`) with 0–2 random clues dropped, solved from scratch, then from 10 random subsets (0–60%) of the edges that solve decided: **0 differences in 9 800 solves** (7×7, 10×10, 15×15: 300 boards each with every rule, with corners off, and without lookahead; 20×20 and 30×30: 40 boards with every rule and without lookahead).

A first version broke this, and the plan's design comes from that: it skipped dots whose clue corners still had their default masks and clue cells whose masks were unnarrowed, on the idea that such a rule only repeats tier 1. But the enumeration also narrows masks from edges (a dot with one line in and one crossed edge tells a 2 beside it that its corner is odd, which the 2 cannot see from its own sides), so which cells got that information depended on the order deductions came in. Result: at 20×20 the generated puzzles kept 6.2% removable clues and the restore safeguard put back 0.6% of cells; 15 of 3000 partial solves of one 10×10 board got stuck where scratch solved. Fixed by running the cell rule at every 1, 2 and 3 whose side changed and the dot rule at every dot at a corner of a 1, 2 or 3; the cost is in the numbers above.

### Alternatives measured (prototype) and not taken

| Variant | Result |
|---|---|
| Corner tier inside tier 1 (run with the clue and dot rules) | Changes the order of existing named steps and runs the enumerations inside every lookahead probe; the separate tier keeps steps easiest first and leaves probes to WT18. |
| Union-find with parity over edges | Pair parities at a dot are colour relations between two diagonal cells, which the cell-parity union-find already holds; what it lacks is the non-linear part (a 1 never has both sides at a corner, a 3 never neither, a dot never 4 lines), which the 4-bit mask keeps. |
| Bridge parity → corners (restrict a corner to even/odd when the two cells beside it are in one parity set) and corners → parity (union the two cells when a mask is even/odd) | Prototype before the monotonicity fix: corpus 17 → 23–28, no-lookahead floor 0.2–0.5 points lower, but an O(clue cells) loop in every parity pass: verify +12–19% on generated 20×20/40×40 against corners alone, and corner-derived unions make `parity` steps cite edges they did not use. With the fix, corners alone reach 23. Left for WT17 (clue colouring feeds that union-find) or WT19 (incremental parity makes the loop cheap). |
| Corners only at the verifier's root, not in its search | Corpus 0.59 → 0.63 of main's time (search nodes 66 → 321); multi-solution search boards about 5% faster. Kept in the search. |
| Eager allocation, queueing from `set`, all dots queued initially | 100×100 full verify +35%, 30×30 70% +10–14%. Replaced by lazy allocation on the first corner pass, queueing from the edge trail, and visiting only corner dots. |

## What was found (for the DECISIONS entries)

**Why per-corner masks and not a union-find over edges.** Every degree-0-or-2 constraint at a dot and every clue's parity is linear over GF(2) in the cell colours (inside/outside), and an edge-pair parity at a corner is the colour relation of the two cells diagonal across it; the existing parity tier already holds the colour relations that known edges give. What the named corner patterns add is non-linear: a 1 never uses both sides of a corner, a 3 never neither, a dot never has four lines. A mask of four possible pairs per clue corner carries parity (even = {00, 11}, odd = {01, 10}) together with those exclusions, and two exact local enumerations (clue cell, dot) propagate it. Every narrowing holds in every solution, so the rules are sound by construction; the brute-force agreement tests confirm it.

**What a corner step highlights and how it is named.** Masks change silently; only edges make steps. While steps are recorded, each narrowed mask keeps the clue cells and dots whose rules narrowed it, transitively (a mask that ruled out a candidate adds its own reason). A step's cells and dots are that set for the masks it used, plus its own site. The id comes from the clue cells in that set (`classifyCorners`): any 2 → "A 2 passes it on" (or "2 in a corner" when the reason is one 2 in a board corner cell with only border dots); one 1 → "Line into a 1's corner"; one 3 → "Line into a 3's corner"; two 1s sharing a side whose crossing is the step → "1s side by side"; a 1 and a 3 diagonal with the corner between them odd → "3 diagonal to a 1"; anything else → "Corners pass along". The texts state the principle the highlighted clues show, in at most 115 characters so the hint card fits.

## Design

### Corner masks

- A corner of a clue cell is the pair (h, v) of its sides at one dot: h the top or bottom side, v the left or right side. Corner j: 0 top-left (top, left), 1 top-right (top, right), 2 bottom-right (bottom, right), 3 bottom-left (bottom, left). Its mask has bit `h * 2 + v` set while that pair of states (1 = line) is possible: `ANY_PAIR = 0b1111`, a 1 starts at `0b0111` (never both), a 3 at `0b1110` (never neither), a 2 at `0b1111`. `ODD = 0b0110`.
- Corner j of a cell sits in quadrant `(j + 2) % 4` of its dot, quadrants numbered like `dotCells` (0 up-left, 1 up-right, 2 down-right, 3 down-left). In dot terms (slots of `dotEdges`: 0 up, 1 right, 2 down, 3 left), quadrant q's (h, v) is 0 (left, up), 1 (right, up), 2 (right, down), 3 (left, down).
- Storage: `corners: Uint8Array(cellCount * 4)`, 0 for cells without a 1, 2 or 3. Changes are trailed as (corner, old mask) pairs on `cornerTrail`; `Mark` gains `corners`, `undo` restores them. All corner arrays are allocated on the first corner pass (`initCorners`), so puzzles that tier 1 finishes (every full-clue bench puzzle) pay nothing.

### Rules (exact enumeration, sound by construction)

- `cornerCell(i)`: side sets of size `clues[i]` (`CELL_CONFIGS`) that fit the cell's known sides and all four masks. None → contradiction. New masks = old ∩ the pairs the survivors show; a side in every survivor is a line, in none a cross.
- `cornerDot(d)`: line sets with 0 or 2 of the dot's present edges (`DOT_CONFIGS`) that fit its known edges and the masks of the clue corners in its quadrants. Same narrowing and deciding.
- Both return early when all their edges are known (the other side of each pair then sees the edges directly). Nothing else is skipped (see "Monotonicity").

### Tier placement and worklist

- New tier 3 between the 3s patterns and parity, in `propagate`: after `local()` reaches its fixpoint (and the loop is not closed), `cornerPass()`; 1 → back to tier 1; 0 → parity; -1 → contradiction. Lookahead probes still run tier 1 only (WT18 changes that).
- `cornerPass`: (1) queue the two dots (if corner dots) and two cells (if clue cells 1–3) of every edge added to the trail since the last pass (`cornerSeen`); (2) on the first pass, visit every corner dot in index order (`cornerScan`); (3) drain the queue. A rule that only narrows masks queues the dot of each narrowed corner (cell rule) or the cell (dot rule) and goes on; a rule that sets edges records one step and the pass returns 1. On -1 the queue is cleared. `undo` clears the queue and clamps `cornerSeen` to the mark's trail length.
- Steps: `cornerStep(changes, why)`; `why` is undefined unless steps are recorded, so the verifier's search and the generator's tests (which record but discard) differ only in the provenance work, which is O(reason size) per narrowing.

### Rule-set option

- `rules.ts`: `RULE_GROUPS = ["corners"] as const`, `RuleGroup`, `GROUP_RULES` (group → its rule ids).
- `SolveOptions.rules?: readonly RuleGroup[]`, default `RULE_GROUPS`. `solve` passes `rules.includes("corners")` to `new Engine(puzzle, budget, cornersOn)` (third constructor parameter, default `true`).
- `verify` keeps every rule (it is faster with them). `generate`'s `RuleSolver` seam (`ALL_RULES`) is unchanged: `solve(puzzle, { initial })` uses every group; WT20 passes `{ rules }` there.
- `lookahead?: boolean` stays a separate option (WT20 may fold it into the groups).

### Files

| File | Change |
|---|---|
| `packages/core/src/rules.ts` | 7 rule ids, texts, titles; `RULE_GROUPS`, `RuleGroup`, `GROUP_RULES` |
| `packages/core/src/solver.ts` | `rules` option |
| `packages/core/src/engine.ts` | corner tier (masks, trail, worklist, two rules, provenance, classifier); `recording()` fast path; tier numbering in comments |
| `packages/core/src/generate.ts` | `GENERATOR_VERSION` "4" |
| `packages/core/src/solver.test.ts` | per-rule cases (7 new, 2 moved), rule-group test, two fixtures replaced |
| `packages/core/src/verify.test.ts` | one fixture replaced (the old one is now solved by the rules) |
| `packages/core/src/agreement.test.ts` | every check with both rule sets |
| `packages/core/src/clue-gaps.test.ts` | `SOLVED` (23), `SOLVED_WITHOUT_CORNERS` (3), fast-check from partial boards |
| `packages/core/src/rules.test.ts` | text length cap; group sanity |
| `packages/core/src/generate.test.ts` | goldens for "4" |
| `packages/core/bench/clue-gaps.ts` | `--rules=`, `--no-lookahead` |
| `apps/web/src/lib/game/patterns.ts` | 7 patterns |
| `apps/web/tests/hint.e2e.ts` | `RULES` list for small-7 (not in the gate; run it once) |
| `openapi.yaml`, `packages/api-client/src/schema.ts` | `bun run gen:api` (rule enum) |
| `packages/core/AGENTS.md`, `README.md`, `docs/DECISIONS.md` | docs |

`hint.ts`, `verify.ts`, `index.ts`, the server and the rest of the web app do not change (`RULE_GROUPS`, `RuleGroup` and `GROUP_RULES` are exported through `rules.ts` automatically).

## Rules for the implementer

- Mode EXECUTE; follow the steps in order; the code blocks are exact (they were run: `bun run check` passed with them). Run `bun run format` after editing, then the step's checks.
- Bun lives in `~/.bun/bin`: prefix commands with `export PATH="$HOME/.bun/bin:$PATH";`. Run `bun install --frozen-lockfile` first.
- Do not clone the repo (`/tmp` is a 16 GB tmpfs shared with other worktrees); scratch scripts go in your scratchpad, not in the worktree.
- Commit at the four boundaries given (conventional commits). `bun run check` must pass at each.
- If a number in a test differs from this plan, stop and find out why before changing the test: the expected values come from this exact code.

## Step 1 — Fast path: build hint arrays only while steps are recorded

`perf(core): build a step's cells and dots only while steps are recorded`

In `packages/core/src/engine.ts`:

1.1 Add this method right above `/** Sets an edge on behalf of a rule, recording it in the current step. */` (in the helpers section):

```ts
  /**
   * True while steps are recorded. Otherwise clears the pending step, so callers skip building a
   * step's cells and dots when nobody reads them (lookahead probes, the verifier's search).
   */
  private recording(): boolean {
    if (this.steps !== null) return true;
    this.pending = null;
    return false;
  }

```

1.2 Five exact replacements (each `old` occurs once), then one in `parity()`:

| old | new |
|---|---|
| `        this.begin("loop-complete", [], []);` | `        if (this.recording()) this.begin("loop-complete", [], []);` |
| `    this.begin(rule, [i], []);` (in `fillCell`) | `    if (this.recording()) this.begin(rule, [i], []);` |
| `    this.begin(k === 3 ? "corner-3" : "corner-1", [i], [d]);` | `    if (this.recording()) this.begin(k === 3 ? "corner-3" : "corner-1", [i], [d]);` |
| `      this.begin("premature-loop", [], [d, m]);` | `      if (this.recording()) this.begin("premature-loop", [], [d, m]);` |
| `    this.begin(rule, [], [d]);` (in `fillDot`) | `    if (this.recording()) this.begin(rule, [], [d]);` |

and in `parity()` replace

```ts
      const cells = [na, nb].filter((n) => n !== C);
      this.begin("parity", cells, []);
```

with

```ts
      if (this.recording()) {
        this.begin(
          "parity",
          [na, nb].filter((n) => n !== C),
          [],
        );
      }
```

Leave `applyPatterns` and `lookahead` alone (their arrays already exist or are rare). `assign` already records nothing when `pending` is null, and `commit` drops a step without `pending`, so behaviour is unchanged.

Verify: `bun run check` (no test changes). Commit.

## Step 2 — Corner rules, rule groups, tests, goldens, web patterns

`feat(core): corner rules as an optional rule group, with hints`

### 2.1 `packages/core/src/rules.ts`

In `RULE_IDS`, between `"loop-complete",` and `"parity",` insert:

```ts
  "line-into-1",
  "line-into-3",
  "two-passes-on",
  "two-in-corner",
  "ones-side-by-side",
  "three-diagonal-one",
  "corner-chain",
```

After `export type RuleId = (typeof RULE_IDS)[number];` insert:

```ts
/**
 * Groups of rules that `solve` can leave out (`SolveOptions.rules`), so a difficulty level can use
 * a smaller set. The rules outside every group always run; lookahead has its own option.
 */
export const RULE_GROUPS = ["corners"] as const;

export type RuleGroup = (typeof RULE_GROUPS)[number];

/** The rule ids each group's steps carry. */
export const GROUP_RULES: Readonly<Record<RuleGroup, readonly RuleId[]>> = {
  corners: [
    "line-into-1",
    "line-into-3",
    "two-passes-on",
    "two-in-corner",
    "ones-side-by-side",
    "three-diagonal-one",
    "corner-chain",
  ],
};

```

In `RULE_TEXT`, after the `"loop-complete"` entry insert:

```ts
  "line-into-1":
    "The 1's one line is at this corner, so the loop comes in from outside there and the 1's other sides are crossed.",
  "line-into-3":
    "The loop passes through this corner of the 3, so it comes in from outside there and the 3's far sides are lines.",
  "two-passes-on":
    "The loop passes through both or neither of two opposite corners of a 2, so what holds at one carries across.",
  "two-in-corner":
    "A 2 in the board's corner has both sides there or neither, so either way the loop leaves it along the border.",
  "ones-side-by-side":
    "The loop can't go straight on past the 1s' shared side, so a line there would give a 1 two lines: it is crossed.",
  "three-diagonal-one":
    "The loop passes through the corner the 3 and the 1 share, so the 3's far sides are lines, the 1's crossed.",
  "corner-chain":
    "Working out which corners of the highlighted clues the loop passes through leaves one way for this edge.",
```

In `RULE_TITLE`, after `"loop-complete": "Loop complete",` insert:

```ts
  "line-into-1": "Line into a 1's corner",
  "line-into-3": "Line into a 3's corner",
  "two-passes-on": "A 2 passes it on",
  "two-in-corner": "2 in a corner",
  "ones-side-by-side": "1s side by side",
  "three-diagonal-one": "3 diagonal to a 1",
  "corner-chain": "Corners pass along",
```

### 2.2 `packages/core/src/solver.ts`

Replace `import type { Step } from "./rules.ts";` with `import { RULE_GROUPS, type RuleGroup, type Step } from "./rules.ts";`. After the `lookahead` option in `SolveOptions` insert:

```ts
  /**
   * Rule groups to use on top of the rules that always run (`RULE_GROUPS`). Default all of them.
   * A difficulty level can leave groups out; deductions are sound either way.
   */
  readonly rules?: readonly RuleGroup[];
```

Replace `  const engine = new Engine(puzzle, budget);` with:

```ts
  const rules = options.rules ?? RULE_GROUPS;
  const engine = new Engine(puzzle, budget, rules.includes("corners"));
```

### 2.3 `packages/core/src/engine.ts`

(a) In the file comment, replace the tier list (from ` * Rules come in tiers, cheapest first:` up to the line before ` */`) with:

```ts
 * Rules come in tiers, cheapest first:
 * 1. local rules on a worklist of cells and dots: clue rules, corner rules, dot degree,
 *    premature loop, loop complete
 * 2. the 3s patterns, which depend only on the clues and are applied once
 * 3. corners (optional): for every corner of a 1, 2 or 3, which pairs of states its two sides
 *    there can still take, narrowed at the clue and at the dot in turn (a worklist)
 * 4. inside/outside parity, a union-find over cells (global), then a connectivity check that
 *    only detects contradictions (global)
 * 5. lookahead: assume an edge, run tier 1, and take the opposite on a contradiction
 * After any change the engine goes back to tier 1, so steps come out roughly easiest first.
```

(b) Replace the `Mark` interface with the following (it adds `corners` and the corner constants after it):

```ts
export interface Mark {
  readonly edges: number;
  readonly ends: number;
  readonly corners: number;
  readonly closed: boolean;
}

/*
 * Corners (tier 3). A corner of a clue cell is the pair of its sides that meet at one dot: the
 * horizontal side h and the vertical side v. Its mask has bit `h * 2 + v` set while that pair of
 * states (1 = line, 0 = not) is still possible. "The loop passes through the corner" means
 * exactly one of the two is a line (mask within ODD). Corners are numbered 0 top-left,
 * 1 top-right, 2 bottom-right, 3 bottom-left; corner j of a cell is in quadrant (j + 2) % 4 of its
 * dot, where quadrants are numbered like `dotCells`.
 */
/** Every pair of states still possible. */
const ANY_PAIR = 0b1111;
/** A 1 never has both sides at a corner, a 3 never has neither. */
const ONE_PAIRS = 0b0111;
const THREE_PAIRS = 0b1110;
/** Exactly one of the two is a line. */
const ODD = 0b0110;
/** Line sets of a clue cell's sides (bit 0 top, 1 right, 2 bottom, 3 left), by size. */
const CELL_CONFIGS: number[][] = [[], [], [], [], []];
for (let m = 0; m < 16; m++)
  CELL_CONFIGS[(m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + (m >> 3)].push(m);
/** Line sets at a dot (bit j = `dotEdges` slot j: up, right, down, left): no line or two. */
const DOT_CONFIGS = [0b0000, 0b0011, 0b0101, 0b0110, 0b1001, 0b1010, 0b1100];

```

(c) Replace

```ts
  private lookCursor = 0;

  constructor(
    puzzle: Puzzle,
    private readonly budget: Budget,
  ) {
```

with

```ts
  private lookCursor = 0;
  /**
   * Corner masks, 4 per cell; 0 for cells without a 1, 2 or 3. These and the other corner arrays
   * are allocated on the first corner pass, so a puzzle the first tier finishes pays nothing.
   */
  private corners = new Uint8Array(0);
  /** Pairs (corner, old mask), so undo can restore masks. */
  private readonly cornerTrail: number[] = [];
  /** Dots at a corner of a 1, 2 or 3: the only ones the corner rules look at. */
  private cornerDots = new Uint8Array(0);
  private cornerQueue = new Int32Array(0);
  private inCornerQueue = new Uint8Array(0);
  private cqHead = 0;
  private cqLen = 0;
  /** The first corner pass visits every corner dot: the next one, or -1 before the pass starts. */
  private cornerScan = -1;
  /** Edges on the trail before this position have had their dots and cells queued for corners. */
  private cornerSeen = 0;
  /**
   * While steps are recorded: for each narrowed corner, the clue cells and dots (cellCount + dot)
   * whose rules narrowed it, directly or through other corners. A hint highlights them.
   */
  private readonly cornerWhy: (readonly number[] | undefined)[] = [];

  constructor(
    puzzle: Puzzle,
    private readonly budget: Budget,
    /** Run the corner rules (rule group "corners"). */
    private readonly cornersOn = true,
  ) {
```

(d) Replace the `propagate` doc comment and method with:

```ts
  /**
   * Tiers 1, 3 (when the corners group is on), 4 and (optionally) 5 until nothing changes. False on
   * a contradiction. Checks the time budget on every pass, since each parity pass costs O(edges).
   */
  propagate(lookahead: boolean): boolean {
    for (;;) {
      this.budget.tick();
      if (!this.local()) return false;
      if (this.closed) return true;
      if (this.cornersOn) {
        const c = this.cornerPass();
        if (c < 0) return false;
        if (c > 0) continue;
      }
      const p = this.parity();
      if (p < 0) return false;
      if (p > 0) continue;
      if (!this.connected()) return false;
      if (!lookahead) return true;
      const q = this.lookahead();
      if (q < 0) return false;
      if (q > 0) continue;
      return true;
    }
  }

```

(e) Replace `mark()` and the first lines of `undo()`:

```ts
  mark(): Mark {
    return { edges: this.edgeTrail.length, ends: this.endTrail.length, closed: this.closed };
  }

  undo(m: Mark): void {
    const { edges, mate, plen, edgeTrail, endTrail } = this;
```

with

```ts
  mark(): Mark {
    return {
      edges: this.edgeTrail.length,
      ends: this.endTrail.length,
      corners: this.cornerTrail.length,
      closed: this.closed,
    };
  }

  undo(m: Mark): void {
    const { edges, mate, plen, edgeTrail, endTrail, corners, cornerTrail } = this;
    while (cornerTrail.length > m.corners) {
      const old = cornerTrail.pop() as number;
      corners[cornerTrail.pop() as number] = old;
    }
```

and at the end of `undo` replace

```ts
    this.clearQueue();
    this.conflict = NONE;
```

with

```ts
    this.clearQueue();
    while (this.cqLen > 0) this.dequeueCorner();
    if (this.cornerSeen > m.edges) this.cornerSeen = m.edges;
    this.conflict = NONE;
```

(f) Replace the line `  // --- tier 3: inside/outside parity ----…` with the whole corner section below followed by `  // --- tier 4: inside/outside parity --------------------------------------------------------`, and rename `  // --- tier 4: lookahead ----…` to `  // --- tier 5: lookahead --------------------------------------------------------------------`:

```ts
  // --- tier 3: corners ----------------------------------------------------------------------

  /**
   * Runs the corner rules: first at every dot at a corner of a 1, 2 or 3, then at the clue cells
   * and dots whose edges or corner masks changed since. Narrowing a mask is silent; a rule that
   * sets edges records one step and returns 1, so the cheaper rules run again before the next one.
   * Returns 0 when nothing is left to do, -1 on a contradiction.
   */
  private cornerPass(): number {
    if (this.cornerScan < 0) this.initCorners();
    const { grid, edgeTrail } = this;
    const C = grid.cellCount;
    for (let p = this.cornerSeen; p < edgeTrail.length; p++) {
      const e = edgeTrail[p];
      this.queueCornerDot(grid.edgeDots[e * 2]);
      this.queueCornerDot(grid.edgeDots[e * 2 + 1]);
      this.queueCornerCell(grid.edgeCells[e * 2]);
      this.queueCornerCell(grid.edgeCells[e * 2 + 1]);
    }
    this.cornerSeen = edgeTrail.length;
    while (this.cornerScan < grid.dotCount) {
      const d = this.cornerScan++;
      if (!this.cornerDots[d]) continue;
      const r = this.cornerDot(d);
      if (r !== 0) return r;
    }
    while (this.cqLen > 0) {
      const x = this.dequeueCorner();
      const r = x < C ? this.cornerCell(x) : this.cornerDot(x - C);
      if (r < 0) while (this.cqLen > 0) this.dequeueCorner();
      if (r !== 0) return r;
    }
    return 0;
  }

  private initCorners(): void {
    const { grid, clues } = this;
    const items = grid.cellCount + grid.dotCount;
    this.corners = new Uint8Array(grid.cellCount * 4);
    this.cornerDots = new Uint8Array(grid.dotCount);
    this.cornerQueue = new Int32Array(items);
    this.inCornerQueue = new Uint8Array(items);
    for (let i = 0; i < grid.cellCount; i++) {
      const k = clues[i];
      if (k < 1 || k > 3) continue;
      const mask = k === 1 ? ONE_PAIRS : k === 3 ? THREE_PAIRS : ANY_PAIR;
      for (let j = 0; j < 4; j++) {
        this.corners[i * 4 + j] = mask;
        this.cornerDots[cornerDotOf(grid, i, j)] = 1;
      }
    }
    this.cornerScan = 0;
  }

  /**
   * Corner rule at a clue cell: of the side sets with exactly the clue's number of lines, keeps
   * those that fit the known edges and all four corner masks. Masks narrow to what those sets
   * allow; a side that is a line in all of them, or in none, is decided.
   */
  private cornerCell(i: number): number {
    const k = this.clues[i];
    const { edges, corners } = this;
    const { cellEdges } = this.grid;
    const base = i * 4;
    let lines = 0;
    let crosses = 0;
    for (let s = 0; s < 4; s++) {
      const st = edges[cellEdges[base + s]];
      if (st === Line) lines |= 1 << s;
      else if (st === Cross) crosses |= 1 << s;
    }
    if ((lines | crosses) === 0b1111) return 0;
    const c0 = corners[base];
    const c1 = corners[base + 1];
    const c2 = corners[base + 2];
    const c3 = corners[base + 3];
    let any = 0;
    let all = 0b1111;
    let n0 = 0;
    let n1 = 0;
    let n2 = 0;
    let n3 = 0;
    let used = 0;
    for (const m of CELL_CONFIGS[k]) {
      if ((m & lines) !== lines || (m & crosses) !== 0) continue;
      const t = m & 1;
      const r = (m >> 1) & 1;
      const b = (m >> 2) & 1;
      const l = m >> 3;
      const b0 = 1 << (t * 2 + l);
      const b1 = 1 << (t * 2 + r);
      const b2 = 1 << (b * 2 + r);
      const b3 = 1 << (b * 2 + l);
      // `used` notes the first mask that rules a set out, for the hint.
      if (!(c0 & b0)) used |= 1;
      else if (!(c1 & b1)) used |= 2;
      else if (!(c2 & b2)) used |= 4;
      else if (!(c3 & b3)) used |= 8;
      else {
        any |= m;
        all &= m;
        n0 |= b0;
        n1 |= b1;
        n2 |= b2;
        n3 |= b3;
      }
    }
    if (any === 0) return -1;
    const setLines = all & ~lines;
    const setCrosses = 0b1111 & ~any & ~crosses;
    const narrow = (c0 & n0) !== c0 || (c1 & n1) !== c1 || (c2 & n2) !== c2 || (c3 & n3) !== c3;
    if (!narrow && setLines === 0 && setCrosses === 0) return 0;
    const why = this.steps === null ? undefined : this.cornerReason(i, base, used);
    const nm = [c0 & n0, c1 & n1, c2 & n2, c3 & n3];
    for (let j = 0; j < 4; j++) {
      if (nm[j] === corners[base + j]) continue;
      this.narrow(base + j, nm[j], why);
      this.queueCornerDot(cornerDotOf(this.grid, i, j));
    }
    const changes: EdgeChange[] = [];
    for (let s = 0; s < 4; s++) {
      const e = cellEdges[base + s];
      if (setLines & (1 << s)) changes.push({ edge: e, state: Line });
      else if (setCrosses & (1 << s)) changes.push({ edge: e, state: Cross });
    }
    return this.cornerStep(changes, why);
  }

  /**
   * Corner rule at a dot: of the line sets a dot can have (none, or two of its edges), keeps those
   * that fit the known edges and the corner masks of the clue cells around it. Masks narrow to what
   * those sets allow; an edge that is a line in all of them, or in none, is decided.
   */
  private cornerDot(d: number): number {
    const { grid, edges, corners } = this;
    const db = d * 4;
    let present = 0;
    let lines = 0;
    let crosses = 0;
    for (let s = 0; s < 4; s++) {
      const e = grid.dotEdges[db + s];
      if (e === NONE) continue;
      present |= 1 << s;
      if (edges[e] === Line) lines |= 1 << s;
      else if (edges[e] === Cross) crosses |= 1 << s;
    }
    if ((lines | crosses) === present) return 0;
    const q0 = this.quadCorner(db, 0);
    const q1 = this.quadCorner(db, 1);
    const q2 = this.quadCorner(db, 2);
    const q3 = this.quadCorner(db, 3);
    const m0 = q0 < 0 ? ANY_PAIR : corners[q0];
    const m1 = q1 < 0 ? ANY_PAIR : corners[q1];
    const m2 = q2 < 0 ? ANY_PAIR : corners[q2];
    const m3 = q3 < 0 ? ANY_PAIR : corners[q3];
    let any = 0;
    let all = 0b1111;
    let n0 = 0;
    let n1 = 0;
    let n2 = 0;
    let n3 = 0;
    let used = 0;
    let count = 0;
    for (const m of DOT_CONFIGS) {
      if ((m & present) !== m || (m & lines) !== lines || (m & crosses) !== 0) continue;
      const up = m & 1;
      const right = (m >> 1) & 1;
      const down = (m >> 2) & 1;
      const left = m >> 3;
      // Quadrant q's corner as (h, v): 0 (left, up), 1 (right, up), 2 (right, down),
      // 3 (left, down).
      const b0 = 1 << (left * 2 + up);
      const b1 = 1 << (right * 2 + up);
      const b2 = 1 << (right * 2 + down);
      const b3 = 1 << (left * 2 + down);
      if (!(m0 & b0)) used |= 1;
      else if (!(m1 & b1)) used |= 2;
      else if (!(m2 & b2)) used |= 4;
      else if (!(m3 & b3)) used |= 8;
      else {
        count++;
        any |= m;
        all &= m;
        n0 |= b0;
        n1 |= b1;
        n2 |= b2;
        n3 |= b3;
      }
    }
    if (count === 0) return -1;
    const setLines = all & ~lines;
    const setCrosses = present & ~any & ~crosses;
    const qs = [q0, q1, q2, q3];
    const nm = [m0 & n0, m1 & n1, m2 & n2, m3 & n3];
    let narrow = false;
    for (let q = 0; q < 4; q++) if (qs[q] >= 0 && nm[q] !== corners[qs[q]]) narrow = true;
    if (!narrow && setLines === 0 && setCrosses === 0) return 0;
    let why: readonly number[] | undefined;
    if (this.steps !== null) {
      const from: number[] = [];
      for (let q = 0; q < 4; q++) if (used & (1 << q)) from.push(qs[q]);
      why = this.gather(grid.cellCount + d, from);
    }
    for (let q = 0; q < 4; q++) {
      const c = qs[q];
      if (c < 0 || nm[q] === corners[c]) continue;
      this.narrow(c, nm[q], why);
      this.queueCornerCell(c >> 2);
    }
    const changes: EdgeChange[] = [];
    for (let s = 0; s < 4; s++) {
      const e = grid.dotEdges[db + s];
      if (setLines & (1 << s)) changes.push({ edge: e, state: Line });
      else if (setCrosses & (1 << s)) changes.push({ edge: e, state: Cross });
    }
    return this.cornerStep(changes, why);
  }

  /** Sets `changes` as one step named by `classifyCorners`. 0 when there are none. */
  private cornerStep(changes: EdgeChange[], why: readonly number[] | undefined): number {
    if (changes.length === 0) return 0;
    if (why !== undefined) {
      const C = this.grid.cellCount;
      const cells = why.filter((x) => x < C);
      const dots = why.filter((x) => x >= C).map((x) => x - C);
      this.begin(
        classifyCorners(this.grid, this.clues, this.corners, cells, dots, changes),
        cells,
        dots,
      );
    } else this.pending = null;
    for (const { edge, state } of changes) if (!this.assign(edge, state)) return -1;
    this.commit();
    return 1;
  }

  /** The reason for a corner cell rule's result: the cell and the reasons of the masks it used. */
  private cornerReason(i: number, base: number, used: number): readonly number[] {
    const from: number[] = [];
    for (let j = 0; j < 4; j++) {
      // A mask still at the clue's default adds nothing; one narrowed elsewhere adds its reason.
      if (used & (1 << j) && this.cornerWhy[base + j] !== undefined) from.push(base + j);
    }
    return this.gather(i, from);
  }

  /** `own` and the reasons recorded for corners `from` (with their cells), sorted, no repeats. */
  private gather(own: number, from: readonly number[]): readonly number[] {
    const sites = new Set<number>([own]);
    for (const c of from) {
      sites.add(c >> 2);
      for (const x of this.cornerWhy[c] ?? []) sites.add(x);
    }
    return [...sites].sort((a, b) => a - b);
  }

  private narrow(c: number, mask: number, why: readonly number[] | undefined): void {
    this.cornerTrail.push(c, this.corners[c]);
    this.corners[c] = mask;
    if (why === undefined) return;
    const old = this.cornerWhy[c];
    this.cornerWhy[c] =
      old === undefined ? why : [...new Set([...old, ...why])].sort((a, b) => a - b);
  }

  /** The corner in quadrant `q` of the dot whose `dotCells` entries start at `db`, or -1. */
  private quadCorner(db: number, q: number): number {
    const c = this.dotCells[db + q];
    return c !== NONE && this.corners[c * 4] !== 0 ? c * 4 + ((q + 2) & 3) : -1;
  }

  /** Queues a cell for the corner rules if it has a 1, 2 or 3. */
  private queueCornerCell(i: number): void {
    if (i !== NONE && this.corners[i * 4] !== 0) this.enqueueCorner(i);
  }

  /** Queues a dot for the corner rules if it is a corner of a 1, 2 or 3. */
  private queueCornerDot(d: number): void {
    if (this.cornerDots[d]) this.enqueueCorner(this.grid.cellCount + d);
  }

  private enqueueCorner(x: number): void {
    if (this.inCornerQueue[x]) return;
    this.inCornerQueue[x] = 1;
    this.cornerQueue[(this.cqHead + this.cqLen) % this.cornerQueue.length] = x;
    this.cqLen++;
  }

  private dequeueCorner(): number {
    const x = this.cornerQueue[this.cqHead];
    this.cqHead = (this.cqHead + 1) % this.cornerQueue.length;
    this.cqLen--;
    this.inCornerQueue[x] = 0;
    return x;
  }

```

(g) After the module function `sideNode` insert:

```ts
/** The dot at corner `j` (0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left) of cell `i`. */
function cornerDotOf(grid: Grid, i: number, j: number): number {
  const side = grid.cellEdges[i * 4 + (j < 2 ? 0 : 2)];
  return grid.edgeDots[side * 2 + (j === 1 || j === 2 ? 1 : 0)];
}

/**
 * Names a corner step for its hint from the clue cells and dots it rests on (its reason) and the
 * edges it sets, checked in this order:
 * - a 2 among the clues: "two-in-corner" when the 2 is the only clue, sits in a corner cell of the
 *   board, and the reason holds that corner's dot and only dots on the board's edge; otherwise
 *   "two-passes-on"
 * - one clue, a 1 or a 3: "line-into-1" or "line-into-3"
 * - two 1s sharing a side, and the step only crosses that side: "ones-side-by-side"
 * - a 1 and a 3 touching at a corner the loop passes through: "three-diagonal-one"
 * - anything else: "corner-chain"
 */
function classifyCorners(
  grid: Grid,
  clues: Int8Array,
  corners: Uint8Array,
  cells: readonly number[],
  dots: readonly number[],
  changes: readonly EdgeChange[],
): RuleId {
  const W = grid.width;
  const H = grid.height;
  const count = (k: number) => cells.filter((c) => clues[c] === k).length;
  if (count(2) > 0) {
    if (cells.length !== 1) return "two-passes-on";
    const row = (d: number) => Math.floor(d / (W + 1));
    const col = (d: number) => d % (W + 1);
    const onBorder = (d: number) => row(d) % H === 0 || col(d) % W === 0;
    for (let j = 0; j < 4; j++) {
      const d = cornerDotOf(grid, cells[0], j);
      const boardCorner = row(d) % H === 0 && col(d) % W === 0;
      if (boardCorner && dots.includes(d) && dots.every(onBorder)) return "two-in-corner";
    }
    return "two-passes-on";
  }
  if (cells.length === 1) return clues[cells[0]] === 1 ? "line-into-1" : "line-into-3";
  if (cells.length === 2 && count(1) === 2 && changes.length === 1) {
    const [a, b] = cells;
    for (let j = 0; j < 4; j++) {
      const e = grid.cellEdges[a * 4 + j];
      if (
        e === changes[0].edge &&
        changes[0].state === Cross &&
        grid.cellEdges[b * 4 + ((j + 2) & 3)] === e
      ) {
        return "ones-side-by-side";
      }
    }
  }
  if (cells.length === 2 && count(1) === 1 && count(3) === 1) {
    const three = clues[cells[0]] === 3 ? cells[0] : cells[1];
    const one = three === cells[0] ? cells[1] : cells[0];
    const dr = Math.floor(one / W) - Math.floor(three / W);
    const dc = (one % W) - (three % W);
    if (Math.abs(dr) === 1 && Math.abs(dc) === 1) {
      // The 3's corner towards the 1.
      const j = dr < 0 ? (dc < 0 ? 0 : 1) : dc < 0 ? 3 : 2;
      if ((corners[three * 4 + j] & ~ODD) === 0) return "three-diagonal-one";
    }
  }
  return "corner-chain";
}

```

Notes on the code (no action):
- `cornerCell`/`cornerDot` record in `used` the first mask that rules each candidate out; only those masks' reasons join the step's reason. A cell's default (clue-only) mask adds nothing; at a dot, a quadrant's clue cell joins the reason when its mask ruled a candidate out.
- `cornerWhy` is written only while steps are recorded. Narrowing never happens inside a lookahead probe (probes run tier 1 only), so nothing in `cornerWhy` can outlive an undo. WT18, which runs corners in probes, must keep that true (probes run with `steps = null`, so `why` is undefined there).
- The classifier only names the step; soundness does not depend on it.

### 2.4 Tests (`packages/core/src`)

`solver.test.ts`:
- Import: `import { GROUP_RULES, RULE_GROUPS, RULE_IDS, type RuleId, type Step } from "./rules.ts";`
- In `cases`, replace the two `.331..` entries for `lookahead` (step 4) and `clue-satisfied` (step 7) with:

```ts
    [1, 3, "0..", 3, { rule: "lookahead", changes: "2:1", cells: [], dots: [4, 5] }],
    [2, 3, ".331..", 12, { rule: "clue-satisfied", changes: "3:2", cells: [3], dots: [] }],
```

  (the corner rules now find what lookahead found at step 4 of `.331..`: `line-into-1` there.)
- After the `loop-complete` case add:

```ts
    // Corner rules (WT16): for each, the smallest puzzle, then the fewest clues, where it fires.
    [
      1,
      4,
      "1.1.",
      5,
      { rule: "line-into-1", changes: "2:1 10:2 3:2 9:2", cells: [2], dots: [4, 5] },
    ],
    [2, 3, "3.11..", 2, { rule: "line-into-3", changes: "3:1", cells: [0], dots: [4] }],
    [
      2,
      2,
      "22..",
      0,
      { rule: "two-passes-on", changes: "1:1 7:2 0:1", cells: [0, 1], dots: [0, 1, 2] },
    ],
    [2, 2, "2.2.", 0, { rule: "two-in-corner", changes: "1:1", cells: [0], dots: [0, 1] }],
    [2, 4, "2.1.11..", 0, { rule: "ones-side-by-side", changes: "4:2", cells: [2, 4], dots: [6] }],
    [
      2,
      3,
      "3.21..",
      1,
      { rule: "three-diagonal-one", changes: "13:2 5:2", cells: [0, 3], dots: [4] },
    ],
    [1, 4, ".31.", 0, { rule: "corner-chain", changes: "7:1", cells: [1, 2], dots: [4] }],
```

- After the test `every rule id is covered above` add:

```ts
  test("leaving the corners group out drops its rules, and the default is every group", () => {
    const p = puzzle(1, 4, ".31.");
    const without = solve(p, { rules: [] });
    expect(without.status).toBe("solved");
    const corners = new Set<RuleId>(GROUP_RULES.corners);
    expect(without.steps.some((s) => corners.has(s.rule))).toBe(false);
    expect(without.steps[0].rule).toBe("lookahead");
    expect(solve(p, { rules: [...RULE_GROUPS] })).toEqual(solve(p));
    expect(solve(p).steps[0].rule).toBe("corner-chain");
  });

```

- In `without lookahead it can get stuck where lookahead solves`, `puzzle(2, 2, "2222")` → `puzzle(2, 2, "0...")` (corners now solve `2222` without lookahead).

`verify.test.ts`: in `searches when the rules get stuck`, `verify(puzzle(2, 3, ".2222."))` → `verify(puzzle(1, 4, ".22."))` (unique; the rules, lookahead included, get stuck; 1 search node).

`agreement.test.ts`: in `checkAgainstBruteForce`, replace the block from `// Every edge the rule solver decides agrees with every solution.` to `expect(r.status).not.toBe("incomplete");` with:

```ts
  // Every edge the rule solver decides agrees with every solution, with every rule group and with
  // the corners group left out.
  for (const rules of [undefined, []]) {
    const r = solve(p, { rules });
    r.edges.forEach((state, e) => {
      if (state === EdgeState.Unknown) return;
      for (const s of all) expect(s[e]).toBe(state);
    });
    if (r.status === "solved") expect(all.length).toBe(1);
    if (r.status === "contradiction") expect(all.length).toBe(0);
    expect(r.status).not.toBe("incomplete");
  }
```

(the whole file still runs in about 3 s.)

`clue-gaps.test.ts`:
- Add `import fc from "fast-check";` after the `bun:test` import.
- Replace the `SOLVED` doc comment and constant with:

```ts
/**
 * Ids of the corpus entries the rule solver solves. Empty when the corpus was made (WT14): every
 * entry was stuck. A solver change that solves more adds their ids, like a golden value; a missing
 * id means a rule got weaker. WT15's premature-loop fix solved 3; WT16's corner rules solve 23.
 * `SOLVED_WITHOUT_CORNERS` is the same with the corners group left out (WT15's three).
 */
const SOLVED: string[] = [
  "clue-gaps-5-3#16",
  "clue-gaps-5-18#14",
  "clue-gaps-5-41#4",
  "clue-gaps-5-44#16",
  "clue-gaps-5-56#3",
  "clue-gaps-5-81#1",
  "clue-gaps-5-81#5",
  "clue-gaps-5-87#17",
  "clue-gaps-5-95#18",
  "clue-gaps-7-3#14",
  "clue-gaps-7-5#17",
  "clue-gaps-7-8#0",
  "clue-gaps-7-10#27",
  "clue-gaps-10-0#77",
  "clue-gaps-10-2#12",
  "clue-gaps-10-2#37",
  "clue-gaps-10-3#41",
  "clue-gaps-10-4#26",
  "clue-gaps-10-4#35",
  "clue-gaps-10-7#60",
  "clue-gaps-10-8#26",
  "clue-gaps-10-8#27",
  "clue-gaps-10-11#64",
];
const SOLVED_WITHOUT_CORNERS: string[] = [
  "clue-gaps-5-81#5",
  "clue-gaps-10-8#26",
  "clue-gaps-10-8#27",
];

```

- In the per-entry test, after `expect(disagreements(solve(c.puzzle).edges, solution)).toBe(0);` add `expect(disagreements(solve(c.puzzle, { rules: [] }).edges, solution)).toBe(0);`
- Replace the last test with:

```ts
  test(`the rule solver solves exactly the entries in SOLVED (${SOLVED.length} today)`, () => {
    const solved = corpus.filter((c) => solve(c.puzzle).status === "solved").map((c) => c.id);
    expect(solved).toEqual(SOLVED);
    const without = corpus
      .filter((c) => solve(c.puzzle, { rules: [] }).status === "solved")
      .map((c) => c.id);
    expect(without).toEqual(SOLVED_WITHOUT_CORNERS);
  });

  test("from a correct partial board, with or without corners, no edge contradicts the solution", () => {
    // The only solution of each entry, found once.
    const solutions = corpus.map((c) => verify(c.puzzle, CLUE_GAP_VERIFY_OPTIONS).solutions[0]);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: corpus.length - 1 }),
        // One flag per edge of the largest corpus board (10×10: 220 edges); about a quarter given.
        fc.array(fc.constantFrom(false, false, false, true), { minLength: 220, maxLength: 220 }),
        fc.boolean(),
        (n, given, corners) => {
          const solution = solutions[n];
          const initial = solution.map((s, e) => (given[e] ? s : EdgeState.Unknown));
          const result = solve(corpus[n].puzzle, { initial, rules: corners ? undefined : [] });
          expect(result.status).not.toBe("contradiction");
          expect(disagreements(result.edges, solution)).toBe(0);
        },
      ),
      { numRuns: 300 },
    );
  });
```

`rules.test.ts`:
- Import `GROUP_RULES, RULE_GROUPS` too.
- In `are unique and each has an explanation`, after the `toBeGreaterThan(20)` line add:

```ts
    // The hint card has to fit under a 7×7 board on the smallest phone (hint.e2e.ts checks the
    // rules small-7 uses); parity's 111 characters is the longest text from before WT16.
    for (const id of RULE_IDS) expect([id, RULE_TEXT[id].length <= 115]).toEqual([id, true]);
```

- Add a third test:

```ts
  test("each rule is in at most one group, and every group lists its rules", () => {
    expect(Object.keys(GROUP_RULES).sort()).toEqual([...RULE_GROUPS].sort());
    const grouped = RULE_GROUPS.flatMap((g) => GROUP_RULES[g]);
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const id of grouped) expect(RULE_IDS).toContain(id);
  });
```

### 2.5 Generator version and goldens

- `packages/core/src/generate.ts`: `export const GENERATOR_VERSION = "4";`
- `packages/core/src/generate.test.ts`: comment `GENERATOR_VERSION "3"` → `"4"`; the 10×10 golden clues become
  `".......1.12......3..2.233.....1.1....2............3121.11.23.122.11.2.11...11....2...02.11.3.......1"` (solution unchanged); the 20×20 digest becomes `[2615864597, 3388607243, 1610361978, 2703485071]`. The other goldens do not change.

### 2.6 Web

`apps/web/src/lib/game/patterns.ts`: insert before the `parity` pattern's comment (`// The left cell is outside …`):

```ts
  // Corner rules. A line comes down into the 1's top-right corner and the edge on to the right is
  // crossed: the 1's line is at that corner, so its far sides are crossed.
  "line-into-1": pattern(2, 2, "..1.", (a) => ({
    lines: [a.v(0, 1)],
    crosses: [a.h(1, 1)],
    cells: [a.cell(1, 0)],
    dots: [a.dot(1, 1)],
    ghostCrosses: [a.v(1, 0), a.h(2, 0)],
  })),
  // A line comes down into the 3's top-right corner: the 3's far sides are lines, and the edge on
  // to the right is crossed.
  "line-into-3": pattern(2, 2, "..3.", (a) => ({
    lines: [a.v(0, 1)],
    cells: [a.cell(1, 0)],
    dots: [a.dot(1, 1)],
    ghostLines: [a.v(1, 0), a.h(2, 0)],
    ghostCrosses: [a.h(1, 1)],
  })),
  // The loop passes through the 2's top-left corner (a line comes down, the edge to the left is
  // crossed), so it passes through the bottom-right corner too, where the edge below is crossed.
  "two-passes-on": pattern(3, 3, "....2....", (a) => ({
    lines: [a.v(0, 1)],
    crosses: [a.h(1, 0), a.v(2, 2)],
    cells: [a.cell(1, 1)],
    dots: [a.dot(1, 1), a.dot(2, 2)],
    ghostLines: [a.h(2, 2)],
  })),
  // Both sides at the board's corner or neither: either way the loop leaves the 2 along the border.
  "two-in-corner": pattern(2, 2, "2...", (a) => ({
    cells: [a.cell(0, 0)],
    dots: [a.dot(0, 0), a.dot(0, 1), a.dot(1, 0)],
    ghostLines: [a.h(0, 1), a.v(1, 0)],
  })),
  "ones-side-by-side": pattern(2, 2, "11..", (a) => ({
    cells: [a.cell(0, 0), a.cell(0, 1)],
    dots: [a.dot(0, 1)],
    ghostCrosses: [a.v(0, 1)],
  })),
  // The 1's far sides are crossed, so its line passes through the corner it shares with the 3, and
  // the 3's far sides are lines.
  "three-diagonal-one": pattern(2, 2, "3..1", (a) => ({
    crosses: [a.v(1, 2), a.h(2, 1)],
    cells: [a.cell(0, 0), a.cell(1, 1)],
    dots: [a.dot(1, 1)],
    ghostLines: [a.h(0, 0), a.v(0, 0)],
  })),
  // One chain of corners: a 1 and a 3 side by side on the border. If the 3's top side were empty,
  // its shared side would be a line, which could only go on along the 1's top: two lines for the 1.
  "corner-chain": pattern(2, 2, "13..", (a) => ({
    cells: [a.cell(0, 0), a.cell(0, 1)],
    dots: [a.dot(0, 1)],
    ghostLines: [a.h(0, 1)],
  })),
```

(All within 3×3, ghosts on empty edges, no rule breaks: `patterns.test.ts` checks it.)

`apps/web/tests/hint.e2e.ts`: small-7's rules change (it no longer needs `parity`, and uses five corner rules). Replace the comment above `RULES` with `// Every rule small-7 uses, so long texts (the corner rules, the 3s) are among them.` and in `RULES` replace `"parity",` with:

```ts
  "line-into-1",
  "line-into-3",
  "two-passes-on",
  "ones-side-by-side",
  "three-diagonal-one",
```

Run it once (needs Chromium, not in the gate): `cd apps/web && E2E_PORT=4391 bunx playwright test tests/hint.e2e.ts` — 17 passed with this plan's texts (both phone sizes, every card fits). Delete `apps/web/build` afterwards if git shows it.

### 2.7 API contract

`bun run gen:api` (adds the 7 ids to the rule enum in `openapi.yaml` and `packages/api-client/src/schema.ts`).

### Verify step 2

`bun run check` (828 pass, 3 skip). `bun test packages/core` alone runs in about 8 s. Commit.

## Step 3 — `bench:clue-gaps` measures fewer rules

`feat(core): bench:clue-gaps can leave rule groups and lookahead out`

`packages/core/bench/clue-gaps.ts`:
- In the file comment, after `apart from the times. Takes about 3 minutes.` add a paragraph:

```ts
 *
 * `--rules=<groups>` (comma-separated `RULE_GROUPS`, empty for none) and `--no-lookahead` measure
 * the rule solver with fewer rules. The puzzles are still generated with every rule, so with either
 * flag the solver floor starts from the full clue set instead of the generated puzzle.
```

- Imports: `createPuzzle, deriveClues, NO_CLUE, type Puzzle` from puzzle; add `import { RULE_GROUPS, type RuleGroup } from "../src/rules.ts";`; solver import becomes `import { type SolveOptions, type SolveResult, solve } from "../src/solver.ts";`
- Replace the `runRules` doc comment and function with:

```ts
const rulesArg = process.argv.find((a) => a.startsWith("--rules="))?.slice("--rules=".length);
const rules = rulesArg?.split(",").filter((g) => g !== "") as RuleGroup[] | undefined;
for (const g of rules ?? []) {
  if (!(RULE_GROUPS as readonly string[]).includes(g)) throw new Error(`unknown rule group ${g}`);
}
const options: SolveOptions = { rules, lookahead: !process.argv.includes("--no-lookahead") };
/** Fewer rules than `generate` used: the floor then starts from the full clue set. */
const fewerRules = rules !== undefined || !options.lookahead;

/** The one place the harness runs the rule solver, with the rules the flags chose. */
function runRules(puzzle: Puzzle): SolveResult {
  return solve(puzzle, options);
}

```

- `const { puzzle, stats } = generate(…)` → `const { puzzle, solution, stats } = generate(…)`.
- Replace `solverFloor += greedyFloor(puzzle, …` with:

```ts
    const start = fewerRules
      ? { grid, clues: deriveClues(grid, solution).map((k) => (k === 4 ? NO_CLUE : k)) }
      : puzzle;
    solverFloor += greedyFloor(start, `${seed}/floor`, (p) => runRules(p).status === "solved");
```

Verify: `bun run check`; `bun run --cwd packages/core bench:clue-gaps --no-lookahead` prints the "no lookahead, corners on" column above (44.5 / 43.7 / 43.4 / 41.8 / 44.1%), and `--no-lookahead --rules=` prints main's 45.9 / 44.7 / 43.7 / 42.8 / 44.8%. Commit.

## Step 4 — Docs

`docs: record the corner rules, rule groups and their measurements`

4.1 `README.md`, the `bench:clue-gaps` row: replace `(`--write-corpus` rewrites the test corpus; not part of the check)` with `(`--rules=` and `--no-lookahead` measure fewer rules, `--write-corpus` rewrites the test corpus; not part of the check)`.

4.2 `packages/core/AGENTS.md`: after the sentence ending `(the web app also draws a small pattern for each rule).` add: `A rule a difficulty level may leave out belongs to a rule group (`RULE_GROUPS`), and the agreement tests run with and without each group.`

4.3 `docs/DECISIONS.md`: append the four entries below (fill nothing in; the numbers are this plan's).

```md
## 2026-10-26 · WT16 `corner-parity` · Corner rules: which side pairs each corner of a 1, 2 or 3 can still take
- **Question:** How should the engine reason about corners the way people do (a line into a 1's or a 3's corner, 2s passing the corner on, 1-1 on the border, 3 diagonal to a 1, 2 in a corner), and where does it go among the tiers?
- **Decision:** Each corner of a clue cell 1–3 (its two sides at one dot) has a 4-bit mask of the (h, v) state pairs still possible: a 1 starts without "both", a 3 without "neither", a 2 with all four; "the loop passes through the corner" is the odd pair. Two exact local rules narrow the masks and decide edges: at a clue cell, the side sets with the clue's count that fit its edges and four masks; at a dot, the line sets (none or two) that fit its edges and the masks around it. They run as a new tier 3 (after the 3s patterns, before parity) on a worklist fed from the edge trail and from narrowed masks; masks are trailed so lookahead and the verifier's search can undo them; the arrays are allocated on the first corner pass. Lookahead probes still run tier 1 only (WT18). The rules run at every clue cell 1–3 whose side changed and every dot at a corner of a 1, 2 or 3: a first version skipped those whose masks were still the clue's defaults, and that made the rules depend on the order of deductions (generated 20×20 puzzles kept 6.2% removable clues and the restore step fired; 15 of 3000 partial solves of one board got stuck where solving from scratch did not). Now 0 differences in 9 800 solves from random sound partial boards (7×7 to 30×30, with and without corners and lookahead), so WT15's block bases stay exact. A union-find over edge pairs was not used: pair parities at a dot are colour relations of diagonal cells, which the parity tier already has; the masks add the non-linear part (never both for a 1, never neither for a 3, never four lines at a dot). `GENERATOR_VERSION` is now `"4"`.
- **Reason:** Measured (before → after): clue-gap corpus solved 3 → 23 of 36; share of `lookahead` steps in generated puzzles' hint traces 13.9% → 6.8% (10×10), 14.9% → 7.2% (20×20), 14.1% → 6.3% (40×40), with the corner rules about 10% of steps; solver floor without lookahead (from the full clue set) 45.9 → 44.5% (5×5), 44.7 → 43.7% (7×7), 43.7 → 43.4% (10×10), 42.8 → 41.8% (15×15), 44.8 → 44.1% (20×20); with lookahead the floor and generated density stay where they were (lookahead already found these deductions, more slowly): `bench:clue-gaps` clues 41.2 / 40.1 / 40.1 / 39.2 / 41.5%, removable and restored 0.0%, gap 0.7 / 1.2 / 4.0 / 2.5 / 3.1%, verifier floor 41.0 / 39.6 / 38.9 / 38.4%.

## 2026-10-26 · WT16 `corner-parity` · How corner steps are named and what a hint highlights
- **Question:** A corner deduction can rest on a chain of clues and dots. Which rule does its hint name, and what does it highlight?
- **Decision:** Narrowing a mask records no step; only setting edges does. While steps are recorded, every narrowed mask keeps the clue cells and dots whose rules narrowed it, through the masks they used, and a step's `cells` and `dots` are that reason. Seven ids, chosen from the reason's clues in this order: any 2 → `two-passes-on` ("A 2 passes it on"), or `two-in-corner` ("2 in a corner") when the reason is one 2 in a board corner cell with that corner's dot and only border dots; one 1 → `line-into-1` ("Line into a 1's corner"); one 3 → `line-into-3` ("Line into a 3's corner"); two 1s sharing a side and the step crosses just that side → `ones-side-by-side` ("1s side by side", the 1-1 on the border, also when the end is closed by a cross); a 1 and a 3 diagonal with the corner between them odd → `three-diagonal-one` ("3 diagonal to a 1"); anything else → `corner-chain` ("Corners pass along", about 5% of corner steps). Texts are at most 115 characters (parity's 111 was the longest), so the card fits on the smallest phone; each has a pattern drawing. "Passes through a corner" means exactly one of the cell's two sides there is a line, in every text.
- **Reason:** Hints have to name what a player would recognise, and the reason set is what was used, so the highlight shows the whole chain (on generated 10×10 to 40×40 puzzles: median 3 cells and dots, 90th percentile 8, at most 22). Naming by the clues alone, without the geometric checks, gave wrong titles (a 1 next to a 3 on the border came out as "3 diagonal to a 1"), hence the checks and an honest fallback.

## 2026-10-26 · WT16 `corner-parity` · Rule groups: `solve(puzzle, { rules })`
- **Question:** Difficulty will depend on which rules the solver may use (user decision, 2026-10-26). How does `solve` take a rule set?
- **Decision:** `RULE_GROUPS = ["corners"]` in `rules.ts` with `GROUP_RULES` (each group's ids); `SolveOptions.rules?: readonly RuleGroup[]`, default every group. Rules outside every group always run; `lookahead` keeps its own boolean. `verify` always uses every rule; `generate`'s `RuleSolver` is unchanged (every rule) until WT20 passes a level's groups. The agreement tests, the corpus test and a fast-check over partial corpus boards run with every group and with corners off; `bench:clue-gaps` takes `--rules=<groups>` and `--no-lookahead` (the floor then starts from the full clue set, since the generated puzzle was made with every rule). With corners off every result equals the engine before WT16.
- **Reason:** The smallest seam that lets WT17/WT18 add groups and WT20 build levels, without a second engine.

## 2026-10-26 · WT16 `corner-parity` · Verification speed with corner rules
- **Question:** Do the corner rules slow `verify` (NFR-1: must not get slower), and should the verifier's search use them?
- **Decision:** They run at the root and at every search node. The engine also stops building a step's cells and dots when no steps are recorded (lookahead probes, the verifier). The parity ↔ corner bridge (restrict a corner when the cells beside it are in one parity set, union them when a mask is even or odd) is not built.
- **Reason:** Paired A/B (both engines in one process, median of 40 rounds): clue-gap corpus 0.49× (search nodes 669 → 108), generated 20×20 0.57× and 40×40 0.49–0.51× (lookahead probes about halved), windy boards with 60–65% of clues 0.57–0.79×, blob loops with every clue 0.89–0.98×, with 70% of clues 0.85–1.05×; boards with no clues 1.05–1.07× (per-node trail checks; an empty editor draft, ~0.14 ms at 8×8). `bench` lines (before → after medians): 100×100 full 2.5–2.7 → 2.1–2.3 ms, 100×100 70% 16.3–17.7 → 14.0–14.5 ms, 30×30 minimal 5.6–5.8 → 4.1–4.8 ms, the rest equal except 30×30 70% 0.4 → 0.5–0.6 ms, the first case where the corner code runs a lot and gets compiled (after a warm-up pass 0.3–0.4 → 0.3). Corners only at the root: corpus 0.63× instead of 0.49×. The bridge (prototype) cost 12–19% on generated boards for 0.2–0.5 points of no-lookahead floor, and would make `parity` steps cite reasoning they don't show; WT17 (clue colouring feeds the parity union-find) or WT19 (incremental parity) can revisit it. `bench:generate --quick`: p95 15 → 14 ms (7×7), 35 → 43 ms (10×10), 558 → 463 ms (20×20), 2.7 → 2.4 s (30×30), 9.8 → 6.6 s (40×40), clues 40.0–41.0%, every result `unique`; 100×100 seed `bench-0` 340 → 254 s (41.6 → 41.3% clues, its hint trace 14.5% → 6.5% lookahead, verifying it 1.4 → 0.7 s).
```


Verify: `bun run check`. Commit.

## Final checks

1. `bun run check` green.
2. `git log --oneline main..` shows the four commits.
3. `bun run --cwd packages/core bench` (verify) next to the same on `main` (copy `packages/core` of main into your scratchpad): every line within the table above (the 30×30 70% line is the known warm-up case).
4. `bun run --cwd packages/core bench:generate --quick`: every result `unique`, restored 0.0%.
5. `bun run --cwd packages/core bench:clue-gaps`: `removable` and `restored` 0.0% on every line (a non-zero `removable` means the corner rules lost monotonicity; see DECISIONS).

## Acceptance criteria

- FR-3: seven new named deductions (corner group) in `RULE_IDS` with texts and titles; steps record them; `solve(puzzle, { rules: [] })` leaves them out and gives exactly main's results (corpus, floors).
- FR-4/FR-5: `agreement.test.ts` passes with both rule sets (all grids ≤ 6 cells, fast-check); `verify` unchanged in results.
- FR-6/FR-12: every new rule has a web pattern (`patterns.test.ts`), its step's cells and dots are its reason; hint cards fit (`hint.e2e.ts`, run once).
- FR-10: `GENERATOR_VERSION` "4", goldens updated, generation deterministic.
- NFR-1: verification faster on unique and generated puzzles (0.49–0.57×), within a few percent elsewhere (table above).
- NFR-3: per-rule unit cases, rule-group test, fast-check from partial corpus boards with and without corners.
- Measurements recorded in DECISIONS: clue-gap lines, no-lookahead floor, corpus ids, lookahead share, verify and generate lines.

## Assumptions and unresolved questions (resolved by assumption; the orchestrator may override)

1. **The 30×30 70% bench line** reads 0.5–0.6 ms against 0.4 (cold JIT of the corner code; warm, 0.3 vs 0.3–0.4; steady-state paired +2–5%), and boards with no clues pay ~5% per search node. Every other line is equal or faster. Assumed acceptable as "not slower" in substance; if not, WT19 should win it back (the undo/propagate checks are the cost on empty boards).
2. Rule group names and ids: one group `corners`; ids `line-into-1`, `line-into-3`, `two-passes-on`, `two-in-corner`, `ones-side-by-side`, `three-diagonal-one`, `corner-chain`. "1-1 on the border" is titled "1s side by side" because it also fires when the end of the shared side is closed off by a cross.
3. `lookahead` stays its own boolean option rather than a group (minimal; WT20 decides levels).
4. `verify` always uses every rule; it gets no `rules` option.
5. No PRD change (the roadmap puts FR-3's wording in WT20).
6. The parity ↔ corner bridge is not built (cost, and `parity` steps would cite corner reasoning); recorded for WT17/WT19.
