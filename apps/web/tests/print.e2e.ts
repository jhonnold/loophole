import { createGrid } from "@loophole/core";
import { expect, type Page, test } from "@playwright/test";
import { FIXTURES } from "../src/lib/puzzles/fixtures.ts";
import { board, edgePoint, lines } from "./board.ts";

const grid7 = createGrid(7, 7);
const small7 = FIXTURES.find((f) => f.id === "small-7");
if (small7 === undefined) throw new Error("no small-7 fixture");
const clueCount7 = [...small7.wire.clues].filter((c) => c !== ".").length;

/** Replaces window.print with a counter, so clicking Print doesn't open a dialog. */
async function stubPrint(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { printed: number };
    w.printed = 0;
    window.print = () => {
      w.printed++;
    };
  });
}

const sheet = (page: Page) => page.locator("body > .print-sheet");
const printButton = (page: Page) => page.getByRole("button", { name: "Print puzzle" });

for (const viewport of [
  { width: 360, height: 560 },
  { width: 1280, height: 800 },
]) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    test("Print prints the blank puzzle and nothing else", async ({ page }) => {
      await stubPrint(page);
      await page.goto("/play/small-7");
      await expect(board(page)).toBeVisible();

      // A mark on the board, which the printed puzzle leaves out.
      const p = await edgePoint(page, grid7, 0);
      await page.mouse.click(p.x, p.y);
      await expect(lines(page)).toHaveCount(1);

      await expect(sheet(page)).toHaveCount(0);
      await printButton(page).click();
      expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
      await expect(sheet(page)).toHaveCount(1);
      await expect(sheet(page)).toBeHidden();

      await page.emulateMedia({ media: "print" });
      await expect(sheet(page)).toBeVisible();
      await expect(board(page)).toBeHidden();
      await expect(sheet(page).getByRole("heading")).toHaveText("Small · 7×7");
      await expect(sheet(page).locator("text.clue")).toHaveCount(clueCount7);
      await expect(sheet(page).locator("circle.dot")).toHaveCount(grid7.dotCount);
      await expect(sheet(page).locator("line, path")).toHaveCount(0);
    });

    test("the header keeps the title, Print and the clock on screen", async ({ page }) => {
      await page.goto("/play/small-7");
      await expect(printButton(page)).toBeVisible();
      const overflow = await page
        .locator("header.bar")
        .evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const title = await page.locator("header.bar h1").boundingBox();
      expect(title?.width ?? 0).toBeGreaterThan(60);
    });
  });
}

test("prints black on white in the dark theme", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("loophole:theme", "dark"));
  await page.goto("/play/small-7");
  await expect(board(page)).toBeVisible();
  // Ctrl/Cmd+P and the browser menu fire beforeprint, which mounts the sheet.
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await page.emulateMedia({ media: "print" });
  await expect(sheet(page)).toBeVisible();
  const colours = await page.evaluate(() => {
    const clue = document.querySelector(".print-sheet text.clue");
    const heading = document.querySelector(".print-sheet h1");
    return {
      body: getComputedStyle(document.body).backgroundColor,
      clue: clue ? getComputedStyle(clue).fill : "",
      heading: heading ? getComputedStyle(heading).color : "",
    };
  });
  expect(colours).toEqual({
    body: "rgb(255, 255, 255)",
    clue: "rgb(0, 0, 0)",
    heading: "rgb(0, 0, 0)",
  });
});

test("a canvas board prints as one SVG that fits the page", async ({ page }) => {
  await stubPrint(page);
  await page.goto("/play/huge-40");
  await expect(board(page)).toBeVisible();
  await printButton(page).click();
  await page.emulateMedia({ media: "print" });
  await expect(sheet(page).locator("circle.dot")).toHaveCount(41 * 41);
  const fits = await sheet(page)
    .locator("svg")
    .evaluate((el) => el.getBoundingClientRect().bottom <= window.innerHeight);
  expect(fits).toBe(true);
});

test("the sheet goes when the play screen does", async ({ page }) => {
  await stubPrint(page);
  await page.goto("/play/small-7");
  await printButton(page).click();
  await expect(sheet(page)).toHaveCount(1);
  await page.getByRole("link", { name: "Back to puzzles" }).click();
  await expect(page).toHaveURL("/");
  await expect(sheet(page)).toHaveCount(0);
});
