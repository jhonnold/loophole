import { describe, expect, test } from "bun:test";
import { formatLine, installJsonLogging, redact } from "./logging.ts";

describe("redact", () => {
  test("masks emails, tokens, secrets and bearer credentials", () => {
    expect(redact("No account with the email Ann.Lee+x@example.co.uk.")).toBe(
      "No account with the email [email].",
    );
    expect(redact("GET /verify-email#token=abc123 and ?token=xyz")).toBe(
      "GET /verify-email#token=[redacted] and ?token=[redacted]",
    );
    expect(redact('{"password":"hunter22","secret": "s3"}')).toBe(
      '{"password":"[redacted]","secret": "[redacted]"}',
    );
    expect(redact("Authorization: Bearer loophole-dev-metrics-token")).toBe(
      "Authorization: [redacted] [redacted]",
    );
    expect(
      redact("cookie __Host-loophole_session=k3Jd9_aZq0vLmN8xYtR2sW4uB6cE1fG7hI5jK0lM9nO"),
    ).toBe("cookie __Host-loophole_session=[redacted]");
  });

  test("masks tokens that hold dashes, bare or as a cookie value", () => {
    const token = "k3Jd9_aZq0vLm-8xYtR2sW4uB6cE1fG7hI5jK0lM9nO";
    expect(token).toHaveLength(43);
    expect(redact(`session ${token} ended`)).toBe("session [redacted] ended");
    expect(redact(`cookie __Host-loophole_session=${token}`)).toBe(
      "cookie __Host-loophole_session=[redacted]",
    );
  });

  test("keeps job ids, puzzle ids and ordinary words", () => {
    const text =
      "Job 6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b was taken back; result not recorded (apps/server/src/managers/job-run-manager.ts)";
    expect(redact(text)).toBe(text);
    // A dependency's stack frame: package@version is not an email.
    const frame = "at node_modules/.bun/@hono+zod-openapi@1.1.0+0123/src/app.js";
    expect(redact(frame)).toBe(frame);
  });
});

describe("formatLine", () => {
  test("writes one JSON object with the request id, fields and a cleaned error", () => {
    const err = new Error("SMTP refused ann@example.com");
    const line = JSON.parse(
      formatLine(
        "error",
        [
          "Sending mail failed:",
          err,
          { to: "ann@example.com", password: "hunter22", route: "/api/auth/signup" },
        ],
        "api",
        { requestId: "r1" },
        new Date(0),
      ),
    );
    expect(line).toMatchObject({
      time: "1970-01-01T00:00:00.000Z",
      level: "error",
      process: "api",
      msg: "Sending mail failed:",
      requestId: "r1",
      to: "[email]",
      password: "[redacted]",
      route: "/api/auth/signup",
      err: { name: "Error", message: "SMTP refused [email]" },
    });
    expect(JSON.stringify(line)).not.toContain("ann@example.com");
  });
});

test("installJsonLogging sends every console call through the writer", () => {
  const saved = { ...console };
  const lines: string[] = [];
  try {
    installJsonLogging({
      process: "worker",
      context: () => ({ requestId: "r9" }),
      write: (level, line) => lines.push(`${level} ${line}`),
    });
    console.log("Queued", 4, "daily puzzle generation(s)");
    console.warn("password=hunter22");
  } finally {
    Object.assign(console, saved);
  }
  expect(lines).toHaveLength(2);
  expect(lines[0]).toStartWith("info ");
  expect(JSON.parse(lines[0].slice(5))).toMatchObject({
    msg: "Queued 4 daily puzzle generation(s)",
    process: "worker",
    requestId: "r9",
  });
  expect(JSON.parse(lines[1].slice(5)).msg).toBe("password=[redacted]");
});
