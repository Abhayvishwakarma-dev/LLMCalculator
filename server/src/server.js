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
 *
 * MONGODB_URI is always required.
 * For the AI provider, either GEMINI_API_KEY (free) or OPENAI_API_KEY
 * (paid) must be present. `config/openai.js` already resolved the
 * provider and will have thrown at import time if neither was set —
 * but we re-check here so the error message points to the right fix.
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
      console.log(`🚀 Server listening on http://localhost:${PORT}`);
      console.log(`   API base:  http://localhost:${PORT}/api`);
      console.log(`   Health:    http://localhost:${PORT}/api/health`);
      console.log(`   Provider:  ${AI_PROVIDER}`);
      console.log(`   Model:     ${MODEL_CONFIG.model}`);
      console.log(`   Env:       ${process.env.NODE_ENV || 'development'}`);
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