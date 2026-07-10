'use strict';

// Shared outline plan limits — outlines_per_month: null = unlimited
const PLAN_LIMITS = {
  starter:  { outlines_per_month: 10,  regen_per_prompt: null, max_tokens: 1600 }, // 3 free regens/outline via generation-caps
  monthly:  { outlines_per_month: null, regen_per_prompt: 3, max_tokens: 2000, soft_cap: 150 },
  annual:   { outlines_per_month: null, regen_per_prompt: 5, max_tokens: 2400, soft_cap: 150, peak_priority: true },
  cycle:    { outlines_per_month: null, regen_per_prompt: 2, max_tokens: 2000, soft_cap: 150 },
  _default: { outlines_per_month: null, regen_per_prompt: 3, max_tokens: 2000, soft_cap: 150 },
};

function getPlanLimits(planType) {
  return PLAN_LIMITS[planType] || PLAN_LIMITS._default;
}

function isPaidSubscriber(profile) {
  return profile?.subscription_status === 'pro';
}

module.exports = { PLAN_LIMITS, getPlanLimits, isPaidSubscriber };
