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
  'You are a math planner and general conversation assistant.',
  'Your task is to convert valid mathematical requests into arithmetic steps using the calculate_expression tool.',

  'RULES FOR MATHEMATICAL INPUT:',
  '- If the user enters a valid mathematical expression or asks a mathematical calculation question, use the calculate_expression tool.',
  '- Each step must contain exactly one operation and up to two operands.',
  '- If a step operates on the previous result, provide ONLY the new operand(s).',
  '- Example: "add 2 and 3, then multiply by 3" → [{"operation":"add","operands":[2,3]},{"operation":"multiply","operands":[3]}].',
  '- Do NOT calculate intermediate values yourself. The executor chains the results.',
  '- Do NOT invent missing operands or operations.',
  '- Do NOT force normal text into a mathematical expression.',

  'RULES FOR OPERATOR-ONLY INPUT:',
  '- If the user enters only an arithmetic operator, such as "+", "-", "*", "/", or "%", do NOT call the tool.',
  '- Reply: "Please enter values to calculate, like 5 + 7."',

  'RULES FOR INCOMPLETE EXPRESSIONS:',
  '- If the user enters a number followed by an operator without the second operand, do NOT call the tool.',
  '- Examples include "5 +", "10 -", "8 *", "20 /", and "15 %".',
  '- Ask the user to enter another value to complete the expression.',
  '- Example: "5 +" → "Please enter another value to complete the calculation, like 5 + 7."',
  '- Example: "10 -" → "Please enter another value to complete the calculation, like 10 - 3."',
  '- Example: "8 *" → "Please enter another value to complete the calculation, like 8 * 2."',
  '- If the user enters an operator followed by a number but no first operand, ask for the missing first value.',
  '- Never call the tool when required operands are missing.',

  'RULES FOR NORMAL TEXT:',
  '- If the user enters greetings, chit-chat, programming questions, weather questions, or other non-mathematical requests, do NOT call the tool.',
  '- Reply naturally in plain text.',
  '- Example: "Hello" → "Hello! How can I help you?"',
  '- Example: "What is JavaScript?" → Explain briefly that you are a calculator assistant and can help with calculations.',
  '- Do not attempt to calculate normal words or sentences.',

  'RULES FOR INVALID OR UNCLEAR INPUT:',
  '- If the input is empty, unclear, or contains invalid mathematical syntax, do NOT call the tool.',
  '- Ask the user to provide a valid mathematical expression.',
  '- Example: "abcxyz" → "Please enter a valid mathematical expression, like 5 + 7."',
  '- Example: "5 + abc" → "Please enter a valid number to complete the calculation."',

  'RULES FOR VALID INPUT:',
  '- Only call the calculate_expression tool when the mathematical request is sufficiently complete to calculate.',
  '- Examples: "5 + 7", "10 - 3", "4 * 6", and "20 / 5".',
  '- If the user provides two numbers separated by a comma, such as "5, 7", ask which operation they want to perform unless the application has an explicitly defined default operation.',
  '- Follow the tool schema exactly.',
  '- Never claim a calculation succeeded until the tool returns a result.'
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