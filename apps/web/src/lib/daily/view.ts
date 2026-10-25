import type { AuthState } from "../auth/auth.ts";
import { formatClock } from "../game/timer.ts";
import type { Attempt, LeaderboardEntry } from "./api.ts";

/**
 * What a daily puzzle's page shows:
 * - `loading`: who is logged in, or their attempt, isn't known yet.
 * - `error`: the attempt couldn't be read; offer to try again.
 * - `gate`: a confirmed player on the daily's day with no attempt yet: offer a ranked start.
 * - `ranked`: their attempt is being played; the ranked clock runs.
 * - `solved`: their attempt is finished: the Solved screen.
 * - `unranked`: plain play, for a guest, an unconfirmed account, an earlier day's daily, or a
 *   replay after a ranked solve.
 */
export type DailyMode =
  | { readonly kind: "loading" | "error" | "gate" }
  | { readonly kind: "ranked" | "solved"; readonly attempt: Attempt }
  | {
      readonly kind: "unranked";
      readonly reason: "guest" | "unconfirmed" | "ended" | "replay";
    };

export interface DailyModeInput {
  readonly auth: AuthState;
  /** The daily is today's. */
  readonly live: boolean;
  /** The player's attempt: null for none, undefined while loading, "error" if it couldn't be read. */
  readonly attempt: Attempt | null | undefined | "error";
  /** The player chose to play a finished daily again, unranked. */
  readonly replay: boolean;
}

export function dailyMode({ auth, live, attempt, replay }: DailyModeInput): DailyMode {
  if (auth.status === "loading") return { kind: "loading" };
  if (auth.status === "guest") return { kind: "unranked", reason: "guest" };
  if (!auth.user.emailVerified) return { kind: "unranked", reason: "unconfirmed" };
  if (attempt === undefined) return { kind: "loading" };
  if (attempt === "error") return { kind: "error" };
  if (attempt === null) return live ? { kind: "gate" } : { kind: "unranked", reason: "ended" };
  if (attempt.status === "playing") return { kind: "ranked", attempt };
  return replay ? { kind: "unranked", reason: "replay" } : { kind: "solved", attempt };
}

/** A leaderboard's rows, with a gap wherever ranks jump (Solved artboard: 1, 2, 3, …, 213). */
export type BoardRow =
  | { readonly kind: "entry"; readonly entry: LeaderboardEntry }
  | { readonly kind: "gap"; readonly after: number };

export function boardRows(entries: readonly LeaderboardEntry[]): BoardRow[] {
  const rows: BoardRow[] = [];
  let last = 0;
  for (const entry of entries) {
    if (entry.rank > last + 1) rows.push({ kind: "gap", after: last });
    rows.push({ kind: "entry", entry });
    last = entry.rank;
  }
  return rows;
}

/** The name a leaderboard row shows: "You" for the viewer, "Anonymous" for a player without one. */
export function rowName(entry: LeaderboardEntry): string {
  if (entry.me) return "You";
  return entry.name ?? "Anonymous";
}

/** A daily cover's status line (Home artboard). */
export interface CoverStatus {
  readonly kind: "solved" | "playing" | "new" | "missing";
  readonly text: string;
}

export interface CoverInput {
  readonly size: number;
  /** False while the server hasn't generated the puzzle. */
  readonly ready: boolean;
  /** The player's ranked attempt, if any. */
  readonly attempt?: Attempt;
  /** Progress saved on this device or account, for play outside a ranked attempt. */
  readonly progress?: { readonly solved: boolean; readonly elapsedMs: number } | null;
}

export function coverStatus({ size, ready, attempt, progress }: CoverInput): CoverStatus {
  if (!ready) return { kind: "missing", text: "Not ready yet" };
  if (attempt?.status === "finished") {
    return { kind: "solved", text: `Solved · ${formatClock(attempt.elapsedMs)}` };
  }
  if (attempt?.status === "playing") return { kind: "playing", text: "In progress · ranked" };
  if (progress?.solved)
    return { kind: "solved", text: `Solved · ${formatClock(progress.elapsedMs)}` };
  if (progress)
    return { kind: "playing", text: `In progress · ${formatClock(progress.elapsedMs)}` };
  return { kind: "new", text: size >= 40 ? "New · best on a big screen" : "New · not started" };
}

/** The share text for a finished daily (Solved artboard's share button). */
export function shareText(name: string, size: number, dayLabel: string, attempt: Attempt): string {
  const place = attempt.rank === null ? "" : ` · #${attempt.rank}`;
  return `Loophole daily · ${name} ${size}×${size} · ${dayLabel} · ${formatClock(attempt.elapsedMs)}${place}`;
}

/** What the play screen needs for a ranked attempt (PRD FR-17, FR-25). */
export interface RankedPlay {
  /** The ranked clock when the screen opened, as the server measured it. */
  readonly elapsedMs: number;
  /** Called once the board is solved, with the board and the ranked clock. */
  readonly onsolve: (edges: Uint8Array, elapsedMs: number) => void;
  /** The line on the solved card while the server checks the solve. */
  readonly status: string;
}
