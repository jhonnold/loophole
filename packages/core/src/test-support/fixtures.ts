/**
 * Small puzzles with solution counts checked by brute force. `solutions` lists every solution in
 * `encodeEdges` form, in the order `bruteForceSolutions` returns them.
 */
export interface Fixture {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly clues: string;
  readonly count: number;
  readonly solutions?: readonly string[];
}

export const FIXTURES: readonly Fixture[] = [
  { name: "1x1 empty", width: 1, height: 1, clues: ".", count: 1, solutions: ["1111"] },
  { name: "1x1 zero", width: 1, height: 1, clues: "0", count: 0, solutions: [] },
  { name: "1x1 three", width: 1, height: 1, clues: "3", count: 0, solutions: [] },
  { name: "1x2 three on top", width: 1, height: 2, clues: "3.", count: 1, solutions: ["1211111"] },
  {
    name: "2x2 zero in a corner",
    width: 2,
    height: 2,
    clues: "0...",
    count: 1,
    solutions: ["222121222211"],
  },
  {
    name: "2x2 all twos",
    width: 2,
    height: 2,
    clues: "2222",
    count: 1,
    solutions: ["112211121121"],
  },
  {
    name: "2x2 top domino",
    width: 2,
    height: 2,
    clues: "3311",
    count: 1,
    solutions: ["111122121222"],
  },
  { name: "2x2 all threes", width: 2, height: 2, clues: "3333", count: 0, solutions: [] },
  {
    name: "3x3 top strip",
    width: 3,
    height: 3,
    clues: ".2..1..0.",
    count: 1,
    solutions: ["111111222222122122222222"],
  },
  {
    name: "3x3 corner zeros",
    width: 3,
    height: 3,
    clues: "0.0...0.0",
    count: 1,
    solutions: ["222212212222222221122222"],
  },
  {
    name: "3x3 two zeros",
    width: 3,
    height: 3,
    clues: ".0..0....",
    count: 2,
    solutions: ["222222122122222222221122", "222222221221222222222211"],
  },
  {
    name: "3x3 four clues, two solutions",
    width: 3,
    height: 3,
    clues: "...3.2.13",
    count: 2,
    solutions: ["111212122221122111112211", "112122121111121221121221"],
  },
  {
    name: "3x3 threes on the diagonal",
    width: 3,
    height: 3,
    clues: "3...3...3",
    count: 0,
    solutions: [],
  },
  {
    name: "4x4 unique",
    width: 4,
    height: 4,
    clues: "..3..2.3.2...33.",
    count: 1,
    solutions: ["2212222111212122121222112221211221211112"],
  },
  { name: "4x4 two solutions", width: 4, height: 4, clues: "21....12...2132.", count: 2 },
  { name: "2x2 empty", width: 2, height: 2, clues: "....", count: 13 },
  { name: "3x3 zero in the centre", width: 3, height: 3, clues: "....0....", count: 20 },
];
