import { describe, expect, test } from "bun:test";
import type { UserRecord } from "../domain.ts";
import {
  ANN_IDENTITY,
  FakeClock,
  FakeIdentityRepository,
  FakeOidcProvider,
  FakeSessionRepository,
  FakeUserRepository,
  fakePasswordHasher,
  sequentialIds,
} from "../test-support/fakes.ts";
import { OidcLoginError } from "./errors.ts";
import { OidcLoginManager } from "./oidc-login-manager.ts";
import { SessionManager } from "./session-manager.ts";

const ISSUER = "https://idp.test";

function setup() {
  const clock = new FakeClock(5_000);
  const users = new FakeUserRepository();
  const identities = new FakeIdentityRepository();
  const provider = new FakeOidcProvider();
  const sessions = new SessionManager({
    sessions: new FakeSessionRepository(),
    users,
    clock,
    newToken: sequentialIds("session"),
    ttlMs: 60_000,
  });
  const manager = new OidcLoginManager({
    provider,
    users,
    identities,
    sessions,
    passwords: fakePasswordHasher,
    clock,
    newId: sequentialIds("u"),
    newToken: sequentialIds("random"),
  });
  /** A full login: begin, then the provider's callback with the matching state. */
  const logIn = async (previousToken: string | null = null) => {
    const started = await manager.begin();
    if (started === null) throw new Error("provider down");
    const callback = new URLSearchParams({ code: "c", state: started.pending.state });
    return manager.finish(callback, started.pending, previousToken);
  };
  return { clock, users, identities, provider, sessions, manager, logIn };
}

const passwordUser = (over: Partial<UserRecord> = {}): UserRecord => ({
  id: "existing",
  email: "ann@example.com",
  passwordHash: "hashed:hunter22",
  hasPassword: true,
  emailVerifiedAt: null,
  isAdmin: false,
  createdAt: 1,
  ...over,
});

describe("OidcLoginManager", () => {
  test("a new email gets a verified account without a password, tied to the identity", async () => {
    const { users, identities, sessions, logIn } = setup();
    const { user, session } = await logIn();
    expect(user).toEqual({
      id: "u-1",
      email: "ann@example.com",
      passwordHash: "hashed:random-1",
      hasPassword: false,
      emailVerifiedAt: 5_000,
      isAdmin: false,
      createdAt: 5_000,
    });
    expect(users.get("u-1")).toEqual(user);
    expect(identities.getUserId(ISSUER, "sub-ann")).toBe("u-1");
    expect((await sessions.authenticate(session.token))?.id).toBe("u-1");
  });

  test("the next login finds the account through the identity, even after the email changed", async () => {
    const { users, provider, logIn } = setup();
    await logIn();
    provider.identity = { ...ANN_IDENTITY, email: "ann@new.example" };
    const { user } = await logIn();
    expect(user.id).toBe("u-1");
    expect(user.email).toBe("ann@example.com");
    expect(users.users.size).toBe(1);
  });

  test("a verified email logs in to the password account with it and confirms the email", async () => {
    const { users, identities, provider, logIn } = setup();
    users.insert(passwordUser());
    provider.identity = { ...ANN_IDENTITY, email: " Ann@Example.com " };
    const { user } = await logIn();
    expect(user).toMatchObject({ id: "existing", hasPassword: true, emailVerifiedAt: 5_000 });
    expect(users.get("existing")?.emailVerifiedAt).toBe(5_000);
    expect(identities.getUserId(ISSUER, "sub-ann")).toBe("existing");
  });

  test("an unverified email doesn't take over an account, but may make a new one", async () => {
    const { users, identities, provider, logIn } = setup();
    users.insert(passwordUser());
    provider.identity = { ...ANN_IDENTITY, emailVerified: false };
    await expect(logIn()).rejects.toEqual(new OidcLoginError("email-unverified"));
    expect(identities.identities.size).toBe(0);

    provider.identity = { ...ANN_IDENTITY, emailVerified: false, email: "bob@example.com" };
    const { user } = await logIn();
    expect(user).toMatchObject({ email: "bob@example.com", emailVerifiedAt: null });
  });

  test("refuses an identity without an email, and a login the provider refused", async () => {
    const { users, provider, manager, logIn } = setup();
    provider.identity = { ...ANN_IDENTITY, email: null };
    await expect(logIn()).rejects.toEqual(new OidcLoginError("no-email"));
    provider.identity = null;
    await expect(logIn()).rejects.toEqual(new OidcLoginError("failed"));
    const started = await manager.begin();
    if (started === null) throw new Error("provider down");
    const forged = new URLSearchParams({ code: "c", state: "someone-else's" });
    await expect(manager.finish(forged, started.pending, null)).rejects.toEqual(
      new OidcLoginError("failed"),
    );
    expect(users.users.size).toBe(0);
  });

  test("ends the session of the cookie sent, so each login gets a new token", async () => {
    const { sessions, logIn } = setup();
    const first = await logIn();
    const second = await logIn(first.session.token);
    expect(second.session.token).not.toBe(first.session.token);
    expect(await sessions.authenticate(first.session.token)).toBeNull();
    expect(await sessions.authenticate(second.session.token)).not.toBeNull();
  });

  test("begin is null while the provider can't be reached", async () => {
    const { provider, manager } = setup();
    provider.available = false;
    expect(await manager.begin()).toBeNull();
  });
});
