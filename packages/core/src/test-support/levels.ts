import { LEVEL_SETTINGS, type Level, lookaheadBudget } from "../level.ts";
import { GROUP_RULES, RULE_GROUPS, RULE_IDS, type RuleId } from "../rules.ts";
import type { SolveOptions } from "../solver.ts";

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

/** The `solve` options generation judges a `level` puzzle with `cells` cells by. */
export function levelSolveOptions(level: Level, cells: number): SolveOptions {
  const { minClueShare, cellsPerLookahead, ...ruleSet } = LEVEL_SETTINGS[level];
  return { ...ruleSet, maxLookahead: lookaheadBudget(level, cells) };
}
