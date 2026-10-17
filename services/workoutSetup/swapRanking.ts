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

function candidateBuilder(ctx: SwapRankingContext): (ex: SetupExercise) => SwapCandidate {
  const blocked = new Set(ctx.unavailableExerciseIds ?? []);
  const unavailable = [...(ctx.unavailableEquipmentIds ?? [])];
  return (ex) => ({
    exercise: ex,
    equipmentAvailable:
      !blocked.has(ex.id) &&
      (unavailable.length === 0 || checkExerciseEquipment(ex, unavailable).available),
    doneRecently: ctx.recentlyDoneIds?.has(ex.id) ?? false,
    usageCount: ctx.usageCounts?.get(ex.id) ?? 0,
  });
}

export function rankSwapCandidates(
  current: SetupExercise,
  catalog: readonly SetupExercise[],
  ctx: SwapRankingContext = {}
): SwapCandidate[] {
  const targets = new Set(primaryStandards(current));
  if (targets.size === 0) return [];
  const toCandidate = candidateBuilder(ctx);

  return catalog
    .filter(
      (ex) =>
        ex.id !== current.id &&
        !(ctx.excludeIds?.has(ex.id) ?? false) &&
        primaryStandards(ex).some((m) => targets.has(m))
    )
    .map(toCandidate)
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

export interface SwapSearchResult {
  /** Same-muscle candidates matching the query, in the sheet's ranking. */
  matches: SwapCandidate[];
  /**
   * The rest of the catalog matching the query — an explicit user override,
   * so the same-muscle rule doesn't apply. Available first, then most used,
   * then name.
   */
  otherMatches: SwapCandidate[];
}

function searchTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Every query token must prefix some word of the name or primary muscle. */
function matchesQuery(ex: SetupExercise, queryTokens: readonly string[]): boolean {
  const words = searchTokens(`${ex.name} ${ex.primaryMuscle.replace(/_/g, ' ')}`);
  return queryTokens.every((q) => words.some((w) => w.startsWith(q)));
}

/**
 * Free-text search for the swap sheet. An empty query is just the ranked
 * recommendations; otherwise same-muscle matches keep their ranking and any
 * other catalog exercise matching the query follows.
 */
export function searchSwapCandidates(
  current: SetupExercise,
  catalog: readonly SetupExercise[],
  query: string,
  ctx: SwapRankingContext = {}
): SwapSearchResult {
  const ranked = rankSwapCandidates(current, catalog, ctx);
  const tokens = searchTokens(query);
  if (tokens.length === 0) return { matches: ranked, otherMatches: [] };

  const rankedIds = new Set(ranked.map((c) => c.exercise.id));
  const toCandidate = candidateBuilder(ctx);

  const otherMatches = catalog
    .filter(
      (ex) =>
        ex.id !== current.id &&
        !rankedIds.has(ex.id) &&
        !(ctx.excludeIds?.has(ex.id) ?? false) &&
        matchesQuery(ex, tokens)
    )
    .map(toCandidate)
    .sort((a, b) => {
      if (a.equipmentAvailable !== b.equipmentAvailable) return a.equipmentAvailable ? -1 : 1;
      if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;
      return a.exercise.name.localeCompare(b.exercise.name);
    });

  return { matches: ranked.filter((c) => matchesQuery(c.exercise, tokens)), otherMatches };
}
