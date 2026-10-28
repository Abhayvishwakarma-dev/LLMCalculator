// client/src/App.jsx
import { useState } from 'react';
import CalculatorInput from './components/CalculatorInput.jsx';
import ResultCard from './components/ResultCard.jsx';
import UsageStats from './components/UsageStats.jsx';

export default function App() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [usageRefreshKey, setUsageRefreshKey] = useState(0);

  const handleResult = (r) => {
    setResult(r);
    setError(null);
    setUsageRefreshKey((k) => k + 1); // dashboard refetches
  };

  const handleError = (err) => {
    setError(err);
    setResult(null);
    setUsageRefreshKey((k) => k + 1); // error still consumed tokens
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>LLM Calculator</h1>
        <p className="tagline">Natural-language math, executed safely.</p>
      </header>

      <main className="app-main">
        <section className="col col-main">
          <CalculatorInput onResult={handleResult} onError={handleError} />
          <ResultCard result={result} error={error} />
        </section>
        <aside className="col col-side">
          <UsageStats refreshKey={usageRefreshKey} />
        </aside>
      </main>

      <footer className="app-footer">
        <p>Powered by an LLM planner + safe whitelisted math engine.</p>
      </footer>
    </div>
  );
}