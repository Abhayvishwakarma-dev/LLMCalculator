// server/src/config/openai.js
import OpenAI from 'openai';

/**
 * Provider-aware AI client — supports BOTH Gemini and OpenAI through
 * the same `openai` SDK.
 *
 *   Gemini  → baseURL: https://generativelanguage.googleapis.com/v1beta/openai
 *             env:     GEMINI_API_KEY        (free tier, no credit card)
 *
 *   OpenAI  → baseURL: default (api.openai.com)
 *             env:     OPENAI_API_KEY        (paid)
 *
 * Selection order:
 *   1. AI_PROVIDER=gemini | openai   (explicit override)
 *   2. GEMINI_API_KEY present        → gemini
 *   3. OPENAI_API_KEY present        → openai
 *   4. neither                       → throw at boot
 *
 * NOTE: this module reads process.env at import time, so `server.js`
 * MUST have `import 'dotenv/config';` as its first line.
 */

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

const explicit = (process.env.AI_PROVIDER || '').toLowerCase();

const provider =
  explicit === 'gemini' || explicit === 'openai'
    ? explicit
    : process.env.GEMINI_API_KEY
      ? 'gemini'
      : process.env.OPENAI_API_KEY
        ? 'openai'
        : null;

if (!provider) {
  throw new Error(
    'No AI provider configured. Add GEMINI_API_KEY (free) or OPENAI_API_KEY to .env.'
  );
}

const apiKey =
  provider === 'gemini'
    ? process.env.GEMINI_API_KEY
    : process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error(
    `AI_PROVIDER=${provider} but the matching API key is missing in .env.`
  );
}

const openai = new OpenAI({
  apiKey,
  // Gemini needs an explicit base URL; OpenAI uses the SDK default.
  ...(provider === 'gemini' ? { baseURL: GEMINI_BASE_URL } : {}),
  timeout: 30_000, // fail fast on hung requests
  maxRetries: 2,   // SDK retries 429/5xx automatically
});

/** Exported for logging / debugging in server.js */
export const AI_PROVIDER = provider;

/**
 * Default model per provider.
 *
 * Gemini free tier allows Flash-family models only, with roughly
 * 5–15 RPM and ~1,500 RPD shared across Flash / Flash-Lite.
 * `gemini-2.5-flash-lite` is retired for new projects — default to
 * the current free-tier workhorse instead.
 */
const DEFAULT_MODELS = {
  gemini: 'gemini-3.5-flash-lite',
  openai: 'gpt-4o-mini',
};

/**
 * Model + decoding config used by the calculator service.
 *
 * Resolution order for the model name:
 *   1. AI_MODEL                  (works for both providers)
 *   2. OPENAI_MODEL              (only when provider === 'openai')
 *   3. DEFAULT_MODELS[provider]
 *
 * `temperature: 0` → deterministic plans. Parsing is not a creative
 * task; the same query must always produce the same tool call.
 *
 * `tool_choice: 'auto'` → the ONLY value both providers honour
 * consistently. Gemini Flash ignores `'required'`, and the
 * calculator service needs `'auto'` anyway so the model can refuse
 * non-math queries instead of hallucinating a plan.
 */
export const MODEL_CONFIG = {
  model:
    process.env.AI_MODEL ||
    (provider === 'openai' ? process.env.OPENAI_MODEL : undefined) ||
    DEFAULT_MODELS[provider],
  temperature: 0,
  max_tokens: 500,
  tool_choice: 'auto',
};

/**
 * Pricing in USD per 1,000,000 tokens.
 *
 *   input / output  → what YOU are charged (0 on free tier)
 *   listPrice       → the published paid-tier rate, used for
 *                     "would-be cost" display so token counts stay
 *                     meaningful even when you pay $0
 */
export const MODEL_PRICING = {
  // ── Gemini free tier ─────────────────────────────────────────
  'gemini-3.5-flash-lite': {
    input: 0, output: 0,
    listPrice: { input: 0.30, output: 2.50 },
  },
  'gemini-3.8-flash': {
    input: 0, output: 0,
    listPrice: { input: 0.75, output: 3.75 },
  },
  'gemini-3.6-flash': {
    input: 0, output: 0,
    listPrice: { input: 0.75, output: 3.75 },
  },
  'gemini-3.1-flash-lite': {
    input: 0, output: 0,
    listPrice: { input: 0.25, output: 1.50 },
  },
  'gemini-2.5-flash': {
    input: 0, output: 0,
    listPrice: { input: 0.30, output: 2.50 },
  },

  // ── OpenAI paid (input/output === listPrice) ────────────────
  'gpt-4o-mini':  { input: 0.15, output: 0.60, listPrice: { input: 0.15,  output: 0.60 } },
  'gpt-4o':       { input: 2.50, output: 10.00, listPrice: { input: 2.50,  output: 10.00 } },
  'gpt-4.1':      { input: 2.00, output: 8.00, listPrice: { input: 2.00,  output: 8.00 } },
  'gpt-4.1-mini': { input: 0.40, output: 1.60, listPrice: { input: 0.40,  output: 1.60 } },
  'gpt-4.1-nano': { input: 0.10, output: 0.40, listPrice: { input: 0.10,  output: 0.40 } },
};

/** True when the model bills at $0 but has a known paid-tier rate. */
export const isFreeTierModel = (model) => {
  const p = MODEL_PRICING[model];
  return Boolean(p && p.input === 0 && p.output === 0 && p.listPrice);
};

/**
 * Safe accessor — throws early if a model is missing from the table
 * rather than silently computing a $0 cost.
 */
export const getModelPricing = (model) => {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    throw new Error(
      `No pricing configured for model "${model}". Add it to MODEL_PRICING in config/openai.js.`
    );
  }
  return pricing;
};

export default openai;