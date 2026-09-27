import { applyPlanEdit, planHash } from '../planEdits';
import {
  estimatePlanMinutes,
  planWarnings,
  projectPlanVolume,
} from '../planProjection';
import { makePlanItem } from '../draftPlan';
import { rankSwapCandidates, swapCandidatesForReview } from '../swapRanking';
import { ALL_GROUPS, BY_ID, CATALOG, group } from './fixtures';
import type { PlanItem } from '../types';

const item = (id: string, exerciseId: string, sets: number): PlanItem =>
  makePlanItem(BY_ID.get(exerciseId)!, id, sets, 'generated');

const base = (): PlanItem[] => [item('item-1', 'bench', 4), item('item-2', 'row', 4), item('item-3', 'curl', 3)];

describe('applyPlanEdit (the single edit path)', () => {
  it('set_sets clamps to the DB bounds 1–10', () => {
    expect(applyPlanEdit(base(), { type: 'set_sets', itemId: 'item-1', sets: 0 })[0].sets).toBe(1);
    expect(applyPlanEdit(base(), { type: 'set_sets', itemId: 'item-1', sets: 14 })[0].sets).toBe(10);
  });

  it('move / reorder / remove', () => {
    expect(applyPlanEdit(base(), { type: 'move', itemId: 'item-3', toIndex: 0 }).map((i) => i.itemId)).toEqual(['item-3', 'item-1', 'item-2']);
    expect(applyPlanEdit(base(), { type: 'reorder', itemIds: ['item-2', 'item-3', 'item-1'] }).map((i) => i.itemId)).toEqual(['item-2', 'item-3', 'item-1']);
    // A non-permutation reorder is ignored.
    expect(applyPlanEdit(base(), { type: 'reorder', itemIds: ['item-2', 'item-2', 'item-1'] }).map((i) => i.itemId)).toEqual(['item-1', 'item-2', 'item-3']);
    expect(applyPlanEdit(base(), { type: 'remove', itemId: 'item-2' }).map((i) => i.itemId)).toEqual(['item-1', 'item-3']);
  });

  it('add appends with a fresh id and mechanic defaults', () => {
    const next = applyPlanEdit(base(), { type: 'add', exercise: BY_ID.get('lateral')! });
    expect(next[3]).toMatchObject({ itemId: 'item-4', exerciseId: 'lateral', sets: 3, source: 'manual' });
  });

  it('swap keeps the slot, id and set count and does not re-order', () => {
    const next = applyPlanEdit(base(), { type: 'swap', itemId: 'item-2', exercise: BY_ID.get('csrow')! });
    expect(next.map((i) => i.itemId)).toEqual(['item-1', 'item-2', 'item-3']);
    expect(next[1]).toMatchObject({ exerciseId: 'csrow', sets: 4, source: 'swap' });
  });

  it('every edit changes the plan hash; identical plans hash identically', () => {
    const h = planHash(base());
    expect(planHash(base())).toBe(h);
    expect(planHash(applyPlanEdit(base(), { type: 'set_sets', itemId: 'item-1', sets: 5 }))).not.toBe(h);
    expect(planHash(applyPlanEdit(base(), { type: 'move', itemId: 'item-3', toIndex: 0 }))).not.toBe(h);
  });
});

describe('projectPlanVolume + duration (footer)', () => {
  it('adds the plan’s credited sets to the week, with spill-over rows', () => {
    const rows = projectPlanVolume(base(), BY_ID, ALL_GROUPS, ['chest', 'back']);
    const chest = rows.find((r) => r.group === 'chest')!;
    expect(chest).toMatchObject({ selected: true, planned: 4, projected: 4, zone: 'below' });
    // Bench credits triceps 0.5/set → an unselected spill-over row.
    const triceps = rows.find((r) => r.group === 'triceps')!;
    expect(triceps.selected).toBe(false);
    expect(triceps.planned).toBe(2);
    // Selected first, in selection order.
    expect(rows.slice(0, 2).map((r) => r.group)).toEqual(['chest', 'back']);
  });

  it('updates immediately on every edit kind', () => {
    const plan = base();
    const minutes = estimatePlanMinutes(plan, BY_ID);
    const chestPlanned = (items: PlanItem[]) =>
      projectPlanVolume(items, BY_ID, ALL_GROUPS, ['chest']).find((r) => r.group === 'chest')!.planned;
    const more = applyPlanEdit(plan, { type: 'set_sets', itemId: 'item-1', sets: 6 });
    expect(chestPlanned(more)).toBe(6);
    expect(estimatePlanMinutes(more, BY_ID)).toBeGreaterThan(minutes);
    const removed = applyPlanEdit(plan, { type: 'remove', itemId: 'item-1' });
    expect(chestPlanned(removed)).toBe(0);
    expect(estimatePlanMinutes(removed, BY_ID)).toBeLessThan(minutes);
    const swapped = applyPlanEdit(plan, { type: 'swap', itemId: 'item-1', exercise: BY_ID.get('fly')! });
    expect(chestPlanned(swapped)).toBe(4);
    // Fly has no triceps credit, so the spill-over row disappears.
    expect(projectPlanVolume(swapped, BY_ID, ALL_GROUPS, ['chest']).some((r) => r.group === 'triceps')).toBe(false);
  });

  it('warns on zone max, time budget and fatigued stabilizers', () => {
    const states = ALL_GROUPS.map((g) => (g.group === 'chest' ? group('chest', 20) : g));
    const plan = base();
    const projection = projectPlanVolume(plan, BY_ID, states, ['chest', 'back']);
    const warnings = planWarnings({
      items: plan,
      exercisesById: BY_ID,
      projection,
      estimatedMinutes: 70,
      timeBudgetMin: 45,
      stabilizerLoad: { forearms: 'high' },
    });
    const kinds = warnings.map((w) => w.kind);
    expect(kinds).toContain('over_zone_max');
    expect(warnings.find((w) => w.kind === 'over_zone_max')!.message).toBe('Chest will exceed zone max (24 / 22)');
    expect(kinds).toContain('over_time_budget');
    expect(warnings.find((w) => w.kind === 'fatigued_stabilizer')!.itemId).toBe('item-2');
  });
});

describe('rankSwapCandidates', () => {
  const row = BY_ID.get('row')!;

  it('only offers exercises hitting the same primary muscle', () => {
    const ids = rankSwapCandidates(row, CATALOG).map((c) => c.exercise.id);
    expect(ids).toEqual(expect.arrayContaining(['pulldown', 'csrow']));
    expect(ids).not.toContain('bench');
    expect(ids).not.toContain('row');
  });

  it('ranks available > not-recent > most used', () => {
    const ranked = rankSwapCandidates(row, CATALOG, {
      unavailableEquipmentIds: ['lat_pulldown'],
      recentlyDoneIds: new Set(['csrow']),
    }).map((c) => [c.exercise.id, c.equipmentAvailable, c.doneRecently]);
    expect(ranked).toEqual([
      ['csrow', true, true],
      ['pulldown', false, false],
    ]);
    const byUsage = rankSwapCandidates(row, CATALOG, { usageCounts: new Map([['csrow', 9]]) });
    expect(byUsage[0].exercise.id).toBe('csrow');
  });

  it('review candidates are the top available ones and exclude the plan', () => {
    const ids = swapCandidatesForReview(row, CATALOG, {
      unavailableEquipmentIds: ['lat_pulldown'],
      excludeIds: new Set(['bench']),
    }).map((e) => e.id);
    expect(ids).toEqual(['csrow']);
  });
});
