import { describe, expect, test } from "bun:test";
import { RULE_IDS, RULE_TEXT } from "./rules.ts";

describe("rule ids", () => {
  test("are unique and each has an explanation", () => {
    expect(new Set(RULE_IDS).size).toBe(RULE_IDS.length);
    for (const id of RULE_IDS) expect(RULE_TEXT[id].length).toBeGreaterThan(20);
    expect(Object.keys(RULE_TEXT).sort()).toEqual([...RULE_IDS].sort());
  });
});
