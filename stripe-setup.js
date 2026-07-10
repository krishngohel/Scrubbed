/**
 * Scrubbed — Stripe one-time setup script
 * Run: node stripe-setup.js
 *
 * Creates products, prices, and Customer Portal config.
 * Prints the env var values to paste into Netlify.
 */

require('dotenv').config();
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
  // ── 1. Starter product ────────────────────────────────────────────────────
  console.log('Creating Starter product…');
  const starterProduct = await stripe.products.create({
    name: 'Scrubbed Starter',
    description: '10 Secondary AI outlines per month from your real Vault data, school-specific mapping. Same outline quality as Pro — capped at 10/month. Encrypted storage and automated backups.',
  });
  console.log(`  ✓ Starter product: ${starterProduct.id}`);

  const starter = await stripe.prices.create({
    product: starterProduct.id,
    unit_amount: 1000,
    currency: 'usd',
    recurring: { interval: 'month' },
    nickname: 'Starter Monthly',
  });
  console.log(`  ✓ Starter: ${starter.id}  ($10/mo)`);

  // ── 2. Pro product ────────────────────────────────────────────────────────
  console.log('Creating Pro product…');
  const product = await stripe.products.create({
    name: 'Scrubbed Pro',
    description: 'Unlimited Secondary AI outlines, school-specific prompt mapping, built from your real Vault data. Encrypted storage and automated backups.',
  });
  console.log(`  ✓ Pro product: ${product.id}`);

  console.log('Creating Pro prices…');

  const monthly = await stripe.prices.create({
    product: product.id,
    unit_amount: 2500,
    currency: 'usd',
    recurring: { interval: 'month' },
    nickname: 'Pro Monthly',
  });
  console.log(`  ✓ Monthly: ${monthly.id}  ($25/mo)`);

  const annual = await stripe.prices.create({
    product: product.id,
    unit_amount: 19900,
    currency: 'usd',
    recurring: { interval: 'year' },
    nickname: 'Pro Annual',
  });
  console.log(`  ✓ Annual:  ${annual.id}  ($199/yr)`);

  const cycle = await stripe.prices.create({
    product: product.id,
    unit_amount: 9900,
    currency: 'usd',
    nickname: 'Cycle Pass (6 mo, one-time)',
  });
  console.log(`  ✓ Cycle:   ${cycle.id}  ($99 once — 6 months)`);

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
          mode: 'at_period_end',
          proration_behavior: 'none',
        },
        subscription_update: {
          enabled: true,
          default_allowed_updates: ['price'],
          proration_behavior: 'always_invoice',
          products: [
            { product: starterProduct.id, prices: [starter.id] },
            { product: product.id, prices: [monthly.id, annual.id] },
          ],
        },
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
      },
    });
    console.log('  ✓ Customer Portal configured');
  } catch (err) {
    console.log('  ⚠  Portal config skipped (may already exist):', err.message);
  }

  // ── 4. Print env vars ───────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Paste these into Netlify → Site settings → Environment variables');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`STRIPE_SECRET_KEY            ${SECRET_KEY}`);
  console.log(`STRIPE_STARTER_PRICE_ID      ${starter.id}`);
  console.log(`STRIPE_PRO_PRICE_ID          ${monthly.id}`);
  console.log(`STRIPE_PRO_ANNUAL_PRICE_ID   ${annual.id}`);
  console.log(`STRIPE_CYCLE_PASS_PRICE_ID   ${cycle.id}`);
  console.log('  (Optional — grandfather existing $49 cycle subscribers:)');
  console.log('STRIPE_CYCLE_PASS_LEGACY_PRICE_ID   <your-old-$49-price-id>');
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Next: create the webhook in the Stripe dashboard');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('  1. Go to https://dashboard.stripe.com/webhooks');
  console.log('  2. Click "Add endpoint"');
  console.log('  3. URL: https://getscrubbed.netlify.app/stripe/webhook');
  console.log('     (or https://getscrubbed.netlify.app/.netlify/functions/api/stripe/webhook)');
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
