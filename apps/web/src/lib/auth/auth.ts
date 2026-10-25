import type { ApiClient, Schemas } from "@loophole/api-client";
import { type Readable, writable } from "svelte/store";

export type User = Schemas["User"];

/** Who is using the app. "loading" until the first answer from the API. */
export type AuthState =
  | { readonly status: "loading" }
  | { readonly status: "guest" }
  | { readonly status: "user"; readonly user: User };

/** Outcome of an account action, with a message to show when it failed. */
export type AuthResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** The logged-in user as a store, plus the account actions (PRD FR-18 to FR-20, NFR-6). */
export interface Auth extends Readable<AuthState> {
  /** Asks the API who is logged in. Anything but an answer (no server, say) counts as a guest. */
  refresh(): Promise<void>;
  /** The Turnstile site key for the sign-up form, or null if the API can't be reached. */
  turnstileSiteKey(): Promise<string | null>;
  signUp(email: string, password: string, captchaToken: string): Promise<AuthResult>;
  logIn(email: string, password: string): Promise<AuthResult>;
  logOut(): Promise<void>;
  verifyEmail(token: string): Promise<AuthResult>;
  resendVerification(email: string): Promise<AuthResult>;
  requestPasswordReset(email: string): Promise<AuthResult>;
  resetPassword(token: string, password: string): Promise<AuthResult>;
  deleteAccount(password: string): Promise<AuthResult>;
}

const OFFLINE = "Couldn't reach the server. Check your connection and try again.";
const TOO_MANY = "Too many attempts. Wait a few minutes and try again.";

/** The message for a failed request, from its problem details. */
export function failureMessage(status: number, problem: unknown): string {
  if (status === 429) return TOO_MANY;
  const p = (problem ?? {}) as { title?: unknown; detail?: unknown };
  if (status === 400 && p.title === "Invalid request") return "Check the form and try again.";
  if (typeof p.detail === "string") return p.detail;
  if (typeof p.title === "string") return p.title;
  return `Something went wrong (HTTP ${status}).`;
}

/** The token in a mailed link's fragment (`#token=…`), or null. */
export function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token === null || token === "" ? null : token;
}

export function createAuth(client: ApiClient): Auth {
  const state = writable<AuthState>({ status: "loading" });
  const guest = () => state.set({ status: "guest" });

  async function run(
    request: () => Promise<{ response: Response; error?: unknown }>,
  ): Promise<AuthResult> {
    try {
      const { response, error } = await request();
      return response.ok
        ? { ok: true }
        : { ok: false, message: failureMessage(response.status, error) };
    } catch {
      return { ok: false, message: OFFLINE };
    }
  }

  async function refresh(): Promise<void> {
    try {
      const { data } = await client.GET("/api/session");
      if (data?.user) state.set({ status: "user", user: data.user });
      else guest();
    } catch {
      guest();
    }
  }

  return {
    subscribe: state.subscribe,
    refresh,

    async turnstileSiteKey() {
      try {
        const { data } = await client.GET("/api/auth/config");
        return data?.turnstileSiteKey ?? null;
      } catch {
        return null;
      }
    },

    signUp: (email, password, captchaToken) =>
      run(() => client.POST("/api/auth/signup", { body: { email, password, captchaToken } })),

    async logIn(email, password) {
      try {
        const { data, error, response } = await client.POST("/api/auth/login", {
          body: { email, password },
        });
        if (data === undefined)
          return { ok: false, message: failureMessage(response.status, error) };
        state.set({ status: "user", user: data });
        return { ok: true };
      } catch {
        return { ok: false, message: OFFLINE };
      }
    },

    async logOut() {
      await run(() => client.POST("/api/auth/logout"));
      guest();
    },

    async verifyEmail(token) {
      const result = await run(() => client.POST("/api/auth/verify-email", { body: { token } }));
      if (result.ok) await refresh();
      return result;
    },

    resendVerification: (email) =>
      run(() => client.POST("/api/auth/resend-verification", { body: { email } })),

    requestPasswordReset: (email) =>
      run(() => client.POST("/api/auth/forgot-password", { body: { email } })),

    async resetPassword(token, password) {
      const result = await run(() =>
        client.POST("/api/auth/reset-password", { body: { token, password } }),
      );
      // A reset logs the account out everywhere, this tab included.
      if (result.ok) guest();
      return result;
    },

    async deleteAccount(password) {
      const result = await run(() => client.DELETE("/api/account", { body: { password } }));
      if (result.ok) guest();
      return result;
    },
  };
}
