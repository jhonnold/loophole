import type { Mailer, MailMessage } from "../../ports.ts";

/**
 * Hands mail to `inner` without waiting for it: `send` resolves at once, and a failure is only
 * logged. The API then answers before the SMTP round trip, so neither its timing nor an SMTP error
 * shows whether an email has an account. The log line leaves out the message, which holds a token.
 */
export class BackgroundMailer implements Mailer {
  readonly #inner: Mailer;

  constructor(inner: Mailer) {
    this.#inner = inner;
  }

  async send(message: MailMessage): Promise<void> {
    this.#inner.send(message).catch((err: unknown) => {
      console.error(`Sending mail failed: ${reason(err)}`);
    });
  }
}

/** A short reason. A refused connection is an AggregateError with an empty message but a code. */
function reason(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = (err as { code?: unknown }).code;
  return err.message || (typeof code === "string" ? code : err.name);
}
