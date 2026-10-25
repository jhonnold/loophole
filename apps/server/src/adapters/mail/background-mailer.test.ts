import { expect, spyOn, test } from "bun:test";
import type { Mailer, MailMessage } from "../../ports.ts";
import { BackgroundMailer } from "./background-mailer.ts";

const MESSAGE: MailMessage = {
  to: "ann@example.com",
  subject: "Confirm your email for Loophole",
  text: "http://web.test/verify-email#token=secret-token",
};

test("resolves before the inner mailer is done, and passes the message on", async () => {
  const sent: MailMessage[] = [];
  let finish = () => {};
  const inner: Mailer = {
    send: (message) =>
      new Promise<void>((resolve) => {
        finish = () => {
          sent.push(message);
          resolve();
        };
      }),
  };
  await new BackgroundMailer(inner).send(MESSAGE);
  expect(sent).toEqual([]);
  finish();
  expect(sent).toEqual([MESSAGE]);
});

test("a failure is logged without the message and never reaches the caller", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  const inner: Mailer = {
    send: async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:1025");
    },
  };
  let failures = 0;
  await new BackgroundMailer(inner, () => failures++).send(MESSAGE);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(failures).toBe(1);
  expect(log).toHaveBeenCalledTimes(1);
  const line = String(log.mock.calls[0][0]);
  expect(line).toBe("Sending mail failed: connect ECONNREFUSED 127.0.0.1:1025");
  expect(line).not.toContain("secret-token");
  expect(line).not.toContain(MESSAGE.to);
  log.mockRestore();
});

test("a refused connection is logged by its code", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  const refused = Object.assign(new AggregateError([], ""), { code: "ECONNREFUSED" });
  const inner: Mailer = { send: () => Promise.reject(refused) };
  await new BackgroundMailer(inner).send(MESSAGE);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(log.mock.calls[0][0]).toBe("Sending mail failed: ECONNREFUSED");
  log.mockRestore();
});
