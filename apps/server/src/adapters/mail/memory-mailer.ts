import type { Mailer, MailMessage } from "../../ports.ts";

/** Keeps sent mail in a list, for tests and the OpenAPI document. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}
