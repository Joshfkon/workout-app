/**
 * exerciseStaples
 *
 * Pure helpers for deciding which exercises to surface in the "collapsed"
 * (default) view of an exercise picker, so the long tail of rarely-used
 * options can be hidden behind a "Show all" toggle without losing access.
 *
 * The default-visible set is personalized + staples:
 *   - exercises the user has actually performed (usage / last-done), plus
 *   - a curated set of top hypertrophy-tier "staples" per muscle group, so
 *     brand-new users (with no history) still see good defaults.
 */

const TIER_RANK: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4, F: 5 };

/** Default number of top-tier staple exercises surfaced per muscle group. */
export const DEFAULT_STAPLES_PER_MUSCLE = 4;

export interface StapleInput {
  id: string;
  /** Primary muscle group (any casing). */
  muscle?: string | null;
  /** Hypertrophy tier S–F; treated as 'C' when missing. */
  tier?: string | null;
}

function tierRank(tier?: string | null): number {
  return TIER_RANK[(tier ?? 'C').toUpperCase()] ?? TIER_RANK.C;
}

/**
 * Returns the set of exercise IDs considered "staples": the top
 * hypertrophy-tier exercises within each muscle group (ties broken by id for
 * stability). These are the exercises shown by default even to users with no
 * training history.
 */
export function computeStapleExerciseIds(
  exercises: StapleInput[],
  perMuscle: number = DEFAULT_STAPLES_PER_MUSCLE
): Set<string> {
  const byMuscle = new Map<string, StapleInput[]>();
  for (const ex of exercises) {
    const muscle = (ex.muscle ?? '').toLowerCase();
    const list = byMuscle.get(muscle);
    if (list) list.push(ex);
    else byMuscle.set(muscle, [ex]);
  }

  const staples = new Set<string>();
  byMuscle.forEach((list) => {
    [...list]
      .sort((a, b) => {
        const diff = tierRank(a.tier) - tierRank(b.tier);
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      })
      .slice(0, perMuscle)
      .forEach((ex) => staples.add(ex.id));
  });
  return staples;
}

/**
 * Whether an exercise belongs in the collapsed default view: it's a staple,
 * or the user has used it before (non-zero usage count, or a recorded
 * last-done date).
 */
export function isDefaultVisibleExercise(
  id: string,
  staples: Set<string>,
  usageCounts?: Map<string, number>,
  lastDone?: Map<string, unknown>
): boolean {
  if (staples.has(id)) return true;
  if ((usageCounts?.get(id) ?? 0) > 0) return true;
  if (lastDone?.has(id)) return true;
  return false;
}
