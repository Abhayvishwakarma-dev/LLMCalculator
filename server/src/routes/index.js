// server/src/routes/index.js
import { Router } from 'express';
import calculationRoutes from './calculation.routes.js';

const router = Router();

/**
 * Mount points live here, not in server.js.
 * server.js just does  app.use('/api', router)
 * — keeps server.js focused on infrastructure (cors, json, listen).
 */
router.use('/calculations', calculationRoutes);

// Health probe — cheap, unauthenticated, used by load balancers / uptime checks
router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

export default router;