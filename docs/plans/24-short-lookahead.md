# WT24 `short-lookahead` — implementation plan

Branch `fix/short-lookahead`. Issue #11 (hard puzzles lean on try-and-see). PRD: FR-3 (named deductions), FR-6/FR-12 (hints), FR-7 (levels in generation), FR-10 (deterministic per version), NFR-1 (generation time). DECISIONS: the WT24 entry.

## Goal

Hard puzzles solve with named rules nearly everywhere. Try-and-see appears rarely, at most one per 100 cells (at least one allowed), and every chain a hint walks through, from the guess to the broken rule, is at most 5 steps.

1. **Engine**: `maxProbeSteps` (a failed probe proves its edge only if the rules broke within that many steps; the count is the rule firings, one per step `explain` records, never fewer) and `maxLookahead` (no more lookahead deductions after that many). `lookaheads` counts them. Defaults unlimited, so the verifier and the clue-gap corpus are unchanged.
2. **Solver**: `SolveOptions.maxProbeSteps`, `SolveOptions.maxLookahead`, `SolveResult.lookaheads`.
3. **Levels**: `LevelSettings.maxProbeSteps` (hard 5) and `cellsPerLookahead` (hard 100); `lookaheadBudget(level, cells)`.
4. **Generator** (version 7): at a level with lookahead, steps 3–5 use its rules without lookahead (unless those cannot solve the full clue set, as on 1×1), then step 6 (`spendLookahead`) tests 25 random clues per budget unit, block by block from no-lookahead bases, with the level's rules and the budget, and keeps each removal they still solve. A final solve with the budget guards the result (it puts step 6's clues back if it gets stuck). Easy and medium are unchanged apart from `meta.generator`.
5. **Hints**: solve with the level's `maxProbeSteps`; if that gets stuck, once more without the limit, so puzzles from version 6 still get a hint rather than a revealed line.
6. **Bench**: `bench:generate` reports the share of puzzles with any try-and-see, the most one needs against its budget, and the longest chain.

## Tests

- Solver: lookahead count and `maxLookahead` on the clue-gap corpus; with `maxProbeSteps`, every explained probe is within it; the cap counts exactly what `explain` records (the same probe is found at the chain's length and not one below).
- Generator: `checkResult` checks the budget and the chain length; "every clue is needed" uses the budgeted rules; goldens for version 7; progress total may drop once when step 6 starts.
- Hints: v7 hard puzzles show only short chains, within budget; the probe-replay property runs on puzzles that need long chains (a generated puzzle with one more clue removed), so the fallback is covered.
- Levels: hard's settings and `lookaheadBudget`.

Out of scope: promoting recurring probes to named rules (issue #11, option 3); restricting probes to path ends.
