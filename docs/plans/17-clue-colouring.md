# WT17 `clue-colouring` — implementation plan

Branch `feat/clue-colouring`, worktree `/home/jhonnold/projects/loophole-wt/clue-colouring` (at `main` with WT13–16: windy loops, clue-gap harness, whole-board clue removal, corner rules and rule groups). PRD: FR-3 (named deductions, recorded per step), FR-4/FR-5 (verifier correct, agreement with brute force), FR-6/FR-12 (steps power hints: cells highlighted, rule explained), FR-10 (deterministic generation per version), NFR-1 (verification must not get slower), NFR-3 (unit and property tests). Roadmap: WT17 row, "Each rules WT", "Per-rule plumbing" and Decisions in `~/.claude/plans/read-through-the-prd-noble-squirrel.md`.

## Goal

Add the "colouring" reasoning people use, driven by clues, as a new optional rule group:

1. **The rule.** Every cell is inside or outside the loop; beyond the border is outside; a clue k has exactly k of its four neighbours on the other side from it. The engine already has a parity union-find over the cells plus an "outside" node, built from known edges. For each 1, 2 or 3, enumerate the side sets of size k (at most 6) that fit the relations the union-find already knows among the cell and its four neighbours (including relations between two neighbours, and two off-board sides being the same outside node), and add every relation between two of those five nodes that holds in all of them. A relation between the cell and a neighbour decides an edge; one between two neighbours is new knowledge that decides edges elsewhere through the union-find. Named patterns it covers: a 3 has at most one neighbour on its own side (two neighbours known alike: both its sides there are lines), a 1 at most one on the other side, around a 2 two neighbours known to differ make the other two differ, a 2 or 3 in a one-wide strip, diagonal cells linked through a clue, and chains of these.
2. **Rule ids.** `colour-1`, `colour-2`, `colour-3` (the step rests on one clue) and `colour-chain` (on several), with titles, texts of at most 115 characters and web patterns; rule group `"colouring"`.
3. **Verifier.** `verify` uses colouring too, after lookahead at its root and after parity in its search. Without it the verifier cannot even prove generator "5" puzzles unique within its budget (measured below).
4. **`solve(…, { steps: false })`.** Records no steps; generation's clue-removal tests use it. Pays for the colouring rule's step bookkeeping (generation is about as fast as before).
5. `GENERATOR_VERSION` "4" → "5", goldens, `gen:api`, DECISIONS entries with the numbers.

Out of scope: lookahead probes running colouring (WT18), corner masks inside colouring (measured: no gain), a colouring rule at dots, difficulty levels (WT20–21), PRD FR-3 wording (WT20 per roadmap), incremental parity (WT19).

## Measured (this machine, 16 cores, Bun 1.3.13; the code in this plan unless marked)

"Before" is `main` at 5756b0d run from a copy of `packages/core` (same seeds, same commands). Every "after" number comes from the full working diff of this plan (`/tmp/claude-1000/-home-jhonnold-projects-loophole/a34715f6-7810-5a69-ba81-edd46bda034d/scratchpad/clue-colouring/wt17-final.diff`).

### Solver floor without lookahead (the key metric), from the full clue set

| Size | main (= colouring off) | **every rule** | colouring without corners | main, corners off too (WT16) |
|---|---|---|---|---|
| 5×5 | 44.5% | **44.0%** | 44.5% | 45.9% |
| 7×7 | 43.7% | **42.9%** | 43.1% | 44.7% |
| 10×10 | 43.4% | **42.4%** | 43.2% | 43.7% |
| 15×15 | 41.8% | **41.6%** | 42.5% | 42.8% |
| 20×20 | 44.1% | **43.5%** | 43.8% | 44.8% |

Commands: `bun run --cwd packages/core bench:clue-gaps --no-lookahead` (every rule), `… --no-lookahead --rules=corners` (reproduces main's line exactly), `… --no-lookahead --rules=colouring`. With lookahead, from the full clue set (`--rules=corners,colouring` against `--rules=corners`): 42.0 / 41.0 / 41.1 / 40.0 / 43.1% against 42.1 / 41.2 / 41.3 / 39.9 / 43.2%; lookahead already finds most of it, more slowly.

### `bench:clue-gaps` (every rule), before → after

| Size | clues | gap | needed | unknown | solver floor | verifier floor (unknown) | time |
|---|---|---|---|---|---|---|---|
| 5×5 (100) | 41.2% → 41.1% | 0.7% → 0.2% | 99.3% → 99.8% | 0 → 0 | 41.2% → 41.1% | 41.0% → 41.0% | 0.8 → 0.9 s |
| 7×7 (100) | 40.1% → 39.9% | 1.2% → 0.8% | 98.8% → 99.2% | 0 → 0 | 40.1% → 39.9% | 39.6% → 39.6% | 2.7 → 3.0 s |
| 10×10 (50) | 40.1% → 39.7% | 4.0% → 2.2% | 95.8% → 97.6% | 5 → 4 | 40.1% → 39.7% | 38.9% (5) → 39.0% (5) | 8.8 → 10.8 s |
| 15×15 (10) | 39.2% → 38.9% | 2.5% → 1.5% | 91.4% → 94.1% | 54 → 39 | 39.2% → 38.9% | 38.4% (53) → 38.4% (42) | 27.6 → 35.8 s |
| 20×20 (10) | 41.5% → 41.2% | 3.1% → 2.7% | 87.3% → 92.1% | 159 → 85 | 41.5% → 41.2% | – | 72 → 66 s |

`removable` and `restored` stay 0.0% everywhere: generation is still exact (see "Order independence"). Generated density drops 0.1–0.4 points.

### Clue-gap corpus (`clue-gaps.test.ts`)

Solved 23 → **29** of 36 (new: `5-41#9`, `5-95#3`, `7-6#11`, `7-8#3`, `10-1#73`, `10-1#81`). Colouring without the corners also solves those same 29; corners without colouring the old 23; neither the old 3. Without lookahead 4 → 8 (`5-41#4`, `5-41#9`, `5-44#16`, `5-81#1`, `5-95#18`, `10-3#41`, `10-4#35`, `10-7#60`).

### Hint steps on generated puzzles (`generate(…).solve` from an empty board, seeds `bench-<n>`)

| Size | steps/puzzle | `lookahead` share | colouring share (colour-2 / colour-chain / colour-1 / colour-3) | `parity` share |
|---|---|---|---|---|
| 10×10 (20) | 178 → 178 | 6.8% → **6.1%** | 1.8% (0.7 / 0.8 / 0.2 / 0.1) | 2.0% → 1.4% |
| 20×20 (10) | 679 → 680 | 7.2% → **6.3%** | 1.4% (0.5 / 0.5 / 0.3 / 0.1) | 2.5% → 2.2% |
| 40×40 (3) | 2587 → 2571 | 6.3% → **5.4%** | 1.4% (0.5 / 0.5 / 0.3 / 0.1) | 2.4% → 1.9% |

(The puzzles differ: generator "5" against "4".) While recording, a colouring pass takes a relation that one clue forces on its own first, and sets one edge; the other edges of that relation follow as `parity` steps. A colouring step highlights its clue cells and the edge's cells that hold no other clue: one-clue steps 2–3 cells, `colour-chain` median 3, 90th percentile 5, at most 8 (10×10 and 20×20 samples: 152 colouring steps, 59 of them `colour-chain`). Plan review 1 checked that every highlighted reason forces its edge by exact enumeration, and that no `colour-chain` step could be explained by one highlighted clue (0 of 49 in its sample, against 91 of 160 before this ordering).

### Verification speed

The verifier matters most on the puzzles it exists for. Generator "5" puzzles need colouring, and main's verifier cannot prove them unique (node cap 20 000, no time limit):

| Set | main | after |
|---|---|---|
| generated "5" 20×20 (10, seeds `bench-<n>`) | 7 unique, **3 unknown**, 84 741 nodes, 1 962 ms | 10 unique, 0 nodes, **78 ms** |
| generated "5" 40×40 (3) | **3 unknown**, 60 003 nodes, 4 127 ms | 3 unique, 0 nodes, **126 ms** |
| near-unique 20×20 (12: a generated "5" puzzle less one clue the rules then cannot solve) | 5 unknown, 106 379 nodes, 3 033 ms | 1 unknown, 23 363 nodes, **1 013 ms** |
| near-unique 15×15 (12, the same way) | 1 052 nodes, 69 ms | about 0.98× (paired) |

`bench` (verify), medians of three alternating runs (ms, p95 in brackets):

| Case | before | after |
|---|---|---|
| 10×10 full | 0.1 (0.3) | 0.1 (0.4–0.5) |
| 30×30 full | 0.3 (0.3–0.5) | 0.3 (0.3–0.5) |
| 100×100 full | 2.0–2.3 (2.3–4.0) | 2.3–2.4 (2.5–3.8) |
| 10×10 70% | 0.1 (0.3–0.5) | 0.1 (0.4) |
| 30×30 70% | 0.5 (0.7–1.1) | 0.5–0.6 (1.1–1.9) |
| 100×100 70% | 13.6–14.7 (22.2–23.7) | 13.8–15.2 (24.8–28.2) |
| 10×10 minimal | 0.2 (0.5) | 0.2–0.3 (0.4–0.6) |
| 30×30 minimal | 4.0–5.0 (4.7–5.0) | 5.2–5.8 (5.8–7.2), see below |

The "minimal" lines compare different puzzles: the bench builds them with `solve`, and colouring lets more clues go. On main's 30×30 minimal boards (19.3% clues; paired, median of 20 rounds) the new verifier takes 0.93× main's time; on the ones the new solver builds (19.1%), main's verifier runs into its 30 s default limit while the new one takes 15 ms for all three. Paired A/B on fixed sets (both engines in one process, alternating, median of 40–60 rounds; same-engine A/A spread ±5%):

| Set | after / before |
|---|---|
| clue-gap corpus (36) | 1.03 |
| generated "3" 20×20 (10), 40×40 (3) (main-era puzzles the old rules solve) | 0.99–1.05, 0.96 |
| windy 8×8 at 60% (30; many solutions), 12×12 at 65% (10) | 1.07–1.12, 1.03 |
| empty 8×8 boards (30) | 1.00 |
| blob loops at 70%: 30×30 (20), 100×100 (5) | 1.03, 1.02 |
| blob loops, every clue, 100×100 (5) | 1.03–1.09 (tier 1 solves these; colouring never runs) |

So the verifier is as fast as before on everything main could already verify, within the noise, except small boards with many solutions (windy 8×8: +7–12%, about 0.01 ms a board), and it now verifies generated puzzles at all.

Where colouring sits in the verifier (paired, same sets):

| Variant | corpus | g "3" 20×20 | g "3" 40×40 | windy 8×8 | 100×100 70% | near-unique 20×20 |
|---|---|---|---|---|---|---|
| **after lookahead at the root, after parity in the search (chosen)** | 1.03 | 0.99–1.05 | 0.96–1.02 | 1.06–1.12 | 1.02–1.06 | 1 013 ms |
| right after parity everywhere (as `solve` does) | 0.82–0.90 | 0.97–1.0 | 1.24 | 1.08–1.11 | 1.12–1.15 | 934 ms |
| in the search only, not at the root | 1.01 | 0.96 | – | 1.05 | 1.04 | 3 196 ms (3 unknown) |
| not at all (verifier = main) | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 3 078 ms (5 unknown); generated "5": unknown |

### `bench:generate --quick`, before → after

| Size | p95 | median | clues |
|---|---|---|---|
| 7×7 | 13 → 12 ms | 9 → 9 ms | 40.0% → 39.9% |
| 10×10 | 35 → 33 ms | 25 → 20 ms | 40.3% → 40.0% |
| 20×20 | 494 → 442 ms | 351 → 321 ms | 40.2% → 40.0% |
| 30×30 | 2.4 → 2.4 s | 1.9 → 1.9 s | 40.5% → 40.1% |
| 40×40 | 7.3 → 7.9 s | 5.2 → 5.5 s | 41.0% → 40.6% |

Every result `unique`, first attempt 100%, restored 0.0% (both runs side by side with other jobs). 100×100 seed `bench-0` (scratch `gen100.ts`): 259 → 282 s (run next to other jobs), clues 41.3% → 41.1%, nothing restored, `verify` of the result 0.76 → 0.92 s (different puzzles), hint trace 15 395 → 15 377 steps with 6.5% → 6.0% lookahead. Step 1 alone (no colouring: removal tests without steps) gives byte-identical output for generator "4" (goldens and 40 seeds, steps included) and is 7–10% faster at 20×20 and 30×30 (403 → 374 ms, 1 662 → 1 496 ms means over 6 and 3 seeds); colouring then spends about that again.

`solve` with steps recorded is slower than without on large boards (generated 40×40: 144 ms against 88 ms for 3 puzzles; main 89 / 76 ms on its own puzzles): while recording, each colouring pass sets one edge and finds that step's reason. Hints ask for one step (`maxSteps: 1`) and stop there.

### Order independence (generation's exactness depends on it; WT15/WT16 DECISIONS)

Scratch `stress.ts` (random planted puzzles: windy loop, 20–100% of clues, 0–40% of the solution given, lookahead on or off, every subset of rule groups; sides up to 10, 12 and 25):

- soundness: 17 600 solves, no edge against the planted solution, no contradiction;
- order independence: 52 800 solves from random subsets of a result give that result; monotonicity: 52 800 solves from larger sound boards keep every decided edge (half of each with steps recorded, half without); again after the single-clue-first change, 16 800 and 16 800 (sides up to 12);
- colouring off equals main: 5 000 solves with `rules: ["corners"]` and `rules: []` equal main's (steps included, `JSON.stringify`);
- verifier equals main: 4 386 boards up to 12×12 (up to 64 cells), same status, same solution when unique, every returned solution valid.

Plan review 1 also ran an independent brute force (1 216 000 solves over every group subset, lookahead and step mode: every decided edge agrees with every solution), a naive full-round colouring oracle (no edge left to decide on 230 944 stuck results) and an order-shuffled variant engine (identical results and verifier node counts).

0 failures. `bench:clue-gaps` and `bench:generate` above: removable 0.0%, restored 0.0%.

### Alternatives measured (prototype) and not taken

| Variant | Result |
|---|---|
| Corner masks inside the colouring enumeration (candidates must fit the clue's four corner masks too) | No-lookahead floor 44.0 / 42.9 / 42.4 / 41.6 / 43.5%, corpus 29 and 8: identical to without; the first prototype's verify got slower with them (generated 20×20 1.17–1.20× against 1.11×). Not used, so colouring reads nothing of the corner tier. |
| Full rounds over every clue cell until no relation is added, then one scan of every open edge (first prototype) | Same result; 2.6 rounds a call on generated 20×20 boards, +11% verify on them, and +50% generation at 20×20 (removal tests then still recorded steps). Replaced by the worklist (cells beside the smaller set) and deciding edges as relations join sets. |
| Rings and sizes kept by every parity union instead of built on a pass's first relation | No clear difference (blob 100×100 at 70%, colouring right after parity: 1.12× against 1.145×, within the noise); the lazy build leaves `parity()` unchanged. |
| Colouring to its fixpoint while recording too | Same edges; 842 colouring steps on 30 generated boards, 653 of them `colour-chain` (median 5 cells). |
| While recording, stop at the first cell that decides an edge, setting every edge of its relation (plan before review 1) | 420 steps, 208 `colour-chain`, but 57% of `colour-chain` steps were explained by one highlighted clue: earlier cells in the same pass had added relations the deciding cell then leaned on (the old `0...11.3.` example was one: the 3 alone decides it). Replaced by the single-clue-first round and one edge a pass (152 steps, 59 `colour-chain`, none explained by one clue); recorded solve time the same (56 ms for generated 20×20, 144 ms for 40×40). |
| Generation's removal tests recording steps (as main) | With colouring +10–20% at 20×20 and +30–80% at 30×30 (more colouring passes and the reasons' forest searches). Replaced by `steps: false` (step 1). |
| Colouring after lookahead in generation's tests too | Same output, 8–16% slower at 20×20 and 30×30 than right after parity. Only the verifier uses it. |
| Colouring at dots (no four lines: the four cells around a dot are never a checkerboard) | Not built: the clue rule is what the roadmap and the named patterns ask for; left for WT18. |

## What was found (for the DECISIONS entries)

**Why a clue-cell enumeration on the parity union-find.** Edges are colour differences: an edge is a line exactly when its two cells are on different sides. So a clue's side set m (bit j: side j is a line) is also the colouring of its four neighbours relative to it, and the parity union-find's relations among the cell and its neighbours are XOR constraints on m: two nodes in one set fix the XOR of their bits; two off-board sides are one node, so they must be equal. Enumerating the at most 6 candidates, dropping those that break a constraint, and keeping any pairwise XOR that is the same in all that remain is exact for that clue, so it is sound; with more relations fewer candidates remain, so it is monotone, and the fixpoint does not depend on the order cells are looked at. A relation between the cell and a neighbour is its side; one between two neighbours is what the parity tier alone could never learn (it only joins cells across known edges).

**Why nothing is trailed.** Parity rebuilds the union-find from the edges on every pass. Colouring adds its relations to that union-find and they are gone at the next pass, re-derived from the edges. So the result is a function of the edges alone, lookahead probes and the verifier's search need no undo for it, and `undo` does not change. The price is re-deriving the same relations on every pass; on boards where they decide nothing (blob 100×100 loops at 70% with colouring right after parity: 124 of 156 passes add relations, 7 edges in all, +12–15% verify) that is wasted, which is why the verifier runs colouring after lookahead. WT19's incremental parity could keep them.

**What a colouring step highlights and how it is named.** Steps come from edges, one per edge. While steps are recorded the engine keeps each relation it adds with its clue cell and the relations it used (cut down greedily to those needed). The links behind the union-find form a forest (a spanning forest of the known edges, then the colouring relations in the order they were added, each joining two sets); the reason for an edge is the clue cells of the colouring relations on the forest path between its two cells, followed through the relations each one used. One clue → `colour-1`, `colour-2` or `colour-3` ("Sides around a 1/2/3"); more → `colour-chain` ("Sides pass along"). The cells are those clues and the edge's two cells, unless such a cell holds a clue the reason does not use. For the name to be honest the order matters: while recording, a pass first looks for one clue whose own relation, on the union-find as parity built it, decides an edge, and only then lets relations chain through other clues; and it sets one edge, leaving the rest of that relation's edges to the next parity pass (named `parity`, which they are).

## Design

### The rule

- Nodes: cells `0 … C-1` and the outside node `C` (`sideNode`). For clue cell i: node 0 = i, node j + 1 = the node across side j (0 top, 1 right, 2 bottom, 3 left; `across`).
- Candidates: `CELL_CONFIGS[k]` (side sets of size k). For candidate m, `col = m << 1`: bit t is 1 when node t is on the other side from node 0.
- Known relations: for t = 0…4, root and parity by `ufFind`; `cRep[t]` = the first node s < t in the same set (or t), bit t of `known` set when s < t. A candidate fits when, for each t in `known`, `bit_t(col) ^ bit_s(col) === par_t ^ par_s`.
- No candidate fits → contradiction. For each pair (a, b) in different sets whose `bit_a ^ bit_b` is the same x in every fitting candidate: join (a's set, b's set) with "differ exactly when x = 1".
- Skips (pure speed, same result): all four sides known (the cell is linked to every neighbour); `known === 0` (no constraint: for k = 1, 2, 3 no pair is fixed then). 0s and 4s are left to tier 1.

### Joining and deciding

- `colourJoin`: roots `small`, `large` (by `ufSize`), `ufParent[small] = large`, `ufParity[small] = pa ^ pb ^ x`. Then for every node of the smaller set (its ring, `ufNext`): decide its open edges whose other side is now in `large`'s set (`colourEdges`; the outside node's edges are the border edges), and queue the clue cells 1–3 at or beside it (the outside node: every border clue cell). Every edge between the two sets touches a node of the smaller one, and every cell with nodes in both sets has one there, so this finds all that the join can change, in O(smaller set). Then merge the rings.
- Invariant: when a join returns, no open edge has both sides in one set (true after parity returns 0, kept by each join), so `colourEdges` only needs edges between the two sets just joined.
- Rings: built lazily (`buildRings`, O(cells)) on a pass's first join, since the union-find was rebuilt by parity; most passes on easy boards add nothing.

### Tier placement

- In `propagate`, right after `parity()` returns 0 (the union-find holds exactly the edge relations, all already decided): `colour()`; > 0 → back to tier 1; -1 → contradiction; 0 → `connected`, lookahead.
- `colourLast` (`EngineOptions`, default false): run colouring only once lookahead returns 0. The fixpoint is the same; the verifier uses it at its root (its search has no lookahead, so there colouring comes after parity either way).
- While steps are recorded, `colour()` first runs one round over the clue cells in which a cell may add only a relation that decides an edge (`single`, `decidesEdge`), and stops at the first; if none does, it runs the worklist and stops after the first cell that decided an edge. Either way `colourEdges` sets only the pass's first edge, and the cheaper tiers (parity first) follow up. Without steps it drains the queue and sets every edge. Same fixpoint (tested by the fast-check in `solver.test.ts`, which solves the part board the other way).
- Lookahead probes still run tier 1 only (WT18).

### Rule group, solve option, verifier, generator

- `rules.ts`: `RULE_GROUPS = ["corners", "colouring"]`, `GROUP_RULES.colouring = ["colour-1", "colour-2", "colour-3", "colour-chain"]`.
- `SolveOptions.steps?: boolean` (default true). `generate`'s `ALL_RULES` passes `steps: false`; the result's `solve` is one recording `solve(work)` at the end (`restoreClues` already ends solved).
- `Engine`'s constructor takes `EngineOptions` (`corners`, `colouring`, `colourLast`, defaults true / true / false) instead of the positional `cornersOn` flag. `solve` passes the groups; `verify` passes `{ colourLast: true }`.

### Files

| File | Change |
|---|---|
| `packages/core/src/solver.ts` | `steps` option (step 1); colouring flag to the engine (step 2) |
| `packages/core/src/generate.ts` | removal tests without steps (step 1); `GENERATOR_VERSION` "5" (step 2) |
| `packages/core/src/rules.ts` | 4 rule ids, texts, titles; group `colouring` |
| `packages/core/src/engine.ts` | colouring tier (fields, `colour`, `colourCell`, joins, rings, reasons), `EngineOptions`, `propagate` |
| `packages/core/src/verify.ts` | colouring after lookahead |
| `packages/core/src/solver.test.ts` | `steps: false` test (step 1); 4 per-rule cases, group test, fast-check over every group subset and both step modes |
| `packages/core/src/agreement.test.ts` | every check with every group, each alone, none |
| `packages/core/src/clue-gaps.test.ts` | `SOLVED` (29), `SOLVED_WITHOUT_COLOURING` (23), `SOLVED_WITHOUT_GROUPS` (3); fast-check over group subsets |
| `packages/core/src/verify.test.ts` | the "searches when stuck" fixture (the old one is now solved by the rules) |
| `packages/core/src/generate.test.ts` | goldens for "5" |
| `apps/web/src/lib/game/patterns.ts` | 4 patterns |
| `apps/web/tests/hint.e2e.ts` | `RULES` for small-7 (not in the gate; run it once) |
| `openapi.yaml`, `packages/api-client/src/schema.ts` | `bun run gen:api` (rule enum) |
| `docs/DECISIONS.md`, `packages/core/AGENTS.md` | docs |

`hint.ts`, `index.ts`, `bench/*`, the server and the rest of the web app do not change (`bench:clue-gaps --rules=` already takes any `RULE_GROUPS` name).

## Rules for the implementer

- Mode EXECUTE; follow the steps in order; the code blocks are exact (they were run: `bun run check` passed with them, 835 pass, 3 skip). Run `bun run format` after editing, then the step's checks.
- Bun lives in `~/.bun/bin`: prefix commands with `export PATH="$HOME/.bun/bin:$PATH";`. Run `bun install --frozen-lockfile` first.
- Do not clone the repo (`/tmp` is a 16 GB tmpfs shared with other worktrees); scratch scripts go in your scratchpad, not in the worktree. The planner's full diff is at `/tmp/claude-1000/-home-jhonnold-projects-loophole/a34715f6-7810-5a69-ba81-edd46bda034d/scratchpad/clue-colouring/wt17-final.diff` if a block below is ambiguous (the code there is the reference; do not `git apply` it blindly, commit per step).
- Commit at the three boundaries given (conventional commits). `bun run check` must pass at each.
- If a number in a test differs from this plan, stop and find out why before changing the test: the expected values come from this exact code.

## Step 1 — `solve` without steps; generation's clue tests use it

`perf(core): solve can skip recording steps, and generation's clue tests do`

1.1 `packages/core/src/solver.ts`, in `SolveOptions`, before `/** Stop after recording this many steps. Default no limit. */` insert:

```ts
  /**
   * Record steps. Default true. Without them `steps` comes back empty and `maxSteps` does nothing,
   * and solving is faster; generation's clue removal tests read only the status and edges.
   */
  readonly steps?: boolean;
```

and replace `  engine.steps = steps;` with `  engine.steps = options.steps === false ? null : steps;`.

1.2 `packages/core/src/generate.ts`:

- Replace

```ts
/** Every rule, lookahead included. */
const ALL_RULES: RuleSolver = (puzzle, initial) => solve(puzzle, { initial });
```

  with

```ts
/** Every rule, lookahead included. Records no steps: the tests read only the status and edges. */
const ALL_RULES: RuleSolver = (puzzle, initial) => solve(puzzle, { initial, steps: false });
```

- In `generate`, `const { result, restored } = restoreClues(work, full, rng, ALL_RULES);` → `const { restored } = restoreClues(work, full, rng, ALL_RULES);`, and in the returned object `solve: result,` → `solve: solve(work),` (`restoreClues` returns only once the rules solve `work`, so this is the same solve, with steps).

1.3 `packages/core/src/solver.test.ts`, in `describe("solve: each rule")`, before `test("two 3s side by side do not claim their shared side"` add:

```ts
  test("without steps it reaches the same edges and records none", () => {
    const p = puzzle(3, 3, "0...11.3.");
    const full = solve(p);
    const bare = solve(p, { steps: false });
    expect(bare.status).toBe(full.status);
    expect(bare.edges).toEqual(full.edges);
    expect(bare.steps).toEqual([]);
  });

```

Verify: `bun run check` (no golden changes: the output of generator "4" is byte-identical, steps included). Commit.

## Step 2 — Colouring rule group, verifier, tests, goldens, web patterns

`feat(core): clue colouring as an optional rule group, with hints`

### 2.1 `packages/core/src/rules.ts`

- In `RULE_IDS`, between `"parity",` and `"lookahead",` insert:

```ts
  "colour-1",
  "colour-2",
  "colour-3",
  "colour-chain",
```

- `export const RULE_GROUPS = ["corners"] as const;` → `export const RULE_GROUPS = ["corners", "colouring"] as const;`
- In `GROUP_RULES`, after the `corners: [ … ],` entry add `  colouring: ["colour-1", "colour-2", "colour-3", "colour-chain"],`
- In `RULE_TEXT`, after the `parity:` entry add:

```ts
  "colour-1":
    "Just one cell beside a 1 is on the other side of the loop (off the board is outside), which settles this edge.",
  "colour-2":
    "Two cells beside a 2 are on its side of the loop, two are not (off the board is outside), which settles this edge.",
  "colour-3":
    "Just one cell beside a 3 is on the same side of the loop as it (off the board is outside), which settles this edge.",
  "colour-chain":
    "Working out which side of the loop the cells beside the highlighted clues are on leaves one way for this edge.",
```

  (110, 114, 115 and 110 characters.)
- In `RULE_TITLE`, after `parity: "Inside and outside",` add:

```ts
  "colour-1": "Sides around a 1",
  "colour-2": "Sides around a 2",
  "colour-3": "Sides around a 3",
  "colour-chain": "Sides pass along",
```

### 2.2 `packages/core/src/solver.ts`

`const engine = new Engine(puzzle, budget, rules.includes("corners"));` →

```ts
  const engine = new Engine(puzzle, budget, {
    corners: rules.includes("corners"),
    colouring: rules.includes("colouring"),
  });
```

### 2.3 `packages/core/src/engine.ts`

(a) File comment: replace the tier-4 item

```ts
 * 4. inside/outside parity, a union-find over cells (global), then a connectivity check that
 *    only detects contradictions (global)
```

with

```ts
 * 4. inside/outside parity, a union-find over cells (global); when it decides nothing,
 *    colouring (optional): the relations each 1, 2 or 3 forces among its neighbours' sides, added
 *    to the same union-find (global); then a connectivity check that only detects contradictions
```

(b) Fields: right after `  private ufFound = 0;` insert:

```ts
  /**
   * Colouring. These arrays are allocated on the first colouring pass (`initColour`), so a puzzle
   * the earlier tiers finish pays nothing. Once a pass adds its first relation, each union-find
   * set's nodes form a ring (`ufNext`) with the set's size at its root (`ufSize`), so a new
   * relation can find the clue cells and edges beside the smaller of the two sets it joins.
   */
  private ufNext = new Int32Array(0);
  private ufSize = new Int32Array(0);
  /** Cells with a 1, 2 or 3, in index order: the cells the colouring rule looks at. */
  private colourCells = new Int32Array(0);
  /** Of those, the ones on the board's edge: the cells beside the outside node. */
  private borderColourCells = new Int32Array(0);
  /** The edges on the board's border: the outside node's edges. */
  private borderEdges = new Int32Array(0);
  private colourQueue = new Int32Array(0);
  private inColourQueue = new Uint8Array(0);
  private colourHead = 0;
  private colourLen = 0;
  /** `colourCell`'s scratch: its five nodes, their roots and parities, each one's set's first. */
  private readonly cNode = new Int32Array(5);
  private readonly cRoot = new Int32Array(5);
  private readonly cPar = new Uint8Array(5);
  private readonly cRep = new Int8Array(5);
  /** `colourCell`'s scratch: the fitting candidates (at most 6, for a 2). */
  private readonly cFit = new Int32Array(6);
  /**
   * While steps are recorded: each relation the colouring rule added in the current pass (its two
   * nodes, its clue cell, and the node pairs whose relations it used), for the steps' reasons.
   */
  private readonly colourRecs: ColourRec[] = [];
  /** While steps are recorded: the links behind the union-find (`colourForest`), once needed. */
  private forest: Forest | null = null;
  /** Edges the current colouring pass has set. */
  private colourSet = 0;
  /** While steps are recorded: in the pass's first round, which adds one deciding relation. */
  private single = false;
  /** Whether `ufNext` and `ufSize` describe the current union-find (see `buildRings`). */
  private rings = false;
```

(c) Options and constructor. Right before `export class Engine {` insert:

```ts
export interface EngineOptions {
  /** Run the corner rules (rule group "corners"). Default true. */
  readonly corners?: boolean;
  /** Run the colouring rule (rule group "colouring"). Default true. */
  readonly colouring?: boolean;
  /**
   * Run colouring only once lookahead finds nothing, instead of right after parity. Default false.
   * The fixpoint is the same and only the order of steps changes (hints would prefer lookahead to
   * colouring); the verifier, which reads no steps, saves a colouring pass before each lookahead
   * deduction.
   */
  readonly colourLast?: boolean;
}
```

and replace the constructor head

```ts
  constructor(
    puzzle: Puzzle,
    private readonly budget: Budget,
    /** Run the corner rules (rule group "corners"). */
    private readonly cornersOn = true,
  ) {
```

with

```ts
  private readonly cornersOn: boolean;
  private readonly colourOn: boolean;
  private readonly colourLast: boolean;

  constructor(
    puzzle: Puzzle,
    private readonly budget: Budget,
    options: EngineOptions = {},
  ) {
    this.cornersOn = options.corners ?? true;
    this.colourOn = options.colouring ?? true;
    this.colourLast = options.colourLast ?? false;
```

(the rest of the constructor stays; `this.cornersOn` is read as before.)

(d) `propagate`: replace its doc comment with

```ts
  /**
   * Tiers 1, 3 (when the corners group is on), 4 (colouring when that group is on) and (optionally)
   * 5 until nothing changes. False on a contradiction. Checks the time budget on every pass, since
   * each parity pass costs O(edges).
   */
```

and, in its body, replace from `      const p = this.parity();` to the end of the loop (`      return true;` and the closing `    }` and `  }`) with

```ts
      const p = this.parity();
      if (p < 0) return false;
      if (p > 0) continue;
      // Colouring works on the union-find parity just built; nothing below changes it.
      const last = this.colourLast && lookahead;
      if (this.colourOn && !last) {
        const c = this.colour();
        if (c < 0) return false;
        if (c > 0) continue;
      }
      if (!this.connected()) return false;
      if (!lookahead) return true;
      const q = this.lookahead();
      if (q < 0) return false;
      if (q > 0) continue;
      if (this.colourOn && last) {
        const c = this.colour();
        if (c < 0) return false;
        if (c > 0) continue;
      }
      return true;
    }
  }
```

(e) The tier: insert right before the doc comment of `connected()` (`  /**` / `   * False when the loop cannot be one piece: …`), after the closing `}` of `ufFind`:

```ts
  // --- tier 4b: colouring -------------------------------------------------------------------

  /**
   * Colouring, run on parity's union-find when parity decides nothing. Every cell is inside or
   * outside the loop, everything beyond the border is outside, and a clue k has exactly k of its
   * four neighbours on the other side from it. `colourCell` adds every relation a clue forces among
   * its cell and the cell's neighbours, and each new relation decides the open edges between the
   * two sets it joins, one step per edge. A cell is looked at again when a new relation joins two
   * sets it has nodes in. Returns the number of edges set, or -1 on a contradiction.
   */
  private colour(): number {
    if (this.ufNext.length === 0) this.initColour();
    const { colourCells } = this;
    const recording = this.steps !== null;
    this.rings = false;
    this.colourSet = 0;
    this.forest = null;
    if (recording) {
      this.colourRecs.length = 0;
      // A hint names the simplest deduction: first a clue whose own relation decides an edge on
      // the union-find as parity built it, and only then relations that chain through others.
      this.single = true;
      for (let x = 0; x < colourCells.length && this.colourSet === 0; x++) {
        if (!this.colourCell(colourCells[x])) {
          this.single = false;
          return -1;
        }
      }
      this.single = false;
      if (this.colourSet > 0) return this.colourSet;
    }
    for (let x = 0; x < colourCells.length; x++) this.queueColour(colourCells[x]);
    while (this.colourLen > 0) {
      const ok = this.colourCell(this.dequeueColour());
      // While steps are recorded, stop at the first cell that decides an edge, so the cheaper
      // rules (parity first) follow it up before the next colouring step.
      if (!ok || (recording && this.colourSet > 0)) {
        while (this.colourLen > 0) this.dequeueColour();
        if (!ok) return -1;
      }
    }
    return this.colourSet;
  }

  /** Allocates the colouring arrays (see `ufNext`). */
  private initColour(): void {
    const { grid, clues } = this;
    const C = grid.cellCount;
    const cells: number[] = [];
    const border: number[] = [];
    for (let i = 0; i < C; i++) {
      if (clues[i] < 1 || clues[i] > 3) continue;
      cells.push(i);
      const r = Math.floor(i / grid.width);
      const c = i % grid.width;
      if (r === 0 || c === 0 || r === grid.height - 1 || c === grid.width - 1) border.push(i);
    }
    const edges: number[] = [];
    for (let e = 0; e < grid.edgeCount; e++) {
      if (grid.edgeCells[e * 2] === NONE || grid.edgeCells[e * 2 + 1] === NONE) edges.push(e);
    }
    this.colourCells = Int32Array.from(cells);
    this.borderColourCells = Int32Array.from(border);
    this.borderEdges = Int32Array.from(edges);
    this.ufNext = new Int32Array(C + 1);
    this.ufSize = new Int32Array(C + 1);
    this.colourQueue = new Int32Array(C);
    this.inColourQueue = new Uint8Array(C);
  }

  /**
   * The colouring rule at clue cell `i`. Node 0 is the cell and node j + 1 the node across its side
   * j (0 top, 1 right, 2 bottom, 3 left). A candidate is a set of k sides, k the clue: neighbour j
   * is on the other side from the cell exactly when side j is in it. Keeps the candidates that fit
   * the relations known among the five nodes and adds each relation between two of them (in
   * different sets) that is the same in all of those. False on a contradiction: no candidate fits,
   * or an edge the new relations decide breaks a rule.
   */
  private colourCell(i: number): boolean {
    const { grid, edges, cNode, cRoot, cPar, cRep, cFit } = this;
    const base = i * 4;
    // All four sides known: the cell is linked to every neighbour already, nothing to add.
    if (
      edges[grid.cellEdges[base]] !== Unknown &&
      edges[grid.cellEdges[base + 1]] !== Unknown &&
      edges[grid.cellEdges[base + 2]] !== Unknown &&
      edges[grid.cellEdges[base + 3]] !== Unknown
    ) {
      return true;
    }
    cNode[0] = i;
    for (let j = 0; j < 4; j++) cNode[j + 1] = across(grid, i, j);
    // Bit t of `known`: node t shares a set with an earlier node, the first of which is cRep[t].
    let known = 0;
    for (let t = 0; t < 5; t++) {
      cRoot[t] = this.ufFind(cNode[t]);
      cPar[t] = this.ufFound;
      cRep[t] = t;
      for (let s = 0; s < t; s++) {
        if (cRoot[s] === cRoot[t]) {
          cRep[t] = s;
          known |= 1 << t;
          break;
        }
      }
    }
    // Nothing known among the five: every candidate fits, and no relation holds in all of them.
    if (known === 0) return true;
    const k = this.clues[i];
    // Each fitting candidate as `col`: bit t set when node t is on the other side from the cell.
    let fits = 0;
    for (const m of CELL_CONFIGS[k]) {
      const col = m << 1;
      if (this.colourFits(col, known)) cFit[fits++] = col;
    }
    if (fits === 0) return false;
    for (let a = 0; a < 5; a++) {
      for (let b = a + 1; b < 5; b++) {
        if (cRoot[a] === cRoot[b]) continue;
        const x = ((cFit[0] >> a) ^ (cFit[0] >> b)) & 1;
        let holds = true;
        for (let q = 1; q < fits && holds; q++) {
          holds = (((cFit[q] >> a) ^ (cFit[q] >> b)) & 1) === x;
        }
        if (!holds) continue;
        // The first pass while recording adds only a relation that decides an edge, and one.
        if (this.single && (this.colourSet > 0 || !this.decidesEdge(a, b))) continue;
        if (!this.colourJoin(i, known, a, b, x)) return false;
      }
    }
    return true;
  }

  /** Whether an open edge joins the sets of nodes a and b of the current cell (which differ). */
  private decidesEdge(a: number, b: number): boolean {
    const { grid, edges, ufNext, ufSize, cNode } = this;
    let small = this.ufFind(cNode[a]);
    let large = this.ufFind(cNode[b]);
    if (small === large) return false;
    if (!this.rings) this.buildRings();
    if (ufSize[small] > ufSize[large]) {
      const t = small;
      small = large;
      large = t;
    }
    const C = grid.cellCount;
    let n = small;
    do {
      const list = n === C ? this.borderEdges : grid.cellEdges;
      const from = n === C ? 0 : n * 4;
      const to = n === C ? list.length : from + 4;
      for (let x = from; x < to; x++) {
        const e = list[x];
        if (edges[e] !== Unknown) continue;
        const s = sideNode(grid, e, 0);
        if (this.ufFind(s === n ? sideNode(grid, e, 1) : s) === large) return true;
      }
      n = ufNext[n];
    } while (n !== small);
    return false;
  }

  /** True when candidate `col` fits the relation of each node in `known` to its set's first. */
  private colourFits(col: number, known: number): boolean {
    const { cRep, cPar } = this;
    for (let t = 1; t < 5; t++) {
      if (!(known & (1 << t))) continue;
      const s = cRep[t];
      if ((((col >> t) ^ (col >> s)) & 1) !== (cPar[t] ^ cPar[s])) return false;
    }
    return true;
  }

  /**
   * Adds "nodes a and b of cell i are on different sides exactly when x is 1" to the union-find
   * (nothing when an earlier relation of the same cell put them in one set). Then, for each node of
   * the smaller of the two sets, decides its open edges to the other set and queues the clue cells
   * at or beside it: every cell with nodes in both sets has one there. False on a contradiction.
   */
  private colourJoin(i: number, known: number, a: number, b: number, x: number): boolean {
    const { ufParent, ufParity, ufSize, ufNext, cNode } = this;
    let small = this.ufFind(cNode[a]);
    const pa = this.ufFound;
    let large = this.ufFind(cNode[b]);
    const pb = this.ufFound;
    if (small === large) return true;
    if (!this.rings) this.buildRings();
    if (ufSize[small] > ufSize[large]) {
      const t = small;
      small = large;
      large = t;
    }
    ufParent[small] = large;
    ufParity[small] = pa ^ pb ^ x;
    if (this.steps !== null) {
      const deps = this.colourDeps(this.clues[i], known, a, b, x);
      this.colourRecs.push({ u: cNode[a], v: cNode[b], cell: i, deps });
      if (this.forest !== null) {
        addLink(this.forest, cNode[a], cNode[b], this.colourRecs.length - 1);
      }
    }
    let n = small;
    do {
      this.queueAround(n);
      if (!this.colourEdges(n, large)) return false;
      n = ufNext[n];
    } while (n !== small);
    this.joinRings(small, large);
    return true;
  }

  /**
   * Decides the open edges between node `n` and the nodes of the set with root `large`, which a
   * colouring relation has just joined to n's set (while steps are recorded, only the pass's first
   * edge: the next parity pass decides the rest, as `parity` steps). False when one breaks a rule.
   */
  private colourEdges(n: number, large: number): boolean {
    const { grid, edges } = this;
    const C = grid.cellCount;
    const list = n === C ? this.borderEdges : grid.cellEdges;
    const from = n === C ? 0 : n * 4;
    const to = n === C ? list.length : from + 4;
    for (let x = from; x < to; x++) {
      if (this.steps !== null && this.colourSet > 0) return true;
      const e = list[x];
      if (edges[e] !== Unknown) continue;
      const a = sideNode(grid, e, 0);
      const other = a === n ? sideNode(grid, e, 1) : a;
      if (this.ufFind(other) !== large) continue;
      const po = this.ufFound;
      this.ufFind(n);
      const state = this.ufFound !== po ? Line : Cross;
      if (this.recording()) {
        this.forest ??= this.colourForest();
        const why = colourReason(this.forest, this.colourRecs, n, other);
        // The edge's cells too, unless they hold a clue the reason does not use.
        const cells = new Set(why);
        if (n !== C && this.clues[n] === NO_CLUE) cells.add(n);
        if (other !== C && this.clues[other] === NO_CLUE) cells.add(other);
        this.begin(
          why.length === 1 ? COLOUR_RULE[this.clues[why[0]]] : "colour-chain",
          [...cells].sort((p, q) => p - q),
          [],
        );
      }
      if (!this.assign(e, state)) return false;
      this.commit();
      this.colourSet++;
    }
    return true;
  }

  /** Puts each union-find set's nodes in a ring, with the set's size at its root. */
  private buildRings(): void {
    const { ufNext, ufSize } = this;
    const n = this.grid.cellCount + 1;
    for (let x = 0; x < n; x++) {
      ufNext[x] = x;
      ufSize[x] = 1;
    }
    for (let x = 0; x < n; x++) {
      const r = this.ufFind(x);
      if (r === x) continue;
      ufNext[x] = ufNext[r];
      ufNext[r] = x;
      ufSize[r]++;
    }
    this.rings = true;
  }

  /** Merges the node rings of roots `a` and `b` into b's. */
  private joinRings(a: number, b: number): void {
    const { ufNext, ufSize } = this;
    ufSize[b] += ufSize[a];
    const t = ufNext[a];
    ufNext[a] = ufNext[b];
    ufNext[b] = t;
  }

  /**
   * For a step's reason: the node pairs whose known relations the relation between nodes a and b
   * rests on. Starts from every known one and drops each that every fitting candidate keeps a and b
   * related by x without.
   */
  private colourDeps(k: number, known: number, a: number, b: number, x: number): number[] {
    let need = known;
    for (let t = 1; t < 5; t++) {
      const fewer = need & ~(1 << t);
      if (fewer !== need && this.colourHolds(k, fewer, a, b, x)) need = fewer;
    }
    const deps: number[] = [];
    for (let t = 1; t < 5; t++) {
      if (need & (1 << t)) deps.push(this.cNode[this.cRep[t]], this.cNode[t]);
    }
    return deps;
  }

  /** True when every candidate for a clue k that fits `known` has nodes a and b related by x. */
  private colourHolds(k: number, known: number, a: number, b: number, x: number): boolean {
    for (const m of CELL_CONFIGS[k]) {
      const col = m << 1;
      if (this.colourFits(col, known) && (((col >> a) ^ (col >> b)) & 1) !== x) return false;
    }
    return true;
  }

  /**
   * The links behind the current union-find, for colouring steps' reasons: a spanning forest of the
   * known edges, then the colouring relations in the order they were added. Each of those joined
   * two sets, so the links still form a forest, and the path between two linked nodes is a chain of
   * relations from one to the other.
   */
  private colourForest(): Forest {
    const { grid, edges } = this;
    const n = grid.cellCount + 1;
    const parent = Int32Array.from({ length: n }, (_, x) => x);
    const root = (x: number): number => {
      let r = x;
      while (parent[r] !== r) r = parent[r];
      parent[x] = r;
      return r;
    };
    const forest: Forest = { head: new Int32Array(n).fill(NONE), next: [], to: [], rec: [] };
    const link = (u: number, v: number, rec: number) => {
      const a = root(u);
      const b = root(v);
      if (a === b) return;
      parent[a] = b;
      addLink(forest, u, v, rec);
    };
    for (let e = 0; e < grid.edgeCount; e++) {
      if (edges[e] !== Unknown) link(sideNode(grid, e, 0), sideNode(grid, e, 1), NONE);
    }
    for (let x = 0; x < this.colourRecs.length; x++) {
      link(this.colourRecs[x].u, this.colourRecs[x].v, x);
    }
    return forest;
  }

  /** Queues the clue cells 1–3 at or beside node `n` (the border cells for the outside node). */
  private queueAround(n: number): void {
    const C = this.grid.cellCount;
    if (n === C) {
      for (let x = 0; x < this.borderColourCells.length; x++) {
        this.queueColour(this.borderColourCells[x]);
      }
      return;
    }
    this.queueColour(n);
    for (let j = 0; j < 4; j++) {
      const m = across(this.grid, n, j);
      if (m !== C) this.queueColour(m);
    }
  }

  private queueColour(i: number): void {
    const k = this.clues[i];
    if (k < 1 || k > 3 || this.inColourQueue[i]) return;
    this.inColourQueue[i] = 1;
    this.colourQueue[(this.colourHead + this.colourLen) % this.colourQueue.length] = i;
    this.colourLen++;
  }

  private dequeueColour(): number {
    const i = this.colourQueue[this.colourHead];
    this.colourHead = (this.colourHead + 1) % this.colourQueue.length;
    this.colourLen--;
    this.inColourQueue[i] = 0;
    return i;
  }
```

(f) Module helpers: insert right before `/** Edges row by row: horizontal edges of row r left to right, then the vertical edges below them. */` (after the class's closing `}`):

```ts
/** The node across side `j` (0 top, 1 right, 2 bottom, 3 left) of cell `i`: a cell, or outside. */
function across(grid: Grid, i: number, j: number): number {
  return sideNode(grid, grid.cellEdges[i * 4 + j], j === 1 || j === 2 ? 1 : 0);
}

/** The rule a colouring step resting on one clue is named by, indexed by that clue. */
const COLOUR_RULE: readonly RuleId[] = ["colour-chain", "colour-1", "colour-2", "colour-3"];

/** A relation the colouring rule added: its two nodes, its clue cell, the node pairs it used. */
interface ColourRec {
  readonly u: number;
  readonly v: number;
  readonly cell: number;
  readonly deps: readonly number[];
}

/**
 * Links over union-find nodes: for each node a list (`head`, then `next`) of links to `to`, made
 * by colouring relation `rec`, or NONE for a known edge. Link l and l ^ 1 are the two directions.
 */
interface Forest {
  readonly head: Int32Array;
  readonly next: number[];
  readonly to: number[];
  readonly rec: number[];
}

/** Adds a link between nodes `u` and `v`, made by colouring relation `rec` (NONE: a known edge). */
function addLink(f: Forest, u: number, v: number, rec: number): void {
  for (const [p, q] of [
    [u, v],
    [v, u],
  ]) {
    f.next.push(f.head[p]);
    f.to.push(q);
    f.rec.push(rec);
    f.head[p] = f.to.length - 1;
  }
}

/** The colouring relations on the forest path between nodes `a` and `b`, which are linked. */
function forestPath(f: Forest, a: number, b: number): number[] {
  const via = new Map<number, number>([[a, NONE]]);
  const queue = [a];
  for (let h = 0; h < queue.length && !via.has(b); h++) {
    for (let l = f.head[queue[h]]; l !== NONE; l = f.next[l]) {
      const v = f.to[l];
      if (via.has(v)) continue;
      via.set(v, l);
      queue.push(v);
    }
  }
  const recs: number[] = [];
  for (let v = b; v !== a; ) {
    const l = via.get(v) as number;
    if (f.rec[l] !== NONE) recs.push(f.rec[l]);
    v = f.to[l ^ 1];
  }
  return recs;
}

/**
 * The clue cells a colouring step that links nodes `a` and `b` rests on: the cells of the colouring
 * relations on the path between them and, in turn, of the relations each of those used. Sorted.
 */
function colourReason(f: Forest, recs: readonly ColourRec[], a: number, b: number): number[] {
  const cells = new Set<number>();
  const seen = new Set<number>();
  const pairs = [a, b];
  while (pairs.length > 0) {
    const v = pairs.pop() as number;
    const u = pairs.pop() as number;
    for (const r of forestPath(f, u, v)) {
      if (seen.has(r)) continue;
      seen.add(r);
      cells.add(recs[r].cell);
      pairs.push(...recs[r].deps);
    }
  }
  return [...cells].sort((p, q) => p - q);
}
```

`Grid`, `NONE`, `RuleId`, `sideNode` and `CELL_CONFIGS` are already in scope. `parity()`, `undo`, `mark`, `lookahead` and the corner tier do not change.

Notes for the reader of this code (not extra work):
- `colourCell`'s two skips change no result; they are the common cases on a half-solved board.
- `colourEdges` uses `ufFind(other) !== large` after the join, so it finds exactly the edges between the two sets (none inside one set is open, see Design).
- A `SolverStop` thrown from `commit` (maxSteps) or the budget leaves the colouring queue non-empty; the engine is dropped then, as for every other tier.

### 2.4 `packages/core/src/verify.ts`

Replace `  const engine = new Engine(puzzle, budget);` with

```ts
  // Colouring after lookahead at the root: no steps are read here, and it saves a colouring pass
  // before every lookahead deduction (DECISIONS, WT17).
  const engine = new Engine(puzzle, budget, { colourLast: true });
```

### 2.5 Tests (`packages/core/src`)

`solver.test.ts`:
- After the `corner-chain` case in `cases` add:

```ts
    // Colouring (WT17): for each, the smallest puzzle, then the fewest clues, where it fires.
    [2, 4, "1..11...", 3, { rule: "colour-1", changes: "17:2", cells: [4, 5], dots: [] }],
    [1, 3, ".2.", 0, { rule: "colour-2", changes: "0:1", cells: [0, 1], dots: [] }],
    [1, 4, ".32.", 0, { rule: "colour-3", changes: "8:1", cells: [1], dots: [] }],
    [3, 3, "3..2.23..", 2, { rule: "colour-chain", changes: "2:1", cells: [2, 3, 5], dots: [] }],
```

  (found by enumerating every clue string of up to 9 cells; every earlier case keeps its step. `colour-chain` here is a real chain: the left 2 makes the cell between the 2s outside, and only then is the right 2 between two outside cells.)
- After the test `leaving the corners group out drops its rules, and the default is every group` add:

```ts
  test("leaving the colouring group out drops its rules", () => {
    // A 2 in a one-wide strip, between two outside cells: either it is inside (lines on both sides
    // beside the outside) and so are the cells above and below it, or it is outside and both of
    // those differ from it. Either way they are inside. No other rule, lookahead included, sees it.
    const p = puzzle(1, 3, ".2.");
    const without = solve(p, { rules: ["corners"] });
    expect(without.status).toBe("stuck");
    expect(without.steps).toEqual([]);
    const all = solve(p);
    expect(all.status).toBe("solved");
    expect(all.steps[0].rule).toBe("colour-2");
    expect(GROUP_RULES.colouring).toContain(all.steps[0].rule);
  });

```

- In `larger planted boards: sound, and solving from part of a result gives that result`: replace the two `fc.boolean(),` lines after the `fc.double(…)` line, and the callback head `(w, h, seed, keep, corners, lookahead) => {`, with

```ts
        fc.subarray([...RULE_GROUPS]),
        fc.boolean(),
        fc.boolean(),
        (w, h, seed, keep, rules, lookahead, steps) => {
```

  (groups, lookahead and steps instead of corners and lookahead), `const options = { lookahead, rules: corners ? undefined : [] };` → `const options = { lookahead, rules, steps };`, and replace

```ts
          // The result does not depend on the order deductions came in.
          const part = result.edges.map((s, e) =>
            given[e] !== EdgeState.Unknown || rng.float() < 0.5 ? s : EdgeState.Unknown,
          );
          expect(solve(p, { ...options, initial: part }).edges).toEqual(result.edges);
```

  with

```ts
          // The result does not depend on the order deductions came in, nor on whether steps are
          // recorded (colouring stops at its first step then, and runs to the end otherwise).
          const part = result.edges.map((s, e) =>
            given[e] !== EdgeState.Unknown || rng.float() < 0.5 ? s : EdgeState.Unknown,
          );
          expect(solve(p, { ...options, steps: !steps, initial: part }).edges).toEqual(
            result.edges,
          );
```

`agreement.test.ts`, in `checkAgainstBruteForce`: replace

```ts
  // Every edge the rule solver decides agrees with every solution, with every rule group and with
  // the corners group left out.
  for (const rules of [undefined, []]) {
```

with

```ts
  // Every edge the rule solver decides agrees with every solution, with every rule group, with
  // each group alone and with none.
  for (const rules of [undefined, ["corners"], ["colouring"], []] as const) {
```

(the file runs in about 5 s.)

`clue-gaps.test.ts`:
- Add `import { RULE_GROUPS, type RuleGroup } from "./rules.ts";` after the `./puzzle.ts` import.
- Replace the doc comment above `SOLVED`, and the two constants, with:

```ts
/**
 * Ids of the corpus entries the rule solver solves. Empty when the corpus was made (WT14): every
 * entry was stuck. A solver change that solves more adds their ids, like a golden value; a missing
 * id means a rule got weaker. WT15's premature-loop fix solved 3; WT16's corner rules 23; WT17's
 * colouring 29. `SOLVED_WITHOUT_COLOURING` is the same with the colouring group left out (WT16's
 * 23), `SOLVED_WITHOUT_GROUPS` with every group left out (WT15's three). Colouring alone, without
 * the corners, solves the same 29 as every group.
 */
const SOLVED: string[] = [
  "clue-gaps-5-3#16",
  "clue-gaps-5-18#14",
  "clue-gaps-5-41#4",
  "clue-gaps-5-41#9",
  "clue-gaps-5-44#16",
  "clue-gaps-5-56#3",
  "clue-gaps-5-81#1",
  "clue-gaps-5-81#5",
  "clue-gaps-5-87#17",
  "clue-gaps-5-95#3",
  "clue-gaps-5-95#18",
  "clue-gaps-7-3#14",
  "clue-gaps-7-5#17",
  "clue-gaps-7-6#11",
  "clue-gaps-7-8#0",
  "clue-gaps-7-8#3",
  "clue-gaps-7-10#27",
  "clue-gaps-10-0#77",
  "clue-gaps-10-1#73",
  "clue-gaps-10-1#81",
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
const SOLVED_WITHOUT_COLOURING: string[] = [
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
const SOLVED_WITHOUT_GROUPS: string[] = [
  "clue-gaps-5-81#5",
  "clue-gaps-10-8#26",
  "clue-gaps-10-8#27",
];
```

- In the per-entry test replace `      expect(disagreements(solve(c.puzzle, { rules: [] }).edges, solution)).toBe(0);` with

```ts
      for (const rules of [["corners"], ["colouring"], []] as const) {
        expect(disagreements(solve(c.puzzle, { rules }).edges, solution)).toBe(0);
      }
```

- Replace the body of the `SOLVED` test with

```ts
    const solvedWith = (rules?: readonly RuleGroup[]) =>
      corpus.filter((c) => solve(c.puzzle, { rules }).status === "solved").map((c) => c.id);
    expect(solvedWith()).toEqual(SOLVED);
    expect(solvedWith(["colouring"])).toEqual(SOLVED);
    expect(solvedWith(["corners"])).toEqual(SOLVED_WITHOUT_COLOURING);
    expect(solvedWith([])).toEqual(SOLVED_WITHOUT_GROUPS);
```

- The fast-check test: rename it to `"from a correct partial board, with any rule groups, nothing contradicts the solution"`, replace its last arbitrary `fc.boolean(),` and the head `(n, given, corners) => {` with `fc.subarray([...RULE_GROUPS]),` and `(n, given, rules) => {`, and `{ initial, rules: corners ? undefined : [] }` with `{ initial, rules }`.

`verify.test.ts`, test `searches when the rules get stuck`: replace

```ts
    // Unique (checked by brute force), but the rules alone get stuck.
    const result = verify(puzzle(1, 4, ".22."));
```

with

```ts
    // clue-gaps-5-3#13 from the WT14 corpus: unique, but the rules alone get stuck. Since WT17's
    // colouring the rules solve every unique puzzle of up to 3×3 cells.
    const result = verify(puzzle(5, 5, "..2..1.22..22..21..1.2110"));
```

(11 search nodes.)

`rules.test.ts` needs nothing new: its text-length cap and group checks cover the new ids.

### 2.6 Generator version and goldens

- `packages/core/src/generate.ts`: `export const GENERATOR_VERSION = "5";`
- `packages/core/src/generate.test.ts`: comment `GENERATOR_VERSION "4"` → `"5"`; the 20×20 digest becomes `[3187883499, 3680549921, 3777069331, 1778311108]`. The other goldens do not change.

### 2.7 Web

`apps/web/src/lib/game/patterns.ts`: at the end of `RULE_PATTERNS`, after the `parity` entry (before the closing `};`), insert:

```ts
  // Colouring. The cells above and below the 1 are both outside (their outer sides are crossed),
  // and at most one cell beside a 1 differs from it, so neither does: both sides there are crossed.
  "colour-1": pattern(3, 3, "....1....", (a) => ({
    crosses: [a.h(0, 1), a.h(3, 1)],
    cells: [a.cell(0, 1), a.cell(1, 1), a.cell(2, 1)],
    ghostCrosses: [a.h(1, 1), a.h(2, 1)],
  })),
  // The cells left and right of the 2 are both outside. If the 2 is inside, both those sides are
  // lines and the cells above and below are inside like it; if outside, those two differ from it.
  // Either way they are inside, so their outer sides are lines.
  "colour-2": pattern(3, 3, "....2....", (a) => ({
    crosses: [a.v(1, 0), a.v(1, 3)],
    cells: [a.cell(1, 0), a.cell(1, 1), a.cell(1, 2)],
    ghostLines: [a.h(0, 1), a.h(3, 1)],
  })),
  // The cells above and below the 3 are both outside, and at most one cell beside a 3 is on its
  // side, so neither is: both sides there are lines.
  "colour-3": pattern(3, 3, "....3....", (a) => ({
    crosses: [a.h(0, 1), a.h(3, 1)],
    cells: [a.cell(0, 1), a.cell(1, 1), a.cell(2, 1)],
    ghostLines: [a.h(1, 1), a.h(2, 1)],
  })),
  // A position the solver reaches. The 3s' corners put both 3s inside. The left 2 then has inside
  // cells above and below it and the outside on its left, so the cell on its right is outside; the
  // right 2 sits between two outside cells, so the cells above and below it are inside.
  "colour-chain": pattern(3, 3, "3..2.23..", (a) => ({
    lines: [a.h(0, 0), a.v(0, 0), a.h(3, 0), a.v(2, 0)],
    cells: [a.cell(0, 2), a.cell(1, 0), a.cell(1, 2)],
    ghostLines: [a.h(0, 2)],
  })),
```

(each 3×3, ghosts on empty edges, no rule breaks; `patterns.test.ts` checks it. The `colour-chain` drawing is the position before step 2 of the `3..2.23..` test case.)

`apps/web/tests/hint.e2e.ts`: small-7's hints now use `colour-2` and `colour-chain` and no longer `line-into-3`. Replace the comment above `RULES` with `// Every rule small-7 uses, so long texts (the corner and colouring rules, the 3s) are among them.`, delete `  "line-into-3",` from `RULES`, and insert `  "colour-2",` and `  "colour-chain",` before `  "lookahead",`. Run it once (needs Chromium, not in the gate): `cd apps/web && E2E_PORT=4391 bunx playwright test tests/hint.e2e.ts` — 17 passed with this plan's code. Delete `apps/web/build` afterwards if git shows it.

### 2.8 API contract

`bun run gen:api` (adds the 4 ids to the rule enum in `openapi.yaml` and `packages/api-client/src/schema.ts`).

### Verify step 2

`bun run check` (835 pass, 3 skip; `bun test packages/core` alone about 10 s). Commit.

## Step 3 — Docs

`docs: record clue colouring, solving without steps and their measurements`

3.1 `packages/core/AGENTS.md`: after the sentence ending `and the agreement tests run with and without each group.` add: `Generation's clue tests solve without recording steps (`steps: false`); only the final solve, whose steps become hints, records them.`

3.2 `docs/DECISIONS.md`: append the four entries below (the numbers are this plan's).

```md
## 2026-10-26 · WT17 `clue-colouring` · Colouring: what each clue says about the sides of the cells beside it
- **Question:** How should the engine reason the way people colour a Slitherlink (every cell inside or outside, beyond the border outside, a clue k with k of its four neighbours on the other side), and where does it go among the tiers?
- **Decision:** A new tier right after parity, working on parity's union-find (cells plus the outside node, relations from known edges), run when parity decides nothing. For each 1, 2 or 3 it enumerates the side sets of size k (at most 6), keeps those that fit the relations known among the cell and its four neighbours (two nodes in one set fix the XOR of their bits; two off-board sides are one node), and adds every relation between two of those five nodes that holds in all of them: between the cell and a neighbour that is an edge, between two neighbours it is knowledge the parity tier could not have. Each new relation decides at once the open edges between the two sets it joins and queues the clue cells beside the smaller set, the only ones that can gain a constraint, so a pass runs to its fixpoint without full rounds. Nothing is trailed: parity rebuilds the union-find from the edges on every pass and colouring re-derives its relations, so lookahead probes and the verifier's search need no undo for it and the result depends only on the edges. Exact for each clue, so sound; more relations leave fewer candidates, so monotone. 0s and 4s are left to tier 1; the corner masks are not used (with them the no-lookahead floor and the corpus did not move). While steps are recorded a pass sets one edge, preferring a relation one clue forces on its own (see the next entry), and the cheaper rules follow up before the next colouring step; otherwise it runs to the end. Group `colouring` (`RULE_GROUPS`), on by default. `GENERATOR_VERSION` is now `"5"`.
- **Reason:** Measured (before → after): solver floor without lookahead (from the full clue set) 44.5 → 44.0% (5×5), 43.7 → 42.9% (7×7), 43.4 → 42.4% (10×10), 41.8 → 41.6% (15×15), 44.1 → 43.5% (20×20); clue-gap corpus solved 23 → 29 of 36 (without lookahead 4 → 8; colouring without the corners also 29); `lookahead` share of generated puzzles' hint traces 6.8 → 6.1% (10×10), 7.2 → 6.3% (20×20), 6.3 → 5.4% (40×40), with colouring 1.4–1.8% of steps and `parity` 1.4–2.2%; `bench:clue-gaps` clues 41.1 / 39.9 / 39.7 / 38.9 / 41.2% (was 41.2 / 40.1 / 40.1 / 39.2 / 41.5%), removable and restored 0.0%, gap 0.2 / 0.8 / 2.2 / 1.5 / 2.7%, verifier floor 41.0 / 39.6 / 39.0 / 38.4%. Order independence: 0 differences in 52 800 solves from random subsets of a result and 52 800 from larger sound boards (up to 25×25, every subset of groups, with and without lookahead and steps); with `rules: ["corners"]` every result, steps included, equals the engine before WT17. Rejected: full rounds over every clue until nothing changes (+50% generation at 20×20, +11% verify on generated boards); corner masks in the enumeration (no gain, slower).

## 2026-10-26 · WT17 `clue-colouring` · How colouring steps are named and what a hint highlights
- **Question:** A colouring deduction can rest on several clues through the union-find. Which rule does its hint name, and what does it highlight?
- **Decision:** One step per decided edge. While steps are recorded, a colouring pass first looks for a clue whose own relation, on the union-find as parity built it, decides an edge; only if none does do relations chain through other clues. It sets one edge; the other edges of that relation follow from the next parity pass as `parity` steps. Each relation colouring adds keeps its clue cell and the relations it used (cut down greedily to those it needs). The links behind the union-find form a forest: a spanning forest of the known edges, then the colouring relations in the order they were added (each joined two sets). A step's reason is the clue cells of the colouring relations on the forest path between the edge's two cells, followed through the relations each of those used; its `cells` are those clues and the edge's two cells unless one holds a clue the reason does not use (the outside node left out), `dots` none. One clue → `colour-1`, `colour-2` or `colour-3` ("Sides around a 1/2/3"); several → `colour-chain` ("Sides pass along"). Texts state the clue's count in sides ("Just one cell beside a 1 is on the other side of the loop (off the board is outside), which settles this edge."), at most 115 characters; each id has a pattern drawing.
- **Reason:** Hints name what the player can check. Plan review 1 found that stopping at the first cell that decides an edge (the first version) still called 57% of `colour-chain` steps chains when one highlighted clue explained them, because earlier cells in the pass had added relations the deciding cell leaned on; with the single-clue round first and one edge a pass, none is (by exact enumeration over the highlighted clues and visible edges, which also showed every reason forces its edge). On 30 generated 10×10 and 20×20 puzzles: 152 colouring steps (was 420; 842 when colouring ran to its fixpoint before naming), 59 of them `colour-chain`, highlighting a median of 3 cells (at most 8); one-clue steps 2–3 cells. Recorded solve time unchanged (generated 40×40: 144 ms for 3).

## 2026-10-26 · WT17 `clue-colouring` · The verifier uses colouring, after lookahead at its root
- **Question:** Does colouring slow `verify` (NFR-1: must not get slower), and should the verifier use it, at its root, in its search, or not at all?
- **Decision:** It uses it in both, but at the root only once lookahead finds nothing (`Engine` flag `colourLast`; the fixpoint is the same, and the verifier reads no steps). In the search, which has no lookahead, colouring runs after parity as in `solve`.
- **Reason:** Generator "5" puzzles need colouring: main's verifier, capped at 20 000 nodes, left 3 of 10 generated 20×20 and 3 of 3 40×40 puzzles `unknown`; with colouring they are solved at the root (78 ms and 126 ms in all). Near-unique 20×20 boards (a generated puzzle less one clue): 106 379 → 23 363 nodes, 3.0 → 1.0 s, 5 → 1 unknown; colouring in the search only: 3.2 s. On main-era sets (paired A/B, median of 40–60 rounds): corpus 1.03×, generated "3" 20×20 0.99–1.05× and 40×40 0.96×, windy 12×12 1.03×, blob 70% 1.02–1.03×, empty boards 1.00×, windy 8×8 with many solutions 1.07–1.12× (about 0.01 ms a board). Colouring right after parity at the root as well cost 1.24× on generated 40×40 and 1.12–1.15× on 100×100 blob boards at 70% clues (re-deriving, on every pass, relations that decide nothing: 124 of 156 passes, 7 edges). `bench` lines (before → after medians): 100×100 70% 13.6–14.7 → 13.8–15.2 ms, the rest equal except the "minimal" ones, which compare different puzzles (built with `solve`; on main's own 30×30 minimal boards the new verifier takes 0.93× the time, and on the ones the new solver builds main's verifier runs into its 30 s limit, the new one takes 15 ms for three).
- **Accepted (orchestrator decision):** the small-board slowdown with many solutions (an editor draft); WT19's incremental parity can keep colouring's relations between passes instead of re-deriving them.

## 2026-10-26 · WT17 `clue-colouring` · `solve(puzzle, { steps: false })`, and generation's clue tests use it
- **Question:** Generation solves thousands of times per puzzle and reads only the status and edges, yet every solve recorded steps; colouring's reasons (a forest search per step) made that expensive. Should generation record?
- **Decision:** `SolveOptions.steps` (default true); without it `steps` comes back empty and `maxSteps` does nothing. `generate`'s `RuleSolver` (the removal tests, the block bases, the restore step) solves without steps, and the result's `solve` is one recording solve at the end. This was the WT16 review's "non-recording solver path", planned for WT19.
- **Reason:** Without colouring the output is byte-identical (generator "4" goldens and 40 seeds, steps included) and generation 7–10% faster (20×20 403 → 374 ms, 30×30 1.66 → 1.50 s); with colouring, recording tests cost +10–20% at 20×20 and +30–80% at 30×30, and without them generation is about as fast as before WT17: `bench:generate --quick` p95 13 → 12 ms (7×7), 35 → 33 ms (10×10), 494 → 442 ms (20×20), 2.4 → 2.4 s (30×30), 7.3 → 7.9 s (40×40), every result `unique`, restored 0.0%; 100×100 seed `bench-0` 259 → 282 s (41.3 → 41.1% clues, its hint trace 6.5% → 6.0% lookahead, verifying it 0.9 s).
```

Verify: `bun run check`. Commit.

## Final checks

1. `bun run check` green.
2. `git log --oneline main..` shows the three commits.
3. `bun run --cwd packages/core bench` (verify) next to the same on `main` (copy `packages/core` of main into your scratchpad): every line within the table above (the "minimal" lines compare different puzzles).
4. `bun run --cwd packages/core bench:generate --quick`: every result `unique`, restored 0.0%.
5. `bun run --cwd packages/core bench:clue-gaps --no-lookahead`: solver floor 44.0 / 42.9 / 42.4 / 41.6 / 43.5%; and the default run: `removable` and `restored` 0.0% on every line (non-zero `removable` means the rules lost order independence; see DECISIONS).

## Acceptance criteria

- FR-3: four new named deductions (group `colouring`) in `RULE_IDS` with texts and titles; steps record them; `solve(puzzle, { rules: ["corners"] })` leaves them out and gives exactly main's results (steps included).
- FR-4/FR-5: `agreement.test.ts` passes with every group, each alone and none (all grids ≤ 6 cells, fast-check), and `verify` (now with colouring) agrees with brute force there; the corpus and fast-check tests from partial boards pass with every group subset.
- FR-6/FR-12: every new rule has a web pattern (`patterns.test.ts`); a colouring step's cells are its reason's clues and the edge's cells that hold no other clue; no `colour-chain` step is explained by one highlighted clue; hint cards fit (`hint.e2e.ts`, run once).
- FR-10: `GENERATOR_VERSION` "5", goldens updated, generation deterministic; step 1 alone leaves generator "4" output byte-identical.
- NFR-1: verification of generator "5" puzzles proves them unique in milliseconds (main's verifier: `unknown`); on main-era puzzle sets within ±5%, small boards with many solutions +7–12% (about 0.01 ms a board); generation p95 within a few percent of before.
- NFR-3: per-rule unit cases, rule-group test, `steps: false` test, fast-check over every group subset and both step modes (order independence), corpus fast-check over group subsets.
- Measurements recorded in DECISIONS: no-lookahead floor, clue-gap lines, corpus ids, lookahead share, verify and generate lines.

## Assumptions and unresolved questions (resolved by assumption; the orchestrator may override)

1. **The verifier uses colouring** (the brief suggested leaving it out of the verifier's search if it costs time). Measured: leaving it out makes generator "5" puzzles `unknown` (3 of 10 at 20×20, 3 of 3 at 40×40 within 20 000 nodes); leaving it out of the search only is 3× slower on near-unique 20×20 boards. Running it after lookahead at the root keeps main-era sets within noise. The remaining cost is small boards with many solutions (+7–12%, ~0.01 ms) and re-deriving relations on every pass (WT19's incremental parity can keep them).
2. **`solve(…, { steps: false })` is public API** (a `SolveOptions` field), since `generate` calls `solve` through the exported function. It is the WT16 review's "non-recording solver path for generation's removal tests", moved here from WT19 because the colouring reasons made recording expensive.
3. Rule ids `colour-1`, `colour-2`, `colour-3`, `colour-chain`; group `colouring`; titles "Sides around a 1/2/3", "Sides pass along". British spelling, as the brief and the roadmap use.
4. About 40% of the colouring steps are `colour-chain` (several clues), because colouring passes sides from clue to clue; the hint highlights those clues (median 3 cells). Steps one clue explains are always named for that clue (review 1's fix). WT20 may decide whether easy levels leave the group out.
5. No PRD change (the roadmap puts FR-3's wording in WT20); no README change (`bench:clue-gaps --rules=colouring` already works).
6. Corner masks are not used by colouring (no measured gain); the deferred parity ↔ corner-mask bridge from WT16 stays deferred.
