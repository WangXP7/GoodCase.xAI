CREATE TABLE IF NOT EXISTS wallet_auth_challenges (
  id BIGSERIAL PRIMARY KEY,
  profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  nonce TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wallet_auth_public_key_format CHECK (public_key ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
);

CREATE INDEX IF NOT EXISTS wallet_auth_challenges_profile_key_idx
  ON wallet_auth_challenges (profile_id, public_key, expires_at DESC);

CREATE TABLE IF NOT EXISTS wallet_accounts (
  id BIGSERIAL PRIMARY KEY,
  profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'phantom',
  public_key TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  token_balance_atomic TEXT NOT NULL DEFAULT '0',
  token_balance_ui TEXT NOT NULL DEFAULT '0',
  token_decimals INTEGER NOT NULL DEFAULT 0,
  token_accounts JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_activity JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wallet_accounts_public_key_format CHECK (public_key ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  CONSTRAINT wallet_accounts_provider_key UNIQUE (profile_id, provider),
  CONSTRAINT wallet_accounts_public_key_unique UNIQUE (public_key)
);

CREATE INDEX IF NOT EXISTS wallet_accounts_profile_idx
  ON wallet_accounts (profile_id);

CREATE TABLE IF NOT EXISTS wallet_payment_intents (
  id BIGSERIAL PRIMARY KEY,
  profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reference_key TEXT NOT NULL UNIQUE,
  payer_wallet TEXT,
  recipient_wallet TEXT NOT NULL,
  token_mint TEXT,
  amount TEXT NOT NULL,
  label TEXT NOT NULL,
  message TEXT NOT NULL,
  memo TEXT NOT NULL,
  solana_pay_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wallet_payment_reference_format CHECK (reference_key ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  CONSTRAINT wallet_payment_recipient_format CHECK (recipient_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  CONSTRAINT wallet_payment_status CHECK (status IN ('pending', 'submitted', 'paid', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS wallet_payment_intents_profile_idx
  ON wallet_payment_intents (profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS player_presence (
  profile_id BIGINT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'online',
  room_id TEXT,
  party_id TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS player_presence_seen_idx
  ON player_presence (last_seen_at DESC);

CREATE TABLE IF NOT EXISTS player_chat_requests (
  id BIGSERIAL PRIMARY KEY,
  requester_profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT player_chat_status CHECK (status IN ('pending', 'accepted', 'declined', 'blocked')),
  CONSTRAINT player_chat_distinct CHECK (requester_profile_id <> recipient_profile_id),
  CONSTRAINT player_chat_request_unique UNIQUE (requester_profile_id, recipient_profile_id)
);

CREATE INDEX IF NOT EXISTS player_chat_requests_recipient_idx
  ON player_chat_requests (recipient_profile_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS player_parties (
  id TEXT PRIMARY KEY,
  owner_profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  room_id TEXT NOT NULL UNIQUE,
  voice_room TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT player_parties_id_format CHECK (id ~ '^[A-Za-z0-9_-]{8,40}$')
);

CREATE INDEX IF NOT EXISTS player_parties_owner_idx
  ON player_parties (owner_profile_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS player_party_members (
  party_id TEXT NOT NULL REFERENCES player_parties(id) ON DELETE CASCADE,
  profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (party_id, profile_id),
  CONSTRAINT player_party_role CHECK (role IN ('owner', 'member'))
);

CREATE INDEX IF NOT EXISTS player_party_members_profile_idx
  ON player_party_members (profile_id, joined_at DESC);
