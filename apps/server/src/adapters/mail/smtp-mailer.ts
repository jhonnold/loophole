import { createTransport } from "nodemailer";
import type { Mailer, MailMessage } from "../../ports.ts";

export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  /** TLS from the start (port 465). Otherwise STARTTLS is used when the server offers it. */
  readonly secure: boolean;
  /** Both or neither; Mailpit needs none. */
  readonly user: string | undefined;
  readonly password: string | undefined;
  /** The From header, such as `Loophole <no-reply@example.com>`. */
  readonly from: string;
}

/** Sends mail over SMTP with nodemailer: Mailpit in development, any SMTP server in production. */
export class SmtpMailer implements Mailer {
  readonly #transport;
  readonly #from: string;

  constructor(settings: SmtpSettings) {
    this.#from = settings.from;
    this.#transport = createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth:
        settings.user === undefined
          ? undefined
          : { user: settings.user, pass: settings.password ?? "" },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.#transport.sendMail({
      from: this.#from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}
