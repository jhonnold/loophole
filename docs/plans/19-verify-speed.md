# WT19 `verify-speed` — implementation plan

Branch `feat/verify-speed`, worktree `/home/jhonnold/projects/loophole-wt/verify-speed` (at `main` with WT13–18). PRD: FR-4/FR-5 (verify correct, agreement with brute force), FR-26/FR-27 (editor live check with a 3 s budget, submissions verified on the server with 30 s), FR-10 (generation deterministic per version), NFR-1 (verification of a submitted puzzle completes or returns `unknown` within 30 s; generation p95 < 10 s up to 30×30, < 30 s at 40×40), NFR-3 (unit and property tests). Roadmap: WT19 row of `~/.claude/plans/read-through-the-prd-noble-squirrel.md` (user preference: uniqueness verification should be faster).

## Goal

Make `verify` faster without changing any answer: same status, same solutions, and (since nothing here changes what the rules can deduce) the same search tree, node for node. Fix the WT18 trade-off, where the deepened search cost 1.15–1.37× on 20×20 boards with a clue dropped and could push a board main settled in 17–30 s past the server's 30 s limit.

1. **Parity keeps its union-find (no steps recorded).** Parity rebuilt its union-find from every known edge on every pass (O(edges)) and colouring re-derived all its relations on every pass. An engine that records no steps (the verifier, generation's clue tests) now keeps the union-find between passes and undoes it with the edges: union by size, no path compression, a trail of unions popped by `undo`, each set's nodes in a ring. A union notes the open edges between the two sets (walking the smaller one) and queues the clue cells there for colouring, whose relations stay in the union-find until undone, so a colouring pass looks only at queued cells. An engine that records steps rebuilds as before, so steps and hints are byte-identical.
2. **Cheaper connectivity.** `connected` counts line ends in its walk and marks dots with a walk number instead of clearing arrays and rescanning every edge; `connectivity` reads the lines' block line count instead of scanning; `blocks` (Tarjan) starts only from the lines' dot and uses a neighbour table; two-exits groups of two edges (most of the non-chain groups) are decided by walking both pieces at once and stopping at the smaller one instead of walking the whole graph; at the root (no steps, no connectivity group) the detect-only check waits until lookahead finds nothing.
3. **A harder `bench`.** `bench/verify.ts` gains the cases the old one lacked: clue-gap corpus, empty and draft boards, generated puzzles minus 1 and minus 2 clues at 10/15/20/30, under a 50 000-node cap.
4. The verifier still deepens after 200 nodes (re-measured; unchanged), still branches on the first open edge in reading order (so `multiple` returns the same two solutions, which the editor's clue suggestion uses), and `GENERATOR_VERSION` stays `"6"` (generation output identical).

Out of scope (measured, see "Alternatives"): a different branching order, connectivity on a schedule in the search, batched lookahead, an incremental face union-find for two-exits, checking the clock less often.

## Measured (this machine: 16 cores, Bun 1.3.13)

"main" is `9bf324d` run from a copy of `packages/core`; "final" is the full working diff of this plan (`/tmp/claude-1000/-home-jhonnold-projects-loophole/a34715f6-7810-5a69-ba81-edd46bda034d/scratchpad/verify-speed/wt19-final.diff`). "Paired" means both engines in one process on the same puzzles, alternating which runs first, median of the rounds given. Unless marked, runs use `maxNodes` 200 000 and no time limit, so answers are deterministic. Scripts and sets: `…/scratchpad/verify-speed/scripts/` (`ab.ts` paired A/B, `stress.ts`, `timelim.ts`, `three.ts`), `…/verify-speed/sets.json` (built by `mksets.ts` and `mkv5.ts`).

### Benchmark sets

| Set | What |
|---|---|
| `corpus` | clue-gap corpus (36, 5×5–10×10) |
| `empty5`…`empty30`, `empty8` (30) | empty grids (an editor draft before any clue) |
| `draft10/15/20` | windy loop (`generateLoop`) with 20/30/40% of its clues (10, 10, 5 boards) |
| `w8`, `w12` | WT16's windy boards with 60–65% of clues (30, 10) |
| `gen10/15/20/30`, `g6g20`, `g6g40` | generator "6" puzzles (unique; root lookahead does the work) |
| `d1_N`, `d2_N` (N = 10, 15, 20, 30) | generator "6" puzzle minus 1 / minus 2 random clues (20 boards; 10 at 30×30) |
| `gap6_15`, `gap6_20` | WT18's near-unique generator "6" boards (12 each) |
| `v5w1_*`, `v5w2_*` | WT18 review's regression boards (generator "5", seeds `w1`/`w2`, 100 runs: drop1, drop2, flip at 10/12/15/20) |
| `full10/30/100`, `p10/30/100`, `min10/30` | `bench`'s blob loops: every clue, 70%, minimal (built with main's solver) |

### Verify: final against main (paired; node counts and answers identical in every row)

| Set | rounds | main | final | final/main |
|---|---|---|---|---|
| corpus | 41 | 6.90 ms | 6.63 ms | 0.96 |
| empty 5 / 8 (30) / 10 / 15 / 20 / 30 | 9 | 0.06 / 5.23 / 0.29 / 2.39 / 4.75 / 17.0 ms | 0.05 / 3.14 / 0.14 / 0.78 / 1.03 / 2.12 ms | 0.85 / 0.60 / 0.47 / 0.33 / 0.22 / **0.12** |
| draft10 / draft20 / draft15 | 9 / 9 / 2 | 4.82 / 254 / 1 686 ms | 3.23 / 126 / 642 ms | 0.67 / 0.50 / 0.38 |
| w8 / w12 | 41 / 9 | 3.59 / 2.43 ms | 3.48 / 2.31 ms | 0.97 / 0.95 |
| gen10 / 15 / 20 / 30 | 9 | 9.19 / 31.0 / 84.4 / 216 ms | 8.26 / 25.6 / 61.4 / 132 ms | 0.90 / 0.83 / 0.73 / 0.61 |
| g6g20 / g6g40 | 9 | 105 / 227 ms | 64.2 / 120 ms | 0.61 / 0.53 |
| gap6_15 / gap6_20 | 9 / 2 | 39.1 / 9 117 ms | 26.2 / 4 323 ms | 0.67 / 0.47 |
| d1_10 / 15 / 20 | 9 | 35.4 / 53.5 / 834 ms | 24.8 / 40.4 / 393 ms | 0.70 / 0.75 / 0.47 |
| d2_10 / 20 / 15 | 9 / 9 / 2 | 34.2 / 944 / 3 551 ms | 25.4 / 433 / 1 763 ms | 0.74 / 0.46 / 0.50 |
| d1_30 / d2_30 | 2 | 48 054 / 57 764 ms | 16 749 / 19 840 ms | **0.35 / 0.34** |
| v5w2_drop1_20 (31) / v5w1_drop1_20 (22) | 2 | 2 811 / 16 692 ms | 1 508 / 7 771 ms | **0.54 / 0.47** |
| v5w2_drop2_20 / v5w2_drop2_15 / v5w1_drop1_15 / v5w2_drop1_15 | 2 / 9 / 9 / 9 | 11 119 / 367 / 232 / 380 ms | 4 371 / 195 / 126 / 186 ms | 0.39 / 0.53 / 0.54 / 0.49 |
| v5w1_flip_20 / v5w2_flip_20 / v5w1_drop1_10 | 9 | 7 854 / 115 / 17.4 ms | 3 701 / 83.9 / 15.3 ms | 0.47 / 0.73 / 0.88 |
| full10 / full30 / full100 | 41 / 41 / 9 | 1.32 / 2.78 / 8.57 ms | 1.33 / 2.83 / 6.88 ms | 1.00 / 1.00–1.02 / 0.80 |
| p10 / p30 / p100 | 41 / 41 / 9 | 2.48–2.53 / 6.31–6.38 / 55.3 ms | 2.59–2.68 / 6.36–6.49 / 17.8 ms | 1.02–1.08 / 1.01–1.02 / **0.32** |
| min10 / min30 | 9 | 8.65 / 39.8 ms | 6.25 / 18.4 ms | 0.72 / 0.46 |

Noise: an A/A run (main against a copy of itself, 41 rounds) gave 0.955–1.00 on full10/full30/p10/p30. The only rows above 1.00 are those tiny sets (p10: 50 boards of 50 µs each, about 1–2 µs a board), inside that spread. Lookahead probe counts are equal or slightly lower (the root's parity now also sees colouring's relations from the last colouring pass, e.g. gen30 143 545 → 132 623); search nodes are identical everywhere.

### The WT18 regression

Board `v5w2_drop1_20#18` (the one that made the WT18 set 1.15–1.37×; 3 runs each): main (deepened) 2.50–2.61 s, main with deepening off (the pre-WT18 verifier) 1.79–1.85 s, **final 1.22–1.30 s**. The final engine with deepening off does it in 0.66–0.72 s, so on boards where connectivity barely prunes the deepened search still costs about 1.8× its own shallow one, but it is now faster than both main and the pre-WT18 verifier.

Cost per node of the deepened search on a 30×30 board connectivity does not help (`d1_30#3`, first 30 000 nodes): main 4.75–4.93 s, pre-WT18 2.02–2.11 s, **final 1.41–1.48 s** (final shallow: 0.37–0.43 s). After step 2 alone it was 2.94 s; `blocks` (Tarjan) is now about 40% of the deepened search and two-exits' face union-find and grouping about 22%.

Under the real budget (default options, 30 s; per board main then final; `timelim.ts`):

| Set | main | final |
|---|---|---|
| d1_30 (10) | 60.6 s, 2 `unknown` | 52.3 s, **1** `unknown` (`#4`: `unknown` → `multiple` in 22.0 s) |
| d2_30 (10) | 60.2 s, 2 `unknown` | 46.1 s, **1** `unknown` (`#1`: `unknown` → `multiple` in 16.0 s) |
| gap6_20 (12) | 24.9 s (`#7` 24.7 s, 499 387 nodes) | 11.4 s (`#7` 11.3 s, same nodes) |
| v5w1_drop1_20 (22) | 30.2 s, 1 `unknown` (332 887 nodes) | 30.1 s, 1 `unknown` (743 709 nodes) |
| v5w2_drop2_20 (31) | 12.0 s (`#16` 10.5 s) | 4.9 s (`#16` 4.3 s) |
| v5w1_drop2_20 (22) | 215 ms | 152 ms |

No board went from a definite answer to `unknown`; three went the other way (d1_30#4, d2_30#1; the 30×30 unknowns that remain had 192–285k nodes on main and 494–604k on final when the 30 s ran out).

### Per step (paired, 7 rounds)

| Set | step 2 / main | final / step 2 |
|---|---|---|
| corpus | 0.95 | 0.98 |
| empty30 | 0.13 | 0.95 |
| draft20 | 0.59 | 0.85 |
| gen30 | 0.69 | 0.89 |
| g6g40 | 0.59 | 0.88 |
| min30 | 0.54 | 0.87 |
| p100 | 0.44 | 0.86 |
| d1_20 | 0.55 | 0.85 |
| v5w2_drop1_20 | 0.60 | 0.84 |

### `bench` (the new `bench/verify.ts`, same file run against main and final; ms, median (p95))

| Case | main (2 runs) | final (2 runs) | nodes (both) |
|---|---|---|---|
| 10×10 full | 0.1 (0.3) | 0.1 (0.3) | 0 |
| 30×30 full | 0.3 (0.3) | 0.3 (0.3) | 0 |
| 100×100 full | 2.1–2.2 (3.1–3.7) | 1.8–1.9 (2.1–2.5) | 0 |
| 10×10 70% | 0.1 (0.4) | 0.0–0.1 (0.4–0.5) | 23 |
| 30×30 70% | 0.4–0.5 (0.7) | 0.5 (0.6–0.8) | 21 |
| 100×100 70% | 14.6–14.9 (22.4) | **4.2–4.5** (5.0–5.8) | 35 |
| 10×10 minimal | 0.3 (1.3) | 0.2 (1.2) | 376 |
| 30×30 minimal | 13.1–13.6 (15.8–16.0) | **7.0–7.1** (7.1) | 600 |
| corpus | 0.1 (0.7) | 0.1 (0.7) | 35 |
| 10×10 empty | 0.3 | 0.2 | 101 |
| 30×30 empty | 16.9 | **2.0** | 1 101 |
| 10×10 draft | 0.6 (1.6–1.7) | 0.4 (1.0–1.3) | 429 |
| 15×15 draft | 1.5–1.6 (9.0–10.3) | 0.9–1.0 (6.3) | 996 |
| 10×10 generated −1 | 0.5 (1.8) | 0.4 (1.4–1.5) | 253 |
| 15×15 generated −1 | 2.4 (975–988) | 1.8–2.1 (444–449) | 50 609 (1 `unknown` at the cap) |
| 20×20 generated −1 | 3.6–4.1 (28.1–28.8) | 2.4–2.5 (17.6–17.7) | 840 |
| 30×30 generated −1 | 20.0–20.2 (43.1–43.4) | 13.0–13.2 (23.7–24.3) | 345 |
| 10×10 generated −2 | 0.6 (1.5) | 0.5 (1.2) | 214 |
| 15×15 generated −2 | 2.0–2.1 (14.4–14.5) | 1.5–1.6 (8.9) | 881 |
| 20×20 generated −2 | 5.1–5.2 (3 071–3 124) | 4.3 (1 443–1 462) | 51 044 (1 `unknown` at the cap) |
| 30×30 generated −2 | 69.6–71.4 (4 005–4 023) | 32.6–33.1 (1 624–1 657) | 36 176 |

The whole bench takes 33 s on main and 25 s on final. Statuses are identical line for line.

### Generation (`bench:generate --quick`, run alone, main then final)

| Size | p95 main → final | median main → final |
|---|---|---|
| 7×7 | 12 → 12 ms | 8 → 8 ms |
| 10×10 | 31 → 30 ms | 20 → 20 ms |
| 20×20 | 452 → 424 ms | 323 → 293 ms |
| 30×30 | 2 217 → **1 743** ms | 1 731 → 1 414 ms |
| 40×40 | 7 469 → **5 900** ms | 5 171 → 4 059 ms |

Clues 39.9 / 39.8 / 39.8 / 40.0 / 40.6%, restored 0.0%, every result `unique`, on both (whole run 101 → 82 s). The output is identical: `stress.ts gen` compared `generate` on 120 seeds (5×5 to 20×20) between main and final, puzzle, stats and the final solve's steps: 0 differences; the golden tests pass unchanged. 100×100 was not run (assumption: it gains like 40×40, since the clue tests are `steps: false` solves).

### Same answers (scratch `stress.ts`, main against final)

- 1 500 boards up to 14×14 (random clue grids, planted loops with 20–90% of clues, one clue changed): `verify` status, solutions and node count with `deepenAfterNodes` default, 0, 1 and 50 (6 000 runs), and `solve` with steps, without steps, 4 rule subsets × lookahead on/off (36 000): 0 differences, except that `solve(…, { steps: false })` may stop on a different board when it ends in `contradiction`. Main does that too (against `steps: true`), and generation never solves a contradictory board (it always solves clue subsets of its own loop).
- 160 generated puzzles (10–20) with 1–3 clues dropped or one changed, `deepenAfterNodes` default, 1 and 50: 0 differences (480).
- Every set in the tables: identical node counts and answers.
- The new engine property test passed 40 × 300 runs locally (12 000). Mutations it catches: no split on undo (20 failing tests), `ufSeen` not restored (1), no re-look at every clue after such an undo (1, via the new unit test), `unite` not queueing clue cells (2), a two-edge group always feasible (2), lines on both sides allowed (2). Harmless ones it does not: keeping cells queued after an undo (extra work), not skipping parity-set edges (extra work), dropping the deferred root check (`verify`'s search checks at every node anyway; `solve` without steps still finds those contradictions through lookahead in 200 000 random small boards).

### Alternatives measured and not taken

| Idea | Result |
|---|---|
| Deepening threshold 100 / 500 / 1 000 / 3 000 (after step 2; one unpaired run each, `survey.ts`) | 100: within ±10% of 200 everywhere. 500 / 1 000 / 3 000: about the same on the long-search sets (dominated by boards that deepen anyway) but 1.2–1.5× / 1.5–2.4× / 2.5–5.2× slower on the new solver's puzzles (g6g20, g6g40, min30). Keep 200. |
| Connectivity in the search only once per node / every other depth / without two-exits (after step 3's first half; 4 runs at once, so noisy) | Once: 0.91–1.25×, nodes about equal. Every other depth: 0.78–1.18× and one more `unknown` (v5w2_drop2_20 at 200 000 nodes). No two-exits: up to 3.7× more nodes (draft20: 4 934 → 18 167; d2_15 65 559 → 128 238) and one more `unknown`. None kept. |
| Connectivity only near the root of the search | The long searches are full binary trees 20–45 levels deep (`v5w2_drop1_20#18`: nodes double per level from depth 17 to 25); pruning near the root cannot help. |
| Branch on another edge (most constrained, near a path end, probe failures) | Not measured for speed: `multiple` returns the first two solutions in reading order (cross before line), the editor suggests a clue from them (`lib/editor/answers.ts`), and changing the order changes them. Would need a decision to allow different solutions. |
| Batch lookahead (keep probing after a deduction, global tiers once a sweep) | Probes doubled; 1.06–1.43× slower on generated sets (0.58× on p100 only). |
| Leave the deepened root's connectivity until lookahead finds nothing | Probes +25–65%; 1.17× (g6g40), 1.43× (min30). |
| Skip the colouring pass when no edge is open (roadmap) | Nothing to skip: with no open edge the loop has closed (`propagate` returns) or `local` fails first. On full boards colouring never runs; full100 is 0.80× from the rest of this plan. |
| Patterns and corner rules inside search nodes (roadmap) | Already so: the 3s patterns depend only on the clues and stay below every mark; corner rules run at every node since WT16. |
| `for (const assumed of [Line, Cross])` → index loop in `lookahead` | Kept: 0.94–1.00, no risk. Other allocations (`mark()` objects, corner arrays) are < 2% each in profiles; not changed. |
| Check the clock every 16 probes instead of every probe | `Date.now` + `tick` are about 3.7% of root-heavy runs; not changed (it changes the documented budget behaviour). |
| Incremental face union-find for two-exits | Not built: two-exits' face pass and grouping are about 22% of the deepened search; follow-up. |

## What each roadmap item became

- Deepened verifier slower on 20×20 boards with a clue dropped: fixed. The WT18 set is 0.54× main and its worst board 0.49× main / 0.68× pre-WT18; deepened nodes cost less than the pre-WT18 verifier's shallow ones at 20×20 and 30×30. The threshold stays (re-measured); the strategy variants measured did not help.
- Skip colouring when no edge is open: not reachable (above).
- Incremental parity union-find: done (step 2), with colouring on the same structure.
- Better branching edge: rejected under "identical answers" (above).
- Patterns/corners in search nodes: already the case.
- Cheaper connectivity checks: done (step 3).
- Allocations in hot loops: one change; the rest measured too small.
- Solve/generation: `bench:generate --quick` 0.79–0.94× at 20–40×40, output identical.

## Design

### Trailed union-find (step 2)

Applies only to an engine with `steps === null` when its first parity pass runs (`trailed: boolean | null`, decided there; `solve` sets `steps` after constructing the engine). An engine that records steps keeps the rebuild, which decides edges in index order, and the colouring code as it is, so recorded steps do not change.

- State: `ufParent`, `ufParity` (existing), `ufNext`/`ufSize` (existing ring arrays, now kept up to date), `ufTrail` (roots attached under another root), `ufSeen` (trail position of the first edge not yet in the union-find), `decided` (scratch), `colourAll` (next colouring pass looks at every clue).
- `ufFind` does no path compression when trailed (union by size keeps depth O(log n); compression could not be undone).
- `unite(u, v, x)`: if same set, consistent iff parities match. Otherwise, with `small` the smaller set: for each node of `small`'s ring, queue the clue cells at or beside it (`queueAround`, when colouring is on) and push to `decided` every open edge from it to `large` (checked before attaching, so no edge is pushed twice); then attach, join rings, push `small` on `ufTrail`.
- `parityTrailed`: unite every trail edge from `ufSeen` on (contradiction → clear `decided`, -1), then `assignDecided` (each edge: Line if its two sides' parities differ, else Cross). Same set of decided edges as a rebuild (the relations are the same, and after a pass no open edge has both sides in one set).
- `colourTrailed`: queue every clue cell when `colourAll`, then run `colourCell` on the queue. `colourJoin`, when trailed, is `unite` + `assignDecided`.
- `undo(m)`: if unions were made since `m`, `splitTo(m.uf)` (pop: subtract size, swap ring pointers back, reset parent and parity); then cells queued since were queued by undone unions: drop them, unless cells were queued at `m` (`m.colourPending`), in which case `colourAll` (look at all again). Always `ufSeen = m.ufSeen`. Probes make no unions, so they never pop.
- Why the answers cannot change: without steps only the fixpoint of tiers 1–4 matters at each search node, and it is the same set of deductions (rules are sound and monotone; the order differs). Every set in this plan has identical search node counts.

### Connectivity (step 3)

- `connected()`: one walk from the first line's dot with walk marks (`reach[d] === walk`, `nextWalk()` resets every 2^30 walks), counting line ends met (each reached line twice); all lines reached iff `lineEnds === 2 * lineCount`. Clues: only the cells with a clue above 0 (`positiveCells()`, built once). The reason for a failure (`exitCells`, `exitDots`, read only while steps are recorded) is found afterwards by `exitReason`, the same first unreached line, else first unreached clue, as before.
- `blocks()`: Tarjan from the first line's dot only (edges in other components stay `NONE`, as they are in no block with a line: same results for `connectivity`, `cutOff` and `hangingAt`), neighbour dots from a table (`dotNext`), line count per block (`blockLines`). `connectivity()` checks `blockLines[target] === lineCount` instead of scanning every edge.
- `pairFeasible(e)` for two-edge groups without steps: when two-exits runs, `cutOff` has found nothing, so every line and open edge is in one block; crossing two edges between the same two faces cuts it into exactly two pieces, one at each end of `e`. Breadth-first walks from both ends, a dot each in turn, until one runs out (`spread`); then `pieceFeasible` on that piece: lines on both sides → infeasible; lines all here → every clue above 0 needs a usable side here (count marked clue cells); lines all on the other side → no clue above 0 beside this piece may have all its usable sides here. If the two walks meet (cannot happen when the reasoning holds), fall back to `connected()`. Groups of 3+ edges, and anything while steps are recorded, use `connected()` as before.
- `propagate`: when `lookahead && !connectOn && steps === null`, the detect-only check moves from before lookahead to after lookahead returns 0. It sets nothing; a disconnected state stays disconnected as edges are added, so the root still fails, just later. Probe counts are unchanged (measured).

### Files

| File | Step | Change |
|---|---|---|
| `packages/core/bench/verify.ts` | 1 | harder cases under a 50 000-node cap; prints nodes |
| `packages/core/src/engine.ts` | 2, 3 | trailed union-find, colouring on it, `Mark` fields, `undo` (2); connectivity walks, deferred root check, lookahead loop (3) |
| `packages/core/src/engine.test.ts` | 2 | 2 tests (colour re-look after undo; lockstep property) |
| `packages/core/src/agreement.test.ts` | 2 | `steps: false` finds the same status |
| `packages/core/AGENTS.md` | 2 | one sentence: the two engine modes |
| `docs/DECISIONS.md` | 4 | 3 entries |

`verify.ts`, `solver.ts`, `generate.ts` (and its goldens), the server, the web app and the API do not change.

## Rules for the implementer

- Mode EXECUTE; follow the steps in order; the code blocks are exact (they were run: `bun run check` passed with them, 843 pass, 3 skip; each step's own state was checked too). Each "Replace … with …" block occurs exactly once in the file at that point; apply them in order. Run `bun run format` after editing, then the step's checks.
- Bun lives in `~/.bun/bin`: prefix commands with `export PATH="$HOME/.bun/bin:$PATH";`. Run `bun install --frozen-lockfile` first.
- Do not clone the repo (`/tmp` is a 16 GB tmpfs shared with other worktrees); scratch scripts go in your scratchpad. The planner's full diff is `/tmp/claude-1000/-home-jhonnold-projects-loophole/a34715f6-7810-5a69-ba81-edd46bda034d/scratchpad/verify-speed/wt19-final.diff`, and the engine after step 2 alone is `…/verify-speed/engine.step2.ts`: the reference if a block below is ambiguous (do not `git apply` blindly; commit per step).
- Commit at the four boundaries given (conventional commits). `bun run check` must pass at each.
- If a test fails or a number differs, stop and find out why before changing the test.

## Step 1 — A harder verify benchmark

`chore(core): verify benchmark covers the corpus, drafts and near-unique boards`

Replace the whole of `packages/core/bench/verify.ts` with:

```ts
/**
 * Verification benchmark (not part of `bun run check`). Run: `bun run --cwd packages/core bench`.
 *
 * Puzzles from random loops (`src/test-support/loops.ts`):
 * - "full": every clue kept. The rules solve these outright.
 * - "70%": a random 30% of clues blanked. Often several solutions, so the search runs.
 * - "minimal": clues removed in random order while the rule solver still solves the puzzle.
 *   Needs lookahead. Building these takes a few seconds at 30×30, so 100×100 is left out.
 * Harder cases (DECISIONS, WT19), checked with at most `HARD_NODES` search nodes so a run takes
 * minutes, not hours (a board that needs more comes back `unknown`):
 * - "corpus": the clue-gap corpus (`clue-gaps.json`): unique, the rules alone get stuck.
 * - "empty" and "draft": what the editor checks while a puzzle is drawn, an empty grid and a
 *   windy loop (`generateLoop`) with 30% of its clues. Many solutions.
 * - "generated −1" and "generated −2": `generate`'s puzzles with one or two random clues taken
 *   out. Near-unique: the search runs long before it finds a second solution, or proves there is
 *   none.
 * Prints the time per `verify` call, how often each status came back and the search nodes in all.
 */
import { generate } from "../src/generate.ts";
import { createGrid, type Grid } from "../src/grid.ts";
import { generateLoop } from "../src/loop.ts";
import { createPuzzle, NO_CLUE, type Puzzle } from "../src/puzzle.ts";
import { createRng, type Rng } from "../src/rng.ts";
import { solve } from "../src/solver.ts";
import { clueGapCorpus } from "../src/test-support/clue-gaps.ts";
import { puzzleFromLoop, randomLoop } from "../src/test-support/loops.ts";
import { type VerifyOptions, verify } from "../src/verify.ts";

/** The node budget of the harder cases. */
const HARD_NODES = 50_000;

type Make = (grid: Grid, rng: Rng, n: number) => Puzzle;

const full: Make = (grid, rng) => puzzleFromLoop(grid, randomLoop(grid, rng), rng);
const partial: Make = (grid, rng) => puzzleFromLoop(grid, randomLoop(grid, rng), rng, 0.7);
const minimal: Make = (grid, rng) => {
  const clues = Array.from(full(grid, rng, 0).clues);
  const order = clues.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const i of order) {
    const k = clues[i];
    if (k === NO_CLUE) continue;
    clues[i] = NO_CLUE;
    if (solve(createPuzzle(grid.width, grid.height, clues)).status !== "solved") clues[i] = k;
  }
  return createPuzzle(grid.width, grid.height, clues);
};
const corpus = clueGapCorpus();
const gap: Make = (_grid, _rng, n) => corpus[n].puzzle;
const empty: Make = (grid) => createPuzzle(grid.width, grid.height);
const draft: Make = (grid, rng) => puzzleFromLoop(grid, generateLoop(grid, rng), rng, 0.3);
/** A generated puzzle with `drop` of its clues, picked at random, taken out. */
const generated =
  (drop: number): Make =>
  (grid, rng, n) => {
    const { width, height } = grid;
    const { puzzle } = generate({ width, height, seed: `bench-${width}-${n}` });
    const clues = Array.from(puzzle.clues);
    const kept = clues.flatMap((k, i) => (k === NO_CLUE ? [] : [i]));
    for (let d = 0; d < drop; d++) clues[kept.splice(rng.int(kept.length), 1)[0]] = NO_CLUE;
    return createPuzzle(width, height, clues);
  };

const HARD: VerifyOptions = { maxNodes: HARD_NODES };
const CASES: { label: string; make: Make; size: number; count: number; options?: VerifyOptions }[] =
  [
    { label: "full", make: full, size: 10, count: 50 },
    { label: "full", make: full, size: 30, count: 20 },
    { label: "full", make: full, size: 100, count: 5 },
    { label: "70%", make: partial, size: 10, count: 50 },
    { label: "70%", make: partial, size: 30, count: 20 },
    { label: "70%", make: partial, size: 100, count: 5 },
    { label: "minimal", make: minimal, size: 10, count: 20 },
    { label: "minimal", make: minimal, size: 30, count: 3 },
    { label: "corpus", make: gap, size: 0, count: corpus.length, options: HARD },
    { label: "empty", make: empty, size: 10, count: 1, options: HARD },
    { label: "empty", make: empty, size: 30, count: 1, options: HARD },
    { label: "draft", make: draft, size: 10, count: 10, options: HARD },
    { label: "draft", make: draft, size: 15, count: 10, options: HARD },
    { label: "generated −1", make: generated(1), size: 10, count: 10, options: HARD },
    { label: "generated −1", make: generated(1), size: 15, count: 10, options: HARD },
    { label: "generated −1", make: generated(1), size: 20, count: 10, options: HARD },
    { label: "generated −1", make: generated(1), size: 30, count: 3, options: HARD },
    { label: "generated −2", make: generated(2), size: 10, count: 10, options: HARD },
    { label: "generated −2", make: generated(2), size: 15, count: 10, options: HARD },
    { label: "generated −2", make: generated(2), size: 20, count: 10, options: HARD },
    { label: "generated −2", make: generated(2), size: 30, count: 3, options: HARD },
  ];

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

for (const { label, make, size, count, options } of CASES) {
  // The corpus brings its own grids (size 0): this one goes unused.
  const grid = createGrid(Math.max(size, 1), Math.max(size, 1));
  const times: number[] = [];
  const statuses: Record<string, number> = {};
  let clues = 0;
  let cells = 0;
  let nodes = 0;
  for (let n = 0; n < count; n++) {
    const puzzle = make(grid, createRng(`bench-${label}-${size}-${n}`), n);
    clues += puzzle.clues.filter((k) => k !== NO_CLUE).length;
    cells += puzzle.clues.length;
    const t0 = performance.now();
    const result = verify(puzzle, options);
    times.push(performance.now() - t0);
    statuses[result.status] = (statuses[result.status] ?? 0) + 1;
    nodes += result.stats.nodes;
  }
  times.sort((a, b) => a - b);
  const name = size === 0 ? label : `${size}×${size} ${label}`;
  console.log(
    `${name}: n=${count} clues=${Math.round((100 * clues) / cells)}% ` +
      `median=${percentile(times, 0.5).toFixed(1)}ms p95=${percentile(times, 0.95).toFixed(1)}ms ` +
      `max=${times[times.length - 1].toFixed(1)}ms statuses=${JSON.stringify(statuses)} nodes=${nodes}`,
  );
}
```

Verify: `bun run check` (no test changes); run `bun run --cwd packages/core bench` once (about 25–35 s) and check every line's `statuses` and `nodes` match the "final" column of the bench table above (they are the same before and after steps 2–3). Commit.

## Step 2 — Parity keeps its union-find when no steps are recorded

`perf(core): keep parity's union-find between passes when no steps are recorded`

### 2.1 `packages/core/src/engine.ts`

Apply these edits in order (each "Replace" block occurs once in the file as it stands when you reach it; afterwards the file equals `…/scratchpad/verify-speed/engine.step2.ts`):

Edit 2.1.1. Replace

```ts
 *    corner rules too), and take the opposite on a contradiction
 * After any change the engine goes back to tier 1, so steps come out roughly easiest first.
 */
import { EdgeState, type Grid, NONE } from "./grid.ts";
```

with

```ts
 *    corner rules too), and take the opposite on a contradiction
 * After any change the engine goes back to tier 1, so steps come out roughly easiest first.
 *
 * When no steps are recorded (the verifier, generation's clue tests) the order of deductions does
 * not matter, only the fixpoint, so parity and colouring work incrementally: parity's union-find
 * is trailed and undone with the edges, and colouring looks again only at the clues a union
 * touched.
 */
import { EdgeState, type Grid, NONE } from "./grid.ts";
```

Edit 2.1.2. Replace

```ts
  /** `cornerScan` then, so undoing past the first corner pass makes the next one scan again. */
  readonly scan: number;
}

```

with

```ts
  /** `cornerScan` then, so undoing past the first corner pass makes the next one scan again. */
  readonly scan: number;
  /** The trailed union-find (see `trailed`): its trail length and `ufSeen` then. */
  readonly uf: number;
  readonly ufSeen: number;
  /** Whether colouring had cells left to look at then. */
  readonly colourPending: boolean;
}

```

Edit 2.1.3. Replace

```ts
  private readonly ufParity: Uint8Array;
  private ufFound = 0;
  /**
   * Colouring. These arrays are allocated on the first colouring pass (`initColour`), so a puzzle
```

with

```ts
  private readonly ufParity: Uint8Array;
  private ufFound = 0;
  /**
   * Without recorded steps (the verifier, generation's clue tests) the union-find is trailed
   * instead of rebuilt on every parity pass: union by size, no path compression, each set's nodes in
   * a ring (`ufNext`, `ufSize`), every union pushed on `ufTrail` so `undo` can split it again.
   * Colouring's relations go into it too and stay until undone. Null until the first parity pass,
   * which decides.
   */
  private trailed: boolean | null = null;
  /** Edges on the trail before this position are in the trailed union-find. */
  private ufSeen = 0;
  /** Roots attached under another root, in order (trailed mode). */
  private readonly ufTrail: number[] = [];
  /** Open edges a union found between the two sets it joined (trailed mode). */
  private readonly decided: number[] = [];
  /** Trailed mode: the next colouring pass looks at every clue cell, not just the queued ones. */
  private colourAll = true;
  /**
   * Colouring. These arrays are allocated on the first colouring pass (`initColour`), so a puzzle
```

Edit 2.1.4. Replace

```ts
      closed: this.closed,
      scan: this.cornerScan,
    };
  }
```

with

```ts
      closed: this.closed,
      scan: this.cornerScan,
      uf: this.ufTrail.length,
      ufSeen: this.ufSeen,
      colourPending: this.colourAll || this.colourLen > 0,
    };
  }
```

Edit 2.1.5. Replace

```ts
    this.closed = m.closed;
    if (m.scan < this.cornerScan) this.cornerScan = m.scan;
    this.clearQueue();
    while (this.cqLen > 0) this.dequeueCorner();
```

with

```ts
    this.closed = m.closed;
    if (m.scan < this.cornerScan) this.cornerScan = m.scan;
    if (this.ufTrail.length > m.uf) {
      this.splitTo(m.uf);
      // Cells queued since the mark were queued by unions now undone. If none was queued then,
      // every cell was at its fixpoint; otherwise look at all of them again.
      if (m.colourPending) this.colourAll = true;
      else while (this.colourLen > 0) this.dequeueColour();
    }
    this.ufSeen = m.ufSeen;
    this.clearQueue();
    while (this.cqLen > 0) this.dequeueCorner();
```

Edit 2.1.6. Replace

```ts
   * separates cells of different sides, a cross joins cells of the same side. Union-find with
   * parity over the cells plus one "outside" node (index cellCount) links cells whose relative
   * side is known; an open edge between two linked cells is then decided. Returns the number of
   * edges set, or -1 on a contradiction.
   */
  private parity(): number {
    const { grid, edges, ufParent, ufParity } = this;
    const C = grid.cellCount;
```

with

```ts
   * separates cells of different sides, a cross joins cells of the same side. Union-find with
   * parity over the cells plus one "outside" node (index cellCount) links cells whose relative
   * side is known; an open edge between two linked cells is then decided. Rebuilt on every pass
   * while steps are recorded, so each pass decides its edges in index order; otherwise trailed
   * (`parityTrailed`). Returns the number of edges set, or -1 on a contradiction.
   */
  private parity(): number {
    if (this.trailed === null) {
      this.trailed = this.steps === null;
      if (this.trailed) this.initTrailed();
    }
    if (this.trailed) return this.parityTrailed();
    const { grid, edges, ufParent, ufParity } = this;
    const C = grid.cellCount;
```

Edit 2.1.7. Replace

```ts
  }

  /** Root of `x`'s set; leaves the parity of `x` relative to the root in `ufFound`. */
  private ufFind(x: number): number {
    const { ufParent, ufParity } = this;
```

with

```ts
  }

  /** Sets up the trailed union-find: every node alone. Allocates the colouring arrays too. */
  private initTrailed(): void {
    if (this.ufNext.length === 0) this.initColour();
    const n = this.grid.cellCount + 1;
    for (let x = 0; x < n; x++) {
      this.ufParent[x] = x;
      this.ufParity[x] = 0;
      this.ufNext[x] = x;
      this.ufSize[x] = 1;
    }
  }

  /**
   * Parity with the trailed union-find: adds the edges set since the last pass, then decides the
   * open edges between the sets those unions joined. Same result as rebuilding (the relations are
   * the same, and no open edge is left inside a set after a pass). Returns the number of edges set,
   * or -1 on a contradiction.
   */
  private parityTrailed(): number {
    const { grid, edges, edgeTrail } = this;
    for (; this.ufSeen < edgeTrail.length; this.ufSeen++) {
      const e = edgeTrail[this.ufSeen];
      const x = edges[e] === Line ? 1 : 0;
      if (!this.unite(sideNode(grid, e, 0), sideNode(grid, e, 1), x)) {
        this.decided.length = 0;
        return -1;
      }
    }
    const set = this.assignDecided();
    // The edges just set join nodes already in one set: nothing to add for them.
    if (set > 0) this.ufSeen = edgeTrail.length;
    return set;
  }

  /**
   * Trailed mode: records "nodes u and v are on different sides exactly when x is 1". False when the
   * union-find already says otherwise. When it joins two sets, first notes in `decided` the open
   * edges between them (found from the smaller set) and queues the clue cells at or beside the
   * smaller set's nodes for colouring (every cell with nodes in both sets has one there).
   */
  private unite(u: number, v: number, x: number): boolean {
    const { grid, edges, ufParent, ufParity, ufSize, ufNext } = this;
    let small = this.ufFind(u);
    const pu = this.ufFound;
    let large = this.ufFind(v);
    const pv = this.ufFound;
    if (small === large) return (pu ^ pv) === x;
    if (ufSize[small] > ufSize[large]) {
      const t = small;
      small = large;
      large = t;
    }
    const C = grid.cellCount;
    let n = small;
    do {
      if (this.colourOn) this.queueAround(n);
      const list = n === C ? this.borderEdges : grid.cellEdges;
      const from = n === C ? 0 : n * 4;
      const to = n === C ? list.length : from + 4;
      for (let k = from; k < to; k++) {
        const e = list[k];
        if (edges[e] !== Unknown) continue;
        const a = sideNode(grid, e, 0);
        if (this.ufFind(a === n ? sideNode(grid, e, 1) : a) === large) this.decided.push(e);
      }
      n = ufNext[n];
    } while (n !== small);
    ufParent[small] = large;
    ufParity[small] = pu ^ pv ^ x;
    this.joinRings(small, large);
    this.ufTrail.push(small);
    return true;
  }

  /** Trailed mode: sets the edges in `decided`, whose sides are now in one set. -1 on a contradiction. */
  private assignDecided(): number {
    const { grid, decided } = this;
    let set = 0;
    for (let k = 0; k < decided.length; k++) {
      const e = decided[k];
      this.ufFind(sideNode(grid, e, 0));
      const pa = this.ufFound;
      this.ufFind(sideNode(grid, e, 1));
      if (!this.assign(e, pa !== this.ufFound ? Line : Cross)) {
        decided.length = 0;
        return -1;
      }
      set++;
    }
    decided.length = 0;
    return set;
  }

  /** Trailed mode: undoes unions until `ufTrail` has `length` entries. */
  private splitTo(length: number): void {
    const { ufTrail, ufParent, ufParity, ufSize, ufNext } = this;
    while (ufTrail.length > length) {
      const s = ufTrail.pop() as number;
      const l = ufParent[s];
      ufSize[l] -= ufSize[s];
      const t = ufNext[s];
      ufNext[s] = ufNext[l];
      ufNext[l] = t;
      ufParent[s] = s;
      ufParity[s] = 0;
    }
  }

  /**
   * Root of `x`'s set; leaves the parity of `x` relative to the root in `ufFound`. Compresses the
   * path unless the union-find is trailed (`undo` could not put it back).
   */
  private ufFind(x: number): number {
    const { ufParent, ufParity } = this;
```

Edit 2.1.8. Replace

```ts
      p ^= ufParity[root];
      root = ufParent[root];
    }
    // Path compression: point every node on the way straight at the root.
```

with

```ts
      p ^= ufParity[root];
      root = ufParent[root];
    }
    if (this.trailed) {
      this.ufFound = p;
      return root;
    }
    // Path compression: point every node on the way straight at the root.
```

Edit 2.1.9. Replace

```ts
   */
  private colour(): number {
    if (this.ufNext.length === 0) this.initColour();
    const { colourCells } = this;
```

with

```ts
   */
  private colour(): number {
    if (this.trailed) return this.colourTrailed();
    if (this.ufNext.length === 0) this.initColour();
    const { colourCells } = this;
```

Edit 2.1.10. Replace

```ts
        while (this.colourLen > 0) this.dequeueColour();
        if (!ok) return -1;
      }
    }
```

with

```ts
        while (this.colourLen > 0) this.dequeueColour();
        if (!ok) return -1;
      }
    }
    return this.colourSet;
  }

  /**
   * Colouring on the trailed union-find: its relations stay, so only the cells whose nodes a union
   * has joined since (queued by `unite`) need another look, or every cell after `colourAll`.
   */
  private colourTrailed(): number {
    if (this.colourAll) {
      this.colourAll = false;
      for (let x = 0; x < this.colourCells.length; x++) this.queueColour(this.colourCells[x]);
    }
    this.colourSet = 0;
    while (this.colourLen > 0) {
      if (!this.colourCell(this.dequeueColour())) {
        while (this.colourLen > 0) this.dequeueColour();
        return -1;
      }
    }
```

Edit 2.1.11. Replace

```ts
  private colourJoin(i: number, known: number, a: number, b: number, x: number): boolean {
    const { ufParent, ufParity, ufSize, ufNext, cNode } = this;
    let small = this.ufFind(cNode[a]);
    const pa = this.ufFound;
```

with

```ts
  private colourJoin(i: number, known: number, a: number, b: number, x: number): boolean {
    const { ufParent, ufParity, ufSize, ufNext, cNode } = this;
    if (this.trailed) {
      // The union-find is trailed: `unite` finds the edges to decide and the cells to queue.
      if (!this.unite(cNode[a], cNode[b], x)) return false;
      const set = this.assignDecided();
      if (set < 0) return false;
      this.colourSet += set;
      return true;
    }
    let small = this.ufFind(cNode[a]);
    const pa = this.ufFound;
```

### 2.2 `packages/core/src/engine.test.ts`

- Replace the imports (first three lines) with:

```ts
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { Budget, Engine, type Mark } from "./engine.ts";
import { parsePuzzle } from "./format.ts";
import { createGrid, EdgeState } from "./grid.ts";
import { generateLoop } from "./loop.ts";
import { createPuzzle, deriveClues, NO_CLUE } from "./puzzle.ts";
import { createRng } from "./rng.ts";
```

- After the test "probes run the corner rules only when probeCorners is on (the verifier after deepen)" (inside the `describe`), add:

```ts

  test("without steps, undoing to a mark taken before colouring's first pass makes it look at every clue again", () => {
    // A 2 in a one-wide strip: only colouring settles it (see the corner-probe test). The mark is
    // taken before colouring has looked at any clue, so after `undo` it has to look at all of them.
    const budget = new Budget(Date.now, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const engine = new Engine(puzzle(1, 3, ".2."), budget);
    expect(engine.local()).toBe(true);
    const m = engine.mark();
    expect(engine.propagate(false)).toBe(true);
    expect(engine.closed).toBe(true);
    const first = engine.edges.slice();
    engine.undo(m);
    expect(engine.propagate(false)).toBe(true);
    expect(engine.edges).toEqual(first);
  });

  test("without steps it keeps parity's union-find through sets and undos, as rebuilding finds", () => {
    // An engine that records no steps keeps parity's union-find (and colouring's relations in it)
    // between passes and undoes it with the edges, as the verifier's search does; one that records
    // steps rebuilds it on every pass. Given the same sets and undos, they agree after every one.
    // With connectivity on too, as after `deepen`.
    const budget = () => new Budget(Date.now, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.double({ min: 0.2, max: 0.9, noNaN: true }),
        fc.boolean(),
        fc.array(fc.tuple(fc.nat({ max: 3 }), fc.nat(), fc.boolean()), { maxLength: 40 }),
        (w, h, seed, keep, connectivity, moves) => {
          const grid = createGrid(w, h);
          const rng = createRng(seed);
          const clues = Array.from(deriveClues(grid, generateLoop(grid, rng)), (k) =>
            k < 4 && rng.float() < keep ? k : NO_CLUE,
          );
          const p = createPuzzle(w, h, clues);
          const trailed = new Engine(p, budget(), { connectivity });
          const rebuilt = new Engine(p, budget(), { connectivity });
          rebuilt.steps = [];
          expect(trailed.solveRoot(false)).toBe(true);
          expect(rebuilt.solveRoot(false)).toBe(true);
          expect(trailed.edges).toEqual(rebuilt.edges);
          const marks: [Mark, Mark][] = [];
          const back = () => {
            const [a, b] = marks.pop() as [Mark, Mark];
            trailed.undo(a);
            rebuilt.undo(b);
            expect(trailed.edges).toEqual(rebuilt.edges);
          };
          for (const [undo, pick, line] of moves) {
            if (undo === 0 || trailed.closed) {
              if (marks.length > 0) back();
              continue;
            }
            const open = [...trailed.edges.keys()].filter(
              (e) => trailed.edges[e] === EdgeState.Unknown,
            );
            if (open.length === 0) break;
            const e = open[pick % open.length];
            const state = line ? EdgeState.Line : EdgeState.Cross;
            marks.push([trailed.mark(), rebuilt.mark()]);
            const ok = trailed.set(e, state) && trailed.propagate(false);
            expect(rebuilt.set(e, state) && rebuilt.propagate(false)).toBe(ok);
            if (ok) expect(trailed.edges).toEqual(rebuilt.edges);
            else back();
          }
        },
      ),
      { numRuns: 300 },
    );
  });
```

The first test fails if `undo` forgets `colourAll` (the mark is taken while every clue is still to be looked at); the second runs a trailed and a rebuilding engine in lockstep through random sets and undos, with and without connectivity (300 runs, about 0.15 s). It does not compare against an engine solving from scratch: tier 1 has a known order dependence (`generate.ts`, "One theoretical gap is left": a premature-loop crossing skipped because closing would have completed the solution is not looked at again when a line is added elsewhere), which main shows too.

### 2.3 `packages/core/src/agreement.test.ts`

In `checkAgainstBruteForce`, after the `for (const rules of [undefined, ["corners"], …])` loop's closing `}` and before the function's closing `}`, add:

```ts
  // Without steps the engine works incrementally (DECISIONS, WT19) but finds the same status.
  for (const rules of [undefined, []] as const) {
    expect(solve(p, { rules, steps: false }).status).toBe(solve(p, { rules }).status);
  }
```

(Adds about 0.5–1 s to the agreement file.)

### 2.4 `packages/core/AGENTS.md`

In the bullet that starts "`solve` and `verify` share one internal deduction engine.", replace "The brute-force agreement tests are the safety net," with:

```md
Without recorded steps (the verifier, those clue tests) the engine keeps parity's union-find between passes and undoes it with the edges, so only the fixpoint is the same, not the order of deductions; a rule that touches the union-find has to work both ways (`engine.test.ts` runs the two in lockstep). The brute-force agreement tests are the safety net,
```

Verify: `bun run check` (843 pass, 3 skip; golden tests unchanged). Optional: `bun run --cwd packages/core bench`, same statuses and nodes, faster lines. Commit.

## Step 3 — Cheaper connectivity walks

`perf(core): cheaper connectivity walks; the root's detect-only check waits for lookahead`

### 3.1 `packages/core/src/engine.ts`

Apply these edits in order (afterwards the file equals the engine in `wt19-final.diff`):

Edit 3.1.1. Replace

```ts
 *
 * When no steps are recorded (the verifier, generation's clue tests) the order of deductions does
 * not matter, only the fixpoint, so parity and colouring work incrementally: parity's union-find
 * is trailed and undone with the edges, and colouring looks again only at the clues a union
 * touched.
 */
import { EdgeState, type Grid, NONE } from "./grid.ts";
```

with

```ts
 *
 * When no steps are recorded (the verifier, generation's clue tests) the order of deductions does
 * not matter, only the fixpoint, so the global tiers work incrementally: parity's union-find is
 * trailed and undone with the edges, colouring looks again only at the clues a union touched, and
 * lookahead's passes leave the detect-only connectivity check until lookahead finds nothing.
 */
import { EdgeState, type Grid, NONE } from "./grid.ts";
```

Edit 3.1.2. Replace

```ts
  private rings = false;
  private readonly seen: Uint8Array;
  private readonly order: Int32Array;
  private readonly stack: Int32Array;
```

with

```ts
  private rings = false;
  private readonly seen: Uint8Array;
  /**
   * Marks for `connected` and `pairFeasible`: dot d was reached in the current walk when
   * `reach[d] === walk` (and cell c marked when `cellMark[c] === walk`), so nothing is cleared
   * between walks (`nextWalk`).
   */
  private readonly reach: Int32Array;
  private walk = 0;
  /** Cells with a clue above 0, in index order; built on first use (`positiveCells`). */
  private positive: Int32Array | null = null;
  private readonly order: Int32Array;
  private readonly stack: Int32Array;
```

Edit 3.1.3. Replace

```ts
  private bcEdges = new Int32Array(0);
  private blockOf = new Int32Array(0);
  private faceParent = new Int32Array(0);
  private groupNext = new Int32Array(0);
```

with

```ts
  private bcEdges = new Int32Array(0);
  private blockOf = new Int32Array(0);
  /** Lines in each block, counted by `blocks`. */
  private blockLines = new Int32Array(0);
  /** For each dot and `dotEdges` slot, the dot at the other end (connectivity scratch). */
  private dotNext = new Int32Array(0);
  /** `pairFeasible`'s second queue of dots (the first is `stack`), and cell marks (see `reach`). */
  private pieceQueue = new Int32Array(0);
  private cellMark = new Int32Array(0);
  private faceParent = new Int32Array(0);
  private groupNext = new Int32Array(0);
```

Edit 3.1.4. Replace

```ts
    this.ufParity = new Uint8Array(grid.cellCount + 1);
    this.seen = new Uint8Array(grid.dotCount);
    this.stack = new Int32Array(grid.dotCount);
    this.inGroup = new Uint8Array(grid.edgeCount);
```

with

```ts
    this.ufParity = new Uint8Array(grid.cellCount + 1);
    this.seen = new Uint8Array(grid.dotCount);
    this.reach = new Int32Array(grid.dotCount);
    this.stack = new Int32Array(grid.dotCount);
    this.inGroup = new Uint8Array(grid.edgeCount);
```

Edit 3.1.5. Replace

```ts
        if (c > 0) continue;
      }
      if (this.connectOn) {
        const k = this.connectivity();
        if (k < 0) return false;
        if (k > 0) continue;
      } else if (!this.connected()) return false;
      if (!lookahead) return true;
      const q = this.lookahead();
      if (q < 0) return false;
      if (q > 0) continue;
      if (this.colourOn && last) {
        const c = this.colour();
```

with

```ts
        if (c > 0) continue;
      }
      // Without recorded steps, lookahead's passes leave the check for when lookahead finds nothing:
      // it only finds contradictions, and one now is still one then (DECISIONS, WT19).
      const later = lookahead && !this.connectOn && this.steps === null;
      if (this.connectOn) {
        const k = this.connectivity();
        if (k < 0) return false;
        if (k > 0) continue;
      } else if (!later && !this.connected()) return false;
      if (!lookahead) return true;
      const q = this.lookahead();
      if (q < 0) return false;
      if (q > 0) continue;
      if (later && !this.connected()) return false;
      if (this.colourOn && last) {
        const c = this.colour();
```

Edit 3.1.6. Replace

```ts
   */
  private connected(): boolean {
    const { grid, edges, clues, seen, stack, inGroup } = this;
    const first = edges.indexOf(Line);
    if (first < 0) return true;
    const seed = grid.edgeDots[first * 2];
    seen.fill(0);
    seen[seed] = 1;
    stack[0] = seed;
    let top = 1;
    while (top > 0) {
      const d = stack[--top];
      for (let j = 0; j < 4; j++) {
        const e = grid.dotEdges[d * 4 + j];
        if (e === NONE || edges[e] === Cross || inGroup[e]) continue;
        const o = otherDot(grid, e, d);
        if (!seen[o]) {
          seen[o] = 1;
          stack[top++] = o;
        }
      }
    }
    for (let e = first + 1; e < grid.edgeCount; e++) {
      if (edges[e] !== Line || seen[grid.edgeDots[e * 2]]) continue;
      if (this.steps !== null) {
        this.exitCells = [];
        this.exitDots = [seed, grid.edgeDots[e * 2]].sort((a, b) => a - b);
      }
      return false;
    }
    for (let i = 0; i < grid.cellCount; i++) {
      if (clues[i] <= 0) continue;
      let reached = false;
      for (let j = 0; j < 4 && !reached; j++) {
        const e = grid.cellEdges[i * 4 + j];
        reached = edges[e] !== Cross && !inGroup[e] && seen[grid.edgeDots[e * 2]] === 1;
      }
      if (reached) continue;
      if (this.steps !== null) {
        this.exitCells = [i];
        this.exitDots = [seed];
      }
      return false;
    }
    return true;
  }

```

with

```ts
   */
  private connected(): boolean {
    const { grid, edges, stack, inGroup, reach } = this;
    const first = edges.indexOf(Line);
    if (first < 0) return true;
    const seed = grid.edgeDots[first * 2];
    const walk = this.nextWalk();
    reach[seed] = walk;
    stack[0] = seed;
    let top = 1;
    // Each line is met once from each end, and both ends are reached when one is.
    let lineEnds = 0;
    while (top > 0) {
      const d = stack[--top];
      for (let j = 0; j < 4; j++) {
        const e = grid.dotEdges[d * 4 + j];
        if (e === NONE) continue;
        const s = edges[e];
        if (s === Cross || inGroup[e]) continue;
        if (s === Line) lineEnds++;
        const o = otherDot(grid, e, d);
        if (reach[o] !== walk) {
          reach[o] = walk;
          stack[top++] = o;
        }
      }
    }
    let ok = lineEnds === 2 * this.lineCount;
    const positive = this.positiveCells();
    for (let x = 0; x < positive.length && ok; x++) {
      const i = positive[x];
      let reached = false;
      for (let j = 0; j < 4 && !reached; j++) {
        const e = grid.cellEdges[i * 4 + j];
        reached = edges[e] !== Cross && !inGroup[e] && reach[grid.edgeDots[e * 2]] === walk;
      }
      ok = reached;
    }
    if (ok) return true;
    if (this.steps !== null) this.exitReason(seed, walk);
    return false;
  }

  /** The cells with a clue above 0, in index order. */
  private positiveCells(): Int32Array {
    if (this.positive === null) {
      const cells: number[] = [];
      for (let i = 0; i < this.grid.cellCount; i++) if (this.clues[i] > 0) cells.push(i);
      this.positive = Int32Array.from(cells);
    }
    return this.positive;
  }

  /** A new mark for `reach` and `cellMark`; clears them long before the counter could overflow. */
  private nextWalk(): number {
    if (this.walk === 0x3fffffff) {
      this.reach.fill(0);
      this.cellMark.fill(0);
      this.walk = 0;
    }
    return ++this.walk;
  }

  /**
   * Why `connected` just failed, in `exitCells` and `exitDots`: the first line it did not reach
   * (with the seed's dot), else the first clue it did not reach (with the seed's dot).
   */
  private exitReason(seed: number, walk: number): void {
    const { grid, edges, inGroup, reach } = this;
    const positive = this.positiveCells();
    for (let e = 0; e < grid.edgeCount; e++) {
      if (edges[e] !== Line || reach[grid.edgeDots[e * 2]] === walk) continue;
      this.exitCells = [];
      this.exitDots = [seed, grid.edgeDots[e * 2]].sort((a, b) => a - b);
      return;
    }
    for (let x = 0; x < positive.length; x++) {
      const i = positive[x];
      let reached = false;
      for (let j = 0; j < 4 && !reached; j++) {
        const e = grid.cellEdges[i * 4 + j];
        reached = edges[e] !== Cross && !inGroup[e] && reach[grid.edgeDots[e * 2]] === walk;
      }
      if (reached) continue;
      this.exitCells = [i];
      this.exitDots = [seed];
      return;
    }
  }

```

Edit 3.1.7. Replace

```ts
   */
  private connectivity(): number {
    const { grid, edges, clues } = this;
    if (this.lineCount === 0) return 0;
    if (this.blockOf.length === 0) this.initConnect();
    this.blocks();
    const { blockOf } = this;
    let target = NONE;
    for (let e = 0; e < grid.edgeCount; e++) {
      if (edges[e] !== Line) continue;
      if (target === NONE) target = blockOf[e];
      else if (blockOf[e] !== target) return -1;
    }
    for (let i = 0; i < grid.cellCount; i++) {
      if (clues[i] <= 0) continue;
      let reached = false;
      for (let j = 0; j < 4 && !reached; j++) {
```

with

```ts
   */
  private connectivity(): number {
    const { grid, edges } = this;
    if (this.lineCount === 0) return 0;
    if (this.blockOf.length === 0) this.initConnect();
    this.blocks();
    const { blockOf } = this;
    const positive = this.positiveCells();
    // Every line in one block: the first line's block holds them all.
    const target = blockOf[edges.indexOf(Line)];
    if (this.blockLines[target] !== this.lineCount) return -1;
    for (let x = 0; x < positive.length; x++) {
      const i = positive[x];
      let reached = false;
      for (let j = 0; j < 4 && !reached; j++) {
```

Edit 3.1.8. Replace

```ts
    this.bcEdges = new Int32Array(E);
    this.blockOf = new Int32Array(E);
    this.faceParent = new Int32Array(C + 1);
    this.groupNext = new Int32Array(E);
```

with

```ts
    this.bcEdges = new Int32Array(E);
    this.blockOf = new Int32Array(E);
    this.blockLines = new Int32Array(E);
    this.dotNext = new Int32Array(D * 4).fill(NONE);
    this.pieceQueue = new Int32Array(D);
    this.cellMark = new Int32Array(C);
    for (let d = 0; d < D; d++) {
      for (let j = 0; j < 4; j++) {
        const e = this.grid.dotEdges[d * 4 + j];
        if (e !== NONE) this.dotNext[d * 4 + j] = otherDot(this.grid, e, d);
      }
    }
    this.faceParent = new Int32Array(C + 1);
    this.groupNext = new Int32Array(E);
```

Edit 3.1.9. Replace

```ts
   */
  private blocks(): void {
    const { grid, edges, bcDisc: disc, bcLow: low, bcSlot: slot, bcVia: via } = this;
    const { stack: dots, bcEdges: stack, blockOf } = this;
    disc.fill(0);
    blockOf.fill(NONE);
    let time = 0;
    let blocks = 0;
    for (let r = 0; r < grid.dotCount; r++) {
      if (disc[r] !== 0) continue;
      let top = 0;
      let etop = 0;
      dots[top++] = r;
      disc[r] = low[r] = ++time;
      slot[r] = 0;
      via[r] = NONE;
      while (top > 0) {
        const v = dots[top - 1];
        if (slot[v] < 4) {
          const e = grid.dotEdges[v * 4 + slot[v]++];
          if (e === NONE || edges[e] === Cross || e === via[v]) continue;
          const w = otherDot(grid, e, v);
          if (disc[w] === 0) {
            stack[etop++] = e;
            via[w] = e;
            disc[w] = low[w] = ++time;
            slot[w] = 0;
            dots[top++] = w;
          } else if (disc[w] < disc[v]) {
            stack[etop++] = e;
            if (disc[w] < low[v]) low[v] = disc[w];
          }
          continue;
        }
        top--;
        const f = via[v];
        if (f === NONE) continue;
        const u = otherDot(grid, f, v);
        if (low[v] < low[u]) low[u] = low[v];
        if (low[v] >= disc[u]) {
          // u separates v's subtree: the edges stacked since f form one block.
          let g: number;
          do {
            g = stack[--etop];
            blockOf[g] = blocks;
          } while (g !== f);
          blocks++;
        }
      }
    }
```

with

```ts
   */
  private blocks(): void {
    const { grid, edges, bcDisc: disc, bcLow: low, bcSlot: slot, bcVia: via, dotNext } = this;
    const { stack: dots, bcEdges: stack, blockOf, blockLines } = this;
    const { dotEdges } = grid;
    disc.fill(0);
    blockOf.fill(NONE);
    // Only the part of the graph holding the lines: edges anywhere else are in no block of theirs.
    const r = grid.edgeDots[edges.indexOf(Line) * 2];
    let time = 1;
    let blocks = 0;
    let top = 0;
    let etop = 0;
    dots[top++] = r;
    disc[r] = low[r] = time;
    slot[r] = 0;
    via[r] = NONE;
    while (top > 0) {
      const v = dots[top - 1];
      const k = slot[v];
      if (k < 4) {
        slot[v] = k + 1;
        const e = dotEdges[v * 4 + k];
        if (e === NONE || edges[e] === Cross || e === via[v]) continue;
        const w = dotNext[v * 4 + k];
        const dw = disc[w];
        if (dw === 0) {
          stack[etop++] = e;
          via[w] = e;
          disc[w] = low[w] = ++time;
          slot[w] = 0;
          dots[top++] = w;
        } else if (dw < disc[v]) {
          stack[etop++] = e;
          if (dw < low[v]) low[v] = dw;
        }
        continue;
      }
      top--;
      if (top === 0) break;
      const u = dots[top - 1];
      const f = via[v];
      if (low[v] < low[u]) low[u] = low[v];
      if (low[v] >= disc[u]) {
        // u separates v's subtree: the edges stacked since f form one block.
        let g: number;
        let lines = 0;
        do {
          g = stack[--etop];
          blockOf[g] = blocks;
          if (edges[g] === Line) lines++;
        } while (g !== f);
        blockLines[blocks++] = lines;
      }
    }
```

Edit 3.1.10. Replace

```ts
    const { inGroup, groupFirst, groupNext } = this;
    for (let e = groupFirst[g]; e !== NONE; e = groupNext[e]) inGroup[e] = 1;
    const ok = this.connected();
    for (let e = groupFirst[g]; e !== NONE; e = groupNext[e]) inGroup[e] = 0;
    return ok;
  }

```

with

```ts
    const { inGroup, groupFirst, groupNext } = this;
    for (let e = groupFirst[g]; e !== NONE; e = groupNext[e]) inGroup[e] = 1;
    const ok =
      this.steps === null && this.groupSize[g] === 2
        ? this.pairFeasible(groupFirst[g])
        : this.connected();
    for (let e = groupFirst[g]; e !== NONE; e = groupNext[e]) inGroup[e] = 0;
    return ok;
  }

  /**
   * `groupFeasible` for a group of two edges, without recorded steps. Every line and every open
   * edge is in one block here (`cutOff` found nothing), so crossing both edges leaves two pieces,
   * one at each end of `e`, the group's first edge. Walks both at once, a dot at a time, and stops
   * when one is done, so it pays for the smaller piece only. If the walks meet, the pieces are one
   * after all and `connected` decides.
   */
  private pairFeasible(e: number): boolean {
    const { grid, reach, stack: qa, pieceQueue: qb } = this;
    const wa = this.nextWalk();
    const wb = this.nextWalk();
    qa[0] = grid.edgeDots[e * 2];
    qb[0] = grid.edgeDots[e * 2 + 1];
    reach[qa[0]] = wa;
    reach[qb[0]] = wb;
    let ha = 0;
    let ta = 1;
    let hb = 0;
    let tb = 1;
    for (;;) {
      if (ha === ta) return this.pieceFeasible(qa, ta, wa);
      if (hb === tb) return this.pieceFeasible(qb, tb, wb);
      ta = this.spread(qa[ha++], qa, ta, wa, wb);
      if (ta >= 0) tb = this.spread(qb[hb++], qb, tb, wb, wa);
      if (ta < 0 || tb < 0) return this.connected();
    }
  }

  /**
   * One step of `pairFeasible`'s walk marked `own`: queues the dots next to `d` over edges that are
   * neither crossed nor in the group at `q[tail]` onwards. Returns the new tail, or -1 when one of
   * them belongs to the other walk.
   */
  private spread(d: number, q: Int32Array, tail: number, own: number, other: number): number {
    const { grid, edges, inGroup, reach, dotNext } = this;
    for (let j = 0; j < 4; j++) {
      const e = grid.dotEdges[d * 4 + j];
      if (e === NONE || edges[e] === Cross || inGroup[e]) continue;
      const o = dotNext[d * 4 + j];
      if (reach[o] === own) continue;
      if (reach[o] === other) return -1;
      reach[o] = own;
      q[tail++] = o;
    }
    return tail;
  }

  /**
   * `pairFeasible` once the piece with dots `q[0..n)` (marked `w` in `reach`) is done. The loop
   * lies in this piece if it holds every line, in the other one if it holds none; with lines in
   * both there is no loop. Every clue above 0 needs a side in the loop's piece that is neither
   * crossed nor in the group.
   */
  private pieceFeasible(q: Int32Array, n: number, w: number): boolean {
    const { grid, edges, clues, inGroup, reach, cellMark, dotCells } = this;
    // Both ends of a line here are here: count each line at both.
    let lineEnds = 0;
    for (let x = 0; x < n; x++) {
      for (let j = 0; j < 4; j++) {
        const e = grid.dotEdges[q[x] * 4 + j];
        if (e !== NONE && edges[e] === Line) lineEnds++;
      }
    }
    const lines = lineEnds / 2;
    if (lines !== 0 && lines !== this.lineCount) return false;
    const mark = this.nextWalk();
    if (lines === this.lineCount) {
      // The loop is here: every clue above 0 needs a usable side here.
      let found = 0;
      for (let x = 0; x < n; x++) {
        for (let j = 0; j < 4; j++) {
          const e = grid.dotEdges[q[x] * 4 + j];
          if (e === NONE || edges[e] === Cross || inGroup[e]) continue;
          for (let k = 0; k < 2; k++) {
            const c = grid.edgeCells[e * 2 + k];
            if (c === NONE || clues[c] <= 0 || cellMark[c] === mark) continue;
            cellMark[c] = mark;
            found++;
          }
        }
      }
      return found === this.positiveCells().length;
    }
    // The loop is in the other piece: no clue above 0 may have all its usable sides here. Such a
    // clue has a side with an end here (a group edge has one), so it is beside one of these dots.
    for (let x = 0; x < n; x++) {
      for (let j = 0; j < 4; j++) {
        const c = dotCells[q[x] * 4 + j];
        if (c === NONE || clues[c] <= 0 || cellMark[c] === mark) continue;
        cellMark[c] = mark;
        let elsewhere = false;
        for (let s = 0; s < 4 && !elsewhere; s++) {
          const e = grid.cellEdges[c * 4 + s];
          elsewhere = edges[e] !== Cross && !inGroup[e] && reach[grid.edgeDots[e * 2]] !== w;
        }
        if (!elsewhere) return false;
      }
    }
    return true;
  }

```

Edit 3.1.11. Replace

```ts
      const e = (this.lookCursor + k) % E;
      if (this.edges[e] !== Unknown) continue;
      for (const assumed of [Line, Cross]) {
        this.budget.tick();
        this.probes++;
```

with

```ts
      const e = (this.lookCursor + k) % E;
      if (this.edges[e] !== Unknown) continue;
      for (let t = 0; t < 2; t++) {
        const assumed = t === 0 ? Line : Cross;
        this.budget.tick();
        this.probes++;
```

Verify: `bun run check` (843 pass, 3 skip); `bun run --cwd packages/core bench`: statuses and nodes as in the table. Commit.

## Step 4 — DECISIONS

`docs: WT19 decisions (verification speed)`

Append the three entries below to `docs/DECISIONS.md`, after the last WT18 entry. No other doc changes (PRD NFR-1 already allows `unknown`; TESTING.md's description of the gate is unchanged). Verify: `bun run check`. Commit.

## DECISIONS entries (step 4, verbatim)

```md
## 2026-10-26 · WT19 `verify-speed` · Without recorded steps, parity's union-find is kept and undone, not rebuilt
- **Question:** Parity rebuilt its union-find from every known edge on every pass, O(edges), and colouring re-derived all its relations on every pass. In the verifier's search and generation's clue tests, which read no steps, that was a large share of the time (23% of a deepened 30×30 search, 14–19% of root lookahead). Can they work incrementally without changing any answer, hint or generated puzzle?
- **Decision:** An engine that records no steps (decided at its first parity pass) keeps the union-find: union by size, no path compression, every union on a trail that `undo` pops (`Mark.uf`, `Mark.ufSeen`), each set's nodes in a ring. A parity pass adds the edges set since the last one; a union first notes the open edges between the two sets (walking the smaller one) and queues the clue cells at or beside it for colouring, and those edges are then decided. Colouring's relations go into the same union-find and stay until undone, so a colouring pass looks only at queued cells (every cell on its first pass, and again after an undo to a mark taken while cells were queued). An engine that records steps rebuilds as before, so steps and hints do not change. Without steps only the fixpoint is the same, not the order of deductions: `solve(…, { steps: false })` may stop on a different board when it ends in `contradiction` (it already did, compared with `steps: true`); generation never solves a contradictory board. `engine.test.ts` runs a trailed and a rebuilding engine in lockstep through random sets and undos.
- **Reason:** Paired against main, with identical search node counts and answers on every set measured: empty boards 0.12–0.85× (30×30 17 → 2.1 ms), editor drafts 0.38–0.67×, generated puzzles 0.53–0.90×, generated puzzles less one or two clues 0.34–0.75× (WT18's regression set 0.54×, its worst board 2.50 → 1.22 s against 1.79 s for the pre-WT18 verifier), 100×100 boards at 70% of clues 0.32×; this step alone gives 0.13–0.69× of that and the next entry the rest. `bench:generate --quick` p95 20×20 452 → 424 ms, 30×30 2.2 → 1.7 s, 40×40 7.5 → 5.9 s with identical output (120 seeds, steps and stats included; goldens unchanged).

## 2026-10-26 · WT19 `verify-speed` · Cheaper connectivity walks; the root's check waits for lookahead
- **Question:** With parity incremental, connectivity is most of the verifier's deepened search (blocks, two-exits and their walks about 80%), and the detect-only check runs after every lookahead deduction at the root. What can be cheaper without changing what they find?
- **Decision:** `connected` walks once with walk marks instead of clearing arrays, counts line ends on the way (all lines reached iff twice the line count) and looks only at the cells with a clue above 0; it works out why it failed (for a step's reason) only when steps are recorded. `blocks` runs Tarjan from the first line's dot only, with a table of neighbour dots, and counts lines per block, so `connectivity` checks one count instead of scanning every edge. A two-exits group of two edges is checked by walking both pieces left when they are crossed, a dot each in turn, and stopping when the smaller one is done (every line and open edge is in one block then, so there are exactly two pieces; if the walks meet, the full walk decides). Without steps and without the connectivity group, `propagate` leaves the detect-only check until lookahead finds nothing: it sets nothing, and a disconnected board stays disconnected as edges are added.
- **Reason:** On top of the previous entry: 0.84–0.98× (deepened 20×20 searches 0.84–0.85×, generated puzzles 0.88–0.89×); a deepened 30×30 search costs 47–49 µs a node (main 158–164 µs, the pre-WT18 verifier's shallow search 67–70 µs). Under the server's 30 s budget two of four 30×30 boards main left `unknown` now finish (`multiple` in 16 and 22 s); none went the other way. Probe and node counts unchanged.

## 2026-10-26 · WT19 `verify-speed` · The verifier keeps its search order and its 200-node threshold; `bench` gets hard cases
- **Question:** Should the deepening threshold, the deepened search's schedule or the branching edge change now that a node costs less?
- **Decision:** No. The threshold stays 200: 100 is within ±10%, and 500, 1 000 and 3 000 are 1.2–5.2× slower on the new solver's puzzles and no faster on long searches. Connectivity stays at every pass of every deepened node: only once per node, every other depth, or without two-exits gave mixed times and, for the last two, a board that ran out of nodes. The search still branches on the first open edge in reading order, cross first: `multiple` returns the first two solutions in that order, and the editor suggests a clue from them, so another order would change answers. Not taken either: batching lookahead's deductions (probes doubled, 1.06–1.43× slower), leaving the deepened root's connectivity until lookahead finds nothing (1.17–1.43×), checking the clock every 16 probes (about 4% of root-heavy runs, but it changes the documented budget behaviour). The roadmap's "skip colouring when no edge is open" has nothing to skip (with no open edge the loop has closed or tier 1 fails first), and the 3s patterns and corner rules already apply in every search node. `bench` gains the clue-gap corpus, empty and draft boards and generated puzzles less one or two clues at 10–30, with a 50 000-node cap so it stays a half-minute run.
- **Reason:** Measured after the two entries above (paired, `scratchpad/verify-speed`). The deepened search still costs 1.8–4× the same engine's shallow search per node where connectivity barely prunes (`blocks` about 40%, two-exits' faces and groups about 22% of it), but less per node than main's shallow search did; an incremental face union-find for two-exits is the next lever.
```

## Acceptance criteria

| Criterion | Check | PRD |
|---|---|---|
| Same answers as main: status and solutions, and the same search | `stress.ts` (6 000 `verify` runs at 4 thresholds, 480 on damaged generated puzzles: status, solutions, node counts), every set in the tables; `agreement.test.ts`, `verify.test.ts`, `clue-gaps.test.ts` unchanged and passing | FR-4, FR-5 |
| Trailed and rebuilt union-find agree through any sets and undos | `engine.test.ts` lockstep property (300 runs; 12 000 locally), colour re-look test; mutations listed above caught | NFR-3 |
| `solve` without steps finds the same status as with them | `agreement.test.ts` (70 930 puzzles, all groups and none); `solver.test.ts` "larger planted boards" (steps vs no steps, unchanged) | FR-3 |
| Hints and generation unchanged | goldens in `generate.test.ts` unchanged; 120 seeds identical (puzzle, stats, steps) | FR-6, FR-10 |
| Verification no slower than main beyond noise, faster where it matters | paired table: every set 0.12–1.00× (full30 1.00–1.02) except p10 (1.02–1.08 on 50 µs boards, A/A spread ±4.5%); `bench` lines equal or faster with identical statuses and nodes | NFR-1 |
| WT18's 20×20 regression fixed | `v5w2_drop1_20` 0.54× main; worst board 1.22 s against main 2.50 s and pre-WT18 1.79 s | NFR-1 |
| No `unknown` where main was definite under the 30 s budget | `timelim.ts`: 2 `unknown` → definite, 0 the other way | NFR-1, FR-27 |
| Generation within NFR-1 and identical | `bench:generate --quick` p95 ≤ 1.8 s to 30×30, 5.9 s at 40×40 | NFR-1, FR-10 |
| Gate | `bun run check` at each commit (843 pass, 3 skip); no API change | NFR-3 |

## Open questions

- Deepened per-node cost is still 1.8–4× the same engine's shallow search on boards connectivity barely helps. Next levers, not built: an incremental face union-find for two-exits (about 22% of a deepened search), and fewer full Tarjan passes (about 40%).
- A smarter branching order could shrink the long searches a lot (they are full binary trees over 10+ levels), but changes which two solutions `multiple` returns, and the editor's clue suggestion uses them. Needs a user decision before measuring.
- 100×100 generation (`bench-0..2`) was not re-run (assumption: faster, like 40×40, since its clue tests are no-steps solves).
