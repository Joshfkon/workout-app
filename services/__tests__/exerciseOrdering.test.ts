/**
 * exerciseOrdering — the Auto-arrange algorithm. Hard constraints (compounds
 * first, grip work after everything it would compromise), greedy overlap
 * interleaving on the canonical credit vectors, and full determinism.
 */

import {
  autoArrangeExercises,
  isCompoundExercise,
  isGripDependentExercise,
  isGripIntensiveExercise,
  muscleOverlap,
  orderChanged,
  type OrderableExercise,
} from '@/services/exerciseOrdering';

const ex = (
  id: string,
  name: string,
  primaryMuscle: string | null,
  secondaryMuscles: string[] = [],
  mechanic: 'compound' | 'isolation' | null = null,
  movementPattern: string | null = null
): OrderableExercise => ({ id, name, primaryMuscle, secondaryMuscles, mechanic, movementPattern });

const BENCH = ex('bench', 'Bench Press', 'chest_upper', ['front_delts', 'triceps'], 'compound', 'horizontal_push');
const INCLINE = ex('incline', 'Incline Press', 'chest_upper', ['front_delts', 'triceps'], 'compound', 'horizontal_push');
const ROW = ex('row', 'Barbell Row', 'lats', ['biceps', 'upper_back'], 'compound', 'horizontal_pull');
const PULLDOWN = ex('pulldown', 'Lat Pulldown', 'lats', ['biceps'], 'compound', 'vertical_pull');
const SQUAT = ex('squat', 'Back Squat', 'quads', ['glutes', 'erectors'], 'compound', 'squat');
const CURL = ex('curl', 'Barbell Curl', 'biceps', ['forearms'], 'isolation', 'elbow_flexion');
const PUSHDOWN = ex('pushdown', 'Triceps Pushdown', 'triceps', [], 'isolation', 'elbow_extension');
const LATERAL = ex('lateral', 'Lateral Raise', 'lateral_delts', [], 'isolation', 'shoulder_isolation');
const WRIST_CURL = ex('wrist', 'Wrist Curl', 'forearms', [], 'isolation', 'isolation_wrist_flexion');

const arrange = (items: OrderableExercise[]) =>
  autoArrangeExercises(items, (i) => i).map((i) => i.id);

describe('classification helpers', () => {
  it('mechanic decides compound/isolation when present', () => {
    expect(isCompoundExercise(BENCH)).toBe(true);
    expect(isCompoundExercise(CURL)).toBe(false);
  });

  it('falls back to the movement pattern, and defaults untyped to isolation', () => {
    expect(isCompoundExercise(ex('a', 'A', 'quads', [], null, 'hip_hinge'))).toBe(true);
    expect(isCompoundExercise(ex('b', 'B', 'quads', [], null, 'knee_flexion'))).toBe(false);
    expect(isCompoundExercise(ex('c', 'C', 'quads'))).toBe(false);
  });

  it('flags forearm work as grip-intensive, pulls/hinges/curls as grip-dependent', () => {
    expect(isGripIntensiveExercise(WRIST_CURL)).toBe(true);
    expect(isGripIntensiveExercise(ROW)).toBe(false);
    expect(isGripDependentExercise(ROW)).toBe(true);
    expect(isGripDependentExercise(ex('dl', 'Deadlift', 'erectors', [], 'compound', 'hip_hinge'))).toBe(true);
    expect(isGripDependentExercise(CURL)).toBe(true); // holds a loaded bar
    expect(isGripDependentExercise(BENCH)).toBe(false);
    // Grip-intensive work never blocks itself.
    expect(isGripDependentExercise(WRIST_CURL)).toBe(false);
  });
});

describe('muscleOverlap', () => {
  it('is Σ min over shared muscles, 0 for disjoint vectors', () => {
    expect(muscleOverlap({ biceps: 1, forearms: 0.5 }, { biceps: 0.5 })).toBeCloseTo(0.5);
    expect(muscleOverlap({ biceps: 1 }, { triceps: 1 })).toBe(0);
  });
});

describe('autoArrangeExercises', () => {
  it('is deterministic: the same input always yields the same order', () => {
    const input = [CURL, BENCH, WRIST_CURL, ROW, LATERAL, SQUAT, PUSHDOWN];
    const first = arrange(input);
    const second = arrange(input);
    expect(second).toEqual(first);
  });

  it('does not mutate the input array', () => {
    const input = [CURL, BENCH, ROW];
    const before = [...input];
    autoArrangeExercises(input, (i) => i);
    expect(input).toEqual(before);
  });

  it('places every compound before every isolation exercise', () => {
    const order = arrange([CURL, LATERAL, BENCH, PUSHDOWN, ROW, SQUAT]);
    const compoundIds = new Set(['bench', 'row', 'squat']);
    const lastCompound = Math.max(...order.map((id, i) => (compoundIds.has(id) ? i : -1)));
    const firstIsolation = order.findIndex((id) => !compoundIds.has(id));
    expect(lastCompound).toBeLessThan(firstIsolation);
  });

  it('holds grip-intensive work until after everything it would compromise', () => {
    const order = arrange([WRIST_CURL, ROW, CURL]);
    expect(order).toEqual(['row', 'curl', 'wrist']);
  });

  it('interleaves muscle groups instead of stacking same-muscle exercises', () => {
    const order = arrange([BENCH, INCLINE, ROW, PULLDOWN]);
    // Chest and back alternate: overlap with the previous pick is always 0.
    expect(order).toEqual(['row', 'bench', 'pulldown', 'incline']);
  });

  it('pairs antagonists among isolations', () => {
    const curl2 = ex('curl2', 'Hammer Curl', 'biceps', ['forearms'], 'isolation', 'elbow_flexion');
    const pushdown2 = ex('pushdown2', 'Overhead Extension', 'triceps', [], 'isolation', 'elbow_extension');
    const order = arrange([CURL, curl2, PUSHDOWN, pushdown2]);
    for (let i = 1; i < order.length; i++) {
      const prevIsCurl = order[i - 1].startsWith('curl');
      const curIsCurl = order[i].startsWith('curl');
      expect(curIsCurl).not.toBe(prevIsCurl);
    }
  });

  it('opens with the biggest lift and breaks exact ties by name', () => {
    // Equal credit mass (2.0 each) — the alphabetically-first name opens.
    const order = arrange([BENCH, ROW]);
    expect(order[0]).toBe('row'); // 'Barbell Row' < 'Bench Press'
  });

  it('handles missing metadata without crashing, deterministically', () => {
    const mystery = ex('mystery', 'Mystery Machine', null);
    const first = arrange([mystery, BENCH, CURL]);
    const second = arrange([mystery, BENCH, CURL]);
    expect(first).toEqual(second);
    // Untagged/untyped reads as isolation → after the compound.
    expect(first[0]).toBe('bench');
  });

  it('a session of only grip work still resolves (nothing left to protect)', () => {
    const order = arrange([WRIST_CURL]);
    expect(order).toEqual(['wrist']);
  });
});

describe('orderChanged', () => {
  it('detects moved items and treats identical order as a no-op', () => {
    const a = [BENCH, ROW];
    expect(orderChanged(a, [ROW, BENCH], (i) => i.id)).toBe(true);
    expect(orderChanged(a, [BENCH, ROW], (i) => i.id)).toBe(false);
  });
});
