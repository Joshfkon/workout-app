import {
  DEFAULT_EATING_WINDOW,
  PACING_GRACE_MINUTES,
  assessIntakePace,
  eatingWindowFraction,
  normalizePacingPhase,
  type AssessIntakePaceInput,
  type PacingPhase,
} from '../intakePacing';

/** Local-time Date at hh:mm on a fixed day. */
const at = (hours: number, minutes = 0) => new Date(2026, 6, 9, hours, minutes, 0, 0);

const CALORIE_TARGET = 2000;

function verdict(overrides: Partial<AssessIntakePaceInput>) {
  return assessIntakePace({
    macro: 'calories',
    consumed: 0,
    target: CALORIE_TARGET,
    phase: 'maintenance',
    now: at(14), // 50% through 07:00-21:00
    ...overrides,
  });
}

describe('eatingWindowFraction', () => {
  it('is 0 at window start, 0.25 / 0.5 partway through, 1 at the end', () => {
    expect(eatingWindowFraction(at(7))).toBe(0);
    expect(eatingWindowFraction(at(10, 30))).toBeCloseTo(0.25);
    expect(eatingWindowFraction(at(14))).toBeCloseTo(0.5);
    expect(eatingWindowFraction(at(21))).toBe(1);
  });

  it('clamps outside the window and honors a custom window', () => {
    expect(eatingWindowFraction(at(5, 30))).toBe(0);
    expect(eatingWindowFraction(at(23))).toBe(1);
    const window = { startMinutes: 9 * 60, endMinutes: 17 * 60 };
    expect(eatingWindowFraction(at(13), window)).toBeCloseTo(0.5);
  });
});

describe('assessIntakePace — suppression', () => {
  it('is neutral before the window starts (05:30)', () => {
    const result = verdict({ now: at(5, 30), consumed: 0 });
    expect(result).toMatchObject({ status: 'on pace', tone: 'neutral', suppressed: true });
  });

  it('is neutral within the first hour of the window, judging right after', () => {
    // 07:59 — inside grace even though intake is 0.
    expect(verdict({ now: at(7, 59), phase: 'bulk' })).toMatchObject({
      status: 'on pace',
      tone: 'neutral',
      suppressed: true,
    });
    // 08:00 — grace over (start + PACING_GRACE_MINUTES); 0 consumed is behind.
    expect(DEFAULT_EATING_WINDOW.startMinutes + PACING_GRACE_MINUTES).toBe(8 * 60);
    expect(verdict({ now: at(8), phase: 'bulk' })).toMatchObject({
      status: 'behind',
      suppressed: false,
    });
  });

  it('is neutral without a target', () => {
    expect(verdict({ target: null, consumed: 500 })).toMatchObject({
      status: 'on pace',
      tone: 'neutral',
      suppressed: true,
    });
    expect(verdict({ target: 0, consumed: 500 }).tone).toBe('neutral');
  });
});

describe('assessIntakePace — bands at fixed times (maintenance)', () => {
  // At 14:00 expected = 1000 kcal.
  it.each([
    [1000, 'on pace', 'green'], // exactly expected
    [950, 'on pace', 'green'], // -5%, within ±10%
    [1100, 'on pace', 'green'], // +10% boundary
    [800, 'behind', 'yellow'], // -20%, in 10–25% short band
    [700, 'behind', 'orange'], // -30%, >25% short
    [1200, 'ahead', 'yellow'], // +20% over (symmetric warn)
    [1400, 'ahead', 'orange'], // +40% over
  ])('%d kcal consumed at 50%% → %s / %s', (consumed, status, tone) => {
    expect(verdict({ consumed })).toMatchObject({ status, tone, expected: 1000 });
  });

  it('judges against 25% of target at 10:30 and the full target at window end', () => {
    expect(verdict({ now: at(10, 30), consumed: 500 })).toMatchObject({
      status: 'on pace',
      expected: 500,
    });
    expect(verdict({ now: at(21), consumed: 1400 })).toMatchObject({
      status: 'behind',
      tone: 'orange',
      expected: 2000,
    });
  });
});

describe('assessIntakePace — phase direction', () => {
  // 14:00, expected 1000 kcal: 800 = 20% short, 1300 = 30% ahead.
  it('bulking warns behind, stays green ahead', () => {
    expect(verdict({ phase: 'bulk', consumed: 800 })).toMatchObject({
      status: 'behind',
      tone: 'yellow',
    });
    expect(verdict({ phase: 'bulk', consumed: 700 }).tone).toBe('orange');
    expect(verdict({ phase: 'bulk', consumed: 1300 })).toMatchObject({
      status: 'ahead',
      tone: 'green',
    });
  });

  it('bulking flags >15% over the DAILY total as gentle yellow, never orange', () => {
    // 2200 < 2300 (target * 1.15) → still green even though way over pace.
    expect(verdict({ phase: 'bulk', consumed: 2200 }).tone).toBe('green');
    expect(verdict({ phase: 'bulk', consumed: 2400 })).toMatchObject({
      status: 'ahead',
      tone: 'yellow',
    });
    expect(verdict({ phase: 'bulk', consumed: 3500 }).tone).toBe('yellow');
  });

  it('cutting warns ahead, is neutral behind', () => {
    expect(verdict({ phase: 'cut', consumed: 1200 })).toMatchObject({
      status: 'ahead',
      tone: 'yellow',
    });
    expect(verdict({ phase: 'cut', consumed: 1300 }).tone).toBe('orange');
    expect(verdict({ phase: 'cut', consumed: 700 })).toMatchObject({
      status: 'behind',
      tone: 'neutral',
    });
  });

  it('maintenance warns symmetrically', () => {
    expect(verdict({ phase: 'maintenance', consumed: 800 }).tone).toBe('yellow');
    expect(verdict({ phase: 'maintenance', consumed: 1200 }).tone).toBe('yellow');
  });

  it.each<PacingPhase>(['bulk', 'cut', 'maintenance'])(
    'protein behind-warns on a %s',
    (phase) => {
      // Target 150g, expected 75g at 14:00; 50g is 33% short.
      expect(
        assessIntakePace({ macro: 'protein', consumed: 50, target: 150, phase, now: at(14) })
      ).toMatchObject({ status: 'behind', tone: 'orange' });
    }
  );
});

describe('assessIntakePace — flexible-macro bands (carbs/fat ±20%)', () => {
  // Fat target 80g, expected 40g at 14:00.
  it('keeps fat green at a deviation that would warn for calories', () => {
    // 34g = 15% short: yellow for calories/protein, green for fat.
    expect(
      assessIntakePace({ macro: 'fat', consumed: 34, target: 80, phase: 'bulk', now: at(14) })
    ).toMatchObject({ status: 'on pace', tone: 'green' });
    expect(verdict({ consumed: 850 })).toMatchObject({ status: 'behind', tone: 'yellow' });
  });

  it('warns carbs beyond the wider bands', () => {
    // Carb target 300g, expected 150g; 105g = 30% short → yellow (20–35%),
    // 90g = 40% short → orange.
    const base = { macro: 'carbs' as const, target: 300, phase: 'bulk' as const, now: at(14) };
    expect(assessIntakePace({ ...base, consumed: 105 }).tone).toBe('yellow');
    expect(assessIntakePace({ ...base, consumed: 90 }).tone).toBe('orange');
  });
});

describe('normalizePacingPhase', () => {
  it('maps every goal spelling onto the three phases', () => {
    expect(normalizePacingPhase('bulk')).toBe('bulk');
    expect(normalizePacingPhase('cut')).toBe('cut');
    expect(normalizePacingPhase('maintenance')).toBe('maintenance');
    expect(normalizePacingPhase('maintain')).toBe('maintenance');
    expect(normalizePacingPhase('recomp')).toBe('maintenance');
    expect(normalizePacingPhase(null)).toBe('maintenance');
    expect(normalizePacingPhase(undefined)).toBe('maintenance');
  });
});
