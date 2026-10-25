import type { CaptchaVerifier } from "../../ports.ts";

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Cloudflare's documented test keys: the site key always passes and the secret accepts it. */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
export const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

export interface TurnstileOptions {
  readonly secretKey: string;
  /** Default the global `fetch`. Tests pass their own. */
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  /**
   * The site's hostname. When set, a token solved on another site is refused. Leave it out with
   * the test secret, which answers for "example.com".
   */
  readonly expectedHostname?: string;
}

/** Checks Turnstile tokens with Cloudflare's siteverify endpoint (PRD FR-19). */
export class TurnstileVerifier implements CaptchaVerifier {
  readonly #secretKey: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #expectedHostname: string | undefined;

  constructor(options: TurnstileOptions) {
    this.#secretKey = options.secretKey;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    this.#expectedHostname = options.expectedHostname;
  }

  async verify(token: string, remoteIp: string | null): Promise<boolean> {
    const body = new URLSearchParams({ secret: this.#secretKey, response: token });
    if (remoteIp !== null) body.set("remoteip", remoteIp);
    try {
      const res = await this.#fetch(TURNSTILE_VERIFY_URL, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (!res.ok) {
        console.error(`Turnstile siteverify answered HTTP ${res.status}`);
        return false;
      }
      const data = (await res.json()) as { success?: unknown; hostname?: unknown };
      if (data.success !== true) return false;
      return this.#expectedHostname === undefined || data.hostname === this.#expectedHostname;
    } catch (err) {
      console.error("Turnstile siteverify failed:", err);
      return false;
    }
  }
}
