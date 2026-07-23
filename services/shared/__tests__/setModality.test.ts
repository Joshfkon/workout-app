import {
  isDurationExercise,
  getSetDuration,
  getSetReps,
  getTargetRange,
  formatSetCount,
  formatTargetRange,
} from '../setModality';

const repExercise = { exerciseType: 'rep_based' as const };
const durationExercise = { exerciseType: 'duration_based' as const };

describe('isDurationExercise', () => {
  it('is true only for duration_based', () => {
    expect(isDurationExercise(durationExercise)).toBe(true);
    expect(isDurationExercise(repExercise)).toBe(false);
  });

  it('treats absent/undefined/null modality as rep_based', () => {
    expect(isDurationExercise({})).toBe(false);
    expect(isDurationExercise({ exerciseType: undefined })).toBe(false);
    expect(isDurationExercise({ exerciseType: null })).toBe(false);
    expect(isDurationExercise(null)).toBe(false);
    expect(isDurationExercise(undefined)).toBe(false);
  });
});

describe('getSetDuration / getSetReps', () => {
  const set = { reps: 45 };

  it('resolves the overloaded reps field by modality', () => {
    expect(getSetDuration(set, durationExercise)).toBe(45);
    expect(getSetReps(set, durationExercise)).toBeNull();

    expect(getSetDuration(set, repExercise)).toBeNull();
    expect(getSetReps(set, repExercise)).toBe(45);
  });

  it('defaults to rep semantics when the exercise is unknown', () => {
    expect(getSetReps(set, undefined)).toBe(45);
    expect(getSetDuration(set, undefined)).toBeNull();
  });
});

describe('getTargetRange', () => {
  it('labels the unit from modality', () => {
    expect(getTargetRange([30, 60], durationExercise)).toEqual({ min: 30, max: 60, unit: 'seconds' });
    expect(getTargetRange([8, 12], repExercise)).toEqual({ min: 8, max: 12, unit: 'reps' });
  });
});

describe('formatters', () => {
  it('formats set counts with an s suffix for duration', () => {
    expect(formatSetCount({ reps: 45 }, durationExercise)).toBe('45s');
    expect(formatSetCount({ reps: 12 }, repExercise)).toBe('12');
  });

  it('formats target ranges', () => {
    expect(formatTargetRange([30, 60], durationExercise)).toBe('30–60s');
    expect(formatTargetRange([8, 12], repExercise)).toBe('8–12');
    expect(formatTargetRange([30, 30], durationExercise)).toBe('30s');
  });
});
