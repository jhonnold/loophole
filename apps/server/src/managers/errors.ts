/** The job queue already holds as many queued jobs as allowed; try again later. */
export class QueueFullError extends Error {
  constructor(limit: number) {
    super(`The job queue is full (${limit} jobs waiting). Try again later.`);
    this.name = "QueueFullError";
  }
}

/**
 * The requester already has as many generations queued or running as allowed; one has to finish
 * first (DECISIONS, WT21 "Worker fairness").
 */
export class TooManyPendingJobsError extends Error {
  constructor(limit: number) {
    super(
      `You already have ${limit} puzzles being generated. Wait for one to finish, then try again.`,
    );
    this.name = "TooManyPendingJobsError";
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

/** There is no daily puzzle here: an unknown day or puzzle, a day still to come, or a practice puzzle. */
export class DailyNotFoundError extends Error {
  constructor(message = "No daily puzzle here.") {
    super(message);
    this.name = "DailyNotFoundError";
  }
}

/** A ranked attempt can only be started on the daily's own UTC day. */
export class DailyEndedError extends Error {
  constructor() {
    super("This daily puzzle's day is over; it can still be played, but not ranked.");
    this.name = "DailyEndedError";
  }
}

/** The player has no ranked attempt at this puzzle to finish. */
export class AttemptNotFoundError extends Error {
  constructor() {
    super("Start a ranked attempt before sending a solution.");
    this.name = "AttemptNotFoundError";
  }
}

/** A ranked attempt's board is not the puzzle's solution. */
export class WrongSolutionError extends Error {
  constructor() {
    super("That board is not the solution.");
    this.name = "WrongSolutionError";
  }
}

/** The display name is reserved or not allowed. */
export class InvalidDisplayNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDisplayNameError";
  }
}

/** Another player already shows this display name. */
export class DisplayNameTakenError extends Error {
  constructor() {
    super("Another player already has that name.");
    this.name = "DisplayNameTakenError";
  }
}
