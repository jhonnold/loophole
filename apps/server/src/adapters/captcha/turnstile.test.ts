import { describe, expect, spyOn, test } from "bun:test";
import { TURNSTILE_VERIFY_URL, TurnstileVerifier } from "./turnstile.ts";

/** A fetch that answers with `status` and `body` and records what it was sent. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; form: URLSearchParams }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, form: init.body as URLSearchParams });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("TurnstileVerifier", () => {
  test("posts the secret, token and address to siteverify and reads `success`", async () => {
    const { fetch, calls } = fakeFetch(200, { success: true, "error-codes": [] });
    const verifier = new TurnstileVerifier({ secretKey: "secret", fetch });
    expect(await verifier.verify("tok", "203.0.113.5")).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TURNSTILE_VERIFY_URL);
    expect(Object.fromEntries(calls[0].form)).toEqual({
      secret: "secret",
      response: "tok",
      remoteip: "203.0.113.5",
    });
  });

  test("with an expected hostname, refuses a token solved on another site", async () => {
    const ours = fakeFetch(200, { success: true, hostname: "loophole.example" });
    const theirs = fakeFetch(200, { success: true, hostname: "evil.example" });
    const options = { secretKey: "s", expectedHostname: "loophole.example" };
    expect(await new TurnstileVerifier({ ...options, fetch: ours.fetch }).verify("t", null)).toBe(
      true,
    );
    expect(await new TurnstileVerifier({ ...options, fetch: theirs.fetch }).verify("t", null)).toBe(
      false,
    );
  });

  test("leaves out an unknown address", async () => {
    const { fetch, calls } = fakeFetch(200, { success: true });
    await new TurnstileVerifier({ secretKey: "s", fetch }).verify("tok", null);
    expect(calls[0].form.has("remoteip")).toBe(false);
  });

  test("a refused token, an HTTP error or a network failure is false", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    const refused = fakeFetch(200, { success: false, "error-codes": ["invalid-input-response"] });
    expect(
      await new TurnstileVerifier({ secretKey: "s", fetch: refused.fetch }).verify("t", null),
    ).toBe(false);
    const broken = fakeFetch(500, {});
    expect(
      await new TurnstileVerifier({ secretKey: "s", fetch: broken.fetch }).verify("t", null),
    ).toBe(false);
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;
    expect(await new TurnstileVerifier({ secretKey: "s", fetch: offline }).verify("t", null)).toBe(
      false,
    );
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
});
