import { describe, expect, test } from "bun:test";
import { SmtpMailer, smtpOptions } from "./smtp-mailer.ts";

test("STARTTLS is required for a remote SMTP server, not on loopback or with TLS from the start", () => {
  const settings = {
    port: 587,
    secure: false,
    user: undefined,
    password: undefined,
    from: "Loophole <no-reply@loophole.test>",
  };
  expect(smtpOptions({ ...settings, host: "smtp.example" }).requireTLS).toBe(true);
  expect(smtpOptions({ ...settings, host: "localhost" }).requireTLS).toBe(false);
  expect(smtpOptions({ ...settings, host: "127.0.0.1" }).requireTLS).toBe(false);
  expect(smtpOptions({ ...settings, host: "LOCALHOST" }).requireTLS).toBe(false);
  expect(smtpOptions({ ...settings, host: "127.10.0.2" }).requireTLS).toBe(false);
  expect(smtpOptions({ ...settings, host: "mailpit" }).requireTLS).toBe(true);
  expect(smtpOptions({ ...settings, host: "mailpit", requireTls: false }).requireTLS).toBe(false);
  expect(smtpOptions({ ...settings, host: "localhost", requireTls: true }).requireTLS).toBe(true);
  expect(
    smtpOptions({ ...settings, host: "smtp.example", port: 465, secure: true }).requireTLS,
  ).toBe(false);
});

// Sends through Mailpit from docker-compose.yml and reads the message back from its API. Skipped
// when Mailpit isn't running, as in CI.
const MAILPIT_API = "http://127.0.0.1:8025/api/v1";

async function reachable(): Promise<boolean> {
  try {
    return (await fetch(`${MAILPIT_API}/info`, { signal: AbortSignal.timeout(500) })).ok;
  } catch {
    return false;
  }
}

const available = await reachable();

describe.skipIf(!available)("SmtpMailer against Mailpit", () => {
  test("delivers a plain-text message", async () => {
    const to = `mailer-${crypto.randomUUID()}@loophole.test`;
    const mailer = new SmtpMailer({
      host: "127.0.0.1",
      port: 1025,
      secure: false,
      user: undefined,
      password: undefined,
      from: "Loophole <no-reply@loophole.test>",
    });
    await mailer.send({
      to,
      subject: "Hello from the test",
      text: "Line one\nhttp://x.test/#token=abc",
    });

    const search = await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await search.json()) as { messages: { ID: string; Subject: string }[] };
    expect(messages.map((m) => m.Subject)).toEqual(["Hello from the test"]);
    const message = (await (await fetch(`${MAILPIT_API}/message/${messages[0].ID}`)).json()) as {
      From: { Address: string };
      Text: string;
    };
    expect(message.From.Address).toBe("no-reply@loophole.test");
    expect(message.Text).toContain("http://x.test/#token=abc");
    await fetch(`${MAILPIT_API}/messages`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ IDs: [messages[0].ID] }),
    });
  });
});
