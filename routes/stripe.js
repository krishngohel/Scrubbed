const express = require('express');
const Stripe = require('stripe');
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

// ── CHECKOUT ──────────────────────────────────────────────────────────────────
router.post('/create-checkout-session', authMiddleware, async (req, res) => {
  const { plan = 'monthly' } = req.body;
  const userId = req.user.id;
  const userEmail = req.user.username;

  const priceId =
    plan === 'annual' ? process.env.STRIPE_PRO_ANNUAL_PRICE_ID :
    plan === 'cycle'  ? process.env.STRIPE_CYCLE_PASS_PRICE_ID :
                        process.env.STRIPE_PRO_PRICE_ID;

  if (!priceId) return res.status(500).json({ error: 'Pricing not configured.' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id, subscription_status')
    .eq('id', userId)
    .single();

  // Block if already Pro
  if (profile?.subscription_status === 'pro') {
    return res.status(400).json({ error: 'Already subscribed. Use the billing portal to change your plan.' });
  }

  let customerId = profile?.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: userEmail,
      metadata: { supabase_uid: userId },
    });
    customerId = customer.id;
    await supabase.from('profiles').update({ stripe_customer_id: customerId }).eq('id', userId);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.APP_URL}/secondaries?upgraded=1`,
    cancel_url:  `${process.env.APP_URL}/secondaries`,
  });

  res.json({ url: session.url });
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
    return res.status(400).json({ error: 'No billing account found.' });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: return_url || `${process.env.APP_URL}/secondaries`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Portal error:', err.message);
    res.status(500).json({ error: 'Could not open billing portal.' });
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
  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_status, stripe_subscription_id, cancel_at, renews_at')
    .eq('id', req.user.id)
    .single();

  if (!profile) return res.status(404).json({ error: 'Profile not found.' });

  if (!profile.stripe_subscription_id || profile.subscription_status !== 'pro') {
    return res.json({ status: profile.subscription_status || 'free', cancel_at: null, renews_at: null });
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
    });
  } catch {
    // Fall back to DB values if Stripe call fails
    return res.json({
      status: profile.subscription_status || 'free',
      cancel_at: profile.cancel_at || null,
      renews_at: profile.renews_at || null,
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
    const updates = {
      subscription_status: 'pro',
      stripe_subscription_id: obj.subscription || null,
      cancel_at: null,
    };
    // Retrieve the subscription to get the exact period_end set at purchase time
    if (obj.subscription) {
      try {
        const sub = await stripe.subscriptions.retrieve(obj.subscription);
        updates.renews_at = new Date(sub.current_period_end * 1000).toISOString();
      } catch {}
    }
    await supabase
      .from('profiles')
      .update(updates)
      .eq('stripe_customer_id', obj.customer);
  }

  if (event.type === 'customer.subscription.updated') {
    const status = obj.status === 'active' ? 'pro' : 'canceled';
    const cancelAt = obj.cancel_at_period_end
      ? new Date(obj.current_period_end * 1000).toISOString()
      : null;
    await supabase
      .from('profiles')
      .update({
        subscription_status: status,
        stripe_subscription_id: obj.id,
        cancel_at: cancelAt,
        // Always track the current period end so the UI can show "renews on"
        renews_at: new Date(obj.current_period_end * 1000).toISOString(),
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
