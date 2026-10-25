import { describe, expect, test } from "bun:test";
import { createPuzzle, serializePuzzle } from "@loophole/core";
import { runTask } from "./run-task.ts";

describe("runTask", () => {
  test("generate is deterministic per seed and reports rising progress below 1", () => {
    const task = { kind: "generate", input: { width: 8, height: 6, seed: "run-task" } } as const;
    const seen: number[] = [];
    const a = runTask(task, (p) => seen.push(p));
    const b = runTask(task, () => {});
    expect(a).toEqual(b);
    if (a.kind !== "generate") throw new Error("expected generate output");
    expect(a.generated.puzzle).toMatchObject({ v: 1, width: 8, height: 6, seed: "run-task" });
    expect(a.generated.solution).toMatch(/^[12]+$/);
    expect(a.generated.steps.length).toBeGreaterThan(0);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.length).toBeLessThanOrEqual(90);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
    expect(seen.at(-1)).toBeLessThanOrEqual(0.9);
  });

  test("verify reports unique with the solution, and multiple", () => {
    const unique = serializePuzzle(createPuzzle(2, 2, [2, 2, 2, 2]));
    expect(runTask({ kind: "verify", input: { puzzle: unique } }, () => {})).toEqual({
      kind: "verify",
      verified: {
        status: "unique",
        solutions: ["112211121121"],
        steps: expect.arrayContaining([expect.objectContaining({ rule: expect.any(String) })]),
      },
    });
    const open = serializePuzzle(createPuzzle(2, 2));
    const out = runTask({ kind: "verify", input: { puzzle: open } }, () => {});
    expect(out.kind === "verify" && out.verified.status).toBe("multiple");
    expect(out.kind === "verify" && out.verified.steps).toEqual([]);
  });

  test("bad input throws the core's error", () => {
    expect(() =>
      runTask({ kind: "generate", input: { width: 0, height: 5, seed: "s" } }, () => {}),
    ).toThrow(RangeError);
  });
});
