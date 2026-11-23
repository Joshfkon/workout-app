import { estimateE1RMFromRpe } from '@/services/shared/e1rm';
import { rirToRpe } from '@/types/schema';
import {
  EST_MAX_METHOD,
  earlyLiftChange,
  estMaxExample,
  estMaxLabel,
  exampleSetPoint,
  moreWorkouts,
  nextTrendHint,
  risingSlippingNames,
  setLabel,
  shortNameList,
  workoutsUntilTrend,
} from '../liftTrendFormat';

describe('liftTrendFormat', () => {
  it('labels a lifted set exactly (no plate rounding) and a no-load set by reps', () => {
    expect(setLabel(62, 8, 'kg')).toBe('62 kg × 8');
    expect(setLabel(83.9146, 8, 'lb')).toBe('185 lbs × 8');
    expect(setLabel(0, 6, 'kg')).toBe('6 reps');
  });

  it('labels an estimated max as an estimate, with the set it came from', () => {
    expect(estMaxLabel(102, { weightKg: 83.9146, reps: 8 }, 'lb')).toBe('Est. max 225.0 lbs (from 185 lbs × 8)');
    // Older persisted points carry no top set: the estimate alone, still labelled.
    expect(estMaxLabel(100, { weightKg: undefined, reps: undefined }, 'kg')).toBe('Est. max 100.0 kg');
    expect(estMaxLabel(100, null, 'kg')).toBe('Est. max 100.0 kg');
  });

  it('counts the workouts still needed for a trend', () => {
    expect(workoutsUntilTrend(1)).toBe(2);
    expect(workoutsUntilTrend(2)).toBe(1);
    expect(workoutsUntilTrend(5)).toBe(0);
    expect(moreWorkouts(1)).toBe('1 more workout');
    expect(moreWorkouts(2)).toBe('2 more workouts');
  });

  it('names the lift closest to a trend', () => {
    expect(
      nextTrendHint([
        { name: 'Lat Pulldown', sessions: 1, bestWeightKg: 55, bestReps: 10 },
        { name: 'Barbell Row', sessions: 2, bestWeightKg: 60, bestReps: 10 },
      ])
    ).toBe('Log Barbell Row once more to see its trend line.');
    expect(nextTrendHint([{ name: 'Lat Pulldown', sessions: 1, bestWeightKg: 55, bestReps: 10 }])).toBe(
      'Log Lat Pulldown 2 more times to see its trend line.'
    );
    expect(nextTrendHint([])).toBeNull();
    expect(nextTrendHint(undefined)).toBeNull();
  });

  it('shows first vs latest top set once a lift has two workouts', () => {
    const lift = {
      name: 'Bench',
      sessions: 2,
      bestWeightKg: 62.5,
      bestReps: 8,
      firstWeightKg: 60,
      firstReps: 8,
      latestWeightKg: 62.5,
      latestReps: 8,
    };
    expect(earlyLiftChange(lift, 'kg')).toBe('First 60 kg × 8 → latest 62.5 kg × 8');
    expect(earlyLiftChange({ ...lift, sessions: 1 }, 'kg')).toBeNull();
    // Summary persisted before first/latest were recorded.
    expect(earlyLiftChange({ name: 'Bench', sessions: 2, bestWeightKg: 60, bestReps: 8 }, 'kg')).toBeNull();
  });

  describe('est. max method (UX panel: "show which e1RM formula is used")', () => {
    const LB = 0.45359237;
    // The panel's set: 180 lbs × 10, logged at 2 reps in reserve (RIR chip
    // → RPE 7.5, the canonical mapping the workout screen saves).
    const w = 180 * LB;
    const rpe = rirToRpe(2);
    const e1rmKg = Math.round(estimateE1RMFromRpe(w, 10, rpe)!.value * 10) / 10;

    it('names the formula and the reps-left rule', () => {
      expect(EST_MAX_METHOD).toMatch(/Brzycki/);
      expect(EST_MAX_METHOD).toMatch(/weight × 36 ÷ \(37 − reps to failure\)/);
      expect(EST_MAX_METHOD).toMatch(/reps you had left/);
      expect(EST_MAX_METHOD).toMatch(/Past 12 reps to failure it counts 12, and past 15 it makes no estimate/);
    });

    it("works the panel's 180 × 10 through: ~2 left ≈ 12 to failure → ~260 (the number is right)", () => {
      // 180 × 36 / (37 − 12) = 259.2 lb → shown on the 2.5 lb grid as 260.
      expect(e1rmKg / LB).toBeCloseTo(259.2, 0);
      expect(estMaxExample({ e1rmKg, topSetWeightKg: w, topSetReps: 10, topSetRpe: rpe }, 'lb')).toBe(
        'Your best set: 180 lbs × 10 with ~2 left ≈ 12 reps to failure → est. max 260.0 lbs.'
      );
    });

    it('says when a set counts as taken to failure, and when the 12-rep cap applies', () => {
      const fail = estimateE1RMFromRpe(w, 10, null)!.value;
      expect(estMaxExample({ e1rmKg: fail, topSetWeightKg: w, topSetReps: 10, topSetRpe: 10 }, 'lb')).toBe(
        'Your best set: 180 lbs × 10 taken to failure ≈ 10 reps to failure → est. max 240.0 lbs.'
      );
      const capped = estimateE1RMFromRpe(60, 12, rirToRpe(2))!.value;
      expect(estMaxExample({ e1rmKg: capped, topSetWeightKg: 60, topSetReps: 12, topSetRpe: rirToRpe(2) }, 'kg', 'Your last best set')).toBe(
        'Your last best set: 60 kg × 12 with ~2 left ≈ 14 reps to failure, counted as 12 → est. max 87.5 kg.'
      );
    });

    it('never guesses reps left for a point persisted without its RPE, and needs a loaded set', () => {
      expect(estMaxExample({ e1rmKg: 100, topSetWeightKg: 80, topSetReps: 8 }, 'kg')).toBe(
        'Your best set: 80 kg × 8 → est. max 100.0 kg.'
      );
      expect(estMaxExample({ e1rmKg: 100, topSetWeightKg: 0, topSetReps: 8, topSetRpe: 8 }, 'kg')).toBeNull();
      expect(estMaxExample(null, 'kg')).toBeNull();
    });

    it("picks the strongest of the lifts' latest sets for the example", () => {
      const p = (e1rmKg: number) => ({ date: '2026-11-01', e1rmKg, topSetWeightKg: 50, topSetReps: 5 });
      expect(exampleSetPoint([{ history: [p(200), p(90)] }, { history: [p(120)] }])?.e1rmKg).toBe(120);
      expect(exampleSetPoint([])).toBeNull();
    });
  });
});

describe('naming the lifts behind the counts (panel r19)', () => {
  it('lists at most three names, then "+N more"', () => {
    expect(shortNameList(['A'])).toBe('A');
    expect(shortNameList(['A', 'B', 'C'])).toBe('A, B, C');
    expect(shortNameList(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C (+2 more)');
  });

  it('names confident rising/slipping lifts, with the gym for per-gym tracks', () => {
    const l = (name: string, direction: 'rising' | 'flat' | 'down', extra = {}) => ({
      name,
      direction,
      lowConfidence: false,
      locationLabel: null as string | null,
      ...extra,
    });
    expect(
      risingSlippingNames([
        l('Leg Press', 'rising', { locationLabel: 'Home' }),
        l('Bench', 'rising', { lowConfidence: true }),
        l('Row', 'down'),
        l('Curl', 'flat'),
      ])
    ).toBe('Rising: Leg Press (Home). Slipping: Row.');
    expect(risingSlippingNames([l('Curl', 'flat')])).toBeNull();
  });
});
