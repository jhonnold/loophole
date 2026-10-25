import { describe, expect, test } from "bun:test";
import { createApiClient } from "@loophole/api-client";
import { createReports } from "./reports.ts";

function clientFor(answers: [number, unknown][]) {
  const requests: string[] = [];
  const fetch = (async (input: Request) => {
    const body = input.method === "POST" && input.body ? await input.text() : "";
    requests.push(`${input.method} ${new URL(input.url).pathname} ${body}`.trim());
    const [status, answer] = answers.shift() ?? [500, { title: "No answer" }];
    return new Response(status === 204 ? null : JSON.stringify(answer), {
      status,
      headers: { "Content-Type": status < 400 ? "application/json" : "application/problem+json" },
    });
  }) as typeof globalThis.fetch;
  return { client: createApiClient({ baseUrl: "http://api.test", fetch }), requests };
}

describe("reports client", () => {
  test("report, unpublish and dismiss call their routes", async () => {
    const { client, requests } = clientFor([
      [204, null],
      [204, null],
      [204, null],
    ]);
    const reports = createReports(client);
    expect(await reports.report("p1", "rude")).toEqual({ ok: true });
    expect(await reports.unpublish("p1")).toEqual({ ok: true });
    expect(await reports.dismiss("p1")).toEqual({ ok: true });
    expect(requests).toEqual([
      'POST /api/puzzles/p1/report {"reason":"rude"}',
      "POST /api/admin/puzzles/p1/unpublish",
      "DELETE /api/admin/puzzles/p1/reports",
    ]);
  });

  test("a failure carries a message, and the list is null for non-admins", async () => {
    const { client } = clientFor([
      [401, { title: "Not logged in", status: 401 }],
      [403, { title: "Admins only", status: 403 }],
    ]);
    const reports = createReports(client);
    expect(await reports.report("p1", "x")).toEqual({ ok: false, message: "Not logged in" });
    expect(await reports.list()).toBeNull();
  });
});
