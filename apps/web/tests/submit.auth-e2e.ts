import { generate, serializePuzzle } from "@loophole/core";
import { expect, test } from "@playwright/test";
import { canSignUp, mailedLink, reachable } from "./mailpit.ts";
import { E2E_AUTH_PORT } from "./ports.ts";

test.beforeAll(async () => {
  // Publishing also needs the worker (started by the config) and Garage for the solution.
  test.skip(
    !(await canSignUp()) || !(await reachable("http://localhost:3903/health")),
    "needs Mailpit and Garage (docker compose up -d) and access to challenges.cloudflare.com",
  );
});

test("a confirmed player publishes a unique puzzle and opens its share link (FR-27)", async ({
  page,
}) => {
  // Sign up, confirm and log in through the API; the account test covers those pages.
  const email = `e2e-${crypto.randomUUID()}@loophole.test`;
  const password = "hunter22-e2e";
  const signUp = await page.request.post("/api/auth/signup", {
    data: { email, password, captchaToken: "XXXX.DUMMY.TOKEN.XXXX" },
  });
  expect(signUp.status()).toBe(204);
  const token = new URLSearchParams((await mailedLink(email)).split("#")[1]).get("token");
  expect((await page.request.post("/api/auth/verify-email", { data: { token } })).status()).toBe(
    204,
  );
  expect((await page.request.post("/api/auth/login", { data: { email, password } })).status()).toBe(
    200,
  );

  // A new unique puzzle every time, so a retry or a repeat isn't answered "Already published".
  const { clues } = serializePuzzle(
    generate({ width: 5, height: 5, seed: crypto.randomUUID() }).puzzle,
  );
  await page.addInitScript(
    (text) => {
      localStorage.setItem("loophole:editor-draft", text);
    },
    JSON.stringify({ v: 1, width: 5, height: 5, clues }),
  );
  await page.goto("/create");
  await expect(page.getByText("Exactly one answer")).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published", { exact: true })).toBeVisible({ timeout: 30_000 });

  const link = await page.getByLabel("Link to share").inputValue();
  expect(link).toMatch(new RegExp(`^http://localhost:${E2E_AUTH_PORT}/play/[0-9a-f-]{36}$`));
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Player-made · 5×5" })).toBeVisible();
  await expect(page.getByRole("application")).toBeVisible();

  await page.goto("/account");
  await expect(page.getByText("Published · Play")).toBeVisible();
});
