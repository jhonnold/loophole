-- The order workers claim jobs in, and who queued a player's generation (DECISIONS, WT21 "Worker
-- fairness").

-- Workers claim the queued job with the lowest priority first, oldest first within one: 0 for
-- verifications, 1 for daily puzzles, 2 for players' generations (JOB_PRIORITY). Jobs queued
-- before this migration get theirs from their kind and input.
ALTER TABLE jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 2 CHECK (priority >= 0);
UPDATE jobs SET priority = 0 WHERE kind = 'verify';
UPDATE jobs SET priority = 1 WHERE kind = 'generate' AND json_extract(payload, '$.day') IS NOT NULL;
CREATE INDEX jobs_by_claim_order ON jobs (status, priority, created_at);

-- Who asked for a player's generation (`user:<id>`, or `ip:<address>` for a guest), so each
-- requester has a cap on generations queued or running at once. Null for verifications and daily
-- puzzles, and set to null when the job ends, so no address or account outlives its job (NFR-6).
ALTER TABLE jobs ADD COLUMN requester TEXT;
CREATE INDEX jobs_by_requester ON jobs (requester, status) WHERE requester IS NOT NULL;
