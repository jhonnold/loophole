import { expect, type Page, test } from "@playwright/test";
import { board, boardView, dotAt, savedLines } from "./board.ts";

// Frame-time checks for NFR-2, run with `bun run test:perf`; `bun run test:e2e` skips them. The CPU
// is slowed 4× to stand in for a mid-range phone. Headless Chromium paces frames at 60 Hz, so a
// frame interval near 16.7 ms means the page kept up.

/** Starts recording the time between animation frames. */
async function startFrames(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { frames_: number[]; stop_: boolean };
    w.frames_ = [];
    w.stop_ = false;
    let last = performance.now();
    const loop = (t: number) => {
      w.frames_.push(t - last);
      last = t;
      if (!w.stop_) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}

/** Stops recording; returns the median, 95th percentile and worst frame interval in ms. */
async function stopFrames(page: Page) {
  const frames = await page.evaluate(() => {
    const w = window as unknown as { frames_: number[]; stop_: boolean };
    w.stop_ = true;
    return w.frames_.slice(1);
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { count: frames.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] };
}

async function slowCpu(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  return cdp;
}

test.describe("@perf frame times", () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });

  test("drawing on a 30×30 SVG board keeps 60 fps", async ({ page }) => {
    await page.goto("/play/big-30");
    await expect(board(page)).toBeVisible();
    const cdp = await slowCpu(page);
    // A stroke back and forth along row 3, one touch move per frame's worth of finger travel.
    const path: { x: number; y: number }[] = [];
    for (let k = 0; k < 4; k++) {
      for (let c = 0; c <= 6; c++) path.push(await dotAt(page, 3, k % 2 === 0 ? c : 6 - c));
    }
    const moves: { x: number; y: number }[] = [];
    for (let i = 1; i < path.length; i++) {
      for (let s = 1; s <= 4; s++) {
        moves.push({
          x: path[i - 1].x + ((path[i].x - path[i - 1].x) * s) / 4,
          y: path[i - 1].y + ((path[i].y - path[i - 1].y) * s) / 4,
        });
      }
    }
    await startFrames(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [path[0]] });
    for (const p of moves) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const f = await stopFrames(page);
    console.log(`30×30 SVG drawing: ${JSON.stringify(f)}`);
    // The stroke must really have drawn, or the frame times mean nothing.
    expect(await savedLines(page, "big-30")).toBeGreaterThan(0);
    expect(f.p95).toBeLessThan(20);
    expect(f.max).toBeLessThan(50);
  });

  test("pinch and pan on a 100×100 canvas board stay smooth", async ({ page }) => {
    await page.goto("/play/giant-100");
    await expect(board(page)).toBeVisible();
    const cdp = await slowCpu(page);
    const v = await boardView(page);
    const cx = v.box.x + v.box.width / 2;
    const cy = v.box.y + v.box.height / 2;
    await startFrames(page);
    // Pinch out to the whole board, back in, then pan around.
    const fingers = (spread: number, dx: number, dy: number) => [
      { x: cx - spread + dx, y: cy + dy, id: 0 },
      { x: cx + spread + dx, y: cy + dy, id: 1 },
    ];
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: fingers(120, 0, 0),
    });
    for (let i = 0; i <= 30; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: fingers(120 - i * 3.5, 0, 0),
      });
    }
    for (let i = 0; i <= 30; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: fingers(15 + i * 3.5, 0, 0),
      });
    }
    for (let i = 0; i <= 60; i++) {
      const a = (i / 60) * 2 * Math.PI;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: fingers(120, Math.cos(a) * 80 - 80, Math.sin(a) * 80),
      });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const f = await stopFrames(page);
    console.log(`100×100 canvas pinch and pan: ${JSON.stringify(f)}`);
    expect(f.p95).toBeLessThan(20);
    expect(f.max).toBeLessThan(50);
  });
});
