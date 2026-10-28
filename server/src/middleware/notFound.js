// server/src/middleware/notFound.js
import { AppError } from './errorHandler.js';

export const notFound = (req, res, next) => {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
};
