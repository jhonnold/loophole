import { LEVELS, RULE_TITLE } from "@loophole/core";
import { expect, test } from "@playwright/test";
import { levelName } from "../src/lib/puzzles/source.ts";
import { LESSONS } from "../src/lib/techniques/lessons.ts";

// The techniques page: every rule the solver uses, easiest first, each walked through a step at a
// time.

for (const viewport of [
  { width: 360, height: 640 },
  { width: 1280, height: 800 },
]) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    test("lists every technique under its level, easiest first", async ({ page }) => {
      await page.goto("/techniques");
      await expect(page.getByRole("heading", { level: 1, name: "Techniques" })).toBeVisible();
      const levels = page.getByRole("heading", { level: 2 });
      await expect(levels).toHaveText(LEVELS.map((l) => new RegExp(`^${levelName(l)}`)));
      const titles = page.getByRole("heading", { level: 3 });
      await expect(titles).toHaveText(LESSONS.map((l) => RULE_TITLE[l.rule]));
      for (const level of LEVELS) {
        const names = LESSONS.filter((l) => l.level === level).map((l) => RULE_TITLE[l.rule]);
        await expect(page.locator(`#${level}`).getByRole("heading", { level: 3 })).toHaveText(
          names,
        );
      }
      // Nothing wider than the window (360px phones, NFR-2).
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });

    test("a figure steps through its frames, its caption read out with each", async ({ page }) => {
      await page.goto("/techniques");
      const lesson = LESSONS[0];
      const title = RULE_TITLE[lesson.rule];
      const section = page.locator(`#${lesson.rule}`);
      const next = section.getByRole("button", { name: `Next step of ${title}` });
      const back = section.getByRole("button", { name: `Previous step of ${title}` });
      const caption = section.locator(".caption");
      await expect(back).toBeDisabled();
      for (const [i, frame] of lesson.frames.entries()) {
        if (i > 0) await next.click();
        await expect(caption).toHaveText(frame.caption);
        await expect(caption).toHaveAttribute("aria-live", "polite");
        await expect(section.getByText(`Step ${i + 1} of ${lesson.frames.length}`)).toBeVisible();
        // The move frame draws its ghosts; the others draw none.
        await expect(section.locator(".ghost, .ghost-cross")).toHaveCount(
          frame.marks.ghosts.length,
        );
      }
      await expect(next).toBeDisabled();
      await back.click();
      await expect(caption).toHaveText(lesson.frames.at(-2)?.caption ?? "");
    });

    test("a hint's link opens its technique in view", async ({ page }) => {
      await page.goto("/techniques#corner-3");
      const section = page.locator("#corner-3");
      await expect(section).toBeInViewport();
      await expect(section.getByRole("heading", { name: RULE_TITLE["corner-3"] })).toBeVisible();
    });
  });
}

test("Home links to the techniques page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Learn the techniques" }).click();
  await expect(page).toHaveURL(/\/techniques$/);
  await expect(page.getByRole("heading", { level: 1, name: "Techniques" })).toBeVisible();
});
