import { describe, expect, test } from "bun:test";
import { EdgeState, RULE_IDS } from "@loophole/core";
import { RULE_PATTERNS } from "./patterns.ts";

describe("RULE_PATTERNS", () => {
  test("every rule but lookahead and loop-complete has a pattern with a ghost move on empty edges", () => {
    const drawn = RULE_IDS.filter((id) => id !== "lookahead" && id !== "loop-complete");
    expect(Object.keys(RULE_PATTERNS).sort()).toEqual([...drawn].sort());
    for (const id of drawn) {
      const p = RULE_PATTERNS[id];
      if (p === undefined) throw new Error(`no pattern for ${id}`);
      const { puzzle, edges, marks } = p;
      const { grid } = puzzle;
      expect([id, marks.ghosts.length > 0]).toEqual([id, true]);
      for (const [edge] of marks.ghosts) {
        expect(edge).toBeLessThan(grid.edgeCount);
        expect([id, edges[edge]]).toEqual([id, EdgeState.Unknown]);
      }
      for (const c of marks.cells) expect(c).toBeLessThan(grid.cellCount);
      for (const d of marks.dots) expect(d).toBeLessThan(grid.dotCount);
      // Small enough to read at 72px.
      expect(Math.max(grid.width, grid.height)).toBeLessThanOrEqual(3);
    }
  });
});
