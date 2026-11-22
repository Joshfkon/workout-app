/**
 * Pre-run cost estimate. Per-call token sizes are rough and should be
 * re-calibrated from a real run's run.json → cost (see README).
 *
 * A step sends: persona system prompt (~0.6k) + goal/log (~0.5–1.5k) +
 * accessibility snapshot (capped at 14k chars ≈ 3.5k tokens) + a 390×844
 * screenshot (≈ 0.45k tokens). Output is one tool call plus low-effort
 * thinking. Sessions stop early when the goal is reached, so the expected
 * case uses ~45 % of the step budget and the high case all of it.
 *
 * Calibrated on the first real run (Sonnet 5.5, 5 personas × core, 24
 * sessions): 255 calls, ~5.4k input and ~195 output tokens per call, 43 % of
 * the step budget used, $2.42 actual. Cache reads aren't modelled, which
 * keeps the estimate a little high.
 */
import { PRICES } from './llm.mjs';
import { stepBudget } from './agent.mjs';

const EXPECTED_FRACTION = 0.45;

export const TOKENS = {
  stepIn: 5000,
  stepOut: 200,
  reviewIn: 2500,
  reviewOut: 450,
  weekIn: 2500,
  weekOut: 400,
  readoutIn: 12000,
  readoutOut: 2500,
  storiesIn: 900,
  storiesOut: 900,
};

const usd = (model, inTok, outTok) => {
  const p = PRICES[model] ?? PRICES['claude-opus-5-5'];
  return (inTok * p.input + outTok * p.output) / 1e6;
};

export function estimateCost({ tasks, personas, model, storiesToGenerate = 0, weekReviews = 0, tokens = TOKENS }) {
  const avgPatience = personas.reduce((s, p) => s + p.patience, 0) / Math.max(1, personas.length);
  const budgetSteps = tasks.reduce((s, j) => s + stepBudget(j, { patience: avgPatience }), 0);
  const fixed =
    tasks.length * usd(model, tokens.reviewIn, tokens.reviewOut) +
    weekReviews * usd(model, tokens.weekIn, tokens.weekOut) +
    usd(model, tokens.readoutIn, tokens.readoutOut) +
    storiesToGenerate * usd(model, tokens.storiesIn, tokens.storiesOut);
  const perStep = usd(model, tokens.stepIn, tokens.stepOut);
  return {
    steps: { expected: Math.round(budgetSteps * EXPECTED_FRACTION), max: budgetSteps },
    expected: fixed + budgetSteps * EXPECTED_FRACTION * perStep,
    high: fixed + budgetSteps * perStep,
    perStep,
  };
}

export function formatEstimate(e, { model, sessions }) {
  return [
    `Cost estimate (${model}, ${sessions} sessions):`,
    `  expected ≈ $${e.expected.toFixed(2)}  (~${e.steps.expected} agent steps)`,
    `  at most  ≈ $${e.high.toFixed(2)}  (every session uses its full step budget: ${e.steps.max} steps)`,
  ].join('\n');
}
