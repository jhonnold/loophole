import { describe, expect, test } from "bun:test";
import type { AuthState, User } from "../auth/auth.ts";
import type { Attempt, LeaderboardEntry } from "./api.ts";
import { boardRows, coverStatus, dailyMode, rowName, shareText } from "./view.ts";

const USER: User = {
  id: "u1",
  email: "ann@example.com",
  emailVerified: true,
  isAdmin: false,
  createdAt: "2026-10-25T00:00:00.000Z",
};
const confirmed: AuthState = { status: "user", user: USER };
const unconfirmed: AuthState = { status: "user", user: { ...USER, emailVerified: false } };

const PLAYING: Attempt = {
  puzzleId: "d1",
  day: "2026-10-25",
  area: 49,
  level: "hard",
  status: "playing",
  startedAt: "2026-10-25T10:00:00.000Z",
  finishedAt: null,
  elapsedMs: 400_000,
  assisted: false,
  ranked: false,
  rank: null,
};
const FINISHED: Attempt = {
  ...PLAYING,
  status: "finished",
  finishedAt: "2026-10-25T10:03:18.000Z",
  elapsedMs: 198_000,
  ranked: true,
  rank: 214,
};

describe("dailyMode", () => {
  test("guests and unconfirmed accounts play unranked", () => {
    const base = { live: true, attempt: null, replay: false };
    expect(dailyMode({ ...base, auth: { status: "loading" } })).toEqual({ kind: "loading" });
    expect(dailyMode({ ...base, auth: { status: "guest" } })).toEqual({
      kind: "unranked",
      reason: "guest",
    });
    expect(dailyMode({ ...base, auth: unconfirmed })).toEqual({
      kind: "unranked",
      reason: "unconfirmed",
    });
  });

  test("a confirmed player gets the ranked start on the daily's day only", () => {
    const base = { auth: confirmed, replay: false };
    expect(dailyMode({ ...base, live: true, attempt: undefined })).toEqual({ kind: "loading" });
    expect(dailyMode({ ...base, live: true, attempt: "error" })).toEqual({ kind: "error" });
    expect(dailyMode({ ...base, live: true, attempt: null })).toEqual({ kind: "gate" });
    expect(dailyMode({ ...base, live: false, attempt: null })).toEqual({
      kind: "unranked",
      reason: "ended",
    });
  });

  test("an attempt is played ranked, then shows the Solved screen, then can be replayed", () => {
    const base = { auth: confirmed, live: false };
    expect(dailyMode({ ...base, attempt: PLAYING, replay: false })).toEqual({
      kind: "ranked",
      attempt: PLAYING,
    });
    expect(dailyMode({ ...base, attempt: FINISHED, replay: false })).toEqual({
      kind: "solved",
      attempt: FINISHED,
    });
    expect(dailyMode({ ...base, attempt: FINISHED, replay: true })).toEqual({
      kind: "unranked",
      reason: "replay",
    });
  });
});

describe("leaderboard rows", () => {
  const entry = (rank: number, me = false, name: string | null = null): LeaderboardEntry => ({
    rank,
    name,
    timeMs: rank * 1000,
    me,
  });

  test("put a gap wherever ranks jump", () => {
    const rows = boardRows([entry(1), entry(2), entry(3), entry(213), entry(214, true)]);
    expect(rows.map((r) => (r.kind === "gap" ? "…" : r.entry.rank))).toEqual([
      1,
      2,
      3,
      "…",
      213,
      214,
    ]);
    expect(boardRows([entry(5, true)]).map((r) => r.kind)).toEqual(["gap", "entry"]);
    expect(boardRows([])).toEqual([]);
  });

  test("name the viewer You and players without a name Anonymous", () => {
    expect(rowName(entry(1, false, "tsuru"))).toBe("tsuru");
    expect(rowName(entry(1))).toBe("Anonymous");
    expect(rowName(entry(1, true, "kuroneko"))).toBe("You");
  });
});

describe("coverStatus", () => {
  test("shows a ranked attempt first, then progress on the device, then new", () => {
    expect(coverStatus({ size: 7, ready: true, attempt: FINISHED })).toEqual({
      kind: "solved",
      text: "Solved · 03:18",
    });
    expect(coverStatus({ size: 7, ready: true, attempt: PLAYING }).text).toBe(
      "In progress · ranked",
    );
    expect(
      coverStatus({ size: 10, ready: true, progress: { solved: false, elapsedMs: 400_000 } }),
    ).toEqual({ kind: "playing", text: "In progress · 06:40" });
    expect(coverStatus({ size: 20, ready: true, progress: null }).text).toBe("New · not started");
    expect(coverStatus({ size: 40, ready: true }).text).toBe("New · best on a big screen");
    expect(coverStatus({ size: 40, ready: false }).kind).toBe("missing");
  });
});

test("shareText sums up a finished daily", () => {
  expect(shareText("Small", 7, "25 Oct", FINISHED)).toBe(
    "Loophole daily · Small 7×7 · 25 Oct · 03:18 · #214",
  );
  expect(shareText("Small", 7, "25 Oct", { ...FINISHED, rank: null })).toBe(
    "Loophole daily · Small 7×7 · 25 Oct · 03:18",
  );
});
