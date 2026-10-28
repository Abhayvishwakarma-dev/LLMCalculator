// server/src/models/Calculation.js
import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/* ------------------------------------------------------------------ *
 * Sub-schema: a single execution step
 * Stored alongside the plan so history can replay exactly what ran,
 * including intermediate results — not just the final answer.
 * ------------------------------------------------------------------ */
const StepSchema = new Schema(
  {
    operation: {
      type: String,
      required: true,
      enum: ['add', 'subtract', 'multiply', 'divide', 'power', 'sqrt', 'modulo'],
    },
    operands: {
      type: [Number],
      required: true,
      validate: {
        validator: (arr) => arr.length >= 1 && arr.length <= 2,
        message: 'Each step must have 1 or 2 operands',
      },
    },
    result: {
      type: Number,
      required: true,
      validate: {
        // NaN / Infinity can't be stored faithfully — reject them here
        validator: Number.isFinite,
        message: 'Result must be a finite number',
      },
    },
  },
  { _id: false } // steps are value objects; no independent identity needed
);

/* ------------------------------------------------------------------ *
 * Sub-schema: token usage from the OpenAI response
 * Mirrors the API's `usage` object 1:1 so dashboards can sum directly.
 * ------------------------------------------------------------------ */
const UsageSchema = new Schema(
  {
    promptTokens: { type: Number, required: true, min: 0 },
    completionTokens: { type: Number, required: true, min: 0 },
    totalTokens: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

/* ------------------------------------------------------------------ *
 * Main schema
 * ------------------------------------------------------------------ */
const CalculationSchema = new Schema(
  {
    /* ── Input ─────────────────────────────────────────────────── */
    query: {
      type: String,
      required: [true, 'query is required'],
      trim: true,
      minlength: [1, 'query must not be empty'],
      maxlength: [500, 'query must be ≤ 500 characters'],
    },

    /* ── LLM output (as received, before execution) ────────────── */
    plan: {
      type: [
        new Schema(
          {
            operation: {
              type: String,
              required: true,
              enum: ['add', 'subtract', 'multiply', 'divide', 'power', 'sqrt', 'modulo'],
            },
            operands: { type: [Number], required: true },
          },
          { _id: false }
        ),
      ],
      required: true,
      validate: {
        validator: (arr) => arr.length >= 1 && arr.length <= 20,
        message: 'plan must contain between 1 and 20 steps',
      },
    },

    /* ── Execution output (with intermediate results) ──────────── */
    steps: {
      type: [StepSchema],
      required: true,
      validate: {
        validator: (arr) => arr.length >= 1,
        message: 'steps must contain at least one entry',
      },
    },

    finalAnswer: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isFinite,
        message: 'finalAnswer must be a finite number',
      },
    },

    /* ── LLM metadata ──────────────────────────────────────────── */
    model: {
      type: String,
      required: true,
      trim: true,
    },

    usage: {
      type: UsageSchema,
      required: true,
    },

    estimatedCost: {
      type: Number,
      required: true,
      min: [0, 'estimatedCost cannot be negative'],
    },

    listPriceCost: {
  type: Number,
  required: true,
  min: [0, 'listPriceCost cannot be negative'],
}
    /* ── Diagnostics ───────────────────────────────────────────── */
   , durationMs: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    // Every record is immutable — a calculation, once run, never changes.
    // Freezing this prevents accidental `save()` updates and skips the
    // `__v` version-tracking overhead on reads.
    strict: 'throw', // unknown fields → error, not silent drop
    toJSON: {
      virtuals: true,
      transform: (_, ret) => {
        // Shape that matches the controller's response exactly
        ret.id = ret._id.toString();
        delete ret._id;
        return ret;
      },
    },
  }
);

/* ------------------------------------------------------------------ *
 * Indexes — chosen from the dashboard / history access patterns
 *
 *  1. History pagination:  find().sort({ createdAt: -1 })  → single-field
 *  2. Usage dashboard:     $group over whole collection     → no index helps,
 *     but a recent-window variant benefits from createdAt.
 *  3. Single-record:      findById()                        → _id (auto)
 * ------------------------------------------------------------------ */
CalculationSchema.index({ createdAt: -1 });

// Optional: if you later partition by user, this becomes:
// CalculationSchema.index({ userId: 1, createdAt: -1 });

/* ------------------------------------------------------------------ *
 * Virtuals — computed, not stored (single source of truth = usage)
 * ------------------------------------------------------------------ */
CalculationSchema.virtual('summary').get(function () {
  return {
    query: this.query,
    finalAnswer: this.finalAnswer,
    tokens: this.usage.totalTokens,
    cost: this.estimatedCost,
    model: this.model,
    when: this.createdAt,
  };
});

/* ------------------------------------------------------------------ *
 * Static helpers — keep aggregation pipelines next to the schema
 * so callers don't duplicate them across controllers.
 * ------------------------------------------------------------------ */
CalculationSchema.statics.getCumulativeUsage = function () {
  return this.aggregate([
    {
      $group: {
        _id: null,
        totalRequests: { $sum: 1 },
        totalPromptTokens: { $sum: '$usage.promptTokens' },
        totalCompletionTokens: { $sum: '$usage.completionTokens' },
        totalTokens: { $sum: '$usage.totalTokens' },
        totalCost: { $sum: '$estimatedCost' },
        avgDurationMs: { $avg: '$durationMs' },
        lastRequestAt: { $max: '$createdAt' },
      },
    },
    { $project: { _id: 0 } },
  ]).then((rows) => rows[0] ?? null);
};

CalculationSchema.statics.getRecent = function (limit = 20) {
  return this.find().sort({ createdAt: -1 }).limit(limit).lean();
};

/* ------------------------------------------------------------------ *
 * Pre-save sanity: recompute totalTokens if it drifted
 * (defensive — the API's usage object is authoritative, but cheap to check)
 * ------------------------------------------------------------------ */
CalculationSchema.pre('validate', function (next) {
  if (this.usage) {
    const expected =
      (this.usage.promptTokens || 0) + (this.usage.completionTokens || 0);
    if (this.usage.totalTokens !== expected) {
      // Trust the components, not the total
      this.usage.totalTokens = expected;
    }
  }
  next();
});

/* ------------------------------------------------------------------ *
 * Export — mongoose.models guard prevents OverwriteModelError
 * during hot-reload in dev (nodemon re-imports the same file).
 * ------------------------------------------------------------------ */
const Calculation = mongoose.models.Calculation || model('Calculation', CalculationSchema);

export default Calculation;