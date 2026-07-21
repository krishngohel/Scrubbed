/**
 * Scrubbed — migrate to new pricing on EXISTING products
 *   Starter $5/mo · Pro $12/mo · Pro Annual $99/yr · Cycle Pass $49 once
 *
 * Run: node stripe-update-prices.js            (creates new prices, updates portal)
 *      node stripe-update-prices.js --archive-old   (also deactivates the old prices —
 *        only do this AFTER the new price IDs are live in the server env vars)
 *
 * Stripe prices are immutable, so this creates new price objects on the same
 * products and prints the env vars to update. Existing subscribers stay on
 * their old price until they change plans.
 */

require('dotenv').config();
const Stripe = require('stripe');

const SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!SECRET_KEY) {
  console.error('\n❌  Set STRIPE_SECRET_KEY before running.\n');
  process.exit(1);
}

const stripe = Stripe(SECRET_KEY);
const isLive = SECRET_KEY.startsWith('sk_live_');
const archiveOld = process.argv.includes('--archive-old');
console.log(`\n🔑  Using ${isLive ? 'LIVE' : 'TEST'} mode key\n`);

const PLANS = [
  { env: 'STRIPE_STARTER_PRICE_ID', nickname: 'Starter Monthly', unit_amount: 500, recurring: { interval: 'month' }, label: '$5/mo' },
  { env: 'STRIPE_PRO_PRICE_ID', nickname: 'Pro Monthly', unit_amount: 1200, recurring: { interval: 'month' }, label: '$12/mo' },
  { env: 'STRIPE_PRO_ANNUAL_PRICE_ID', nickname: 'Pro Annual', unit_amount: 9900, recurring: { interval: 'year' }, label: '$99/yr' },
  { env: 'STRIPE_CYCLE_PASS_PRICE_ID', nickname: 'Cycle Pass (6 mo, one-time)', unit_amount: 4900, recurring: null, label: '$49 once' },
];

async function run() {
  const results = [];

  for (const plan of PLANS) {
    const oldId = process.env[plan.env];
    if (!oldId || !oldId.startsWith('price_')) {
      console.log(`⚠  ${plan.env} not set — skipping ${plan.nickname}`);
      continue;
    }
    const oldPrice = await stripe.prices.retrieve(oldId);
    const productId = typeof oldPrice.product === 'string' ? oldPrice.product : oldPrice.product.id;

    if (oldPrice.unit_amount === plan.unit_amount) {
      console.log(`✓  ${plan.nickname}: already at ${plan.label} (${oldId}) — no change`);
      results.push({ ...plan, id: oldId, productId, unchanged: true });
      continue;
    }

    const created = await stripe.prices.create({
      product: productId,
      unit_amount: plan.unit_amount,
      currency: 'usd',
      ...(plan.recurring ? { recurring: plan.recurring } : {}),
      nickname: plan.nickname,
    });
    console.log(`✓  ${plan.nickname}: ${plan.label} → ${created.id}  (was $${oldPrice.unit_amount / 100} · ${oldId})`);
    results.push({ ...plan, id: created.id, oldId, productId });

    if (archiveOld) {
      await stripe.prices.update(oldId, { active: false });
      console.log(`   archived old price ${oldId}`);
    }
  }

  // Refresh the Customer Portal plan-switch options to the new prices
  const starter = results.find((r) => r.env === 'STRIPE_STARTER_PRICE_ID');
  const monthly = results.find((r) => r.env === 'STRIPE_PRO_PRICE_ID');
  const annual = results.find((r) => r.env === 'STRIPE_PRO_ANNUAL_PRICE_ID');
  if (starter && monthly && annual) {
    const products = [
      { product: starter.productId, prices: [starter.id] },
      { product: monthly.productId, prices: [monthly.id, annual.id].filter((v, i, a) => a.indexOf(v) === i) },
    ];
    const configs = await stripe.billingPortal.configurations.list({ active: true, limit: 10 });
    for (const cfg of configs.data) {
      if (!cfg.features?.subscription_update?.enabled) continue;
      await stripe.billingPortal.configurations.update(cfg.id, {
        features: { subscription_update: { enabled: true, default_allowed_updates: ['price'], products } },
      });
      console.log(`✓  Portal config ${cfg.id} now offers the new prices`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Update these env vars (${isLive ? 'Netlify → Environment variables' : 'local .env'}):`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  for (const r of results) console.log(`${r.env.padEnd(28)} ${r.id}${r.unchanged ? '   (unchanged)' : ''}`);
  console.log('\nExisting subscribers keep their current price. Once the new IDs are');
  console.log('deployed, re-run with --archive-old to retire the old prices.\n');
}

run().catch((err) => {
  console.error('\n❌  Failed:', err.message);
  process.exit(1);
});
