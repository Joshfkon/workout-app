/**
 * Problems a persona lists in its review become friction items next to the
 * ones it flagged live, so clustering counts both. Pure, except
 * extractProblems (one model call, used to back-fill runs recorded before
 * reviews had a `problems` field).
 */
import { toolUses } from './llm.mjs';
import { PROBLEMS_SCHEMA } from './agent.mjs';

/** Screenshot for a review problem: the last step taken on that screen. */
function shotFor(log, screen) {
  const steps = (log ?? []).filter((l) => l.screen === screen);
  const step = steps.length ? steps[steps.length - 1].step : null;
  return step == null ? undefined : `step-${String(step).padStart(2, '0')}.jpg`;
}

/**
 * @param rec  a session record: { taskId, personaId, journeyId, log, review: { problems } }
 * @returns friction items tagged source 'review'
 */
export function problemsToFrictions(rec) {
  const problems = rec.review?.problems ?? [];
  const screens = new Set((rec.log ?? []).map((l) => l.screen));
  const fallback = rec.finalUrl ?? (rec.log?.length ? rec.log[rec.log.length - 1].screen : '/');
  return problems
    .filter((p) => p && typeof p.text === 'string' && p.text.trim())
    .map((p) => {
      // Trust the persona's screen only if it actually visited it.
      const screen = screens.has(p.screen) ? p.screen : fallback;
      const screenshot = shotFor(rec.log, screen);
      return {
        screen,
        text: p.text.trim(),
        severity: ['minor', 'major', 'blocker'].includes(p.severity) ? p.severity : 'minor',
        source: 'review',
        taskId: rec.taskId,
        personaId: rec.personaId,
        journeyId: rec.journeyId,
        ...(screenshot ? { screenshot } : {}),
      };
    });
}

const EXTRACT_TOOL = {
  name: 'submit_problems',
  description: 'Problems listed per review, keyed by review id.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['reviews'],
    properties: {
      reviews: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'problems'],
          properties: { id: { type: 'string' }, problems: PROBLEMS_SCHEMA },
        },
      },
    },
  },
};

/**
 * Back-fill: split each review's free text into separate problems (one model
 * call for the whole run). Uses only what the review and step log say; the
 * model is told not to add problems.
 * @returns Map taskId → problems[]
 */
export async function extractProblems({ llm, results }) {
  const withReview = results.filter((r) => r.review);
  const prompt = [
    'Below are participant reviews from a usability study, each with the screens the participant visited.',
    'For each review, list every separate problem the participant mentions (small annoyances included), one per item, in their own terms.',
    'Use only what the review says. Do not add problems, merge different problems, or include praise. screen must be one of that review\'s visited screens, or empty.',
    ...withReview.map((r) =>
      [
        `--- id: ${r.taskId}`,
        `visited screens: ${[...new Set((r.log ?? r.actions ?? []).map((l) => l.screen))].join(', ') || '(unknown)'}`,
        `confusing/annoying: ${r.review.confusing}`,
        `could be simpler: ${r.review.simpler}`,
      ].join('\n'),
    ),
    'Answer with submit_problems.',
  ].join('\n\n');
  const msg = await llm.call({ tools: [EXTRACT_TOOL], messages: [{ role: 'user', content: prompt }] });
  const use = toolUses(msg).find((u) => u.name === 'submit_problems');
  if (!use) throw new Error('no problems extracted');
  return new Map(use.input.reviews.map((r) => [r.id, r.problems]));
}
