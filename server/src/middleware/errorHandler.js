// server/src/middleware/errorHandler.js

/**
 * Express requires exactly FOUR arguments to recognize a middleware
 * as an error handler. Do not "clean up" the unused `next` — it breaks
 * Express's dispatch logic.
 *
 * Contract: any route/controller should call `next(err)` with a plain
 * Error. This handler shapes it into a consistent JSON envelope and
 * decides whether to leak details (dev) or mask them (prod).
 *
 * Design rule: this handler must NEVER throw. If it does, Express falls
 * back to its default HTML error page and you lose the JSON contract.
 */
export const errorHandler = (err, req, res, next) => {
  /* ── 1. Normalize input ─────────────────────────────────────────
   * `err` might be a string, a plain object, or even undefined if some
   * library calls `next('oops')`. Coerce to a real Error so the rest
   * of this function can rely on `.message` and `.stack`.
   * ────────────────────────────────────────────────────────────── */
  const safeErr = err instanceof Error ? err : new Error(String(err ?? 'Unknown error'));

  /* ── 2. Validate status code ────────────────────────────────────
   * Express's res.status() throws RangeError if the value isn't an
   * integer in [100, 599]. A thrown `{ status: 999 }` from a
   * third-party lib would crash this handler — defeats the purpose.
   * ────────────────────────────────────────────────────────────── */
  let status = Number(safeErr.status ?? safeErr.statusCode ?? 500);
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    status = 500;
  }

  const isServerError = status >= 500;

  /* ── 3. Double-send guard — BEFORE logging ──────────────────────
   * If headers are already on the wire, we can't send a JSON body.
   * Hand off to Express's default handler (which closes the socket
   * cleanly) and let it log — otherwise we'd log the same error twice.
   * ────────────────────────────────────────────────────────────── */
  if (res.headersSent) {
    return next(safeErr);
  }

  /* ── 4. Log with appropriate verbosity ────────────────────────── */
  if (isServerError) {
    console.error('💥 Unhandled error:', {
      message: safeErr.message,
      stack: safeErr.stack,
      path: req.path,
      method: req.method,
    });
  } else {
    console.warn(`⚠️  ${status} ${req.method} ${req.path}: ${safeErr.message}`);
  }

  /* ── 5. Shape the response ────────────────────────────────────── */
  const body = {
    error: isServerError ? 'Internal server error' : safeErr.message || 'Request failed',
  };

  // Dev-only extras: stack + extra details. In prod, keep this masked.
  if (process.env.NODE_ENV !== 'production') {
    body.stack = safeErr.stack;
    if (safeErr.details) body.details = safeErr.details;
  }

  res.status(status).json(body);
};

/**
 * Helper so controllers/services can throw errors with an HTTP status
 * pre-attached, e.g.  throw new AppError('Not found', 404)
 *
 * Also validates `status` here so the throw site fails loudly instead
 * of the error handler silently coercing to 500.
 */
export class AppError extends Error {
  constructor(message, status = 500, details = undefined) {
    super(message);
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      throw new RangeError(`AppError: invalid HTTP status ${status}`);
    }
    this.name = 'AppError';
    this.status = status;
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }
}