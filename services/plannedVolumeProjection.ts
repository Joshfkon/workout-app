/**
 * plannedVolumeProjection — where each muscle's WEEK lands if today's plan is
 * finished.
 *
 * The weekly-volume strip shows week-to-date credited sets (history + sets
 * already logged this session). This module adds the forward half: the credited
 * sets the REMAINING planned sets of today's session would contribute, so the
 * strip can show "completed + still planned today" against the same MEV–MRV
 * band — and so skipping an exercise shows its volume consequence immediately
 * (the skipped block simply drops out of the planned inputs).
 *
 * Crediting goes through the canonical per-set math (services/shared/
 * volumeCredit — weighted primary split, 0.5 secondary, within-group cap), the
 * same functions the week-to-date rows are counted with, so completed + planned
 * always add up in the same unit. Every set of a block carries the same tags,
 * so per-set capped credit × remaining sets is exactly the capped block credit
 * (see groupCapScale's equivalence note).
 *
 * LOCKED-IN DEFICITS. The weekly window is a trailing 7 local days INCLUDING
 * today (see lib/date/localDay.rollingWindowStart): the week total the user is
 * looking at closes at the end of the local day. The only way to lift today's
 * projected total is therefore to add quality sets TODAY — so a projected
 * below-minimum muscle splits into two honesty levels:
 *   - merely UNDER: the muscle is recovered enough to take more quality sets
 *     this session, so the deficit is still the user's choice;
 *   - LOCKED IN: the muscle's recovery ETA extends past the hours left in the
 *     local day, so additional quality sets can no longer realistically land
 *     in this window — the deficit is already decided, and the UI should say
 *     so (red) instead of nagging about sets that cannot happen.
 *
 * Pure functions — no React, no Supabase. `now` is a defaulted parameter per
 * the @/lib/clock convention.
 */

import { now as clockNow } from '@/lib/clock';
import { startOfLocalDay } from '@/lib/date/localDay';
import { perSetGroupCredits } from '@/services/shared/volumeCredit';
import type { CoarseMuscle } from '@/services/volumeBands';

/** One planned exercise block's contribution inputs: its muscle tags and how
 *  many planned WORKING sets are still ahead of the user (skipped blocks are
 *  excluded by the caller — a skipped exercise plans nothing). */
export interface PlannedBlockVolume {
  primaryMuscle: string | null;
  secondaryMuscles: string[];
  remainingSets: number;
}

/**
 * Working sets still planned for a block: target minus already-logged working
 * sets, floored at 0. A mid-session plan edit that drops the target below what
 * was already logged simply plans nothing further (never a negative
 * contribution — logged sets are history, not revocable). A missing/invalid
 * target (ad-hoc block shapes) plans nothing.
 */
export function remainingPlannedSets(
  targetSets: number | null | undefined,
  loggedWorkingSets: number
): number {
  if (typeof targetSets !== 'number' || !Number.isFinite(targetSets) || targetSets <= 0) return 0;
  return Math.max(0, Math.floor(targetSets) - Math.max(0, loggedWorkingSets));
}

/**
 * Credited group sets the remaining planned work would add, per coarse muscle
 * group — full precision (round once at display, like every other credited
 * count). Uses the SAME capped per-set group credit as the week-to-date rows,
 * so `weekToDate + planned` is a sum of like units. Blocks whose primary tag
 * resolves to no coarse group contribute nothing (they also never render a
 * strip row — there is no band to project against).
 */
export function plannedGroupSets(
  blocks: readonly PlannedBlockVolume[]
): Map<CoarseMuscle, number> {
  const out = new Map<CoarseMuscle, number>();
  for (const block of blocks) {
    if (!block.primaryMuscle || block.remainingSets <= 0) continue;
    for (const { group, credit } of perSetGroupCredits(
      block.primaryMuscle,
      block.secondaryMuscles
    )) {
      out.set(group, (out.get(group) ?? 0) + block.remainingSets * credit);
    }
  }
  return out;
}

/** Hours from `now` to the end of its local calendar day (next local midnight).
 *  The rolling weekly window includes days, not hours — but a muscle that
 *  cannot produce quality sets before the day ends cannot add to THIS window. */
export function hoursLeftInLocalDay(now: Date = clockNow()): number {
  const nextMidnight = startOfLocalDay(now);
  nextMidnight.setDate(nextMidnight.getDate() + 1);
  return Math.max(0, (nextMidnight.getTime() - now.getTime()) / (60 * 60 * 1000));
}

export interface DeficitLockInInput {
  /** Whether the muscle's projected week total sits below its band minimum. */
  projectedBelowMin: boolean;
  /** Hours until the muscle's readiness crosses the ready threshold (0 = ready
   *  now) — from the shared recovery heuristic, never a parallel model. */
  readyInHours: number;
  /** Hours left in the current local day (see hoursLeftInLocalDay). */
  hoursLeftInDay: number;
}

/**
 * A projected deficit is LOCKED IN when the muscle cannot realistically take
 * additional quality sets before the weekly window closes: it is below the
 * band minimum even counting everything still planned today, AND its recovery
 * ETA runs past the end of the local day. A ready muscle (`readyInHours` 0) is
 * never locked — the user can still add sets to this session.
 */
export function isDeficitLockedIn(input: DeficitLockInInput): boolean {
  if (!input.projectedBelowMin) return false;
  if (input.readyInHours <= 0) return false;
  return input.readyInHours > input.hoursLeftInDay;
}
