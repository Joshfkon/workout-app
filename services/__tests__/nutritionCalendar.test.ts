/**
 * Nutrition calendar engine tests.
 *
 * The load-bearing case: the SAME calorie total on the SAME target must grade
 * differently on either side of a mid-month cut→bulk phase switch, because
 * the band logic is direction-aware per THAT DAY's phase.
 */

import {
  buildCalendarMonth,
  dayRing,
  formatNetKcal,
  phaseDisplayLabel,
  resolvePhaseOnDate,
  weekTone,
  type PhaseHistoryEntry,
} from '@/services/nutritionCalendar';

const TARGET = 2500;

/** July 2026: 31 days, starts on a Wednesday. Today pinned to the 20th. */
const MONTH = '2026-07';
const TODAY = '2026-07-20';
const NOW = new Date('2026-07-20T12:00:00');

/** Cut through Jul 14, bulk from Jul 15. */
const CUT_TO_BULK: PhaseHistoryEntry[] = [
  { phase: 'cut', startedOn: '2026-05-01' },
  { phase: 'bulk', startedOn: '2026-07-15' },
];

describe('resolvePhaseOnDate', () => {
  it('resolves the latest phase that had started by the date', () => {
    expect(resolvePhaseOnDate(CUT_TO_BULK, '2026-07-14', 'maintenance')).toBe('cut');
    expect(resolvePhaseOnDate(CUT_TO_BULK, '2026-07-15', 'maintenance')).toBe('bulk');
    expect(resolvePhaseOnDate(CUT_TO_BULK, '2026-08-01', 'maintenance')).toBe('bulk');
  });

  it('falls back to the current phase before recorded history / with no history', () => {
    expect(resolvePhaseOnDate(CUT_TO_BULK, '2026-04-30', 'maintenance')).toBe('maintenance');
    expect(resolvePhaseOnDate([], '2026-07-01', 'bulk')).toBe('bulk');
  });

  it('is order-independent', () => {
    const shuffled = [CUT_TO_BULK[1], CUT_TO_BULK[0]];
    expect(resolvePhaseOnDate(shuffled, '2026-07-10', 'maintenance')).toBe('cut');
  });
});

describe('day ring across a cut→bulk boundary month', () => {
  it('flips the SAME under-target day from green (cut) to red (bulk)', () => {
    // 2,200 / 2,500 = 88% — a 12% shortfall.
    const dayCalories = {
      '2026-07-10': 2200, // cut: undereating is harmless → green
      '2026-07-16': 2200, // bulk: 12% under is beyond the ±10% yellow band → red
    };
    const model = buildCalendarMonth({
      monthKey: MONTH,
      dayCalories,
      calorieTarget: TARGET,
      phaseHistory: CUT_TO_BULK,
      currentPhase: 'bulk',
      todayKey: TODAY,
      now: NOW,
    });

    const cells = model.weeks
      .flatMap((w) => w.days)
      .filter((d): d is NonNullable<typeof d> => d !== null);
    const cutDay = cells.find((d) => d.dateKey === '2026-07-10')!;
    const bulkDay = cells.find((d) => d.dateKey === '2026-07-16')!;

    expect(cutDay.phase).toBe('cut');
    expect(cutDay.ring.tone).toBe('green');
    expect(bulkDay.phase).toBe('bulk');
    expect(bulkDay.ring.tone).toBe('red');
    // Identical intake, identical target — identical fill.
    expect(cutDay.ring.fill).toBeCloseTo(bulkDay.ring.fill);
    expect(model.spansPhases).toBe(true);
  });

  it('flips the SAME over-target day from red (cut) to green (bulk)', () => {
    // 2,800 / 2,500 = 112% — a 12% overage.
    const ringOnCut = dayRing({
      dateKey: '2026-07-10',
      calories: 2800,
      calorieTarget: TARGET,
      phase: 'cut',
      todayKey: TODAY,
      now: NOW,
    });
    const ringOnBulk = dayRing({
      dateKey: '2026-07-16',
      calories: 2800,
      calorieTarget: TARGET,
      phase: 'bulk',
      todayKey: TODAY,
      now: NOW,
    });
    expect(ringOnCut.tone).toBe('red');
    expect(ringOnBulk.tone).toBe('green');
  });

  it('grades a near-miss yellow in the harmful direction only', () => {
    // 2,300 / 2,500 = 92% — an 8% shortfall: yellow on a bulk, green on a cut.
    expect(
      dayRing({
        dateKey: '2026-07-16',
        calories: 2300,
        calorieTarget: TARGET,
        phase: 'bulk',
        todayKey: TODAY,
        now: NOW,
      }).tone
    ).toBe('yellow');
    expect(
      dayRing({
        dateKey: '2026-07-10',
        calories: 2300,
        calorieTarget: TARGET,
        phase: 'cut',
        todayKey: TODAY,
        now: NOW,
      }).tone
    ).toBe('green');
  });
});

describe('day ring states', () => {
  it('unlogged and future days render empty rings', () => {
    expect(
      dayRing({
        dateKey: '2026-07-05',
        calories: undefined,
        calorieTarget: TARGET,
        phase: 'cut',
        todayKey: TODAY,
        now: NOW,
      }).empty
    ).toBe(true);
    expect(
      dayRing({
        dateKey: '2026-07-25',
        calories: 2000,
        calorieTarget: TARGET,
        phase: 'cut',
        todayKey: TODAY,
        now: NOW,
      }).empty
    ).toBe(true);
  });

  it("today mid-window uses the pacing grade, not the full-day band", () => {
    // Noon = 5/14 of the 07:00–21:00 window ≈ 36%. 900/2500 = 36% consumed →
    // squarely on pace. The full-day band would call 36% a red miss.
    const ring = dayRing({
      dateKey: TODAY,
      calories: 900,
      calorieTarget: TARGET,
      phase: 'bulk',
      todayKey: TODAY,
      now: NOW,
    });
    expect(ring.partial).toBe(true);
    expect(ring.tone).toBe('green');
    expect(ring.fill).toBeCloseTo(900 / 2500);
  });

  it('today far behind pace warns (bulk fears under)', () => {
    const ring = dayRing({
      dateKey: TODAY,
      calories: 100,
      calorieTarget: TARGET,
      phase: 'bulk',
      todayKey: TODAY,
      now: NOW,
    });
    expect(ring.partial).toBe(true);
    expect(['yellow', 'red']).toContain(ring.tone);
  });

  it('today ≥95% of target grades as a finished day', () => {
    const ring = dayRing({
      dateKey: TODAY,
      calories: 2450,
      calorieTarget: TARGET,
      phase: 'bulk',
      todayKey: TODAY,
      now: NOW,
    });
    expect(ring.partial).toBe(false);
    expect(ring.tone).toBe('green');
  });

  it('caps fill at 1 and grades no-target days neutral', () => {
    expect(
      dayRing({
        dateKey: '2026-07-10',
        calories: 4000,
        calorieTarget: TARGET,
        phase: 'bulk',
        todayKey: TODAY,
        now: NOW,
      }).fill
    ).toBe(1);
    const noTarget = dayRing({
      dateKey: '2026-07-10',
      calories: 2000,
      calorieTarget: null,
      phase: 'bulk',
      todayKey: TODAY,
      now: NOW,
    });
    expect(noTarget.tone).toBe('neutral');
    expect(noTarget.empty).toBe(false);
  });
});

describe('week column framing', () => {
  it('reads a deficit week RED on a bulk, not green "under"', () => {
    expect(weekTone(-3590, TARGET * 7, 'bulk')).toBe('red');
    expect(formatNetKcal(-3590)).toBe('−3,590');
  });

  it('reads the SAME deficit week green on a cut', () => {
    expect(weekTone(-3590, TARGET * 7, 'cut')).toBe('green');
  });

  it('reads a surplus week red on a cut, green on a bulk', () => {
    expect(weekTone(3590, TARGET * 7, 'cut')).toBe('red');
    expect(weekTone(3590, TARGET * 7, 'bulk')).toBe('green');
  });

  it('grades near-target weeks green regardless of phase', () => {
    expect(weekTone(-500, TARGET * 7, 'bulk')).toBe('green'); // ~2.9% under
    expect(weekTone(500, TARGET * 7, 'cut')).toBe('green');
  });

  it('computes net over logged full days and labels phases on a boundary month', () => {
    // Week of Sun Jul 12 – Sat Jul 18 spans the Jul 15 cut→bulk switch.
    const dayCalories = {
      '2026-07-13': 2000, // cut side: -500
      '2026-07-16': 2100, // bulk side: -400
    };
    const model = buildCalendarMonth({
      monthKey: MONTH,
      dayCalories,
      calorieTarget: TARGET,
      phaseHistory: CUT_TO_BULK,
      currentPhase: 'bulk',
      todayKey: TODAY,
      now: NOW,
    });
    const boundaryWeek = model.weeks.find((w) =>
      w.days.some((d) => d?.dateKey === '2026-07-15')
    )!;
    expect(boundaryWeek.summary.netKcal).toBe(-900);
    expect(boundaryWeek.summary.loggedDays).toBe(2);
    // -900 / 5000 = 18% under, dominant phase resolves bulk (tie → later) → red.
    expect(boundaryWeek.summary.phase).toBe('bulk');
    expect(boundaryWeek.summary.tone).toBe('red');
    // Month spans phases → weeks carry a phase label.
    expect(boundaryWeek.summary.phaseLabel).toBe('Bulk');

    // A week with nothing logged is neutral with no net.
    const emptyWeek = model.weeks.find((w) => w.summary.loggedDays === 0)!;
    expect(emptyWeek.summary.netKcal).toBeNull();
    expect(emptyWeek.summary.tone).toBe('neutral');
  });

  it('omits phase labels when the month is single-phase', () => {
    const model = buildCalendarMonth({
      monthKey: MONTH,
      dayCalories: { '2026-07-10': 2000 },
      calorieTarget: TARGET,
      phaseHistory: [{ phase: 'cut', startedOn: '2026-01-01' }],
      currentPhase: 'cut',
      todayKey: TODAY,
      now: NOW,
    });
    expect(model.spansPhases).toBe(false);
    for (const week of model.weeks) expect(week.summary.phaseLabel).toBeNull();
  });

  it("excludes today's partial ring from the week net", () => {
    const model = buildCalendarMonth({
      monthKey: MONTH,
      dayCalories: { [TODAY]: 900 }, // mid-window today only
      calorieTarget: TARGET,
      phaseHistory: [],
      currentPhase: 'bulk',
      todayKey: TODAY,
      now: NOW,
    });
    const todayWeek = model.weeks.find((w) => w.days.some((d) => d?.dateKey === TODAY))!;
    expect(todayWeek.summary.netKcal).toBeNull();
  });
});

describe('month grid shape', () => {
  it('renders all 31 July days padded into Sun-start weeks', () => {
    const model = buildCalendarMonth({
      monthKey: MONTH,
      dayCalories: {},
      calorieTarget: TARGET,
      phaseHistory: [],
      currentPhase: 'maintenance',
      todayKey: TODAY,
      now: NOW,
    });
    const cells = model.weeks.flatMap((w) => w.days);
    expect(cells.length % 7).toBe(0);
    const days = cells.filter((d) => d !== null);
    expect(days).toHaveLength(31);
    // Jul 1 2026 is a Wednesday → 3 leading pads.
    expect(cells.slice(0, 3)).toEqual([null, null, null]);
    expect(days[0]!.dateKey).toBe('2026-07-01');
    expect(days[30]!.dateKey).toBe('2026-07-31');
  });
});

describe('labels', () => {
  it('formats net kcal with explicit signs', () => {
    expect(formatNetKcal(1240)).toBe('+1,240');
    expect(formatNetKcal(0)).toBe('±0');
  });

  it('maps maintenance to Recomp like the share header', () => {
    expect(phaseDisplayLabel('maintenance')).toBe('Recomp');
    expect(phaseDisplayLabel('cut')).toBe('Cut');
    expect(phaseDisplayLabel('bulk')).toBe('Bulk');
  });
});
