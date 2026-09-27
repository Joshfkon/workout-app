/**
 * readinessStatus — the readiness-status layer on top of the recovery
 * heuristic: an explicit `unknown` status for muscles with no evidence, the
 * shared ranking tier, and the actionability factors. Pure; no React, no
 * Supabase.
 */

import type { StandardMuscleGroup } from '@/types/schema';
import type { MuscleRecoveryResult } from '@/services/muscleRecovery';
import { perSetCredits } from '@/services/shared/volumeCredit';

/**
 * Readiness as the picker / targets / badges read it: the recovery heuristic's
 * tri-state plus an explicit `unknown` for a muscle we have NO evidence about.
 *
 * The recovery heuristic reports a muscle absent from its (7-day) history as
 * `fresh` — physiologically fair for someone back from a week off, but wrong
 * for a group the user simply never trains: that "fresh, 0 sets, 4 below MEV"
 * reading made Forearms a top Good Target. `unknown` separates the two:
 * a muscle is unknown only when it has no recovery debt (no completed session
 * in the recovery window touched it) AND no credited work in the longer
 * known-muscles lookback ({@link KNOWN_MUSCLE_LOOKBACK_DAYS}). Sets logged in
 * the live session are deliberately not evidence, matching the recovery
 * model, which only reads completed sessions. Unknown muscles are never Good
 * Targets.
 */
export type ReadinessStatus = MuscleRecoveryResult['status'] | 'unknown';

/**
 * How far back a muscle's training counts as "we know this user trains it".
 * Longer than the 7-day volume/recovery window so a user returning from a
 * 1–3 week break still sees their usual groups as Fresh rather than unknown.
 */
export const KNOWN_MUSCLE_LOOKBACK_DAYS = 28;

/** How "trainable today" each recovery bucket is, for the actionability score.
 *  Exported for the next-day preview (readinessPreview), which re-derives the
 *  score over tomorrow's values with the same factor. */
export const RECOVERED_FACTOR: Record<MuscleRecoveryResult['status'], number> = {
  fresh: 1,
  recovering: 0.6,
  fatigued: 0,
};

/** Actionability factor keyed on the readiness status: an unknown muscle has
 *  no evidence behind its "gap", so it never scores as a target. */
export const READINESS_FACTOR: Record<ReadinessStatus, number> = {
  ...RECOVERED_FACTOR,
  unknown: 0,
};

/**
 * Ranking tier (lower = better target): fresh-with-deficit > fresh > unknown >
 * recovering > fatigued. The single ordering the sheet, the quick-add chips and
 * the setup flow's target picker all sort by.
 */
export function readinessTier(status: ReadinessStatus, volumeGap: number): number {
  switch (status) {
    case 'fresh':
      return volumeGap > 0 ? 0 : 1;
    case 'unknown':
      return 2;
    case 'recovering':
      return 3;
    case 'fatigued':
      return 4;
  }
}

/**
 * Resolve the readiness status for a muscle (or a coarse group, via its
 * `members`). A recovery debt or any credited work in the known-muscles
 * lookback is evidence; otherwise unknown. Without a `known` set (lookback not
 * loaded / not supplied) only the recovery window counts — the conservative
 * reading, so missing data never reads as fresh.
 */
export function resolveReadinessStatus(
  recovery: MuscleRecoveryResult,
  members: readonly StandardMuscleGroup[],
  known?: ReadonlySet<StandardMuscleGroup>
): ReadinessStatus {
  if (recovery.status !== 'fresh') return recovery.status;
  if (recovery.lastTrainedAt !== null) return 'fresh';
  if (known && members.some((m) => known.has(m))) return 'fresh';
  return 'unknown';
}

/**
 * Standard muscles credited (primary or secondary, same attribution as the
 * volume counters) by any of `exercises` — the known-muscles set that feeds
 * {@link resolveReadinessStatus}. Pure; the caller supplies the lookback rows.
 */
export function knownMusclesFromExercises(
  exercises: ReadonlyArray<{ primaryMuscle: string; secondaryMuscles: readonly string[] }>
): Set<StandardMuscleGroup> {
  const out = new Set<StandardMuscleGroup>();
  for (const ex of exercises) {
    for (const { muscle } of perSetCredits(ex.primaryMuscle, [...ex.secondaryMuscles])) {
      out.add(muscle);
    }
  }
  return out;
}
