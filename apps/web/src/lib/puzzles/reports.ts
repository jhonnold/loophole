import type { ApiClient, Schemas } from "@loophole/api-client";
import { type AuthResult, failureMessage } from "../auth/auth.ts";

export type ReportedPuzzle = Schemas["ReportedPuzzle"];

const OFFLINE = "Couldn't reach the server. Check your connection and try again.";

/** Reporting puzzles, and the admins' side of reports (PRD FR-28). */
export function createReports(client: ApiClient) {
  async function run(
    request: () => Promise<{ response: Response; error?: unknown }>,
  ): Promise<AuthResult> {
    try {
      const { response, error } = await request();
      return response.ok
        ? { ok: true }
        : { ok: false, message: failureMessage(response.status, error) };
    } catch {
      return { ok: false, message: OFFLINE };
    }
  }

  return {
    report: (puzzleId: string, reason: string) =>
      run(() =>
        client.POST("/api/puzzles/{id}/report", {
          params: { path: { id: puzzleId } },
          body: { reason },
        }),
      ),

    /** Reported puzzles for an admin, or null when they can't be read (not an admin, offline). */
    async list(): Promise<ReportedPuzzle[] | null> {
      try {
        const { data } = await client.GET("/api/admin/reports");
        return data?.items ?? null;
      } catch {
        return null;
      }
    },

    unpublish: (puzzleId: string) =>
      run(() =>
        client.POST("/api/admin/puzzles/{id}/unpublish", { params: { path: { id: puzzleId } } }),
      ),

    dismiss: (puzzleId: string) =>
      run(() =>
        client.DELETE("/api/admin/puzzles/{id}/reports", { params: { path: { id: puzzleId } } }),
      ),
  };
}
