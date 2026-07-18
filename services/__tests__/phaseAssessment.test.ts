/**
 * assessProgress rule-branch tests.
 *
 * Fixtures build weigh-in series relative to a fixed TODAY so every case is
 * deterministic. Long (90-120 day) phases are used for exact-rate cases so the
 * trend EWMA is in steady state and the measured weekly rate matches the
 * constructed slope to within a few thousandths of a lb/wk.
 */

import { assessProgress, scansInPhase, type WaistEntry } from '@/services/phaseAssessment';
import type { DexaScan, TrainingPhase } from '@/types/schema';
import type { WeighIn } from '@/lib/nutrition/interval-tdee';
import { addLocalDays } from '@/lib/date/localDay';

const TODAY = '2026-07-18';
const day = (offset: number) => addLocalDays(TODAY, offset);

function phase(overrides: Partial<TrainingPhase> = {}): TrainingPhase {
  return {
    id: 'phase-1',
    userId: 'user-1',
    phaseType: 'bulk',
    startDay: day(-120),
    endDay: null,
    targetRateLbsPerWeek: 0.5,
    note: null,
    ...overrides,
  };
}

/** Daily weigh-ins from `startOffset` (days vs TODAY) to `endOffset`, linear at `ratePerWk`. */
function linearWeighIns(
  startOffset: number,
  endOffset: number,
  startLb: number,
  ratePerWk: number
): WeighIn[] {
  const out: WeighIn[] = [];
  for (let d = startOffset; d <= endOffset; d++) {
    out.push({ date: day(d), weightLb: startLb + ((d - startOffset) * ratePerWk) / 7 });
  }
  return out;
}

function mkScan(dayOffset: number, leanMassKg: number, fatMassKg: number): DexaScan {
  return {
    id: `scan-${dayOffset}`,
    userId: 'user-1',
    scanDate: day(dayOffset),
    weightKg: leanMassKg + fatMassKg + 3,
    leanMassKg,
    fatMassKg,
    bodyFatPercent: (fatMassKg / (leanMassKg + fatMassKg + 3)) * 100,
    boneMassKg: 3,
    regionalData: null,
    notes: null,
    createdAt: `${day(dayOffset)}T00:00:00Z`,
  };
}

const noData = { scans: [] as DexaScan[], waist: [] as WaistEntry[] };

describe('assessProgress — gates', () => {
  it('no active phase -> no_phase with a set-one prompt', () => {
    const result = assessProgress({ phase: null, today: TODAY, weighIns: [], ...noData });
    expect(result.status).toBe('no_phase');
    expect(result.headline.toLowerCase()).toContain('no active phase');
    expect(result.details).toHaveLength(0);
  });

  it('fewer than 7 weigh-ins in the trailing 21 days -> insufficient_data', () => {
    // 6 weigh-ins, spaced inside the window.
    const weighIns = [0, -3, -6, -9, -12, -15].map((d) => ({ date: day(d), weightLb: 180 }));
    const result = assessProgress({ phase: phase(), today: TODAY, weighIns, ...noData });
    expect(result.status).toBe('insufficient_data');
    expect(result.details[0].text).toContain('6');
  });

  it('a single weigh-in -> insufficient_data', () => {
    const result = assessProgress({
      phase: phase(),
      today: TODAY,
      weighIns: [{ date: TODAY, weightLb: 180 }],
      ...noData,
    });
    expect(result.status).toBe('insufficient_data');
  });

  it('phase started yesterday: pre-phase weigh-ins do not count toward sufficiency', () => {
    // 60 days of daily weigh-ins, but the phase began yesterday — only 2 are in-phase.
    const weighIns = linearWeighIns(-60, 0, 180, 0);
    const result = assessProgress({
      phase: phase({ startDay: day(-1) }),
      today: TODAY,
      weighIns,
      ...noData,
    });
    expect(result.status).toBe('insufficient_data');
  });

  it('enough weigh-ins but under 7 in-phase days -> insufficient_data (too new)', () => {
    // 3 weigh-ins per day would be unusual; instead: 7 daily weigh-ins in a
    // 6-day-old phase — sufficiency passes (7 >= 7) but the span is < 7 days.
    const weighIns = linearWeighIns(-6, 0, 180, 0);
    const result = assessProgress({
      phase: phase({ startDay: day(-6) }),
      today: TODAY,
      weighIns,
      ...noData,
    });
    expect(result.status).toBe('insufficient_data');
    expect(result.headline).toContain('too new');
  });
});

describe('assessProgress — bulk rate rules', () => {
  it('rate exactly at target + 0.25 stays on_track (boundary value)', () => {
    const weighIns = linearWeighIns(-120, 0, 175, 0.75);
    const result = assessProgress({ phase: phase(), today: TODAY, weighIns, ...noData });
    expect(result.status).toBe('on_track');
    expect(result.headline).toContain('gaining on target');
    expect(result.suggestion).toBeUndefined();
  });

  it('rate above target + 0.25 across both windows -> attention with calorie suggestion', () => {
    const weighIns = linearWeighIns(-120, 0, 175, 1.5);
    const result = assessProgress({ phase: phase(), today: TODAY, weighIns, ...noData });
    expect(result.status).toBe('attention');
    expect(result.headline).toContain('gaining faster than target');
    expect(result.suggestion).toContain('100-200 cal');
    expect(result.details[0].text).toMatch(/Trend \+1\.5 lb\/wk vs \+0\.5 target/);
  });

  it('overshoot in 30d only (14d back on target) -> attention but NO suggestion', () => {
    // Hot at +2 lb/wk until 29 days ago, then +0.4 lb/wk since: the 30d
    // window still reads hot (~+1.0), the 14d window has cooled to ~+0.6
    // (within target + 0.25), so the calorie suggestion must NOT fire.
    const hot = linearWeighIns(-120, -29, 170, 2.0);
    const lastHot = hot[hot.length - 1].weightLb;
    const cool = linearWeighIns(-28, 0, lastHot + 0.4 / 7, 0.4);
    const result = assessProgress({
      phase: phase(),
      today: TODAY,
      weighIns: [...hot, ...cool],
      ...noData,
    });
    expect(result.status).toBe('attention');
    expect(result.headline).toContain('gaining faster than target');
    expect(result.suggestion).toBeUndefined();
  });

  it('flat/negative rate during bulk -> attention, gaining slower than target', () => {
    const weighIns = linearWeighIns(-120, 0, 180, -0.2);
    const result = assessProgress({ phase: phase(), today: TODAY, weighIns, ...noData });
    expect(result.status).toBe('attention');
    expect(result.headline).toContain('gaining slower than target');
    expect(result.suggestion).toBeUndefined();
  });

  it('a phase boundary mid-trend-window never leaks pre-phase data into the rate', () => {
    // 60 days of a hard cut, then a 28-day-old bulk gaining on target. If the
    // window crossed the boundary the rate would read negative -> "slower".
    const cut = linearWeighIns(-88, -29, 200, -2.0);
    const bulkStartLb = cut[cut.length - 1].weightLb;
    const bulk = linearWeighIns(-28, 0, bulkStartLb, 0.5);
    const result = assessProgress({
      phase: phase({ startDay: day(-28) }),
      today: TODAY,
      weighIns: [...cut, ...bulk],
      ...noData,
    });
    expect(result.status).toBe('on_track');
    expect(result.headline).toContain('gaining on target');
  });
});

describe('assessProgress — bulk DEXA partition rules', () => {
  const onTargetWeighIns = linearWeighIns(-120, 0, 175, 0.5);

  it('lean share of gain under 30% across 2 in-phase scans -> attention + partition detail', () => {
    const scans = [mkScan(-110, 70, 20), mkScan(-10, 70.3, 22)]; // lean 13% of total gain
    const result = assessProgress({
      phase: phase(),
      today: TODAY,
      weighIns: onTargetWeighIns,
      scans,
      waist: [],
    });
    expect(result.status).toBe('attention');
    expect(result.details.some((d) => d.metric === 'Partition')).toBe(true);
  });

  it('poor partition + waist rising over 0.25 in/month -> off_track', () => {
    const scans = [mkScan(-110, 70, 20), mkScan(-10, 70.3, 22)];
    const waist: WaistEntry[] = [
      { day: day(-90), waistIn: 34 },
      { day: day(-5), waistIn: 35.2 }, // +1.2 in over 85d ≈ +0.43 in/mo
    ];
    const result = assessProgress({
      phase: phase(),
      today: TODAY,
      weighIns: onTargetWeighIns,
      scans,
      waist,
    });
    expect(result.status).toBe('off_track');
    expect(result.details.some((d) => d.metric === 'Waist')).toBe(true);
  });

  it('negative in-phase lean across 2 scans -> attention with scan-conditions caveat first', () => {
    const scans = [mkScan(-110, 70, 20), mkScan(-10, 69.4, 22)];
    const result = assessProgress({
      phase: phase(),
      today: TODAY,
      weighIns: onTargetWeighIns,
      scans,
      waist: [],
    });
    expect(result.status).toBe('attention');
    const leanDetail = result.details.find((d) => d.metric === 'Lean mass');
    expect(leanDetail?.text).toContain('scan conditions');
    // The caveat REPLACES diet advice — the one suggestion is to recheck conditions.
    expect(result.suggestion).toContain('scan conditions');
  });

  it('scans outside the phase are ignored: 1 in-phase scan -> no partition rules fire', () => {
    // First scan predates the phase (taken during a prior cut) — the old
    // cross-boundary bug would pair it with the in-phase scan.
    const scans = [mkScan(-150, 72, 18), mkScan(-10, 70.3, 22)];
    const result = assessProgress({
      phase: phase(),
      today: TODAY,
      weighIns: onTargetWeighIns,
      scans,
      waist: [],
    });
    expect(result.status).toBe('on_track');
    expect(result.details.some((d) => d.metric === 'Lean mass')).toBe(false);
    expect(result.details.some((d) => d.metric === 'Partition')).toBe(false);
  });
});

describe('assessProgress — cut rules', () => {
  const cutPhase = () => phase({ phaseType: 'cut', targetRateLbsPerWeek: -1.0 });

  it('rate within tolerance of target -> on_track', () => {
    const weighIns = linearWeighIns(-120, 0, 210, -1.0);
    const result = assessProgress({ phase: cutPhase(), today: TODAY, weighIns, ...noData });
    expect(result.status).toBe('on_track');
    expect(result.headline).toContain('losing on target');
  });

  it('losing faster than target across both windows -> attention + add-calories suggestion', () => {
    const weighIns = linearWeighIns(-120, 0, 210, -1.6);
    const result = assessProgress({ phase: cutPhase(), today: TODAY, weighIns, ...noData });
    expect(result.status).toBe('attention');
    expect(result.headline).toContain('losing faster than target');
    expect(result.suggestion).toContain('Add 100-200 cal');
  });

  it('losing slower than target -> attention, no suggestion', () => {
    const weighIns = linearWeighIns(-120, 0, 210, -0.4);
    const result = assessProgress({ phase: cutPhase(), today: TODAY, weighIns, ...noData });
    expect(result.status).toBe('attention');
    expect(result.headline).toContain('losing slower than target');
    expect(result.suggestion).toBeUndefined();
  });

  it('faster than 1.5% bodyweight per week -> off_track regardless of target', () => {
    // 200 lb losing 3.2 lb/wk = 1.6%/wk.
    const weighIns = linearWeighIns(-120, 0, 255, -3.2);
    const result = assessProgress({
      phase: phase({ phaseType: 'cut', targetRateLbsPerWeek: -3.0 }),
      today: TODAY,
      weighIns,
      ...noData,
    });
    expect(result.status).toBe('off_track');
    expect(result.headline).toContain('losing too fast');
    expect(result.details.some((d) => d.metric === 'Pace')).toBe(true);
  });

  it('lean loss over 25% of total loss across 2 in-phase scans -> attention + protein suggestion', () => {
    const weighIns = linearWeighIns(-120, 0, 210, -1.0);
    const scans = [mkScan(-110, 72, 25), mkScan(-10, 70, 21)]; // lean -2 of -6 kg = 33%
    const result = assessProgress({
      phase: cutPhase(),
      today: TODAY,
      weighIns,
      scans,
      waist: [],
    });
    expect(result.status).toBe('attention');
    expect(result.suggestion).toContain('protein');
  });
});

describe('assessProgress — recomp / maintenance', () => {
  it('maintenance with weight within ±1% of phase start -> on_track', () => {
    const weighIns = linearWeighIns(-60, 0, 180, 0);
    const result = assessProgress({
      phase: phase({ phaseType: 'maintenance', startDay: day(-60), targetRateLbsPerWeek: null }),
      today: TODAY,
      weighIns,
      ...noData,
    });
    expect(result.status).toBe('on_track');
    expect(result.headline).toContain('holding steady');
  });

  it('maintenance drifting beyond ±1% -> attention', () => {
    // +4.5 lb on 180 over 60 days ≈ +2.5% raw (≈ +2.1% on the trend).
    const weighIns = linearWeighIns(-60, 0, 180, 4.5 / (60 / 7));
    const result = assessProgress({
      phase: phase({ phaseType: 'maintenance', startDay: day(-60), targetRateLbsPerWeek: null }),
      today: TODAY,
      weighIns,
      ...noData,
    });
    expect(result.status).toBe('attention');
    expect(result.headline).toContain('drifting up');
  });

  it('recomp with no waist or DEXA signal is honest that there is no verdict yet', () => {
    const weighIns = linearWeighIns(-60, 0, 180, 0);
    const result = assessProgress({
      phase: phase({ phaseType: 'recomp', startDay: day(-60), targetRateLbsPerWeek: null }),
      today: TODAY,
      weighIns,
      ...noData,
    });
    expect(result.status).toBe('on_track');
    expect(result.headline).toContain('slow to detect');
  });

  it('recomp with waist trending down -> positive verdict', () => {
    const weighIns = linearWeighIns(-60, 0, 180, 0);
    const waist: WaistEntry[] = [
      { day: day(-50), waistIn: 34.5 },
      { day: day(-2), waistIn: 34.0 },
    ];
    const result = assessProgress({
      phase: phase({ phaseType: 'recomp', startDay: day(-60), targetRateLbsPerWeek: null }),
      today: TODAY,
      weighIns,
      scans: [],
      waist,
    });
    expect(result.status).toBe('on_track');
    expect(result.headline).toContain('waist trending down');
  });

  it('recomp with waist rising fast -> attention', () => {
    const weighIns = linearWeighIns(-60, 0, 180, 0);
    const waist: WaistEntry[] = [
      { day: day(-50), waistIn: 34 },
      { day: day(-2), waistIn: 35 }, // +1 in over 48d ≈ +0.63 in/mo
    ];
    const result = assessProgress({
      phase: phase({ phaseType: 'recomp', startDay: day(-60), targetRateLbsPerWeek: null }),
      today: TODAY,
      weighIns,
      scans: [],
      waist,
    });
    expect(result.status).toBe('attention');
    expect(result.headline).toContain('waist trending up');
  });
});

describe('assessProgress — output shape and tone', () => {
  it('never exceeds 4 details and never uses exclamation points', () => {
    const weighIns = linearWeighIns(-120, 0, 175, 1.5);
    const scans = [mkScan(-110, 70, 20), mkScan(-10, 70.2, 23)];
    const waist: WaistEntry[] = [
      { day: day(-90), waistIn: 34 },
      { day: day(-5), waistIn: 35.5 },
    ];
    const result = assessProgress({ phase: phase(), today: TODAY, weighIns, scans, waist });
    expect(result.details.length).toBeLessThanOrEqual(4);
    const allText = [result.headline, result.suggestion ?? '', ...result.details.map((d) => d.text)].join(' ');
    expect(allText).not.toContain('!');
  });

  it('headline carries the phase label and week number', () => {
    const weighIns = linearWeighIns(-120, 0, 175, 0.5);
    const result = assessProgress({ phase: phase(), today: TODAY, weighIns, ...noData });
    // 120 days -> week 18.
    expect(result.headline).toMatch(/^Bulk, week 18:/);
  });
});

describe('scansInPhase', () => {
  it('keeps only scans inside [start, end], sorted ascending', () => {
    const scans = [mkScan(-5, 70, 20), mkScan(-200, 71, 21), mkScan(-50, 69, 19)];
    const kept = scansInPhase(scans, day(-100), TODAY);
    expect(kept.map((s) => s.scanDate)).toEqual([day(-50), day(-5)]);
  });
});
