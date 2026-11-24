import type { LiftTrendsSummary } from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import {
  buildProgressSummary,
  liftBreakdown,
  strengthSentence,
  volumeSentence,
  weightPaceSentence,
  weightSentence,
} from '../progressSummary';
import type { VolumeRow } from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import type { LiftTrend } from '@/app/(dashboard)/dashboard/_lib/liftTrends';

const NOW = new Date('2026-11-22T12:00:00');

const PLAIN_WEIGHT_METHOD =
  'Weight uses every weigh-in in the range, so one heavy or light day barely moves it.';

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
  it('says there is not enough data, not a verdict, when no lift has a real rate yet', () => {
    expect(strengthSentence(trends({ tooEarly: 2 }))).toBe(
      "Not enough data for a strength trend yet. A trend needs the lift in at least 3 workouts, spread over at least 10 days, so one good or bad day can't fake a change."
    );
  });

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
    // Plain words naming the lift and how many more times — not "not
    // enough data for a strength trend" (UX panel: vague, jargony).
    expect(s).toBe("Log Barbell Back Squat in 1 more workout to see if it's going up.");
    expect(s).not.toMatch(/enough (lifting )?data/);
  });

  it('falls back to the plain rule when no lift is named', () => {
    expect(strengthSentence(trends({ insufficientData: 1 }))).toBe(
      "Do the same lift in 3 separate workouts to see if it's going up."
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
      weightPace: null,
      weightMethod: PLAIN_WEIGHT_METHOD,
      liftMethod: null,
      strengthContext: null,
      strength: 'Over the last 12 weeks, 1 of your 3 tracked lifts is going up and none are slipping.',
      strengthNames: null,
      lifts: [],
      volume: null,
    });
  });

  it('gives a food-only user the weight line alone', () => {
    expect(buildProgressSummary({ weighIns: weighIns(160, -0.05), liftTrends: trends(), units: 'lb', now: NOW })).toEqual({
      weight: 'Weight is down 1.4 lb over the last 30 days.',
      weightPace: null,
      weightMethod: PLAIN_WEIGHT_METHOD,
      liftMethod: null,
      strengthContext: null,
      strength: null,
      strengthNames: null,
      lifts: [],
      volume: null,
    });
  });

  it('is null with nothing to say', () => {
    expect(buildProgressSummary({ weighIns: [], liftTrends: trends(), units: 'lb', now: NOW })).toBeNull();
  });

  it('explains the trends in plain words, with the real thresholds', () => {
    const s = buildProgressSummary({
      weighIns: weighIns(190, -0.1),
      liftTrends: trends({ lifts: [trendedLift()], flat: 1 }),
      units: 'kg',
      now: NOW,
    });
    expect(s?.weightMethod).not.toMatch(/straight line|fitted|trend line/);
    // Two short sentences in all (UX panel r21: the explanation was wordy).
    expect(s?.weightMethod).toBe(PLAIN_WEIGHT_METHOD);
    // liftTrends FLAT_BAND_PCT = 0.15 %/wk -> 0.15 kg a week on 100 kg.
    expect(s?.liftMethod).toBe(
      'A lift is going up or slipping once its estimated max moves more than 0.15 kg a week on a 100 kg lift.'
    );
    for (const sentence of [s?.weightMethod, s?.liftMethod]) {
      expect(sentence!.length).toBeLessThan(110);
    }
  });

  it('says holding strength is a good result on a cut, and only on a cut', () => {
    const input = { weighIns: weighIns(190, -0.1), liftTrends: trends({ lifts: [trendedLift()], flat: 1 }), units: 'lb' as const, now: NOW };
    expect(buildProgressSummary({ ...input, goal: 'cut' })?.strengthContext).toBe(
      "You're on a cut, so lifts holding steady is a good result: you're keeping your strength while you lose fat."
    );
    expect(buildProgressSummary({ ...input, goal: 'bulk' })?.strengthContext).toBeNull();
    expect(buildProgressSummary({ ...input, goal: null })?.strengthContext).toBeNull();
    // No verdict yet → nothing to put in context.
    expect(
      buildProgressSummary({ ...input, liftTrends: trends({ insufficientData: 1 }), goal: 'cut' })?.strengthContext
    ).toBeNull();
  });
});

function trendedLift(): LiftTrend {
  return {
    exerciseId: 'bench',
    seriesKey: 'bench',
    name: 'Bench Press',
    locationId: null,
    locationLabel: null,
    direction: 'flat',
    weeklyChangePct: 0.1,
    currentE1RMKg: 100,
    sessionCount: 4,
    history: [
      { date: '2026-09-01', e1rmKg: 99, topSetWeightKg: 80, topSetReps: 8 },
      { date: '2026-11-20', e1rmKg: 100, topSetWeightKg: 80, topSetReps: 8 },
    ],
    lowConfidence: false,
    calibrationReason: null,
    excludedDates: [],
    discontinuityDate: null,
    plateau: null,
  };
}

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

describe('liftBreakdown (the "See each lift" list)', () => {
  const point = (date: string, weightKg: number, reps: number) => ({
    date,
    e1rmKg: weightKg * (1 + reps / 30),
    topSetWeightKg: weightKg,
    topSetReps: reps,
  });
  const lift = (over: Partial<LiftTrend>): LiftTrend =>
    ({
      exerciseId: 'bench',
      seriesKey: 'bench',
      name: 'Bench Press',
      locationId: null,
      locationLabel: null,
      direction: 'rising',
      weeklyChangePct: 1,
      currentE1RMKg: 100,
      sessionCount: 4,
      history: [point('2026-09-01', 80, 8), point('2026-10-01', 82.5, 8), point('2026-11-20', 85, 8)],
      lowConfidence: false,
      calibrationReason: null,
      excludedDates: [],
      discontinuityDate: null,
      plateau: null,
      ...over,
    }) as LiftTrend;

  it('names each lift with its first and latest best set (real weight × reps) and direction', () => {
    const rows = liftBreakdown(
      trends({
        lifts: [
          lift({}),
          lift({ seriesKey: 'squat', name: 'Squat', direction: 'down', history: [point('2026-09-01', 100, 5), point('2026-11-20', 100, 3)] }),
          lift({ seriesKey: 'row', name: 'Row', lowConfidence: true }),
        ],
        rising: 1,
        down: 1,
        rebuilding: 1,
      }),
      'kg'
    );
    expect(rows.map((r) => [r.name, r.then, r.now, r.direction])).toEqual([
      ['Bench Press', '80 kg × 8', '85 kg × 8', 'Going up'],
      ['Squat', '100 kg × 5', '100 kg × 3', 'Slipping'],
      ['Row', '80 kg × 8', '85 kg × 8', 'Rebuilding'],
    ]);
  });

  it('adds lifts without a trend yet, first vs latest, never calling one a trend', () => {
    const rows = liftBreakdown(
      trends({
        earlyLifts: [
          { name: 'Curl', sessions: 2, bestWeightKg: 15, bestReps: 10, firstWeightKg: 12.5, firstReps: 10, latestWeightKg: 15, latestReps: 10 },
          { name: 'Dip', sessions: 2, bestWeightKg: 10, bestReps: 8, firstWeightKg: 10, firstReps: 8, latestWeightKg: 10, latestReps: 8 },
          { name: 'Fly', sessions: 1, bestWeightKg: 10, bestReps: 8, firstWeightKg: 10, firstReps: 8, latestWeightKg: 10, latestReps: 8 },
        ],
      }),
      'kg'
    );
    expect(rows.map((r) => [r.name, r.then, r.now, r.direction])).toEqual([
      ['Curl', '12.5 kg × 10', '15 kg × 10', 'Up so far'],
      ['Dip', '10 kg × 8', '10 kg × 8', 'Too early to tell'],
    ]);
  });

  it('is empty without a summary', () => {
    expect(liftBreakdown(null, 'lb')).toEqual([]);
  });
});

describe('strengthNames (panel r19: name the lifts, not just a count)', () => {
  const t = (name: string, direction: LiftTrend['direction'], over: Partial<LiftTrend> = {}) =>
    ({ name, direction, lowConfidence: false, locationLabel: null, seriesKey: name, history: [], ...over }) as unknown as LiftTrend;

  it('names the rising and slipping lifts next to the counts', () => {
    const lifts = [
      t('Bench Press', 'rising'),
      t('Barbell Row', 'rising'),
      t('Hack Squat', 'rising'),
      t('RDL', 'rising'),
      t('Pulldown', 'rising'),
      t('Squat', 'down'),
      t('Curl', 'flat'),
      t('Leg Press', 'rising', { lowConfidence: true }),
    ];
    const s = buildProgressSummary({
      weighIns: [],
      liftTrends: trends({ lifts, rising: 5, flat: 1, down: 1, rebuilding: 1 }),
      units: 'lb',
      now: NOW,
    })!;
    // The counts are unchanged; the names are the same confident lifts.
    expect(s.strength).toBe('Over the last 12 weeks, 1 of your 7 tracked lifts is slipping and 5 are going up.');
    expect(s.strengthNames).toBe('Rising: Bench Press, Barbell Row, Hack Squat (+2 more). Slipping: Squat.');
  });

  it('says nothing extra when every lift is flat', () => {
    const s = buildProgressSummary({
      weighIns: [],
      liftTrends: trends({ lifts: [t('Curl', 'flat'), t('Squat', 'flat')], flat: 2 }),
      units: 'lb',
      now: NOW,
    })!;
    expect(s.strengthNames).toBeNull();
  });
});

describe('one shared range', () => {
  it('reads weight over the page range, the same words strength uses', () => {
    const s = buildProgressSummary({
      weighIns: weighIns(190, -0.1, 80, 4),
      liftTrends: trends({ rising: 2, flat: 1, windowDays: 84 }),
      units: 'lb',
      now: NOW,
      windowDays: 84,
    });
    expect(s?.weight).toMatch(/over the last 12 weeks\.$/);
    expect(s?.strength).toMatch(/^Over the last 12 weeks,/);
  });

  it('a 4-week range only counts the last 4 weeks of weigh-ins', () => {
    // Down 0.1 lb/day for 80 days: the 4-week window sees under 3 lb, not ~8 lb.
    expect(weightSentence(weighIns(190, -0.1, 80, 4), 'lb', NOW, 28)).toMatch(/^Weight is down [23]\.\d lb over the last 4 weeks\.$/);
    expect(strengthSentence(trends({ rising: 1, windowDays: 28 }))).toBe('Over the last 4 weeks, your tracked lift is going up.');
    expect(strengthSentence(trends({ rising: 1, windowDays: 365 }))).toBe('Over the last year, your tracked lift is going up.');
  });
});

function row(over: Partial<VolumeRow>): VolumeRow {
  return {
    key: 'chest',
    displayName: 'Chest',
    sets: 0,
    band: { mev: 8, mrv: 22 },
    zone: 'below_mev',
    belowMev: true,
    warnable: true,
    isChild: false,
    ...over,
  } as VolumeRow;
}

describe('volumeSentence', () => {
  it('counts muscles in range, under MEV and over MRV in one plain line', () => {
    expect(
      volumeSentence([
        row({ key: 'chest', sets: 12, zone: 'in_zone', belowMev: false }),
        row({ key: 'back', sets: 14, zone: 'in_zone', belowMev: false }),
        row({ key: 'quads', sets: 4, zone: 'below_mev' }),
        row({ key: 'biceps', sets: 26, zone: 'over_mrv', belowMev: false }),
        row({ key: 'rear', sets: 3, zone: 'in_zone', isChild: true }),
      ])
    ).toBe('Sets per muscle, last 7 days: 2 muscles in range, 1 under the minimum (MEV), 1 over the max (MRV).');
  });

  it('says nothing for a week of zeros, or without rows', () => {
    expect(volumeSentence([row({}), row({ key: 'back' })])).toBeNull();
    expect(volumeSentence(null)).toBeNull();
  });

  it('rides on the summary even before any weight or lift trend exists', () => {
    const s = buildProgressSummary({
      weighIns: [],
      liftTrends: trends(),
      units: 'lb',
      now: NOW,
      volumeRows: [row({ sets: 10, zone: 'in_zone', belowMev: false })],
    });
    expect(s?.volume).toBe('Sets per muscle, last 7 days: 1 muscle in range.');
  });
});

describe('weekly sets window context (UX panel r22: all under MEV after 2 workouts)', () => {
  const rows = [row({ key: 'chest', sets: 6 }), row({ key: 'back', sets: 6 })];
  it('says how many workouts the 7 days hold, and what the plan has', () => {
    expect(volumeSentence(rows, 2, 4)).toBe(
      'Sets per muscle, last 7 days (2 workouts; your plan has 4 a week): 0 muscles in range, 2 under the minimum (MEV).'
    );
    expect(volumeSentence(rows, 1, null)).toBe(
      'Sets per muscle, last 7 days (1 workout): 0 muscles in range, 2 under the minimum (MEV).'
    );
  });
});

describe('weightPaceSentence', () => {
  it('reads the same fitted line against the target rate', () => {
    // -0.1 lb/day = -0.7 lb/week vs a -1.0 target: slower.
    expect(weightPaceSentence(weighIns(190, -0.1), 'lb', NOW, 30, -1)).toBe(
      "That's −0.7 lb a week against your target of −1.0 lb a week: slower than your target."
    );
    expect(weightPaceSentence(weighIns(190, -0.14), 'lb', NOW, 30, -1)).toMatch(/on pace\.$/);
    expect(weightPaceSentence(weighIns(190, -0.3), 'lb', NOW, 30, -1)).toMatch(/faster than your target\.$/);
    expect(weightPaceSentence(weighIns(190, 0.05), 'lb', NOW, 30, -1)).toMatch(/slower than your target\.$/);
  });

  it('says nothing without a target (maintenance) or a trend', () => {
    expect(weightPaceSentence(weighIns(190, -0.1), 'lb', NOW, 30, null)).toBeNull();
    expect(weightPaceSentence([], 'lb', NOW, 30, -1)).toBeNull();
  });

  it('rides under the weight line on the summary', () => {
    const s = buildProgressSummary({
      weighIns: weighIns(190, -0.1),
      liftTrends: trends(),
      units: 'lb',
      now: NOW,
      windowDays: 30,
      targetRatePerWeek: -1,
    });
    expect(s?.weightPace).toMatch(/against your target of −1\.0 lb a week/);
  });
});
