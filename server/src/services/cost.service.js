// server/src/services/cost.service.js
import { getModelPricing } from '../config/openai.js';

const roundCost = (n) => Math.round(n * 1e8) / 1e8;

const computeFromRates = (promptTokens, completionTokens, rates) =>
  roundCost(
    (promptTokens / 1_000_000) * rates.input +
    (completionTokens / 1_000_000) * rates.output
  );

export const calculateCost = (model, usage) => {
  if (!usage) return { estimatedCost: 0, listPriceCost: 0 };

  const promptTokens = usage.prompt_tokens ?? usage.promptTokens ?? 0;
  const completionTokens = usage.completion_tokens ?? usage.completionTokens ?? 0;

  const pricing = getModelPricing(model);

  const estimatedCost = computeFromRates(promptTokens, completionTokens, pricing);
  const listPriceCost = computeFromRates(
    promptTokens,
    completionTokens,
    pricing.listPrice ?? pricing
  );

  return { estimatedCost, listPriceCost };
};

export const formatCost = (usd) => {
  if (!Number.isFinite(usd) || usd === 0) return '$0.00';
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01)  return `$${usd.toFixed(5)}`;
  if (usd < 1)     return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
};

export const sumCosts = (records) =>
  roundCost(records.reduce((sum, r) => sum + (r.estimatedCost || 0), 0));
