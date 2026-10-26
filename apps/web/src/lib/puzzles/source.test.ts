import { expect, test } from "bun:test";
import { levelName, puzzleSubtitle, puzzleTitle } from "./source.ts";

const SUMMARY = { id: "p1", name: "Generated", subtitle: "Practice · 練習", width: 7, height: 7 };

test("the header names the puzzle, and its level when it was made at one", () => {
  expect(puzzleTitle(SUMMARY)).toBe("Generated · 7×7");
  expect(puzzleSubtitle(SUMMARY)).toBe("Practice · 練習");
  expect(puzzleSubtitle({ ...SUMMARY, level: "easy" })).toBe("Practice · 練習 · Easy");
  expect(["easy", "medium", "hard"].map((l) => levelName(l as "easy"))).toEqual([
    "Easy",
    "Medium",
    "Hard",
  ]);
});
