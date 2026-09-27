/**
 * swapRanking — alternatives for one plan item's exercise.
 *
 * Eligibility: the candidate's PRIMARY tag must hit the same primary muscle
 * (any shared standard muscle) — a swap never changes what the item trains.
 * Ranking, in order:
 *   (a) equipment available at this gym (unavailable candidates are kept but
 *       sink to the bottom, flagged, so the sheet can show them disabled),
 *   (b) not done in the last SETUP_CONFIG.swapRecentDays days,
 *   (c) user history / preference (usage count, most used first),
 *   then same movement pattern, hypertrophy tier, name — total and stable.
 *
 * Pure.
 */

import { checkExerciseEquipment } from '@/services/equipmentFilter';
import { SETUP_CONFIG } from './config';
import { primaryStandards } from './exerciseMeta';
import type { SetupExercise } from './types';

export interface SwapRankingContext {
  unavailableEquipmentIds?: readonly string[];
  unavailableExerciseIds?: readonly string[];
  /** Exercise ids performed within the recency window. */
  recentlyDoneIds?: ReadonlySet<string>;
  /** Usage counts (e.g. 90-day block counts), keyed by exercise id. */
  usageCounts?: ReadonlyMap<string, number>;
  /** Exercise ids already in the plan (never offered). */
  excludeIds?: ReadonlySet<string>;
}

export interface SwapCandidate {
  exercise: SetupExercise;
  equipmentAvailable: boolean;
  doneRecently: boolean;
  usageCount: number;
}

const TIER_RANK: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4, F: 5 };
const tierRank = (tier: string | null) => TIER_RANK[(tier ?? 'C').toUpperCase()] ?? 3;

export function rankSwapCandidates(
  current: SetupExercise,
  catalog: readonly SetupExercise[],
  ctx: SwapRankingContext = {}
): SwapCandidate[] {
  const targets = new Set(primaryStandards(current));
  if (targets.size === 0) return [];
  const blocked = new Set(ctx.unavailableExerciseIds ?? []);
  const unavailable = [...(ctx.unavailableEquipmentIds ?? [])];

  return catalog
    .filter(
      (ex) =>
        ex.id !== current.id &&
        !(ctx.excludeIds?.has(ex.id) ?? false) &&
        primaryStandards(ex).some((m) => targets.has(m))
    )
    .map((ex) => ({
      exercise: ex,
      equipmentAvailable:
        !blocked.has(ex.id) &&
        (unavailable.length === 0 || checkExerciseEquipment(ex, unavailable).available),
      doneRecently: ctx.recentlyDoneIds?.has(ex.id) ?? false,
      usageCount: ctx.usageCounts?.get(ex.id) ?? 0,
    }))
    .sort((a, b) => {
      if (a.equipmentAvailable !== b.equipmentAvailable) return a.equipmentAvailable ? -1 : 1;
      if (a.doneRecently !== b.doneRecently) return a.doneRecently ? 1 : -1;
      if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;
      const pa = a.exercise.movementPattern === current.movementPattern ? 0 : 1;
      const pb = b.exercise.movementPattern === current.movementPattern ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const tier = tierRank(a.exercise.tier) - tierRank(b.exercise.tier);
      if (tier !== 0) return tier;
      return a.exercise.name.localeCompare(b.exercise.name);
    });
}

/**
 * The closed set of replacements the AI review may pick from for one item:
 * the top N AVAILABLE candidates from the same ranking the sheet shows.
 */
export function swapCandidatesForReview(
  current: SetupExercise,
  catalog: readonly SetupExercise[],
  ctx: SwapRankingContext = {},
  limit: number = SETUP_CONFIG.swapCandidatesForReview
): SetupExercise[] {
  return rankSwapCandidates(current, catalog, ctx)
    .filter((c) => c.equipmentAvailable)
    .slice(0, limit)
    .map((c) => c.exercise);
}
