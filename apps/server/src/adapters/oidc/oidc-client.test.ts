import { afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from "bun:test";
import { OidcClient } from "./oidc-client.ts";

const ISSUER = "https://idp.test";
const SETTINGS = {
  issuer: ISSUER,
  clientId: "loophole",
  clientSecret: "s3cret",
  redirectUri: "https://loophole.test/api/auth/oidc/callback",
};

const b64url = (s: string) => Buffer.from(s).toString("base64url");

async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return Buffer.from(digest).toString("base64url");
}

/**
 * Just enough of an OpenID Connect provider: discovery, a token endpoint that checks the client's
 * secret and the PKCE verifier, and userinfo. `idToken` and `userinfo` can be bent per test.
 */
function fakeProvider() {
  const codes = new Map<string, { nonce: string; challenge: string }>();
  const p = {
    up: true,
    tokenRequests: [] as URLSearchParams[],
    idToken: (claims: Record<string, unknown>) => claims,
    userinfo: { sub: "sub-ann", email: "ann@example.com", email_verified: true } as Record<
      string,
      unknown
    >,
    /** What the provider does after the player logs in: a code for this authorization request. */
    authorize(url: string): URLSearchParams {
      const q = new URL(url).searchParams;
      const code = `code-${codes.size + 1}`;
      codes.set(code, { nonce: q.get("nonce") ?? "", challenge: q.get("code_challenge") ?? "" });
      return new URLSearchParams({ code, state: q.get("state") ?? "", iss: ISSUER });
    },
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(req.url);
      if (!p.up) throw new TypeError("connection refused");
      if (url.pathname === "/.well-known/openid-configuration") {
        return Response.json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/authorize`,
          token_endpoint: `${ISSUER}/token`,
          userinfo_endpoint: `${ISSUER}/userinfo`,
          id_token_signing_alg_values_supported: ["RS256"],
        });
      }
      if (url.pathname === "/token") {
        const body = new URLSearchParams(await req.text());
        p.tokenRequests.push(body);
        const grant = codes.get(body.get("code") ?? "");
        const basic = `Basic ${btoa("loophole:s3cret")}`;
        if (
          req.headers.get("Authorization") !== basic ||
          grant === undefined ||
          (await challengeOf(body.get("code_verifier") ?? "")) !== grant.challenge
        ) {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
        const now = Math.floor(Date.now() / 1000);
        const claims = p.idToken({
          iss: ISSUER,
          sub: "sub-ann",
          aud: "loophole",
          iat: now,
          exp: now + 300,
          nonce: grant.nonce,
        });
        const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
        return Response.json({
          access_token: "access-1",
          token_type: "Bearer",
          expires_in: 300,
          id_token: `${header}.${b64url(JSON.stringify(claims))}.${b64url("signature")}`,
        });
      }
      if (url.pathname === "/userinfo" && req.headers.get("Authorization") === "Bearer access-1") {
        return Response.json(p.userinfo);
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch,
  };
  return p;
}

async function login(client: OidcClient, provider: ReturnType<typeof fakeProvider>) {
  const started = await client.begin();
  if (started === null) throw new Error("begin failed");
  return client.finish(provider.authorize(started.url), started.pending);
}

describe("OidcClient", () => {
  // Refused logins are logged; keep the test output quiet and check they were.
  let log: Mock<typeof console.error>;
  beforeEach(() => {
    log = spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => log.mockRestore());

  test("sends the player to the provider with state, nonce and an S256 challenge", async () => {
    const provider = fakeProvider();
    const started = await new OidcClient(SETTINGS, { fetch: provider.fetch }).begin();
    if (started === null) throw new Error("begin failed");
    const url = new URL(started.url);
    expect(url.origin + url.pathname).toBe(`${ISSUER}/authorize`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "loophole",
      redirect_uri: SETTINGS.redirectUri,
      scope: "openid email profile",
      state: started.pending.state,
      nonce: started.pending.nonce,
      code_challenge: await challengeOf(started.pending.codeVerifier),
      code_challenge_method: "S256",
    });
  });

  test("a full login gives the provider's identity and email", async () => {
    const provider = fakeProvider();
    const client = new OidcClient(SETTINGS, { fetch: provider.fetch });
    expect(await login(client, provider)).toEqual({
      issuer: ISSUER,
      subject: "sub-ann",
      email: "ann@example.com",
      emailVerified: true,
    });
    expect(provider.tokenRequests[0].get("redirect_uri")).toBe(SETTINGS.redirectUri);
    expect(log).not.toHaveBeenCalled();
  });

  test("an email the provider hasn't verified, or none, is passed on as such", async () => {
    const provider = fakeProvider();
    const client = new OidcClient(SETTINGS, { fetch: provider.fetch });
    provider.userinfo = { sub: "sub-ann", email: "ann@example.com" };
    expect(await login(client, provider)).toMatchObject({ emailVerified: false });
    provider.userinfo = { sub: "sub-ann" };
    expect(await login(client, provider)).toMatchObject({ email: null });
  });

  test("refuses an ID token with another nonce, issuer or audience, or that has expired", async () => {
    for (const bend of [
      { nonce: "replayed" },
      { iss: "https://evil.test" },
      { aud: "someone-else" },
      { exp: Math.floor(Date.now() / 1000) - 3600 },
    ]) {
      const provider = fakeProvider();
      provider.idToken = (claims) => ({ ...claims, ...bend });
      expect(await login(new OidcClient(SETTINGS, { fetch: provider.fetch }), provider)).toBeNull();
    }
  });

  test("refuses a callback with another state, an error, or userinfo for someone else", async () => {
    const provider = fakeProvider();
    const client = new OidcClient(SETTINGS, { fetch: provider.fetch });
    const started = await client.begin();
    if (started === null) throw new Error("begin failed");
    const answer = provider.authorize(started.url);
    answer.set("state", "forged");
    expect(await client.finish(answer, started.pending)).toBeNull();
    const denied = new URLSearchParams({ error: "access_denied", state: started.pending.state });
    expect(await client.finish(denied, started.pending)).toBeNull();
    provider.userinfo = { sub: "sub-bob", email: "bob@example.com", email_verified: true };
    expect(await login(client, provider)).toBeNull();
  });

  test("a wrong client secret fails the login", async () => {
    const provider = fakeProvider();
    const client = new OidcClient(
      { ...SETTINGS, clientSecret: "wrong" },
      { fetch: provider.fetch },
    );
    expect(await login(client, provider)).toBeNull();
  });

  test("can't start while the provider is down, and tries discovery again later", async () => {
    const provider = fakeProvider();
    const client = new OidcClient(SETTINGS, { fetch: provider.fetch });
    provider.up = false;
    expect(await client.begin()).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    provider.up = true;
    expect(await client.begin()).not.toBeNull();
  });
});
