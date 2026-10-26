import type { ApiClient, Schemas } from "@loophole/api-client";
import type { Level } from "@loophole/core";
import { failureMessage } from "../auth/auth.ts";

export type Job = Schemas["Job"];

/** The sizes Home offers for a new practice puzzle (Home artboard, Practice). */
export const NEW_PUZZLE_SIZES: readonly number[] = [5, 7, 10, 15];

export type GenerateResult =
  | { readonly ok: true; readonly puzzleId: string }
  | { readonly ok: false; readonly message: string };

export interface GenerateOptions {
  /** Time between two looks at the job. */
  readonly intervalMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Stops following the job when aborted (the page was left); the job itself carries on. */
  readonly signal?: AbortSignal;
  /** Called with the job each time it is read, for a progress line. */
  readonly onJob?: (job: Job) => void;
}

const OFFLINE = "Couldn't reach the server. Check your connection and try again.";
const FAILED = "The puzzle couldn't be made. Try again.";
const STOPPED = "Stopped waiting for the puzzle.";
/** Extra tries for a look at the job that fails: a blip shouldn't end a wait of minutes. */
const POLL_RETRIES = 2;

/**
 * Why a request was refused. The server's own words first: its 429 here says how many puzzles the
 * player already has on the way, which the generic "too many attempts" would not.
 */
function refusal(status: number, problem: unknown): string {
  const detail = (problem as { detail?: unknown } | undefined)?.detail;
  return typeof detail === "string" ? detail : failureMessage(status, problem);
}

/** What a job's progress line says: waiting in the queue, or how far generation has got. */
export function jobStatusText(job: Job): string {
  if (job.status === "queued") return "Waiting for its turn…";
  return `Making the puzzle… ${Math.round(job.progress * 100)}%`;
}

/** New practice puzzles from the server's worker (PRD FR-7, FR-11), over the generated client. */
export function createPuzzleGenerator(client: ApiClient) {
  async function readOnce(id: string): Promise<Job | string> {
    try {
      const { data, error, response } = await client.GET("/api/jobs/{id}", {
        params: { path: { id } },
      });
      return data ?? refusal(response.status, error);
    } catch {
      return OFFLINE;
    }
  }

  /** Looks at the job, trying again after a short wait when the look fails. */
  async function read(id: string, wait: () => Promise<void>): Promise<Job | string> {
    let job = await readOnce(id);
    for (let retry = 0; retry < POLL_RETRIES && typeof job === "string"; retry++) {
      await wait();
      job = await readOnce(id);
    }
    return job;
  }

  return {
    /**
     * Queues a `width` × `height` puzzle at `level` and waits until it is made, however long the
     * queue is. Resolves to the new puzzle's id, or to a message saying why there is none.
     */
    async generate(
      width: number,
      height: number,
      level: Level,
      options: GenerateOptions = {},
    ): Promise<GenerateResult> {
      const interval = options.intervalMs ?? 1_000;
      const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
      let job: Job | string;
      try {
        const { data, error, response } = await client.POST("/api/jobs/generate", {
          body: { width, height, level },
        });
        job = data ?? refusal(response.status, error);
      } catch {
        job = OFFLINE;
      }
      for (;;) {
        if (typeof job === "string") return { ok: false, message: job };
        options.onJob?.(job);
        if (job.status === "done" && job.result !== null) {
          return { ok: true, puzzleId: job.result.puzzleId };
        }
        if (job.status === "failed" || job.status === "timeout") {
          return { ok: false, message: FAILED };
        }
        await sleep(interval);
        if (options.signal?.aborted) return { ok: false, message: STOPPED };
        job = await read(job.id, () => sleep(interval));
      }
    },
  };
}

export type PuzzleGenerator = ReturnType<typeof createPuzzleGenerator>;
