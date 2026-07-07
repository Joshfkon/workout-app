/**
 * The workout generators' shared injury rule: a muscle group in the user's
 * injury history (users.injury_history, legacy taxonomy) is excluded from
 * exercise selection entirely. Used by the mesocycle generator
 * (mesocycleBuilder/sessionBuilderWithFatigue) and the AI suggested-workout
 * engine so every generator applies the SAME exclusion.
 *
 * Accepts either taxonomy — a standard muscle ('lateral_delts') is excluded
 * when its legacy group ('shoulders') is flagged, matching how
 * injury_history is stored.
 */

import { toLegacyMuscleGroup } from '@/types/schema';

export function isMuscleExcludedByInjury(
  muscle: string,
  injuryHistory: readonly string[]
): boolean {
  if (injuryHistory.length === 0) return false;
  if (injuryHistory.includes(muscle)) return true;
  const legacy = toLegacyMuscleGroup(muscle);
  return legacy != null && injuryHistory.includes(legacy);
}
