// client/src/components/ResultCard.jsx

const fmt = (n) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return Number(n.toFixed(8)).toString();
};

const fmtCost = (usd) => {
  if (!Number.isFinite(usd) || usd === 0) return '$0.00';
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01)  return `$${usd.toFixed(5)}`;
  if (usd < 1)     return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
};

/** Shared meta block — used by success AND 422 responses */
function MetaGrid({ usage, estimatedCost, listPriceCost, model, durationMs }) {
  if (!usage) return null;
  return (
    <div className="meta-grid">
      <div>
        <span className="label">Tokens</span>
        <span className="value">
          {usage.promptTokens} in · {usage.completionTokens} out · {usage.totalTokens} total
        </span>
      </div>
      <div>
        <span className="label">You paid</span>
        <span className="value">{fmtCost(estimatedCost)}</span>
      </div>
      <div>
        <span className="label">List price</span>
        <span className="value">{fmtCost(listPriceCost ?? 0)}</span>
      </div>
      {model && (
        <div>
          <span className="label">Model</span>
          <span className="value">{model}</span>
        </div>
      )}
      {durationMs != null && (
        <div>
          <span className="label">Duration</span>
          <span className="value">{durationMs} ms</span>
        </div>
      )}
    </div>
  );
}

export default function ResultCard({ result, error }) {
  /* ── Error branch ─────────────────────────────────────────────
   * 422 responses still carry usage + cost — the model DID consume
   * tokens even when it refused or the math failed. Show them.
   * ────────────────────────────────────────────────────────────── */
  if (error) {
    const data = error.data || {};
    const isRefusal = error.status === 422 && data.explanation;
    const isMathError = error.status === 422 && data.detail;

    if (isRefusal) {
      return (
        <div className="card result-card refused-card">
          <h2>Couldn’t interpret as math</h2>
          <p className="reason">{data.explanation}</p>
          <MetaGrid
            usage={data.usage}
            estimatedCost={data.estimatedCost}
            listPriceCost={data.listPriceCost}
            model={data.model}
          />
        </div>
      );
    }

    if (isMathError) {
      return (
        <div className="card result-card math-error-card">
          <h2>Calculation failed</h2>
          <p className="reason">{data.detail}</p>
          <MetaGrid
            usage={data.usage}
            estimatedCost={data.estimatedCost}
            listPriceCost={data.listPriceCost}
            model={data.model}
          />
        </div>
      );
    }

    return (
      <div className="card result-card error-card">
        <h2>Something went wrong</h2>
        <p className="reason">{data.error || error.message}</p>
        {data.detail && <p className="detail">{data.detail}</p>}
      </div>
    );
  }

  /* ── Empty state ─────────────────────────────────────────────── */
  if (!result) {
    return (
      <div className="card result-card empty-card">
        <p>Your calculation will appear here.</p>
      </div>
    );
  }

  /* ── Success ─────────────────────────────────────────────────── */
  return (
    <div className="card result-card">
      <div className="answer-block">
        <span className="label">Answer</span>
        <span className="answer-value">{fmt(result.finalAnswer)}</span>
      </div>

      {Array.isArray(result.steps) && result.steps.length > 0 && (
        <div className="steps">
          <h3>Steps</h3>
          <ol>
            {result.steps.map((step, i) => (
              <li key={i}>
                <code>
                  {step.operation}({step.operands.map(fmt).join(', ')}) = {fmt(step.result)}
                </code>
              </li>
            ))}
          </ol>
        </div>
      )}

      <MetaGrid
        usage={result.usage}
        estimatedCost={result.estimatedCost}
        listPriceCost={result.listPriceCost}
        model={result.model}
        durationMs={result.durationMs}
      />

      {result.createdAt && (
        <p className="muted">
          {new Date(result.createdAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}