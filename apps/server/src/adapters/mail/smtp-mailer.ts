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
  /** Whether STARTTLS is required. Unset: required off loopback, not required on it. */
  readonly requireTls?: boolean;
}

/**
 * The transport options. Off loopback, STARTTLS is required: without it, a server that strips the
 * STARTTLS offer would get the reset and verification links and the SMTP password in cleartext.
 * Mailpit on loopback has no TLS. An explicit `requireTls` wins over both defaults.
 */
export function smtpOptions(settings: SmtpSettings) {
  return {
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: settings.requireTls ?? (!settings.secure && !isLoopback(settings.host)),
    auth:
      settings.user === undefined
        ? undefined
        : { user: settings.user, pass: settings.password ?? "" },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
}

/** localhost, ::1 and any 127.x.x.x address, in any letter case. */
function isLoopback(host: string): boolean {
  const name = host.toLowerCase();
  if (name === "localhost" || name === "::1") return true;
  const octets = name.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
}

/** Sends mail over SMTP with nodemailer: Mailpit in development, any SMTP server in production. */
export class SmtpMailer implements Mailer {
  readonly #transport;
  readonly #from: string;

  constructor(settings: SmtpSettings) {
    this.#from = settings.from;
    this.#transport = createTransport(smtpOptions(settings));
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
