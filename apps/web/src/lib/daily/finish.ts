import type { KeyValueStorage } from "../game/progress.ts";
import type { Attempt, Result } from "./api.ts";

/** A ranked solve waiting to reach the server. */
export interface PendingSolve {
  /** The board, in the wire format's edge-state encoding. */
  readonly edges: string;
  /** The ranked clock when the board was solved. */
  readonly elapsedMs: number;
}

/** How a send ended. */
export type FinishOutcome =
  | { readonly kind: "done"; readonly attempt: Attempt }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "stopped" };

/** Waits between tries; the last one repeats. */
export const FINISH_RETRY_MS = [2_000, 5_000, 15_000, 30_000] as const;

export interface FinisherDeps {
  readonly finish: (puzzleId: string, edges: string, elapsedMs: number) => Promise<Result<Attempt>>;
  readonly storage: KeyValueStorage | null;
  /** The logged-in player; pending solves are kept under their account's keys. */
  readonly userId: string;
  /** Resolves after `ms`, or early when `signal` aborts. Tests pass a manual one. */
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const realWait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });

/**
 * Sends ranked solves to the server (PRD FR-17), keeping each one on the device until the server
 * has answered, so a solve made offline or lost with a closed tab is sent again with the same
 * attempt and the time it was solved in. Network failures, 408, 429 and server errors are retried;
 * a 401 or 403 stops and keeps the solve for the next login; any other refusal drops it.
 */
export function createFinisher(deps: FinisherDeps) {
  const wait = deps.wait ?? realWait;
  const key = (puzzleId: string) => `loophole:user:${deps.userId}:ranked:${puzzleId}`;

  function pending(puzzleId: string): PendingSolve | null {
    try {
      const text = deps.storage?.getItem(key(puzzleId));
      if (!text) return null;
      const data = JSON.parse(text) as Partial<PendingSolve>;
      if (typeof data.edges !== "string" || typeof data.elapsedMs !== "number") return null;
      return { edges: data.edges, elapsedMs: data.elapsedMs };
    } catch {
      return null;
    }
  }

  function keep(puzzleId: string, solve: PendingSolve): void {
    try {
      deps.storage?.setItem(key(puzzleId), JSON.stringify(solve));
    } catch {
      // Storage refused: the send below still goes out.
    }
  }

  function drop(puzzleId: string): void {
    try {
      deps.storage?.removeItem(key(puzzleId));
    } catch {
      // Nothing to do.
    }
  }

  return {
    pending,

    /** Forgets a kept solve, once the server is known to have the attempt finished. */
    forget: drop,

    /**
     * Sends the pending solve for `puzzleId`, first storing `solve` as it unless one is already
     * waiting (the first solve's time counts). Retries until the server answers or `signal`
     * aborts; `onretry` hears each failure that will be retried.
     */
    async send(
      puzzleId: string,
      solve: PendingSolve | null,
      signal: AbortSignal,
      onretry: (message: string) => void = () => {},
    ): Promise<FinishOutcome> {
      if (solve !== null && pending(puzzleId) === null) keep(puzzleId, solve);
      const next = pending(puzzleId) ?? solve;
      if (next === null) return { kind: "stopped" };
      for (let i = 0; !signal.aborted; i++) {
        const result = await deps.finish(puzzleId, next.edges, next.elapsedMs);
        if (result.ok) {
          drop(puzzleId);
          return { kind: "done", attempt: result.value };
        }
        const { status, message } = result;
        if (status === 401 || status === 403) return { kind: "failed", message };
        if (status !== 0 && status !== 408 && status !== 429 && status < 500) {
          drop(puzzleId);
          return { kind: "failed", message };
        }
        onretry(message);
        await wait(FINISH_RETRY_MS[Math.min(i, FINISH_RETRY_MS.length - 1)], signal);
      }
      return { kind: "stopped" };
    },
  };
}

export type Finisher = ReturnType<typeof createFinisher>;
