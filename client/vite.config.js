// client/vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite dev server config.
 *
 * The `proxy` block is what makes `fetch('/api/calculations')` work
 * from the browser during development. Without it, the request would
 * go to `localhost:5173/api/calculations` (Vite itself) → 404.
 *
 * With the proxy, Vite forwards any path starting with /api to
 * Express on :5000, so your React code never needs to know the
 * backend URL. In production you'd serve both behind one origin
 * (or use an env var like VITE_API_URL).
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,   // fail loudly if 5173 is taken — better than silently switching to 5174 and breaking CLIENT_ORIGIN
    proxy: {
      '/api': {
        target: 'https://llmcalculator.onrender.com',
        changeOrigin: true,
      },
    },
  },
});