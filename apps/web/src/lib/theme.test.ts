import { expect, test } from "bun:test";
import { memoryStorage } from "./test-support/memory-storage.ts";
import { readThemeChoice, saveThemeChoice, THEME_KEY } from "./theme.ts";

test("defaults to following the system", () => {
  expect(readThemeChoice(memoryStorage())).toBe("system");
  expect(readThemeChoice(null)).toBe("system");
});

test("remembers light and dark; system clears the override", () => {
  const s = memoryStorage();
  saveThemeChoice(s, "dark");
  expect(s.data.get(THEME_KEY)).toBe("dark");
  expect(readThemeChoice(s)).toBe("dark");
  saveThemeChoice(s, "system");
  expect(s.data.has(THEME_KEY)).toBe(false);
  expect(readThemeChoice(s)).toBe("system");
});

test("treats unknown stored values as system", () => {
  const s = memoryStorage();
  s.data.set(THEME_KEY, "sepia");
  expect(readThemeChoice(s)).toBe("system");
});
