import { expect, type Page, test } from "@playwright/test";
import { board, dotAt, touchDrag } from "./board.ts";

/** The centre of cell (row, col): halfway between its top-left and bottom-right dots. */
async function cellPoint(page: Page, row: number, col: number) {
  const a = await dotAt(page, row, col);
  const b = await dotAt(page, row + 1, col + 1);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

const shades = (page: Page) => page.locator("[role=application] .shade");
const outside = (page: Page) => page.locator("[role=application] .shade.side-out");

for (const [width, height] of [
  [360, 560],
  [390, 664],
] as const) {
  test.describe(`phone ${width}×${height}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true, isMobile: true });

    test("shade mode: a tap cycles a cell in, out, none; a drag shades a run; undo and reload keep up", async ({
      page,
    }) => {
      await page.goto("/play/small-7");
      await expect(board(page)).toBeVisible();
      const before = await board(page).boundingBox();
      const toggle = page.getByRole("button", { name: "Shade" });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      // The tray takes the fifth button without moving the board.
      expect(await board(page).boundingBox()).toEqual(before);
      await expect(page.getByText("Shading: tap a cell")).toBeVisible();
      const c = await cellPoint(page, 2, 2);
      await page.touchscreen.tap(c.x, c.y);
      await expect(shades(page)).toHaveCount(1);
      await expect(outside(page)).toHaveCount(0);
      await page.touchscreen.tap(c.x, c.y);
      await expect(outside(page)).toHaveCount(1);
      await page.touchscreen.tap(c.x, c.y);
      await expect(shades(page)).toHaveCount(0);
      // No edge was marked by any of it.
      await expect(page.locator("[role=application] .line")).toHaveCount(0);

      // A drag along a row shades each cell it passes, as one undo step.
      const from = await cellPoint(page, 4, 1);
      const to = await cellPoint(page, 4, 4);
      await touchDrag(page, [from, { x: (from.x + to.x) / 2, y: from.y }, to]);
      await expect(shades(page)).toHaveCount(4);
      await page.getByRole("button", { name: "Undo" }).click();
      await expect(shades(page)).toHaveCount(0);
      await page.getByRole("button", { name: "Redo" }).click();
      await expect(shades(page)).toHaveCount(4);

      // Shade mode off: taps mark edges again. The shades are saved with the board.
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await page.reload();
      await expect(board(page)).toBeVisible();
      await expect(shades(page)).toHaveCount(4);
      // Clear takes them away too.
      await page.getByRole("button", { name: "Clear" }).click();
      await expect(shades(page)).toHaveCount(0);
    });
  });
}

test("S turns shade mode on and off from the keyboard", async ({ page }) => {
  await page.goto("/play/small-7");
  await expect(board(page)).toBeVisible();
  const toggle = page.getByRole("button", { name: "Shade" });
  await page.keyboard.press("s");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("s");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});
