import {
  buildDraftPlan,
  groupSessionSets,
  splitGroupSets,
  trimPlanToBudget,
} from '../draftPlan';
import { estimatePlanMinutes, plannedCreditByGroup } from '../planProjection';
import { SETUP_CONFIG } from '../config';
import { primaryGroupOf } from '../exerciseMeta';
import { BY_ID, CATALOG, group } from './fixtures';
import type { SetupGroupState } from '../types';

const build = (groups: SetupGroupState[], extra: Partial<Parameters<typeof buildDraftPlan>[0]> = {}) =>
  buildDraftPlan({ groups, exercises: CATALOG, recentExerciseIds: [], ...extra });

describe('buildDraftPlan — selected group counts', () => {
  it('1 group: fills the group with valid, distinct items', () => {
    const { items, unfilledGroups } = build([group('chest', 0)]);
    expect(unfilledGroups).toEqual([]);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.every((i) => primaryGroupOf(BY_ID.get(i.exerciseId)!) === 'chest')).toBe(true);
    expect(new Set(items.map((i) => i.exerciseId)).size).toBe(items.length);
    // Chest at 0 vs zone min 8 → capped at the per-session max, split in two.
    expect(items.reduce((n, i) => n + i.sets, 0)).toBe(SETUP_CONFIG.maxGroupSets);
    expect(items).toHaveLength(2);
    // Two different movement patterns, compound first.
    const [a, b] = items.map((i) => BY_ID.get(i.exerciseId)!);
    expect(a.movementPattern).not.toBe(b.movementPattern);
    expect(a.mechanic).toBe('compound');
  });

  it('3 groups: every group served, compounds before isolations', () => {
    const { items, unfilledGroups } = build([group('chest', 4), group('back', 6), group('biceps', 4)]);
    expect(unfilledGroups).toEqual([]);
    const groups = new Set(items.map((i) => primaryGroupOf(BY_ID.get(i.exerciseId)!)));
    expect(groups).toEqual(new Set(['chest', 'back', 'biceps']));
    const mechanics = items.map((i) => BY_ID.get(i.exerciseId)!.mechanic);
    const firstIso = mechanics.indexOf('isolation');
    expect(firstIso === -1 || mechanics.slice(firstIso).every((m) => m === 'isolation')).toBe(true);
  });

  it('5 groups: all served, ids unique, sets within DB bounds', () => {
    const selected = [group('quads'), group('hamstrings'), group('glutes'), group('calves'), group('shoulders')];
    const { items, unfilledGroups } = build(selected);
    expect(unfilledGroups).toEqual([]);
    const groups = new Set(items.map((i) => primaryGroupOf(BY_ID.get(i.exerciseId)!)));
    selected.forEach((g) => expect(groups.has(g.group)).toBe(true));
    expect(new Set(items.map((i) => i.itemId)).size).toBe(items.length);
    items.forEach((i) => {
      expect(i.sets).toBeGreaterThanOrEqual(1);
      expect(i.sets).toBeLessThanOrEqual(10);
    });
  });

  it('is deterministic', () => {
    const groups = [group('chest'), group('back'), group('quads')];
    expect(build(groups)).toEqual(build(groups));
  });

  it('builds well under 200ms for 5 groups over a large catalog', () => {
    const big = Array.from({ length: 40 }, (_, k) => CATALOG.map((e) => ({ ...e, id: `${e.id}-${k}`, name: `${e.name} ${k}` }))).flat();
    const selected = [group('quads'), group('back'), group('chest'), group('shoulders'), group('biceps')];
    const t0 = performance.now();
    buildDraftPlan({ groups: selected, exercises: big, recentExerciseIds: [], timeBudgetMin: 45 });
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe('buildDraftPlan — volume, recovery and guardrails', () => {
  it('sizes toward the zone, counting spill-over from earlier picks', () => {
    // Chest selected first (bigger group) → its presses credit triceps 0.5/set.
    const { items } = build([group('chest', 0), group('triceps', 4)]);
    const credit = plannedCreditByGroup(items, BY_ID);
    // Triceps got spill-over; its own sets are sized from what remains.
    const tricepsOwn = items
      .filter((i) => primaryGroupOf(BY_ID.get(i.exerciseId)!) === 'triceps')
      .reduce((n, i) => n + i.sets, 0);
    expect(credit.get('triceps')!).toBeGreaterThan(tricepsOwn);
  });

  it('never plans past zone max, but a chosen group keeps a minimal dose', () => {
    expect(groupSessionSets(group('chest', 21), 0)).toBe(SETUP_CONFIG.minGroupSets);
    expect(groupSessionSets(group('chest', 18), 0)).toBe(4);
  });

  it('reduces recovering, fatigued and unknown groups', () => {
    expect(groupSessionSets(group('chest', 0, 'fresh'), 0)).toBe(8);
    expect(groupSessionSets(group('chest', 0, 'recovering'), 0)).toBe(5);
    expect(groupSessionSets(group('chest', 0, 'fatigued'), 0)).toBe(SETUP_CONFIG.fatiguedGroupSets);
    expect(groupSessionSets(group('chest', 0, 'unknown'), 0)).toBe(SETUP_CONFIG.unknownGroupSets);
  });

  it('a fatigued group gets isolation first and a higher RIR', () => {
    const { items } = build([group('chest', 0, 'fatigued')]);
    const first = BY_ID.get(items[0].exerciseId)!;
    expect(first.mechanic).toBe('isolation');
    expect(items[0].targetRir).toBeGreaterThanOrEqual(3);
  });

  it('avoids exercises that lean on a fatigued stabilizer', () => {
    const fresh = build([group('back', 0)]).items.map((i) => i.exerciseId);
    const withGripFatigue = build([group('back', 0)], {
      stabilizerLoad: { forearms: 'high', erectors: 'high' },
    }).items.map((i) => i.exerciseId);
    expect(fresh).toContain('pulldown');
    expect(withGripFatigue[0]).toBe('csrow'); // the only back option with no grip/low-back tag
  });

  it('prefers a lagging fine muscle within the group', () => {
    const { items } = build([group('shoulders', 12, 'fresh', ['rear_delts'])]);
    expect(items[0].exerciseId === 'reardelt' || items.some((i) => i.exerciseId === 'reardelt')).toBe(true);
  });

  it('respects unavailable equipment and exercises', () => {
    const { items } = build([group('back', 0)], {
      unavailableEquipmentIds: ['lat_pulldown'],
      unavailableExerciseIds: ['row'],
    });
    const ids = items.map((i) => i.exerciseId);
    expect(ids).not.toContain('pulldown');
    expect(ids).not.toContain('row');
  });

  it('reports a group with no usable exercise instead of inventing one', () => {
    const { items, unfilledGroups } = build([group('adductors', 0)]);
    expect(items).toEqual([]);
    expect(unfilledGroups).toEqual(['adductors']);
  });

  it('separates grip/low-back heavy lifts when the plan allows it', () => {
    const { items } = build([group('back', 0), group('hamstrings', 0), group('quads', 0)]);
    const ids = items.map((i) => i.exerciseId);
    const d = ids.indexOf('deadlift');
    const r = ids.indexOf('row');
    if (d !== -1 && r !== -1) expect(Math.abs(d - r)).toBeGreaterThan(1);
  });
});

describe('splitGroupSets', () => {
  it('keeps small doses on one exercise and splits bigger ones', () => {
    expect(splitGroupSets(3)).toEqual([3]);
    expect(splitGroupSets(4)).toEqual([4]);
    expect(splitGroupSets(5)).toEqual([3, 2]);
    expect(splitGroupSets(8)).toEqual([4, 4]);
  });
});

describe('time-budget trimming', () => {
  const selected = [group('chest', 0), group('back', 0), group('quads', 0), group('shoulders', 0)];

  it('fits the plan inside the budget', () => {
    const untrimmed = build(selected);
    const before = estimatePlanMinutes(untrimmed.items, BY_ID);
    expect(before).toBeGreaterThan(45);
    const { items, trimmedSets } = build(selected, { timeBudgetMin: 45 });
    expect(estimatePlanMinutes(items, BY_ID)).toBeLessThanOrEqual(45);
    expect(trimmedSets).toBeGreaterThan(0);
  });

  it('trims no-deficit groups before deficit groups', () => {
    // Chest already in zone; back far below → back keeps its sets longer.
    const groups = [group('chest', 12), group('back', 0)];
    const plan = build(groups).items;
    const setsFor = (items: typeof plan, g: string) =>
      items.filter((i) => primaryGroupOf(BY_ID.get(i.exerciseId)!) === g).reduce((n, i) => n + i.sets, 0);
    const budget = estimatePlanMinutes(plan, BY_ID) - 6;
    const { items } = trimPlanToBudget(plan, BY_ID, groups, budget);
    expect(setsFor(plan, 'chest') - setsFor(items, 'chest')).toBeGreaterThan(0);
    expect(setsFor(items, 'back')).toBe(setsFor(plan, 'back'));
  });

  it('never goes below the per-exercise floor before dropping items, and keeps one item', () => {
    const plan = build(selected).items;
    const { items } = trimPlanToBudget(plan, BY_ID, selected, 1);
    expect(items.length).toBe(1);
    expect(items[0].sets).toBeGreaterThanOrEqual(SETUP_CONFIG.minSetsPerExercise);
  });

  it('is a no-op when already inside the budget', () => {
    const plan = build(selected).items;
    expect(trimPlanToBudget(plan, BY_ID, selected, 999)).toEqual({ items: plan, trimmedSets: 0 });
  });
});
