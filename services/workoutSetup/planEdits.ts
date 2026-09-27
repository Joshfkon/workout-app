/**
 * planEdits — the ONE code path every draft-plan change goes through: manual
 * edits in the editor and accepted AI suggestions alike. Each edit returns a
 * new items array; the footer's projection re-derives from it, so volume and
 * duration update identically no matter who made the change.
 *
 * Pure.
 */

import { SETUP_CONFIG } from './config';
import { makePlanItem, nextItemId } from './draftPlan';
import type { PlanItem, PlanItemSource, SetupExercise } from './types';

export type PlanEdit =
  | { type: 'set_sets'; itemId: string; sets: number }
  | { type: 'move'; itemId: string; toIndex: number }
  | { type: 'reorder'; itemIds: string[] }
  | { type: 'remove'; itemId: string }
  | { type: 'add'; exercise: SetupExercise; sets?: number; source?: PlanItemSource }
  | { type: 'swap'; itemId: string; exercise: SetupExercise; source?: PlanItemSource };

const clampSets = (n: number) =>
  Math.min(SETUP_CONFIG.maxSetsPerItem, Math.max(SETUP_CONFIG.minSetsPerItem, Math.round(n)));

export function applyPlanEdit(items: readonly PlanItem[], edit: PlanEdit): PlanItem[] {
  switch (edit.type) {
    case 'set_sets':
      return items.map((item) =>
        item.itemId === edit.itemId ? { ...item, sets: clampSets(edit.sets) } : item
      );

    case 'move': {
      const from = items.findIndex((i) => i.itemId === edit.itemId);
      if (from === -1) return [...items];
      const to = Math.min(items.length - 1, Math.max(0, edit.toIndex));
      const next = [...items];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    }

    case 'reorder': {
      // A drag result: must be a permutation of the current ids, else ignored.
      if (edit.itemIds.length !== items.length) return [...items];
      const byId = new Map(items.map((i) => [i.itemId, i]));
      const next = edit.itemIds.map((id) => byId.get(id));
      return next.every(Boolean) && new Set(edit.itemIds).size === items.length
        ? (next as PlanItem[])
        : [...items];
    }

    case 'remove':
      return items.filter((i) => i.itemId !== edit.itemId);

    case 'add': {
      const defaultSets =
        edit.exercise.mechanic === 'isolation' ? 3 : 4; // handleAddExercise defaults
      return [
        ...items,
        makePlanItem(edit.exercise, nextItemId(items), edit.sets ?? defaultSets, edit.source ?? 'manual'),
      ];
    }

    case 'swap':
      // Keeps the slot (position, id, set count); takes the new exercise's
      // rep/RIR/rest targets. Never re-orders — the user's order stands.
      return items.map((item) => {
        if (item.itemId !== edit.itemId) return item;
        const replacement = makePlanItem(edit.exercise, item.itemId, item.sets, edit.source ?? 'swap');
        return { ...replacement, reason: item.reason };
      });
  }
}

/**
 * Stable hash of the plan's reviewable content (exercise, sets, order, reps).
 * AI review results are cached against it; any edit changes it.
 */
export function planHash(items: readonly PlanItem[]): string {
  const canonical = items
    .map((i) => `${i.itemId}:${i.exerciseId}:${i.sets}:${i.repRange[0]}-${i.repRange[1]}`)
    .join('|');
  // FNV-1a 32-bit — tiny, deterministic, good enough for a cache key.
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
