import type { Context } from "hono";

/** What `Bun.serve` passes to `fetch` as the second argument, which Hono exposes as `c.env`. */
interface BunServer {
  requestIP?(request: Request): { address: string } | null;
}

/**
 * The client's IP address, for rate limits: the socket's peer address, or behind a trusted
 * reverse proxy the last X-Forwarded-For entry (the one that proxy added). "unknown" when there
 * is neither, as in tests through `app.request`.
 */
export function clientAddress(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const last = c.req.header("X-Forwarded-For")?.split(",").at(-1)?.trim();
    if (last) return last;
  }
  const server = c.env as BunServer | undefined;
  return server?.requestIP?.(c.req.raw)?.address ?? "unknown";
}

/**
 * The part of an address that rate limits count by: an IPv4 address as is (also when written as
 * IPv4-mapped IPv6), an IPv6 address by its /64 prefix, since one client usually holds a whole /64
 * and could otherwise rotate through fresh addresses.
 */
export function rateLimitKey(address: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped) return mapped[1];
  if (!address.includes(":")) return address;
  const halves = address.toLowerCase().split("%")[0].split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(":") : [];
  const gap = halves.length > 1 ? Math.max(0, 8 - left.length - right.length) : 0;
  const groups = [...left, ...Array<string>(gap).fill("0"), ...right];
  const prefix = groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, ""));
  return `${prefix.join(":")}::/64`;
}
