import { expect, test } from "bun:test";
import { createGrid, decodeEdges } from "@loophole/core";
import { insideCells } from "./inside.ts";

test("the outer square of a 2×2 has every cell inside", () => {
  const g = createGrid(2, 2);
  expect(Array.from(insideCells(g, decodeEdges(g, "112211121121")))).toEqual([1, 1, 1, 1]);
});

test("a loop around one cell of a 3×3 has only that cell inside", () => {
  const g = createGrid(3, 3);
  // The 3×3 "corner zeros" solution: a loop around the centre cell.
  const inside = insideCells(g, decodeEdges(g, "222212212222222221122222"));
  expect(Array.from(inside)).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
});

test("an empty board has nothing inside", () => {
  const g = createGrid(3, 2);
  expect(insideCells(g, new Uint8Array(g.edgeCount)).every((x) => x === 0)).toBe(true);
});
