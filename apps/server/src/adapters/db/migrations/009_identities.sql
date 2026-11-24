-- Single sign-on through an OpenID Connect provider (PRD FR-30, NFR-6; DECISIONS, "Single sign-on").

-- Which account each provider identity logs in to. `subject` is the provider's stable id for the
-- player (the ID token's `sub`), unique per issuer. An account can have several.
CREATE TABLE identities (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (issuer, subject)
) STRICT;

CREATE INDEX identities_by_user ON identities (user_id);

-- 0 for an account made through single sign-on: its password_hash is the hash of a random password
-- nobody knows, so it is deleted without one. A password reset sets it to 1. Every account made
-- before this migration has a password.
ALTER TABLE users ADD COLUMN has_password INTEGER NOT NULL DEFAULT 1 CHECK (has_password IN (0, 1));
