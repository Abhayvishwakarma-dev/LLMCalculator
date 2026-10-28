// client/src/services/calculationApi.js

/**
 * Thin fetch wrapper around the backend API.
 * Every component imports from here — never calls `fetch` directly.
 *
 * In dev, Vite's proxy (vite.config.js) forwards /api/* to :5000,
 * so relative paths work without any URL configuration.
 */

const API_BASE = '/api';

/**
 * Normalize a fetch response into `data` or throw a rich error.
 *
 * Non-2xx responses still carry useful JSON (usage, cost, explanation),
 * so we attach `.status` and `.data` to the thrown error and let the
 * ResultCard decide how to present it.
 */
async function handleResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** POST /api/calculations — run a natural-language calculation */
export async function calculate(query) {
  const res = await fetch(`${API_BASE}/calculations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return handleResponse(res);
}

/** GET /api/calculations/history — paginated */
export async function getHistory(page = 1, limit = 20) {
  const res = await fetch(
    `${API_BASE}/calculations/history?page=${page}&limit=${limit}`
  );
  return handleResponse(res);
}

/** GET /api/calculations/history/:id — single record */
export async function getById(id) {
  const res = await fetch(`${API_BASE}/calculations/history/${id}`);
  return handleResponse(res);
}

/** GET /api/calculations/usage — cumulative dashboard stats */
export async function getUsageStats() {
  const res = await fetch(`${API_BASE}/calculations/usage`);
  return handleResponse(res);
}