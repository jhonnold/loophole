import { z } from "@hono/zod-openapi";

// Request and response bodies of the account and session routes (accounts.ts).

const Email = z.email().max(254).openapi({ example: "player@example.com" });

/** Rules for a new password. Login takes any non-empty password up to the same length. */
const NewPassword = z.string().min(8).max(128).openapi({ description: "8 to 128 characters." });

const Password = z.string().min(1).max(128);

const MailedToken = z
  .string()
  .min(1)
  .max(128)
  .openapi({ description: "The token from the link in the email (after `#token=`)." });

export const UserSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
    isAdmin: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .openapi("User", { description: "The logged-in player. Only the email is personal data." });

export const SessionSchema = z
  .object({ user: z.union([UserSchema, z.null()]) })
  .openapi("Session", { description: "`user` is null when no one is logged in." });

export const AuthConfigSchema = z
  .object({
    turnstileSiteKey: z.string().openapi({ description: "Site key for the sign-up CAPTCHA." }),
  })
  .openapi("AuthConfig");

export const SignUpRequestSchema = z
  .strictObject({
    email: Email,
    password: NewPassword,
    captchaToken: z
      .string()
      .min(1)
      .max(2048)
      .openapi({ description: "The token from the Turnstile widget." }),
  })
  .openapi("SignUpRequest");

export const LogInRequestSchema = z
  .strictObject({ email: Email, password: Password })
  .openapi("LogInRequest");

export const EmailRequestSchema = z.strictObject({ email: Email }).openapi("EmailRequest");

export const VerifyEmailRequestSchema = z
  .strictObject({ token: MailedToken })
  .openapi("VerifyEmailRequest");

export const ResetPasswordRequestSchema = z
  .strictObject({ token: MailedToken, password: NewPassword })
  .openapi("ResetPasswordRequest");

export const DeleteAccountRequestSchema = z
  .strictObject({ password: Password })
  .openapi("DeleteAccountRequest");
