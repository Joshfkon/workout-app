import { composeNextSetCall, loggedEffortVerdict, type NextSetCallInput } from '../setRecommendationLine';

const LB = 0.45359237;
const lb = (kg: number) => `${Math.round(kg / LB)} lb`;

const base = (over: Partial<NextSetCallInput> = {}): NextSetCallInput => ({
  scope: 'next_set',
  engine: { weightKg: 90 * LB, reps: 13, effortVsTarget: 'on_target' },
  lastWeightKg: 90 * LB,
  repRange: [12, 15],
  loggedRir: 2,
  formBrokeDown: false,
  effort: { zone: 'moderate', disagreement: null },
  higherEffortMinLoggedRir: 2,
  formatWeight: lb,
  ...over,
});

describe('composeNextSetCall', () => {
  it('phrases the engine hold / add / drop as an action', () => {
    expect(composeNextSetCall(base()).call).toBe('Next set: hold 90 lb × 13–15.');
    expect(
      composeNextSetCall(base({ engine: { weightKg: 95 * LB, reps: 12, effortVsTarget: 'easier' } })).call
    ).toBe('Next set: add 5 lb (95 lb × 12–15).');
    expect(
      composeNextSetCall(base({ engine: { weightKg: 80 * LB, reps: 12, effortVsTarget: 'harder' } })).call
    ).toBe('Next set: drop 10 lb (80 lb × 12–15).');
  });

  it('a hold with room left says to push closer to failure', () => {
    expect(composeNextSetCall(base({ effort: { zone: 'easy', disagreement: null } })).call).toBe(
      'Next set: hold 90 lb, push closer to failure (13–15 reps).'
    );
    // Without a capture, the engine's own "easier" read does the same.
    expect(composeNextSetCall(base({ effort: null, engine: { weightKg: 90 * LB, reps: 13, effortVsTarget: 'easier' } })).call).toBe(
      'Next set: hold 90 lb, push closer to failure (13–15 reps).'
    );
  });

  it('next session after the last planned set', () => {
    expect(
      composeNextSetCall(base({ scope: 'next_session', engine: { weightKg: 95 * LB, reps: 12, effortVsTarget: 'easier' } })).call
    ).toBe('Next session: add 5 lb (95 lb × 12–15).');
  });

  it('near-failure velocity at logged 2+ RIR holds an engine add; never adds', () => {
    const held = composeNextSetCall(
      base({ engine: { weightKg: 95 * LB, reps: 12, effortVsTarget: 'on_target' }, effort: { zone: 'near-failure', disagreement: 'harder_than_logged' } })
    );
    expect(held).toMatchObject({ action: 'keep', heldByVelocity: true, repsLabel: '12–15' });
    expect(held.call).toBe('Next set: hold 90 lb — your speed says that was harder than the 2 RIR you logged.');
    expect(lb(held.weightKg)).toBe('90 lb');

    const fastButReduce = composeNextSetCall(
      base({ loggedRir: 0, engine: { weightKg: 85 * LB, reps: 12, effortVsTarget: 'harder' }, effort: { zone: 'easy', disagreement: 'more_than_logged' } })
    );
    expect(fastButReduce.action).toBe('reduce');
  });

  it('stop on logged form breakdown', () => {
    expect(composeNextSetCall(base({ formBrokeDown: true })).action).toBe('stop');
  });
});

it('loggedEffortVerdict reads the engine effort grade', () => {
  expect(loggedEffortVerdict('on_target')).toBe('On target');
  expect(loggedEffortVerdict('harder')).toBe('Harder than target');
});
