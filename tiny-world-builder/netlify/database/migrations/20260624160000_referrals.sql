-- G1 — referral rewards (earned, not given). A referrer earns Earned GOLD only AFTER
-- the referee completes a verified action (publishes a world). Each user can be
-- referred at most once (referee UNIQUE); self-referral is blocked; rewards are capped
-- per referrer per weekly cycle.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referral_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_referral_code
  ON profiles (referral_code) WHERE referral_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS referrals (
  id BIGSERIAL PRIMARY KEY,
  referrer_profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referee_profile_id BIGINT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'rewarded', 'rejected')),
  cycle_id TEXT,
  rewarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT referrals_no_self CHECK (referrer_profile_id <> referee_profile_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals (referrer_profile_id, status);

-- Race-free per-referrer per-cycle reward cap: a single counter row updated atomically
-- (INSERT ... ON CONFLICT DO UPDATE ... WHERE count < cap RETURNING) so concurrent
-- payouts for different referees under one referrer can't all slip past the cap.
CREATE TABLE IF NOT EXISTS referral_reward_counters (
  referrer_profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cycle_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (referrer_profile_id, cycle_id)
);
