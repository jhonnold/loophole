import { describe, expect, test } from "bun:test";
import { createPuzzle, encodeEdges, serializePuzzle } from "@loophole/core";
import {
  answerCheck,
  type CheckReply,
  type CheckRequest,
  type CheckResult,
  type CheckWorker,
  LiveChecker,
  type Timers,
} from "./checker.ts";

/** Timers that run only when the test says so. */
function fakeTimers() {
  let now = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  let next = 0;
  const timers: Timers = {
    set(fn, ms) {
      pending.set(++next, { at: now + ms, fn });
      return next;
    },
    clear(handle) {
      pending.delete(handle as number);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
      if (t.at > now) continue;
      pending.delete(id);
      t.fn();
    }
  };
  return { timers, advance };
}

class FakeWorker implements CheckWorker {
  readonly requests: CheckRequest[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<CheckReply>) => void) | null = null;

  postMessage(request: CheckRequest): void {
    this.requests.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Answers the last request the way the real thread would. */
  answer(): void {
    const request = this.requests.at(-1);
    if (request === undefined) throw new Error("nothing to answer");
    this.onmessage?.({ data: answerCheck(request) } as MessageEvent<CheckReply>);
  }
}

function setup() {
  const { timers, advance } = fakeTimers();
  const workers: FakeWorker[] = [];
  const results: CheckResult[] = [];
  const checker = new LiveChecker({
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    onresult: (r) => results.push(r),
    timers,
    debounceMs: 250,
    timeLimitMs: 1_000,
  });
  return { checker, advance, workers, results };
}

const UNIQUE = createPuzzle(2, 2, [2, 2, 2, 2]);
const OPEN = createPuzzle(2, 2);

describe("answerCheck", () => {
  test("verifies the puzzle within the time limit and encodes the answers", () => {
    const reply = answerCheck({ id: 7, puzzle: serializePuzzle(UNIQUE), timeLimitMs: 1_000 });
    expect(reply).toEqual({ id: 7, status: "unique", solutions: ["112211121121"] });
    expect(
      answerCheck({ id: 1, puzzle: serializePuzzle(OPEN), timeLimitMs: 1_000 }).solutions,
    ).toHaveLength(2);
  });
});

describe("LiveChecker", () => {
  test("checks once after the edits stop, in a worker, and decodes the answers", () => {
    const { checker, advance, workers, results } = setup();
    checker.check(OPEN);
    advance(100);
    checker.check(UNIQUE);
    advance(249);
    expect(workers).toHaveLength(0);
    advance(1);
    expect(workers[0].requests).toEqual([
      { id: 1, puzzle: serializePuzzle(UNIQUE), timeLimitMs: 1_000 },
    ]);
    workers[0].answer();
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("unique");
    expect(encodeEdges(results[0].solutions[0])).toBe("112211121121");
  });

  test("an idle worker is reused; a busy one is stopped and replaced, and its answer ignored", () => {
    const { checker, advance, workers, results } = setup();
    checker.check(UNIQUE);
    advance(250);
    workers[0].answer();
    checker.check(OPEN);
    advance(250);
    expect(workers).toHaveLength(1);
    checker.check(UNIQUE);
    advance(250);
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    workers[0].answer(); // the stopped thread's late answer
    expect(results).toHaveLength(1);
    workers[1].answer();
    expect(results.map((r) => r.status)).toEqual(["unique", "unique"]);
  });

  test("a check that overruns its limit is stopped and reported as unknown", () => {
    const { checker, advance, workers, results } = setup();
    checker.check(OPEN);
    advance(250);
    advance(2_999);
    expect(results).toHaveLength(0);
    advance(1);
    expect(workers[0].terminated).toBe(true);
    expect(results).toEqual([{ status: "unknown", solutions: [] }]);
  });

  test("dispose stops a pending check and the worker", () => {
    const { checker, advance, workers } = setup();
    checker.check(OPEN);
    advance(250);
    checker.check(UNIQUE);
    checker.dispose();
    advance(1_000);
    expect(workers).toHaveLength(1);
    expect(workers[0].terminated).toBe(true);
  });
});
