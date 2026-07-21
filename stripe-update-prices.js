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
  { env: 'STRIPE_STARTER_PRICE_ID', nickname: 'Starter Monthly', unit_amount: 500, recurring: { interval: 'month' }, label: '$5/mo', productMatch: /starter/i, interval: 'month' },
  { env: 'STRIPE_PRO_PRICE_ID', nickname: 'Pro Monthly', unit_amount: 1200, recurring: { interval: 'month' }, label: '$12/mo', productMatch: /pro/i, interval: 'month' },
  { env: 'STRIPE_PRO_ANNUAL_PRICE_ID', nickname: 'Pro Annual', unit_amount: 9900, recurring: { interval: 'year' }, label: '$99/yr', productMatch: /pro/i, interval: 'year' },
  { env: 'STRIPE_CYCLE_PASS_PRICE_ID', nickname: 'Cycle Pass (6 mo, one-time)', unit_amount: 4900, recurring: null, label: '$49 once', productMatch: /pro|cycle/i, interval: null },
];

// Fallback when the env price ID doesn't exist in this mode (e.g. test IDs in
// .env while running with a live key): match by product name + billing interval.
async function findCurrentPrice(plan, allPrices) {
  const candidates = allPrices.filter((p) => {
    const name = typeof p.product === 'object' ? p.product.name : '';
    if (!plan.productMatch.test(name)) return false;
    const interval = p.recurring ? p.recurring.interval : null;
    return interval === plan.interval;
  });
  if (candidates.length === 0) return null;
  // Prefer exact nickname match, then most recent
  candidates.sort((a, b) => (b.nickname === plan.nickname) - (a.nickname === plan.nickname) || b.created - a.created);
  return candidates[0];
}

async function run() {
  const results = [];
  const allPrices = (await stripe.prices.list({ active: true, limit: 100, expand: ['data.product'] })).data
    .filter((p) => p.product && p.product.active !== false);

  for (const plan of PLANS) {
    const envId = process.env[plan.env];
    let oldPrice = null;
    if (envId && envId.startsWith('price_')) {
      oldPrice = await stripe.prices.retrieve(envId).catch(() => null);
    }
    if (!oldPrice) {
      oldPrice = await findCurrentPrice(plan, allPrices);
      if (oldPrice) console.log(`ℹ  ${plan.nickname}: env ID unusable in this mode — matched ${oldPrice.id} ($${oldPrice.unit_amount / 100}) on "${oldPrice.product.name}"`);
    }
    if (!oldPrice) {
      console.log(`⚠  ${plan.nickname}: no existing price found — skipping`);
      continue;
    }
    const oldId = oldPrice.id;
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
