import {
  addDays,
  bestE1rmKg,
  dailyMacroTotals,
  dayInZone,
  describeBlock,
  describeSet,
  describeWarmups,
  formatBodyWeight,
  formatDay,
  formatDuration,
  formatLoad,
  isValidTimeZone,
  mean,
  mondayOf,
  weeklySetsByMuscle,
  weightLogToKg,
  workingSets,
  type SetRow,
} from '../summaries';
import { safePostLoginPath } from '../postLoginPath';

const set = (over: Partial<SetRow>): SetRow => ({
  set_number: 1,
  weight_kg: 100,
  reps: 8,
  rpe: 8,
  is_warmup: false,
  set_type: 'normal',
  ...over,
});

describe('MCP summaries', () => {
  describe('weights', () => {
    it('reads a weigh-in in its own unit', () => {
      expect(weightLogToKg(80, 'kg')).toBe(80);
      expect(weightLogToKg(220.462, 'lb')).toBeCloseTo(100, 3);
      // Rows with no unit are pounds, matching the app's default.
      expect(weightLogToKg(220.462, null)).toBeCloseTo(100, 3);
    });

    it('reports a logged load as entered, not rounded to plate increments', () => {
      expect(formatLoad(100, 'kg')).toBe('100 kg');
      expect(formatLoad(82.5, 'kg')).toBe('82.5 kg');
      // 185 lb is stored as 83.9146 kg and must read back as 185 lb.
      expect(formatLoad(185 / 2.20462, 'lb')).toBe('185 lb');
      expect(formatLoad(12.5 / 2.20462, 'lb')).toBe('12.5 lb');
    });

    it('shows body weight to one decimal without plate rounding', () => {
      expect(formatBodyWeight(81.37, 'kg')).toBe('81.4 kg');
      expect(formatBodyWeight(100, 'lb')).toBe('220.5 lb');
    });
  });

  describe('sets', () => {
    it('drops warm-ups and orders working sets', () => {
      const sets = [
        set({ set_number: 3 }),
        set({ set_number: 1, is_warmup: true }),
        set({ set_number: 2, set_type: 'warmup' }),
        set({ set_number: 4 }),
      ];
      expect(workingSets(sets).map((s) => s.set_number)).toEqual([3, 4]);
    });

    it('describes a rep set with reps in reserve', () => {
      expect(describeSet(set({ weight_kg: 100, reps: 8, rpe: 8 }), 'kg', false)).toBe('100 kg × 8 @ RIR 2');
    });

    it('prints a duration set as a hold time, never as reps', () => {
      const text = describeSet(set({ weight_kg: 0, reps: 45, rpe: 8 }), 'kg', true);
      expect(text).toBe('45s');
      expect(text).not.toContain('×');
    });

    it('marks non-normal set types', () => {
      expect(describeSet(set({ set_type: 'rest_pause' }), 'kg', false)).toContain('(rest pause)');
    });

    it('summarises a block and says when nothing was logged', () => {
      expect(describeBlock('Bench Press', [set({ set_number: 1 }), set({ set_number: 2, reps: 7, rpe: 9 })], 'kg', false)).toBe(
        'Bench Press: 100 kg × 8 @ RIR 2, 100 kg × 7 @ RIR 1'
      );
      expect(describeBlock('Bench Press', [set({ is_warmup: true })], 'kg', false)).toBe(
        'Bench Press: no working sets logged'
      );
    });

    it('lists warm-ups without effort tags, and holds as seconds', () => {
      const sets = [set({ set_number: 2, weight_kg: 60, reps: 5, is_warmup: true }), set({ set_number: 1, weight_kg: 40, reps: 8, is_warmup: true }), set({ set_number: 3 })];
      expect(describeWarmups(sets, 'kg', false)).toBe('40 kg × 8, 60 kg × 5');
      expect(describeWarmups([set({ weight_kg: 0, reps: 20, is_warmup: true })], 'kg', true)).toBe('20s');
      expect(describeWarmups([set({})], 'kg', false)).toBeNull();
    });

    it('gives no e1RM for duration exercises or empty blocks', () => {
      expect(bestE1rmKg([set({ reps: 60 })], true)).toBeNull();
      expect(bestE1rmKg([], false)).toBeNull();
      expect(bestE1rmKg([set({ is_warmup: true })], false)).toBeNull();
    });

    it('takes the best e1RM across working sets', () => {
      const light = bestE1rmKg([set({ weight_kg: 80, reps: 8 })], false)!;
      const both = bestE1rmKg([set({ weight_kg: 80, reps: 8 }), set({ set_number: 2, weight_kg: 100, reps: 8 })], false)!;
      expect(both).toBeGreaterThan(light);
      expect(both).toBeGreaterThan(100);
    });
  });

  describe('dates', () => {
    it('formats a date key without shifting it across time zones', () => {
      expect(formatDay('2026-11-09')).toBe('Mon, Nov 9, 2026');
      expect(formatDay('2026-11-09T23:30:00Z')).toBe('Mon, Nov 9, 2026');
      expect(formatDay(null)).toBe('unknown date');
    });

    it('buckets an instant by the local calendar day of the zone', () => {
      // 02:30 UTC on the 10th is still the evening of the 9th in Los Angeles.
      expect(dayInZone('2026-11-10T02:30:00Z', 'America/Los_Angeles')).toBe('2026-11-09');
      expect(dayInZone('2026-11-10T02:30:00Z', 'UTC')).toBe('2026-11-10');
    });

    it('adds calendar days across month and DST boundaries', () => {
      expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
      expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
      expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    });

    it('finds the Monday of a week, including for a Sunday', () => {
      expect(mondayOf('2026-11-09')).toBe('2026-11-09'); // Monday
      expect(mondayOf('2026-11-12')).toBe('2026-11-09'); // Thursday
      expect(mondayOf('2026-11-15')).toBe('2026-11-09'); // Sunday
    });

    it('validates IANA zones', () => {
      expect(isValidTimeZone('America/New_York')).toBe(true);
      expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    });

    it('formats durations', () => {
      expect(formatDuration(3900)).toBe('1h 5m');
      expect(formatDuration(1500)).toBe('25 min');
      expect(formatDuration(null)).toBe('duration not recorded');
    });
  });

  describe('weeklySetsByMuscle', () => {
    it('groups by local week and muscle, newest week first', () => {
      const weeks = weeklySetsByMuscle(
        [
          { logged_at: '2026-11-03T18:00:00Z', primary_muscle: 'chest' },
          { logged_at: '2026-11-10T18:00:00Z', primary_muscle: 'chest' },
          { logged_at: '2026-11-10T18:05:00Z', primary_muscle: 'chest' },
          { logged_at: '2026-11-11T18:00:00Z', primary_muscle: 'back' },
          { logged_at: '2026-11-11T18:05:00Z', primary_muscle: null },
        ],
        'UTC'
      );
      expect(weeks.map((w) => w.weekStart)).toEqual(['2026-11-09', '2026-11-02']);
      expect(weeks[0].total).toBe(4);
      expect(weeks[0].muscles[0]).toEqual(['chest', 2]);
      expect(Object.fromEntries(weeks[0].muscles)).toMatchObject({ back: 1, unknown: 1 });
    });

    it('puts a late-Sunday set in the right week for the user zone', () => {
      // Monday 03:00 UTC is still Sunday evening in Los Angeles.
      const rows = [{ logged_at: '2026-11-16T03:00:00Z', primary_muscle: 'legs' }];
      expect(weeklySetsByMuscle(rows, 'America/Los_Angeles')[0].weekStart).toBe('2026-11-09');
      expect(weeklySetsByMuscle(rows, 'UTC')[0].weekStart).toBe('2026-11-16');
    });
  });

  describe('nutrition', () => {
    it('sums entries per day, treating missing macros as zero', () => {
      const totals = dailyMacroTotals([
        { logged_at: '2026-11-09', meal_type: 'breakfast', food_name: 'Oats', serving_size: null, servings: 1, calories: 300, protein: 10, carbs: 50, fat: 5 },
        { logged_at: '2026-11-09', meal_type: 'lunch', food_name: 'Rice', serving_size: null, servings: 1, calories: 200, protein: null, carbs: 44, fat: null },
        { logged_at: '2026-11-10', meal_type: 'lunch', food_name: 'Egg', serving_size: null, servings: 2, calories: 140, protein: 12, carbs: 1, fat: 10 },
      ]);
      expect(totals.get('2026-11-09')).toEqual({ calories: 500, protein: 10, carbs: 94, fat: 5, entries: 2 });
      expect(totals.get('2026-11-10')?.entries).toBe(1);
    });
  });

  it('mean ignores missing values and returns null for none', () => {
    expect(mean([1, null, 3, undefined])).toBe(2);
    expect(mean([null, undefined])).toBeNull();
  });
});

describe('safePostLoginPath', () => {
  it('accepts only a same-origin consent path', () => {
    expect(safePostLoginPath('/oauth/consent?authorization_id=abc')).toBe('/oauth/consent?authorization_id=abc');
  });

  it('rejects anything that could redirect elsewhere', () => {
    expect(safePostLoginPath(null)).toBeNull();
    expect(safePostLoginPath('/dashboard')).toBeNull();
    expect(safePostLoginPath('//evil.example/oauth/consent?x=1')).toBeNull();
    expect(safePostLoginPath('https://evil.example/oauth/consent?x=1')).toBeNull();
    expect(safePostLoginPath('/oauth/consent?next=https://evil.example')).toBeNull();
    expect(safePostLoginPath('/oauth/consent')).toBeNull();
  });
});
