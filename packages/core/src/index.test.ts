import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { add } from "./index.ts";

describe("add", () => {
  test("adds two numbers", () => {
    expect(add(2, 3)).toBe(5);
  });

  test("is commutative", () => {
    fc.assert(fc.property(fc.integer(), fc.integer(), (a, b) => add(a, b) === add(b, a)));
  });
});
