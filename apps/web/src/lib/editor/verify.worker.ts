// The editor's check thread: runs the verifier on each draft it is sent (see checker.ts).
import { answerCheck, type CheckRequest } from "./checker.ts";

declare const self: Worker;

self.onmessage = (event: MessageEvent<CheckRequest>) => {
  self.postMessage(answerCheck(event.data));
};
