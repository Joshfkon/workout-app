/**
 * Mapping from OUR muscle taxonomy (StandardMuscleGroup, types/schema.ts) to
 * the vendored body-map region ids in lib/muscleMap/paths.ts.
 *
 * Rules:
 * - A logical muscle maps to one-or-more region ids; left/right paths share
 *   the one logical muscle's data and must always render the same color.
 * - Regions not referenced here (head, face, hands, knees, spine midline,
 *   serratus, hip flexors, tibialis anterior, …) are decorative and render in
 *   the neutral base tone.
 * - If a taxonomy member ever lacks a true region, map it to its parent
 *   coarse region with a `// GAP:` comment — never approximate silently.
 *   As of body-muscles v1.0.0 every member has real regions (the artwork
 *   ships `lower-back-erectors-*` and `gluteus-medius-*`), so there are
 *   currently no GAP fallbacks.
 */

import type { StandardMuscleGroup } from '@/types/schema';

/**
 * Muscle → vendored region ids.
 *
 * Non-obvious choices, mirroring DETAILED_TO_STANDARD_MAP semantics:
 * - `traps` (standard) covers upper_traps + lower_traps detailed muscles, so
 *   it takes the artwork's traps-upper-* AND traps-lower-* regions.
 * - `upper_back` (standard) covers rhomboids / mid-back, so it takes the
 *   traps-mid-* regions (the between-the-shoulder-blades area).
 * - `erectors` includes the lower-back-ql-* (quadratus lumborum) regions:
 *   QL sits in the same visual lower-back column and is loaded by the same
 *   movements; leaving it neutral would make the erector column look
 *   half-painted.
 * - `calves` only exists in the back view; `abs`/`obliques`/`adductors` only
 *   in the front view. The component simply paints whichever view is shown.
 */
export const MUSCLE_TO_REGIONS = {
  chest_upper: ['chest-upper-left', 'chest-upper-right'],
  chest_lower: ['chest-lower-left', 'chest-lower-right'],
  front_delts: ['shoulder-front-left', 'shoulder-front-right'],
  lateral_delts: ['shoulder-side-left', 'shoulder-side-right'],
  rear_delts: ['deltoid-rear-left', 'deltoid-rear-right'],
  lats: [
    'lats-upper-left',
    'lats-mid-left',
    'lats-lower-left',
    'lats-upper-right',
    'lats-mid-right',
    'lats-lower-right',
  ],
  upper_back: ['traps-mid-left', 'traps-mid-right'],
  traps: [
    'traps-upper-left',
    'traps-upper-right',
    'traps-lower-left',
    'traps-lower-right',
  ],
  biceps: ['biceps-left', 'biceps-right'],
  triceps: [
    'triceps-long-left',
    'triceps-lateral-left',
    'triceps-long-right',
    'triceps-lateral-right',
  ],
  forearms: [
    'forearm-left',
    'forearm-right',
    'forearm-flexors-left',
    'forearm-extensors-left',
    'forearm-flexors-right',
    'forearm-extensors-right',
  ],
  quads: ['quads-left', 'quads-right'],
  hamstrings: [
    'hamstrings-medial-left',
    'hamstrings-lateral-left',
    'hamstrings-medial-right',
    'hamstrings-lateral-right',
  ],
  glutes: ['gluteus-maximus-left', 'gluteus-maximus-right'],
  glute_med: ['gluteus-medius-left', 'gluteus-medius-right'],
  adductors: ['adductors-left', 'adductors-right'],
  calves: [
    'calves-gastroc-medial-left',
    'calves-gastroc-lateral-left',
    'calves-soleus-left',
    'calves-gastroc-medial-right',
    'calves-gastroc-lateral-right',
    'calves-soleus-right',
  ],
  abs: ['abs-upper-left', 'abs-upper-right', 'abs-lower-left', 'abs-lower-right'],
  obliques: ['obliques-left', 'obliques-right'],
  erectors: [
    'lower-back-erectors-left',
    'lower-back-erectors-right',
    'lower-back-ql-left',
    'lower-back-ql-right',
  ],
} as const satisfies Record<StandardMuscleGroup, readonly string[]>;

/**
 * The muscle ids the map understands — generated from the taxonomy record so
 * the compiler catches drift between MuscleMap props and the taxonomy.
 * Structurally identical to StandardMuscleGroup (enforced by the `satisfies`
 * above plus exhaustiveness: every StandardMuscleGroup key must be present
 * for the record to typecheck).
 */
export type MuscleId = keyof typeof MUSCLE_TO_REGIONS;

export const MUSCLE_IDS = Object.keys(MUSCLE_TO_REGIONS) as MuscleId[];

/** Reverse lookup: vendored region id → logical muscle id. */
export const REGION_TO_MUSCLE: ReadonlyMap<string, MuscleId> = new Map(
  MUSCLE_IDS.flatMap((muscle) =>
    MUSCLE_TO_REGIONS[muscle].map((region): [string, MuscleId] => [region, muscle])
  )
);
