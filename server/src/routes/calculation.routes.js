// server/src/routes/calculation.routes.js
import { Router } from 'express';
import { rateLimiter, validateCalculate } from '../middleware/index.js';
import {
  calculate,
  getHistory,
  getById,
  getUsageStats,
} from '../controllers/index.js';

const router = Router();

/* ------------------------------------------------------------------ *
 * Middleware chains, read left → right:
 *   rateLimiter      → abuse protection (LLM calls cost real money)
 *   validateCalculate→ shape the body before it hits the controller
 *   calculate        → the controller
 *
 * Note: rateLimiter is applied to the POST only. History/usage are
 * cheap DB reads — a global limiter would be fine, but per-route keeps
 * the LLM budget explicit.
 * ------------------------------------------------------------------ */

// POST /api/calculations  → run a natural-language calculation
router.post(
  '/',
  rateLimiter({ windowMs: 60_000, max: 20 }),
  validateCalculate,
  calculate
);

// GET /api/calculations/history?page=1&limit=20
router.get('/history', getHistory);

// GET /api/calculations/history/:id
// ⚠️ Must come AFTER /history — otherwise "history" would be
// captured by :id and hit getById with id="history".
router.get('/history/:id', getById);

// GET /api/calculations/usage  → cumulative dashboard stats
router.get('/usage', getUsageStats);

export default router;