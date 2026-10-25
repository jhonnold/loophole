import { describe, expect, test } from "bun:test";
import { createApiClient } from "@loophole/api-client";
import { createHealth, elapsedText, failureText, queueText, stockText } from "./health.ts";

const REPORT = {
  database: { ok: true, ms: 1, error: null },
  blobs: { ok: false, ms: 2000, error: "No answer within 2000 ms" },
  jobs: { queued: 2, running: 1, oldestQueuedAt: "2026-10-25T11:58:00.000Z" },
  dailies: [{ size: 7, days: 3 }],
  failures: [],
  versions: { app: "abc123", generator: "1", runtime: "bun 1.3.13" },
  startedAt: "2026-10-25T10:00:00.000Z",
};

function clientAnswering(status: number, body: unknown) {
  const fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof globalThis.fetch;
  return createApiClient({ baseUrl: "http://api.test", fetch });
}

describe("admin health", () => {
  test("reads the report, or null when the server refuses", async () => {
    expect(await createHealth(clientAnswering(200, REPORT)).read()).toEqual(REPORT);
    expect(
      await createHealth(clientAnswering(403, { title: "Admins only", status: 403 })).read(),
    ).toBeNull();
  });

  test("writes ages and the daily stock in words", () => {
    const now = Date.parse("2026-10-25T12:00:00.000Z");
    expect(elapsedText("2026-10-25T11:59:48.000Z", now)).toBe("12s");
    expect(elapsedText("2026-10-25T11:55:55.000Z", now)).toBe("4m 05s");
    expect(elapsedText("2026-10-25T08:40:00.000Z", now)).toBe("3h 20m");
    expect(elapsedText("2026-10-23T08:00:00.000Z", now)).toBe("2d 4h");
    expect(queueText(REPORT.jobs, now)).toBe("2 waiting (oldest 2m 00s), 1 running");
    expect(queueText({ queued: 0, running: 0, oldestQueuedAt: null }, now)).toBe(
      "0 waiting, 0 running",
    );
    const failed = {
      id: "j1",
      kind: "verify" as const,
      status: "timeout" as const,
      error: "Stopped after the 45 s time limit.",
      finishedAt: "2026-10-25T11:50:00.000Z",
    };
    expect(failureText(failed, now)).toBe("verify · timeout · 10m 00s ago");
    expect(failureText({ ...failed, finishedAt: null }, now)).toBe("verify · timeout");
    expect(stockText(0)).toBe("today's is missing");
    expect(stockText(1)).toBe("today only");
    expect(stockText(3)).toBe("3 days ahead");
  });
});
