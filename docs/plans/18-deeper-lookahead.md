# WT18 `deeper-lookahead` — implementation plan

Branch `feat/deeper-lookahead`, worktree `/home/jhonnold/projects/loophole-wt/deeper-lookahead` (at `main` with WT13–17: windy loops, clue-gap harness, whole-board clue removal, corner rules and rule groups, clue colouring and `steps: false`). PRD: FR-3 (named deductions, recorded per step), FR-4/FR-5 (verifier correct, agreement with brute force), FR-6/FR-12 (steps power hints: highlight, rule explained), FR-10 (deterministic generation per version), NFR-1 (generation p95 < 10 s up to 30×30, < 30 s at 40×40, 100×100 within the 30 min job limit; verification must not get slower), NFR-3 (unit and property tests). Roadmap: WT18 row, "Each rules WT" and Decisions in `~/.claude/plans/read-through-the-prd-noble-squirrel.md`.

## Goal

Revised after plan review 1 (orchestrator decision: option B). The first version also ran the corner rules in `solve`'s lookahead probes; that is now off by default and used only by the deepened verifier (measurements of both below).

1. **Lookahead probes in `solve` stay tier 1.** The engine gains `probe()` and `EngineOptions.probeCorners` (default false): a probe can run tier 1 and the corner rules to their joint fixpoint, and only the verifier's `deepen()` turns that on. Corner probes in `solve` (option A) bought 6 corpus entries and 0.2–0.4 points of density for 1.7–2.5× generation time (100×100 seed `bench-2`: 1 313 s, 73% of the worker's 30 min limit) and no better hints; probes running every tier cost 18× at 20×20. They stay a lever for WT19/WT20.
2. **Connectivity deductions** (new rule group `"connectivity"`, three rule ids) replacing the detect-only `connected()` check when the group is on:
   - `unreachable` "Out of reach": open edges in a part of the graph of non-crossed edges that no line can reach are crossed.
   - `cut-off` "One way in": the loop is one simple cycle, so it lies in one block (biconnected component) of that graph; open edges in blocks hanging off the lines' block at one dot are crossed.
   - `two-exits` "Only ways across": open edges between the same two faces (regions of cells joined by crosses) are all lines or all crosses; when crossing them all would leave no part of the graph holding every line and a side of every clue above 0, they are all lines (the "pocket with two exits" rule, generalised).
3. **Verifier: same answers; long searches much faster, some boards slower.** `verify` keeps main's root (tier-1 probes, detect-only connectivity). When its search reaches 200 nodes it starts again from the root with the connectivity rules and corner probes (`VerifyOptions.deepenAfterNodes`, default 200). Below 200 nodes it does exactly what main does. Above, it is faster in aggregate (long searches 0.14–0.20×; generator "6" puzzles, which main cannot prove unique, verify in milliseconds) but not on every board: 20×20 boards with one clue dropped are 1.15–1.37× slower in aggregate and single boards up to about 2×, where connectivity barely prunes and each node costs more. WT19 (verify speed) owns tuning this.
4. Lookahead stays the last tier, so hints prefer named rules. The fixpoint stays order-independent (generation's `restored === 0` tests).
5. `GENERATOR_VERSION` "5" → "6", goldens, `gen:api` (rule enum), web patterns for the 3 rules, hint e2e `RULES`, the `bench:generate` header, DECISIONS entries with the numbers below.

Out of scope: corner probes in `solve` (option A, measured), parity/colouring/connectivity inside probes (measured, rejected for cost), the dual "region must be connected" colouring rule (articulation cells), incremental parity and verifier tuning (WT19), difficulty levels and PRD FR-3 wording (WT20).

## Measured (this machine, 16 cores, Bun 1.3.13; the code in this plan unless marked)

"Before" is `main` at 60342af run from a copy of `packages/core` (same seeds, same commands). "After" is the full working diff of this plan (option B; `…/scratchpad/deeper-lookahead/wt18-final.diff`). "A" is the first version of this plan (corner probes in `solve` too); its numbers come from the planner's runs and plan review 1 (`…/deeper-lookahead/review/out/`).

### Solver floor without lookahead (the roadmap's key metric), from the full clue set

`bun run --cwd packages/core bench:clue-gaps --no-lookahead`:

| Size | before | **after** (A is the same) |
|---|---|---|
| 5×5 | 44.0% | **43.5%** |
| 7×7 | 42.9% | **42.0%** |
| 10×10 | 42.4% | **42.0%** |
| 15×15 | 41.6% | **40.4%** |
| 20×20 | 43.5% | **42.9%** |

All of it is the connectivity rules.

### `bench:clue-gaps` (every rule, with lookahead), before → after (A)

| Size | clues | gap | needed | unknown | solver floor | verifier floor (unknown) |
|---|---|---|---|---|---|---|
| 5×5 (100) | 41.1% → 41.1% (41.0) | 0.2% → 0.2% (0.0) | 99.8% → 99.8% | 0 → 0 | 41.1% → 41.1% | 41.0% → 41.0% |
| 7×7 (100) | 39.9% → 39.9% (39.7) | 0.8% → 0.8% (0.2) | 99.2% → 99.2% | 0 → 0 | 39.9% → 39.9% | 39.6% → 39.6% |
| 10×10 (50) | 39.7% → 39.7% (39.7) | 2.2% → 2.2% (1.4) | 97.6% → 97.8% | 4 → 0 | 39.7% → 39.7% | 39.0% (5) → 39.0% (0) |
| 15×15 (10) | 38.9% → 38.9% (38.9) | 1.5% → 1.6% (0.9) | 94.1% → 95.1% | 39 → 29 | 38.9% → 38.9% | 38.4% (42) → 38.4% (32) |
| 20×20 (10) | 41.2% → 41.1% (40.9) | 2.7% → 2.6% (0.8) | 92.1% → 94.2% | 85 → 52 | 41.2% → 41.1% | – |

(After: plan review 1's run of this code, `review/out/cg-B.txt`.) `removable` and `restored` stay 0.0%: generation is still exact. With lookahead, connectivity changes density and gaps little (lookahead found those deductions, more slowly); the verifier's deepening settles more of the harness's checks (`unknown` 85 → 52 at 20×20).

### Clue-gap corpus (`clue-gaps.test.ts`)

With lookahead 29 → 29 (A: 35). Without lookahead 8 → **11** (new: `5-81#5`, `5-95#3`, `10-0#77`). Every other subset list of main is unchanged (`["corners"]` 23, `[]` 3).

### Hint steps on generated puzzles (`generate(…).solve` from an empty board, seeds `bench-<n>`)

| Size | steps/puzzle | `lookahead` share (A) | `two-exits` | `cut-off` + `unreachable` |
|---|---|---|---|---|
| 10×10 (20) | 178 → 173 | 6.1% → **4.4%** (4.7%) | 1.2% | 0.2% |
| 20×20 (10) | 680 → 657 | 6.3% → **4.5%** (4.3%) | 1.2% | 0.4% |
| 40×40 (3) | 2571 → 2474 | 5.4% → **3.5%** (4.1%) | 1.2% | 0.4% |
| 100×100 `bench-0`/`1`/`2` | – / 15 741 / 15 562 → 14 801 / 15 201 / 15 026 | – / 5.6 / 6.3% → **4.3 / 4.3 / 4.9%** (5.6 / 6.1 / 6.7%) | | |

(The puzzles differ: generator "6" against "5".) Connectivity replaces about a third of the lookahead steps. `two-exits` steps set 2 edges in about 80% of cases (3–6 otherwise) and highlight two line dots, one on each side (87–98%), or a clue and a line dot; `cut-off` highlights its dot; `unreachable` highlights nothing, most often a single cell boxed in by crosses (4 edges). (Step shapes measured on A's puzzles; B's traces use the same rules.) Small-7's trace: 91 → 81 steps.

### Generation (`bench:generate --quick`, run alone), before → after (A, run with 3 jobs)

| Size | p95 | median | clues |
|---|---|---|---|
| 7×7 | 13 → 19 ms | 9 → 12 ms | 39.9% → 39.9% |
| 10×10 | 35 → 39 ms | 20 → 23 ms | 40.0% → 39.8% |
| 20×20 | 442 → 488 ms (1 175) | 327 → 355 ms | 40.0% → 39.8% |
| 30×30 | 2.2 → 2.6 s (6.6) | 1.8 → 1.9 s | 40.1% → 40.0% |
| 40×40 | 7.5 → **8.4 s** (19.1) | 5.2 → 6.0 s (10.6) | 40.6% → 40.6% |

Every result `unique`, first attempt 100%, restored 0.0%. 100×100 (plan review 1, `review/scripts/g100.ts`, all runs at once on a loaded host; every run restored 0, first attempt, unique):

| Seed | main | **after** | A |
|---|---|---|---|
| `bench-0` | 282 s (planner, next to one job) | **374 s**, 41.00% clues | 619 s, 40.94% |
| `bench-1` | 311 s, 41.91% | **415 s**, 41.78% | 698 s, 41.64% |
| `bench-2` (WT15's slow seed) | 730 s, 41.42% | **1 047 s**, 41.35% | 1 313 s (73% of the 30 min limit), 40.95% |

After is 1.1–1.4× main (connectivity costs about +25% of a solve: blocks every pass, two exits with chains skipped).

### Verification speed

Paired A/B (both engines in one process, alternating, median of 20 rounds; `maxNodes` 200 000, no time limit). The verifier is the same in A and after. Where no search reaches 200 nodes it does exactly main's work (identical node and probe counts):

| Set | after / before |
|---|---|
| clue-gap corpus (36) | 0.99 |
| generated "5" 20×20 (10), 40×40 (3) | 1.03, 0.98 |
| generated "3" 20×20 (10), 40×40 (3) | 1.00, 1.00 |
| windy 8×8 at 60% (30), 12×12 at 65% (10) | 1.02–1.03 (60 rounds), 1.04 |
| empty 8×8 (30) | 1.00–1.03 (60 rounds; A/A spread ±2%) |
| near-unique "5" 15×15 (12) | 1.04 |
| blob loops 30×30 at 70% (20), 100×100 at 70% (5), 100×100 every clue (5) | 0.95, 1.01, 1.00 |
| generated "6" (this code) 20×20 (10) | 1.04 (82 nodes both) |
| **near-unique "5" 20×20 (12)** | **0.031**: 203 363 → 2 784 nodes, 7.4 s → 0.23 s, 1 unknown → 0 |

Where searches do reach 200 nodes, the answer is the same but the speed goes both ways. Plan review 1 (`review/out/vs2-*.txt`, `hard.txt`; generator "5" boards 10×10 to 20×20 with 1 or 2 clues dropped or 1 changed, 2 seeds, about 1 200 boards; 0 status or solution differences, also with `deepenAfterNodes` 0, 1, 3 and 50 on 1 200 more):

- faster in aggregate on long searches: 2 clues dropped 15×15 0.14–0.16×, 20×20 0.19–0.20×; a 20×20 board 10.4 s → 66 ms; one that main left `unknown` after 120 s finished (`multiple`) in 51 s;
- slower where connectivity barely prunes and each node costs more: 20×20 with 1 clue dropped 1.15–1.37× in aggregate (69 745 against 78 047 nodes), single deepened boards up to 1.9–2.2×; a board that ran out of 200 000 nodes in both took 9.6 s against 5.3 s. So a board main settles in 17–30 s can now hit the server's 30 s limit and come back `unknown`.

On puzzles the new solver makes (`maxNodes` 20 000 for main):

| Set | main | after |
|---|---|---|
| generated "6" 40×40 (3) | 2 unique, 1 unknown, 22 527 nodes, 2.0 s | 3 unique, 538 nodes, **168 ms** |
| `bench`'s "minimal" boards built by the new `solve`, 10×10 (20) | 903 nodes, 16 ms | 376 nodes, 12 ms |
| the same, 30×30 (3) | 3 unknown, 3.0 s | 3 unique, 600 nodes, **45 ms** |

`bench` (verify), ms, median (p95):

| Case | before (2 runs) | after |
|---|---|---|
| 10×10 full | 0.1 (0.3) | 0.1 (0.3) |
| 30×30 full | 0.3 (0.4–0.5) | 0.3 (0.3) |
| 100×100 full | 1.9–2.4 (2.3–2.8) | 2.2 (2.3) |
| 10×10 70% | 0.1 (0.5) | 0.1 (0.4) |
| 30×30 70% | 0.5 (0.9–1.5) | 0.5 (0.8) |
| 100×100 70% | 14.7–18.1 (26.5–27.2) | 15.1 (22.9) |
| 10×10 minimal | 0.2–0.3 (0.5–0.6) | 0.3 (1.3) |
| 30×30 minimal | 5.0–5.8 (5.9–7.1) | 14.5 (16.0) |

The "minimal" lines compare different puzzles (built with each version's `solve`; main's verifier cannot finish the new 30×30 ones, table above).

Deepening threshold (`deepenAfterNodes`, paired, time relative to 200):

| Set | 50 | **200** | 1000 | never |
|---|---|---|---|---|
| generated "6" 40×40 (this code) | 0.75 | 1 | 2.2 | main: 1 unknown |
| "minimal" 30×30 (this code) | 0.59 | 1 | 3.7 | main: 3 unknown |
| generated "6" 20×20 (this code) | 1.05 | 1 | 1.01 | 1.04 |
| near-unique "6" 15×15 (A's generator) | 1.39 | 1 | 1.20 | 1.26 |
| near-unique "5" 15×15 | 1.33 | 1 | 1.00 | 1.00 |
| empty 8×8 | 2.25 | 1 | 0.96 | 0.63–1.0 (noisy) |
| windy 8×8 | 1.05 | 1 | 1.00 | 0.96 |

Of the values tried, 200 is the smallest that leaves every main-era set unchanged. Deepening right at the root (0) cost 1.6× on near-unique 15×15 boards (prototype). Deepening into connectivity only (no corner probes): a near-unique 20×20 went from 16 ms to `unknown` at 200 000 nodes (review, BV); deepening the root only and searching without connectivity loses most of the gain (2 clues dropped 20×20 0.90×; review, V).

### Order independence and soundness (scratch `stress18.ts`, `bf18.ts`; plan review 1's `review/scripts/st.ts`)

Run on this code (B) and, with the same counts and 0 failures, on A.

- `stress18.ts all` (planted windy puzzles up to 10×10, 20–100% of clues, 0–40% of the solution given, lookahead on/off, steps on/off, 8 subsets of groups): 12 000 solves sound; 24 000 solves from random subsets of a result give that result (with the other step mode); 24 000 from larger sound boards keep every decided edge; 6 000 solves with corners and connectivity off or without lookahead and connectivity equal main's, steps included; 1 373 verifications equal main's (status and solutions) and the same with `deepenAfterNodes` 0–2.
- `stress18.ts order` up to 25×25: 3 200 sound, 6 400 order, 6 400 monotone. `stress18.ts verify` up to 8×8: 3 000 + 3 000 verifications equal main's and each other.
- `bf18.ts` (every loop of 15 grid shapes from 1×7 to 4×4, 3×5, 2×8 and 1×12, 400 random clue sets each, partial boards): 192 000 solves over 8 group subsets × lookahead × steps agree with every brute-force solution; 12 000 verifications give the brute-force status.
- Review `st.ts` (planted loops up to 25×25 incl. 1- and 2-wide strips, up to 90% crosses given): 50 400 solves sound, steps on = off, 14 400 of 14 400 re-solves from half a result equal; the chain skip gave byte-identical results in 14 400 of 14 400 comparisons. Run on A in review round 1 and rerun on B in round 2 (`st2.ts`), with the same counts and 0 failures.
- This code: `bun run check` 841 pass, 3 skip; hint e2e 17 pass.

0 failures.

### Alternatives measured and not taken

| Variant | Result |
|---|---|
| **A: corner probes in `solve`** (first version of this plan) | Corpus 35/36, gap 0.0 / 0.2 / 1.4 / 0.9 / 0.8%, clues 0.2–0.4 points fewer; generation 1.7–2.5× after's (40×40 p95 19.1 s, 100×100 `bench-2` 1 313 s); `lookahead` share no lower (100×100 5.6–6.7% against 4.3–4.9%). |
| Probes run every tier but lookahead (`propagate(false)`) | Corpus 36/36, 20×20 clues 40.3 → 39.5%; generation 20×20 18× slower, O(edges²) per scan. |
| The same, only when a tier-1 scan finds nothing ("escalate") | 6.6 s at 20×20: every failing removal test ends with a full deep scan. |
| Tier-1 scan first, corner probes only when it finds nothing | Verifier 2.2× (generated "5" 20×20) and 3.3× (40×40). |
| Verifier with connectivity at every node (and the root) | 1.3–1.9× on corpus, generated "5", near-unique and empty boards. |
| Verifier with corner probes from the root | 1.65× on generated "5" 20×20 and 40×40. |
| Verifier deepening with corner probes but without connectivity | A's minimal 30×30 boards: 3 unknown (32 s for 3), against 46 ms with connectivity. |
| Two exits checking chains (walking their pieces) | Same output; +70% instead of +25% connectivity cost at 40×40. |
| Two exits grouped with a `Map` and arrays per pass | Same output; slower. |

## What was found (for the DECISIONS entries)

**Which tiers probes run.** Variants were built into one prototype engine and measured on the same seeds (`generate` 20×20, 6 seeds, mean): tier 1 only (main) 372 ms, corpus 29/36; tier 1 + corners 756 ms, corpus 35; every tier but lookahead (`propagate(false)` in the probe) 6.4 s, corpus 36; the same only when a tier-1 scan finds nothing ("escalate") 6.6 s; corner probes only once a tier-1 scan finds nothing ("esc2") 2.2–3.3× slower on the verifier. A full-tier probe costs O(edges) even when it decides nothing, so a scan is O(edges²). Corner probes stay incremental, and the first version of this plan used them in `solve` (option A). Plan review 1 compared A with B (tier-1 probes in `solve`, everything else the same): A solves 6 more corpus entries, halves the with-lookahead gap and keeps 0.2–0.4 points fewer clues, but generation is 1.7–2.5× B's (40×40 p95 19.1 s against 8.5 s; 100×100 seeds `bench-0`/`1`/`2` 619/698/1 313 s against 374/415/1 047 s, run together) and its hints lean on lookahead no less (10/20/40: 4.7/4.3/4.1% against 4.4/4.5/3.5%; 100×100: 5.6–6.7% against 4.3–4.9%). Orchestrator decision: B. The deepened verifier still needs corner probes (with connectivity only, a near-unique 20×20 went from 16 ms to `unknown` at 200 000 nodes).

**Probes and the WT16 hazards.** A probe with `probeCorners` narrows corner masks; they are trailed and `undo` restores them. `Mark` records `cornerScan` and `undo` puts it back (`if (m.scan < this.cornerScan) this.cornerScan = m.scan`), so a mark taken before (or during) the first corner pass scans those dots again: an engine test fails without that line. `cornerWhy` is not trailed: it changes only while steps are recorded, and nothing undoes while recording (probes set `steps = null`, the verifier records nothing). A probe never runs parity, so the `colourLast` colouring pass after lookahead still reads parity's union-find as the root built it; a later WT that runs parity in probes must rebuild it before that pass (the prototype did: `parity()` again).

**Connectivity: blocks.** The loop is one simple cycle in the graph of dots and non-crossed edges, and a simple cycle lies inside one biconnected component (block). So, once a line exists: every line is in one block (else contradiction), every clue above 0 has a non-crossed side in it (else contradiction), and every open edge in another block is crossed. Tarjan's algorithm (iterative) numbers the blocks in O(dots + edges), like the old `connected()` walk. Monotone: crossing edges only splits blocks, and more lines only pin the block. Before the first line it does nothing, like `connected()` (the prototype also pinned the block from the clues alone; left out for simplicity, not measured as useful). Bridges need no rule: an edge with the same face on both sides is already crossed by parity (one union-find set with even parity), which is the planar form of "a bridge is on no cycle".

**Connectivity: two exits.** In a planar graph, two edges with the same pair of faces on their sides (faces: cells joined across crossed edges, plus the outside) form a 2-edge cut: a closed curve through the two faces meets the graph only at those edges, and the loop crosses any closed curve an even number of times, so they are both lines or both crossed. All open edges between two faces are one such group (parity has already set the rest: a line or cross among them would link the two faces). If every edge of a group were crossed, the loop would lie in one piece of the graph without them; the rule walks the piece of the first line and, when it misses a line or every non-crossed side of some clue above 0, sets the whole group to lines. Exact for each group, so sound; crossing edges only merges faces and splits pieces, so monotone. Groups are found in O(edges) with a union-find over faces and a hash table on face pairs. Most groups (about 99% at 40×40) are chains: paths through dots with no other open edge, whose only other pieces are those dots; with every line in the rest, a chain can only be forced by a clue whose open sides all lie on it, and then clue-needs-all and dot-continue set the same edges (or the board has no solution), so chains are skipped without a walk. Skipping them left generator output byte-identical and cut the rule's cost from +70% to +25% of a generated 40×40 solve.

**Connectivity in the verifier.** Puzzles the new solver makes rely on connectivity, which main's verifier lacks: of 3 generated 40×40, main proves 2 and leaves 1 `unknown` at 20 000 nodes; of `bench`'s minimal 30×30 boards built by the new `solve`, none. Running connectivity at every verifier node cost 1.3–1.9× on boards that need neither (prototype); running it only after a long search costs nothing on them. So `verify` starts as main does and, at 200 search nodes, undoes to the root, turns on connectivity and corner probes (`Engine.deepen`), propagates with lookahead and searches again. Corner probes are part of it because connectivity alone leaves some near-unique boards `unknown` (review: one 20×20 went from 16 ms to 200 000 nodes). The search finds solutions in the same order either way (depth-first in reading order, cross first, with sound pruning: the first two solutions in that order), so the answer is the same; an agreement test checks `deepenAfterNodes: 0` against the default on all 70 930 small puzzles. It is not faster on every board: where deepening fires but connectivity prunes little, each node costs more (20×20 boards with one clue dropped 1.15–1.37× in aggregate, single boards up to about 2×), while long searches are 0.14–0.20× in aggregate. WT19 owns tuning the threshold and the per-node cost.

## Design

### Probes (tier 5)

- `lookahead()` is unchanged except that a probe runs `probe()` instead of `local()`: tier 1, then, when `probeCorners` is on and the corners group is on, `cornerPass()`, repeated until the corner pass sets nothing (`0`) or something contradicts.
- `EngineOptions.probeCorners` defaults to false, so `solve` behaves as main (tier-1 probes). Only `Engine.deepen()` (the verifier after a long search) turns it on.
- Same round-robin, same step (`lookahead`, dots = the edge's ends plus the tier-1 conflict dot when there is one).
- Order independence: a probe's verdict is monotone in the board (tier 1 and the corner rules are), so the lookahead fixpoint does not depend on the round-robin cursor.

### Connectivity (tier 4c), rule group `"connectivity"`

Runs where `connected()` ran (after parity and colouring, before lookahead), when `EngineOptions.connectivity` (default true) is on; otherwise `connected()` runs as before. Returns the number of edges set, or -1. Nothing before the first line.

1. `blocks()`: iterative Tarjan over the dots, skipping crossed edges; `blockOf[e]` = block of each non-crossed edge (NONE for crossed).
2. Target block = block of the first line; another line in another block → -1; a clue > 0 with no non-crossed side in the target block → -1.
3. `cutOff(target)`: every unknown edge outside the target block → Cross. Without steps: all at once. While recording: one step, then return (the cheap rules follow up, as colouring does): walk the target block's dots from a line's dot; at the first dot with a non-crossed edge outside the block, BFS from it over non-crossed non-target edges → its unknown edges, step `cut-off` with `dots: [that dot]`; if no dot has one, the unknown non-target edges (other components) → step `unreachable` with no cells or dots.
4. `twoExits()` when the cut-off set nothing: faces = union-find over cells + outside joined by crossed edges; group the unknown edges by their (sorted) pair of face roots, in order of first edge (hash table, linear probing); for each group of ≥ 2 edges that is not a chain (`isChain`), mark the group, walk the piece of the first line's lower dot over non-crossed, non-group edges, and check (a) every line's lower dot is in it, (b) every clue > 0 has a non-crossed, non-group side whose first dot is in it. If not: set the whole group to Line, one step `two-exits` with the reason — case (a): `dots` = [start dot, the outside line's dot] sorted; case (b): `cells` = [that clue], `dots` = [start dot]. While recording, return after the first group.
5. `isChain(g)`: count each group dot's group edges; inner dots = dots with exactly 2 group edges and 2 non-crossed edges; chain iff inner = size − 1 (a path, or a cycle through one other dot).

### Verifier

```
engine = new Engine(puzzle, budget, { colourLast: true, connectivity: false })   // probes tier 1
if solveRoot(true):
  root = mark()
  if !search(engine, budget, solutions, deepenAfterNodes):   // false: reached the limit
    undo(root); solutions = []; engine.deepen()               // connectivity + corner probes
    if propagate(true): search(engine, budget, solutions, ∞)
```

`search(…, limit)` returns false just before it would visit node `limit + 1` (counted from its own start), true when done. Node and time budgets (`maxNodes`, `timeLimitMs`) count across both searches. `VerifyOptions.deepenAfterNodes` (default `DEFAULT_DEEPEN_AFTER_NODES` = 200, exported).

### Rules, texts, titles

| id | title (≤ 24) | text (≤ 115) |
|---|---|---|
| `unreachable` | Out of reach | No path of open edges leads from the loop's lines to these edges, so the loop can't use them: they are crossed. (111) |
| `cut-off` | One way in | The loop could get to these edges only through this dot, and it can't pass through a dot twice, so they're crossed. (115) |
| `two-exits` | Only ways across | The loop must get from one side of these edges to the other, and uses all of them or none, so it uses them all. (111) |

In hint traces of generated puzzles (`bench-<n>` seeds, 10×10 to 40×40): `two-exits` steps set 2 edges in 78–81% of cases (3–6 otherwise) and highlight 2 dots (a line's dot on each side; 2–13% highlight a clue and a dot); `cut-off` highlights 1 dot, `unreachable` nothing (its crosses are the hint); half or more of the cut-off-family steps are `unreachable`, most often a single cell boxed in by crosses (4 edges).

### Files

| File | Change |
|---|---|
| `packages/core/src/engine.ts` | `Mark.scan` and `undo` (step 1); `probe()`, `probeCorners` (default false), `connectivity` option, connectivity tier, `deepen()`, header (step 2) |
| `packages/core/src/engine.test.ts` | new: undo past the first corner pass (step 1); corner probes only with `probeCorners` / `deepen` (step 2) |
| `packages/core/src/rules.ts` | 3 ids, texts, titles; group `connectivity` |
| `packages/core/src/solver.ts` | pass `connectivity`; `lookahead` doc (probes run tier 1) |
| `packages/core/src/verify.ts` | `deepenAfterNodes`, `DEFAULT_DEEPEN_AFTER_NODES`, deepen after a long search |
| `packages/core/src/generate.ts` | `GENERATOR_VERSION` "6" |
| `packages/core/src/solver.test.ts` | 3 per-rule cases; colouring-group test also leaves connectivity out; connectivity-group test |
| `packages/core/src/agreement.test.ts` | connectivity subset; `deepenAfterNodes: 0` agrees |
| `packages/core/src/clue-gaps.test.ts` | `SOLVED` 29, `SOLVED_WITHOUT_COLOURING` 23, `SOLVED_WITHOUT_GROUPS` 3 unchanged; new `SOLVED_WITHOUT_LOOKAHEAD` 11, `SOLVED_WITHOUT_LOOKAHEAD_WT17` 8; connectivity subset |
| `packages/core/src/hint.test.ts` | the time-limit test uses small-7 (tiny-5 no longer needs lookahead) |
| `packages/core/src/generate.test.ts` | goldens for "6" (only the 20×20 digest changes) |
| `packages/core/bench/generate.ts` | header: 100×100 time range |
| `apps/web/src/lib/game/patterns.ts` | 3 patterns |
| `apps/web/tests/hint.e2e.ts` | `RULES` + `line-into-3`, `cut-off`, `two-exits` (small-7 now uses them) |
| `openapi.yaml`, `packages/api-client/src/schema.ts` | `bun run gen:api` (rule enum) |
| `docs/DECISIONS.md` | 3 entries (step 3) |

`hint.ts`, `index.ts`, the other benches, the server and the rest of the web app do not change (`bench:clue-gaps --rules=` already takes any `RULE_GROUPS` name; `index.ts` re-exports `verify.ts`, so `DEFAULT_DEEPEN_AFTER_NODES` is public).

## Rules for the implementer

- Mode EXECUTE; follow the steps in order; the code blocks are exact (they were run: `bun run check` passed with them, 841 pass, 3 skip; the hint e2e passed, 17 tests). Run `bun run format` after editing, then the step's checks.
- Bun lives in `~/.bun/bin`: prefix commands with `export PATH="$HOME/.bun/bin:$PATH";`. Run `bun install --frozen-lockfile` first.
- Do not clone the repo (`/tmp` is a 16 GB tmpfs shared with other worktrees); scratch scripts go in your scratchpad, not in the worktree. The planner's full diff is at `/tmp/claude-1000/-home-jhonnold-projects-loophole/a34715f6-7810-5a69-ba81-edd46bda034d/scratchpad/deeper-lookahead/wt18-final.diff`: the code there is the reference if a block below is ambiguous (do not `git apply` it blindly; commit per step).
- Commit at the three boundaries given (conventional commits). `bun run check` must pass at each.
- If a number in a test differs from this plan, stop and find out why before changing the test: the expected values come from this exact code.

## Step 1 — `undo` restores the corner pass's first scan

`refactor(core): undo puts the first corner scan back to the mark`

1.1 `packages/core/src/engine.ts`:

- In `interface Mark`, after `  readonly closed: boolean;` add:

```ts
  /** `cornerScan` then, so undoing past the first corner pass makes the next one scan again. */
  readonly scan: number;
```

- In `mark()`, after `      closed: this.closed,` add `      scan: this.cornerScan,`.
- In `undo(m)`, after `    this.closed = m.closed;` add `    if (m.scan < this.cornerScan) this.cornerScan = m.scan;`.
- In `cornerPass()`, replace the five-line `// Hazard: …` comment with:

```ts
    // The first pass scans every corner dot once (`cornerScan`). `undo` puts the scan back to where
    // it was at the mark, so a mark taken before (or during) that scan scans those dots again.
```

1.2 New file `packages/core/src/engine.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { Budget, Engine } from "./engine.ts";
import { parsePuzzle } from "./format.ts";

function puzzle(width: number, height: number, clues: string) {
  return parsePuzzle({ v: 1, width, height, clues });
}

describe("Engine", () => {
  test("undoing past the first corner pass makes the next one scan every corner dot again", () => {
    // A 3 beside a 1 in a strip: the corner rules, scanning the 3's and the 1's corner dots, decide
    // an edge (corner-chain) that tier 1 and parity do not (colouring would, so it is off).
    const budget = new Budget(Date.now, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const options = { colouring: false };
    const engine = new Engine(puzzle(1, 4, ".31."), budget, options);
    expect(engine.local()).toBe(true);
    const before = engine.edges.slice();
    const m = engine.mark();
    expect(engine.propagate(false)).toBe(true);
    const first = engine.edges.slice();
    expect(first).not.toEqual(before);
    engine.undo(m);
    expect(engine.edges).toEqual(before);
    expect(engine.propagate(false)).toBe(true);
    expect(engine.edges).toEqual(first);
  });

});
```

(Without the `undo` line this test fails: the second `propagate` skips the scan and decides nothing.)

Verify: `bun run check` (no golden changes). Commit.

## Step 2 — Connectivity rules; the verifier deepens long searches into connectivity and corner probes

`feat(core): connectivity rule group; verify deepens long searches with corner probes`

### 2.1 `packages/core/src/rules.ts`

- In `RULE_IDS`, between `"colour-chain",` and `"lookahead",` insert `"unreachable",`, `"cut-off",`, `"two-exits",` (one per line).
- `export const RULE_GROUPS = ["corners", "colouring"] as const;` → `export const RULE_GROUPS = ["corners", "colouring", "connectivity"] as const;`
- In `GROUP_RULES`, after the `colouring:` entry add `  connectivity: ["unreachable", "cut-off", "two-exits"],`
- In `RULE_TEXT`, after the `"colour-chain":` entry add:

```ts
  unreachable:
    "No path of open edges leads from the loop's lines to these edges, so the loop can't use them: they are crossed.",
  "cut-off":
    "The loop could get to these edges only through this dot, and it can't pass through a dot twice, so they're crossed.",
  "two-exits":
    "The loop must get from one side of these edges to the other, and uses all of them or none, so it uses them all.",
```

- In `RULE_TITLE`, after `"colour-chain": "Sides pass along",` add:

```ts
  unreachable: "Out of reach",
  "cut-off": "One way in",
  "two-exits": "Only ways across",
```

### 2.2 `packages/core/src/solver.ts`

- In the `Engine` options object add `    connectivity: rules.includes("connectivity"),` after the `colouring:` line.
- Replace `  /** Use bounded lookahead when the other rules are stuck. Default true. */` with:

```ts
  /**
   * Use bounded lookahead when the other rules are stuck. Default true. A probe assumes one edge and
   * runs tier 1 only (DECISIONS, WT2 and WT18).
   */
```

### 2.3 `packages/core/src/engine.ts`

(a) File comment: replace the lines from ` * 4. inside/outside parity` up to (not including) ` * After any change` with:

```ts
 * 4. inside/outside parity, a union-find over cells (global); when it decides nothing,
 *    colouring (optional): the relations each 1, 2 or 3 forces among its neighbours' sides, added
 *    to the same union-find (global); then connectivity (optional): the loop is one cycle, so it
 *    stays inside one block of the edges that are not crossed, and it uses both or neither of two
 *    edges between the same two faces (global). Without that group, a connectivity check that only
 *    detects contradictions
 * 5. lookahead: assume an edge, run tier 1 (and, once `deepen` has run, the corner rules too), and
 *    take the opposite on a contradiction
```

(b) `EngineOptions`: after the `colourLast` member add:

```ts
  /** Run the connectivity rules (rule group "connectivity"). Default true. */
  readonly connectivity?: boolean;
  /**
   * Lookahead probes run the corner rules after tier 1, when the corners group is on. Default false:
   * `solve` keeps tier-1 probes (they cost about 2× in generation for little gain, DECISIONS WT18);
   * the verifier turns them on with `deepen`.
   */
  readonly probeCorners?: boolean;
```

(c) Right after `const { Unknown, Line, Cross } = EdgeState;` insert:

```ts
/** Empty arrays for scratch that is allocated on first use (zero-length, so sharing is safe). */
const NO_INT32 = new Int32Array(0);
const NO_UINT8 = new Uint8Array(0);
const NO_NUMBERS: readonly number[] = [];
```

(Shared empty arrays instead of `new Int32Array(0)` per field, so the 17 new fields allocate nothing until connectivity first runs; small verifications build many engines.) Fields: right after `  private lookCursor = 0;` insert:

```ts
  /**
   * Connectivity scratch, allocated on the first connectivity pass (`initConnect`). Blocks: the
   * DFS's discovery times, low points, next `dotEdges` slot, tree edge in and stack of dots, the
   * stack of edges, and each edge's block. Two exits: the faces' union-find, each group's edges
   * as a list (`groupFirst`, `groupNext`, `groupLast`, `groupSize`), the hash table from a pair
   * of faces to its group, each dot's piece, the edges of the group being checked and a count
   * per dot.
   */
  private bcDisc = NO_INT32;
  private bcLow = NO_INT32;
  private bcSlot = NO_UINT8;
  private bcVia = NO_INT32;
  private bcDots = NO_INT32;
  private bcEdges = NO_INT32;
  private blockOf = NO_INT32;
  private faceParent = NO_INT32;
  private groupNext = NO_INT32;
  private groupFirst = NO_INT32;
  private groupLast = NO_INT32;
  private groupSize = NO_INT32;
  private hashKey = NO_INT32;
  private hashGroup = NO_INT32;
  private piece = NO_INT32;
  private inGroup = NO_UINT8;
  private dotTally = NO_UINT8;
  /** While steps are recorded: why the last group `groupFeasible` turned down could not be crossed. */
  private exitCells: readonly number[] = NO_NUMBERS;
  private exitDots: readonly number[] = NO_NUMBERS;
```

(d) After `  private readonly colourLast: boolean;` add `  private connectOn: boolean;` and `  private probeCorners: boolean;`; in the constructor, after `    this.colourLast = options.colourLast ?? false;` add `    this.connectOn = options.connectivity ?? true;` and `    this.probeCorners = options.probeCorners ?? false;`.

(e) `propagate`: replace `      if (!this.connected()) return false;` with:

```ts
      if (this.connectOn) {
        const k = this.connectivity();
        if (k < 0) return false;
        if (k > 0) continue;
      } else if (!this.connected()) return false;
```

(f) Right before `  mark(): Mark {` insert:

```ts
  /**
   * From now on the connectivity rules run and lookahead probes run the corner rules too (when the
   * corners group is on). The verifier, which starts without both, calls this when its search runs
   * long (see `verify`).
   */
  deepen(): void {
    this.connectOn = true;
    this.probeCorners = true;
  }

```

(g) Right before `  // --- tier 5: lookahead ---` insert the connectivity tier (`connected()` stays, for when the group is off):

```ts
  // --- tier 4c: connectivity ---------------------------------------------------------------

  /**
   * The loop is one simple cycle in the graph of dots and the edges that are not crossed. Returns
   * the number of edges set, or -1 on a contradiction. Does nothing before the first line.
   *
   * 1. Cut off: a cycle lies inside one block (biconnected component) of that graph. So every line
   *    is in one block, every clue above 0 has a side there that is not crossed, and every open
   *    edge in another block is crossed: the loop could only reach it through one dot (or not at
   *    all), and it passes each dot once.
   * 2. Two exits (`twoExits`), when the first decides nothing.
   */
  private connectivity(): number {
    const { grid, edges, clues } = this;
    if (this.lineCount === 0) return 0;
    if (this.blockOf.length === 0) this.initConnect();
    this.blocks();
    const { blockOf } = this;
    let target = NONE;
    let line = NONE;
    for (let e = 0; e < grid.edgeCount; e++) {
      if (edges[e] !== Line) continue;
      if (target === NONE) {
        target = blockOf[e];
        line = e;
      } else if (blockOf[e] !== target) return -1;
    }
    for (let i = 0; i < grid.cellCount; i++) {
      if (clues[i] <= 0) continue;
      let reached = false;
      for (let j = 0; j < 4 && !reached; j++) {
        const e = grid.cellEdges[i * 4 + j];
        reached = edges[e] !== Cross && blockOf[e] === target;
      }
      if (!reached) return -1;
    }
    const set = this.cutOff(target, grid.edgeDots[line * 2]);
    if (set !== 0) return set;
    return this.twoExits();
  }

  private initConnect(): void {
    const { dotCount: D, edgeCount: E, cellCount: C } = this.grid;
    this.bcDisc = new Int32Array(D);
    this.bcLow = new Int32Array(D);
    this.bcSlot = new Uint8Array(D);
    this.bcVia = new Int32Array(D);
    this.bcDots = new Int32Array(D);
    this.bcEdges = new Int32Array(E);
    this.blockOf = new Int32Array(E);
    this.faceParent = new Int32Array(C + 1);
    this.groupNext = new Int32Array(E);
    this.groupFirst = new Int32Array(E);
    this.groupLast = new Int32Array(E);
    this.groupSize = new Int32Array(E);
    let table = 2;
    while (table < 2 * E) table *= 2;
    this.hashKey = new Int32Array(table);
    this.hashGroup = new Int32Array(table);
    this.piece = new Int32Array(D);
    this.inGroup = new Uint8Array(E);
    this.dotTally = new Uint8Array(D);
  }

  /**
   * Numbers the blocks (biconnected components) of the graph of dots and the edges that are not
   * crossed into `blockOf` (NONE for crossed edges): Tarjan's algorithm, with explicit stacks.
   */
  private blocks(): void {
    const { grid, edges, bcDisc: disc, bcLow: low, bcSlot: slot, bcVia: via } = this;
    const { bcDots: dots, bcEdges: stack, blockOf } = this;
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
  }

  /**
   * Crosses the open edges outside block `target`. While steps are recorded, one step: the edges
   * reached from the first dot of the block (from `start`, a dot of the block) that has some, with
   * that dot as the reason, or else the edges in other parts of the board, with no reason.
   */
  private cutOff(target: number, start: number): number {
    const { grid, edges, blockOf } = this;
    if (this.steps === null) {
      let set = 0;
      for (let e = 0; e < grid.edgeCount; e++) {
        if (edges[e] !== Unknown || blockOf[e] === target) continue;
        if (!this.assign(e, Cross)) return -1;
        set++;
      }
      return set;
    }
    let any = false;
    for (let e = 0; e < grid.edgeCount && !any; e++) {
      any = edges[e] === Unknown && blockOf[e] !== target;
    }
    if (!any) return 0;
    // The block's dots, from `start`: a dot where an edge of another block that is not crossed
    // begins is where everything hanging there is reached from.
    const { piece, bcDots: stack } = this;
    piece.fill(NONE);
    let top = 0;
    stack[top++] = start;
    piece[start] = 0;
    let found: number[] = [];
    let at = NONE;
    while (top > 0 && at === NONE) {
      const d = stack[--top];
      for (let j = 0; j < 4; j++) {
        const e = grid.dotEdges[d * 4 + j];
        if (e === NONE || edges[e] === Cross) continue;
        if (blockOf[e] !== target) {
          // Every non-crossed edge outside the block is open (lines are all inside it), so this
          // finds at least e.
          found = this.hanging(d, target);
          at = d;
          break;
        }
        const o = otherDot(grid, e, d);
        if (piece[o] === NONE) {
          piece[o] = 0;
          stack[top++] = o;
        }
      }
    }
    if (at === NONE) {
      for (let e = 0; e < grid.edgeCount; e++) {
        if (edges[e] === Unknown && blockOf[e] !== target) found.push(e);
      }
    }
    if (at === NONE) this.begin("unreachable", [], []);
    else this.begin("cut-off", [], [at]);
    for (const e of found) if (!this.assign(e, Cross)) return -1;
    this.commit();
    return found.length;
  }

  /** The open edges reached from dot `d` over edges outside block `target` that are not crossed. */
  private hanging(d: number, target: number): number[] {
    const { grid, edges, blockOf } = this;
    const out: number[] = [];
    const seen = new Set<number>([d]);
    const queue = [d];
    const taken = new Set<number>();
    for (let h = 0; h < queue.length; h++) {
      const v = queue[h];
      for (let j = 0; j < 4; j++) {
        const e = grid.dotEdges[v * 4 + j];
        if (e === NONE || edges[e] === Cross || blockOf[e] === target || taken.has(e)) continue;
        taken.add(e);
        if (edges[e] === Unknown) out.push(e);
        const o = otherDot(grid, e, v);
        if (!seen.has(o)) {
          seen.add(o);
          queue.push(o);
        }
      }
    }
    return out.sort((a, b) => a - b);
  }

  /**
   * Two exits. Faces are the regions of cells (and the outside) joined across crossed edges. Two
   * edges that are not crossed, between the same two faces, are both lines or both not: a closed
   * curve through the two faces meets the graph only at those two edges, and the loop crosses any
   * closed curve an even number of times. So the open edges between two faces (a group; parity has
   * decided the rest) are all lines or all crossed. With all crossed, the loop would lie in one
   * part (piece) of the graph without them; when no piece holds every line and a side that is not
   * crossed of every clue above 0, they are all lines. Runs only once a line is drawn, after the
   * cut-off rule found nothing. Returns the number of edges set, or -1 on a contradiction.
   */
  private twoExits(): number {
    const { grid, edges, faceParent: fp, groupNext, groupFirst, groupLast, groupSize } = this;
    const { hashKey, hashGroup } = this;
    const C = grid.cellCount;
    for (let x = 0; x <= C; x++) fp[x] = x;
    for (let e = 0; e < grid.edgeCount; e++) {
      if (edges[e] !== Cross) continue;
      const a = this.faceFind(sideNode(grid, e, 0));
      const b = this.faceFind(sideNode(grid, e, 1));
      if (a !== b) fp[a] = b;
    }
    // Groups in order of their first edge, found with a hash table on the pair of faces (linear
    // probing); groupNext links each group's edges in edge order.
    hashKey.fill(NONE);
    const mask = hashKey.length - 1;
    let groups = 0;
    for (let e = 0; e < grid.edgeCount; e++) {
      if (edges[e] !== Unknown) continue;
      const a = this.faceFind(sideNode(grid, e, 0));
      const b = this.faceFind(sideNode(grid, e, 1));
      const key = a < b ? a * (C + 1) + b : b * (C + 1) + a;
      let h = Math.imul(key, 0x9e3779b1) & mask;
      while (hashKey[h] !== NONE && hashKey[h] !== key) h = (h + 1) & mask;
      groupNext[e] = NONE;
      if (hashKey[h] === NONE) {
        hashKey[h] = key;
        hashGroup[h] = groups;
        groupFirst[groups] = e;
        groupLast[groups] = e;
        groupSize[groups] = 1;
        groups++;
      } else {
        const g = hashGroup[h];
        groupNext[groupLast[g]] = e;
        groupLast[g] = e;
        groupSize[g]++;
      }
    }
    let set = 0;
    for (let g = 0; g < groups; g++) {
      if (groupSize[g] < 2 || this.isChain(g)) continue;
      const group: number[] = [];
      for (let e = groupFirst[g]; e !== NONE; e = groupNext[e]) group.push(e);
      if (this.groupFeasible(group)) continue;
      if (this.recording()) this.begin("two-exits", this.exitCells, this.exitDots);
      for (const e of group) if (!this.assign(e, Line)) return -1;
      this.commit();
      set += group.length;
      // While steps are recorded, one step a pass, so the cheaper rules follow it up first.
      if (this.steps !== null) return set;
    }
    return set;
  }

  private faceFind(x: number): number {
    const fp = this.faceParent;
    while (fp[x] !== x) {
      fp[x] = fp[fp[x]];
      x = fp[x];
    }
    return x;
  }

  /**
   * Whether, with every edge of `group` crossed, one piece of the graph holds every line and a side
   * that is not crossed of every clue above 0. When not, and steps are recorded, leaves the reason
   * in `exitCells` and `exitDots`: a dot of a line in each of two pieces, or a dot of a line and a
   * clue with no side in that line's piece.
   */
  private groupFeasible(group: readonly number[]): boolean {
    const { inGroup } = this;
    for (const e of group) inGroup[e] = 1;
    const ok = this.piecesFeasible();
    for (const e of group) inGroup[e] = 0;
    return ok;
  }

  /**
   * Whether group g is a chain: its edges form one path (or a cycle through one other dot) whose
   * inner dots have no other edge that is not crossed. Its pieces are then those inner dots, which
   * hold nothing, and the rest of the graph, so with every line already in the rest it can only be
   * needed for a clue whose open sides all lie on it; clue-needs-all and dot-continue then reach
   * the same edges (or the board has no solution). Chains are most groups, so they are skipped.
   */
  private isChain(g: number): boolean {
    const { grid, dotTally, groupFirst, groupNext } = this;
    for (let e = groupFirst[g]; e !== NONE; e = groupNext[e]) {
      dotTally[grid.edgeDots[e * 2]]++;
      dotTally[grid.edgeDots[e * 2 + 1]]++;
    }
    let inner = 0;
    for (let e = groupFirst[g]; e !== NONE; e = groupNext[e]) {
      for (let k = 0; k < 2; k++) {
        const d = grid.edgeDots[e * 2 + k];
        if (dotTally[d] === 2 && this.openDegree(d) === 2) {
          inner++;
          dotTally[d] = 3;
        }
      }
    }
    for (let e = groupFirst[g]; e !== NONE; e = groupNext[e]) {
      dotTally[grid.edgeDots[e * 2]] = 0;
      dotTally[grid.edgeDots[e * 2 + 1]] = 0;
    }
    return inner === this.groupSize[g] - 1;
  }

  /** Edges at dot `d` that are not crossed. */
  private openDegree(d: number): number {
    let n = 0;
    for (let j = 0; j < 4; j++) {
      const e = this.grid.dotEdges[d * 4 + j];
      if (e !== NONE && this.edges[e] !== Cross) n++;
    }
    return n;
  }

  /**
   * The general case: walks the piece of the first line over edges that are neither crossed nor in
   * the group (marked in `inGroup`), then checks it holds every line and a side of every clue
   * above 0.
   */
  private piecesFeasible(): boolean {
    const { grid, edges, clues, piece, inGroup, bcDots: stack } = this;
    const first = edges.indexOf(Line);
    const start = grid.edgeDots[first * 2];
    piece.fill(0);
    let top = 0;
    stack[top++] = start;
    piece[start] = 1;
    while (top > 0) {
      const d = stack[--top];
      for (let j = 0; j < 4; j++) {
        const e = grid.dotEdges[d * 4 + j];
        if (e === NONE || edges[e] === Cross || inGroup[e]) continue;
        const o = otherDot(grid, e, d);
        if (piece[o] === 0) {
          piece[o] = 1;
          stack[top++] = o;
        }
      }
    }
    for (let e = first + 1; e < grid.edgeCount; e++) {
      if (edges[e] !== Line || piece[grid.edgeDots[e * 2]] === 1) continue;
      if (this.steps !== null) {
        this.exitCells = [];
        this.exitDots = [start, grid.edgeDots[e * 2]].sort((a, b) => a - b);
      }
      return false;
    }
    for (let i = 0; i < grid.cellCount; i++) {
      if (clues[i] <= 0) continue;
      let reached = false;
      for (let j = 0; j < 4 && !reached; j++) {
        const e = grid.cellEdges[i * 4 + j];
        reached = edges[e] !== Cross && !inGroup[e] && piece[grid.edgeDots[e * 2]] === 1;
      }
      if (reached) continue;
      if (this.steps !== null) {
        this.exitCells = [i];
        this.exitDots = [start];
      }
      return false;
    }
    return true;
  }

```

(h) Replace everything from `  // --- tier 5: lookahead ---` up to (not including) `  // --- helpers ---` with:

```ts
  // --- tier 5: lookahead --------------------------------------------------------------------

  /**
   * Tries each open edge both ways, running the worklist rules and, when the corners group is on
   * and `probeCorners` (the verifier after `deepen`), the corner rules after each assumption (never
   * parity, colouring, connectivity or lookahead: those cost O(edges) each). If one way leads to a
   * contradiction the edge takes the other state. Scans round-robin from where the last scan
   * stopped. Returns 1 after a deduction, 0 when a full scan finds none, -1 when the deduction
   * itself contradicts.
   */
  private lookahead(): number {
    const E = this.grid.edgeCount;
    const recording = this.steps;
    for (let k = 0; k < E; k++) {
      const e = (this.lookCursor + k) % E;
      if (this.edges[e] !== Unknown) continue;
      for (const assumed of [Line, Cross]) {
        this.budget.tick();
        this.probes++;
        const m = this.mark();
        this.steps = null;
        const ok = this.set(e, assumed) && this.probe();
        const site = this.conflict;
        this.steps = recording;
        this.undo(m);
        if (ok) continue;
        this.lookCursor = (e + 1) % E;
        const C = this.grid.cellCount;
        const a = this.grid.edgeDots[e * 2];
        const b = this.grid.edgeDots[e * 2 + 1];
        const cells = site !== NONE && site < C ? [site] : [];
        const dots = site !== NONE && site >= C ? [a, b, site - C] : [a, b];
        this.begin("lookahead", cells, dots);
        if (!this.assign(e, assumed === Line ? Cross : Line)) return -1;
        this.commit();
        return 1;
      }
    }
    return 0;
  }

  /**
   * A probe's rules: tier 1 and, when probes run them, the corner rules, to their joint fixpoint.
   * False on a contradiction. Corner masks are trailed, so `undo` restores them; lookahead runs only
   * once a corner pass has found nothing, so the first pass's scan is always finished here and the
   * corner queue is empty at the probe's mark (`undo` drains it).
   */
  private probe(): boolean {
    for (;;) {
      if (!this.local()) return false;
      if (this.closed || !this.cornersOn || !this.probeCorners) return true;
      const c = this.cornerPass();
      if (c < 0) return false;
      if (c === 0) return true;
    }
  }

```

(i) Right before the doc comment of the `across` helper (``/** The node across side `j` …``) insert:

```ts
/** The other end of edge `e` from dot `d`. */
function otherDot(grid: Grid, e: number, d: number): number {
  const a = grid.edgeDots[e * 2];
  return a === d ? grid.edgeDots[e * 2 + 1] : a;
}

```

### 2.4 `packages/core/src/verify.ts`

- After `export const DEFAULT_VERIFY_TIME_LIMIT_MS = 30_000;` add:

```ts

/** Default `VerifyOptions.deepenAfterNodes` (DECISIONS, WT18). */
export const DEFAULT_DEEPEN_AFTER_NODES = 200;
```

- In `VerifyOptions`, after `maxNodes` add:

```ts
  /**
   * When the search has visited this many nodes without finishing, start again from the root with
   * the connectivity rules and lookahead probes that also run the corner rules: they cost more per
   * pass but can save most of a long search. The answer is the same either way. Default
   * `DEFAULT_DEEPEN_AFTER_NODES`.
   */
  readonly deepenAfterNodes?: number;
```

- In `verify`, replace from `  // Colouring after lookahead at the root` up to (not including) `    status = solutions.length === 0` with:

```ts
  // Colouring after lookahead at the root: no steps are read here, and it saves a colouring pass
  // before every lookahead deduction (DECISIONS, WT17). The connectivity rules and corner probes
  // cost more than they save here until the search runs long (DECISIONS, WT18).
  const engine = new Engine(puzzle, budget, { colourLast: true, connectivity: false });
  const solutions: Uint8Array[] = [];
  let status: VerifyStatus;
  try {
    if (engine.solveRoot(true)) {
      const root = engine.mark();
      const limit = options.deepenAfterNodes ?? DEFAULT_DEEPEN_AFTER_NODES;
      if (!search(engine, budget, solutions, limit)) {
        // A long search: start again from the root with the connectivity rules and deeper
        // lookahead. The search finds solutions in the same order either way (the first in
        // reading order, cross before line), so it finds the same ones again.
        engine.undo(root);
        solutions.length = 0;
        engine.deepen();
        if (engine.propagate(true)) search(engine, budget, solutions, Number.POSITIVE_INFINITY);
      }
    }
```

- `search`: replace its doc comment and signature with:

```ts
/**
 * Depth-first search from a propagated, consistent state, collecting up to two solutions. Branches
 * on the first open edge in reading order, cross first, and runs the rules without lookahead at
 * every node. Edges before a node's branch position are all decided, so the next scan starts
 * there. Uses an explicit stack because a 100×100 board can need thousands of nested branches.
 * Returns false, leaving the engine mid-search, when it is about to visit node `limit` + 1 (counted
 * from its start); true when it is done.
 */
function search(engine: Engine, budget: Budget, solutions: Uint8Array[], limit: number): boolean {
  const end = budget.nodes + limit;
```

  then `if (solutions.length >= 2) return;` → `if (solutions.length >= 2) return true;`, insert `        if (budget.nodes >= end) return false;` right before `        budget.node();`, and `if (top === undefined) return;` → `if (top === undefined) return true;`.

### 2.5 `packages/core/src/generate.ts`

`export const GENERATOR_VERSION = "5";` → `"6"`.

### 2.6 Tests

`packages/core/src/solver.test.ts`:

- In `cases`, after the `colour-chain` row add:

```ts
    // Connectivity (WT18): for each, the smallest puzzle, then the fewest clues, where it fires.
    [1, 5, ".3.1.", 4, { rule: "unreachable", changes: "4:2 5:2 14:2 15:2", cells: [], dots: [] }],
    [2, 4, "1....3.2", 6, { rule: "cut-off", changes: "1:2 3:2 11:2 12:2", cells: [], dots: [4] }],
    [1, 5, ".3.3.", 4, { rule: "two-exits", changes: "10:1 11:1", cells: [], dots: [2, 6] }],
```

  (found by exhaustive search over every clue grid of at most 6 cells, then random planted grids up to 4×4.)
- In "leaving the colouring group out drops its rules": `const without = solve(p, { rules: ["corners"] });` → `const without = solve(p, { rules: ["corners", "connectivity"] });` ("no other rule" now covers connectivity too).
- Before `  test("two 3s side by side do not claim their shared side"` add:

```ts
  test("leaving the connectivity group out drops its rules", () => {
    // Two 3s in a one-wide strip: the loop has lines above and below the middle cell, and only its
    // two sides lead from one part to the other.
    const p = puzzle(1, 5, ".3.3.");
    const connectivity = new Set<RuleId>(GROUP_RULES.connectivity);
    const without = solve(p, { rules: ["corners", "colouring"] });
    expect(without.status).toBe("solved");
    expect(without.steps.some((s) => connectivity.has(s.rule))).toBe(false);
    expect(without.steps[4].rule).toBe("lookahead");
    expect(solve(p).steps[4].rule).toBe("two-exits");
  });

```

`packages/core/src/engine.test.ts`: after the first test (inside the `describe`) add:

```ts
  test("probes run the corner rules only when probeCorners is on (the verifier after deepen)", () => {
    // A 2 in a one-wide strip with colouring off: only a probe that runs the corner rules settles it.
    const p = puzzle(1, 3, ".2.");
    const budget = new Budget(Date.now, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const shallow = new Engine(p, budget, { colouring: false });
    expect(shallow.solveRoot(true)).toBe(true);
    expect(shallow.closed).toBe(false);
    const deep = new Engine(p, budget, { colouring: false, probeCorners: true });
    expect(deep.solveRoot(true)).toBe(true);
    expect(deep.closed).toBe(true);
    const deepened = new Engine(p, budget, { colouring: false });
    deepened.deepen();
    expect(deepened.solveRoot(true)).toBe(true);
    expect(deepened.closed).toBe(true);
  });
```

`packages/core/src/agreement.test.ts`, in `checkAgainstBruteForce`:

- After the `if (v.solutions.length === 2) { … }` block add:

```ts
  // Starting again from the root with deeper lookahead at once finds the same solutions.
  const deep = verify(p, { deepenAfterNodes: 0 });
  expect(deep.status).toBe(v.status);
  expect(deep.solutions.map(encodeEdges)).toEqual(v.solutions.map(encodeEdges));
```

- `for (const rules of [undefined, ["corners"], ["colouring"], []] as const) {` → `for (const rules of [undefined, ["corners"], ["colouring"], ["connectivity"], []] as const) {`

`packages/core/src/clue-gaps.test.ts` (`SOLVED`, `SOLVED_WITHOUT_COLOURING` and `SOLVED_WITHOUT_GROUPS` stay main's 29, 23 and 3):

- In the doc comment above `SOLVED`, replace the line ` * the corners, solves the same 29 as every group.` with:

```ts
 * the corners, solves the same 29 as every group. WT18's connectivity group adds none of these
 * (lookahead found them already); without lookahead it adds 3: every group solves
 * `SOLVED_WITHOUT_LOOKAHEAD`, the groups before WT18 `SOLVED_WITHOUT_LOOKAHEAD_WT17`.
```

- After `SOLVED_WITHOUT_GROUPS` add:

```ts
const SOLVED_WITHOUT_LOOKAHEAD: string[] = [
  "clue-gaps-5-41#4",
  "clue-gaps-5-41#9",
  "clue-gaps-5-44#16",
  "clue-gaps-5-81#1",
  "clue-gaps-5-81#5",
  "clue-gaps-5-95#3",
  "clue-gaps-5-95#18",
  "clue-gaps-10-0#77",
  "clue-gaps-10-3#41",
  "clue-gaps-10-4#35",
  "clue-gaps-10-7#60",
];
const SOLVED_WITHOUT_LOOKAHEAD_WT17: string[] = [
  "clue-gaps-5-41#4",
  "clue-gaps-5-41#9",
  "clue-gaps-5-44#16",
  "clue-gaps-5-81#1",
  "clue-gaps-5-95#18",
  "clue-gaps-10-3#41",
  "clue-gaps-10-4#35",
  "clue-gaps-10-7#60",
];
```

- In the per-entry test, `for (const rules of [["corners"], ["colouring"], []] as const) {` → `for (const rules of [["corners"], ["colouring"], ["connectivity"], []] as const) {`.
- In the test `the rule solver solves exactly the entries in SOLVED …`, replace its body with:

```ts
    const solvedWith = (rules?: readonly RuleGroup[], lookahead = true) =>
      corpus
        .filter((c) => solve(c.puzzle, { rules, lookahead }).status === "solved")
        .map((c) => c.id);
    expect(solvedWith()).toEqual(SOLVED);
    expect(solvedWith(["colouring"])).toEqual(SOLVED);
    expect(solvedWith(["corners", "colouring"])).toEqual(SOLVED);
    expect(solvedWith(["corners"])).toEqual(SOLVED_WITHOUT_COLOURING);
    expect(solvedWith(["corners", "connectivity"])).toEqual(SOLVED_WITHOUT_COLOURING);
    expect(solvedWith([])).toEqual(SOLVED_WITHOUT_GROUPS);
    expect(solvedWith(undefined, false)).toEqual(SOLVED_WITHOUT_LOOKAHEAD);
    expect(solvedWith(["corners", "colouring"], false)).toEqual(SOLVED_WITHOUT_LOOKAHEAD_WT17);
```

`packages/core/src/hint.test.ts`, test "reveals a line instead when the time limit stops the search for a deduction": `// Tiny-5 (a web fixture)` → `// Small-7 (a web fixture)` and `const p = puzzle(5, 5, "..0.......3.1.0.3.1......");` → `const p = puzzle(7, 7, ".11..0..23.2......2.21.0....1....01.1..3..0..1..1");` (tiny-5's trace has no lookahead any more: connectivity steps replace it).

`packages/core/src/generate.test.ts`: `// Frozen output for GENERATOR_VERSION "5".` → `"6"`, and the 20×20 digest → `3351530125, 3105610422, 2737780750, 2198067262`. The 1×1 to 10×10 rows are unchanged (connectivity first changes a removal decision at 20×20 among the goldens).

### 2.7 Web

`apps/web/src/lib/game/patterns.ts`: before the closing `};` of `RULE_PATTERNS` add:

```ts
  // Connectivity. The bottom-right cell's dots have no other open edges, so no path of open edges
  // joins its sides to the line at the top (whose loop can still close around the top-left).
  unreachable: pattern(3, 3, ".........", (a) => ({
    lines: [a.h(0, 0)],
    crosses: [a.v(1, 2), a.h(2, 1), a.v(1, 3), a.h(3, 1)],
    ghostCrosses: [a.h(2, 2), a.v(2, 3), a.h(3, 2), a.v(2, 2)],
  })),
  // The bottom-right cell hangs off the rest at the centre dot: a loop through it would have to
  // pass that dot twice.
  "cut-off": pattern(2, 2, "....", (a) => ({
    lines: [a.h(0, 0)],
    crosses: [a.h(0, 1), a.v(0, 2), a.v(1, 0), a.h(2, 0)],
    dots: [a.dot(1, 1)],
    ghostCrosses: [a.h(1, 1), a.v(1, 2), a.h(2, 1), a.v(1, 1)],
  })),
  // Lines at the top and at the bottom, and the middle row's outer sides crossed: only the middle
  // cell's two sides lead from the top half to the bottom half.
  "two-exits": pattern(3, 3, ".........", (a) => ({
    lines: [a.h(0, 1), a.h(3, 1)],
    crosses: [a.v(1, 0), a.v(1, 3)],
    dots: [a.dot(0, 1), a.dot(3, 1)],
    ghostLines: [a.v(1, 1), a.v(1, 2)],
  })),
```

`apps/web/tests/hint.e2e.ts`: the comment above `RULES` → `// Every rule small-7 uses, so the long texts (corners, colouring, connectivity) are among them.`; in `RULES` add `"line-into-3",` after `"line-into-1",` and `"cut-off",`, `"two-exits",` after `"colour-chain",`. (Small-7's trace now: clue-needs-all, clue-satisfied, clue-zero, colour-2, colour-chain, corner-1, corner-3, cut-off, dot-continue, dot-dead-end, dot-full, line-into-1, line-into-3, lookahead, ones-side-by-side, premature-loop, three-diagonal-one, two-exits, two-passes-on; 81 steps, was 91.)

### 2.8 Bench header

`packages/core/bench/generate.ts`, header item 2: `100×100 takes 6 to 19 minutes a puzzle.` → `100×100 takes 6 to 18 minutes a puzzle (WT18:` / `` *    374 to 1 047 s for seeds `bench-0` to `bench-2`, next to other jobs). ``

### 2.9 API

`bun run gen:api` (adds the three ids to the `rule` enum in `openapi.yaml` and `packages/api-client/src/schema.ts`).

Verify: `bun run format`, `bun run check` (841 pass, 3 skip), then once `E2E_PORT=4391 bunx playwright test tests/hint.e2e.ts` from `apps/web` (17 pass; needs Chromium). Delete `apps/web/build` and `apps/web/test-results` afterwards. Commit.

## Step 3 — DECISIONS

`docs: WT18 decisions (deeper lookahead, connectivity rules, verifier deepening)`

Append the three entries in "DECISIONS entries" below to `docs/DECISIONS.md`, dated 2026-10-26, headed `## 2026-10-26 · WT18 \`deeper-lookahead\` · <title>`. No other doc changes (PRD FR-3 wording is WT20's). Verify: `bun run check`. Commit.

## DECISIONS entries (step 3, verbatim)

```md
## 2026-10-26 · WT18 `deeper-lookahead` · Lookahead probes stay tier 1 in `solve`; the deepened verifier's run the corner rules
- **Question:** A lookahead probe runs tier 1 only (WT2: "depth 1"). Should probes run more of the engine, and which tiers?
- **Decision:** `solve` keeps tier-1 probes. The engine can run the corner rules in a probe too (`Engine.probe`, option `probeCorners`, default false; corner masks are trailed, so `undo` restores them), and only the verifier turns that on, after a long search (`Engine.deepen`, next entries). `Mark` now records `cornerScan` and `undo` puts it back (the WT16 hazard; an engine test fails without it). `cornerWhy` stays untrailed: it changes only while steps are recorded, and nothing undoes then. Probes never touch parity's union-find, so the verifier's `colourLast` pass still reads the root's; a change that runs parity in probes must rebuild it first. Corner probes in `solve`, and probe depth per difficulty level, stay open for WT19 and WT20.
- **Reason:** Measured against tier-1 probes (both with the connectivity rules; plan review 1): corner probes in `solve` solved 35 instead of 29 of the 36 clue-gap corpus boards, cut the with-lookahead gap (20×20: 2.6 → 0.8%) and kept 0.2–0.4 points fewer clues, but made generation 1.7–2.5× slower (40×40 p95 8.5 → 19.1 s; 100×100 seeds `bench-0`/`1`/`2` 374/415/1 047 s → 619/698/1 313 s, the last 73% of the worker's 30 min limit, all run together on a loaded host) and did not make hints lean less on lookahead (`lookahead` share 10/20/40×40 4.4/4.5/3.5% → 4.7/4.3/4.1%, 100×100 4.3–4.9% → 5.6–6.7%: sparser puzzles need it more). Probes running every tier but lookahead solved all 36 but cost 18× at 20×20 (each probe O(edges), a scan O(edges²)); running them only when a tier-1 scan finds nothing was no faster, since every failing clue-removal test ends with a full scan.

## 2026-10-26 · WT18 `deeper-lookahead` · Connectivity rules: out of reach, one way in, only ways across
- **Question:** The connectivity check only detected contradictions. Which connectivity deductions that people use are sound, cheap and useful, and where do they go?
- **Decision:** A new rule group `connectivity` (on by default) replaces the check where it ran (after parity and colouring, before lookahead); without the group the old check runs. Once a line exists: (1) a simple cycle lies inside one block (biconnected component) of the graph of dots and non-crossed edges (Tarjan, O(dots + edges)), so lines in two blocks, or a clue above 0 with no non-crossed side in the lines' block, is a contradiction, and every open edge outside that block is crossed: `cut-off` ("One way in") for the part hanging at one dot of the block, highlighting that dot, and `unreachable` ("Out of reach") for parts no line reaches, highlighting nothing. (2) When that sets nothing, `two-exits` ("Only ways across"): faces are the cells (and the outside) joined across crossed edges; open edges between the same two faces are all lines or all crossed (a closed curve through the two faces meets the graph only at them, and the loop crosses a closed curve an even number of times); if, with all of them crossed, the piece holding the first line misses another line or every non-crossed side of a clue above 0, they are all lines, highlighting a line's dot on each side, or the clue and a line's dot. Groups that are chains through dots with no other open edge (about 99%) are skipped: they can only be forced by a clue whose open sides all lie on them, which clue-needs-all and dot-continue already settle. Each rule is exact for what it looks at, so sound, and crossing edges only splits blocks, merges faces and splits pieces, so monotone. Bridges need no rule: parity already crosses an edge with one face on both sides. While steps are recorded a pass takes one step; otherwise it sets everything it finds. `GENERATOR_VERSION` is now `"6"`.
- **Reason:** Measured (before → after): solver floor without lookahead (from the full clue set) 44.0 → 43.5% (5×5), 42.9 → 42.0% (7×7), 42.4 → 42.0% (10×10), 41.6 → 40.4% (15×15), 43.5 → 42.9% (20×20); clue-gap corpus without lookahead 8 → 11 (with lookahead 29, unchanged); `lookahead` share of generated puzzles' hint traces 6.1 → 4.4% (10×10), 6.3 → 4.5% (20×20), 5.4 → 3.5% (40×40), 5.6–6.3% → 4.3–4.9% (100×100), with `two-exits` 1.2% and the other two 0.2–0.4% of steps; generated density about the same (`bench:generate --quick` clues 39.8–40.6%). Generation 1.1–1.4× slower (p95 20×20 442 → 488 ms, 30×30 2.2 → 2.6 s, 40×40 7.5 → 8.4 s; 100×100 seeds `bench-0`/`1`/`2` 374/415/1 047 s against main's 282 (alone)/311/730 s), about +25% of a solve (+70% before chains were skipped and a `Map` replaced by a hash table). Order independence: 0 differences in 24 000 solves from random subsets of a result and 24 000 from larger sound boards (8 subsets of groups, lookahead and steps on and off), 6 400 more up to 25×25, 14 400 in the reviewer's own stress (run on A in review round 1 and rerun on B in round 2, same counts, 0 failures); 192 000 solves against brute force on small boards.

## 2026-10-26 · WT18 `deeper-lookahead` · The verifier deepens after 200 search nodes
- **Question:** Puzzles the new solver makes rely on connectivity (main's verifier left 1 of 3 generated 40×40 and all of `bench`'s new minimal 30×30 boards `unknown`), but connectivity and corner probes cost more per pass than they save on the boards the verifier already handled. How should `verify` use them (user preference: faster, never slower)?
- **Decision:** `verify` starts as before (tier-1 probes, the detect-only connectivity check, colouring after lookahead at the root). When its search reaches `VerifyOptions.deepenAfterNodes` nodes (default `DEFAULT_DEEPEN_AFTER_NODES` = 200) it undoes to the root, turns on connectivity and corner probes (`Engine.deepen`), propagates with lookahead and searches again. The depth-first search finds solutions in the same order either way, so the answer and the solutions returned are the same; the node and time budgets count across both searches. Tuning the threshold and the deepened search's cost per node belongs to WT19 (verification speed).
- **Reason:** Answers are identical everywhere measured (70 930 small puzzles with `deepenAfterNodes` 0; about 1 200 generated-and-damaged plus about 1 200 random boards up to 20×20 in plan review 1). Speed is not "never slower". Where no search reaches 200 nodes the work is identical (corpus 0.99×, generated "5" 1.03× and 0.98×, windy and empty 8×8 1.00–1.03× with an A/A spread of ±2%, blob boards 0.95–1.01×). Long searches are much faster in aggregate: generator "5" boards with 2 clues dropped 0.14–0.16× (15×15) and 0.19–0.20× (20×20); near-unique 20×20 7.4 s → 0.23 s; generated "6" 40×40 one `unknown` → 3 unique in 168 ms; new minimal 30×30 3 `unknown` → 45 ms; one board main left `unknown` after 120 s finished in 51 s. But where connectivity prunes little each node costs more: 20×20 boards with one clue dropped 1.15–1.37× in aggregate, single boards up to 1.9–2.2×, and a board that exhausted 200 000 nodes in both took 9.6 s against 5.3 s, so a board main settled in 17–30 s can now hit the server's 30 s limit. Thresholds: 50 is 25–41% faster on the new solver's puzzles but 1.3–2.3× slower on near-unique and empty boards; 1 000 is 2.2–3.7× slower on the new solver's puzzles; deepening at the root right away 1.6× on near-unique 15×15. Connectivity at every node cost 1.3–1.9×; deepening without corner probes left a near-unique 20×20 `unknown`; deepening without connectivity left the minimal 30×30 boards `unknown`; deepening the root only and searching without connectivity kept 0.90× of the gain.
- **Accepted (orchestrator decision):** the slower boards, given identical answers and the gains on long searches; WT19 owns tuning.
```

## Acceptance criteria

| Criterion | Check | PRD |
|---|---|---|
| Three new named deductions, recorded per step with a reason, in group `connectivity`; `solve(…, { rules })` without the group gives main's detect-only check | per-rule cases and group test in `solver.test.ts`; `rules.test.ts` (unique ids, texts ≤ 115, titles ≤ 24, one group each) | FR-3 |
| `solve`'s probes stay tier 1; corner probes only with `probeCorners` or after `deepen` | `engine.test.ts`; corpus lists unchanged from main with lookahead (`clue-gaps.test.ts`) | FR-3 |
| Every decided edge holds in every solution, every group subset, with and without lookahead | `agreement.test.ts` (70 930 puzzles, 5 subsets), fast-checks in `solver.test.ts` and `clue-gaps.test.ts` (8 subsets); stress numbers above | FR-3, FR-5, NFR-3 |
| Deepening leaves the verifier's status and solutions unchanged; it agrees with brute force | `agreement.test.ts` (`deepenAfterNodes: 0` against the default), `verify.test.ts` | FR-4, FR-5 |
| Verification speed: identical work below 200 nodes; the measured trade-off above it is recorded in DECISIONS for WT19 | paired A/B tables above (scratch `abv.ts`) | NFR-1 |
| Hints name the new rules, the card fits under small-7 on the smallest phone, each rule has a pattern drawn as a consistent board | `patterns.test.ts`, `hint.e2e.ts` (`RULES` with `cut-off`, `two-exits`) run once with `E2E_PORT=4391` (17 pass) | FR-6, FR-12 |
| Generation stays exact and deterministic | `generate.test.ts` goldens for "6", `restored === 0` tests, density 0.35–0.45 | FR-7–FR-10 |
| Generation time within NFR-1 | `bench:generate --quick` p95 ≤ 2.6 s up to 30×30, 8.4 s at 40×40; 100×100 seeds `bench-0`/`1`/`2` 374/415/1 047 s (loaded host; < 30 min) | NFR-1 |
| Corpus | 29 of 36 with lookahead, 11 without (`clue-gaps.test.ts`) | FR-3 |
| Gate | `bun run check` at each commit (841 pass, 3 skip); `bun run gen:api` leaves `check:api` clean | NFR-3 |

## Open questions

- WT19: the deepened verifier's per-node cost (connectivity's DFS and two-exits pass at every search node) and the 200-node threshold; boards main settled in 17–30 s may now return `unknown` on the server.
- WT20: whether a hard level should use corner probes in `solve` (option A: denser gap closure, ~2× generation).
- Lookahead's text says the contradiction comes "quickly"; only the deepened verifier (which records no steps) uses corner probes, so hints are unaffected.
