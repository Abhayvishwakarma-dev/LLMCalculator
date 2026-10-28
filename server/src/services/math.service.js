// server/src/services/math.service.js

/**
 * SAFE math executor.
 *
 * Absolutely no `eval`, no `new Function`, no dynamic code.
 * Every operation is a whitelisted JavaScript function.
 * Anything the LLM returns that isn't in OPERATIONS throws.
 *
 * Chaining semantics
 * ------------------
 * If a step omits an operand, the previous step's result fills it:
 *   { op: "add",      operands: [2, 3] }   →   5
 *   { op: "multiply", operands: [3]    }   →  15   (previous 5 × 3)
 *
 * This lets the LLM write "then multiply by 3" without needing to
 * compute intermediate values itself.
 */

export class MathError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MathError';
    this.code = 'MATH_ERROR';
  }
}

/* ------------------------------------------------------------------ *
 * Whitelisted operations.
 * Each entry declares arity (how many operands it consumes) and the
 * actual function. Adding a new operation = adding one entry here AND
 * adding it to the tool schema + model enum in one place.
 * ------------------------------------------------------------------ */
const OPERATIONS = {
  add:      { arity: 2, fn: (a, b) => a + b },
  subtract: { arity: 2, fn: (a, b) => a - b },
  multiply: { arity: 2, fn: (a, b) => a * b },
  divide:   { arity: 2, fn: (a, b) => {
    if (b === 0) throw new MathError('Division by zero');
    return a / b;
  }},
  power:    { arity: 2, fn: (a, b) => {
    const r = Math.pow(a, b);
    if (!Number.isFinite(r)) throw new MathError('Power result is not finite');
    return r;
  }},
  modulo:   { arity: 2, fn: (a, b) => {
    if (b === 0) throw new MathError('Modulo by zero');
    return a % b;
  }},
  sqrt:     { arity: 1, fn: (a) => {
    if (a < 0) throw new MathError('Square root of a negative number');
    return Math.sqrt(a);
  }},
};

/**
 * Resolve the operands for a step, filling missing slots from `previous`.
 * Returns an array of exactly `arity` finite numbers.
 */
const resolveOperands = (step, arity, previous, stepIndex) => {
  const provided = Array.isArray(step.operands) ? step.operands : [];

  if (provided.length > arity) {
    throw new MathError(
      `Step ${stepIndex + 1}: operation "${step.operation}" expects ${arity} operand(s), got ${provided.length}`
    );
  }

  // Fill missing slots from the previous result (in order)
  const resolved = [...provided];
  const missing = arity - resolved.length;
  if (missing > 0) {
    if (previous === null) {
      throw new MathError(
        `Step ${stepIndex + 1}: operation "${step.operation}" needs ${arity} operand(s) but this is the first step`
      );
    }
    // Prepend previous for the missing slots (fills from the front)
    for (let i = 0; i < missing; i++) resolved.unshift(previous);
  }

  // Type + finiteness validation — reject anything the LLM might sneak in
  for (const [i, v] of resolved.entries()) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new MathError(`Step ${stepIndex + 1}: operand ${i + 1} is not a finite number`);
    }
  }

  return resolved;
};

/**
 * Execute a plan (array of steps). Returns a new array enriched with
 * the resolved operands and the result of each step.
 *
 * @param {Array<{ operation: string, operands?: number[] }>} plan
 * @returns {Array<{ operation: string, operands: number[], result: number }>}
 */
export const executePlan = (plan) => {
  if (!Array.isArray(plan) || plan.length === 0) {
    throw new MathError('Plan must be a non-empty array of steps');
  }
  if (plan.length > 20) {
    throw new MathError('Plan cannot exceed 20 steps');
  }

  const executed = [];
  let previous = null;

  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];

    if (!step || typeof step !== 'object') {
      throw new MathError(`Step ${i + 1}: must be an object`);
    }

    const op = OPERATIONS[step.operation];
    if (!op) {
      throw new MathError(
        `Step ${i + 1}: unknown operation "${step.operation}"`
      );
    }

    const operands = resolveOperands(step, op.arity, previous, i);
    const result = op.fn(...operands);

    if (!Number.isFinite(result)) {
      throw new MathError(`Step ${i + 1}: result is not a finite number`);
    }

    executed.push({ operation: step.operation, operands, result });
    previous = result;
  }

  return executed;
};