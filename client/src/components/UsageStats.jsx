// client/src/components/UsageStats.jsx
import { useEffect, useState } from 'react';
import { getUsageStats } from '../services/calculationApi.js';

const fmtCost = (usd) => {
  if (!Number.isFinite(usd) || usd === 0) return '$0.00';
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01)  return `$${usd.toFixed(5)}`;
  if (usd < 1)     return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
};

/**
 * Cumulative dashboard.
 *
 * `refreshKey` is bumped by App whenever a new calculation succeeds —
 * that triggers a refetch so totals stay current without polling.
 */
export default function UsageStats({ refreshKey = 0 }) {
  const [stats, setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getUsageStats()
      .then((data) => { if (!cancelled) setStats(data); })
      .catch((err) => { if (!cancelled) setError(err); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [refreshKey]);

  if (loading && !stats) {
    return <div className="card usage-card"><p>Loading usage…</p></div>;
  }

  if (error) {
    return (
      <div className="card usage-card error-card">
        <p>Usage unavailable: {error.message}</p>
      </div>
    );
  }

  return (
    <div className="card usage-card">
      <h2>Usage Dashboard</h2>
      <div className="stats-grid">
        <div className="stat">
          <span className="label">Requests</span>
          <span className="value">{stats.totalRequests}</span>
        </div>
        <div className="stat">
          <span className="label">Total tokens</span>
          <span className="value">{stats.totalTokens.toLocaleString()}</span>
        </div>
        <div className="stat">
          <span className="label">Prompt</span>
          <span className="value">{stats.totalPromptTokens.toLocaleString()}</span>
        </div>
        <div className="stat">
          <span className="label">Completion</span>
          <span className="value">{stats.totalCompletionTokens.toLocaleString()}</span>
        </div>
        <div className="stat">
          <span className="label">You paid</span>
          <span className="value">{fmtCost(stats.totalCost)}</span>
        </div>
        <div className="stat">
          <span className="label">List price</span>
          <span className="value">{fmtCost(stats.totalListCost ?? 0)}</span>
        </div>
        <div className="stat">
          <span className="label">Avg duration</span>
          <span className="value">{Math.round(stats.avgDurationMs ?? 0)} ms</span>
        </div>
      </div>
      {stats.lastRequestAt && (
        <p className="muted">
          Last request: {new Date(stats.lastRequestAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}