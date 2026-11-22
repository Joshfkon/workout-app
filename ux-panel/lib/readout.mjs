/**
 * The "researcher" pass: one LLM call per run that reads the already-ranked
 * data (issue clusters, quotes, completion, reviews) and writes the prose a
 * UX researcher would put on top of a moderated-study readout — an executive
 * summary, a short title and recommendation per issue, and themes for what
 * participants liked and how tasks could be simpler.
 *
 * It does NOT re-rank or count anything: ordering, participant counts and
 * scores all come from aggregate.mjs, so the numbers in the report are never
 * the model's opinion.
 */
import { toolUses } from './llm.mjs';

const READOUT_TOOL = {
  name: 'submit_readout',
  description: 'Submit the study readout.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['executive_summary', 'issues', 'liked_themes', 'simpler_themes'],
    properties: {
      executive_summary: { type: 'array', items: { type: 'string' }, description: '3–5 bullets, most important first, plain language for a founder.' },
      issues: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['index', 'title', 'recommendation'],
          properties: {
            index: { type: 'integer', description: 'The issue number given in the input.' },
            title: { type: 'string', description: 'Short issue title, e.g. "Unit toggle hidden under Profile".' },
            recommendation: { type: 'string', description: 'One concrete design change.' },
          },
        },
      },
      liked_themes: { type: 'array', items: { type: 'string' }, description: 'Up to 5 things participants liked, each a short theme.' },
      simpler_themes: { type: 'array', items: { type: 'string' }, description: 'Up to 5 ways participants said tasks could be simpler.' },
    },
  },
};

export const MAX_READOUT_ISSUES = 15;

export async function writeReadout({ llm, run }) {
  const issues = run.frictions.slice(0, MAX_READOUT_ISSUES);
  const reviews = run.results.filter((r) => r.review);
  const prompt = [
    `You are a UX researcher writing up a usability study of the HyperTrack workout & nutrition app (${run.panel.personas} participants, ${run.results.length} sessions). Participants were simulated personas; write as you would for a real study, but never invent numbers — use only the counts given.`,
    `TASK COMPLETION:\n${Object.entries(run.completion)
      .map(([j, c]) => `- ${run.journeyLabels[j] ?? j}: ${c.completed}/${c.ran} completed, ${c.gaveUp} gave up`)
      .join('\n')}`,
    `ISSUES (already ranked by how many participants hit them):\n${issues
      .map(
        (c, i) =>
          `${i + 1}. [${c.severity}] ${c.personaCount} participant(s) on ${c.screen} during ${c.journeys.join(', ')}:\n${c.items
            .slice(0, 4)
            .map((it) => `   - "${it.text}"`)
            .join('\n')}`,
      )
      .join('\n')}`,
    `WHAT PARTICIPANTS LIKED:\n${reviews.map((r) => `- ${r.review.liked}`).join('\n')}`,
    `HOW PARTICIPANTS SAID IT COULD BE SIMPLER:\n${reviews.map((r) => `- ${r.review.simpler}`).join('\n')}`,
    'Use submit_readout. Give a title and recommendation for every issue listed, keyed by its number.',
  ].join('\n\n');
  const msg = await llm.call({ tools: [READOUT_TOOL], messages: [{ role: 'user', content: prompt }] });
  const use = toolUses(msg).find((u) => u.name === 'submit_readout');
  if (!use) throw new Error('no readout submitted');
  return use.input;
}

/** Offline readout for --fake-llm / --no-readout: data only, no prose. */
export function plainReadout(run) {
  return {
    executive_summary: [],
    issues: run.frictions.slice(0, MAX_READOUT_ISSUES).map((c, i) => ({ index: i + 1, title: c.label, recommendation: '' })),
    liked_themes: [],
    simpler_themes: [],
  };
}
