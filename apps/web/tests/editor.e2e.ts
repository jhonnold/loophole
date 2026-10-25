import { expect, type Page, test } from "@playwright/test";
import { board, boardView, scrollsSideways } from "./board.ts";

// The Editor artboard's puzzle: a real puzzle with the 3 in row 6, column 5 taken out, which leaves
// two answers. Putting it back makes the answer unique.
const ARTBOARD = {
  v: 1,
  width: 7,
  height: 7,
  clues: "..2..1.3.222...1.1..3.....2.110..0.........0.3.0.",
};

/** Opens the editor with `draft` already saved on this device. */
async function openWith(page: Page, draft: object) {
  await page.addInitScript((text) => {
    if (!localStorage.getItem("loophole:editor-draft"))
      localStorage.setItem("loophole:editor-draft", text);
  }, JSON.stringify(draft));
  await page.goto("/create");
  await expect(board(page)).toBeVisible();
}

/** Page coordinates of the middle of cell (row, col), with the board scrolled into view. */
async function cellPoint(page: Page, row: number, col: number) {
  await board(page).scrollIntoViewIfNeeded();
  const v = await boardView(page);
  return {
    x: v.box.x + v.margin + (col + 0.5) * v.cell - v.x,
    y: v.box.y + v.margin + (row + 0.5) * v.cell - v.y,
  };
}

async function clickCell(page: Page, row: number, col: number) {
  const p = await cellPoint(page, row, col);
  await page.mouse.click(p.x, p.y);
}

function current(page: Page) {
  return page.getByRole("list", { name: "Possible results" }).locator("[aria-current=true]");
}

function clues(page: Page) {
  return page.locator("[role=application] text.clue");
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("multiple shows both answers and a suggestion; the missing clue makes it unique (FR-26)", async ({
    page,
  }) => {
    await openWith(page, ARTBOARD);
    await expect(current(page)).toHaveText(/multiple/);
    await expect(page.getByText("More than one answer")).toBeVisible();
    await expect(page.getByText("Answer A", { exact: true })).toBeVisible();
    await expect(page.getByText("Answer B", { exact: true })).toBeVisible();
    await expect(page.getByText(/in the highlighted cell rules out Answer B/)).toBeVisible();
    await expect(page.getByText("17 clues · 7×7")).toBeVisible();

    await page.getByRole("button", { name: "3", exact: true }).click();
    await clickCell(page, 5, 4);
    await expect(current(page)).toHaveText(/unique/);
    await expect(page.getByText("Exactly one answer")).toBeVisible();
    await expect(page.getByText("Answer A", { exact: true })).toHaveCount(0);
    // Guests are sent to log in before publishing (FR-27).
    await expect(page.getByRole("link", { name: "Log in to publish" })).toBeVisible();
  });

  test("typing a bigger size keeps the clues (FR-26)", async ({ page }) => {
    await openWith(page, { v: 1, width: 7, height: 7, clues: `....2..${".".repeat(42)}` });
    const width = page.getByLabel("Width");
    await width.click();
    await width.press("Control+a");
    await width.pressSequentially("12");
    await width.press("Tab");
    await expect(page.getByText("1 clue · 12×7")).toBeVisible();
    await expect(clues(page)).toHaveText(["2"]);
  });

  test("a clue no loop can satisfy shows none", async ({ page }) => {
    await openWith(page, { v: 1, width: 1, height: 1, clues: "." });
    await clickCell(page, 0, 0); // empty → 0: the only loop has four sides
    await expect(current(page)).toHaveText(/none/);
    await expect(page.getByText("No answer", { exact: true })).toBeVisible();
  });

  test("the header links to the editor", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Create" }).click();
    await expect(page).toHaveURL(/\/create$/);
    await expect(page.getByRole("heading", { name: "New puzzle" })).toBeVisible();
  });
});

for (const [width, height] of [
  [360, 560],
  [390, 664],
] as const) {
  test.describe(`phone ${width}×${height}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true, isMobile: true });

    test("taps cycle, keys place, and the draft survives a reload", async ({ page }) => {
      await openWith(page, { v: 1, width: 3, height: 2, clues: "......" });
      const p = await cellPoint(page, 0, 0);
      await page.touchscreen.tap(p.x, p.y);
      await page.touchscreen.tap(p.x, p.y);
      await expect(clues(page)).toHaveText(["1"]);
      await board(page).focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("3");
      await expect(clues(page)).toHaveText(["1", "3"]);
      await page.keyboard.press("Backspace");
      await expect(clues(page)).toHaveText(["1"]);
      await page.reload();
      await expect(clues(page)).toHaveText(["1"]);
      expect(await scrollsSideways(page)).toBe(false);
    });

    test("a large grid zooms instead of shrinking (FR-13)", async ({ page }) => {
      await openWith(page, { v: 1, width: 7, height: 7, clues: ".".repeat(49) });
      await page.getByLabel("Width").fill("60");
      await page.getByLabel("Height").fill("60");
      await page.getByLabel("Height").blur();
      await expect(page.getByText("0 clues · 60×60")).toBeVisible();
      await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
      await expect(page.locator("[role=application] canvas")).toBeVisible();
      expect((await boardView(page)).cell).toBeGreaterThanOrEqual(44);
      expect(await scrollsSideways(page)).toBe(false);
    });
  });
}
