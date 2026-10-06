import { composeSetRecommendation, type SetRecommendationInput } from '../setRecommendationLine';

const LB = 0.45359237;
const lb = (kg: number) => `${Math.round(kg / LB)} lb`;

const base = (over: Partial<SetRecommendationInput> = {}): SetRecommendationInput => ({
  scope: 'next_set',
  engine: { weightKg: 90 * LB, reps: 13, effortVsTarget: 'on_target' },
  lastWeightKg: 90 * LB,
  repRange: [12, 15],
  loggedRir: 2,
  targetRir: 2,
  formBrokeDown: false,
  velocity: { confidence: 'ok', loss: 0.44, unclearLine: null },
  thresholds: { higherEffortLossAbove: 0.5, higherEffortMinLoggedRir: 2, lowLossBelow: 0.2 },
  formatWeight: lb,
  ...over,
});

describe('composeSetRecommendation', () => {
  it('phrases a hold with velocity as the supporting reason', () => {
    const r = composeSetRecommendation(base());
    expect(r).toEqual({
      kind: 'recommendation',
      action: 'keep',
      headline: 'Next set: stay at 90 lb, aim for 13–15 reps.',
      why: 'Why: velocity dropped 44% — you were close to your target effort.',
      heldByVelocity: false,
    });
  });

  it('phrases add / reduce with the engine numbers', () => {
    const add = composeSetRecommendation(
      base({ engine: { weightKg: 95 * LB, reps: 12, effortVsTarget: 'easier' }, velocity: null, loggedRir: 4 })
    );
    expect(add).toMatchObject({ action: 'add', headline: 'Next set: add 5 lb (95 lb), aim for 12–15 reps.' });
    expect(add.kind === 'recommendation' && add.why).toBe('Why: you logged 4 RIR against a 2 RIR target.');

    const reduce = composeSetRecommendation(
      base({ engine: { weightKg: 85 * LB, reps: 12, effortVsTarget: 'harder' } })
    );
    expect(reduce).toMatchObject({ action: 'reduce', headline: 'Next set: drop to 85 lb, aim for 12–15 reps.' });
  });

  it('recommends for next session on the last planned set', () => {
    const r = composeSetRecommendation(
      base({ scope: 'next_session', engine: { weightKg: 95 * LB, reps: 12, effortVsTarget: 'easier' }, loggedRir: 3, velocity: { confidence: 'ok', loss: 0.25, unclearLine: null } })
    );
    expect(r).toMatchObject({ action: 'add', headline: 'Next session: try 95 lb × 12–15.' });
  });

  it('velocity tiebreak: logged 2 RIR but 55% loss holds an engine add', () => {
    const r = composeSetRecommendation(
      base({
        engine: { weightKg: 95 * LB, reps: 12, effortVsTarget: 'on_target' },
        velocity: { confidence: 'ok', loss: 0.55, unclearLine: null },
      })
    );
    expect(r).toEqual({
      kind: 'recommendation',
      action: 'keep',
      headline: 'Next set: stay at 90 lb, aim for 12–15 reps.',
      why: 'Why: velocity dropped 55%. Effort looked higher than logged — hold weight.',
      heldByVelocity: true,
    });
  });

  it('velocity never adds load or overrides a hold / reduce', () => {
    const fast = composeSetRecommendation(
      base({ loggedRir: 0, engine: { weightKg: 85 * LB, reps: 12, effortVsTarget: 'harder' }, velocity: { confidence: 'ok', loss: 0.05, unclearLine: null } })
    );
    expect(fast).toMatchObject({ action: 'reduce' });
    expect(fast.kind === 'recommendation' && fast.why).toBe('Why: you logged 0 RIR, though velocity held up (5% loss).');
  });

  it('low confidence: only the unclear line, no recommendation', () => {
    const r = composeSetRecommendation(
      base({ velocity: { confidence: 'low', loss: 0.6, unclearLine: 'Capture unclear: paused 18.7 s mid-capture. Logged reps used.' } })
    );
    expect(r).toEqual({ kind: 'unclear', text: 'Capture unclear: paused 18.7 s mid-capture. Logged reps used.' });
  });

  it('stop on logged form breakdown', () => {
    expect(composeSetRecommendation(base({ formBrokeDown: true }))).toMatchObject({ action: 'stop' });
  });
});
