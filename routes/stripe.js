const express = require('express');
const Stripe = require('stripe');
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');
const { getPlanLimits } = require('../lib/plan-limits');
const { getUsage, getPeriodStart, cycleExpired } = require('../lib/generation-caps');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

const PRICE_ENV = {
  starter: 'STRIPE_STARTER_PRICE_ID',
  monthly: 'STRIPE_PRO_PRICE_ID',
  annual: 'STRIPE_PRO_ANNUAL_PRICE_ID',
  cycle: 'STRIPE_CYCLE_PASS_PRICE_ID',
};

function priceIdForPlan(plan) {
  const envKey = PRICE_ENV[plan] || PRICE_ENV.monthly;
  return process.env[envKey] || null;
}

function canStartCheckout(profile) {
  if (!profile || profile.subscription_status !== 'pro') return true;
  // Expired Cycle Pass users keep status=pro in DB but should be able to buy again
  if (profile.plan_type === 'cycle' && cycleExpired(profile)) return true;
  return false;
}

function isCustomerModeMismatch(err) {
  const msg = String(err?.message || '');
  return /No such customer/i.test(msg) && /live mode|test mode/i.test(msg);
}

/** Resolve a Stripe customer that exists in the current API mode (test vs live). */
async function ensureStripeCustomer(userId, userEmail, existingCustomerId) {
  if (existingCustomerId) {
    try {
      await stripe.customers.retrieve(existingCustomerId);
      return existingCustomerId;
    } catch (err) {
      if (!isCustomerModeMismatch(err) && err?.statusCode !== 404) throw err;
      console.warn('Stripe customer missing in current mode; creating a new one for', userId);
    }
  }

  const customer = await stripe.customers.create({
    email: userEmail,
    metadata: { supabase_uid: userId },
  });
  await supabase.from('profiles').update({ stripe_customer_id: customer.id }).eq('id', userId);
  return customer.id;
}

function appBaseUrl() {
  return (process.env.APP_URL || '').replace(/\/$/, '');
}

async function updateProfileFromCheckout(obj, updates) {
  const byCustomer = await supabase
    .from('profiles')
    .update(updates)
    .eq('stripe_customer_id', obj.customer)
    .select('id');

  if (byCustomer.error) {
    console.error('Webhook profile update failed:', byCustomer.error.message);
    return;
  }
  if (byCustomer.data?.length) return;

  const uid = obj.client_reference_id || obj.metadata?.supabase_uid;
  if (!uid) {
    console.error('Webhook: no profile matched customer', obj.customer);
    return;
  }

  const byUser = await supabase
    .from('profiles')
    .update({ ...updates, stripe_customer_id: obj.customer })
    .eq('id', uid)
    .select('id');

  if (byUser.error) console.error('Webhook profile update by uid failed:', byUser.error.message);
  else if (!byUser.data?.length) console.error('Webhook: no profile for uid', uid);
}

// ── CHECKOUT ──────────────────────────────────────────────────────────────────
router.post('/create-checkout-session', authMiddleware, async (req, res) => {
  const { plan = 'monthly' } = req.body;
  const userId = req.user.id;
  const userEmail = req.user.username;

  const priceId = priceIdForPlan(plan);
  if (!priceId) {
    const envKey = PRICE_ENV[plan] || PRICE_ENV.monthly;
    return res.status(500).json({ error: `Pricing not configured (${envKey}).` });
  }

  if (!process.env.APP_URL) {
    return res.status(500).json({ error: 'APP_URL is not configured.' });
  }

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id, subscription_status, plan_type, cycle_expires_at, stripe_subscription_id')
      .eq('id', userId)
      .single();

    if (!canStartCheckout(profile)) {
      return res.status(400).json({ error: 'Already subscribed. Use the billing portal to change your plan.' });
    }

    const customerId = await ensureStripeCustomer(userId, userEmail, profile?.stripe_customer_id);
    const successUrl = `${appBaseUrl()}/secondaries?upgraded=1`;
    const cancelUrl = `${appBaseUrl()}/secondaries`;

    // Cycle Pass: one-time $99 uses payment mode; legacy $49/mo price uses subscription mode
    if (plan === 'cycle') {
      const cyclePrice = await stripe.prices.retrieve(priceId);
      const mode = cyclePrice.type === 'recurring' ? 'subscription' : 'payment';
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        client_reference_id: userId,
        mode,
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        metadata: { plan: 'cycle', supabase_uid: userId },
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      return res.json({ url: session.url });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      client_reference_id: userId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { plan, supabase_uid: userId },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: err.message || 'Could not start checkout.' });
  }
});

// ── BILLING PORTAL (upgrade, cancel, payment method) ─────────────────────────
router.post('/portal', authMiddleware, async (req, res) => {
  const { return_url } = req.body;

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', req.user.id)
    .single();

  if (!profile?.stripe_customer_id) {
    return res.status(400).json({ error: 'No billing account found. Complete a checkout first.' });
  }

  try {
    const customerId = await ensureStripeCustomer(req.user.id, req.user.username, profile.stripe_customer_id);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: return_url || `${appBaseUrl()}/secondaries`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Portal error:', err.message);
    res.status(500).json({ error: err.message || 'Could not open billing portal.' });
  }
});

// ── CANCEL (end of term) ──────────────────────────────────────────────────────
router.post('/cancel', authMiddleware, async (req, res) => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_subscription_id')
    .eq('id', req.user.id)
    .single();

  if (!profile?.stripe_subscription_id) {
    return res.status(400).json({ error: 'No active subscription found.' });
  }

  try {
    const sub = await stripe.subscriptions.update(profile.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
    const cancelAt = new Date(sub.current_period_end * 1000).toISOString();
    await supabase
      .from('profiles')
      .update({ cancel_at: cancelAt })
      .eq('id', req.user.id);
    res.json({ cancel_at: cancelAt });
  } catch (err) {
    console.error('Cancel error:', err.message);
    res.status(500).json({ error: 'Could not cancel subscription.' });
  }
});

// ── REACTIVATE (undo end-of-term cancel) ──────────────────────────────────────
router.post('/reactivate', authMiddleware, async (req, res) => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_subscription_id')
    .eq('id', req.user.id)
    .single();

  if (!profile?.stripe_subscription_id) {
    return res.status(400).json({ error: 'No active subscription found.' });
  }

  try {
    await stripe.subscriptions.update(profile.stripe_subscription_id, {
      cancel_at_period_end: false,
    });
    await supabase
      .from('profiles')
      .update({ cancel_at: null })
      .eq('id', req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Reactivate error:', err.message);
    res.status(500).json({ error: 'Could not reactivate subscription.' });
  }
});

// ── SUBSCRIPTION STATUS ───────────────────────────────────────────────────────
router.get('/status', authMiddleware, async (req, res) => {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('subscription_status, plan_type, stripe_subscription_id, cancel_at, renews_at')
    .eq('id', req.user.id)
    .single();

  if (profileError) {
    console.error('Status profile lookup failed:', profileError.message);
    return res.status(500).json({ error: 'Plan lookup failed: ' + profileError.message });
  }
  if (!profile) return res.status(404).json({ error: 'Profile not found.' });

  const planType = profile.plan_type || null;
  const limits = getPlanLimits(planType);
  let usage = null;
  try { usage = await getUsage(req.user.id); }
  catch (err) { console.warn('getUsage failed:', err.message); }
  const outlinesUsed = usage?.used ?? 0;
  const hardCap = usage?.hard_cap ?? limits.outlines_per_month;

  const base = {
    plan_type: planType,
    outlines_used: outlinesUsed,
    generations_used: outlinesUsed,
    outlines_limit: hardCap,
    generations_limit: hardCap,
    soft_cap: usage?.soft_cap ?? limits.soft_cap ?? null,
    throttled: usage?.throttled ?? false,
    priority: usage?.priority ?? false,
  };

  if (!profile.stripe_subscription_id || profile.subscription_status !== 'pro') {
    return res.json({
      status: profile.subscription_status || 'free',
      cancel_at: null,
      renews_at: null,
      ...base,
    });
  }

  try {
    const sub = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
    const cancelAt = sub.cancel_at_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null;
    const renewsAt = new Date(sub.current_period_end * 1000).toISOString();
    return res.json({
      status: sub.status === 'active' ? 'pro' : 'canceled',
      cancel_at_period_end: sub.cancel_at_period_end,
      cancel_at: cancelAt,
      renews_at: renewsAt,
      ...base,
    });
  } catch {
    return res.json({
      status: profile.subscription_status || 'free',
      cancel_at: profile.cancel_at || null,
      renews_at: profile.renews_at || null,
      ...base,
    });
  }
});

// ── WEBHOOK ───────────────────────────────────────────────────────────────────
router.post('/webhook', async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  const obj = event.data.object;

  if (event.type === 'checkout.session.completed') {
    const plan = obj.metadata?.plan || 'monthly';
    const now = new Date();
    const updates = {
      subscription_status: 'pro',
      plan_type: plan,
      cancel_at: null,
      generations_this_period: 0,
      generation_period_start: getPeriodStart({ plan_type: plan, cycle_started_at: now.toISOString() }).toISOString(),
    };

    // Cycle Pass (one-time $99): 6 months Pro access, no subscription
    if (plan === 'cycle' && !obj.subscription) {
      const expires = new Date(now);
      expires.setUTCMonth(expires.getUTCMonth() + 6);
      updates.stripe_subscription_id = null;
      updates.cycle_started_at = now.toISOString();
      updates.cycle_expires_at = expires.toISOString();
      updates.cancel_at = expires.toISOString();
      updates.renews_at = null;
    } else {
      updates.stripe_subscription_id = obj.subscription || null;
      if (obj.subscription) {
        try {
          const sub = await stripe.subscriptions.retrieve(obj.subscription);
          updates.renews_at = new Date(sub.current_period_end * 1000).toISOString();
          // Legacy $49 cycle subscription: auto-cancel at period end (grandfathered purchasers)
          const legacyCycleId = process.env.STRIPE_CYCLE_PASS_LEGACY_PRICE_ID;
          const priceId = sub.items?.data?.[0]?.price?.id;
          const isLegacyCycle = plan === 'cycle' || priceId === legacyCycleId;
          if (isLegacyCycle && !sub.cancel_at_period_end) {
            await stripe.subscriptions.update(obj.subscription, { cancel_at_period_end: true });
            updates.cancel_at = updates.renews_at;
          }
        } catch {}
      }
    }
    await updateProfileFromCheckout(obj, updates);
  }

  if (event.type === 'customer.subscription.updated') {
    const status = obj.status === 'active' ? 'pro' : 'canceled';
    const cancelAt = obj.cancel_at_period_end
      ? new Date(obj.current_period_end * 1000).toISOString()
      : null;
    // Detect plan type from price ID when plan changes via portal
    const priceId = obj.items?.data?.[0]?.price?.id;
    const planTypeUpdate = {};
    if (priceId) {
      if (priceId === process.env.STRIPE_STARTER_PRICE_ID) planTypeUpdate.plan_type = 'starter';
      else if (priceId === process.env.STRIPE_PRO_ANNUAL_PRICE_ID) planTypeUpdate.plan_type = 'annual';
      else if (priceId === process.env.STRIPE_CYCLE_PASS_PRICE_ID) planTypeUpdate.plan_type = 'cycle';
      else if (priceId === process.env.STRIPE_CYCLE_PASS_LEGACY_PRICE_ID) planTypeUpdate.plan_type = 'cycle';
      else if (priceId === process.env.STRIPE_PRO_PRICE_ID) planTypeUpdate.plan_type = 'monthly';
    }
    await supabase
      .from('profiles')
      .update({
        subscription_status: status,
        stripe_subscription_id: obj.id,
        cancel_at: cancelAt,
        renews_at: new Date(obj.current_period_end * 1000).toISOString(),
        ...planTypeUpdate,
      })
      .eq('stripe_customer_id', obj.customer);
  }

  if (event.type === 'customer.subscription.deleted') {
    await supabase
      .from('profiles')
      .update({
        subscription_status: 'canceled',
        stripe_subscription_id: null,
        cancel_at: null,
        renews_at: null,
      })
      .eq('stripe_customer_id', obj.customer);
  }

  res.json({ received: true });
});

module.exports = router;
