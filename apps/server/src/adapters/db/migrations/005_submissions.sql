-- Puzzles players submit (PRD FR-26 to FR-28). Times are milliseconds since the epoch.

-- Who submitted a puzzle; null for generated ones. Deleting the account keeps the published puzzle
-- and drops the link (DECISIONS, "Submitted puzzles outlive their creator's account").
ALTER TABLE puzzles ADD COLUMN creator_id TEXT REFERENCES users (id) ON DELETE SET NULL;

-- Finds a stored puzzle with the same clues, so each clue grid is published once.
CREATE INDEX puzzles_by_clues ON puzzles (width, height, clues);

-- Each submission and the verifier's verdict on it, for its creator to see. They belong to the
-- account and go with it.
CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 100),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 100),
  clues TEXT NOT NULL CHECK (length(clues) = width * height),
  status TEXT NOT NULL CHECK (status IN ('pending', 'published', 'rejected')),
  verdict TEXT CHECK (
    verdict IN ('unique', 'duplicate', 'none', 'multiple', 'unknown', 'removed', 'error')
  ),
  -- The published puzzle: this submission's own, or the earlier one with the same clues.
  puzzle_id TEXT REFERENCES puzzles (id) ON DELETE SET NULL,
  -- The verification job; null when the submission was decided without one (a duplicate).
  job_id TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
) STRICT;

CREATE INDEX submissions_by_user ON submissions (user_id, created_at);

-- Players' reports of published puzzles (FR-28). One per player and puzzle; reporting again
-- replaces the reason.
CREATE TABLE reports (
  puzzle_id TEXT NOT NULL REFERENCES puzzles (id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (puzzle_id, reporter_id)
) STRICT;

CREATE INDEX reports_by_created ON reports (created_at);
