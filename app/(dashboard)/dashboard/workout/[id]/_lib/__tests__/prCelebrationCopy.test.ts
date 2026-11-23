import { prCelebrationCopy } from '../prCelebrationCopy';

const fmt = (kg: number) => `${Math.round(kg * 2.20462)} lbs`;

describe('prCelebrationCopy', () => {
  it('e1RM PR names the set and the estimate it beat', () => {
    const copy = prCelebrationCopy(
      { type: 'e1rm', value: 100, improvement: 4, previous: 96 },
      fmt,
      { set: { weightKg: 75, repCount: 10 } }
    );
    expect(copy.title).toBe('New strength record');
    expect(copy.title).not.toMatch(/e1RM/);
    expect(copy.detail).toBe('165 lbs × 10 → est. 1-rep max (e1RM) 220 lbs (was 212 lbs)');
  });

  it('works without the set', () => {
    expect(prCelebrationCopy({ type: 'e1rm', value: 100, improvement: 4, previous: 96 }, fmt).detail).toBe(
      'est. 1-rep max (e1RM) 220 lbs (was 212 lbs)'
    );
  });

  it('weight, reps and hold records say what they beat', () => {
    expect(prCelebrationCopy({ type: 'weight', value: 100, improvement: 2, previous: 98 }, fmt)).toEqual({
      title: 'New weight record',
      detail: 'Heaviest yet: 220 lbs (was 216 lbs)',
    });
    expect(prCelebrationCopy({ type: 'reps', value: 12, improvement: 2, previous: 10 }, fmt)).toEqual({
      title: 'New reps record',
      detail: '12 reps (was 10)',
    });
    expect(prCelebrationCopy({ type: 'duration', value: 60, improvement: 5, previous: 55 }, fmt)).toEqual({
      title: 'New hold record',
      detail: '60s (was 55s)',
    });
  });
});
