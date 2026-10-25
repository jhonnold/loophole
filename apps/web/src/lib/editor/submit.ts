import type { ApiClient, Schemas } from "@loophole/api-client";
import { type Puzzle, serializePuzzle } from "@loophole/core";
import { failureMessage } from "../auth/auth.ts";

export type Submission = Schemas["Submission"];
export type Verdict = NonNullable<Submission["verdict"]>;

export type SubmitResult =
  | { readonly ok: true; readonly submission: Submission }
  | { readonly ok: false; readonly message: string };

const OFFLINE = "Couldn't reach the server. Check your connection and try again.";
const STILL_CHECKING =
  "The server is still checking. Your account page will show the result when it's ready.";

/** Words for a verdict (PRD FR-27: rejections come with an explanation). */
export function verdictText(verdict: Verdict): { readonly title: string; readonly text: string } {
  switch (verdict) {
    case "unique":
      return { title: "Published", text: "Exactly one answer. Anyone with the link can play it." };
    case "duplicate":
      return {
        title: "Already published",
        text: "A puzzle with exactly these clues is already published, so the link goes to it.",
      };
    case "none":
      return {
        title: "No answer",
        text: "No single loop fits these clues. Check for a clue too many.",
      };
    case "multiple":
      return {
        title: "More than one answer",
        text: "At least two loops fit these clues. Add a clue that tells them apart.",
      };
    case "unknown":
      return {
        title: "Too open to check",
        text: "The verifier ran out of time before it could prove there is one answer. Add clues, or try a smaller grid.",
      };
    case "removed":
      return {
        title: "Removed",
        text: "A puzzle with exactly these clues was taken down by a moderator.",
      };
    case "error":
      return { title: "Not checked", text: "Something went wrong while checking. Try again." };
  }
}

/** The address to share for a published puzzle. */
export function shareUrl(origin: string, puzzleId: string): string {
  return `${origin}/play/${encodeURIComponent(puzzleId)}`;
}

export interface WaitOptions {
  readonly intervalMs?: number;
  /** Give up after this long (the server's own limit is 45 s). */
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Stops polling when aborted (the editor was left); the answer is then "still checking". */
  readonly signal?: AbortSignal;
}

/** Submitting puzzles and following them (PRD FR-27), over the generated API client. */
export function createSubmissions(client: ApiClient) {
  async function get(id: string): Promise<SubmitResult> {
    try {
      const { data, error, response } = await client.GET("/api/submissions/{id}", {
        params: { path: { id } },
      });
      if (data === undefined) return { ok: false, message: failureMessage(response.status, error) };
      return { ok: true, submission: data };
    } catch {
      return { ok: false, message: OFFLINE };
    }
  }

  return {
    /** Sends the puzzle's clues. The answer is usually still pending; see `waitFor`. */
    async submit(puzzle: Puzzle): Promise<SubmitResult> {
      const { width, height, clues } = serializePuzzle(puzzle);
      try {
        const { data, error, response } = await client.POST("/api/submissions", {
          body: { width, height, clues },
        });
        if (data === undefined) {
          return { ok: false, message: failureMessage(response.status, error) };
        }
        return { ok: true, submission: data };
      } catch {
        return { ok: false, message: OFFLINE };
      }
    },

    get,

    /** Polls a submission until it is decided, or gives up after `timeoutMs`. */
    async waitFor(id: string, options: WaitOptions = {}): Promise<SubmitResult> {
      const interval = options.intervalMs ?? 1_000;
      const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
      for (let waited = 0; waited < (options.timeoutMs ?? 90_000); waited += interval) {
        await sleep(interval);
        if (options.signal?.aborted) break;
        const result = await get(id);
        if (!result.ok || result.submission.status !== "pending") return result;
      }
      return { ok: false, message: STILL_CHECKING };
    },

    /** The logged-in player's submissions, newest first, or null when they can't be read. */
    async list(): Promise<Submission[] | null> {
      try {
        const { data } = await client.GET("/api/submissions");
        return data?.items ?? null;
      } catch {
        return null;
      }
    },
  };
}

export type Submissions = ReturnType<typeof createSubmissions>;
