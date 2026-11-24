import * as oauth from "oauth4webapi";
import type { OidcIdentity, OidcPending, OidcProvider } from "../../ports.ts";

export interface OidcSettings {
  /** The provider's issuer URL; discovery reads `<issuer>/.well-known/openid-configuration`. */
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** Where the provider sends the browser back: `<PUBLIC_URL>/api/auth/oidc/callback`. */
  readonly redirectUri: string;
}

export interface OidcClientOptions {
  /** Default the global `fetch`. Tests pass their own. */
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

const SCOPE = "openid email profile";

/**
 * Logs players in through an OpenID Connect provider with oauth4webapi: the authorization code
 * flow with PKCE (S256), `client_secret_basic` at the token endpoint, and the ID token's issuer,
 * audience, expiry and nonce checked. The email comes from the userinfo endpoint, so the provider
 * needn't put it in the ID token. Fails closed: any error is logged and the login refused.
 */
export class OidcClient implements OidcProvider {
  readonly #settings: OidcSettings;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #client: oauth.Client;
  readonly #auth: oauth.ClientAuth;
  /** Discovery runs on first use and is kept once it succeeds, so the API starts while the provider is down. */
  #server: Promise<oauth.AuthorizationServer> | null = null;

  constructor(settings: OidcSettings, options: OidcClientOptions = {}) {
    this.#settings = settings;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    this.#client = { client_id: settings.clientId };
    this.#auth = oauth.ClientSecretBasic(settings.clientSecret);
  }

  async begin(): Promise<{ url: string; pending: OidcPending } | null> {
    try {
      const as = await this.#discover();
      if (as.authorization_endpoint === undefined) throw new Error("no authorization_endpoint");
      const pending: OidcPending = {
        state: oauth.generateRandomState(),
        nonce: oauth.generateRandomNonce(),
        codeVerifier: oauth.generateRandomCodeVerifier(),
      };
      const url = new URL(as.authorization_endpoint);
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: this.#settings.clientId,
        redirect_uri: this.#settings.redirectUri,
        scope: SCOPE,
        state: pending.state,
        nonce: pending.nonce,
        code_challenge: await oauth.calculatePKCECodeChallenge(pending.codeVerifier),
        code_challenge_method: "S256",
      }).toString();
      return { url: url.href, pending };
    } catch (err) {
      console.error("OIDC login could not start:", err);
      return null;
    }
  }

  async finish(callback: URLSearchParams, pending: OidcPending): Promise<OidcIdentity | null> {
    try {
      const as = await this.#discover();
      const params = oauth.validateAuthResponse(as, this.#client, callback, pending.state);
      const tokenResponse = await oauth.authorizationCodeGrantRequest(
        as,
        this.#client,
        this.#auth,
        params,
        this.#settings.redirectUri,
        pending.codeVerifier,
        this.#requestOptions(),
      );
      const tokens = await oauth.processAuthorizationCodeResponse(as, this.#client, tokenResponse, {
        expectedNonce: pending.nonce,
        requireIdToken: true,
      });
      const claims = oauth.getValidatedIdTokenClaims(tokens);
      if (claims === undefined) throw new Error("no ID token");
      const info = await oauth.processUserInfoResponse(
        as,
        this.#client,
        claims.sub,
        await oauth.userInfoRequest(as, this.#client, tokens.access_token, this.#requestOptions()),
      );
      return {
        issuer: claims.iss,
        subject: claims.sub,
        email: typeof info.email === "string" && info.email !== "" ? info.email : null,
        emailVerified: info.email_verified === true,
      };
    } catch (err) {
      // A player who cancels at the provider lands here too (error=access_denied).
      console.error("OIDC login failed:", err);
      return null;
    }
  }

  #discover(): Promise<oauth.AuthorizationServer> {
    if (this.#server === null) {
      const issuer = new URL(this.#settings.issuer);
      this.#server = oauth
        .discoveryRequest(issuer, this.#requestOptions())
        .then((res) => oauth.processDiscoveryResponse(issuer, res));
      // Try again next time rather than keep a failure.
      this.#server.catch(() => {
        this.#server = null;
      });
    }
    return this.#server;
  }

  #requestOptions() {
    return { [oauth.customFetch]: this.#fetch, signal: AbortSignal.timeout(this.#timeoutMs) };
  }
}
