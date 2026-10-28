// server/src/config/database.js
import mongoose from 'mongoose';

/**
 * Connects to MongoDB using the URI from environment variables.
 * Called exactly ONCE from server.js at application startup.
 *
 * Design notes:
 *  - We fail fast: if MONGODB_URI is missing, throw immediately.
 *  - `serverSelectionTimeoutMS` prevents hanging forever on a bad host.
 *  - Mongoose keeps an internal connection pool; no need to export the
 *    connection object — just import the models and they use the default.
 */
export const connectDatabase = async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('MONGODB_URI is not set. Check your .env file.');
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000, // fail in 5s instead of 30s
    });
    console.log(`✅ MongoDB connected → ${mongoose.connection.host}/${mongoose.connection.name}`);
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    throw err; // let server.js decide to exit
  }
};

/**
 * Gracefully close the connection.
 * Called on SIGINT/SIGTERM in server.js so you don't leak handles.
 */
export const disconnectDatabase = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
  }
};

// --- Connection lifecycle logging (useful in dev to spot flapping) ---
mongoose.connection.on('disconnected', () => console.warn('⚠️  MongoDB disconnected'));
mongoose.connection.on('reconnected', () => console.log('✅ MongoDB reconnected'));

export default connectDatabase;