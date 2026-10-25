-- Accounts (PRD FR-18, FR-20, NFR-6): only the email, the password hash and gameplay data are
-- stored. Rows that belong to a user reference users(id) ON DELETE CASCADE, so deleting the user
-- deletes them. Times are milliseconds since the epoch.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  -- Trimmed and lower-cased by the account manager.
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_verified_at INTEGER,
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  created_at INTEGER NOT NULL
) STRICT;

-- Login sessions. Only a SHA-256 hash of the cookie's token is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX sessions_by_user ON sessions (user_id);
CREATE INDEX sessions_by_expiry ON sessions (expires_at);

-- Single-use email verification and password reset tokens, stored as SHA-256 hashes.
CREATE TABLE account_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify-email', 'reset-password')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX account_tokens_by_user ON account_tokens (user_id, purpose);
CREATE INDEX account_tokens_by_expiry ON account_tokens (expires_at);
