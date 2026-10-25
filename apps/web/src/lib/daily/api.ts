import type { ApiClient, Schemas } from "@loophole/api-client";
import { failureMessage } from "../auth/auth.ts";

export type DailySet = Schemas["DailySet"];
export type DailySummary = Schemas["DailySummary"];
export type Attempt = Schemas["Attempt"];
export type Leaderboard = Schemas["Leaderboard"];
export type LeaderboardEntry = Schemas["LeaderboardEntry"];

/** A request's outcome. `status` 0 means the server couldn't be reached. */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly status: number; readonly message: string };

const OFFLINE = "Couldn't reach the server. Check your connection and try again.";

/** How many rows a leaderboard shows above the player's own (Solved artboard). */
export const BOARD_LIMIT = 10;

/**
 * Daily puzzles, ranked attempts, leaderboards and display names from the API (PRD FR-22 to
 * FR-25). Reads answer null when the server can't be reached; actions answer a `Result`.
 */
export function createDailyApi(client: ApiClient) {
  async function run<T>(
    request: () => Promise<{ data?: unknown; error?: unknown; response: Response }>,
    pick: (data: never) => T,
  ): Promise<Result<T>> {
    try {
      const { data, error, response } = await request();
      if (response.ok && data !== undefined) return { ok: true, value: pick(data as never) };
      return {
        ok: false,
        status: response.status,
        message: failureMessage(response.status, error),
      };
    } catch {
      return { ok: false, status: 0, message: OFFLINE };
    }
  }

  async function read<T>(request: () => Promise<{ data?: T }>): Promise<T | null> {
    try {
      return (await request()).data ?? null;
    } catch {
      return null;
    }
  }

  return {
    /** A day's daily puzzles (today by default), or null when the server can't be reached. */
    day: (day?: string) =>
      read(() => client.GET("/api/daily", { params: { query: day === undefined ? {} : { day } } })),

    /** A day's daily puzzles, or why not: 404 for a day to come, 400 for a bad day, 0 offline. */
    dayResult: (day: string) =>
      run(
        () => client.GET("/api/daily", { params: { query: { day } } }),
        (data: DailySet) => data,
      ),

    summary: (userId: string) =>
      read(() => client.GET("/api/users/{userId}/daily", { params: { path: { userId } } })),

    /** The player's attempt at a daily (null for none), or a failure. */
    attempt: (userId: string, puzzleId: string) =>
      run(
        () =>
          client.GET("/api/users/{userId}/attempts/{puzzleId}", {
            params: { path: { userId, puzzleId } },
          }),
        (data: Schemas["AttemptResult"]) => data.attempt,
      ),

    start: (userId: string, puzzleId: string) =>
      run(
        () =>
          client.POST("/api/users/{userId}/attempts/{puzzleId}", {
            params: { path: { userId, puzzleId } },
          }),
        (data: Schemas["StartedAttempt"]) => data.attempt,
      ),

    finish: (userId: string, puzzleId: string, edges: string, elapsedMs: number) =>
      run(
        () =>
          client.POST("/api/users/{userId}/attempts/{puzzleId}/finish", {
            params: { path: { userId, puzzleId } },
            body: { edges, elapsedMs: Math.max(0, Math.round(elapsedMs)) },
          }),
        (data: Schemas["StartedAttempt"]) => data.attempt,
      ),

    /** A daily's leaderboard, or null when it can't be read. */
    puzzleBoard: (puzzleId: string, limit = BOARD_LIMIT) =>
      read(() =>
        client.GET("/api/leaderboards/daily/{puzzleId}", {
          params: { path: { puzzleId }, query: { limit } },
        }),
      ),

    /** The all-time leaderboard of an area (width × height), or null when it can't be read. */
    bucketBoard: (area: number, limit = BOARD_LIMIT) =>
      read(() =>
        client.GET("/api/leaderboards/areas/{area}", {
          params: { path: { area }, query: { limit, level: 1 } },
        }),
      ),

    displayName: (userId: string) =>
      run(
        () => client.GET("/api/users/{userId}/display-name", { params: { path: { userId } } }),
        (data: Schemas["DisplayName"]) => data.displayName,
      ),

    setDisplayName: (userId: string, displayName: string | null) =>
      run(
        () =>
          client.PUT("/api/users/{userId}/display-name", {
            params: { path: { userId } },
            body: { displayName },
          }),
        (data: Schemas["DisplayName"]) => data.displayName,
      ),
  };
}

export type DailyApi = ReturnType<typeof createDailyApi>;
