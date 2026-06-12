/*
  Lightweight in-memory rate limiter.
  Note: on serverless (Netlify Functions) each warm container keeps its own
  counters, so this throttles bursts rather than providing a global guarantee.
  For a hard guarantee move the counters to a shared store (e.g. Supabase/Redis).
*/
const buckets = new Map();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * rateLimit({ windowMs, max, keyFn?, message? })
 * keyFn(req) may return extra key material (e.g. the email being attempted).
 */
module.exports = function rateLimit({ windowMs, max, keyFn, message } = {}) {
  windowMs = windowMs || 15 * 60 * 1000;
  max = max || 20;
  return function (req, res, next) {
    const now = Date.now();
    const extra = keyFn ? String(keyFn(req) || '') : '';
    const key = `${req.method}:${req.baseUrl}${req.path}:${clientIp(req)}:${extra}`;

    let b = buckets.get(key);
    if (!b || now > b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;

    // Opportunistic cleanup so the map doesn't grow unbounded
    if (buckets.size > 10000) {
      for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
    }

    if (b.count > max) {
      res.set('Retry-After', String(Math.ceil((b.resetAt - now) / 1000)));
      return res.status(429).json({ error: message || 'Too many requests. Please try again later.' });
    }
    next();
  };
};
