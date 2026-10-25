import { expect, test } from "bun:test";
import { FakeClock } from "../test-support/fakes.ts";
import { MemoryRateLimiter } from "./rate-limiter.ts";

const RULE = { limit: 3, windowMs: 1000 };

test("allows `limit` hits per window, then says how long to wait", () => {
  const clock = new FakeClock(0);
  const limiter = new MemoryRateLimiter(clock);
  for (let i = 0; i < 3; i++) expect(limiter.hit("k", RULE)).toEqual({ allowed: true });
  clock.advance(400);
  expect(limiter.hit("k", RULE)).toEqual({ allowed: false, retryAfterMs: 600 });
  clock.advance(600);
  expect(limiter.hit("k", RULE)).toEqual({ allowed: true });
});

test("counts each key on its own", () => {
  const limiter = new MemoryRateLimiter(new FakeClock(0));
  for (let i = 0; i < 3; i++) limiter.hit("a", RULE);
  expect(limiter.hit("a", RULE).allowed).toBe(false);
  expect(limiter.hit("b", RULE).allowed).toBe(true);
});

test("drops ended windows once it holds many keys, at most once a minute", () => {
  const clock = new FakeClock(0);
  const limiter = new MemoryRateLimiter(clock);
  for (let i = 0; i < 10_000; i++) limiter.hit(`k${i}`, RULE);
  clock.advance(1000);
  limiter.hit("a", RULE); // all 10,000 windows have ended: pruned
  expect(limiter.size).toBe(1);
  for (let i = 0; i < 10_000; i++) limiter.hit(`m${i}`, RULE);
  clock.advance(1000);
  limiter.hit("b", RULE); // less than a minute since the last prune: no scan
  expect(limiter.size).toBe(10_002);
  clock.advance(60_000);
  limiter.hit("c", RULE);
  expect(limiter.size).toBe(1);
});
