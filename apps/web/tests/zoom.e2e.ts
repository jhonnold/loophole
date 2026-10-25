import { createGrid, hEdgeIndex } from "@loophole/core";
import { expect, type Page, test } from "@playwright/test";
import {
  board,
  boardView,
  centreEdge,
  dotAt,
  dotPoints,
  edgePoint,
  lines,
  savedLines,
  scrollsSideways,
  touchDrag,
  twoFingers,
} from "./board.ts";

/** Page coordinates of the middle of the board's viewport. */
async function centre(page: Page) {
  const v = await boardView(page);
  return { x: v.box.x + v.box.width / 2, y: v.box.y + v.box.height / 2 };
}

/** True when the page is no taller than the window (the tool tray is on screen). */
function fitsTheWindow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight);
}

test.describe("phone 360×560, zoomable boards (FR-13, NFR-2)", () => {
  test.use({ viewport: { width: 360, height: 560 }, hasTouch: true, isMobile: true });

  test("a 10×10 opens zoomed to 44px cells with the overview map", async ({ page }) => {
    await page.goto("/play/medium-10");
    await expect(board(page)).toBeVisible();
    expect((await boardView(page)).cell).toBe(44);
    const dots = await dotPoints(page);
    expect(dots[1].x - dots[0].x).toBeCloseTo(44, 2);
    expect(await scrollsSideways(page)).toBe(false);
    expect(await fitsTheWindow(page)).toBe(true);
    await expect(page.getByRole("img", { name: /Overview/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
  });

  test("taps and drags draw on the zoomed board", async ({ page }) => {
    await page.goto("/play/medium-10");
    const grid = createGrid(10, 10);
    const p = await edgePoint(page, grid, hEdgeIndex(grid, 2, 2));
    await page.touchscreen.tap(p.x, p.y);
    await expect(lines(page)).toHaveCount(1);
    await touchDrag(page, [
      await dotAt(page, 4, 1),
      await dotAt(page, 4, 2),
      await dotAt(page, 4, 3),
    ]);
    await expect(lines(page)).toHaveCount(3);
  });

  test("the board pans past its corner so edges under the overview map can be tapped", async ({
    page,
  }) => {
    await page.goto("/play/medium-10");
    const c = await centre(page);
    // Drag two fingers far right and down: the board stops with its corner clear of the map.
    await twoFingers(
      page,
      [
        { x: c.x - 30, y: c.y - 60 },
        { x: c.x + 30, y: c.y - 60 },
      ],
      [
        { x: c.x + 170, y: c.y + 140 },
        { x: c.x + 230, y: c.y + 140 },
      ],
    );
    await expect.poll(async () => (await boardView(page)).x).toBe(-104);
    expect((await boardView(page)).y).toBe(-104);
    const a = await dotAt(page, 0, 0);
    const cell = (await boardView(page)).cell;
    await page.touchscreen.tap(a.x + cell / 2, a.y);
    await expect(lines(page)).toHaveCount(1);
  });

  test("two fingers pinch to zoom and pan without drawing; then taps draw where they land", async ({
    page,
  }) => {
    await page.goto("/play/giant-100");
    await expect(board(page)).toBeVisible();
    const before = await boardView(page);
    const { x: cx, y: cy } = await centre(page);
    // Bring the fingers together to a third of their distance: zooms out to a third.
    await twoFingers(
      page,
      [
        { x: cx - 90, y: cy },
        { x: cx + 90, y: cy },
      ],
      [
        { x: cx - 30, y: cy },
        { x: cx + 30, y: cy },
      ],
    );
    await expect.poll(async () => (await boardView(page)).cell).toBeCloseTo(before.cell / 3, 1);
    // Move both fingers left and up: the board follows.
    const zoomed = await boardView(page);
    await twoFingers(
      page,
      [
        { x: cx, y: cy },
        { x: cx + 60, y: cy },
      ],
      [
        { x: cx - 100, y: cy - 50 },
        { x: cx - 40, y: cy - 50 },
      ],
    );
    await expect.poll(async () => (await boardView(page)).x).toBeCloseTo(zoomed.x + 100, 0);
    expect((await boardView(page)).y).toBeCloseTo(zoomed.y + 50, 0);
    expect(await savedLines(page, "giant-100")).toBe(0);
    // On the zoomed and panned board a tap still lands on the edge under the finger.
    const p = await centreEdge(page);
    await page.touchscreen.tap(p.x, p.y);
    await expect.poll(() => savedLines(page, "giant-100")).toBe(1);
  });

  test("draws on a zoomed canvas board", async ({ page }) => {
    await page.goto("/play/giant-100");
    await expect(board(page)).toBeVisible();
    // Row 5 is below the overview map in the top-left corner.
    await touchDrag(page, [
      await dotAt(page, 5, 1),
      await dotAt(page, 5, 2),
      await dotAt(page, 5, 3),
    ]);
    await expect.poll(() => savedLines(page, "giant-100")).toBe(2);
    const tap = await dotAt(page, 6, 1);
    await page.touchscreen.tap(tap.x, tap.y + (await boardView(page)).cell / 2);
    await expect.poll(() => savedLines(page, "giant-100")).toBe(3);
  });

  test("tapping the overview map moves the view there", async ({ page }) => {
    await page.goto("/play/huge-40");
    const map = page.getByRole("img", { name: /Overview/ });
    const box = await map.boundingBox();
    if (box === null) throw new Error("no map");
    expect((await boardView(page)).x).toBe(0);
    await page.touchscreen.tap(box.x + box.width - 4, box.y + box.height - 4);
    await expect.poll(async () => (await boardView(page)).x).toBeGreaterThan(500);
    expect((await boardView(page)).y).toBeGreaterThan(500);
  });

  test("zoomed all the way out, the whole board is on screen", async ({ page }) => {
    await page.goto("/play/giant-100");
    const out = page.getByRole("button", { name: "Zoom out" });
    while (await out.isEnabled()) await out.click();
    const v = await boardView(page);
    const size = 100 * v.cell + 2 * v.margin;
    // The board's left and top edges are on screen, and so are its right and bottom edges.
    expect(v.x).toBeLessThanOrEqual(0.5);
    expect(v.y).toBeLessThanOrEqual(0.5);
    expect(size - v.x).toBeLessThanOrEqual(v.box.width + 0.5);
    expect(size - v.y).toBeLessThanOrEqual(v.box.height + 0.5);
  });

  test("zoom buttons zoom in and out; the SVG marks are laid out again at the new size", async ({
    page,
  }) => {
    await page.goto("/play/large-20");
    const start = (await boardView(page)).cell;
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(async () => (await boardView(page)).cell).toBeCloseTo(start * 1.25, 3);
    // 150ms after the zoom stops the marks are redrawn at 55px cells: no scaling left, and the
    // kit's dot size for 55px cells (6px across).
    const group = page.locator("[role=application] svg.board-svg g").first();
    await expect.poll(() => group.getAttribute("transform")).toMatch(/scale\(1\)$/);
    await expect(page.locator("[role=application] circle.dot").first()).toHaveAttribute("r", "3");
    const dots = await dotPoints(page);
    expect(dots[1].x - dots[0].x).toBeCloseTo(start * 1.25, 2);
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect.poll(async () => (await boardView(page)).cell).toBeCloseTo(start / 1.25, 3);
  });

  test("one error keeps the board's height and the tool tray on screen", async ({ page }) => {
    await page.goto("/play/medium-10");
    const before = (await boardView(page)).box.height;
    // Three lines at dot (4, 4).
    const a = await dotAt(page, 4, 4);
    const cell = (await boardView(page)).cell;
    for (const p of [
      { x: a.x - cell / 2, y: a.y },
      { x: a.x + cell / 2, y: a.y },
      { x: a.x, y: a.y + cell / 2 },
    ]) {
      await page.touchscreen.tap(p.x, p.y);
    }
    await expect(page.getByText("Three lines meet at a dot.")).toBeVisible();
    expect((await boardView(page)).box.height).toBe(before);
    expect(await fitsTheWindow(page)).toBe(true);
    const undo = await page.getByRole("button", { name: "Undo" }).boundingBox();
    expect(undo !== null && undo.y + undo.height <= 560).toBe(true);
  });
});

test.describe("phone, resizing (NFR-2)", () => {
  test.use({ viewport: { width: 360, height: 700 }, hasTouch: true, isMobile: true });

  test("a zoomable board shrinks with the window", async ({ page }) => {
    await page.goto("/play/medium-10");
    const tall = (await boardView(page)).box.height;
    await page.setViewportSize({ width: 360, height: 560 });
    await expect.poll(async () => (await boardView(page)).box.height).toBeLessThan(tall);
    await expect.poll(() => fitsTheWindow(page)).toBe(true);
  });
});

test.describe("phone at 2× pixel density (FR-16)", () => {
  test.use({
    viewport: { width: 360, height: 560 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });

  test("the canvas board follows a theme change", async ({ page }) => {
    await page.goto("/play/giant-100");
    const v = await boardView(page);
    // The centre of dot (5, 5), in CSS pixels on the canvas.
    const at = {
      x: v.margin + 5 * v.cell - v.x,
      y: v.margin + 5 * v.cell - v.y,
    };
    const dotColour = () =>
      page.evaluate(({ x, y }) => {
        const canvas = document.querySelector("[role=application] canvas") as HTMLCanvasElement;
        const r = devicePixelRatio;
        const d = canvas
          .getContext("2d")
          ?.getImageData(Math.round(x * r), Math.round(y * r), 1, 1).data;
        return d ? [d[0], d[1], d[2]] : [];
      }, at);
    await expect.poll(dotColour).toEqual([30, 28, 25]);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(dotColour).toEqual([236, 228, 211]);
    expect(await page.evaluate(() => devicePixelRatio)).toBe(2);
    const canvas = page.locator("[role=application] canvas");
    expect(Number(await canvas.getAttribute("width"))).toBe(Math.round(v.box.width * 2));
  });

  test("the canvas re-reads the pixel density when it changes", async ({ page }) => {
    await page.goto("/play/giant-100");
    const canvas = page.locator("[role=application] canvas");
    const v = await boardView(page);
    await expect
      .poll(async () => Number(await canvas.getAttribute("width")))
      .toBe(Math.round(v.box.width * 2));
    const cdp = await page.context().newCDPSession(page);
    // The height changes too, so the window fires a resize (headless Chromium does not report the
    // density change itself); the canvas must then match the new density and board width.
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 360,
      height: 561,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await expect
      .poll(async () => {
        const b = await boardView(page);
        return Number(await canvas.getAttribute("width")) === Math.round(b.box.width);
      })
      .toBe(true);
  });
});

test.describe("desktop, zoomable boards (FR-13, NFR-5)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("Ctrl + wheel zooms around the pointer; the wheel pans; clicks still land", async ({
    page,
  }) => {
    await page.goto("/play/giant-100");
    const before = await boardView(page);
    await page.mouse.move(before.box.x + 200, before.box.y + 200);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -200);
    await page.keyboard.up("Control");
    await expect.poll(async () => (await boardView(page)).cell).toBeGreaterThan(before.cell);
    const zoomed = await boardView(page);
    await page.mouse.wheel(0, 300);
    await expect.poll(async () => (await boardView(page)).y).toBeGreaterThan(zoomed.y);
    const p = await centreEdge(page);
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => savedLines(page, "giant-100")).toBe(1);
  });

  test("one Ctrl + wheel notch zooms by about 1.3×", async ({ page }) => {
    await page.goto("/play/giant-100");
    const before = await boardView(page);
    await page.mouse.move(before.box.x + 200, before.box.y + 200);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await expect.poll(async () => (await boardView(page)).cell).toBeGreaterThan(before.cell);
    const ratio = (await boardView(page)).cell / before.cell;
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(1.35);
  });

  test("Ctrl + wheel over the overview map zooms the board, not the page", async ({ page }) => {
    await page.goto("/play/giant-100");
    const before = await boardView(page);
    const map = await page.getByRole("img", { name: /Overview/ }).boundingBox();
    if (map === null) throw new Error("no map");
    await page.mouse.move(map.x + map.width / 2, map.y + map.height / 2);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await expect.poll(async () => (await boardView(page)).cell).toBeGreaterThan(before.cell);
  });

  test("the keyboard cursor keeps its edge in view", async ({ page }) => {
    await page.goto("/play/giant-100");
    await board(page).focus();
    for (let i = 0; i < 60; i++) await page.keyboard.press("ArrowRight");
    await expect(page.getByText("Row 1 · between columns 61 and 62 · empty").first()).toBeVisible();
    const v = await boardView(page);
    const cursor = await page.locator("rect.cursor").boundingBox();
    if (cursor === null) throw new Error("no cursor");
    expect(v.x).toBeGreaterThan(0);
    expect(cursor.x + cursor.width).toBeLessThanOrEqual(v.box.x + v.box.width);
  });

  test("tabbing to the board brings the cursor out from under the overview map", async ({
    page,
  }) => {
    await page.goto("/play/giant-100");
    for (
      let i = 0;
      i < 6 && !(await board(page).evaluate((el) => el === document.activeElement));
      i++
    ) {
      await page.keyboard.press("Tab");
    }
    await expect(page.locator("rect.cursor")).toBeVisible();
    const cursor = await page.locator("rect.cursor").boundingBox();
    const map = await page.getByRole("img", { name: /Overview/ }).boundingBox();
    if (cursor === null || map === null) throw new Error("missing box");
    const apart =
      cursor.x >= map.x + map.width ||
      cursor.y >= map.y + map.height ||
      cursor.x + cursor.width <= map.x ||
      cursor.y + cursor.height <= map.y;
    expect(apart).toBe(true);
  });

  test("board keys wait while a mouse stroke is held", async ({ page }) => {
    await page.goto("/play/small-7");
    const grid = createGrid(7, 7);
    const p = await edgePoint(page, grid, hEdgeIndex(grid, 0, 0));
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.keyboard.press("x");
    await page.mouse.up();
    await expect(lines(page)).toHaveCount(1);
    await expect(page.locator("[role=application] path.cross")).toHaveCount(0);
  });
});

test.describe("short desktop window (NFR-2)", () => {
  test.use({ viewport: { width: 1280, height: 600 } });

  test("a zoomable board fits the window's height", async ({ page }) => {
    await page.goto("/play/giant-100");
    const v = await boardView(page);
    expect(v.box.y + v.box.height).toBeLessThanOrEqual(600);
  });
});
