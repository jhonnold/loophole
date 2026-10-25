import type { ReportedPuzzle, ReportRecord } from "../domain.ts";
import type { Clock, RateLimiter, RateRule, ReportRepository } from "../ports.ts";
import { RateLimitedError } from "./errors.ts";
import type { PuzzleManager } from "./puzzle-manager.ts";

/** Reports one account may send (DECISIONS, "Reports and unpublishing"). */
export const REPORTS_PER_ACCOUNT: RateRule = { limit: 20, windowMs: 60 * 60 * 1000 };

/** How many reports the admins' list reads, and how many it shows per puzzle. */
const LIST_REPORTS = 500;
const REPORTS_PER_PUZZLE = 5;

export interface ReportManagerDeps {
  readonly reports: ReportRepository;
  readonly puzzles: PuzzleManager;
  readonly limiter: RateLimiter;
  readonly clock: Clock;
}

/** Players report published puzzles; admins see the reports and dismiss them (PRD FR-28). */
export class ReportManager {
  readonly #deps: ReportManagerDeps;

  constructor(deps: ReportManagerDeps) {
    this.#deps = deps;
  }

  /**
   * Records `userId`'s report of a published puzzle, replacing their earlier one. Returns false
   * when there is no published puzzle with this id. Throws `RateLimitedError` past the limit.
   */
  report(userId: string, puzzleId: string, reason: string): boolean {
    const { reports, puzzles, limiter, clock } = this.#deps;
    const decision = limiter.hit(`report:${userId}`, REPORTS_PER_ACCOUNT);
    if (!decision.allowed) throw new RateLimitedError(decision.retryAfterMs);
    if (puzzles.get(puzzleId) === null) return false;
    reports.upsert({ puzzleId, reporterId: userId, reason, createdAt: clock.now() });
    return true;
  }

  /** Published puzzles with reports, the most recently reported first. */
  listReported(): ReportedPuzzle[] {
    const { reports, puzzles } = this.#deps;
    const byPuzzle = new Map<string, ReportRecord[]>();
    for (const r of reports.listForPublished(LIST_REPORTS)) {
      const list = byPuzzle.get(r.puzzleId) ?? [];
      list.push(r);
      byPuzzle.set(r.puzzleId, list);
    }
    const out: ReportedPuzzle[] = [];
    for (const [id, list] of byPuzzle) {
      const puzzle = puzzles.get(id);
      if (puzzle === null) continue;
      out.push({ puzzle, count: list.length, reports: list.slice(0, REPORTS_PER_PUZZLE) });
    }
    return out;
  }

  /** Clears a puzzle's reports, keeping it published. */
  dismiss(puzzleId: string): void {
    this.#deps.reports.deleteForPuzzle(puzzleId);
  }
}
