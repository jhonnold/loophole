import type { UserRecord } from "../domain.ts";
import type {
  Clock,
  IdentityRepository,
  OidcIdentity,
  OidcPending,
  OidcProvider,
  PasswordHasher,
  UserRepository,
} from "../ports.ts";
import { normalizeEmail } from "./account-manager.ts";
import { OidcLoginError } from "./errors.ts";
import type { NewSession, SessionManager } from "./session-manager.ts";

export interface OidcLoginManagerDeps {
  readonly provider: OidcProvider;
  readonly users: UserRepository;
  readonly identities: IdentityRepository;
  readonly sessions: SessionManager;
  readonly passwords: PasswordHasher;
  readonly clock: Clock;
  readonly newId: () => string;
  /** A new random token (256 bits), here the password nobody knows for a new account. */
  readonly newToken: () => string;
}

/**
 * Login through an OpenID Connect provider (PRD FR-30; DECISIONS, "Single sign-on"). The provider
 * is trusted like the player's inbox: an identity it vouches for logs in to the account with that
 * email, and a new email gets a new account, with no CAPTCHA.
 */
export class OidcLoginManager {
  readonly #deps: OidcLoginManagerDeps;

  constructor(deps: OidcLoginManagerDeps) {
    this.#deps = deps;
  }

  /** Where to send the browser and what to keep until it returns; null when the provider is down. */
  begin(): ReturnType<OidcProvider["begin"]> {
    return this.#deps.provider.begin();
  }

  /**
   * Finishes a login from the provider's callback and starts a new session, ending
   * `previousToken`'s session if one was sent. Throws `OidcLoginError`.
   */
  async finish(
    callback: URLSearchParams,
    pending: OidcPending,
    previousToken: string | null,
  ): Promise<{ user: UserRecord; session: NewSession }> {
    const { provider, sessions } = this.#deps;
    const identity = await provider.finish(callback, pending);
    if (identity === null) throw new OidcLoginError("failed");
    const user = await this.#userFor(identity);
    if (previousToken !== null) await sessions.end(previousToken);
    return { user, session: await sessions.create(user.id) };
  }

  /** The identity's account: the one it is tied to, else the one with its email, else a new one. */
  async #userFor(identity: OidcIdentity): Promise<UserRecord> {
    const { users, identities, passwords, clock, newId, newToken } = this.#deps;
    const linkedId = identities.getUserId(identity.issuer, identity.subject);
    const linked = linkedId === null ? null : users.get(linkedId);
    if (linked !== null) return linked;

    if (identity.email === null) throw new OidcLoginError("no-email");
    const email = normalizeEmail(identity.email);
    const now = clock.now();
    let user = users.getByEmail(email);
    if (user !== null) {
      // Only an email the provider has checked may take over an existing account.
      if (!identity.emailVerified) throw new OidcLoginError("email-unverified");
      users.markEmailVerified(user.id, now);
      user = { ...user, emailVerifiedAt: user.emailVerifiedAt ?? now };
    } else {
      user = {
        id: newId(),
        email,
        passwordHash: await passwords.hash(newToken()),
        hasPassword: false,
        emailVerifiedAt: identity.emailVerified ? now : null,
        isAdmin: false,
        createdAt: now,
      };
      // Someone signed up with this email in the meantime: let the player try again.
      if (!users.insert(user)) throw new OidcLoginError("failed");
    }
    identities.insert({
      issuer: identity.issuer,
      subject: identity.subject,
      userId: user.id,
      createdAt: now,
    });
    return user;
  }
}
