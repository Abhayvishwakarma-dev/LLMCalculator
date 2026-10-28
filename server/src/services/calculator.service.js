// server/src/services/calculator.service.js
import openai, { MODEL_CONFIG } from '../config/openai.js';
import { executePlan, MathError } from './math.service.js';
import { calculateCost } from './cost.service.js';

/* ------------------------------------------------------------------ *
 * Tool schema — the LLM's ONLY allowed output shape.
 * `enum` + `additionalProperties: false` mean the model cannot
 * return code, expression strings, or arbitrary keys.
 * ------------------------------------------------------------------ */
const MATH_TOOL = {
  type: 'function',
  function: {
    name: 'calculate_expression',
    description:
      'Execute a sequence of arithmetic operations. Provide one step per operation. ' +
      'If a step should use the previous result, supply ONLY the new operand(s); ' +
      'the executor will fill the missing slot with the previous result.',
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
                minItems: 0,
                maxItems: 2,
              },
            },
            required: ['operation'],
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
  'Rules:',
  '- Each step has one operation and up to two operands.',
  '- If a step operates on the previous result, provide ONLY the new operand(s). Example: "add 2 and 3, then multiply by 3" → [{"operation":"add","operands":[2,3]}, {"operation":"multiply","operands":[3]}].',
  '- Do NOT compute intermediate values yourself; the executor chains them.',
  '- If the user asks something non-mathematical (weather, chit-chat, code), do NOT call the tool; reply in plain text explaining you only handle calculations.',
].join(' ');

export class LLMParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LLMParseError';
    this.code = 'LLM_PARSE_ERROR';
  }
}

/* ------------------------------------------------------------------ *
 * The orchestrator.
 * Returns a plain object the controller can persist and respond with.
 * Never throws for "expected" outcomes (refusal, math error) — those
 * are returned as `{ status: 'refused' | 'math_error', ... }` so the
 * controller can choose the HTTP code. Only truly unexpected errors
 * (network, parse failure) propagate as thrown errors.
 * ------------------------------------------------------------------ */
export const runCalculation = async (query) => {
  const startedAt = Date.now();

  /* 1. Call OpenAI */
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
  const model = MODEL_CONFIG.model;

  /* 2. Normalize usage + cost once, reuse for every branch */
  const tokenUsage = {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
const { estimatedCost, listPriceCost } = calculateCost(model, usage);
  const baseMeta = {
  model,
  usage: tokenUsage,
  estimatedCost,
  listPriceCost,          // ← ADD
  durationMs: Date.now() - startedAt,
};
  /* 3. Non-math query → model refuses to call the tool */
  if (!message?.tool_calls?.length) {
    return {
      status: 'refused',
      explanation: message?.content ?? 'Model returned no tool call.',
      ...baseMeta,
    };
  }

  /* 4. Parse the tool arguments */
  let plan;
  try {
    plan = JSON.parse(message.tool_calls[0].function.arguments);
  } catch {
    throw new LLMParseError('LLM returned malformed tool arguments.');
  }

  /* 5. Execute the plan safely */
  let steps;
  try {
    steps = executePlan(plan.steps);
  } catch (mathErr) {
    if (mathErr instanceof MathError) {
      return {
        status: 'math_error',
        detail: mathErr.message,
        plan: plan.steps,
        ...baseMeta,
      };
    }
    throw mathErr;
  }

  const finalAnswer = steps[steps.length - 1].result;

  return {
    status: 'ok',
    plan: plan.steps,
    steps,
    finalAnswer,
    ...baseMeta,
  };
};