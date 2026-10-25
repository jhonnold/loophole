-- Puzzles: clues inline; the solution and the solver trace are blobs (keys below).
CREATE TABLE puzzles (
  id TEXT PRIMARY KEY,
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 100),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 100),
  clues TEXT NOT NULL CHECK (length(clues) = width * height),
  seed TEXT,
  generator_version TEXT,
  level INTEGER NOT NULL DEFAULT 1,
  origin TEXT NOT NULL CHECK (origin IN ('generated', 'submitted')),
  status TEXT NOT NULL CHECK (status IN ('published', 'unpublished')),
  solution_key TEXT NOT NULL,
  trace_key TEXT,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX puzzles_by_status_created ON puzzles (status, created_at);

-- Background jobs. Times are milliseconds since the epoch.
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed', 'timeout')),
  progress REAL NOT NULL DEFAULT 0,
  result TEXT CHECK (result IS NULL OR json_valid(result)),
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_by TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  heartbeat_at INTEGER,
  finished_at INTEGER
) STRICT;

CREATE INDEX jobs_by_status_created ON jobs (status, created_at);
