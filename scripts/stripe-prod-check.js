/**
 * Validate Stripe env for production (or local).
 * Usage:
 *   node scripts/stripe-prod-check.js
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-prod-check.js
 */
require('dotenv').config();
const Stripe = require('stripe');

const REQUIRED = [
  'APP_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_STARTER_PRICE_ID',
  'STRIPE_PRO_PRICE_ID',
  'STRIPE_PRO_ANNUAL_PRICE_ID',
  'STRIPE_CYCLE_PASS_PRICE_ID',
  'STRIPE_WEBHOOK_SECRET',
];

async function main() {
  let failed = 0;
  console.log('\nStripe production readiness check\n');

  for (const key of REQUIRED) {
    const val = process.env[key];
    const ok = !!val && !/your_|placeholder|here/i.test(val);
    console.log(`${ok ? '✓' : '✗'} ${key}${ok ? '' : '  ← missing or placeholder'}`);
    if (!ok) failed++;
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret || /your_|placeholder|here/i.test(secret)) {
    console.log('\nFix STRIPE_SECRET_KEY first, then re-run.\n');
    process.exit(1);
  }

  const isLive = secret.startsWith('sk_live_');
  console.log(`\nMode: ${isLive ? 'LIVE' : 'TEST'}`);
  if (!isLive) console.log('  (For Netlify production you need sk_live_… and live price IDs)');

  const stripe = Stripe(secret);
  const prices = [
    ['STARTER', process.env.STRIPE_STARTER_PRICE_ID, 'recurring'],
    ['PRO', process.env.STRIPE_PRO_PRICE_ID, 'recurring'],
    ['ANNUAL', process.env.STRIPE_PRO_ANNUAL_PRICE_ID, 'recurring'],
    ['CYCLE', process.env.STRIPE_CYCLE_PASS_PRICE_ID, 'one_time'],
  ];

  for (const [name, id, expect] of prices) {
    if (!id || /your_|placeholder|here/i.test(id)) continue;
    try {
      const p = await stripe.prices.retrieve(id);
      const type = p.type === 'recurring' ? 'recurring' : 'one_time';
      const match = type === expect;
      console.log(`${match ? '✓' : '✗'} ${name} ${id}  (${type}, $${(p.unit_amount / 100).toFixed(2)}, active=${p.active})`);
      if (!match) {
        console.log(`    expected ${expect}`);
        failed++;
      }
      if (!p.active) failed++;
    } catch (err) {
      console.log(`✗ ${name} ${id}  — ${err.message}`);
      failed++;
    }
  }

  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  if (isLive && appUrl && /localhost/i.test(appUrl)) {
    console.log('✗ APP_URL points at localhost but key is LIVE');
    failed++;
  }
  if (isLive && appUrl) {
    console.log(`\nWebhook endpoint to register in Stripe (live mode):`);
    console.log(`  ${appUrl}/stripe/webhook`);
    console.log('Events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted');
  }

  console.log(failed ? `\n${failed} issue(s) found.\n` : '\nAll checks passed.\n');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
