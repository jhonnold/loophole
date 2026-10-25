/**
 * Structured logs: after `installJsonLogging`, every `console.*` call in the process writes one
 * JSON object per line (`time`, `level`, `process`, `msg`, the request id when there is one, and
 * any fields passed as a plain object). Emails, tokens and secrets are masked first, so a log line
 * never holds one (NFR-4, NFR-6).
 */

type Level = "debug" | "info" | "warn" | "error";

export interface JsonLoggingOptions {
  /** `api` or `worker`. */
  readonly process: string;
  /** Fields of the request being handled, if any (the request id). */
  readonly context?: () => Record<string, string> | undefined;
  /** Where a finished line goes; standard output and standard error by default. */
  readonly write?: (level: Level, line: string) => void;
  /** Ends the process after an uncaught error; `process.exit` by default. */
  readonly exit?: (code: number) => void;
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z][\w-]*[A-Za-z]\b/g;
/**
 * `token=…`, `password: …`, `secret="two words"`, `Authorization: Basic …` and the like, in URLs,
 * fragments and messages. A quoted value is masked up to its closing quote; a scheme word stays.
 */
const NAMED_SECRET =
  /\b(token|password|secret|authorization|cookie)\b(["']?\s*[:=]\s*)(?:(["'])((?:(?:Basic|Bearer)\s+)?)(?:(?!\3).)*?\3|(["']?)((?:(?:Basic|Bearer)\s+)?)[^\s"'&,;]+)/gi;
const BEARER = /\bBearer\s+[^\s"']+/gi;
/**
 * Runs of 40 or more base64url characters: session and mailed tokens (43, and they may hold `-` or
 * `_`), keys and secrets. UUIDs (36) and ordinary words stay.
 */
const LONG_TOKEN = /(?<![\w-])[A-Za-z0-9_-]{40,}(?![\w-])/g;
/** Fields whose values are dropped whatever they hold. */
const SECRET_KEY = /pass|secret|token|authorization|cookie|email/i;

/** `text` with emails, tokens and secrets masked. */
export function redact(text: string): string {
  return text
    .replace(EMAIL, "[email]")
    .replace(BEARER, "Bearer [redacted]")
    .replace(
      NAMED_SECRET,
      (
        _match,
        name: string,
        sep: string,
        quote1?: string,
        scheme1?: string,
        quote2?: string,
        scheme2?: string,
      ) =>
        `${name}${sep}${quote1 ?? quote2 ?? ""}${scheme1 ?? scheme2 ?? ""}[redacted]${quote1 ?? ""}`,
    )
    .replace(LONG_TOKEN, "[redacted]");
}

function clean(value: unknown, key = ""): unknown {
  if (SECRET_KEY.test(key)) return "[redacted]";
  if (typeof value === "string") return redact(value);
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message), stack: redact(value.stack ?? "") };
  }
  if (Array.isArray(value)) return value.map((v) => clean(v));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v, k)]));
  }
  return value;
}

/** One log line from a `console.*` call's arguments. */
export function formatLine(
  level: Level,
  args: readonly unknown[],
  process: string,
  context: Record<string, string> | undefined,
  now = new Date(),
): string {
  const words: string[] = [];
  const fields: Record<string, unknown> = {};
  for (const arg of args) {
    if (arg instanceof Error) fields.err = clean(arg);
    else if (arg !== null && typeof arg === "object" && !Array.isArray(arg)) {
      Object.assign(fields, clean(arg));
    } else words.push(redact(typeof arg === "string" ? arg : String(arg)));
  }
  return JSON.stringify({
    time: now.toISOString(),
    level,
    process,
    msg: words.join(" "),
    ...context,
    ...fields,
  });
}

/**
 * Replaces `console.debug/log/info/warn/error` with JSON line writers, and logs an uncaught error or
 * an unhandled rejection through them before exiting with status 1 (Bun would print it as plain
 * text, with the source lines and nothing masked).
 */
export function installJsonLogging(options: JsonLoggingOptions): void {
  const write =
    options.write ??
    ((level: Level, line: string) => {
      if (level === "warn" || level === "error") process.stderr.write(`${line}\n`);
      else process.stdout.write(`${line}\n`);
    });
  const log =
    (level: Level) =>
    (...args: unknown[]) =>
      write(level, formatLine(level, args, options.process, options.context?.()));
  console.debug = log("debug");
  console.log = log("info");
  console.info = log("info");
  console.warn = log("warn");
  console.error = log("error");
  const exit = options.exit ?? ((code: number) => process.exit(code));
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
    exit(1);
  });
}
