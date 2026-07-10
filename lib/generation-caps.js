'use strict';

const supabase = require('../supabase');
const { getPlanLimits } = require('./plan-limits');

const STARTER_HARD_CAP = 10;
const STARTER_FREE_REGENS = 3; // regens 1–3 included; 4th+ consumes a slot
const PRO_SOFT_CAP = 150;
const PEAK_MONTHS = new Set([7, 8, 9]); // Aug–Oct (0-indexed)

function isPeakSeason(d = new Date()) {
  return PEAK_MONTHS.has(d.getUTCMonth());
}

function isAnnualPriority(profile) {
  return profile?.plan_type === 'annual' && isPeakSeason();
}

/** Period start for generation counter reset */
function getPeriodStart(profile, now = new Date()) {
  const plan = profile?.plan_type || 'monthly';
  if (plan === 'cycle' && profile.cycle_started_at) {
    const start = new Date(profile.cycle_started_at);
    const monthsSince = (now.getUTCFullYear() - start.getUTCFullYear()) * 12
      + (now.getUTCMonth() - start.getUTCMonth());
    const periodIndex = Math.floor(Math.max(0, monthsSince) / 1); // monthly buckets within cycle
    const bucket = new Date(start);
    bucket.setUTCMonth(start.getUTCMonth() + periodIndex);
    bucket.setUTCDate(1);
    bucket.setUTCHours(0, 0, 0, 0);
    return bucket;
  }
  const monthStart = new Date(now);
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  return monthStart;
}

function cycleExpired(profile, now = new Date()) {
  if (profile?.plan_type !== 'cycle') return false;
  if (profile.cycle_expires_at) return now > new Date(profile.cycle_expires_at);
  return false;
}

async function loadProfile(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('id, subscription_status, plan_type, generations_this_period, generation_period_start, cycle_started_at, cycle_expires_at, generation_throttle_count, renews_at')
    .eq('id', userId)
    .single();
  return data;
}

async function resetPeriodIfNeeded(profile) {
  if (!profile) return profile;
  const periodStart = getPeriodStart(profile);
  const stored = profile.generation_period_start ? new Date(profile.generation_period_start) : null;
  if (stored && stored.getTime() === periodStart.getTime()) return profile;

  const { data, error } = await supabase
    .from('profiles')
    .update({
      generations_this_period: 0,
      generation_period_start: periodStart.toISOString(),
      generation_throttle_count: 0,
    })
    .eq('id', profile.id)
    .select('id, subscription_status, plan_type, generations_this_period, generation_period_start, cycle_started_at, cycle_expires_at, generation_throttle_count, renews_at')
    .single();
  if (error) {
    console.warn('generation period reset failed:', error.message);
    return { ...profile, generations_this_period: 0, generation_period_start: periodStart.toISOString() };
  }
  return data;
}

async function getUsage(userId) {
  let profile = await loadProfile(userId);
  if (!profile) return null;
  profile = await resetPeriodIfNeeded(profile);
  const plan = profile.plan_type || 'monthly';
  const used = profile.generations_this_period ?? 0;
  const hardCap = plan === 'starter' ? STARTER_HARD_CAP : null;
  const softCap = ['monthly', 'annual', 'cycle'].includes(plan) ? PRO_SOFT_CAP : null;
  return {
    used,
    hard_cap: hardCap,
    soft_cap: softCap,
    throttled: softCap != null && used >= softCap,
    priority: isAnnualPriority(profile),
    period_start: profile.generation_period_start,
  };
}

async function logGenerationEvent(userId, payload) {
  try {
    await supabase.from('generation_events').insert({
      user_id: userId,
      event_type: payload.event_type || 'generate',
      plan_type: payload.plan_type,
      generation_type: payload.generation_type || 'secondary-outline',
      priority_lane: !!payload.priority_lane,
      throttled: !!payload.throttled,
      meta: payload.meta || {},
    });
  } catch (err) {
    console.warn('generation_events insert failed (run schema-updates.sql?):', err.message);
  }
}

/**
 * @returns {{ ok: boolean, status?: number, body?: object, priority?: boolean, throttled?: boolean, delayMs?: number }}
 */
async function checkGenerationAllowed(userId, profile, opts = {}) {
  const { isRegen = false, regenCount = 0, generationType = 'secondary-outline' } = opts;
  if (!profile || profile.subscription_status !== 'pro') {
    return { ok: false, status: 403, body: { error: 'Paid subscription required.', limit_type: 'subscription' } };
  }
  if (cycleExpired(profile)) {
    return { ok: false, status: 403, body: { error: 'Your Cycle Pass has expired.', limit_type: 'cycle_expired' } };
  }

  profile = await resetPeriodIfNeeded(profile);
  const plan = profile.plan_type || 'monthly';
  const used = profile.generations_this_period ?? 0;
  const priority = isAnnualPriority(profile);

  let consumesSlot = true;
  if (plan === 'starter' && isRegen) {
    // regenCount = completed regens before this one; 0,1,2 => free; 3+ => costs slot
    consumesSlot = regenCount >= STARTER_FREE_REGENS;
  }

  if (plan === 'starter' && consumesSlot && used >= STARTER_HARD_CAP) {
    return {
      ok: false,
      status: 429,
      body: {
        error: `You've used all ${STARTER_HARD_CAP} generations this month. Upgrade to Pro for unlimited access.`,
        limit_type: 'monthly_generations',
        limit: STARTER_HARD_CAP,
        used,
      },
    };
  }

  const softCap = ['monthly', 'annual', 'cycle'].includes(plan) ? PRO_SOFT_CAP : null;
  const throttled = softCap != null && used >= softCap;
  const delayMs = throttled && !priority ? 2500 : 0;

  if (throttled) {
    await supabase
      .from('profiles')
      .update({ generation_throttle_count: (profile.generation_throttle_count || 0) + 1 })
      .eq('id', userId);
    await logGenerationEvent(userId, {
      event_type: 'soft_cap_throttle',
      plan_type: plan,
      generation_type: generationType,
      priority_lane: priority,
      throttled: true,
      meta: { used, soft_cap: softCap },
    });
  }

  return { ok: true, priority, throttled, delayMs, consumesSlot, profile, used, plan };
}

async function incrementGeneration(userId, profile, opts = {}) {
  const { consumesSlot = true, generationType = 'secondary-outline', priority, throttled } = opts;
  if (!consumesSlot) return;
  const used = (profile.generations_this_period ?? 0) + 1;
  await supabase
    .from('profiles')
    .update({ generations_this_period: used })
    .eq('id', userId);
  await logGenerationEvent(userId, {
    event_type: 'generate',
    plan_type: profile.plan_type,
    generation_type: generationType,
    priority_lane: priority,
    throttled: !!throttled,
    meta: { used },
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  STARTER_HARD_CAP,
  STARTER_FREE_REGENS,
  PRO_SOFT_CAP,
  isPeakSeason,
  isAnnualPriority,
  getPeriodStart,
  cycleExpired,
  loadProfile,
  getUsage,
  checkGenerationAllowed,
  incrementGeneration,
  sleep,
};
