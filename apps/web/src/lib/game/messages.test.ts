import { expect, test } from "bun:test";
import { violationMessages } from "./messages.ts";

const none = { dots: [], overfullCells: [], starvedCells: [], loopEdges: [] };

test("no violations, no messages", () => {
  expect(violationMessages(none)).toEqual([]);
});

test("one message per kind, in a fixed order", () => {
  const titles = violationMessages({
    dots: [3],
    overfullCells: [],
    starvedCells: [1, 2],
    loopEdges: [0, 1, 2, 3],
  }).map((m) => m.title);
  expect(titles).toEqual(["Three lines meet at a dot.", "Too many crosses.", "Closed too early."]);
});
