# WT22 `oidc-sso` — implementation plan

Branch `feat/oidc-sso`, worktree `/home/jhonnold/projects/loophole-wt/oidc-sso` (main `e2c668e`). PRD: FR-30 (new: optional single sign-on), FR-18 to FR-20 (password accounts unchanged), NFR-4 (CSRF, secure cookies, rate limits), NFR-6 (what is stored; account deletion). Prompted by the homelab deployment, whose plan left "Authelia OIDC inside the app" for later.

## Goal

- **Single sign-on through one OpenID Connect provider**, Authelia in the homelab, as an extra way to log in. It is off unless `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` are all set; `OIDC_NAME` labels the button. Email and password login stay as they are.
- **Accounts**: an identity (issuer, `sub`) is tied to one account. The first login logs in to the account with the provider-verified email (and confirms it), or makes a new confirmed account without a password and without a CAPTCHA. An unverified email that an account already has is refused.
- **Accounts without a password**: deleted by typing their email; a password reset gives them a password.
- **Web**: "Continue with <name>" on the login and sign-up pages, a message for each failure on the login page, and the email confirmation on the account page.
- **Contract**: `GET /api/auth/oidc/start`, `GET /api/auth/oidc/callback`, `AuthConfig.oidc`, `User.hasPassword`, and `DeleteAccountRequest` as a password or an email. `openapi.yaml` and the client are regenerated.

## Out of scope

- Several providers at once.
- Linking or unlinking a provider from the account page.
- Mapping provider groups to `is_admin` (admins stay `bun run admin`).
- Logging out at the provider (RP-initiated logout).
- A return path after login: a login always lands on `/`, like the password login.
- An end-to-end test against a real provider: it is covered by the adapter tests against a fake provider, plus the manual check after deploying.

## Design

### Packages (checked with `npm view` on 2026-11-24)

| Package | Version | Where | Why this one |
|---|---|---|---|
| `oauth4webapi` | 3.8.8 | server | No dependencies, MIT, takes an injectable `fetch`. Published 2026-09-05; 3.8.9 (2026-11-20) is under two weeks old. |

### Flow

1. `GET /api/auth/oidc/start`:
   - The provider adapter (discovery cached once it works) makes state, nonce and a PKCE verifier.
   - The route puts them in `__Host-loophole_oidc` (HttpOnly, Secure, SameSite=Lax, 600 s) and answers 302 to the provider's authorization endpoint with `response_type=code`, `scope=openid email profile` and `code_challenge_method=S256`.
   - When the provider is unreachable, it answers 302 to `/login#oidc_error=unavailable`.
2. The player logs in at Authelia, which sends the browser to `<PUBLIC_URL>/api/auth/oidc/callback?code&state&iss`. That is a GET, so the CSRF middleware lets it through.
3. The callback deletes the cookie and refuses without it. The adapter then does the following, and any failure makes it return null:
   - checks state and `iss`;
   - swaps the code with `client_secret_basic` and the verifier;
   - checks the ID token's iss, aud, exp and nonce;
   - reads userinfo, whose `sub` must match.
4. `OidcLoginManager` picks the account: tied identity, else verified email, else a new account. It then ends the old session and starts a new one. The route sets the session cookie and answers 302 to `/`; a failure answers 302 to `/login#oidc_error=<failed|no-email|email-unverified>`.

### Data

- Migration `009_identities.sql` adds the table `identities(issuer, subject, user_id → users ON DELETE CASCADE, created_at, PK(issuer, subject))` and `users.has_password INTEGER NOT NULL DEFAULT 1 CHECK (0, 1)`.
- `users` is not rebuilt. Migrations run in a transaction where `foreign_keys = OFF` has no effect, so dropping `users` would cascade-delete every child row.
- An account without a password stores the argon2id hash of a random token.

### Files

```
apps/server/src/
  adapters/oidc/oidc-client.ts (+ test)       oauth4webapi; fake provider behind a fake fetch in the test
  adapters/db/identity-repository.ts (+ test)
  adapters/db/migrations/009_identities.sql   (+ migrations.test.ts "009")
  managers/oidc-login-manager.ts (+ test)
  managers/account-manager.ts                 deleteAccount(userId, {password} | {email})
  managers/errors.ts                          OidcLoginError(reason)
  api/oidc.ts                                 start + callback routes, pending-login cookie
  api/accounts.ts, account-schemas.ts         AuthConfig.oidc, User.hasPassword, DeleteAccountRequest; limitByAddress
  api/app.ts, main.ts, spec.ts                wiring (spec registers a stub provider so the routes are documented)
  config.ts (+ test)                          OIDC_* (all or none; "" is unset; https off localhost)
  ports.ts, domain.ts, test-support/*         OidcProvider, IdentityRepository, AuthFailure "oidc"; fakes
apps/web/src/
  lib/auth/auth.ts (+ test)                   oidcName(), oidcErrorFromHash(), OIDC_START, deleteAccount(confirmation)
  lib/components/SsoButton.svelte             plain link with data-sveltekit-reload
  routes/login, routes/signup, routes/account, app.css
apps/web/tests/sso.e2e.ts, sso-mocks.ts, a11y.e2e.ts (two screens)
```

### Security notes

- **Login CSRF:** refused when the pending cookie is missing or the state doesn't match. The `__Host-` prefix stops sibling subdomains from planting the cookie.
- **Open redirect:** not possible, because there is no return-path parameter.
- **Rate limit:** start and callback share 20 per 15 minutes per address. Each refusal counts as `loophole_auth_failures_total{reason="oidc"}`.
- **Same site:** a provider on the same registrable domain as the site is same-site, so it must answer in `query` mode, not with `form_post` (a same-site POST, which the CSRF check refuses).
- **Fail closed:** the adapter logs the error and returns null. Errors and the access log never hold the code, tokens or the client secret.

## Deployment

The homelab's side (the Authelia client, the stack's settings and the image tag) is a separate change in the homelab repository. The provider's client needs:
- the redirect URI `<PUBLIC_URL>/api/auth/oidc/callback`, exactly;
- confidential, `client_secret_basic`, PKCE required with S256;
- the scopes `openid`, `email` and `profile`;
- an unsigned (JSON) userinfo response.

The API reaches the provider's issuer URL over HTTPS with a publicly trusted certificate.

## Validated (this machine, Bun 1.3.13)

| State | `bun run check` |
|---|---|
| main `e2c668e` | 887 pass, 3 skip |
| this branch | 923 pass, 3 skip, green |

- `E2E_PORT=4183 bun run test:e2e`: 155 passed (main's 142, plus `sso.e2e.ts` with 5 tests and 8 new a11y cases: 2 screens × 2 themes × 2 viewports).
- `E2E_AUTH_PORT=4194 bun run test:e2e:auth`: 5 passed; `bun run test:e2e:stories`: 6 passed (Garage and Mailpit up, the real API with the new `User` and `DeleteAccountRequest`).
- The adapter's discovery and authorization URL work against the real Authelia's discovery document, which lists `email_verified`, the `iss` response parameter, S256 and `client_secret_basic`.
- `oidc-client.test.ts` runs the real oauth4webapi against the fake provider: the happy path, a bad nonce, issuer, audience or expiry, a forged state, `error=access_denied`, userinfo for another `sub`, a wrong client secret, and discovery retried after an outage.
- Not validated here: a full login against the real provider (token and userinfo). Check after deploying (acceptance criterion 7).

## Acceptance criteria

| # | Criterion | How it's checked |
|---|---|---|
| 1 | Without `OIDC_*`, nothing changes: no button, routes 404, `AuthConfig.oidc` null | route test; `sso.e2e.ts` |
| 2 | Partial `OIDC_*` refuses to start; empty values count as unset; an http issuer is refused off localhost | `config.test.ts` |
| 3 | A login makes, links or finds the right account per the rules above | `oidc-login-manager.test.ts` |
| 4 | Login CSRF, forged state and a missing cookie are refused; the cookie's attributes are right | `accounts.test.ts` "single sign-on" |
| 5 | The ID token and userinfo checks fail closed | `oidc-client.test.ts` |
| 6 | Deleting an account without a password works by email; a reset gives it a password | manager, route and e2e tests |
| 7 | Real login on the deployed site: the callback answers 302 to `/` with a session cookie, the account page shows the user, and Authelia's log has no `Access Request failed` at `/api/oidc/token` | by hand after the deploy |

## Unresolved questions

- Map an Authelia group to `is_admin`? Default: no.
- Log out at Authelia too? Default: no, local logout only.
