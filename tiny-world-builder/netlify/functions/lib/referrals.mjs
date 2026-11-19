import { coinsTransaction } from './coins.mjs';
import { currentCycleId } from '../../../packages/tinyworld-mmo-core/src/index.js';

// G1 — referral rewards. Earned, not given: the referrer is paid Earned GOLD only after
// the referee completes a verified action (publishing a world). Capped per cycle.
export const REFERRER_REWARD = 50;
export const REFEREE_REWARD = 25;
export const MAX_REWARDS_PER_CYCLE = 10; // per referrer per weekly cycle

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I

export function isValidReferralCode(code) {
  return typeof code === 'string' && /^[A-Za-z0-9]{6,16}$/.test(code.trim());
}

export function randomReferralCode(len = 8) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

// Return the profile's referral code, generating + persisting a unique one if absent.
export async function ensureReferralCode(sql, profileId) {
  const cur = await sql`SELECT referral_code FROM profiles WHERE id = ${Number(profileId)}`;
  if (cur.length && cur[0].referral_code) return cur[0].referral_code;
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomReferralCode();
    try {
      const upd = await sql`
        UPDATE profiles SET referral_code = ${code}, updated_at = NOW()
        WHERE id = ${Number(profileId)} AND referral_code IS NULL
        RETURNING referral_code
      `;
      if (upd.length) return upd[0].referral_code;
      // Already set concurrently — read it back.
      const re = await sql`SELECT referral_code FROM profiles WHERE id = ${Number(profileId)}`;
      if (re.length && re[0].referral_code) return re[0].referral_code;
    } catch (e) { /* unique collision on the code — retry with a new one */ }
  }
  return null;
}

// Record that `refereeId` was referred by the owner of `code`. Idempotent (referee is
// UNIQUE). Returns { ok, reason }. Validations: code exists, not self, referee not
// already referred.
export async function recordReferral(sql, { refereeId, code }) {
  const ref = Number(refereeId);
  if (!isValidReferralCode(code)) return { ok: false, reason: 'invalid-code' };
  const owner = await sql`SELECT id FROM profiles WHERE referral_code = ${String(code).trim()} LIMIT 1`;
  if (!owner.length) return { ok: false, reason: 'code-not-found' };
  const referrer = Number(owner[0].id);
  if (referrer === ref) return { ok: false, reason: 'self-referral' };
  const ins = await sql`
    INSERT INTO referrals (referrer_profile_id, referee_profile_id, code, status)
    VALUES (${referrer}, ${ref}, ${String(code).trim()}, 'pending')
    ON CONFLICT (referee_profile_id) DO NOTHING
    RETURNING id
  `;
  if (!ins.length) return { ok: false, reason: 'already-referred' };
  return { ok: true, referrerId: referrer };
}

// Called when a referee completes the VERIFIED action (publishes a world). Pays the
// referrer + referee once, atomically, if a pending referral exists and the referrer is
// under their per-cycle cap. Safe to call on every publish (idempotent: pending->rewarded
// under a lock; never double-pays). Returns { rewarded:boolean, reason? }.
export async function maybeRewardReferral(sql, refereeId, now = new Date()) {
  const ref = Number(refereeId);
  if (!Number.isInteger(ref) || ref < 1) return { rewarded: false, reason: 'invalid-referee' };
  const cycleId = currentCycleId(now);
  try {
    return await coinsTransaction(sql, async ({ credit, tx }) => {
      // Serialize on the referee so the pending->rewarded transition is exactly-once.
      await tx`SELECT pg_advisory_xact_lock(hashtext(${'ref:' + ref})::bigint)`;
      const rows = await tx`
        SELECT id, referrer_profile_id FROM referrals
        WHERE referee_profile_id = ${ref} AND status = 'pending'
        FOR UPDATE
      `;
      if (!rows.length) return { rewarded: false, reason: 'no-pending' };
      const referralId = Number(rows[0].id);
      const referrer = Number(rows[0].referrer_profile_id);

      // Anti-Sybil: the referee must have a VERIFIED wallet before the reward pays.
      // Each fake referee would need a distinct real Solana keypair + the signature
      // flow — far harder to farm than free accounts. If not yet, leave it pending
      // (it pays on a later publish once they've linked + verified a wallet).
      const w = await tx`SELECT 1 FROM wallet_accounts WHERE profile_id = ${ref} AND verified_at IS NOT NULL LIMIT 1`;
      if (!w.length) return { rewarded: false, reason: 'referee-no-verified-wallet' };

      // Race-free per-referrer per-cycle cap: atomic increment that only succeeds while
      // under the cap. Empty RETURNING => cap reached. Increment rolls back with the tx
      // if a later credit fails, so the counter only counts paid rewards.
      const cap = await tx`
        INSERT INTO referral_reward_counters (referrer_profile_id, cycle_id, count)
        VALUES (${referrer}, ${cycleId}, 1)
        ON CONFLICT (referrer_profile_id, cycle_id)
        DO UPDATE SET count = referral_reward_counters.count + 1
        WHERE referral_reward_counters.count < ${MAX_REWARDS_PER_CYCLE}
        RETURNING count
      `;
      if (!cap.length) {
        await tx`UPDATE referrals SET status = 'rejected', cycle_id = ${cycleId} WHERE id = ${referralId}`;
        return { rewarded: false, reason: 'cap-reached' };
      }

      const rc = await credit({ profileId: referrer, amount: REFERRER_REWARD, type: 'CREDIT', reason: `referral:${ref}`, referenceId: `refrwd-${ref}`, counterpartyProfileId: ref });
      if (!rc.ok) throw new Error('referrer-credit-failed:' + rc.reason);
      const ec = await credit({ profileId: ref, amount: REFEREE_REWARD, type: 'CREDIT', reason: `referred-bonus:${referrer}`, referenceId: `refbns-${ref}`, counterpartyProfileId: referrer });
      if (!ec.ok) throw new Error('referee-credit-failed:' + ec.reason);

      await tx`UPDATE referrals SET status = 'rewarded', cycle_id = ${cycleId}, rewarded_at = NOW() WHERE id = ${referralId}`;
      return { rewarded: true, referrer, referrerReward: REFERRER_REWARD, refereeReward: REFEREE_REWARD };
    });
  } catch (e) {
    // A referral reward must NEVER break the action that triggered it (e.g. publish).
    return { rewarded: false, reason: 'error:' + (e.message || e).slice(0, 60) };
  }
}
