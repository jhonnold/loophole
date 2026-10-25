import { describe, expect, test } from "bun:test";
import {
  countdown,
  coverTint,
  dailyPath,
  dailyRefreshDue,
  dailySubtitle,
  dayHeading,
  msToNextDay,
  shortDay,
  sizeName,
  utcDay,
  weekdayLetter,
} from "./days.ts";

describe("daily names and dates", () => {
  test("size classes have the Home artboard's names and cover tints", () => {
    expect([7, 10, 20, 40].map(sizeName)).toEqual(["Small", "Medium", "Large", "Giant"]);
    expect(sizeName(15)).toBe("15×15");
    expect([7, 10, 20, 40].map(coverTint)).toEqual(["#F2C4CE", "#E8DFC4", "#C8DAE6", "#D5E3C2"]);
  });

  test("counts down to the next 00:00 UTC", () => {
    const midnight = Date.UTC(2026, 9, 26);
    expect(utcDay(midnight - 1)).toBe("2026-10-25");
    expect(msToNextDay(midnight - 1)).toBe(1);
    expect(msToNextDay(midnight)).toBe(24 * 60 * 60 * 1000);
    expect(countdown((5 * 60 + 12) * 60_000 + 30_000)).toBe("5h 12m");
    expect(countdown(12 * 60_000 + 5_000)).toBe("12m 05s");
    expect(countdown(-5)).toBe("0m 00s");
  });

  test("Home asks again when the server was down, the day is over, or a size isn't ready", () => {
    const nextAt = "2026-10-26T00:00:00.000Z";
    const before = Date.UTC(2026, 9, 25, 23);
    const ready = { nextAt, puzzles: [{ puzzleId: "a" }, { puzzleId: "b" }] };
    expect(dailyRefreshDue(undefined, before)).toBe(false);
    expect(dailyRefreshDue(null, before)).toBe(true);
    expect(dailyRefreshDue(ready, before)).toBe(false);
    expect(dailyRefreshDue(ready, Date.parse(nextAt))).toBe(true);
    expect(
      dailyRefreshDue({ nextAt, puzzles: [{ puzzleId: "a" }, { puzzleId: null }] }, before),
    ).toBe(true);
  });

  test("writes days as the artboards do, in UTC", () => {
    expect(dayHeading("2026-10-25")).toBe("日曜日 · Sunday 25 October");
    expect(shortDay("2026-10-25")).toBe("25 Oct");
    expect(weekdayLetter("2026-10-19")).toBe("M");
    expect(weekdayLetter("2026-10-25")).toBe("S");
    expect(dailySubtitle("2026-10-25", true)).toBe("Daily · 25 Oct · 今日の問題");
    expect(dailySubtitle("2026-10-24", false)).toBe("Daily · 24 Oct");
    expect(dailyPath("2026-10-25", 7)).toBe("/daily/2026-10-25/7");
  });
});
