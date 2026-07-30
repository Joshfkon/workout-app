/**
 * Program-template pool reachability (Change 4 of the group-cap follow-up).
 *
 * EXERCISE_DATABASE is the program engine's candidate pool. Before the
 * 2026-07-30 retag it still carried pre-convention tags, so generated
 * programs could NOT feed upper_traps, glute_med, adductors, gastrocnemius,
 * soleus, or obliques at all — muscles with authored zones whose bars could
 * never fill from a generated program (compounding for calves, which was
 * simultaneously a cap-binding risk group).
 *
 * Invariant: every sub-muscle that renders with an authored zone — the fine
 * child rows plus the single-member coarse groups — is reachable (primary or
 * secondary, via the standard resolver) from at least one pool exercise.
 * The coarse buckets of multi-member groups (plain 'triceps'/'calves'/
 * 'traps'/'glutes'/'abs' standard members) are exempt: only coarse/legacy
 * TAGS feed those, the fine-tagged convention deliberately does not.
 */

import { EXERCISE_DATABASE } from '../constants';
import {
  COARSE_MUSCLES,
  COARSE_CHILDREN,
  FINE_CHILD_MUSCLES,
} from '@/services/volumeBands';
import { resolveMuscleToStandard, type StandardMuscleGroup } from '@/types/schema';

/** Muscles that render with their own authored zone somewhere in the UI. */
function zonedSubMuscles(): StandardMuscleGroup[] {
  const out = new Set<StandardMuscleGroup>(Array.from(FINE_CHILD_MUSCLES));
  for (const coarse of COARSE_MUSCLES) {
    const children = COARSE_CHILDREN[coarse];
    if (children.length === 1) out.add(children[0]); // biceps, quads, …, adductors
  }
  return Array.from(out);
}

function poolReachable(): Set<StandardMuscleGroup> {
  const reachable = new Set<StandardMuscleGroup>();
  for (const ex of EXERCISE_DATABASE) {
    for (const token of [ex.primaryMuscle, ...(ex.secondaryMuscles ?? [])]) {
      for (const std of resolveMuscleToStandard(token)) reachable.add(std);
    }
  }
  return reachable;
}

describe('program-template pool reachability', () => {
  const reachable = poolReachable();

  it.each(zonedSubMuscles().map((m) => [m] as [StandardMuscleGroup]))(
    '%s (authored zone) is reachable from at least one template exercise',
    (muscle) => {
      expect(reachable.has(muscle)).toBe(true);
    }
  );

  it('every tag in the pool resolves to at least one standard muscle (no silent drops)', () => {
    const dropped: string[] = [];
    for (const ex of EXERCISE_DATABASE) {
      for (const token of [ex.primaryMuscle, ...(ex.secondaryMuscles ?? [])]) {
        if (resolveMuscleToStandard(token).length === 0) {
          dropped.push(`${ex.name}: ${token}`);
        }
      }
    }
    expect(dropped).toEqual([]);
  });
});
