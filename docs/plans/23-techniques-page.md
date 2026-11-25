# WT23 `techniques-page` — implementation plan

Branch `feat/techniques-page`, worktree `/home/jhonnold/projects/loophole-wt/techniques-page`, stacked on `feat/hint-walkthrough` (`36b6b2e`). PRD: FR-31 (new: the techniques page), FR-3 and FR-29 (rules and levels), FR-12 (hints), NFR-2 (360 px phones), NFR-5 (accessibility). DECISIONS: the two WT23 entries.

## Goal

1. **Core**: `ruleLevel(rule)`, the easiest level whose `LEVEL_SETTINGS` allow the rule. It is derived from the settings, `GROUP_RULES` and the parity and lookahead flags, and tested against the `levelRuleIds` test helper.
2. **Web, data**: `lib/techniques/lessons.ts` has `LESSONS`, one per rule, in level order and then teaching order. Each lesson's frames run setup → reason → move → applied.
   - Most frames come from the hint card's `RULE_PATTERNS`.
   - These are drawn for the page: the 0, clue complete, clue saturated, the 1 and 3 in a corner, unreachable and loop-complete.
   - Lookahead is a real position from seed `la-44-150`, with a contradiction frame.
3. **Web, test**: `lessons.test.ts` checks that:
   - every rule has a lesson at its level, and the order never goes down a level
   - one frame has the move, and the frame after it is the move drawn in
   - only the flagged frame shows a rule break, and it does
   - each move holds in every brute-forced loop that fits its board, and at least one loop fits
4. **Web, UI**:
   - `RulePattern` gets a `size` prop.
   - `LessonFigure` has Back and Next, "Step n of m" and an `aria-live` caption.
   - `/techniques` has an intro, a contents list, level sections, and a card per technique.
   - Home's Practice section links to the page.
   - The hint card has a "More ↗" link to `/techniques#<rule>` for the rule of the page on show, opening in a new tab.
5. **Tests**: `techniques.e2e.ts`; the hint card link in `hint.e2e.ts`; an a11y screen.
6. **Docs**: the PRD, DECISIONS, the README and the core and web AGENTS files.

Out of scope:
- a link in the header: at 360 px it adds a third row (measured 110 → 144 px)
- interactive practice boards
- checking that the solver names each lesson's rule

## Validated (this machine, Bun 1.3.13)

- `bun run check`: green, 933 pass, 3 skip.
- `E2E_PORT=4391 bun run test:e2e`: 170 passed (on `feat/hint-walkthrough`; 168 on main before the rebase).
- The soundness test fails when a move is changed: corner-3's lines were turned into crosses as a mutation check.
- Hint card on a phone: before the change, the eyebrow and "About this rule" wrapped onto two lines (an extra 22 px, and the board moved 7 px). "More ↗" keeps them on one line at 360×640, 390×664 and 1280×800, and `hint.e2e.ts` (fits under the board, board does not move) passes.
- Screenshots at 360 and 1280 px, in light and dark: the lookahead contradiction frame shows the shu ring on the middle 2.
