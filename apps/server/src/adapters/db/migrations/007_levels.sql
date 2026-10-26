-- Difficulty levels (PRD FR-7, FR-23, FR-29).

-- A puzzle's and a ranked attempt's level are named: 'easy', 'medium' or 'hard' (core's LEVELS).
-- Until now every row held 1, which meant hard, the only level there was, so dropping the old
-- column and adding the new one with 'hard' as its default keeps every existing row hard.
ALTER TABLE puzzles DROP COLUMN level;
ALTER TABLE puzzles ADD COLUMN level TEXT NOT NULL DEFAULT 'hard'
  CHECK (level IN ('easy', 'medium', 'hard'));

DROP INDEX attempts_by_bucket;
ALTER TABLE attempts DROP COLUMN level;
ALTER TABLE attempts ADD COLUMN level TEXT NOT NULL DEFAULT 'hard'
  CHECK (level IN ('easy', 'medium', 'hard'));
CREATE INDEX attempts_by_bucket ON attempts (area, level, ranked, time_ms);
