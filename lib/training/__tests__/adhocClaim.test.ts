import { matchAdhocToPlannedSession } from '../adhocClaim';

const push = [
  { exerciseName: 'Barbell Bench Press', primaryMuscle: 'chest' },
  { exerciseName: 'Overhead Press', primaryMuscle: 'shoulders' },
  { exerciseName: 'Cable Fly', primaryMuscle: 'chest' },
  { exerciseName: 'Triceps Pushdown', primaryMuscle: 'triceps' },
];

describe('matchAdhocToPlannedSession', () => {
  it('never matches an empty workout or an empty plan', () => {
    expect(matchAdhocToPlannedSession([], push).isMatch).toBe(false);
    expect(
      matchAdhocToPlannedSession(
        [{ name: 'Squat', primaryMuscle: 'quads' }],
        []
      ).isMatch
    ).toBe(false);
  });

  it('matches on muscle coverage even with entirely different exercise choices', () => {
    // Same Push muscles, zero shared exercise names
    const logged = [
      { name: 'Dumbbell Incline Press', primaryMuscle: 'chest' },
      { name: 'Machine Shoulder Press', primaryMuscle: 'shoulders' },
      { name: 'Skull Crusher', primaryMuscle: 'triceps' },
    ];
    const result = matchAdhocToPlannedSession(logged, push);
    expect(result.isMatch).toBe(true);
    expect(result.muscleCoverage).toBe(1);
    expect(result.nameMatches).toBe(0);
  });

  it('does not match a different training day', () => {
    // Legs workout vs the planned Push day
    const logged = [
      { name: 'Back Squat', primaryMuscle: 'quads' },
      { name: 'Romanian Deadlift', primaryMuscle: 'hamstrings' },
      { name: 'Leg Press', primaryMuscle: 'quads' },
    ];
    const result = matchAdhocToPlannedSession(logged, push);
    expect(result.isMatch).toBe(false);
    expect(result.muscleCoverage).toBe(0);
  });

  it('does not match on a single shared muscle group below the coverage threshold', () => {
    // Only chest of the 3 planned muscle groups → 1/3 coverage
    const logged = [{ name: 'Push-Up', primaryMuscle: 'chest' }];
    const result = matchAdhocToPlannedSession(logged, push);
    expect(result.isMatch).toBe(false);
    expect(result.muscleCoverage).toBeCloseTo(1 / 3);
  });

  it('matches on exercise-name overlap even when a muscle group was skipped', () => {
    // Ran 2 of the program's exact exercises but skipped shoulders and
    // triceps → 1/3 muscle coverage, but the names are a strong signal.
    const logged = [
      { name: 'barbell bench press', primaryMuscle: 'chest' },
      { name: 'CABLE FLY', primaryMuscle: 'chest' },
    ];
    const result = matchAdhocToPlannedSession(logged, push);
    expect(result.isMatch).toBe(true);
    expect(result.nameMatches).toBe(2);
  });

  it('requires only one name match for a single-exercise session', () => {
    const planned = [{ exerciseName: 'Deadlift', primaryMuscle: 'back' }];
    const logged = [{ name: 'Deadlift', primaryMuscle: 'back' }];
    expect(matchAdhocToPlannedSession(logged, planned).isMatch).toBe(true);
  });

  it('compares muscles case-insensitively', () => {
    const planned = [
      { exerciseName: 'Bench', primaryMuscle: 'Chest' },
      { exerciseName: 'OHP', primaryMuscle: 'Shoulders' },
    ];
    const logged = [
      { name: 'Incline Press', primaryMuscle: 'chest' },
      { name: 'Lateral Raise', primaryMuscle: 'shoulders' },
    ];
    const result = matchAdhocToPlannedSession(logged, planned);
    expect(result.isMatch).toBe(true);
    expect(result.muscleCoverage).toBe(1);
  });

  it('matches at exactly 50% muscle coverage (spec boundary)', () => {
    // 1 of the 2 planned muscle groups trained → 0.5 coverage, prompt-worthy.
    const planned = [
      { exerciseName: 'Bench', primaryMuscle: 'chest' },
      { exerciseName: 'OHP', primaryMuscle: 'shoulders' },
    ];
    const logged = [{ name: 'Incline Dumbbell Press', primaryMuscle: 'chest' }];
    const result = matchAdhocToPlannedSession(logged, planned);
    expect(result.muscleCoverage).toBe(0.5);
    expect(result.isMatch).toBe(true);
  });

  it('is not fooled by extra logged exercises (coverage is of the PLAN)', () => {
    // A long full-body workout that happens to include chest work should
    // still match a Push day only if it covers the planned muscles.
    const logged = [
      { name: 'Bench Press', primaryMuscle: 'chest' },
      { name: 'Squat', primaryMuscle: 'quads' },
      { name: 'Row', primaryMuscle: 'back' },
      { name: 'Curl', primaryMuscle: 'biceps' },
    ];
    const result = matchAdhocToPlannedSession(logged, push);
    // chest only → 1/3 planned muscles, 0-1 name matches
    expect(result.isMatch).toBe(false);
  });
});
