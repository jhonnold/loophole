import {
  decodeEdges,
  encodeEdges,
  type Puzzle,
  type PuzzleWireV1,
  parsePuzzle,
  serializePuzzle,
  type VerifyStatus,
  verify,
} from "@loophole/core";

/**
 * How long the browser looks for answers before saying "unknown". The server tries for 30 s when
 * the puzzle is submitted (PRD NFR-1), so this only has to keep the feedback quick.
 */
export const CHECK_TIME_LIMIT_MS = 3_000;

/** Wait after the last edit before checking, so typing a row of clues runs one check. */
export const CHECK_DEBOUNCE_MS = 250;

/** Extra time a check may take past its limit before its thread is stopped. */
const HARD_LIMIT_SLACK_MS = 2_000;

/** A message to the check thread. */
export interface CheckRequest {
  readonly id: number;
  readonly puzzle: PuzzleWireV1;
  readonly timeLimitMs: number;
}

/** The check thread's answer, with solutions in the edge-state encoding. */
export interface CheckReply {
  readonly id: number;
  readonly status: VerifyStatus;
  readonly solutions: readonly string[];
}

/** What the verifier says about the draft: its status, and up to two answers as edge states. */
export interface CheckResult {
  readonly status: VerifyStatus;
  readonly solutions: readonly Uint8Array[];
}

/** Runs one check; the check thread calls this. */
export function answerCheck(request: CheckRequest): CheckReply {
  const result = verify(parsePuzzle(request.puzzle), { timeLimitMs: request.timeLimitMs });
  return { id: request.id, status: result.status, solutions: result.solutions.map(encodeEdges) };
}

/** The parts of a Web Worker the checker uses, so tests can pass a fake. */
export interface CheckWorker {
  postMessage(request: CheckRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<CheckReply>) => void) | null;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface LiveCheckerOptions {
  readonly createWorker: () => CheckWorker;
  /** Called with the result for the latest puzzle only. */
  readonly onresult: (result: CheckResult) => void;
  readonly timers?: Timers;
  readonly debounceMs?: number;
  readonly timeLimitMs?: number;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Live solver feedback for the editor (PRD FR-26). Checks run in a worker thread so the page never
 * blocks. A new edit waits out the debounce, then replaces any check still running: that thread
 * is stopped and a fresh one started, so only the latest puzzle is ever answered. A check that
 * overruns its limit is stopped too and reported as unknown.
 */
export class LiveChecker {
  readonly #options: LiveCheckerOptions;
  readonly #timers: Timers;
  #worker: CheckWorker | null = null;
  #busy = false;
  #id = 0;
  #debounce: unknown = null;
  #deadline: unknown = null;

  constructor(options: LiveCheckerOptions) {
    this.#options = options;
    this.#timers = options.timers ?? realTimers;
  }

  /** Checks `puzzle` after the debounce. */
  check(puzzle: Puzzle): void {
    if (this.#debounce !== null) this.#timers.clear(this.#debounce);
    this.#debounce = this.#timers.set(() => {
      this.#debounce = null;
      this.#run(puzzle);
    }, this.#options.debounceMs ?? CHECK_DEBOUNCE_MS);
  }

  /** Stops any check and its thread. */
  dispose(): void {
    if (this.#debounce !== null) this.#timers.clear(this.#debounce);
    this.#debounce = null;
    this.#stop();
  }

  #run(puzzle: Puzzle): void {
    if (this.#busy) this.#stop();
    const timeLimitMs = this.#options.timeLimitMs ?? CHECK_TIME_LIMIT_MS;
    const worker = this.#worker ?? this.#options.createWorker();
    this.#worker = worker;
    const id = ++this.#id;
    worker.onmessage = (event) => {
      if (event.data.id !== this.#id) return;
      this.#settle();
      const solutions = event.data.solutions.map((s) => decodeEdges(puzzle.grid, s));
      this.#options.onresult({ status: event.data.status, solutions });
    };
    this.#busy = true;
    this.#deadline = this.#timers.set(() => {
      this.#stop();
      this.#options.onresult({ status: "unknown", solutions: [] });
    }, timeLimitMs + HARD_LIMIT_SLACK_MS);
    worker.postMessage({ id, puzzle: serializePuzzle(puzzle), timeLimitMs });
  }

  #settle(): void {
    this.#busy = false;
    if (this.#deadline !== null) this.#timers.clear(this.#deadline);
    this.#deadline = null;
  }

  #stop(): void {
    this.#settle();
    this.#worker?.terminate();
    this.#worker = null;
  }
}
