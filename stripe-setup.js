/**
 * Scrubbed — Stripe one-time setup script
 * Run: node stripe-setup.js
 *
 * Creates products, prices, and Customer Portal config.
 * Prints the env var values to paste into Netlify.
 */

const Stripe = require('stripe');

const SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!SECRET_KEY) {
  console.error('\n❌  Set STRIPE_SECRET_KEY before running:\n');
  console.error('   $env:STRIPE_SECRET_KEY="sk_live_..."   (PowerShell)');
  console.error('   export STRIPE_SECRET_KEY="sk_live_..."  (bash)\n');
  process.exit(1);
}

const stripe = Stripe(SECRET_KEY);
const isLive = SECRET_KEY.startsWith('sk_live_');
console.log(`\n🔑  Using ${isLive ? 'LIVE' : 'TEST'} mode key\n`);

async function run() {
  // ── 1. Product ──────────────────────────────────────────────────────────────
  console.log('Creating product…');
  const product = await stripe.products.create({
    name: 'Scrubbed Pro',
    description: 'Unlimited Secondary AI outlines, school-specific prompt mapping, built from your real Vault data.',
  });
  console.log(`  ✓ Product: ${product.id}`);

  // ── 2. Prices ───────────────────────────────────────────────────────────────
  console.log('Creating prices…');

  const monthly = await stripe.prices.create({
    product: product.id,
    unit_amount: 2500,           // $25.00
    currency: 'usd',
    recurring: { interval: 'month' },
    nickname: 'Pro Monthly',
  });
  console.log(`  ✓ Monthly: ${monthly.id}  ($25/mo)`);

  const annual = await stripe.prices.create({
    product: product.id,
    unit_amount: 19900,          // $199.00
    currency: 'usd',
    recurring: { interval: 'year' },
    nickname: 'Pro Annual',
  });
  console.log(`  ✓ Annual:  ${annual.id}  ($199/yr)`);

  // Cycle Pass: billed every 6 months — webhook auto-sets cancel_at_period_end
  // so it runs for exactly 6 months with no auto-renew.
  const cycle = await stripe.prices.create({
    product: product.id,
    unit_amount: 4900,           // $49.00
    currency: 'usd',
    recurring: { interval: 'month', interval_count: 6 },
    nickname: 'Cycle Pass (6 mo)',
  });
  console.log(`  ✓ Cycle:   ${cycle.id}  ($49 / 6 months)`);

  // ── 3. Customer Portal ──────────────────────────────────────────────────────
  console.log('Configuring Customer Portal…');
  try {
    await stripe.billingPortal.configurations.create({
      business_profile: {
        headline: 'Manage your Scrubbed subscription',
      },
      features: {
        subscription_cancel: {
          enabled: true,
          mode: 'at_period_end',   // end-of-term cancellation
          proration_behavior: 'none',
        },
        subscription_update: {
          enabled: true,
          default_allowed_updates: ['price'],
          proration_behavior: 'always_invoice',
          products: [
            {
              product: product.id,
              prices: [monthly.id, annual.id],
            },
          ],
        },
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
      },
    });
    console.log('  ✓ Customer Portal configured');
  } catch (err) {
    // Portal config may already exist — not fatal
    console.log('  ⚠  Portal config skipped (may already exist):', err.message);
  }

  // ── 4. Print env vars ───────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Paste these into Netlify → Site settings → Environment variables');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`STRIPE_SECRET_KEY            ${SECRET_KEY}`);
  console.log(`STRIPE_PRO_PRICE_ID          ${monthly.id}`);
  console.log(`STRIPE_PRO_ANNUAL_PRICE_ID   ${annual.id}`);
  console.log(`STRIPE_CYCLE_PASS_PRICE_ID   ${cycle.id}`);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Next: create the webhook in the Stripe dashboard');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('  1. Go to https://dashboard.stripe.com/webhooks');
  console.log('  2. Click "Add endpoint"');
  console.log('  3. URL: https://getscrubbed.netlify.app/.netlify/functions/api/stripe/webhook');
  console.log('  4. Select these events:');
  console.log('       checkout.session.completed');
  console.log('       customer.subscription.updated');
  console.log('       customer.subscription.deleted');
  console.log('  5. Copy the "Signing secret" and add it to Netlify as:');
  console.log('       STRIPE_WEBHOOK_SECRET    whsec_...\n');
  console.log('  Also set:');
  console.log('       APP_URL    https://getscrubbed.netlify.app\n');
}

run().catch(err => {
  console.error('\n❌  Setup failed:', err.message);
  process.exit(1);
});
