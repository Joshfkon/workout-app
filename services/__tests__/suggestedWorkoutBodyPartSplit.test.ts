/** Body-part split: detect it from completed sessions and follow it like PPL. */
import {
  buildSuggestedWorkout,
  classifySessionDay,
  detectSplit,
  detectSplitDay,
  splitDayOfMuscle,
  type SuggestedExerciseInput,
  type SuggestedMuscleInput,
} from '@/services/suggestedWorkout';
import type { StandardMuscleGroup } from '@/types/schema';

const CHEST: StandardMuscleGroup[] = ['chest_upper', 'chest_upper', 'chest_lower'];
const BACK: StandardMuscleGroup[] = ['lats', 'lats', 'upper_back'];
const LEGS: StandardMuscleGroup[] = ['quads', 'hamstrings', 'hamstrings', 'quads', 'calves'];
const SHOULDERS: StandardMuscleGroup[] = ['front_delts', 'lateral_delts', 'rear_delts'];
const ARMS: StandardMuscleGroup[] = ['biceps', 'biceps', 'triceps', 'triceps'];

const PUSH: StandardMuscleGroup[] = ['chest_upper', 'front_delts', 'triceps'];
const PULL: StandardMuscleGroup[] = ['lats', 'upper_back', 'biceps'];
const PPL_LEGS: StandardMuscleGroup[] = ['quads', 'hamstrings', 'calves'];

describe('body-part session classification', () => {
  it('names a session by the region that dominates it', () => {
    expect(classifySessionDay(CHEST, 'body_part')).toBe('chest');
    expect(classifySessionDay(ARMS, 'body_part')).toBe('arms');
    expect(classifySessionDay([...SHOULDERS, 'abs'], 'body_part')).toBe('shoulders'); // core is neutral
    expect(splitDayOfMuscle('lateral_delts', 'body_part')).toBe('shoulders');
    expect(splitDayOfMuscle('abs', 'body_part')).toBeNull();
  });
  it('calls a PPL push day nothing (no one region dominates)', () => {
    expect(classifySessionDay(PUSH, 'body_part')).toBeNull();
  });
  it('keeps the default (push/pull/legs) classification', () => {
    expect(classifySessionDay(PUSH)).toBe('push');
    expect(splitDayOfMuscle('lateral_delts')).toBe('push');
  });
});

describe('detectSplit', () => {
  it('detects a body-part split and picks the day done longest ago', () => {
    // Most recent first: arms, chest, back, legs → shoulders was longest ago.
    expect(detectSplit([ARMS, CHEST, BACK, LEGS, SHOULDERS])).toEqual({ kind: 'body_part', day: 'shoulders' });
    // Order of the week doesn't matter, only which day is oldest.
    expect(detectSplit([SHOULDERS, LEGS, BACK, CHEST, ARMS, SHOULDERS])).toEqual({ kind: 'body_part', day: 'arms' });
  });

  it('prefers the body-part reading when its last three days also look like PPL', () => {
    // chest, back, legs alone reads as push, pull, legs …
    expect(detectSplitDay([LEGS, BACK, CHEST])).toBe('push');
    // … but with the full five-day turn it's the body-part split.
    expect(detectSplit([LEGS, BACK, CHEST, ARMS, SHOULDERS])).toEqual({ kind: 'body_part', day: 'shoulders' });
  });

  it('leaves push/pull/legs unchanged', () => {
    expect(detectSplit([PPL_LEGS, PULL, PUSH])).toEqual({ kind: 'ppl', day: 'push' });
    expect(detectSplit([PUSH, PPL_LEGS, PULL, PUSH, PPL_LEGS])).toEqual({ kind: 'ppl', day: 'pull' });
    expect(detectSplitDay([PPL_LEGS, PULL, PUSH])).toBe('push');
  });

  it('finds nothing for a repeated day, a mixed session or too little history', () => {
    expect(detectSplit([ARMS, CHEST, BACK, CHEST, SHOULDERS])).toBeNull();
    expect(detectSplit([ARMS, CHEST, BACK, ['chest_upper', 'quads', 'lats'], SHOULDERS])).toBeNull();
    expect(detectSplit([ARMS, CHEST])).toBeNull();
  });
});

describe('buildSuggestedWorkout following a body-part split', () => {
  const ex = (id: string, primaryMuscle: string, mechanic: 'compound' | 'isolation' = 'compound'): SuggestedExerciseInput => ({
    id,
    name: id,
    primaryMuscle,
    tier: 'A',
    mechanic,
  });
  const exercises = [
    ex('ohp', 'front_delts'),
    ex('lateral', 'lateral_delts', 'isolation'),
    ex('reardelt', 'rear_delts', 'isolation'),
    ex('calf', 'calves', 'isolation'),
    ex('hipthrust', 'glutes'),
    ex('crunch', 'abs', 'isolation'),
    ex('bench', 'chest_upper'),
    ex('curl', 'biceps', 'isolation'),
  ];
  const muscle = (m: StandardMuscleGroup, weeklySets: number): SuggestedMuscleInput => ({
    muscle: m,
    recoveryStatus: 'ready',
    weeklySets,
    targetSets: 10,
  });
  // Calves and glutes are furthest behind (the panel's "calves, side delts,
  // abs and glutes" Full Body pick), but today is shoulders day.
  const muscles = [
    muscle('calves', 0),
    muscle('glutes', 0),
    muscle('lateral_delts', 3),
    muscle('rear_delts', 4),
    muscle('front_delts', 6),
    muscle('abs', 5),
    muscle('chest_upper', 2),
    muscle('biceps', 2),
  ];

  it('keeps the session to shoulders (plus core) and says so', () => {
    const split = detectSplit([ARMS, CHEST, BACK, LEGS, SHOULDERS]);
    const plan = buildSuggestedWorkout({ muscles, exercises, recentExerciseIds: [], split });
    const ids = plan.exercises.map((p) => p.exerciseId);
    expect(ids).toEqual(expect.arrayContaining(['lateral', 'reardelt', 'ohp']));
    for (const off of ['calf', 'hipthrust', 'bench', 'curl']) expect(ids).not.toContain(off);
    expect(plan.split).toEqual({ kind: 'body_part', day: 'shoulders' });
    expect(plan.splitDay).toBeUndefined(); // PPL-only field
    expect(plan.focus).toMatch(/^Shoulders day, next in your body-part split\./);
  });

  it('ignores the split when nothing in that region is under target', () => {
    const done = muscles.map((m) =>
      ['lateral_delts', 'rear_delts', 'front_delts'].includes(m.muscle) ? { ...m, weeklySets: 12 } : m
    );
    const plan = buildSuggestedWorkout({
      muscles: done,
      exercises,
      recentExerciseIds: [],
      split: { kind: 'body_part', day: 'shoulders' },
    });
    expect(plan.exercises.map((p) => p.exerciseId)).toContain('calf');
    expect(plan.split).toBeUndefined();
  });

  it('PPL via split behaves exactly like the legacy splitDay input', () => {
    const viaSplit = buildSuggestedWorkout({ muscles, exercises, recentExerciseIds: [], split: { kind: 'ppl', day: 'pull' } });
    const viaDay = buildSuggestedWorkout({ muscles, exercises, recentExerciseIds: [], splitDay: 'pull' });
    expect(viaSplit).toEqual(viaDay);
    expect(viaDay.splitDay).toBe('pull');
    expect(viaDay.focus).toMatch(/^Pull day, next in your push\/pull\/legs rotation\./);
  });
});
