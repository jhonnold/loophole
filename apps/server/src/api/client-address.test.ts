import { expect, test } from "bun:test";
import { rateLimitKey } from "./client-address.ts";

test("IPv4 addresses are counted one by one", () => {
  expect(rateLimitKey("198.51.100.7")).toBe("198.51.100.7");
  expect(rateLimitKey("::ffff:198.51.100.7")).toBe("198.51.100.7");
  expect(rateLimitKey("unknown")).toBe("unknown");
});

test("IPv6 addresses are counted by their /64", () => {
  expect(rateLimitKey("2001:db8:abcd:12:1:2:3:4")).toBe("2001:db8:abcd:12::/64");
  expect(rateLimitKey("2001:0DB8:ABCD:0012:ffff::1")).toBe("2001:db8:abcd:12::/64");
  expect(rateLimitKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
  expect(rateLimitKey("::1")).toBe("0:0:0:0::/64");
  expect(rateLimitKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
});
