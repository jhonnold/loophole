/**
 * SHA-256 of a random token, as hex. Session and email tokens are stored only as this hash, so a
 * leaked database can't be used to log in or reset passwords. A fast hash is enough because the
 * tokens are 256-bit random values, not passwords.
 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
