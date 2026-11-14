import { readTrainingStylePreference, resolveTrainingStyle } from '../trainingStyle';

const workouts = (fromPlan: boolean[]) => ({ recentFromPlan: fromPlan });

describe('resolveTrainingStyle', () => {
  it('an explicit choice always wins', () => {
    expect(resolveTrainingStyle({ preference: 'plan', ...workouts(Array(10).fill(false)) })).toBe('plan');
    expect(resolveTrainingStyle({ preference: 'freestyle', ...workouts(Array(10).fill(true)) })).toBe(
      'freestyle'
    );
  });

  it('infers freestyle when recent workouts rarely come from a plan', () => {
    // The production pattern: 1 of the last 15 claimed for a plan, rest empty.
    const recent = [...Array(9).fill(false), true, ...Array(5).fill(false)];
    expect(resolveTrainingStyle(workouts(recent))).toBe('freestyle');
    expect(resolveTrainingStyle({ preference: 'auto', ...workouts(Array(3).fill(false)) })).toBe(
      'freestyle'
    );
  });

  it('keeps plan for someone who trains from their plan', () => {
    expect(resolveTrainingStyle(workouts([true, false, true, true, false]))).toBe('plan');
  });

  it('only looks at the most recent window', () => {
    // Followed a plan long ago, freestyle for the last 10.
    expect(resolveTrainingStyle(workouts([...Array(10).fill(false), ...Array(20).fill(true)]))).toBe(
      'freestyle'
    );
  });

  it('defaults to plan with too little history to tell', () => {
    expect(resolveTrainingStyle(workouts([]))).toBe('plan');
    expect(resolveTrainingStyle(workouts([false, false]))).toBe('plan');
  });
});

describe('readTrainingStylePreference', () => {
  it('reads plan/freestyle and treats anything else as auto', () => {
    expect(readTrainingStylePreference({ trainingStyle: 'plan' })).toBe('plan');
    expect(readTrainingStylePreference({ trainingStyle: 'freestyle' })).toBe('freestyle');
    expect(readTrainingStylePreference({ trainingStyle: 'nonsense' })).toBe('auto');
    expect(readTrainingStylePreference({})).toBe('auto');
    expect(readTrainingStylePreference(null)).toBe('auto');
  });
});
