# 🧮 LLM-Powered Smart Calculator

> Natural-language math, executed safely. Ask "Add 2 and 3, then multiply by 3" and get **15** — with a step-by-step trace, real OpenAI token usage, and a running cost total.

A full-stack MERN application that uses OpenAI's function-calling API to parse natural-language math into a **structured plan**, executes that plan through a **whitelisted, sandboxed math engine** (no `eval`, ever), and tracks **actual token usage and dollar cost** per request.

---

## ✨ Features

- 🗣️ **Natural-language input** — "Add 2 and 3, then multiply by 3" → `15`
- 🧠 **Structured LLM output** — OpenAI function calling returns a validated plan, not free text
- 🔒 **Safe execution** — only whitelisted operations (`add`, `subtract`, `multiply`, `divide`, `power`, `modulo`, `sqrt`); no `eval`, no `new Function`, no dynamic code
- 🪜 **Step-by-step trace** — every intermediate result is shown and stored
- 🔢 **Token tracking** — exact `prompt`, `completion`, and `total` token counts from the API's `usage` object
- 💰 **Cost tracking** — per-request USD cost computed from configurable per-model pricing
- 📊 **Usage dashboard** — cumulative tokens and cost across all requests
- 📜 **History** — every calculation persisted in MongoDB with full trace and metadata
- ⚡ **Rate-limited** — 20 requests/min/IP by default to cap API spend
- 🛡️ **Validated at every layer** — middleware, service, and Mongoose schema

---

## 🏗️ Architecture

```
┌────────────────┐      POST /api/calculations       ┌────────────────────┐
│  React + Vite  │ ───────────────────────────────▶  │  Express (Node.js) │
│  (frontend)    │ ◀───────────────────────────────  │  (backend)         │
└────────────────┘   { steps, answer, usage, cost }  └─────────┬──────────┘
                                                               │
                             ┌─────────────────────────────────┼───────────────────┐
                             ▼                                 ▼                   ▼
                    ┌─────────────────┐              ┌──────────────────┐  ┌──────────────┐
                    │ calculator.svc  │─── uses ────▶│ OpenAI API       │  │  MongoDB     │
                    │ (orchestrator)  │              │ (gpt-4o-mini)    │  │  (records)   │
                    └────────┬────────┘              └──────────────────┘  └──────────────┘
                             │
                    ┌────────┴────────┐
                    ▼                 ▼
              ┌───────────┐    ┌─────────────┐
              │ math.svc  │    │ cost.svc    │
              │ (safe)    │    │ (pricing)   │
              └───────────┘    └─────────────┘
```

**Flow for a single request:**

1. **Frontend** POSTs `{ query: "Add 2 and 3, then multiply by 3" }`
2. **`rateLimiter`** → **`validateCalculate`** → **controller**
3. **`calculator.service.js`** calls OpenAI with a **tool schema** — model can only return `{ steps: [{ operation, operands }] }`
4. **`math.service.js`** executes the plan through a **whitelisted operation table** — no code execution
5. **`cost.service.js`** computes USD from the API's actual `usage` object
6. **`Calculation` model** persists everything; controller returns the shaped JSON
7. **Dashboard** aggregates with a single MongoDB `$group` pipeline

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite |
| Backend | Node.js 18+ + Express 4 |
| Database | MongoDB 6+ (local or Atlas) |
| AI | OpenAI API (`gpt-4o-mini` by default) |
| Safety | Whitelisted math engine + JSON Schema tool calling |
| Cost tracking | Real API token counts × configurable per-model pricing |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18.17 ([nvm](https://github.com/nvm-sh/nvm) recommended)
- **MongoDB** ≥ 6 (local install, Docker, or [Atlas](https://www.mongodb.com/atlas))
- **OpenAI API key** ([get one](https://platform.openai.com/api-keys))

### 1. Clone and install

```bash
git clone <your-repo-url> llm-calculator
cd llm-calculator

# Backend
cd server
npm install
cp .env.example .env
# Edit .env and fill in MONGODB_URI and OPENAI_API_KEY

# Frontend
cd ../client
npm install
```

### 2. Configure environment

**`server/.env`**

```env
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/llm_calculator
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
CLIENT_ORIGIN=http://localhost:5173
```

**`client/.env`** (optional, if backend URL differs from default)

```env
VITE_API_URL=http://localhost:5000/api
```

### 3. Run both services

```bash
# Terminal 1 — backend
cd server
npm run dev
# → 🚀 Server listening on http://localhost:5000

# Terminal 2 — frontend
cd client
npm run dev
# → VITE ready — open http://localhost:5173
```

Open **http://localhost:5173** and try: *"Add 2 and 3, then multiply the result by 3."*

---

## 📡 API Reference

All endpoints live under `/api`.

### `POST /api/calculations`

Run a natural-language calculation.

**Request**

```json
{ "query": "Add 2 and 3, then multiply the result by 3" }
```

**Response `201`**

```json
{
  "id": "66f3a1c8e2b5...",
  "query": "Add 2 and 3, then multiply the result by 3",
  "plan": [
    { "operation": "add", "operands": [2, 3] },
    { "operation": "multiply", "operands": [3] }
  ],
  "steps": [
    { "operation": "add",      "operands": [2, 3], "result": 5 },
    { "operation": "multiply", "operands": [5, 3], "result": 15 }
  ],
  "finalAnswer": 15,
  "model": "gpt-4o-mini",
  "usage": { "promptTokens": 142, "completionTokens": 38, "totalTokens": 180 },
  "estimatedCost": 0.0000441,
  "durationMs": 1843,
  "createdAt": "2026-10-28T09:12:34.000Z"
}
```

**Error responses**

| Status | Meaning |
|---|---|
| `400` | Invalid request body (missing/empty `query`, too long) |
| `422` | Model couldn't interpret as math **OR** math execution failed (div-by-zero, etc.) |
| `429` | Rate limit exceeded (20 req/min/IP) |
| `502` | LLM returned malformed output |
| `503`/`502` | Upstream OpenAI error |

### `GET /api/calculations/history?page=1&limit=20`

Paginated history, newest first.

```json
{
  "items": [ /* Calculation records */ ],
  "pagination": { "page": 1, "limit": 20, "total": 42, "pages": 3 }
}
```

### `GET /api/calculations/history/:id`

Single record by ID.

### `GET /api/calculations/usage`

Cumulative dashboard stats.

```json
{
  "totalRequests": 42,
  "totalPromptTokens": 5964,
  "totalCompletionTokens": 1596,
  "totalTokens": 7560,
  "totalCost": 0.0018522,
  "avgDurationMs": 1742.5,
  "lastRequestAt": "2026-10-28T09:12:34.000Z"
}
```

### `GET /api/health`

Liveness probe — no auth, no DB, sub-millisecond.

```json
{ "status": "ok", "uptime": 312.4, "timestamp": "2026-10-28T09:15:00.000Z" }
```

---

## 🔒 Security model

This project exists in a category where the obvious implementation is dangerous: **naively asking an LLM to "return the answer" or "return a JS expression" leads to arbitrary code execution**. This app is built to make that structurally impossible.

### The three hard guarantees

1. **No `eval`, no `new Function`** — searched for in CI; fails the build if introduced
2. **LLM output is a plan, not code** — enforced by JSON Schema with `enum` on `operation` and `additionalProperties: false`
3. **Executor whitelist is a `const`** — the model cannot add operations, only choose from a fixed set

### Defense in depth

| Layer | Defense |
|---|---|
| Tool schema | Model can only emit `{ steps: [{ operation, operands }] }` with whitelisted ops |
| Service | `executePlan` validates operation against `OPERATIONS`, rejects non-finite numbers, catches div-by-zero |
| Model | Mongoose `strict: 'throw'` + `enum` on `operation` in both `plan` and `steps` |
| Middleware | Body size capped at 10 kB, `query` ≤ 500 chars, unexpected keys rejected |
| Network | Rate limited to 20 req/min/IP |
| Secrets | `.env` gitignored; config files throw at import time if missing |

**What the LLM *cannot* do:**
- Return a string that gets executed
- Reference `previous_result` (executor chains steps itself — see chaining below)
- Add a new operation not in the whitelist
- Return `NaN` or `Infinity` (rejected at every layer)
- Return an unbounded plan (max 20 steps, enforced twice)

---

## 🧮 Chaining semantics

Plans use **result chaining** — if a step omits operands, the previous result fills in. This keeps the LLM's output simple and makes correctness a property of the executor, not the prompt.

```json
{
  "steps": [
    { "operation": "add",      "operands": [2, 3] },
    { "operation": "multiply", "operands": [3]    }
  ]
}
```

Executes as:
- Step 1: `2 + 3 = 5`
- Step 2: `5 × 3 = 15` (previous `5` prepended automatically)

The LLM never has to compute intermediate values — a class of errors that prompt-only approaches can't eliminate.

---

## 💰 Cost tracking

Token counts are **never estimated** — they come directly from the OpenAI response's `usage` object. Cost is computed as:

```
cost = (promptTokens / 1,000,000 × inputPricePerMillion)
     + (completionTokens / 1,000,000 × outputPricePerMillion)
```

Pricing lives in `server/src/config/openai.js` in `MODEL_PRICING`. Update it when OpenAI changes prices. Currently configured models:

| Model | Input ($/1M) | Output ($/1M) |
|---|---|---|
| `gpt-4o-mini` | $0.15 | $0.60 |
| `gpt-4o` | $2.50 | $10.00 |
| `gpt-4.1` | $2.00 | $8.00 |
| `gpt-4.1-mini` | $0.40 | $1.60 |
| `gpt-4.1-nano` | $0.10 | $0.40 |

Costs are rounded to 8 decimal places so tiny per-request costs don't get silently truncated to `$0.00` before aggregation.

---

## 🧪 Manual smoke test

After `npm run dev` on both sides:

```bash
# Health
curl http://localhost:5000/api/health

# End-to-end
curl -X POST http://localhost:5000/api/calculations \
  -H 'Content-Type: application/json' \
  -d '{"query":"Add 2 and 3, then multiply the result by 3"}'
# → finalAnswer: 15

# Validation error
curl -X POST http://localhost:5000/api/calculations \
  -H 'Content-Type: application/json' \
  -d '{"query":""}'
# → 400 { "error": "`query` must not be empty" }

# Rate limit
for i in $(seq 1 25); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:5000/api/calculations \
    -H 'Content-Type: application/json' -d '{"query":"1+1"}'
done
# → last few should be 429

# Dashboard
curl http://localhost:5000/api/calculations/usage
```

---

## 📁 Project structure

```
llm-calculator/
├── client/                         React + Vite frontend
│   ├── index.html
│   ├── package.json
│   └── src/
│       ├── components/
│       │   ├── CalculatorInput.jsx
│       │   ├── ResultCard.jsx
│       │   └── UsageStats.jsx
│       ├── services/calculationApi.js
│       ├── App.jsx
│       ├── main.jsx
│       └── styles.css
│
├── server/                         Express + MongoDB backend
│   ├── src/
│   │   ├── config/
│   │   │   ├── database.js         MongoDB connection + lifecycle
│   │   │   └── openai.js           OpenAI client, MODEL_CONFIG, MODEL_PRICING
│   │   ├── middleware/
│   │   │   ├── errorHandler.js     global error shape + AppError class
│   │   │   ├── notFound.js         404 for unmatched routes
│   │   │   ├── validateCalculate.js body validation for POST /calculations
│   │   │   ├── rateLimiter.js      20 req/min/IP, LLM-budget protection
│   │   │   └── index.js            barrel export
│   │   ├── controllers/
│   │   │   ├── calculation.controller.js  translate outcome → HTTP, persist
│   │   │   └── index.js
│   │   ├── models/
│   │   │   ├── Calculation.js      Mongoose schema, indexes, statics
│   │   │   └── index.js
│   │   ├── routes/
│   │   │   ├── calculation.routes.js
│   │   │   └── index.js
│   │   ├── services/
│   │   │   ├── math.service.js     safe executor — no eval, whitelist only
│   │   │   ├── cost.service.js     token usage → USD
│   │   │   ├── calculator.service.js  orchestrator: LLM → plan → execute → cost
│   │   │   └── index.js
│   │   └── server.js               entry: env validation, wiring, shutdown
│   ├── package.json
│   └── .env.example
│
├── .gitignore
└── README.md
```

---

## 🧭 Design decisions worth knowing

| Decision | Why |
|---|---|
| **Function calling, not prompt-based JSON** | The model is trained to emit schema-valid arguments; parsing is trivial and reliable |
| **`temperature: 0`** | Parsing is a deterministic task — the same query should always produce the same plan |
| **`tool_choice: 'auto'`** (not `'required'`) | Lets the model politely refuse non-math queries instead of hallucinating a plan |
| **Store `plan` AND `steps`** | Audit trail: was a wrong answer caused by a bad plan or a bad executor? |
| **8-decimal cost rounding** | JavaScript `0.1 + 0.2 !== 0.3`; rounds drift away before `$sum` accumulates it |
| **Rate limit only on `POST`** | The only endpoint that spends money; history/usage are cheap |
| **Barrel exports** | `import { x } from '../services'` reads better than 3 lines; internal service-to-service imports stay direct to avoid circular refs |
| **`import 'dotenv/config'` first** | ES modules hoist imports; config files read `process.env` at module-evaluation time |
| **`process.exit(1)` on missing env** | Deploy-time failure beats discovery-by-first-user |

---

## 🐛 Troubleshooting

**`OPENAI_API_KEY is not set` on startup** — `.env` is missing, in the wrong directory, or `import 'dotenv/config'` is not the first line of `server.js`. Env vars must be loaded before config modules are imported.

**`MongooseServerSelectionError`** — MongoDB isn't running locally. Try `docker run -d -p 27017:27017 mongo:7`, or switch `MONGODB_URI` to an Atlas cluster string.

**`ERR_HTTP_HEADERS_SENT`** — a controller tried to `res.json()` twice. Usually means a `try/catch` calls `next(err)` *after* already responding. Check `if (res.headersSent)` — it's already handled in `errorHandler`, so the culprit is usually a missed `return` before `next(err)`.

**429 from OpenAI** — your account hit rate limits. The SDK retries twice automatically (configured in `config/openai.js`). If it persists, check your [usage dashboard](https://platform.openai.com/usage).

**`CastError` on `/history/history`** — route order bug. `/history` must be declared **before** `/history/:id`, otherwise Express matches `:id = "history"`.

**Cost shows `$0.00000000`** — the model isn't in `MODEL_PRICING`. Add it to `config/openai.js` — `getModelPricing` throws if the model is unknown, so you'll see the error, not a silent zero.

---

## 📜 License

MIT — do whatever, just don't blame me if OpenAI changes their pricing.

---

## 🙏 Acknowledgements

- [OpenAI function calling docs](https://platform.openai.com/docs/guides/function-calling) — the pattern this app is built around
- The `usage` object pattern from production LLM observability tools (Helicone, Langfuse)
- Decades of "don't `eval` user input" wisdom that this app applies to LLM output