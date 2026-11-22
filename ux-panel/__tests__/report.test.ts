/**
 * Report rendering: the readout must carry the relative-scores caveat,
 * escape model/persona text, rank issues as given, and refuse to compare
 * runs scored with different embeddings or anchors.
 */
import { renderReport } from '../lib/report.mjs';

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'r1',
    label: 'build 7',
    createdAt: '2026-11-21T10:00:00.000Z',
    gitSha: 'abc123',
    model: 'claude-opus-5-5',
    embed: 'local:Xenova/bge-small-en-v1.5',
    anchorsHash: 'h1',
    panel: { personas: 2, journeys: ['log-meal'] },
    journeyLabels: { 'log-meal': 'Log a meal' },
    personas: { maya: { name: 'Maya', age: 24, tagline: 'Beginner' }, dre: { name: 'Dre', age: 31, tagline: 'Cutting' } },
    results: [
      { taskId: 'maya__log-meal', personaId: 'maya', journeyId: 'log-meal', outcome: 'completed', steps: 6, review: { keep_using: 'Probably <b>yes</b>' } },
      { taskId: 'dre__log-meal', personaId: 'dre', journeyId: 'log-meal', outcome: 'gave_up', steps: 9, review: { keep_using: 'No.' }, envErrors: ['column x does not exist'] },
    ],
    completion: { 'log-meal': { completed: 1, gaveUp: 1, ran: 2, errored: 0 } },
    scores: {
      'log-meal': { keep_using: { n: 2, pmf: [0.2, 0.2, 0.2, 0.2, 0.2], mean: 3, sd: 1 } },
      all: { keep_using: { n: 2, pmf: [0.2, 0.2, 0.2, 0.2, 0.2], mean: 3, sd: 1 } },
    },
    frictions: [
      {
        screen: '/dashboard/nutrition',
        label: 'Search results <script>',
        personaCount: 2,
        personas: ['maya', 'dre'],
        journeys: ['log-meal'],
        severity: 'major',
        centroid: [1, 0],
        items: [{ personaId: 'maya', journeyId: 'log-meal', text: 'Where is recent?', taskId: 'maya__log-meal', screenshot: 'step-03.jpg' }],
      },
    ],
    readout: { executive_summary: ['Logging is slow.'], issues: [{ index: 1, title: 'Recents are hidden', recommendation: 'Show recents first.' }], liked_themes: [], simpler_themes: [] },
    cost: { dollars: 1.23 },
    ...overrides,
  };
}

describe('renderReport', () => {
  const html = renderReport(makeRun());

  it('states that scores are relative, not predicted App Store ratings', () => {
    expect(html).toMatch(/relative, not absolute/);
    expect(html).toMatch(/not<\/em> predicted App Store/);
  });

  it('renders the readout prose, issue counts and the screenshot path', () => {
    expect(html).toContain('Recents are hidden');
    expect(html).toContain('Show recents first.');
    expect(html).toContain('<strong>2 of 2</strong> participants');
    expect(html).toContain('src="tasks/maya__log-meal/step-03.jpg"');
    expect(html).toContain('Logging is slow.');
  });

  it('escapes persona and model text', () => {
    expect(html).not.toContain('<b>yes</b>');
    expect(html).toContain('&lt;b&gt;yes&lt;/b&gt;');
    expect(html).not.toContain('<script>');
  });

  it('lists local-environment errors separately from UX issues', () => {
    expect(html).toContain('Test environment problems');
    expect(html).toContain('column x does not exist');
  });

  it('compares against a baseline scored the same way', () => {
    const baseline = makeRun({ runId: 'r0', label: 'build 6', frictions: [] });
    const cmp = renderReport(makeRun(), { baseline });
    expect(cmp).toContain('What changed since the baseline');
    expect(cmp).toContain('New in this build (1)');
  });

  it('refuses to compare scores across embedding models or anchor sets', () => {
    const baseline = makeRun({ embed: 'openai:text-embedding-3-small' });
    const cmp = renderReport(makeRun(), { baseline });
    expect(cmp).not.toContain('What changed since the baseline');
    expect(cmp).toContain('not compared');
  });
});
