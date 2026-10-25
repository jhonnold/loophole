// Entry point of the thread a ThreadTaskRunner starts for each task. It runs one task and posts
// progress messages, then one final message.
import type { Task } from "../../domain.ts";
import { runTask } from "./run-task.ts";
import type { ThreadMessage } from "./thread-task-runner.ts";

declare const self: Worker;

function send(message: ThreadMessage): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<Task>) => {
  try {
    const output = runTask(event.data, (progress) => send({ type: "progress", progress }));
    send({ type: "done", output });
  } catch (err) {
    send({ type: "failed", error: err instanceof Error ? err.message : String(err) });
  }
};
