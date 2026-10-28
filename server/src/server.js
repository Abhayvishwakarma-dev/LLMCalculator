// server/src/server.js

/**
 * ⚠️ IMPORT ORDER IS LOAD-BEARING:
 * `dotenv/config` MUST be the first import, because config files
 * (`openai.js`, `database.js`) read `process.env` at module-evaluation
 * time and will throw if the vars aren't set yet.
 */
import 'dotenv/config';

import express from 'express';
import cors from 'cors';

import connectDatabase, { disconnectDatabase } from './config/database.js';
import { AI_PROVIDER, MODEL_CONFIG } from './config/openai.js';
import apiRouter from './routes/index.js';
import { notFound, errorHandler } from './middleware/index.js';

/* ------------------------------------------------------------------ *
 * Validate required env vars before anything else — fail fast.
 * ------------------------------------------------------------------ */
const missing = ['MONGODB_URI'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`❌ Missing required env vars: ${missing.join(', ')}`);
  console.error('   Copy .env.example → .env and fill in the values.');
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
  console.error('❌ Set GEMINI_API_KEY (free, no card) or OPENAI_API_KEY in server/.env');
  console.error('   Gemini key: https://aistudio.google.com/app/apikey');
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * Platform detection & production warnings
 * Render automatically sets RENDER=true and RENDER_EXTERNAL_URL.
 * ------------------------------------------------------------------ */
const IS_RENDER = process.env.RENDER === 'true' || Boolean(process.env.RENDER_EXTERNAL_URL);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (IS_RENDER && !IS_PRODUCTION) {
  console.warn(
    '⚠️  Running on Render but NODE_ENV is not "production".\n' +
    '   → Error responses will leak stack traces. Set NODE_ENV=production\n' +
    '     in the Render dashboard (Environment tab).'
  );
}

/* ------------------------------------------------------------------ *
 * Express app
 * ------------------------------------------------------------------ */
const app = express();

// Trust the first proxy hop (Render/Railway/Nginx) so req.ip is the
// real client — required for rateLimiter to work correctly.
app.set('trust proxy', 1);

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: false,
}));

app.use(express.json({ limit: '10kb' })); // cap body size

/* ------------------------------------------------------------------ *
 * Root route — returns 200 so Render's HTTP health check passes and
 * visitors to the bare URL see a useful payload instead of a 404.
 *
 * `app.get` also handles HEAD requests (Express maps them to GET
 * routes automatically per RFC 7231), so both `GET /` and `HEAD /`
 * succeed — no more `404 HEAD /` in the logs.
 * ------------------------------------------------------------------ */
app.get('/', (req, res) => {
  res.json({
    name: 'LLM Calculator API',
    status: 'running',
    env: IS_PRODUCTION ? 'production' : 'development',
    uptime: Math.round(process.uptime()),
    endpoints: {
      health: '/api/health',
      calculate: 'POST /api/calculations',
      history: '/api/calculations/history',
      usage: '/api/calculations/usage',
    },
  });
});

// All API routes live under /api
app.use('/api', apiRouter);

// ⚠️ ORDER MATTERS — these MUST be last, in this exact order:
app.use(notFound);       // any unmatched route → 404 JSON
app.use(errorHandler);   // any next(err) → shaped error response

/* ------------------------------------------------------------------ *
 * Start server
 * ------------------------------------------------------------------ */
const PORT = Number(process.env.PORT) || 5000;

const start = async () => {
  try {
    await connectDatabase();

    const server = app.listen(PORT, () => {
      // On Render, RENDER_EXTERNAL_URL holds the public https URL.
      // Locally it's absent, so fall back to localhost.
      const publicUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

      console.log(`🚀 Server listening on port ${PORT}`);
      console.log(`   Public URL: ${publicUrl}`);
      console.log(`   API base:   ${publicUrl}/api`);
      console.log(`   Health:     ${publicUrl}/api/health`);
      console.log(`   Provider:   ${AI_PROVIDER}`);
      console.log(`   Model:      ${MODEL_CONFIG.model}`);
      console.log(`   Env:        ${process.env.NODE_ENV || 'development'}`);
      if (IS_RENDER) console.log('   Platform:   Render');
    });

    /* ── Graceful shutdown ─────────────────────────────────────── */
    const shutdown = async (signal) => {
      console.log(`\n${signal} received — shutting down gracefully...`);

      server.close(async () => {
        console.log('HTTP server closed');
        await disconnectDatabase();
        process.exit(0);
      });

      // Force-exit if it takes longer than 10s
      setTimeout(() => {
        console.error('⚠️  Forced exit after 10s timeout');
        process.exit(1);
      }, 10_000).unref();
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    /* ── Runtime error safety nets ─────────────────────────────── */
    process.on('unhandledRejection', (reason) => {
      console.error('💥 Unhandled rejection:', reason);
    });
    process.on('uncaughtException', (err) => {
      console.error('💥 Uncaught exception:', err);
      process.exit(1);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err.message);
    process.exit(1);
  }
};

start();

export default app; // exported for supertest in integration tests