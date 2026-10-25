/** 32 random bytes (256 bits) as base64url: session and email tokens. */
export function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}
