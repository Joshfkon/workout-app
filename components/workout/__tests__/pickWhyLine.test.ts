/** Each suggested lift says why it's there and where its first weight comes from. */
import { pickWhyLine } from '../SuggestedWorkoutSheet';

const rec = (over: Record<string, unknown>) =>
  ({ recommendedWeight: 29.5, confidence: 'medium', transferFrom: undefined, estimateSource: 'strength_standards', ...over }) as never;

describe('pickWhyLine', () => {
  it('a lift done recently starts from the last sets', () => {
    expect(pickWhyLine({ isRecent: true, muscleLabel: 'Chest', rec: null, units: 'lb' })).toBe(
      'You’ve done this recently — weights start from your last sets.'
    );
  });

  it('names the local day it was last done, so "recently" is checkable', () => {
    const now = new Date(2026, 10, 23, 9, 0); // Mon, Nov 23 2026, local
    const line = (at: Date) =>
      pickWhyLine({ isRecent: true, lastDoneAt: at, muscleLabel: 'Chest', rec: null, units: 'lb', now });
    expect(line(new Date(2026, 10, 17, 18, 30))).toBe(
      'You did this on Tue, Nov 17 — weights start from your last sets.'
    );
    expect(line(new Date(2026, 10, 22, 23, 50))).toBe('You did this yesterday — weights start from your last sets.');
    expect(line(new Date(2026, 10, 23, 6, 0))).toBe('You did this today — weights start from your last sets.');
    expect(line(new Date(2025, 11, 30, 12, 0))).toBe(
      'You did this on Tue, Dec 30, 2025 — weights start from your last sets.'
    );
  });

  it('with the last session\'s best set, shows it so the progression is visible', () => {
    const now = new Date(2026, 10, 23, 9, 0);
    expect(
      pickWhyLine({
        isRecent: true,
        lastDoneAt: new Date(2026, 10, 16, 18, 0),
        lastTopSet: { weightKg: 83.91, repCount: 10 },
        muscleLabel: 'Chest',
        rec: null,
        units: 'lb',
        now,
      })
    ).toBe('Last time (Mon, Nov 16): best set 185 lbs × 10. Today’s target builds on it.');
    expect(
      pickWhyLine({ isRecent: true, lastDoneAt: new Date(2026, 10, 22, 18, 0), lastTopSet: { weightKg: 60, repCount: 8 }, muscleLabel: 'Chest', rec: null, units: 'kg', now })
    ).toBe('Last time (yesterday): best set 60 kg × 8. Today’s target builds on it.');
  });

  it('topWorkingSet: heaviest working set, warmups skipped, none for duration lifts', () => {
    const { topWorkingSet } = jest.requireActual('../SuggestedWorkoutSheet');
    const sets = [
      { weight_kg: 100, reps: 5, is_warmup: true },
      { weight_kg: 80, reps: 10 },
      { weight_kg: 80, reps: 11 },
      { weight_kg: 75, reps: 12, set_type: 'normal' },
    ];
    expect(topWorkingSet(sets, { exerciseType: null })).toEqual({ weightKg: 80, repCount: 11 });
    expect(topWorkingSet(sets, { exerciseType: 'duration_based' })).toBeNull();
    expect(topWorkingSet([], null)).toBeNull();
  });

  it('a new lift names what its starting weight is estimated from', () => {
    expect(pickWhyLine({ isRecent: false, muscleLabel: 'Side Delts', rec: rec({ transferFrom: 'Barbell Bench Press' }), units: 'lb' })).toMatch(
      /^New to you — a top side delts pick for your equipment\. Starts at ~6\d(\.\d)? lbs?, estimated from your Barbell Bench Press\.$/
    );
    expect(pickWhyLine({ isRecent: false, muscleLabel: 'Triceps', rec: rec({}), units: 'kg' })).toContain(
      'estimated from typical strength for your experience and bodyweight'
    );
  });

  it('says the first set finds the weight when there is no estimate', () => {
    expect(pickWhyLine({ isRecent: false, muscleLabel: 'Abs', rec: rec({ confidence: 'find_working_weight', recommendedWeight: 0 }), units: 'lb' })).toBe(
      'New to you — a top abs pick for your equipment. You’ll find your starting weight on the first set.'
    );
  });
});

describe('capToLocationDumbbells', () => {
  const { capToLocationDumbbells } = jest.requireActual('../SuggestedWorkoutSheet');
  it('caps a dumbbell lift at the location heaviest dumbbell, and leaves others alone', () => {
    expect(capToLocationDumbbells(30, { name: 'Dumbbell Bench Press', equipment_required: ['dumbbells'] }, 20)).toBe(20);
    expect(capToLocationDumbbells(30, { name: 'Barbell Row', equipment_required: ['barbell'] }, 20)).toBe(30);
    expect(capToLocationDumbbells(30, { name: 'Dumbbell Curl', equipment_required: null }, null)).toBe(30);
  });
});
