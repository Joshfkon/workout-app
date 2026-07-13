import {
  computeWearableRecoveryState,
  composeGlobalRecoveryScale,
  wearableDeloadPoints,
  wearableDeloadEvidence,
  rollingBaseline,
  NEUTRAL_WEARABLE_RECOVERY,
  WEARABLE_RECOVERY,
  type WellnessDay,
} from '@/services/wearableRecovery';

/** N days of steady metrics ending the day before `today`. */
function steadyHistory(
  today: string,
  days: number,
  hrv: number | null,
  rhr: number | null
): WellnessDay[] {
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const history: WellnessDay[] = [];
  for (let i = days; i >= 1; i--) {
    history.push({
      date: new Date(todayMs - i * 86_400_000).toISOString().slice(0, 10),
      hrvSdnnMs: hrv,
      restingHrBpm: rhr,
    });
  }
  return history;
}

const TODAY = '2026-07-13';

describe('computeWearableRecoveryState', () => {
  it('HRV 25% below a 14-day baseline slows recovery ~x1.1 with a quiet reason line', () => {
    const history = [
      ...steadyHistory(TODAY, 14, 60, 60),
      { date: TODAY, hrvSdnnMs: 45, restingHrBpm: 60 }, // 25% below baseline 60
    ];
    const state = computeWearableRecoveryState(history, TODAY);
    expect(state.scale).toBeCloseTo(1.1, 2);
    expect(state.reason).toBe('Recovery slowed — HRV below your baseline.');
    expect(state.hrvDeviationFraction).toBeCloseTo(-0.25, 5);
  });

  it('missing HRV (e.g. Garmin never writes it) stays neutral with no UI mention', () => {
    const history = [
      ...steadyHistory(TODAY, 14, null, 60),
      { date: TODAY, hrvSdnnMs: null, restingHrBpm: 60 },
    ];
    const state = computeWearableRecoveryState(history, TODAY);
    expect(state.scale).toBe(1);
    expect(state.reason).toBeNull();
  });

  it('no history at all is neutral', () => {
    expect(computeWearableRecoveryState([], TODAY)).toEqual(NEUTRAL_WEARABLE_RECOVERY);
  });

  it('fewer baseline days than the minimum keeps the modifier neutral', () => {
    const history = [
      ...steadyHistory(TODAY, WEARABLE_RECOVERY.minBaselineSamples - 1, 60, 60),
      { date: TODAY, hrvSdnnMs: 40, restingHrBpm: 60 },
    ];
    const state = computeWearableRecoveryState(history, TODAY);
    expect(state.scale).toBe(1);
  });

  it('elevated resting HR alone fires the modifier', () => {
    const history = [
      ...steadyHistory(TODAY, 14, 60, 60),
      { date: TODAY, hrvSdnnMs: 60, restingHrBpm: 66 }, // +10% vs baseline 60
    ];
    const state = computeWearableRecoveryState(history, TODAY);
    expect(state.scale).toBeCloseTo(1.075, 3);
    expect(state.reason).toBe('Recovery slowed — resting heart rate above your baseline.');
  });

  it('both signals fired: the stronger one wins (not additive) and both are named', () => {
    const history = [
      ...steadyHistory(TODAY, 14, 60, 60),
      { date: TODAY, hrvSdnnMs: 45, restingHrBpm: 66 },
    ];
    const state = computeWearableRecoveryState(history, TODAY);
    expect(state.scale).toBeCloseTo(1.1, 2); // max(1.1, 1.075), not their product
    expect(state.reason).toBe(
      'Recovery slowed — HRV below your baseline and resting heart rate above your baseline.'
    );
  });

  it('an extreme deviation clamps at the x1.15 bound', () => {
    const history = [
      ...steadyHistory(TODAY, 14, 60, 60),
      { date: TODAY, hrvSdnnMs: 25, restingHrBpm: 90 },
    ];
    expect(computeWearableRecoveryState(history, TODAY).scale).toBe(
      WEARABLE_RECOVERY.scaleMax
    );
  });

  it('clearly elevated HRV with calm RHR speeds recovery slightly, floored at 0.95', () => {
    const history = [
      ...steadyHistory(TODAY, 14, 60, 60),
      { date: TODAY, hrvSdnnMs: 78, restingHrBpm: 60 }, // +30% HRV
    ];
    const state = computeWearableRecoveryState(history, TODAY);
    expect(state.scale).toBe(WEARABLE_RECOVERY.scaleMin);
    expect(state.reason).toBeNull(); // speedup stays silent
  });

  it('a sustained 6-day deviation streak produces a capped deload contribution named in evidence', () => {
    const todayMs = Date.parse(`${TODAY}T00:00:00Z`);
    const history: WellnessDay[] = [];
    // 20 healthy days, then 5 deviating days before today, then a deviating today.
    for (let i = 25; i >= 6; i--) {
      history.push({
        date: new Date(todayMs - i * 86_400_000).toISOString().slice(0, 10),
        hrvSdnnMs: 60,
        restingHrBpm: 60,
      });
    }
    for (let i = 5; i >= 1; i--) {
      history.push({
        date: new Date(todayMs - i * 86_400_000).toISOString().slice(0, 10),
        hrvSdnnMs: 45,
        restingHrBpm: 60,
      });
    }
    history.push({ date: TODAY, hrvSdnnMs: 45, restingHrBpm: 60 });

    const state = computeWearableRecoveryState(history, TODAY);
    expect(state.consecutiveDeviationDays).toBe(6);
    expect(state.deloadSignalPoints).toBe(6); // 5 at onset + 1 extra day
    expect(state.deloadEvidence).toContain('6 straight days');
  });

  it('a 1-day dip does not reach the deload advisor', () => {
    const history = [
      ...steadyHistory(TODAY, 14, 60, 60),
      { date: TODAY, hrvSdnnMs: 45, restingHrBpm: 60 },
    ];
    const state = computeWearableRecoveryState(history, TODAY);
    expect(state.consecutiveDeviationDays).toBe(1);
    expect(state.deloadSignalPoints).toBe(0);
    expect(state.deloadEvidence).toBeNull();
  });
});

describe('deload signal helpers', () => {
  it('ramps from onset and caps', () => {
    expect(wearableDeloadPoints(0)).toBe(0);
    expect(wearableDeloadPoints(4)).toBe(0);
    expect(wearableDeloadPoints(5)).toBe(5);
    expect(wearableDeloadPoints(7)).toBe(7);
    expect(wearableDeloadPoints(30)).toBe(WEARABLE_RECOVERY.deloadMaxPoints);
    expect(wearableDeloadEvidence(4)).toBeNull();
    expect(wearableDeloadEvidence(5)).toContain('5 straight days');
  });
});

describe('composeGlobalRecoveryScale', () => {
  it('composes multiplicatively and clamps the combined global effect at x1.25', () => {
    expect(composeGlobalRecoveryScale(1, 1.1)).toBeCloseTo(1.1, 5);
    expect(composeGlobalRecoveryScale(1.2, 1.15)).toBe(
      WEARABLE_RECOVERY.totalGlobalScaleCap
    );
    // Enhanced-athlete base (<1) composes below the cap untouched.
    expect(composeGlobalRecoveryScale(0.816, 1.15)).toBeCloseTo(0.9384, 3);
  });
});

describe('rollingBaseline', () => {
  it('is a median over the trailing window, excluding today', () => {
    const history = [
      ...steadyHistory(TODAY, 14, 60, 60),
      { date: TODAY, hrvSdnnMs: 10, restingHrBpm: 60 }, // today never biases its own baseline
    ];
    expect(rollingBaseline(history, TODAY, 'hrvSdnnMs')).toBe(60);
  });
});
