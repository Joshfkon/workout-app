import {
  formatNutritionShareText,
  type NutritionShareDayLog,
  type NutritionShareTargets,
} from '../nutritionShareText';
import type { PacingPhase } from '../intakePacing';

// ============================================================
// Fixtures
//
// Targets mirror the feature-spec examples (protein 200g, carbs 380g,
// fat 85g, 3,100 kcal). `now` is always constructed with the local-time
// Date constructor so the eating-window math is timezone-stable, matching
// how services/intakePacing.ts reads the clock (now.getHours()).
// ============================================================

const TARGETS: NutritionShareTargets = {
  calories: 3100,
  protein: 200,
  carbs: 380,
  fat: 85,
};

/** Default eating window is 07:00–21:00 (14h) — expFrac 0.5 at 2:00 PM. */
function at(hour: number, minute = 0): Date {
  return new Date(2026, 6, 10, hour, minute); // Jul 10 2026, local time
}

function dayLog(
  totals: Partial<NutritionShareTotals>,
  mealsLogged = 3
): NutritionShareDayLog {
  return {
    totals: { calories: 0, protein: 0, carbs: 0, fat: 0, ...totals },
    mealsLogged,
  };
}

type NutritionShareTotals = NutritionShareDayLog['totals'];

/** Grab the rendered line whose macro label / unit matches. */
function lineFor(output: string, needle: string): string {
  const line = output.split('\n').find((l) => l.includes(needle));
  if (!line) throw new Error(`No line containing "${needle}" in:\n${output}`);
  return line;
}

const footerOf = (output: string): string => output.trim().split('\n').pop() as string;

// ============================================================
// End-of-day full-day band grading
// ============================================================

describe('formatNutritionShareText — end-of-day grading', () => {
  it('bulk, all targets hit → all-green bars, ✅ on each, no "in progress"', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 3100, protein: 200, carbs: 380, fat: 85 }, 4),
      TARGETS,
      'bulk',
      { now: at(20, 0), phaseWeek: 1 }
    );
    expect(lineFor(out, 'Protein')).toBe('🟩🟩🟩🟩🟩 Protein 200 / 200g ✅');
    expect(lineFor(out, 'Carbs')).toBe('🟩🟩🟩🟩🟩 Carbs 380 / 380g ✅');
    expect(lineFor(out, 'Fat')).toBe('🟩🟩🟩🟩🟩 Fat 85 / 85g ✅');
    expect(lineFor(out, 'kcal')).toBe('🟩🟩🟩🟩🟩 3,100 / 3,100 kcal ✅');
    expect(out).not.toContain('🟨');
    expect(out).not.toContain('🟥');
    expect(out).not.toContain('in progress');
    expect(footerOf(out)).toBe('4 meals · 100% to target');
  });

  it('cut, calories 8% over → yellow calorie bar', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 3348, protein: 200, carbs: 380, fat: 85 }), // 108%
      TARGETS,
      'cut',
      { now: at(20, 0) }
    );
    expect(lineFor(out, 'kcal')).toContain('🟨');
    expect(lineFor(out, 'kcal')).not.toContain('🟩');
  });

  it('cut, calories 12% under → green (harmless direction)', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 2728, protein: 200, carbs: 380, fat: 85 }), // 88%
      TARGETS,
      'cut',
      { now: at(21, 30) } // window closed → full-day grading
    );
    const kcal = lineFor(out, 'kcal');
    expect(kcal).toContain('🟩');
    expect(kcal).not.toContain('🟨');
    expect(kcal).not.toContain('🟥');
  });

  it('bulk, calories 12% under → counterproductive (yellow/red)', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 2728, protein: 200, carbs: 380, fat: 85 }), // 88%
      TARGETS,
      'bulk',
      { now: at(21, 30) }
    );
    const kcal = lineFor(out, 'kcal');
    expect(kcal).toMatch(/🟨|🟥/);
    expect(kcal).not.toContain('🟩');
  });

  it('protein at 110% → green + ✅', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 3100, protein: 220, carbs: 380, fat: 85 }),
      TARGETS,
      'bulk',
      { now: at(21, 30) }
    );
    const protein = lineFor(out, 'Protein');
    expect(protein).toContain('🟩');
    expect(protein).not.toMatch(/🟨|🟥/);
    expect(protein).toContain('✅');
  });

  it('9:30 PM (window closed) → no pace line, full-day footer', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 1500, protein: 100, carbs: 200, fat: 40 }, 2),
      TARGETS,
      'bulk',
      { now: at(21, 30) }
    );
    const footer = footerOf(out);
    expect(footer).toBe('2 meals · 48% to target');
    expect(out).not.toMatch(/⏱️|📈|📉/);
    expect(out).not.toContain(' at ');
  });

  it('8 PM at 96% of calories → treated as end-of-day', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 2976, protein: 200, carbs: 380, fat: 85 }, 4), // 96%, window still open
      TARGETS,
      'bulk',
      { now: at(20, 0) }
    );
    expect(footerOf(out)).toBe('4 meals · 96% to target');
    expect(out).not.toMatch(/⏱️|📈|📉/);
  });
});

// ============================================================
// Midday pace grading
// ============================================================

describe('formatNutritionShareText — midday pacing', () => {
  it('2 PM, 50% of calories, expFrac 0.5 → paceRatio 1.0 → on pace, green bars', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 1550, protein: 100, carbs: 190, fat: 42.5 }),
      TARGETS,
      'bulk',
      { now: at(14, 0) }
    );
    const footer = footerOf(out);
    expect(footer).toContain('⏱️');
    expect(footer).toContain('On pace');
    expect(footer).toContain('at');
    expect(lineFor(out, 'kcal')).toContain('🟩');
    expect(lineFor(out, 'kcal')).not.toMatch(/🟨|🟥/);
  });

  it('2 PM, 30% of calories on a bulk → behind, yellow calorie bar', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 930, protein: 60, carbs: 114, fat: 25.5 }), // 30%, paceRatio 0.6
      TARGETS,
      'bulk',
      { now: at(14, 0) }
    );
    expect(footerOf(out)).toContain('Behind');
    expect(footerOf(out)).toContain('📉');
    expect(lineFor(out, 'kcal')).toContain('🟨');
    expect(lineFor(out, 'kcal')).not.toContain('🟩');
  });

  it('2 PM, 30% of calories on a cut → behind but green bars (harmless)', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 930, protein: 60, carbs: 114, fat: 25.5 }),
      TARGETS,
      'cut',
      { now: at(14, 0) }
    );
    expect(footerOf(out)).toContain('Behind');
    const kcal = lineFor(out, 'kcal');
    expect(kcal).toContain('🟩');
    expect(kcal).not.toMatch(/🟨|🟥/);
  });

  it('protein paceRatio 0.6 midday → protein row 🟨 even if calories on pace', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 1550, protein: 60, carbs: 190, fat: 42.5 }), // cals 50% (pace 1.0), protein 30% (pace 0.6)
      TARGETS,
      'bulk',
      { now: at(14, 0) }
    );
    expect(footerOf(out)).toContain('On pace');
    expect(lineFor(out, 'Protein')).toContain('🟨');
    expect(lineFor(out, 'kcal')).toContain('🟩');
    expect(lineFor(out, 'kcal')).not.toMatch(/🟨|🟥/);
  });
});

// ============================================================
// Header, footer, and no-numbers privacy mode
// ============================================================

describe('formatNutritionShareText — header & privacy', () => {
  it('header shows app name, food emoji, date, phase, and week', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 1550, protein: 100, carbs: 190, fat: 42 }),
      TARGETS,
      'bulk',
      { now: at(14, 0), phaseWeek: 1 }
    );
    const [line1, line2] = out.split('\n');
    expect(line1).toBe('HyperTrack 🍽️ Fri Jul 10');
    expect(line2).toBe('Bulk · Wk 1');
  });

  it('omits the phase line when there is no active phase', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 1550, protein: 100, carbs: 190, fat: 42 }),
      TARGETS,
      null,
      { now: at(14, 0) }
    );
    expect(out.split('\n')[1]).toBe('');
  });

  it('no-numbers mode (end-of-day) → zero digits anywhere', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 3100, protein: 200, carbs: 380, fat: 85 }, 4),
      TARGETS,
      'bulk',
      { now: at(20, 0), phaseWeek: 1, noNumbers: true }
    );
    expect(out).not.toMatch(/\d/);
    expect(out).toContain('Protein');
    expect(out).toContain('✅');
    expect(footerOf(out)).toBe('on track');
  });

  it('no-numbers mode not-yet-compliant → "in progress"', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 1500, protein: 90, carbs: 200, fat: 40 }, 2),
      TARGETS,
      'cut',
      { now: at(21, 30), noNumbers: true }
    );
    expect(out).not.toMatch(/\d/);
    expect(footerOf(out)).toBe('in progress');
  });

  it('no-numbers mode (midday) → zero digits but keeps the pace word', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 1550, protein: 100, carbs: 190, fat: 42.5 }),
      TARGETS,
      'bulk',
      { now: at(14, 0), noNumbers: true }
    );
    expect(out).not.toMatch(/\d/);
    expect(footerOf(out)).toBe('⏱️ On pace');
  });
});
