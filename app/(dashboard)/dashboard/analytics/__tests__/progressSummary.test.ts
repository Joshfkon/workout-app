import type { LiftTrendsSummary } from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import { buildProgressSummary, strengthSentence, weightSentence } from '../progressSummary';

const NOW = new Date('2026-11-22T12:00:00');

function trends(over: Partial<LiftTrendsSummary> = {}): LiftTrendsSummary {
  return {
    lifts: [],
    rising: 0,
    flat: 0,
    down: 0,
    rebuilding: 0,
    insufficientData: 0,
    earlyLifts: [],
    stalled: null,
    windowDays: 84,
    ...over,
  };
}

/** One weigh-in every `step` days ending today, changing `perDay` lb a day. */
function weighIns(start: number, perDay: number, days = 28, step = 4) {
  const out = [];
  for (let d = days; d >= 0; d -= step) {
    const date = new Date(NOW);
    date.setDate(date.getDate() - d);
    const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    out.push({ date: ymd, weight: start + perDay * (days - d), unit: 'lb' });
  }
  return out;
}

describe('weightSentence', () => {
  it("reads the weight chart's fitted 30-day change, in the user's unit", () => {
    expect(weightSentence(weighIns(190, -0.1), 'lb', NOW)).toBe('Weight is down 2.8 lb over the last 30 days.');
    expect(weightSentence(weighIns(190, 0.05), 'lb', NOW)).toBe('Weight is up 1.4 lb over the last 30 days.');
  });

  it('converts to kg for a kg user', () => {
    expect(weightSentence(weighIns(190, -0.1), 'kg', NOW)).toBe('Weight is down 1.3 kg over the last 30 days.');
  });

  it('calls a flat line steady', () => {
    expect(weightSentence(weighIns(190, 0), 'lb', NOW)).toBe('Weight is steady over the last 30 days.');
  });

  it('says nothing with fewer than two weigh-ins in the window', () => {
    expect(weightSentence([], 'lb', NOW)).toBeNull();
    expect(weightSentence(weighIns(190, 0).slice(-1), 'lb', NOW)).toBeNull();
    // Old weigh-ins outside the 30 days don't count.
    expect(weightSentence([{ date: '2026-08-01', weight: 190, unit: 'lb' }, { date: '2026-08-10', weight: 188, unit: 'lb' }], 'lb', NOW)).toBeNull();
  });
});

describe('strengthSentence', () => {
  it('counts confident lifts only', () => {
    expect(strengthSentence(trends({ rising: 3 }))).toBe('Over the last 12 weeks, all 3 of your tracked lifts are going up.');
    expect(strengthSentence(trends({ rising: 2, flat: 1 }))).toBe(
      'Over the last 12 weeks, 2 of your 3 tracked lifts are going up and none are slipping.'
    );
    expect(strengthSentence(trends({ flat: 4, rebuilding: 1 }))).toBe(
      'Over the last 12 weeks, your 4 tracked lifts are holding steady.'
    );
    expect(strengthSentence(trends({ rising: 1, flat: 1, down: 1 }))).toBe(
      'Over the last 12 weeks, 1 of your 3 tracked lifts is slipping and 1 is going up.'
    );
    expect(strengthSentence(trends({ flat: 1, down: 2 }))).toBe(
      'Over the last 12 weeks, 2 of your 3 tracked lifts are slipping.'
    );
    expect(strengthSentence(trends({ down: 1 }))).toBe('Over the last 12 weeks, your tracked lift is slipping.');
  });

  it('gives no verdict while every trend is rebuilding', () => {
    expect(strengthSentence(trends({ rebuilding: 2 }))).toMatch(/rebuilding after a recent change, so there's no strength verdict yet/);
  });

  it('says what is missing when lifts are logged but none has a trend yet', () => {
    const s = strengthSentence(
      trends({
        insufficientData: 2,
        earlyLifts: [
          { name: 'Romanian Deadlift', sessions: 1, bestWeightKg: 80, bestReps: 10 },
          { name: 'Barbell Back Squat', sessions: 2, bestWeightKg: 93, bestReps: 10 },
        ],
      })
    );
    expect(s).toBe(
      'Not enough lifting data for a strength trend yet. Log Barbell Back Squat in 1 more workout to see its trend.'
    );
  });

  it('says nothing about strength to someone who has not lifted, or while unknown', () => {
    expect(strengthSentence(trends())).toBeNull();
    expect(strengthSentence(null)).toBeNull();
    expect(strengthSentence(undefined)).toBeNull();
  });
});

describe('buildProgressSummary', () => {
  it('answers weight and strength together for a cutter', () => {
    expect(
      buildProgressSummary({ weighIns: weighIns(190, -0.1), liftTrends: trends({ rising: 1, flat: 2 }), units: 'lb', now: NOW })
    ).toEqual({
      weight: 'Weight is down 2.8 lb over the last 30 days.',
      strength: 'Over the last 12 weeks, 1 of your 3 tracked lifts is going up and none are slipping.',
    });
  });

  it('gives a food-only user the weight line alone', () => {
    expect(buildProgressSummary({ weighIns: weighIns(160, -0.05), liftTrends: trends(), units: 'lb', now: NOW })).toEqual({
      weight: 'Weight is down 1.4 lb over the last 30 days.',
      strength: null,
    });
  });

  it('is null with nothing to say', () => {
    expect(buildProgressSummary({ weighIns: [], liftTrends: trends(), units: 'lb', now: NOW })).toBeNull();
  });
});

describe('early comparison before a trend exists', () => {
  const early = (over: Partial<import('@/app/(dashboard)/dashboard/_lib/liftTrends').EarlyLift>) => ({
    name: 'Squat', sessions: 2, bestWeightKg: 60, bestReps: 8, firstWeightKg: 55, firstReps: 8, latestWeightKg: 60, latestReps: 8, ...over,
  });

  it('counts lifts that beat their first workout (heavier, or same weight for more reps)', () => {
    const { earlyComparison } = jest.requireActual('../progressSummary');
    expect(earlyComparison([
      early({}),
      early({ name: 'Bench', firstWeightKg: 40, latestWeightKg: 40, firstReps: 8, latestReps: 10 }),
      early({ name: 'Row', firstWeightKg: 40, latestWeightKg: 45, firstReps: 10, latestReps: 7 }), // heavier, fewer reps: neither
      early({ name: 'RDL', sessions: 1 }),
    ])).toEqual({ better: 2, compared: 3 });
    expect(earlyComparison([early({ sessions: 1 })])).toBeNull();
  });

  it('puts it in the no-trend strength sentence', () => {
    const { strengthSentence } = jest.requireActual('../progressSummary');
    const s = strengthSentence({ lifts: [], rising: 0, flat: 0, down: 0, rebuilding: 0, insufficientData: 2, windowDays: 84, earlyLifts: [early({}), early({ name: 'Bench', latestWeightKg: 50, firstWeightKg: 50, latestReps: 7, firstReps: 8 })] });
    expect(s).toContain('So far, 1 of your 2 lifts beats their first workout (heavier, or more reps).');
  });
});
