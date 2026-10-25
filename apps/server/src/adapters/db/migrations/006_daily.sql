-- Daily puzzles (PRD FR-22), ranked attempts at them and leaderboards (FR-17, FR-23 to FR-25), and
-- the names players show on leaderboards. Times are milliseconds since the epoch.

-- Players can't see a puzzle before this time. Only daily puzzles have one (00:00 UTC on their
-- day); they are listed on their own, never with practice puzzles.
ALTER TABLE puzzles ADD COLUMN release_at INTEGER;

-- One puzzle per UTC day and size class, the same for everyone. The worker generates them days
-- ahead; `attempt` goes up when a generation fails, and the seed is derived from day, size,
-- attempt and a server secret.
CREATE TABLE dailies (
  day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  size INTEGER NOT NULL CHECK (size BETWEEN 1 AND 100),
  attempt INTEGER NOT NULL CHECK (attempt >= 0),
  job_id TEXT NOT NULL,
  -- Null until the worker has stored the puzzle.
  puzzle_id TEXT UNIQUE REFERENCES puzzles (id),
  generator_version TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (day, size)
) STRICT;

-- A player's one ranked attempt at a daily puzzle. It belongs to the account and goes with it
-- (NFR-6), which also takes it off every leaderboard.
CREATE TABLE attempts (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  puzzle_id TEXT NOT NULL REFERENCES puzzles (id),
  day TEXT NOT NULL,
  -- The leaderboard bucket (FR-23): width × height, and the puzzle's level (1 for all, FR-29).
  area INTEGER NOT NULL CHECK (area >= 1),
  level INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  -- Null while the attempt is being played.
  finished_at INTEGER,
  -- The ranked time; null while playing.
  time_ms INTEGER CHECK (time_ms >= 0),
  assisted INTEGER NOT NULL CHECK (assisted IN (0, 1)),
  -- 1 when the finished solve counts on leaderboards: no hint and a plausible time.
  ranked INTEGER NOT NULL CHECK (ranked IN (0, 1)),
  PRIMARY KEY (user_id, puzzle_id)
) STRICT;

CREATE INDEX attempts_by_puzzle ON attempts (puzzle_id, ranked, time_ms);
CREATE INDEX attempts_by_bucket ON attempts (area, level, ranked, time_ms);
CREATE INDEX attempts_by_user_day ON attempts (user_id, day);

-- The name a player chose to show on leaderboards; players without one show as anonymous. Public
-- on purpose, and deleted with the account (DECISIONS, "Display names"). Names are ASCII, so
-- NOCASE makes them unique ignoring case.
CREATE TABLE display_names (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 3 AND 20),
  updated_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX display_names_by_name ON display_names (name COLLATE NOCASE);
