import { type Browser, expect, type Page, test } from "@playwright/test";
import { board } from "./board.ts";

// PRD §10: p95 time to first interaction on a mid-range phone under 2 s. Each load starts with an
// empty cache, the CPU slowed 4× and a slow 4G network (150 ms round trips, 1.6 Mbit/s down), as
// Lighthouse models a mid-range phone. The time runs from navigation until the page takes input.
// Run with `bun run test:perf`; like the frame-time checks, it depends on the machine.
//
// The design kit's fonts load in two parts so this holds: the Latin subsets block the first paint
// (about 2 KB of rules), and the full stylesheets with the Japanese glyph ranges (about 700 KB) load
// after it (DECISIONS, "Time to first interaction").

const LOADS = 5;
const BUDGET_MS = 2_000;

async function phonePage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 664 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  return page;
}

async function p95Load(browser: Browser, path: string, ready: (page: Page) => Promise<void>) {
  const times: number[] = [];
  for (let i = 0; i < LOADS; i++) {
    const page = await phonePage(browser);
    const started = Date.now();
    await page.goto(path, { waitUntil: "commit" });
    await ready(page);
    times.push(Date.now() - started);
    await page.context().close();
  }
  times.sort((a, b) => a - b);
  return { times, p95: times[Math.min(times.length - 1, Math.ceil(0.95 * times.length) - 1)] };
}

test.describe("@perf time to first interaction (PRD §10)", () => {
  test("the home page takes a tap within 2 s", async ({ browser }) => {
    const { times, p95 } = await p95Load(browser, "/", async (page) => {
      await expect(page.getByRole("heading", { name: "Practice 練習" })).toBeVisible({
        timeout: 15_000,
      });
    });
    console.log(`home: ${times.join(", ")} ms; p95 ${p95} ms`);
    expect(p95).toBeLessThan(BUDGET_MS);
  });

  test("a puzzle takes its first move within 2 s", async ({ browser }) => {
    const { times, p95 } = await p95Load(browser, "/play/small-7", async (page) => {
      await expect(board(page)).toHaveAttribute("tabindex", "0", { timeout: 15_000 });
    });
    console.log(`play: ${times.join(", ")} ms; p95 ${p95} ms`);
    expect(p95).toBeLessThan(BUDGET_MS);
  });
});
