import { describe, expect, test } from "bun:test";
import { GROUP_RULES, RULE_GROUPS, RULE_IDS, RULE_TEXT, RULE_TITLE } from "./rules.ts";

describe("rule ids", () => {
  test("are unique and each has an explanation", () => {
    expect(new Set(RULE_IDS).size).toBe(RULE_IDS.length);
    for (const id of RULE_IDS) expect(RULE_TEXT[id].length).toBeGreaterThan(20);
    // The hint card has to fit under a 7×7 board on the smallest phone (hint.e2e.ts checks the
    // rules small-7 uses); parity's 111 characters is the longest text from before WT16.
    for (const id of RULE_IDS) expect([id, RULE_TEXT[id].length <= 115]).toEqual([id, true]);
    expect(Object.keys(RULE_TEXT).sort()).toEqual([...RULE_IDS].sort());
  });

  test("each has a short title", () => {
    for (const id of RULE_IDS) expect(RULE_TITLE[id].length).toBeLessThanOrEqual(24);
    expect(Object.keys(RULE_TITLE).sort()).toEqual([...RULE_IDS].sort());
  });

  test("each rule is in at most one group, and every group lists its rules", () => {
    expect(Object.keys(GROUP_RULES).sort()).toEqual([...RULE_GROUPS].sort());
    const grouped = RULE_GROUPS.flatMap((g) => GROUP_RULES[g]);
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const id of grouped) expect(RULE_IDS).toContain(id);
  });
});
