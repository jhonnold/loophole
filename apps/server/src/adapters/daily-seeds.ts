import { createHmac } from "node:crypto";
import type { DailySeeder } from "../ports.ts";

/**
 * Daily seeds from an HMAC-SHA256 of the day, size and attempt under the server's secret
 * (`DAILY_SEED_SECRET`): reproducible by whoever holds the secret, unguessable by anyone else.
 */
export function hmacDailySeeder(secret: string): DailySeeder {
  return {
    seed: (day, size, attempt) =>
      createHmac("sha256", secret)
        .update(`loophole-daily:${day}:${size}:${attempt}`)
        .digest("base64url"),
  };
}
