/**
 * End-of-week review: keep-using and pay moved from every task review to one
 * per-persona verdict asked relative to what the persona uses now, with a
 * sharper score beside the standard one, and comparisons only on questions
 * whose anchors match.
 */
import { createHash } from 'node:crypto';
import { QUESTIONS, TASK_QUESTIONS, WEEK_QUESTIONS, LEGACY_ANCHOR_HASHES } from '../anchors.mjs';
import { REVIEW_TOOL, WEEK_REVIEW_TOOL, writeWeekReview } from '../lib/agent.mjs';
import { aggregateScores, comparableQuestions, compareRuns } from '../lib/aggregate.mjs';
import { pmfFromSimilarities, SHARP_TEMPERATURE, expectedValue } from '../lib/ssr.mjs';
import { renderReport } from '../lib/report.mjs';

const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 10);
const FLAT = [0.2, 0.2, 0.2, 0.2, 0.2];
const HIGH = [0, 0, 0.2, 0.4, 0.4];

describe('questions', () => {
  it('asks ease and polish per task, and switch and pay once per week', () => {
    expect(TASK_QUESTIONS.map((q) => q.id)).toEqual(['ease', 'polish']);
    expect(WEEK_QUESTIONS.map((q) => q.id)).toEqual(['switch', 'pay_price']);
    expect(QUESTIONS.every((q) => q.anchorSets.every((set) => set.length === 5))).toBe(true);
  });

  it('keeps the ease and polish anchors unchanged, so old runs stay comparable on them', () => {
    const legacy = LEGACY_ANCHOR_HASHES.b562e018a2;
    for (const q of TASK_QUESTIONS) expect(sha(JSON.stringify(q.anchorSets))).toBe(legacy[q.id as 'ease' | 'polish']);
  });

  it('puts only task questions in the task review and only week questions in the week review', () => {
    const taskProps = Object.keys(REVIEW_TOOL.input_schema.properties);
    expect(taskProps).toEqual(expect.arrayContaining(['ease', 'polish', 'problems']));
    expect(taskProps).not.toContain('keep_using');
    expect(taskProps).not.toContain('pay');
    expect(Object.keys(WEEK_REVIEW_TOOL.input_schema.properties)).toEqual(['switch', 'switch_why', 'pay_price', 'pay_price_why', 'best', 'dealbreaker']);
  });
});

describe('writeWeekReview', () => {
  it('tells the persona what they did this week and what they use now', async () => {
    const calls: Array<{ messages: Array<{ content: string }> }> = [];
    const llm = {
      async call(params: { messages: Array<{ content: string }> }) {
        calls.push(params);
        return { content: [{ type: 'tool_use', name: 'submit_week_review', input: { switch: 'No.', pay_price: 'No.', best: '', dealbreaker: 'x' } }] };
      },
    };
    const persona = { name: 'Sam', age: 27, summary: 's', goals: 'Get big', experience: 'intermediate', previousApps: 'Hevy (daily)', patience: 3, techComfort: 4 };
    const review = await writeWeekReview({
      llm,
      persona,
      sessions: [
        { label: 'Log a meal', outcome: 'completed', summary: 'Logged eggs.', review: { liked: 'Fast search', confusing: 'Tiny buttons' } },
        { label: 'Check progress', outcome: 'gave_up', summary: 'Could not find it.' },
      ],
    });
    expect(review.switch).toBe('No.');
    const text = calls[0].messages[0].content;
    expect(text).toContain('Hevy (daily)');
    expect(text).toContain('- Log a meal: you got it done. Logged eggs. Liked: Fast search Bothered you: Tiny buttons');
    expect(text).toContain('- Check progress: you gave up.');
  });
});

describe('sharper scores', () => {
  it('spread the same answer further from 3 than the standard score', () => {
    const sims = [0.7, 0.72, 0.75, 0.8, 0.82];
    const std = expectedValue(pmfFromSimilarities(sims));
    const sharp = expectedValue(pmfFromSimilarities(sims, { temperature: SHARP_TEMPERATURE }));
    expect(sharp).toBeGreaterThan(std);
  });

  it('are aggregated beside the standard score when present', () => {
    const agg = aggregateScores([{ journeyId: 'week', scores: { switch: FLAT }, scoresSharp: { switch: HIGH } }], ['switch']);
    expect(agg.all.switch.mean).toBeCloseTo(3);
    expect(agg.all.switch.sharp?.mean).toBeCloseTo(4.2);
    expect(aggregateScores([{ journeyId: 'x', scores: { ease: FLAT } }], ['ease']).all.ease.sharp).toBeUndefined();
  });
});

describe('comparableQuestions', () => {
  const embed = 'local:bge';
  const v1 = { embed, anchorsHash: 'b562e018a2' };
  const v2 = { embed, anchorHashes: { ease: '8182770893', polish: '37fb4aba86', switch: 'aaa', pay_price: 'bbb' } };

  it('matches a new run to an old one on the questions whose anchors did not change', () => {
    expect(comparableQuestions(v1, v2, LEGACY_ANCHOR_HASHES)).toEqual(['ease', 'polish']);
  });
  it('compares nothing across embedding models', () => {
    expect(comparableQuestions({ ...v1, embed: 'other' }, v2, LEGACY_ANCHOR_HASHES)).toEqual([]);
  });
  it('compares everything between two runs with the same anchors', () => {
    expect(comparableQuestions(v2, v2)).toEqual(['ease', 'polish', 'switch', 'pay_price']);
  });
});

describe('compareRuns with a question filter', () => {
  it('leaves out questions that are not comparable and compares week scores', () => {
    const a = { scores: { all: { ease: { n: 2, pmf: FLAT, mean: 3 }, keep_using: { n: 2, pmf: FLAT, mean: 3 } } }, weekScores: { all: { switch: { n: 2, pmf: FLAT, mean: 3, sharp: { mean: 3 } } } }, frictions: [] };
    const b = { scores: { all: { ease: { n: 2, pmf: HIGH, mean: 4.2 } } }, weekScores: { all: { switch: { n: 2, pmf: HIGH, mean: 4.2, sharp: { mean: 4.5 } } } }, frictions: [] };
    const cmp = compareRuns(a, b, { questions: ['ease', 'switch'] });
    expect(cmp.scores.all.ease.delta).toBeCloseTo(1.2);
    expect(cmp.scores.all.keep_using).toBeUndefined();
    expect(cmp.weekScores.all.switch.sharpDelta).toBeCloseTo(1.5);
  });

  it('handles a run without week reviews (weekScores: null) on either side', () => {
    const withWeek = { scores: { all: { ease: { n: 1, pmf: FLAT, mean: 3 } } }, weekScores: { all: { switch: { n: 1, pmf: FLAT, mean: 3 } } }, frictions: [] };
    const noWeek = { scores: { all: { ease: { n: 1, pmf: HIGH, mean: 4.2 } } }, weekScores: null, frictions: [] };
    expect(compareRuns(noWeek, withWeek, { questions: ['ease', 'switch'] }).scores.all.ease.delta).toBeCloseTo(-1.2);
    expect(compareRuns(withWeek, noWeek, { questions: ['ease', 'switch'] }).weekScores.all.switch.meanB).toBeNaN();
    expect(compareRuns(noWeek, noWeek).weekScores).toEqual({});
  });
});

describe('report with end-of-week reviews', () => {
  const cell = (mean: number) => ({ n: 2, pmf: FLAT, mean, sd: 0, sharp: { pmf: HIGH, mean: mean + 0.5 } });
  const run = {
    runId: 'r2',
    label: 'week',
    createdAt: '2026-11-22T10:00:00.000Z',
    gitSha: 'abc',
    model: 'm',
    embed: 'local:bge',
    anchorsHash: 'new',
    anchorHashes: { ease: '8182770893', polish: '37fb4aba86', switch: 'aaa', pay_price: 'bbb' },
    sharpTemperature: 0.3,
    panel: { personas: 1, journeys: ['log-meal'] },
    journeyLabels: { 'log-meal': 'Log a meal' },
    personas: { sam: { name: 'Sam', age: 27, tagline: 'Hevy user' } },
    results: [{ taskId: 'sam__log-meal', personaId: 'sam', journeyId: 'log-meal', outcome: 'completed', steps: 5, review: { ease: 'Easy.', polish: 'Clean.' } }],
    completion: { 'log-meal': { completed: 1, gaveUp: 0, ran: 1, errored: 0 } },
    scores: { 'log-meal': { ease: cell(3.6), polish: cell(3.1) }, all: { ease: cell(3.6), polish: cell(3.1) } },
    weekReviews: [{ personaId: 'sam', journeyId: 'week', tasks: ['sam__log-meal'], review: { switch: 'Not over Hevy <i>yet</i>.', pay_price: 'No.', best: 'Food', dealbreaker: 'Slow logging' }, scores: { switch: FLAT, pay_price: FLAT } }],
    weekScores: { week: { switch: cell(2.4), pay_price: cell(2.1) }, all: { switch: cell(2.4), pay_price: cell(2.1) } },
    frictions: [],
    readout: { executive_summary: [], issues: [], liked_themes: [], simpler_themes: [] },
    cost: { dollars: 1 },
  };

  it('shows the week verdicts, quotes and sharper scores, escaped', () => {
    const html = renderReport(run);
    expect(html).toContain('End of week: would they switch?');
    expect(html).toContain('Would switch (mean, 1–5)');
    expect(html).toContain('sharp 2.90');
    expect(html).toContain('Not over Hevy &lt;i&gt;yet&lt;/i&gt;.');
    expect(html).toContain('Slow logging');
    expect(html).not.toContain('<i>yet</i>');
  });

  it('compares only ease and polish against an older run, and says why', () => {
    const old = {
      ...run,
      runId: 'r1',
      anchorsHash: 'b562e018a2',
      anchorHashes: undefined,
      sharpTemperature: undefined,
      weekReviews: undefined,
      weekScores: undefined,
      scores: { all: { keep_using: { n: 2, pmf: FLAT, mean: 2.9 }, ease: { n: 2, pmf: FLAT, mean: 3.4 }, polish: { n: 2, pmf: FLAT, mean: 3.0 }, pay: { n: 2, pmf: FLAT, mean: 3 } } },
    };
    const html = renderReport(run, { baseline: old });
    expect(html).toContain('compared only where both runs asked the same question');
    expect(html).toContain('(Ease of use, Perceived polish)');
    expect(html).toContain('+0.20');
    expect(html).toContain('predates the end-of-week review');
  });

  it('still renders an old run with the retired questions', () => {
    const old = { ...run, weekReviews: undefined, weekScores: undefined, sharpTemperature: undefined, scores: { all: { keep_using: { n: 1, pmf: FLAT, mean: 3 } } } };
    const html = renderReport(old);
    expect(html).toContain('Likelihood to keep using (retired)');
    expect(html).toContain('Keep-using (mean, 1–5)');
    expect(html).not.toContain('End of week');
  });
});
