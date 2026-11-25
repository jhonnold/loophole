import type { Puzzle } from "./puzzle.ts";
import { GROUP_RULES, RULE_GROUPS, type RuleGroup, type RuleId } from "./rules.ts";

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
  /**
   * Whether the solver may use the inside/outside parity rule (`SolveOptions.parity`). The
   * colouring and connectivity groups need it.
   */
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

/**
 * The easiest level whose settings let the solver use `rule`, so its steps can appear in that
 * level's puzzles and hints. The techniques page groups the rules by it.
 */
export function ruleLevel(rule: RuleId): Level {
  const group = RULE_GROUPS.find((g) => GROUP_RULES[g].includes(rule));
  const level = LEVELS.find((l) => {
    const { rules, parity, lookahead } = LEVEL_SETTINGS[l];
    if (group !== undefined) return rules.includes(group);
    if (rule === "parity") return parity;
    if (rule === "lookahead") return lookahead;
    return true;
  });
  // Hard allows every rule, so a level is always found.
  return level ?? DEFAULT_LEVEL;
}
