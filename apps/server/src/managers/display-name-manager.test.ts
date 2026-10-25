import { describe, expect, test } from "bun:test";
import { MemoryRateLimiter } from "../adapters/rate-limiter.ts";
import { FakeClock, FakeDisplayNameRepository } from "../test-support/fakes.ts";
import { DisplayNameManager, NAME_CHANGES_PER_ACCOUNT } from "./display-name-manager.ts";
import { DisplayNameTakenError, InvalidDisplayNameError, RateLimitedError } from "./errors.ts";

function setup() {
  const clock = new FakeClock();
  const names = new FakeDisplayNameRepository();
  const manager = new DisplayNameManager({ names, limiter: new MemoryRateLimiter(clock), clock });
  return { names, manager };
}

describe("DisplayNameManager", () => {
  test("a player has no name until they choose one, and can remove it", () => {
    const { manager } = setup();
    expect(manager.get("u1")).toBeNull();
    expect(manager.set("u1", "kuroneko")).toBe("kuroneko");
    expect(manager.get("u1")).toBe("kuroneko");
    expect(manager.set("u1", null)).toBeNull();
    expect(manager.get("u1")).toBeNull();
  });

  test("refuses reserved names and names another player has", () => {
    const { manager } = setup();
    expect(() => manager.set("u1", "You")).toThrow(InvalidDisplayNameError);
    expect(() => manager.set("u1", "anonymous")).toThrow(InvalidDisplayNameError);
    for (const staff of ["Admin_", "admin1", "Loophole-Team", "the.moderator", "OFFICIAL"]) {
      expect(() => manager.set("u1", staff)).toThrow(InvalidDisplayNameError);
    }
    expect(manager.set("u1", "youngblood")).toBe("youngblood");
    manager.set("u1", "Tsuru");
    expect(() => manager.set("u2", "tsuru")).toThrow(DisplayNameTakenError);
  });

  test("limits how often an account changes its name", () => {
    const { manager } = setup();
    for (let i = 0; i < NAME_CHANGES_PER_ACCOUNT.limit; i++) manager.set("u1", `name-${i}`);
    expect(() => manager.set("u1", "one-more")).toThrow(RateLimitedError);
  });
});
