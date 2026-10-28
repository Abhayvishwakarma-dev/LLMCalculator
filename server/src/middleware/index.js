// server/src/middleware/index.js

// Barrel export — public API for the middleware layer.
// Internal middleware imports each other DIRECTLY (e.g. notFound.js
// imports from './errorHandler.js', not from './index.js') to avoid
// circular dependencies.
export { errorHandler, AppError } from './errorHandler.js';
export { notFound } from './notFound.js';
export { validateCalculate } from './validateCalculate.js';
export { rateLimiter } from './rateLimiter.js';