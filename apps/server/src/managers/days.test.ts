import { describe, expect, test } from "bun:test";
import { addDays, DAY_MS, dayStart, isDay, streakLength, utcDay } from "./days.ts";

describe("UTC days", () => {
  test("a day switches at 00:00 UTC", () => {
    const midnight = Date.UTC(2026, 9, 26);
    expect(utcDay(midnight - 1)).toBe("2026-10-25");
    expect(utcDay(midnight)).toBe("2026-10-26");
    expect(dayStart("2026-10-26")).toBe(midnight);
    expect(dayStart(addDays("2026-10-26", 1)) - dayStart("2026-10-26")).toBe(DAY_MS);
  });

  test("adds days across months, years and leap days", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
  });

  test("checks the YYYY-MM-DD form and that the day exists", () => {
    expect(isDay("2026-10-25")).toBe(true);
    expect(isDay("2028-02-29")).toBe(true);
    for (const bad of ["2027-02-29", "2026-13-01", "2026-10-32", "2026-1-5", "today", ""]) {
      expect(isDay(bad)).toBe(false);
    }
  });
});

describe("streakLength (FR-24)", () => {
  const today = "2026-10-25";

  test("counts consecutive days back from today", () => {
    expect(streakLength([], today)).toBe(0);
    expect(streakLength([today], today)).toBe(1);
    expect(streakLength(["2026-10-23", "2026-10-24", today], today)).toBe(3);
    expect(streakLength(["2026-10-22", "2026-10-24", today], today)).toBe(2);
  });

  test("a streak that ended yesterday lasts until today is over", () => {
    expect(streakLength(["2026-10-23", "2026-10-24"], today)).toBe(2);
    expect(streakLength(["2026-10-23"], today)).toBe(0);
  });

  test("runs across a month and a year end", () => {
    const days = ["2026-12-30", "2026-12-31", "2027-01-01"];
    expect(streakLength(days, "2027-01-01")).toBe(3);
    expect(streakLength(["2026-10-31", "2026-11-01"], "2026-11-01")).toBe(2);
  });

  test("ignores repeats and future days", () => {
    expect(streakLength([today, today, "2026-10-24", "2026-10-26"], today)).toBe(2);
  });
});
