# Issue #12 `side-hints` — implementation plan

Issue #12 (colouring hints don't show which cells are inside or outside, or why). PRD: FR-6/FR-12 (hints), FR-13/FR-14 (input, undo, clear), FR-21 (progress), NFR-5 (not by colour alone). DECISIONS: the issue #12 entries.

## Goal

Every parity and colouring hint shows which side of the loop the cells it uses are on, and why. It tints them inside or outside when their chain reaches the board's edge, and otherwise "same side" or "other side". It marks the × and lines the chain runs along, and says it in concrete words. Players can shade cells themselves.

## PR 1: side proofs (core + API), branch `feat/side-proofs`

1. **`Deduction.sides`** (`SideProof`, only when the solve explains, i.e. hints):
   - `cells`: each cell on the chains with its `group` (0 = linked to off the board, so in or out) and `flip` (inside, in group 0; else the other side from the group's first cell).
   - `edges`: the marked edges the chains run along.
   - `known`: the pairs of the clue's nodes the relation used, same side or not.
   - `forced`: the relations the clues forced, each with its clue.
   - Verification, generation and the goldens are unchanged, so no version bump.
2. **Chains.** Each pair a step needs linked is joined by a shortest path:
   - Pairs: the step's edge, a parity step's two cells, the nodes of each `known` pair.
   - Paths run over the known edges and the forced relations of the step's reason.
   - When the pair's set reaches off the board, each node gets its own path to the edge, so the tint is absolute.
   - Sides are read off the drawn links, so the tints always agree with what is shown.
3. **Hints.** `supportingSteps` counts `sides.edges` as part of the step's reason, so the crosses a chain needs come into `before`.
4. **API.** `HintStep.sides` and `HintDeduction.sides`; run `gen:api`.
5. **Tests.** A property test over the hint walk of generated hard puzzles checks every step with `sides`:
   - group 0's tints match the solution's inside;
   - each chain edge is decided by the time of the step, and agrees with the tints (× same, line other);
   - the step's edge agrees with its two cells' tints;
   - the `known` facts force each `forced` relation, by independent enumeration of the clue's side sets;
   - the links shown connect every pair the step needs.

   A fixture with the issue's shape, a colour-3 step with one neighbour outside and one inside, pins the output.

## PR 2: tints and words (web)

1. **`HintMarks.sides`**, drawn in `BoardSvg.svelte` and `paint.ts`:
   - outside and inside washes;
   - hatched / plain ai for relative groups;
   - chain edges emphasised.
2. **Tokens** in light and dark, in the design README and `app.css`.
3. **Words** built from `known` and `forced`: "The 1 to the left is outside and the cell below is inside…". `RULE_TEXT` is the fallback. The card still fits under a 7×7 at 390×664.

## PR 3: player shading (web + server)

1. `Board.cells` holds shades: none, inside, outside. They are undoable, and Clear clears them.
2. A Shade toggle and a key: in shade mode a tap cycles a cell's shade and a drag paints.
3. Shades are drawn with PR 2's tints, never validated and never read by hints.
4. "Cell shades (version 1)" in FORMAT.md. Shades are kept in local progress and in server progress (a nullable column).

## PR 4: colour-chain walkthrough

One page per forced relation, in order, like try-and-see. It is planned after PR 2.

Out of scope: hints that use the player's shades.
