import type { Task, TaskOutcome, TaskOutput } from "../../domain.ts";
import type { TaskRunner, TaskRunOptions } from "../../ports.ts";

/** Messages from `task-thread.ts`. */
export type ThreadMessage =
  | { readonly type: "progress"; readonly progress: number }
  | { readonly type: "done"; readonly output: TaskOutput }
  | { readonly type: "failed"; readonly error: string };

const THREAD_URL = new URL("./task-thread.ts", import.meta.url).href;

/**
 * Runs each task in a fresh Bun Worker thread. Generation is synchronous and cannot be
 * interrupted from inside, so the time limit (and any cancel) is `Worker.terminate()`.
 */
export class ThreadTaskRunner implements TaskRunner {
  readonly #threadUrl: string;

  /** `threadUrl` is for tests; the default runs the real task thread. */
  constructor(threadUrl = THREAD_URL) {
    this.#threadUrl = threadUrl;
  }

  run(task: Task, { timeoutMs, onProgress }: TaskRunOptions): Promise<TaskOutcome> {
    return new Promise((resolve) => {
      const thread = new Worker(this.#threadUrl);
      let settled = false;
      const settle = (outcome: TaskOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        thread.terminate();
        resolve(outcome);
      };
      const timer = setTimeout(() => settle({ status: "timeout" }), timeoutMs);
      thread.onmessage = (event: MessageEvent<ThreadMessage>) => {
        const message = event.data;
        if (message.type === "progress") {
          if (!settled) onProgress(message.progress);
        } else if (message.type === "done") {
          settle({ status: "done", output: message.output });
        } else {
          settle({ status: "failed", error: message.error });
        }
      };
      thread.onerror = (event) => settle({ status: "failed", error: event.message });
      // A thread that exits without answering (a crash, process.exit) would otherwise hold the
      // worker until the time limit.
      thread.addEventListener("close", () =>
        settle({ status: "failed", error: "Task thread exited without a result" }),
      );
      thread.postMessage(task);
    });
  }
}
