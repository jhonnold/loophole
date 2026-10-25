import { createGrid, type Grid } from "@loophole/core";
import type { Locator, Page } from "@playwright/test";

/** Page coordinates of every dot, read from the rendered board (dots render in index order). */
export async function dotPoints(page: Page): Promise<{ x: number; y: number }[]> {
  const box = await page.locator("svg[role=application]").boundingBox();
  if (box === null) throw new Error("board not visible");
  const local = await page
    .locator("svg[role=application] circle.dot")
    .evaluateAll((els) =>
      els.map((el) => ({ x: Number(el.getAttribute("cx")), y: Number(el.getAttribute("cy")) })),
    );
  return local.map((p) => ({ x: box.x + p.x, y: box.y + p.y }));
}

export async function edgePoint(page: Page, grid: Grid, edge: number) {
  const dots = await dotPoints(page);
  const a = dots[grid.edgeDots[edge * 2]];
  const b = dots[grid.edgeDots[edge * 2 + 1]];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function gridFor(width: number, height: number): Grid {
  return createGrid(width, height);
}

/** Drawn lines. Use with `expect(...).toHaveCount(n)`, which retries until the DOM settles. */
export function lines(page: Page): Locator {
  return page.locator("svg[role=application] line.line");
}

/** Drawn crosses. Use with `expect(...).toHaveCount(n)`, which retries until the DOM settles. */
export function crosses(page: Page): Locator {
  return page.locator("svg[role=application] path.cross");
}

/** A real touch drag through Chromium's input pipeline (Playwright's touchscreen only taps). */
export async function touchDrag(page: Page, points: { x: number; y: number }[]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const [first, ...rest] = points;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [first] });
  for (const p of rest) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** True when the page can scroll sideways (NFR-2 forbids it). */
export async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}
