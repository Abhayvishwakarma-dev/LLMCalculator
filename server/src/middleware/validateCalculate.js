// server/src/middleware/validateCalculate.js
import { AppError } from './errorHandler.js';

/**
 * Hand-rolled validation so this project stays dependency-light.
 * (Swap for `zod` or `joi` if you add more endpoints — same idea.)
 *
 * Rules for POST /api/calculations:
 *  - body must be a plain object (no arrays, no null)
 *  - `query` must be a non-empty string
 *  - `query` must not contain control characters or invisible unicode
 *  - `query` is NFC-normalized, so "é" and "é" are treated as equal
 *  - ≤ 500 code points AND ≤ 2000 UTF-8 bytes
 *  - unexpected keys are rejected (mass-assignment protection)
 */

// Control chars, bidi overrides, zero-width chars, BOM — none of these
// belong in a math query, and every one of them is a log-injection or
// prompt-obfuscation vector.
const FORBIDDEN_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;

const MAX_CHARS = 500;
const MAX_BYTES = 2000; // 4 bytes per code point, worst case

/** Count characters as a human would — "😀😀" is 2, not 4. */
const codePointLength = (s) => [...s].length;

export const validateCalculate = (req, res, next) => {
  const body = req.body;

  /* ── 1. Shape: must be a plain JSON object ──────────────────── */
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return next(new AppError('Request body must be a JSON object', 400));
  }

  /* ── 2. Unknown keys → reject ────────────────────────────────
   * Stops `{ query, isAdmin: true }`-style mass-assignment attempts
   * and makes frontend typos ({"qery": "..."}) surface immediately.
   * ────────────────────────────────────────────────────────── */
  const allowed = new Set(['query']);
  const extras = Object.keys(body).filter((k) => !allowed.has(k));
  if (extras.length) {
    return next(new AppError(`Unexpected field(s): ${extras.join(', ')}`, 400));
  }

  /* ── 3. Type check ──────────────────────────────────────────── */
  if (typeof body.query !== 'string') {
    return next(new AppError('`query` must be a string', 400));
  }

  /* ── 4. Normalize + trim ─────────────────────────────────────
   * NFC first (so length checks measure what the user sees), then trim
   * (so whitespace-only counts as empty without needing a second pass).
   * ────────────────────────────────────────────────────────── */
  const query = body.query.normalize('NFC').trim();

  if (query.length === 0) {
    return next(new AppError('`query` must not be empty', 400));
  }

  /* ── 5. Reject control / invisible characters ────────────────
   * A raw `\r\n` lets an attacker forge log lines. Bidi overrides
   * reverse text in terminals. Zero-width chars can split tokens.
   * None of these are legitimate in a calculator query.
   * ────────────────────────────────────────────────────────── */
  if (FORBIDDEN_CHARS.test(query)) {
    return next(new AppError('`query` contains invalid characters', 400));
  }

  /* ── 6. Character-length cap (code points) ─────────────────── */
  const chars = codePointLength(query);
  if (chars > MAX_CHARS) {
    return next(
      new AppError(`\`query\` must be ≤ ${MAX_CHARS} characters (got ${chars})`, 400)
    );
  }

  /* ── 7. Byte-length cap (defense against emoji spam) ───────── */
  const bytes = Buffer.byteLength(query, 'utf8');
  if (bytes > MAX_BYTES) {
    return next(
      new AppError(`\`query\` exceeds ${MAX_BYTES} bytes (got ${bytes})`, 413)
    );
  }

  /* ── 8. Hand the normalized value to the controller ─────────
   * Controller and services never see the raw, un-normalized input.
   * ────────────────────────────────────────────────────────── */
  req.body.query = query;
  next();
};