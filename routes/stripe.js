const express = require('express');
const Stripe = require('stripe');
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

// POST /stripe/create-checkout-session  (requires auth)
router.post('/create-checkout-session', authMiddleware, async (req, res) => {
  const { plan = 'monthly' } = req.body;
  const userId = req.user.id;
  const userEmail = req.user.username;

  const priceId =
    plan === 'annual' ? process.env.STRIPE_PRO_ANNUAL_PRICE_ID :
    plan === 'cycle'  ? process.env.STRIPE_CYCLE_PASS_PRICE_ID :
                        process.env.STRIPE_PRO_PRICE_ID;

  if (!priceId) return res.status(500).json({ error: 'Pricing not configured.' });

  // Get or create Stripe customer
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .single();

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
    cancel_url: `${process.env.APP_URL}/secondaries`,
  });

  res.json({ url: session.url });
});

// POST /stripe/webhook  (raw body applied at app level in server.js before express.json())
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
    await supabase
      .from('profiles')
      .update({ subscription_status: 'pro' })
      .eq('stripe_customer_id', obj.customer);
  }

  if (event.type === 'customer.subscription.deleted') {
    await supabase
      .from('profiles')
      .update({ subscription_status: 'canceled' })
      .eq('stripe_customer_id', obj.customer);
  }

  if (event.type === 'customer.subscription.updated') {
    const status = obj.status === 'active' ? 'pro' : 'canceled';
    await supabase
      .from('profiles')
      .update({ subscription_status: status })
      .eq('stripe_customer_id', obj.customer);
  }

  res.json({ received: true });
});

module.exports = router;
