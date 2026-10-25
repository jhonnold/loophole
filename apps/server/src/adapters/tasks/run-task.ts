import { encodeEdges, generate, parsePuzzle, serializePuzzle, verify } from "@loophole/core";
import type { Task, TaskOutput } from "../../domain.ts";

/**
 * Share of a generation's progress given to clue removal tests; the whole-board solves after the
 * last test make no progress calls (DECISIONS "Generation progress and cancellation").
 */
const REMOVAL_SHARE = 0.9;

/**
 * Runs one task to the end on the calling thread. `onProgress` gets values from 0 to 1, only when
 * the whole percent changes. Throws what the core throws for bad input.
 */
export function runTask(task: Task, onProgress: (progress: number) => void): TaskOutput {
  let lastPercent = 0;
  const report = (progress: number) => {
    const percent = Math.floor(progress * 100);
    if (percent <= lastPercent) return;
    lastPercent = percent;
    onProgress(percent / 100);
  };
  switch (task.kind) {
    case "generate": {
      const { width, height, seed } = task.input;
      const result = generate({
        width,
        height,
        seed,
        onProgress: ({ done, total }) => report((REMOVAL_SHARE * done) / total),
      });
      return {
        kind: "generate",
        generated: {
          puzzle: serializePuzzle(result.puzzle),
          solution: encodeEdges(result.solution),
          steps: result.solve.steps,
        },
      };
    }
    case "verify": {
      // Default time budget: 30 s (PRD NFR-1). The task runner's timeout is the outer limit.
      const result = verify(parsePuzzle(task.input.puzzle));
      return {
        kind: "verify",
        verified: { status: result.status, solutions: result.solutions.map(encodeEdges) },
      };
    }
  }
}
