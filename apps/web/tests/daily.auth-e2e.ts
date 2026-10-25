import { EdgeState, parsePuzzle, verify } from "@loophole/core";
import { expect, test } from "@playwright/test";
import { board, edgePoint } from "./board.ts";
import { canSignUp, mailedLink, reachable } from "./mailpit.ts";

// Today's daily puzzles from the real worker and a ranked solve validated by the real API (PRD
// FR-17, FR-22, FR-23, FR-25), with the stack playwright.auth.config.ts starts.

const PASSWORD = "hunter22-e2e";

test.beforeAll(async () => {
  // Ranked play needs a confirmed email (Mailpit) and the worker's puzzles (Garage).
  test.skip(
    !(await canSignUp()) || !(await reachable("http://localhost:3903/health")),
    "needs Mailpit and Garage (docker compose up -d) and access to challenges.cloudflare.com",
  );
});

test.use({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });

test("a confirmed player solves today's 7×7 ranked and sees their rank", async ({ page }) => {
  test.setTimeout(90_000);
  // Sign up, confirm and log in through the API; the account test covers those pages.
  const email = `e2e-${crypto.randomUUID()}@loophole.test`;
  const signUp = await page.request.post("/api/auth/signup", {
    data: { email, password: PASSWORD, captchaToken: "XXXX.DUMMY.TOKEN.XXXX" },
  });
  expect(signUp.status()).toBe(204);
  const token = new URLSearchParams((await mailedLink(email)).split("#")[1]).get("token");
  expect((await page.request.post("/api/auth/verify-email", { data: { token } })).status()).toBe(
    204,
  );
  const login = await page.request.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(login.status()).toBe(200);

  // The worker generates today's puzzles when it starts.
  let puzzleId = "";
  let day = "";
  await expect
    .poll(
      async () => {
        const set = (await (await page.request.get("/api/daily")).json()) as {
          day: string;
          puzzles: { size: number; puzzleId: string | null }[];
        };
        day = set.day;
        puzzleId = set.puzzles.find((p) => p.size === 7)?.puzzleId ?? "";
        return puzzleId;
      },
      { timeout: 30_000 },
    )
    .not.toBe("");

  // The puzzle comes without its seed or generator version, and the solution is worked out here
  // from the clues, as anyone could.
  const served = (await (await page.request.get(`/api/puzzles/${puzzleId}`)).json()) as {
    puzzle: Record<string, unknown>;
  };
  expect(Object.keys(served.puzzle).sort()).toEqual(["clues", "height", "v", "width"]);
  const puzzle = parsePuzzle(served.puzzle);
  const [solution] = verify(puzzle).solutions;

  await page.goto("/");
  const covers = page.getByRole("list", { name: "Today's daily puzzles" });
  await expect(page.getByLabel("Streak")).toContainText("0 day streak");
  await covers.getByRole("link", { name: /Small.*New · not started/ }).click();
  await expect(page).toHaveURL(`/daily/${day}/7`);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(board(page)).toBeVisible();
  const started = Date.now();

  const lines = [...solution.keys()].filter((e) => solution[e] === EdgeState.Line);
  for (const e of lines.slice(0, -1)) {
    const p = await edgePoint(page, puzzle.grid, e);
    await page.touchscreen.tap(p.x, p.y);
  }
  // A solve faster than the loop can be drawn (5 s for 49 cells) isn't ranked.
  await page.waitForTimeout(Math.max(0, 6_000 - (Date.now() - started)));
  const last = await edgePoint(page, puzzle.grid, lines[lines.length - 1]);
  await page.touchscreen.tap(last.x, last.y);

  await expect(page.getByText("Rank today")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("#1", { exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "You" })).toContainText("1");

  await page.goto("/");
  await expect(page.getByLabel("Streak")).toContainText("1 day streak");
  await expect(covers.getByRole("link", { name: /Small.*Solved/ })).toBeVisible();
});
