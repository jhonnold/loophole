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
      "Authorization: Bearer [redacted]",
    );
    expect(redact("Authorization: Basic dXNlcjpwYXNzd29yZA==")).toBe(
      "Authorization: Basic [redacted]",
    );
    expect(redact("password=\"two words\" and secret='a b'")).toBe(
      "password=\"[redacted]\" and secret='[redacted]'",
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

  test("masks a quoted value with an escaped quote in it, up to its closing quote", () => {
    expect(redact('{"password":"a\\"b c"}')).toBe('{"password":"[redacted]"}');
  });

  test("scans a long run of email-like characters in linear time", () => {
    // Runs broken by `+` or `.` are not tokens, so they are left for the email pattern to scan.
    const started = performance.now();
    const plus = "x+".repeat(50_000);
    expect(redact(plus)).toBe(plus);
    const dotted = "a.".repeat(50_000);
    expect(redact(dotted)).toBe(dotted);
    expect(performance.now() - started).toBeLessThan(200);
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

/** Runs `fn`, then restores the console and removes the error listeners it installed. */
function restoringProcess(fn: () => void): void {
  const saved = { ...console };
  const events = ["uncaughtException", "unhandledRejection"] as const;
  const before = events.map((event) => process.listeners(event));
  try {
    fn();
  } finally {
    Object.assign(console, saved);
    events.forEach((event, i) => {
      for (const listener of process.listeners(event)) {
        if (!before[i].includes(listener)) process.removeListener(event, listener);
      }
    });
  }
}

test("installJsonLogging sends every console call through the writer", () => {
  const lines: string[] = [];
  restoringProcess(() => {
    installJsonLogging({
      process: "worker",
      context: () => ({ requestId: "r9" }),
      write: (level, line) => lines.push(`${level} ${line}`),
      exit: () => {},
    });
    console.log("Queued", 4, "daily puzzle generation(s)");
    console.warn("password=hunter22");
  });
  expect(lines).toHaveLength(2);
  expect(lines[0]).toStartWith("info ");
  expect(JSON.parse(lines[0].slice(5))).toMatchObject({
    msg: "Queued 4 daily puzzle generation(s)",
    process: "worker",
    requestId: "r9",
  });
  expect(JSON.parse(lines[1].slice(5)).msg).toBe("password=[redacted]");
});

test("an uncaught error or unhandled rejection is logged as JSON, then the process exits 1", () => {
  const lines: string[] = [];
  const codes: number[] = [];
  restoringProcess(() => {
    installJsonLogging({
      process: "api",
      write: (level, line) => lines.push(`${level} ${line}`),
      exit: (code) => codes.push(code),
    });
    process.emit(
      "unhandledRejection",
      new Error("SMTP refused ann@example.com"),
      Promise.resolve(),
    );
    process.emit("uncaughtException", new Error("boom token=abc"), "uncaughtException");
  });
  expect(codes).toEqual([1, 1]);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toStartWith("error ");
  expect(JSON.parse(lines[0].slice(6))).toMatchObject({
    msg: "Unhandled rejection:",
    process: "api",
    err: { message: "SMTP refused [email]" },
  });
  expect(lines[1]).not.toContain("abc");
  expect(JSON.parse(lines[1].slice(6)).msg).toBe("Uncaught exception:");
});

test("a fatal line longer than a pipe's buffer arrives whole before the process exits", async () => {
  // A write through process.stderr makes Bun set its pipe non-blocking, as in a running server.
  const script = `import { installJsonLogging } from ${JSON.stringify(`${import.meta.dir}/logging.ts`)};
process.stdout.write("info\\n");
process.stderr.write("warm\\n");
installJsonLogging({ process: "api" });
setTimeout(() => {
  throw new Error("x+".repeat(150_000));
});`;
  const proc = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
  // Read late, so the pipe is full while the process writes the line.
  await Bun.sleep(300);
  const [, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  expect(await proc.exited).toBe(1);
  const line = JSON.parse(stderr.trim().split("\n").at(-1) ?? "");
  expect(line).toMatchObject({ level: "error", msg: "Uncaught exception:" });
  expect(line.err.message).toHaveLength(300_000);
}, 30_000);
