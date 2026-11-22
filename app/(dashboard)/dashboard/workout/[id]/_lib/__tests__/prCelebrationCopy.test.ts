import { prCelebrationCopy } from '../prCelebrationCopy';

const fmt = (kg: number) => `${Math.round(kg * 2.20462)} lbs`;

describe('prCelebrationCopy', () => {
  it('e1RM PR leads with plain words and keeps the term as a tag', () => {
    const copy = prCelebrationCopy({ type: 'e1rm', value: 100, improvement: 4 }, fmt);
    expect(copy.title).toBe('New strength record');
    expect(copy.title).not.toMatch(/e1RM/);
    expect(copy.detail).toBe('Est. 1-rep max (e1RM) 220 lbs · +4%');
  });

  it('weight, reps and hold records read plainly', () => {
    expect(prCelebrationCopy({ type: 'weight', value: 100, improvement: 0 }, fmt)).toEqual({
      title: 'New weight record',
      detail: 'Heaviest yet: 220 lbs',
    });
    expect(prCelebrationCopy({ type: 'reps', value: 12, improvement: 2 }, fmt)).toEqual({
      title: 'New reps record',
      detail: '12 reps · +2',
    });
    expect(prCelebrationCopy({ type: 'duration', value: 60, improvement: 5 }, fmt)).toEqual({
      title: 'New hold record',
      detail: '60s · +5s',
    });
  });
});
