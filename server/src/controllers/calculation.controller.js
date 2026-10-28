// server/src/controllers/calculation.controller.js
import openai, { MODEL_CONFIG } from '../config/openai.js';
import { executePlan } from '../services/math.service.js';
import { calculateCost } from '../services/cost.service.js';
import { AppError } from '../middleware/errorHandler.js';
import Calculation from '../models/Calculation.js';

/* ================================================================== *
 * The tool schema — the model's ONLY allowed output shape.
 * ================================================================== */
const MATH_TOOL = {
  type: 'function',
  function: {
    name: 'calculate_expression',
    description:
      'Execute a sequence of arithmetic operations. Provide one step per operation, in order.',
    parameters: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              operation: {
                type: 'string',
                enum: ['add', 'subtract', 'multiply', 'divide', 'power', 'sqrt', 'modulo'],
              },
              operands: {
                type: 'array',
                items: { type: 'number' },
                minItems: 1,
                maxItems: 2,
              },
            },
            required: ['operation', 'operands'],
            additionalProperties: false,
          },
        },
      },
      required: ['steps'],
      additionalProperties: false,
    },
  },
};

const SYSTEM_PROMPT = [
  'You are a math planner. Convert the user request into a sequence of arithmetic steps using the calculate_expression tool.',
  'Each step references literal numbers only. Do NOT reference prior results by name — the executor threads the previous result forward automatically.',
  'If the user asks something non-mathematical (weather, chit-chat, code), do NOT call the tool; reply in plain text explaining that you only handle calculations.',
].join(' ');

/* ================================================================== *
 * POST /api/calculations
 * Body already validated by validateCalculate middleware.
 * ================================================================== */
export const calculate = async (req, res, next) => {
  const startedAt = Date.now();
  const { query } = req.body;

  try {
    /* ── 1. Ask the LLM for a structured plan ───────────────────── */
    const completion = await openai.chat.completions.create({
      ...MODEL_CONFIG,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: query },
      ],
      tools: [MATH_TOOL],
      tool_choice: 'auto',
    });

    const message = completion.choices?.[0]?.message;
    const usage = completion.usage;

    /* ── 2. Compute cost ONCE for every branch ──────────────────── */
    // calculateCost now returns { estimatedCost, listPriceCost }.
    // Destructure it — do NOT store the whole object in a Number field.
    const { estimatedCost, listPriceCost } = calculateCost(MODEL_CONFIG.model, usage);

    const tokenUsage = {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    };

    /* ── 3. Model refused to call the tool (non-math query) ─────── */
    if (!message?.tool_calls?.length) {
      return res.status(422).json({
        error: 'Could not interpret the request as a calculation.',
        explanation: message?.content ?? 'Model returned no tool call.',
        usage: tokenUsage,
        estimatedCost,
        listPriceCost,
        model: MODEL_CONFIG.model,
      });
    }

    /* ── 4. Parse the tool arguments ────────────────────────────── */
    const toolCall = message.tool_calls[0];
    let plan;
    try {
      plan = JSON.parse(toolCall.function.arguments);
    } catch {
      throw new AppError('LLM returned malformed tool arguments.', 502);
    }

    if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
      throw new AppError('LLM returned an empty calculation plan.', 502);
    }

    /* ── 5. Execute safely — math.service never calls eval() ────── */
    let steps;
    try {
      steps = executePlan(plan.steps);
    } catch (mathErr) {
      return res.status(422).json({
        error: 'Calculation failed',
        detail: mathErr.message,
        plan: plan.steps,
        usage: tokenUsage,
        estimatedCost,
        listPriceCost,
        model: MODEL_CONFIG.model,
      });
    }

    const finalAnswer = steps[steps.length - 1].result;
    const durationMs = Date.now() - startedAt;

    /* ── 6. Persist ─────────────────────────────────────────────── */
    const record = await Calculation.create({
      query,
      plan: plan.steps,
      steps,
      finalAnswer,
      model: MODEL_CONFIG.model,
      usage: tokenUsage,
      estimatedCost,
      listPriceCost,
      durationMs,
    });

    /* ── 7. Respond ─────────────────────────────────────────────── */
    return res.status(201).json(record.toJSON());
  } catch (err) {
    // Known upstream AI errors (429, 401, 404, network) → structured
    if (err.status && err.status >= 400 && err.status < 600) {
      return res.status(err.status).json({
        error: 'AI service error',
        detail: err.message,
      });
    }
    // Everything else (DB down, unexpected bug) → errorHandler
    next(err);
  }
};

/* ================================================================== *
 * GET /api/calculations/history?page=1&limit=20
 * ================================================================== */
export const getHistory = async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Calculation.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-__v')
        .lean(),
      Calculation.countDocuments(),
    ]);

    res.json({
      items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ================================================================== *
 * GET /api/calculations/history/:id
 * ================================================================== */
export const getById = async (req, res, next) => {
  try {
    const record = await Calculation.findById(req.params.id).select('-__v').lean();
    if (!record) throw new AppError('Calculation not found', 404);
    res.json(record);
  } catch (err) {
    next(err);
  }
};

/* ================================================================== *
 * GET /api/calculations/usage
 * ================================================================== */
export const getUsageStats = async (req, res, next) => {
  try {
    const [stats] = await Calculation.aggregate([
      {
        $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          totalPromptTokens: { $sum: '$usage.promptTokens' },
          totalCompletionTokens: { $sum: '$usage.completionTokens' },
          totalTokens: { $sum: '$usage.totalTokens' },
          totalCost: { $sum: '$estimatedCost' },
          totalListCost: { $sum: '$listPriceCost' },
          avgDurationMs: { $avg: '$durationMs' },
          lastRequestAt: { $max: '$createdAt' },
        },
      },
      { $project: { _id: 0 } },
    ]);

    res.json(
      stats ?? {
        totalRequests: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        totalListCost: 0,
        avgDurationMs: 0,
        lastRequestAt: null,
      }
    );
  } catch (err) {
    next(err);
  }
};