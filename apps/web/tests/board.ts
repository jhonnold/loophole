import type { Grid } from "@loophole/core";
import type { Locator, Page } from "@playwright/test";

/** The board: the focusable widget that takes pointer and keyboard input. */
export function board(page: Page): Locator {
  return page.locator("[role=application]");
}

/** Page coordinates of every dot of an SVG board, from where the dots render (index order). */
export async function dotPoints(page: Page): Promise<{ x: number; y: number }[]> {
  return page.locator("[role=application] circle.dot").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }),
  );
}

export async function edgePoint(page: Page, grid: Grid, edge: number) {
  const dots = await dotPoints(page);
  const a = dots[grid.edgeDots[edge * 2]];
  const b = dots[grid.edgeDots[edge * 2 + 1]];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** The board's geometry from its data attributes: cell size, margin and scroll offset. */
export async function boardView(page: Page) {
  const el = board(page);
  const box = await el.boundingBox();
  if (box === null) throw new Error("board not visible");
  const num = async (name: string) => Number(await el.getAttribute(`data-${name}`));
  return {
    box,
    cell: await num("cell"),
    margin: await num("margin"),
    x: await num("x"),
    y: await num("y"),
  };
}

/** Page coordinates of dot (row, col) on any board, SVG or canvas, zoomed or not. */
export async function dotAt(page: Page, row: number, col: number) {
  const v = await boardView(page);
  return {
    x: v.box.x + v.margin + col * v.cell - v.x,
    y: v.box.y + v.margin + row * v.cell - v.y,
  };
}

/** Page coordinates of the middle of the horizontal edge nearest the centre of the viewport. */
export async function centreEdge(page: Page) {
  const v = await boardView(page);
  const col = Math.floor((v.x + v.box.width / 2 - v.margin) / v.cell);
  const row = Math.round((v.y + v.box.height / 2 - v.margin) / v.cell);
  const p = await dotAt(page, row, col);
  return { x: p.x + v.cell / 2, y: p.y };
}

/** Drawn lines. Use with `expect(...).toHaveCount(n)`, which retries until the DOM settles. */
export function lines(page: Page): Locator {
  return page.locator("[role=application] line.line");
}

/** Drawn crosses. Use with `expect(...).toHaveCount(n)`, which retries until the DOM settles. */
export function crosses(page: Page): Locator {
  return page.locator("[role=application] path.cross");
}

/** Number of lines in the saved progress of puzzle `id`; works for canvas boards too. */
export async function savedLines(page: Page, id: string): Promise<number> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (raw === null) return 0;
    const edges: string = JSON.parse(raw).edges;
    return edges.split("").filter((ch) => ch === "1").length;
  }, `loophole:progress:${id}`);
}

type TouchPoint = { x: number; y: number };

/** A real touch drag through Chromium's input pipeline (Playwright's touchscreen only taps). */
export async function touchDrag(page: Page, points: TouchPoint[]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const [first, ...rest] = points;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [first] });
  for (const p of rest) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/**
 * A two-finger gesture: the fingers move in `steps` steps from `from` to `to` (each a pair of
 * points), then lift.
 */
export async function twoFingers(
  page: Page,
  from: [TouchPoint, TouchPoint],
  to: [TouchPoint, TouchPoint],
  steps = 8,
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const at = (t: number) =>
    from.map((p, i) => ({
      x: p.x + (to[i].x - p.x) * t,
      y: p.y + (to[i].y - p.y) * t,
      id: i,
    }));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(0) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(i / steps) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** True when the page can scroll sideways (NFR-2 forbids it). */
export async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}
