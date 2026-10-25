import { createApiClient } from "@loophole/api-client";
import { browserStorage } from "../game/progress.ts";
import { createDailyApi } from "./api.ts";
import { createFinisher, type Finisher } from "./finish.ts";

export type {
  Attempt,
  DailySet,
  DailySummary,
  Leaderboard,
  LeaderboardEntry,
} from "./api.ts";
export { BOARD_LIMIT } from "./api.ts";

/** The app's daily puzzle, ranked attempt and leaderboard client. */
export const daily = createDailyApi(createApiClient());

/** Sends a player's ranked solves, keeping them on this device until the server has them. */
export function finisherFor(userId: string): Finisher {
  return createFinisher({
    userId,
    storage: browserStorage(),
    finish: (puzzleId, edges, elapsedMs) => daily.finish(userId, puzzleId, edges, elapsedMs),
  });
}
