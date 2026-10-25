import type { Clock, DisplayNameRepository, RateLimiter, RateRule } from "../ports.ts";
import { DisplayNameTakenError, InvalidDisplayNameError, RateLimitedError } from "./errors.ts";

/** Name changes one account may make. */
export const NAME_CHANGES_PER_ACCOUNT: RateRule = { limit: 10, windowMs: 60 * 60 * 1000 };

/** Names that would confuse a leaderboard ("You" marks the viewer's own row). */
const RESERVED = new Set(["you", "anonymous"]);

/** Parts that would let a name pass for staff, anywhere in it. */
const RESERVED_PARTS = ["admin", "loophole", "moderator", "official"];

function reserved(name: string): boolean {
  const lower = name.toLowerCase();
  return RESERVED.has(lower) || RESERVED_PARTS.some((part) => lower.includes(part));
}

export interface DisplayNameManagerDeps {
  readonly names: DisplayNameRepository;
  readonly limiter: RateLimiter;
  readonly clock: Clock;
}

/**
 * The names players show on leaderboards (DECISIONS, "Display names"). A player has none until
 * they choose one, and shows as anonymous until then; the name is public, unique ignoring case,
 * and goes with the account.
 */
export class DisplayNameManager {
  readonly #deps: DisplayNameManagerDeps;

  constructor(deps: DisplayNameManagerDeps) {
    this.#deps = deps;
  }

  get(userId: string): string | null {
    return this.#deps.names.get(userId);
  }

  /**
   * Sets the user's name, already checked for length and characters, or removes it with null.
   * Throws `InvalidDisplayNameError` for a reserved name, `DisplayNameTakenError` when another
   * player has it, and `RateLimitedError` past the account's limit.
   */
  set(userId: string, name: string | null): string | null {
    const { names, limiter, clock } = this.#deps;
    const decision = limiter.hit(`display-name:${userId}`, NAME_CHANGES_PER_ACCOUNT);
    if (!decision.allowed) throw new RateLimitedError(decision.retryAfterMs);
    if (name !== null && reserved(name)) {
      throw new InvalidDisplayNameError(`"${name}" can't be used as a name.`);
    }
    if (!names.set(userId, name, clock.now())) throw new DisplayNameTakenError();
    return name;
  }
}
