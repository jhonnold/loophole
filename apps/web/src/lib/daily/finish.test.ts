import { describe, expect, test } from "bun:test";
import { memoryStorage } from "../test-support/memory-storage.ts";
import type { Attempt, Result } from "./api.ts";
import { createFinisher, FINISH_RETRY_MS } from "./finish.ts";

const ATTEMPT: Attempt = {
  puzzleId: "d1",
  day: "2026-10-25",
  area: 49,
  level: 1,
  status: "finished",
  startedAt: "2026-10-25T10:00:00.000Z",
  finishedAt: "2026-10-25T10:03:18.000Z",
  elapsedMs: 198_000,
  assisted: false,
  ranked: true,
  rank: 214,
};

const SOLVE = { edges: "1122", elapsedMs: 198_000 };
const KEY = "loophole:user:u1:ranked:d1";

/** A finisher whose server answers from `answers` in turn, with waits that return at once. */
function setup(answers: Result<Attempt>[]) {
  const storage = memoryStorage();
  const sent: { puzzleId: string; edges: string; elapsedMs: number }[] = [];
  const waits: number[] = [];
  const finisher = createFinisher({
    storage,
    userId: "u1",
    finish: async (puzzleId, edges, elapsedMs) => {
      sent.push({ puzzleId, edges, elapsedMs });
      const answer = answers.shift();
      if (answer === undefined) throw new Error("no answer left");
      return answer;
    },
    wait: async (ms) => {
      waits.push(ms);
    },
  });
  return { storage, sent, waits, finisher };
}

const offline: Result<Attempt> = { ok: false, status: 0, message: "offline" };

describe("ranked finish (FR-17)", () => {
  test("sends the solve and forgets it once the server has it", async () => {
    const { storage, sent, finisher } = setup([{ ok: true, value: ATTEMPT }]);
    const outcome = await finisher.send("d1", SOLVE, new AbortController().signal);
    expect(outcome).toEqual({ kind: "done", attempt: ATTEMPT });
    expect(sent).toEqual([{ puzzleId: "d1", ...SOLVE }]);
    expect(storage.getItem(KEY)).toBeNull();
  });

  test("retries network failures, rate limits and server errors with backoff, same solve each time", async () => {
    const { sent, waits, finisher } = setup([
      offline,
      { ok: false, status: 503, message: "down" },
      { ok: false, status: 429, message: "slow down" },
      offline,
      offline,
      { ok: true, value: ATTEMPT },
    ]);
    const retries: string[] = [];
    const outcome = await finisher.send("d1", SOLVE, new AbortController().signal, (m) =>
      retries.push(m),
    );
    expect(outcome.kind).toBe("done");
    expect(sent.every((s) => s.elapsedMs === SOLVE.elapsedMs)).toBe(true);
    expect(waits).toEqual([...FINISH_RETRY_MS, FINISH_RETRY_MS[3]]);
    expect(retries).toEqual(["offline", "down", "slow down", "offline", "offline"]);
  });

  test("a solve stays on the device until sent, and the first solve's time counts", async () => {
    const controller = new AbortController();
    const { storage, finisher } = setup([offline]);
    const stopped = finisher.send("d1", SOLVE, controller.signal, () => controller.abort());
    expect(await stopped).toEqual({ kind: "stopped" });
    expect(JSON.parse(storage.getItem(KEY) ?? "")).toEqual(SOLVE);
    expect(finisher.pending("d1")).toEqual(SOLVE);

    // Back on the page later: the stored solve goes out, not a later reading of the clock.
    const later = setup([{ ok: true, value: ATTEMPT }]);
    later.storage.setItem(KEY, JSON.stringify(SOLVE));
    const again = new AbortController().signal;
    await later.finisher.send("d1", { edges: "1122", elapsedMs: 999_999 }, again);
    expect(later.sent[0]?.elapsedMs).toBe(SOLVE.elapsedMs);
  });

  test("a lost login stops and keeps the solve; a refusal drops it", async () => {
    const lost = setup([{ ok: false, status: 401, message: "Not logged in" }]);
    expect(await lost.finisher.send("d1", SOLVE, new AbortController().signal)).toEqual({
      kind: "failed",
      message: "Not logged in",
    });
    expect(lost.finisher.pending("d1")).toEqual(SOLVE);

    const refused = setup([{ ok: false, status: 400, message: "That board is not the solution." }]);
    const outcome = await refused.finisher.send("d1", SOLVE, new AbortController().signal);
    expect(outcome.kind).toBe("failed");
    expect(refused.finisher.pending("d1")).toBeNull();
  });

  test("forget drops a kept solve the server already has", () => {
    const { storage, finisher } = setup([]);
    storage.setItem(KEY, JSON.stringify(SOLVE));
    finisher.forget("d1");
    expect(finisher.pending("d1")).toBeNull();
    expect(storage.getItem(KEY)).toBeNull();
  });

  test("with nothing pending and no solve, there is nothing to send", async () => {
    const { sent, finisher } = setup([]);
    expect(await finisher.send("d1", null, new AbortController().signal)).toEqual({
      kind: "stopped",
    });
    expect(sent).toEqual([]);
  });
});
