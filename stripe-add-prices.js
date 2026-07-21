/**
 * Scrubbed — add Starter ($5/mo) + Cycle Pass ($49 one-time)
 * Run: node stripe-add-prices.js
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
  // ── Starter product + $10/mo price ──────────────────────────────────────────
  console.log('Creating Starter product…');
  const starterProduct = await stripe.products.create({
    name: 'Scrubbed Starter',
    description: '10 Secondary AI outlines per month from your real Vault data, school-specific mapping. Encrypted storage and automated backups.',
  });
  console.log(`  ✓ Starter product: ${starterProduct.id}`);

  const starter = await stripe.prices.create({
    product: starterProduct.id,
    unit_amount: 500,
    currency: 'usd',
    recurring: { interval: 'month' },
    nickname: 'Starter Monthly',
  });
  console.log(`  ✓ Starter price:   ${starter.id}  ($5/mo)`);

  // ── Cycle Pass $99 one-time ──────────────────────────────────────────────────
  console.log('Creating Cycle Pass product…');
  const cycleProduct = await stripe.products.create({
    name: 'Scrubbed Cycle Pass',
    description: 'Full access for one application cycle — 6 months, one-time payment.',
  });
  console.log(`  ✓ Cycle product: ${cycleProduct.id}`);

  const cycle = await stripe.prices.create({
    product: cycleProduct.id,
    unit_amount: 4900,
    currency: 'usd',
    nickname: 'Cycle Pass (one-time)',
  });
  console.log(`  ✓ Cycle price:   ${cycle.id}  ($49 once)\n`);

  // ── Print env vars ───────────────────────────────────────────────────────────
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Add these to Netlify → Site settings → Environment variables');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`STRIPE_STARTER_PRICE_ID          ${starter.id}`);
  console.log(`STRIPE_CYCLE_PASS_PRICE_ID       ${cycle.id}`);
  console.log('\n  (Optional — grandfather existing $49 cycle subscribers:)');
  console.log('STRIPE_CYCLE_PASS_LEGACY_PRICE_ID   <your-old-$49-price-id>');
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

run().catch(err => {
  console.error('\n❌  Failed:', err.message);
  process.exit(1);
});
