import { type PuzzleWireV1, parsePuzzle } from "@loophole/core";
import type { PuzzleEntry, PuzzleSource, PuzzleSummary } from "./source.ts";

interface FixtureRecord {
  readonly id: string;
  readonly name: string;
  readonly subtitle: string;
  readonly wire: PuzzleWireV1;
}

/**
 * Built-in puzzles in wire format (docs/FORMAT.md), each with exactly one solution. The 7×7 is the
 * one on the Play artboard and the 10×10 the one on the Night and Desktop artboards.
 */
export const FIXTURES: readonly FixtureRecord[] = [
  {
    id: "tiny-5",
    name: "Tiny",
    subtitle: "Practice · 練習",
    wire: { v: 1, width: 5, height: 5, clues: "..0.......3.1.0.3.1......" },
  },
  {
    id: "small-7",
    name: "Small",
    subtitle: "Practice · 練習",
    wire: { v: 1, width: 7, height: 7, clues: ".11..0..23.2......2.21.0....1....01.1..3..0..1..1" },
  },
  {
    id: "medium-10",
    name: "Medium",
    subtitle: "Practice · 練習",
    wire: {
      v: 1,
      width: 10,
      height: 10,
      clues:
        ".0.0..0.1.....1..2..3.0.21.1.1..0.3....22......3..2.1...01.121.32.....2...013.1...20....3..2....0...",
    },
  },
];

function summary(f: FixtureRecord): PuzzleSummary {
  return {
    id: f.id,
    name: f.name,
    subtitle: f.subtitle,
    width: f.wire.width,
    height: f.wire.height,
  };
}

export const fixtureSource: PuzzleSource = {
  async list() {
    return FIXTURES.map(summary);
  },
  async get(id) {
    const f = FIXTURES.find((x) => x.id === id);
    if (f === undefined) return null;
    const entry: PuzzleEntry = { ...summary(f), puzzle: parsePuzzle(f.wire) };
    return entry;
  },
};
