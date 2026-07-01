import {
  computeStapleExerciseIds,
  isDefaultVisibleExercise,
  DEFAULT_STAPLES_PER_MUSCLE,
} from '@/services/exerciseStaples';

describe('computeStapleExerciseIds', () => {
  it('picks the top-tier exercises within each muscle group', () => {
    const exercises = [
      { id: 'chest-s', muscle: 'chest', tier: 'S' },
      { id: 'chest-c', muscle: 'chest', tier: 'C' },
      { id: 'chest-f', muscle: 'chest', tier: 'F' },
      { id: 'back-a', muscle: 'back', tier: 'A' },
      { id: 'back-d', muscle: 'back', tier: 'D' },
    ];
    const staples = computeStapleExerciseIds(exercises, 1);
    // Best per muscle only (perMuscle = 1)
    expect(staples.has('chest-s')).toBe(true);
    expect(staples.has('back-a')).toBe(true);
    expect(staples.has('chest-c')).toBe(false);
    expect(staples.has('back-d')).toBe(false);
    expect(staples.size).toBe(2);
  });

  it('treats a missing tier as the default mid tier (C)', () => {
    const exercises = [
      { id: 'has-b', muscle: 'quads', tier: 'B' },
      { id: 'no-tier', muscle: 'quads' },
      { id: 'has-d', muscle: 'quads', tier: 'D' },
    ];
    // perMuscle = 2 should surface the B (better) and the untiered (C) over D
    const staples = computeStapleExerciseIds(exercises, 2);
    expect(staples.has('has-b')).toBe(true);
    expect(staples.has('no-tier')).toBe(true);
    expect(staples.has('has-d')).toBe(false);
  });

  it('is case-insensitive for muscle and tier', () => {
    const exercises = [
      { id: 'a', muscle: 'Chest', tier: 's' },
      { id: 'b', muscle: 'CHEST', tier: 'c' },
    ];
    const staples = computeStapleExerciseIds(exercises, 1);
    // Both normalize to the same muscle; only the S-tier one survives
    expect(staples.has('a')).toBe(true);
    expect(staples.has('b')).toBe(false);
  });

  it('defaults to DEFAULT_STAPLES_PER_MUSCLE when count is omitted', () => {
    const exercises = Array.from({ length: 10 }, (_, i) => ({
      id: `chest-${i}`,
      muscle: 'chest',
      tier: 'C',
    }));
    const staples = computeStapleExerciseIds(exercises);
    expect(staples.size).toBe(DEFAULT_STAPLES_PER_MUSCLE);
  });
});

describe('isDefaultVisibleExercise', () => {
  const staples = new Set(['staple-1']);

  it('shows staples', () => {
    expect(isDefaultVisibleExercise('staple-1', staples)).toBe(true);
  });

  it('shows exercises the user has performed (usage count > 0)', () => {
    const usage = new Map([['used-1', 3]]);
    expect(isDefaultVisibleExercise('used-1', staples, usage)).toBe(true);
  });

  it('shows exercises with a recorded last-done date', () => {
    const lastDone = new Map<string, Date>([['recent-1', new Date(0)]]);
    expect(isDefaultVisibleExercise('recent-1', staples, undefined, lastDone)).toBe(true);
  });

  it('hides exercises that are neither staples nor used', () => {
    const usage = new Map([['used-1', 0]]); // zero usage should not count
    expect(isDefaultVisibleExercise('rare-1', staples, usage)).toBe(false);
    expect(isDefaultVisibleExercise('used-1', staples, usage)).toBe(false);
  });
});
