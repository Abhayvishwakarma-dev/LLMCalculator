// server/src/middleware/rateLimiter.js

/**
 * Minimal in-memory fixed-window rate limiter.
 *
 * Design notes:
 *  - `hits` is capped at `maxKeys` to prevent unbounded memory growth
 *    from an attacker rotating IPs (esp. IPv6, 2^128 addresses).
 *    When the cap is hit, new keys are rejected until the sweep cleans up.
 *  - `bucket.count` is capped at `max` so hammering doesn't inflate the
 *    stored value past the limit — once you're over, you stay over.
 *  - Every response (first hit AND subsequent) carries all three
 *    X-RateLimit-* headers, per the IETF draft.
 *
 * Caveat: `req.ip` requires `app.set('trust proxy', 1)` if you sit
 * behind Nginx / Render / Heroku, otherwise every request looks like
 * it came from 127.0.0.1.
 *
 * Multi-instance note: this Map is per-process. Two Node instances behind
 * a load balancer each enforce their own 20 req/min. For a hard global
 * limit, back this with Redis (same interface — swap the Map for an INCR
 * with EXPIRE).
 */
export const rateLimiter = ({
  windowMs = 60_000,
  max = 20,
  message = 'Too many requests, please slow down.',
  maxKeys = 10_000, // safety valve against Map-size DoS
} = {}) => {
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const hits = new Map();

  // Periodic sweep so the Map doesn't grow unbounded across legitimate traffic
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of hits) {
      if (bucket.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  sweep.unref?.(); // don't keep the process alive just for this

  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const bucket = hits.get(key);

    // Helper — keeps the three headers consistent across every exit path
    const setRateLimitHeaders = (remaining, resetAt) => {
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));
      res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt / 1000));
    };

    /* ── New window (first request OR window expired) ──────────── */
    if (!bucket || bucket.resetAt <= now) {
      // DoS valve: if a new IP arrives and we're at the Map cap, reject it.
      // Once the sweep runs (every windowMs), these fizzle out and legit
      // users get slots back. Trade-off: under sustained attack, new IPs
      // are blocked entirely — which is the correct behavior.
      if (!bucket && hits.size >= maxKeys) {
        res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
        return res.status(429).json({ error: 'Server busy, please retry shortly.' });
      }

      const resetAt = now + windowMs;
      hits.set(key, { count: 1, resetAt });
      setRateLimitHeaders(max - 1, resetAt);
      return next();
    }

    /* ── Existing window: already at/over the limit ────────────── */
    // Check BEFORE incrementing so count stays pinned at `max`
    if (bucket.count >= max) {
      setRateLimitHeaders(0, bucket.resetAt);
      res.setHeader(
        'Retry-After',
        Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      );
      return res.status(429).json({ error: message });
    }

    /* ── Existing window: allow this request ───────────────────── */
    bucket.count += 1;
    setRateLimitHeaders(max - bucket.count, bucket.resetAt);
    next();
  };
};