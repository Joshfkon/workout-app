import {
  formatNutritionShareText,
  shareLineWidth,
  type NutritionShareDayLog,
  type NutritionShareMode,
  type NutritionShareTargets,
} from '../nutritionShareText';

// ============================================================
// Fixtures
//
// Targets follow the v2 feature-spec examples (protein 155g, carbs 345g,
// fat 62g, 2,558 kcal). `now` is always constructed with the local-time Date
// constructor so the eating-window math is timezone-stable, matching how
// services/intakePacing.ts reads the clock (now.getHours()).
// ============================================================

const TARGETS: NutritionShareTargets = {
  calories: 2558,
  protein: 155,
  carbs: 345,
  fat: 62,
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
// Task 1 — line width guardrail
//
// Every line of every mode / fixture must fit an iMessage bubble. `shareLineWidth`
// scores emoji squares/pictographs at 2 units and latin chars at 1; the value
// rows target ~24 (≈ 5 squares + 14 latin), and 30 is the hard ceiling that the
// branded header and Full's dense rows sit just under.
// ============================================================

const LINE_WIDTH_CAP = 30;

// ============================================================
// Snapshot matrix: each mode × the four canonical states.
// ============================================================

const MODES: NutritionShareMode[] = ['full', 'compact', 'minimal'];

/** End-of-day hit — the v2 spec's headline example (all-but-fat green). */
function endOfDayHit(mode: NutritionShareMode, noNumbers = false): string {
  return formatNutritionShareText(
    dayLog({ calories: 2477, protein: 175, carbs: 280, fat: 74 }, 4),
    TARGETS,
    'bulk',
    { now: at(20, 0), phaseWeek: 1, mode, noNumbers }
  );
}

/** End-of-day miss — under on protein and calories, window closed. */
function endOfDayMiss(mode: NutritionShareMode, noNumbers = false): string {
  return formatNutritionShareText(
    dayLog({ calories: 1500, protein: 90, carbs: 200, fat: 40 }, 2),
    TARGETS,
    'cut',
    { now: at(21, 30), mode, noNumbers }
  );
}

/** Midday on-pace — 2 PM, half the day's calories in. */
function middayOnPace(mode: NutritionShareMode, noNumbers = false): string {
  return formatNutritionShareText(
    dayLog({ calories: 1279, protein: 88, carbs: 173, fat: 31 }, 2),
    TARGETS,
    'bulk',
    { now: at(14, 0), mode, noNumbers }
  );
}

describe('formatNutritionShareText — line width (Task 1)', () => {
  it.each(MODES)('every line fits the bubble in %s mode (numbers)', (mode) => {
    const outputs = [endOfDayHit(mode), endOfDayMiss(mode), middayOnPace(mode)];
    for (const out of outputs) {
      for (const line of out.split('\n')) {
        expect(shareLineWidth(line)).toBeLessThanOrEqual(LINE_WIDTH_CAP);
      }
    }
  });

  it.each(MODES)('every line fits the bubble in %s mode (no numbers)', (mode) => {
    const outputs = [
      endOfDayHit(mode, true),
      endOfDayMiss(mode, true),
      middayOnPace(mode, true),
    ];
    for (const out of outputs) {
      for (const line of out.split('\n')) {
        expect(shareLineWidth(line)).toBeLessThanOrEqual(LINE_WIDTH_CAP);
      }
    }
  });

  it('scores emoji squares at 2 units and latin at 1', () => {
    expect(shareLineWidth('🟩🟩🟩🟩🟩')).toBe(10);
    expect(shareLineWidth('P 175g')).toBe(6);
    expect(shareLineWidth('🟩 175g protein✅')).toBe(2 + 13 + 2);
  });

  it('the tightened header has no spaces around the slash and hugs the ✅', () => {
    const protein = lineFor(endOfDayHit('full'), 'Protein');
    expect(protein).toBe('🟩🟩🟩🟩🟩 Protein 175/155g✅');
    expect(protein).not.toContain(' / ');
    expect(protein).not.toContain('g ✅');
  });
});

// ============================================================
// Full mode — exact strings for the four canonical states.
// ============================================================

describe('formatNutritionShareText — full mode', () => {
  it('end-of-day hit → the v2 headline example verbatim', () => {
    expect(endOfDayHit('full')).toBe(
      [
        'HyperTrack 🍽️ Jul 10 · Bulk',
        '',
        '🟩🟩🟩🟩🟩 Protein 175/155g✅',
        '🟩🟩🟩🟩⬜ Carbs 280/345g',
        '🟨🟨🟨🟨🟨 Fat 74/62g',
        '🟩🟩🟩🟩🟩 2,477 kcal',
        '',
        '4 meals · 97% to target',
      ].join('\n')
    );
  });

  it('end-of-day miss → under macros downgrade, footer % to target', () => {
    expect(endOfDayMiss('full')).toBe(
      [
        'HyperTrack 🍽️ Jul 10 · Cut',
        '',
        '🟥🟥🟥⬜⬜ Protein 90/155g',
        '🟩🟩🟩⬜⬜ Carbs 200/345g',
        '🟩🟩🟩⬜⬜ Fat 40/62g',
        '🟩🟩🟩⬜⬜ 1,500 kcal',
        '',
        '2 meals · 59% to target',
      ].join('\n')
    );
  });

  it('midday on-pace → pace footer with time', () => {
    expect(middayOnPace('full')).toBe(
      [
        'HyperTrack 🍽️ Jul 10 · Bulk',
        '',
        '🟩🟩🟩⬜⬜ Protein 88/155g',
        '🟩🟩🟩⬜⬜ Carbs 173/345g',
        '🟩🟩🟩⬜⬜ Fat 31/62g',
        '🟩🟩🟩⬜⬜ 1,279 kcal',
        '',
        '⏱️ On pace · 50% at 2:00 PM',
      ].join('\n')
    );
  });

  it('no-numbers → zero digits, words + squares only', () => {
    const out = endOfDayHit('full', true);
    expect(out).not.toMatch(/\d/);
    expect(out).toBe(
      [
        'HyperTrack 🍽️ Fri · Bulk',
        '',
        '🟩🟩🟩🟩🟩 Protein✅',
        '🟩🟩🟩🟩⬜ Carbs',
        '🟨🟨🟨🟨🟨 Fat',
        '🟩🟩🟩🟩🟩 Calories',
        '',
        'in progress',
      ].join('\n')
    );
  });
});

// ============================================================
// Compact mode — single-letter labels, no targets, no blank lines.
// ============================================================

describe('formatNutritionShareText — compact mode', () => {
  it('end-of-day hit → the v2 compact example verbatim', () => {
    expect(endOfDayHit('compact')).toBe(
      [
        'HyperTrack 🍽️ Jul 10 · Bulk',
        '🟩🟩🟩🟩🟩 P 175g✅',
        '🟩🟩🟩🟩⬜ C 280g',
        '🟨🟨🟨🟨🟨 F 74g',
        '🟩🟩🟩🟩🟩 2,477 kcal',
        '97% to target',
      ].join('\n')
    );
  });

  it('end-of-day miss → single letters, % to target, no meal count', () => {
    expect(endOfDayMiss('compact')).toBe(
      [
        'HyperTrack 🍽️ Jul 10 · Cut',
        '🟥🟥🟥⬜⬜ P 90g',
        '🟩🟩🟩⬜⬜ C 200g',
        '🟩🟩🟩⬜⬜ F 40g',
        '🟩🟩🟩⬜⬜ 1,500 kcal',
        '59% to target',
      ].join('\n')
    );
  });

  it('midday on-pace → pace footer with time', () => {
    expect(middayOnPace('compact')).toBe(
      [
        'HyperTrack 🍽️ Jul 10 · Bulk',
        '🟩🟩🟩⬜⬜ P 88g',
        '🟩🟩🟩⬜⬜ C 173g',
        '🟩🟩🟩⬜⬜ F 31g',
        '🟩🟩🟩⬜⬜ 1,279 kcal',
        '⏱️ On pace · 50% at 2:00 PM',
      ].join('\n')
    );
  });

  it('no-numbers → letters + squares, no digits', () => {
    const out = endOfDayHit('compact', true);
    expect(out).not.toMatch(/\d/);
    expect(out).toBe(
      [
        'HyperTrack 🍽️ Fri · Bulk',
        '🟩🟩🟩🟩🟩 P✅',
        '🟩🟩🟩🟩⬜ C',
        '🟨🟨🟨🟨🟨 F',
        '🟩🟩🟩🟩🟩 kcal',
        'in progress',
      ].join('\n')
    );
  });
});

// ============================================================
// Minimal mode — calories + protein only.
// ============================================================

describe('formatNutritionShareText — minimal mode', () => {
  it('end-of-day hit → the v2 minimal example verbatim', () => {
    expect(endOfDayHit('minimal')).toBe(
      [
        'HyperTrack 🍽️ Jul 10 · Bulk',
        '🟩 2,477 kcal · 97%',
        '🟩 175g protein✅',
      ].join('\n')
    );
  });

  it('end-of-day miss → protein under, no ✅, calorie % carries status', () => {
    expect(endOfDayMiss('minimal')).toBe(
      [
        'HyperTrack 🍽️ Jul 10 · Cut',
        '🟩 1,500 kcal · 59%',
        '🟥 90g protein',
      ].join('\n')
    );
  });

  it('midday on-pace → calorie line appends the pace marker', () => {
    expect(middayOnPace('minimal')).toBe(
      [
        'HyperTrack 🍽️ Jul 10 · Bulk',
        '🟩 1,279 kcal · ⏱️ on pace',
        '🟩 88g protein',
      ].join('\n')
    );
  });

  it('no-numbers → squares + words only', () => {
    const out = endOfDayHit('minimal', true);
    expect(out).not.toMatch(/\d/);
    expect(out).toBe(
      [
        'HyperTrack 🍽️ Fri · Bulk',
        '🟩 kcal on track',
        '🟩 protein✅',
      ].join('\n')
    );
  });

  it('protein under band midday → protein square 🟨', () => {
    // cals 50% (pace 1.0, green), protein 30% (pace 0.6 → yellow).
    const out = formatNutritionShareText(
      dayLog({ calories: 1279, protein: 46, carbs: 173, fat: 31 }),
      TARGETS,
      'bulk',
      { now: at(14, 0), mode: 'minimal' }
    );
    expect(lineFor(out, 'protein')).toContain('🟨');
    expect(lineFor(out, 'kcal')).toContain('🟩');
  });

  it('never surfaces carbs or fat, even when they blow past their band', () => {
    // Carbs & fat way over their band; minimal must not mention them anywhere.
    const out = formatNutritionShareText(
      dayLog({ calories: 1279, protein: 88, carbs: 900, fat: 300 }),
      TARGETS,
      'cut',
      { now: at(14, 0), mode: 'minimal' }
    );
    expect(out).not.toContain('Carbs');
    expect(out).not.toContain('Fat');
    expect(out).not.toContain('900');
    expect(out).not.toContain('300');
    expect(out).not.toMatch(/\bC \d/);
    expect(out).not.toMatch(/\bF \d/);
    expect(out.split('\n')).toHaveLength(3);
  });
});

// ============================================================
// Shared band / pace grading (mode-independent — Task 3 single source).
// ============================================================

describe('formatNutritionShareText — grading is shared across modes', () => {
  it('cut, calories 8% over → yellow calorie bar in every mode', () => {
    const totals = { calories: 2762, protein: 155, carbs: 345, fat: 62 }; // 108%
    for (const mode of MODES) {
      const out = formatNutritionShareText(dayLog(totals), TARGETS, 'cut', {
        now: at(20, 0),
        mode,
      });
      expect(lineFor(out, 'kcal')).toContain('🟨');
      expect(lineFor(out, 'kcal')).not.toContain('🟩');
    }
  });

  it('cut, calories 12% under → green (harmless direction)', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 2251, protein: 155, carbs: 345, fat: 62 }), // 88%
      TARGETS,
      'cut',
      { now: at(21, 30) } // window closed → full-day grading
    );
    const kcal = lineFor(out, 'kcal');
    expect(kcal).toContain('🟩');
    expect(kcal).not.toMatch(/🟨|🟥/);
  });

  it('bulk, calories 12% under → counterproductive (yellow/red)', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 2251, protein: 155, carbs: 345, fat: 62 }), // 88%
      TARGETS,
      'bulk',
      { now: at(21, 30) }
    );
    const kcal = lineFor(out, 'kcal');
    expect(kcal).toMatch(/🟨|🟥/);
    expect(kcal).not.toContain('🟩');
  });

  it('window closed → no pace line, full-day footer', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 1500, protein: 100, carbs: 200, fat: 40 }, 2),
      TARGETS,
      'bulk',
      { now: at(21, 30) }
    );
    expect(footerOf(out)).toBe('2 meals · 59% to target');
    expect(out).not.toMatch(/⏱️|📈|📉/);
    expect(out).not.toContain(' at ');
  });

  it('midday, behind pace on a bulk → behind footer + yellow calorie bar', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 895, protein: 52, carbs: 100, fat: 20 }), // 35%, paceRatio 0.7
      TARGETS,
      'bulk',
      { now: at(14, 0) }
    );
    expect(footerOf(out)).toContain('Behind');
    expect(footerOf(out)).toContain('📉');
    expect(lineFor(out, 'kcal')).toContain('🟨');
    expect(lineFor(out, 'kcal')).not.toContain('🟩');
  });
});

// ============================================================
// Header & phase handling
// ============================================================

describe('formatNutritionShareText — header', () => {
  it('one line: app name, food emoji, month/day, phase — no weekday', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 1279, protein: 88, carbs: 173, fat: 31 }),
      TARGETS,
      'bulk',
      { now: at(14, 0), phaseWeek: 1 }
    );
    expect(out.split('\n')[0]).toBe('HyperTrack 🍽️ Jul 10 · Bulk');
  });

  it('labels the maintenance phase "Recomp" and keeps the header in the bubble', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 2477, protein: 175, carbs: 280, fat: 74 }),
      TARGETS,
      'maintenance',
      { now: at(20, 0), phaseWeek: 1 }
    );
    const header = out.split('\n')[0];
    expect(header).toBe('HyperTrack 🍽️ Jul 10 · Recomp');
    expect(header).not.toContain('Maintenance');
    expect(shareLineWidth(header)).toBeLessThanOrEqual(LINE_WIDTH_CAP);
  });

  it('omits the phase when there is no active phase', () => {
    const out = formatNutritionShareText(
      dayLog({ calories: 1279, protein: 88, carbs: 173, fat: 31 }),
      TARGETS,
      null,
      { now: at(14, 0), mode: 'compact' }
    );
    expect(out.split('\n')[0]).toBe('HyperTrack 🍽️ Jul 10');
  });
});
