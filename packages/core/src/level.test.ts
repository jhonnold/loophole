import { describe, expect, test } from "bun:test";
import { DEFAULT_LEVEL, isLevel, LEVEL_SETTINGS, LEVELS, puzzleLevel, ruleLevel } from "./level.ts";
import { createPuzzle } from "./puzzle.ts";
import { RULE_GROUPS, RULE_IDS } from "./rules.ts";
import { levelRuleIds } from "./test-support/levels.ts";

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
      expect(easier.minClueShare).toBeGreaterThan(harder.minClueShare);
      expect(easier.minClueShare).toBeLessThanOrEqual(1);
    }
  });

  test("no level has colouring or connectivity without parity", () => {
    // Both need what parity settles (`SolveOptions.parity`); `solve` throws otherwise.
    for (const level of LEVELS) {
      const { rules, parity } = LEVEL_SETTINGS[level];
      if (!parity) {
        expect(rules).not.toContain("colouring");
        expect(rules).not.toContain("connectivity");
      }
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

  test("a rule's level is the easiest level that allows it", () => {
    for (const id of RULE_IDS) {
      const level = ruleLevel(id);
      const at = LEVELS.indexOf(level);
      expect([id, levelRuleIds(level).has(id)]).toEqual([id, true]);
      for (const easier of LEVELS.slice(0, at)) {
        expect([id, easier, levelRuleIds(easier).has(id)]).toEqual([id, easier, false]);
      }
    }
    expect(ruleLevel("clue-zero")).toBe("easy");
    expect(ruleLevel("corner-3")).toBe("easy");
    expect(ruleLevel("line-into-1")).toBe("medium");
    expect(ruleLevel("parity")).toBe("medium");
    expect(ruleLevel("colour-2")).toBe("hard");
    expect(ruleLevel("two-exits")).toBe("hard");
    expect(ruleLevel("lookahead")).toBe("hard");
  });
});
