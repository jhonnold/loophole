import { expect } from "@playwright/test";

const MAILPIT_API = "http://127.0.0.1:8025/api/v1";

/** Whether `url` answers at all within two seconds. */
export async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

/** Whether the auth end-to-end tests can run: Mailpit, and Cloudflare for the CAPTCHA check. */
export async function canSignUp(): Promise<boolean> {
  return (
    (await reachable(`${MAILPIT_API}/info`)) &&
    (await reachable("https://challenges.cloudflare.com/turnstile/v0/siteverify"))
  );
}

/** The path and fragment of the link in the newest mail to `to`, once it arrives. */
export async function mailedLink(to: string): Promise<string> {
  let link = "";
  await expect
    .poll(
      async () => {
        const res = await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:"${to}"`)}`);
        const { messages } = (await res.json()) as { messages: { ID: string }[] };
        if (messages.length === 0) return "";
        const message = (await (
          await fetch(`${MAILPIT_API}/message/${messages[0].ID}`)
        ).json()) as {
          Text: string;
        };
        link = message.Text.match(/http:\/\/localhost:4174(\/\S+#token=\S+)/)?.[1] ?? "";
        return link;
      },
      { timeout: 10_000 },
    )
    .not.toBe("");
  return link;
}
