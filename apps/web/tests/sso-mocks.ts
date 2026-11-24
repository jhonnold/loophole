import type { Schemas } from "@loophole/api-client";
import type { Page } from "@playwright/test";

/** An account made through single sign-on: no password. */
export const SSO_USER: Schemas["User"] = {
  id: "u1",
  email: "ann@example.com",
  emailVerified: true,
  hasPassword: false,
  isAdmin: false,
  createdAt: "2026-11-24T12:00:00.000Z",
};

/** Stand-ins for an API with single sign-on set up; `user` is who is logged in (default: no one). */
export async function mockSsoApi(page: Page, user: Schemas["User"] | null = null) {
  await page.route("**/api/auth/config", (route) =>
    route.fulfill({
      json: { turnstileSiteKey: "1x00000000000000000000AA", oidc: { name: "Authelia" } },
    }),
  );
  await page.route("**/api/session", (route) => route.fulfill({ json: { user } }));
}
