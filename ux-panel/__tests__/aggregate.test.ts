/**
 * Panel aggregation: score distributions per journey, friction clustering
 * (persona counts), completion rates and run-vs-run comparison.
 */
import { aggregateScores, clusterFrictions, compareRuns, completionRates, screenKey } from '../lib/aggregate.mjs';

const P_LOW = [0.6, 0.4, 0, 0, 0];
const P_HIGH = [0, 0, 0, 0.4, 0.6];
// Unit vectors standing in for embeddings: A and A2 mean "the same thing".
const A = [1, 0, 0];
const A2 = [0.95, 0.31, 0];
const B = [0, 1, 0];

describe('screenKey', () => {
  it('collapses UUIDs and numeric ids and strips query strings', () => {
    expect(screenKey('http://localhost:3100/dashboard/workout/3f2504e0-4f89-11d3-9a0c-0305e82c3301?x=1')).toBe('/dashboard/workout/:id');
    expect(screenKey('/dashboard/templates/42/')).toBe('/dashboard/templates/:id');
    expect(screenKey('/')).toBe('/');
  });
});

describe('aggregateScores', () => {
  const results = [
    { journeyId: 'log-meal', scores: { ease: P_LOW } },
    { journeyId: 'log-meal', scores: { ease: P_HIGH } },
    { journeyId: 'first-run', scores: { ease: P_HIGH } },
    { journeyId: 'first-run' }, // errored session: no scores
  ];
  const agg = aggregateScores(results, ['ease']);

  it('averages pmfs per journey and pools them under "all"', () => {
    expect(agg['log-meal'].ease.n).toBe(2);
    expect(agg['log-meal'].ease.pmf).toEqual([0.3, 0.2, 0, 0.2, 0.3]);
    expect(agg['log-meal'].ease.mean).toBeCloseTo(3);
    expect(agg.all.ease.n).toBe(3);
  });

  it('reports the spread of per-persona means and skips sessions without scores', () => {
    expect(agg['log-meal'].ease.sd).toBeGreaterThan(2);
    expect(agg['first-run'].ease.n).toBe(1);
    expect(agg['first-run'].ease.sd).toBe(0);
  });
});

describe('clusterFrictions', () => {
  const f = (personaId: string, screen: string, embedding: number[], severity = 'minor', text = `${personaId} text`) => ({
    personaId,
    journeyId: 'log-meal',
    screen,
    text,
    severity,
    embedding,
    taskId: `${personaId}__log-meal`,
    screenshot: 'step-01.jpg',
  });

  it('ranks by distinct personas, not by number of reports', () => {
    const clusters = clusterFrictions([
      f('maya', '/dashboard/nutrition', A),
      f('maya', '/dashboard/nutrition', A2), // same persona again: one participant
      f('dre', '/dashboard/nutrition', B),
      f('sam', '/dashboard/nutrition', B),
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].personaCount).toBe(2); // dre + sam
    expect(clusters[0].personas.sort()).toEqual(['dre', 'sam']);
    expect(clusters[1].personaCount).toBe(1);
    expect(clusters[1].items).toHaveLength(2);
  });

  it('keeps similar complaints on different screens apart', () => {
    const clusters = clusterFrictions([f('maya', '/dashboard/nutrition', A), f('dre', '/dashboard/settings', A)]);
    expect(clusters).toHaveLength(2);
  });

  it('merges similar complaints on the same screen (ids collapsed) and keeps the worst severity', () => {
    const clusters = clusterFrictions([
      f('maya', '/dashboard/workout/11111111-1111-1111-1111-111111111111', A, 'minor'),
      f('dre', '/dashboard/workout/22222222-2222-2222-2222-222222222222', A2, 'blocker'),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].screen).toBe('/dashboard/workout/:id');
    expect(clusters[0].severity).toBe('blocker');
  });

  it('breaks persona-count ties by severity', () => {
    const clusters = clusterFrictions([f('maya', '/a', A, 'minor'), f('dre', '/b', B, 'major')]);
    expect(clusters.map((c) => c.severity)).toEqual(['major', 'minor']);
  });

  it('strips embeddings from the stored items', () => {
    const [c] = clusterFrictions([f('maya', '/a', A)]);
    expect(c.items[0]).not.toHaveProperty('embedding');
    expect(c.centroid).toEqual(A);
  });
});

describe('completionRates', () => {
  it('counts outcomes per journey', () => {
    expect(
      completionRates([
        { journeyId: 'x', outcome: 'completed' },
        { journeyId: 'x', outcome: 'gave_up' },
        { journeyId: 'x', outcome: 'error' },
      ]),
    ).toEqual({ x: { completed: 1, gaveUp: 1, ran: 3, errored: 1 } });
  });
});

describe('compareRuns', () => {
  const cluster = (screen: string, centroid: number[], personaCount: number, label = screen) => ({ screen, centroid, personaCount, label });
  const a = {
    scores: { all: { ease: { n: 4, pmf: [0.2, 0.2, 0.2, 0.2, 0.2], mean: 3 } } },
    frictions: [cluster('/a', A, 3, 'units hidden'), cluster('/b', B, 2, 'fixed one')],
  };
  const b = {
    scores: { all: { ease: { n: 4, pmf: [0, 0, 0.2, 0.4, 0.4], mean: 4.2 } } },
    frictions: [cluster('/a', A2, 1, 'units hidden'), cluster('/c', B, 2, 'new one')],
  };
  const cmp = compareRuns(a, b);

  it('reports the mean shift and KS similarity per question', () => {
    expect(cmp.scores.all.ease.delta).toBeCloseTo(1.2);
    expect(cmp.scores.all.ease.ks).toBeCloseTo(0.6);
  });

  it('classifies frictions as persisting, new or resolved', () => {
    expect(cmp.frictions.persisting).toHaveLength(1);
    expect(cmp.frictions.persisting[0].personaDelta).toBe(-2);
    expect(cmp.frictions.added.map((c) => c.label)).toEqual(['new one']);
    expect(cmp.frictions.resolved.map((c) => c.label)).toEqual(['fixed one']);
  });
});
