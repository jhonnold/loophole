/** The job queue already holds as many queued jobs as allowed; try again later. */
export class QueueFullError extends Error {
  constructor(limit: number) {
    super(`The job queue is full (${limit} jobs waiting). Try again later.`);
    this.name = "QueueFullError";
  }
}

/** The email and password don't match an account. Says nothing about which one was wrong. */
export class InvalidCredentialsError extends Error {
  constructor() {
    super("The email or password is wrong.");
    this.name = "InvalidCredentialsError";
  }
}

/** The sign-up form's CAPTCHA token was refused. */
export class CaptchaFailedError extends Error {
  constructor() {
    super("The CAPTCHA check failed. Try again.");
    this.name = "CaptchaFailedError";
  }
}

/** An email verification or password reset link is unknown, used or expired. */
export class InvalidTokenError extends Error {
  constructor() {
    super("This link is invalid or has expired.");
    this.name = "InvalidTokenError";
  }
}

/** Too many attempts for this account or address; try again after `retryAfterMs`. */
export class RateLimitedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("Too many attempts. Try again later.");
    this.name = "RateLimitedError";
  }
}

/** A board does not fit its puzzle (wrong length or a bad character). */
export class InvalidBoardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBoardError";
  }
}

/** There is no published puzzle with this id. */
export class PuzzleNotFoundError extends Error {
  constructor(id: string) {
    super(`No published puzzle with id ${id}.`);
    this.name = "PuzzleNotFoundError";
  }
}
