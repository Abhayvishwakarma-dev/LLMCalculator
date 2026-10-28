// client/src/components/CalculatorInput.jsx
import { useState } from 'react';
import { calculate } from '../services/calculationApi.js';

const EXAMPLES = [
  'Add 2 and 3, then multiply the result by 3',
  'What is 40 divided by 5?',
  'What is the square root of 144?',
  'Start with 10, add 5, multiply by 2, then subtract 9',
];

const MAX_CHARS = 500;

export default function CalculatorInput({ onResult, onError, disabled = false }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    try {
      const result = await calculate(trimmed);
      onResult?.(result);
    } catch (err) {
      onError?.(err);
    } finally {
      setLoading(false);
    }
  };

  // Ctrl/Cmd + Enter submits — standard UX for textarea forms
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  const charCount = [...query].length;
  const tooLong = charCount > MAX_CHARS;
  const busy = loading || disabled;

  return (
    <form className="calc-input" onSubmit={submit}>
      <label htmlFor="query">Ask a math question</label>
      <textarea
        id="query"
        rows={3}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="e.g. Add 2 and 3, then multiply the result by 3"
        maxLength={MAX_CHARS + 50}
        disabled={busy}
        autoFocus
      />

      <div className="calc-meta">
        <span className={tooLong ? 'char-count over' : 'char-count'}>
          {charCount} / {MAX_CHARS}
        </span>
        <button
          type="submit"
          disabled={!query.trim() || busy || tooLong}
        >
          {loading ? 'Calculating…' : 'Calculate'}
        </button>
      </div>

      <div className="examples">
        <span className="examples-label">Try:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            className="example-chip"
            onClick={() => setQuery(ex)}
            disabled={busy}
          >
            {ex}
          </button>
        ))}
      </div>

      <p className="hint">Tip: Ctrl/Cmd + Enter to submit</p>
    </form>
  );
}