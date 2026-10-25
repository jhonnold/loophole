-- Saved progress, one row per player and puzzle (PRD FR-21). Deleting the user or the puzzle
-- deletes it (NFR-6). Times are milliseconds since the epoch.
CREATE TABLE progress (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  puzzle_id TEXT NOT NULL REFERENCES puzzles (id) ON DELETE CASCADE,
  -- Edge states in the wire format's encoding (docs/FORMAT.md): one 0, 1 or 2 per edge.
  edges TEXT NOT NULL CHECK (length(edges) > 0 AND edges NOT GLOB '*[^012]*'),
  elapsed_ms INTEGER NOT NULL CHECK (elapsed_ms >= 0),
  solved INTEGER NOT NULL CHECK (solved IN (0, 1)),
  assisted INTEGER NOT NULL CHECK (assisted IN (0, 1)),
  -- Goes up by one with every save that replaces the board; a save names the version it continued.
  version INTEGER NOT NULL CHECK (version >= 1),
  -- Random id of the browser that made that save; not linked to anything else.
  device TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, puzzle_id)
) STRICT;

CREATE INDEX progress_by_user_updated ON progress (user_id, updated_at);
