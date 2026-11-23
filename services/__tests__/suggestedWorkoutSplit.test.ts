/** Push/pull/legs: detect the rotation from recent sessions and follow it. */
import {
  buildSuggestedWorkout,
  classifySessionDay,
  detectSplitDay,
  type SuggestedExerciseInput,
  type SuggestedMuscleInput,
} from '@/services/suggestedWorkout';
import type { StandardMuscleGroup } from '@/types/schema';

const PUSH: StandardMuscleGroup[] = ['chest_upper', 'front_delts', 'triceps'];
const PULL: StandardMuscleGroup[] = ['lats', 'upper_back', 'biceps'];
const LEGS: StandardMuscleGroup[] = ['quads', 'hamstrings', 'calves'];

describe('classifySessionDay', () => {
  it('names a session by the day most of its exercises belong to', () => {
    expect(classifySessionDay(PUSH)).toBe('push');
    expect(classifySessionDay([...LEGS, 'abs'])).toBe('legs'); // core is neutral
  });
  it('calls a mixed session nothing', () => {
    expect(classifySessionDay(['chest_upper', 'quads', 'lats'])).toBeNull();
    expect(classifySessionDay(['abs'])).toBeNull();
  });
});

describe('detectSplitDay', () => {
  it('returns the day done longest ago when the last three are push, pull and legs', () => {
    // Most recent first: legs, pull, push → push is next.
    expect(detectSplitDay([LEGS, PULL, PUSH])).toBe('push');
    expect(detectSplitDay([PUSH, LEGS, PULL, PUSH])).toBe('pull');
  });
  it('finds no split for full-body, upper/lower or too little history', () => {
    const full: StandardMuscleGroup[] = ['chest_upper', 'quads', 'lats'];
    expect(detectSplitDay([full, full, full])).toBeNull();
    expect(detectSplitDay([PUSH, PULL])).toBeNull();
    expect(detectSplitDay([PUSH, PUSH, LEGS])).toBeNull();
  });
});

describe('buildSuggestedWorkout with a split day', () => {
  const ex = (id: string, primaryMuscle: string): SuggestedExerciseInput => ({ id, name: id, primaryMuscle, tier: 'A', mechanic: 'compound' });
  const exercises = [ex('row', 'lats'), ex('curl', 'biceps'), ex('bench', 'chest_upper'), ex('squat', 'quads'), ex('crunch', 'abs')];
  const muscle = (m: StandardMuscleGroup, weeklySets: number): SuggestedMuscleInput => ({ muscle: m, recoveryStatus: 'ready', weeklySets, targetSets: 10 });
  // Quads and chest are furthest behind, but today is a pull day.
  const muscles = [muscle('quads', 0), muscle('chest_upper', 0), muscle('lats', 4), muscle('biceps', 5), muscle('abs', 6)];

  it('keeps the session to the pull day (plus core) and says so', () => {
    const plan = buildSuggestedWorkout({ muscles, exercises, recentExerciseIds: [], splitDay: 'pull' });
    const ids = plan.exercises.map((p) => p.exerciseId);
    expect(ids).toEqual(expect.arrayContaining(['row', 'curl']));
    expect(ids).not.toContain('squat');
    expect(ids).not.toContain('bench');
    expect(plan.splitDay).toBe('pull');
    expect(plan.focus).toMatch(/^Pull day, next in your push\/pull\/legs rotation\./);
  });

  it('ignores the split when nothing on that day is under target', () => {
    const done = [muscle('quads', 0), muscle('lats', 12), muscle('biceps', 12)];
    const plan = buildSuggestedWorkout({ muscles: done, exercises, recentExerciseIds: [], splitDay: 'pull' });
    expect(plan.exercises.map((p) => p.exerciseId)).toContain('squat');
    expect(plan.splitDay).toBeUndefined();
  });
});
