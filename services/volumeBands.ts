/**
 * Coarse muscle groups and their research MEV–MRV bands — the SINGLE shared
 * denominator for every volume surface AND the program generator's target
 * ceiling. Pure data: type-only imports, no side effects.
 *
 * Lives in /services (not the dashboard lib) because BOTH sides of the
 * volume contract consume it: the tracking surfaces read it through
 * app/(dashboard)/dashboard/_lib/weeklyVolume (which re-exports everything
 * here), and mesocycleBuilder clamps goal-adjusted volume targets to these
 * MRVs so a generated program can never prescribe past the ceiling the
 * tracking card would flag (bandPresetInvariant.test.ts).
 */

import type { StandardMuscleGroup } from '@/types/schema';

/** The 13 coarse muscle groups that are the default ROW in every surface. */
export const COARSE_MUSCLES = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings',
  'glutes', 'calves', 'abs', 'traps', 'forearms', 'adductors',
] as const;
export type CoarseMuscle = (typeof COARSE_MUSCLES)[number];

export interface VolumeBand {
  mev: number;
  mrv: number;
}

/**
 * Research-based coarse MEV–MRV bands (Israetel / Schoenfeld), expressed in
 * TOTAL-INCLUSIVE credited-set terms — the counter credits secondary work at
 * 0.5/set, and every band below is a threshold on that total. This is the
 * SINGLE shared denominator: a bar is gray/amber below MEV, green across the
 * MEV–MRV zone, red only past MRV — so hitting MEV is never punished with a
 * red bar. Per-user learning may nudge the volume page's band; these are the
 * defaults every glance surface uses (and the baseline the learned table
 * resets to).
 *
 * SEMANTICS (decided in the shoulders-card audit): a coarse band is an
 * INDEPENDENT group-level landmark — it is deliberately NOT the sum of its
 * fine children's bands. Group MEVs assume overlapping stimulus, while a
 * fine child's band (see fineChildBand in weeklyVolume) is that
 * subdivision's own landmark, so Σ(child MEVs) can differ from the group
 * MEV. Two consequences every surface must respect:
 *   1. Labels must distinguish the scopes — groupZoneBandLabel ("group zone
 *      8–22") for coarse rows vs zoneBandLabel ("zone 4–12") for children.
 *   2. A parent may NOT render green while a reachable fine child sits below
 *      its own MEV — the row-aware color helpers (rowColorToken and friends
 *      in weeklyVolume) demote such a parent from success to warning.
 *
 * CONVENTION CONVERSION (v2, ADOPTED): the direct-assuming literature values
 * were shifted by the indirect inflow measured across three generated
 * templates (Full Body 3d / Upper-Lower 4d / PPL 6d, intermediate bulk),
 * following the precedent of the shoulders {8,22}→{12,26} shift:
 *
 *   shoulders {8,22}  → {12,26} (presses ~+4 front-delt, pulls ~+1 rear)
 *   biceps    {6,20}  → {10,26} (observed pull inflow 6–8)
 *   triceps   {6,18}  → {8,24}  (observed 0–7 — fly-based programs 0,
 *                                bench-based 4–7; MEV shifts by the low-mid,
 *                                MRV absorbs the top)
 *   traps     {4,16}  → {6,20}  (observed 0.5–5)
 *   glutes    {4,16}  → {6,24}  (observed 5.5–9 — not modest; MEV +2 is the
 *                                minimal-program floor, MRV + mean ≈ +8)
 *   hamstrings {6,16} → {8,20}  (observed 3.5–7, least template-stable —
 *                                shifted by the low-mean)
 *
 *   back      {10,25} → {12,28} (observed hinge spillover 3.5–7; converted
 *                                per sign-off amendment alongside its
 *                                14/18/23 presets — the v2 "hold" was
 *                                overridden at review)
 *
 * chest / quads / calves / abs / forearms / adductors: direct and
 * total-inclusive readings coincide (little cross-group inflow).
 *
 * The generator's recommendVolume presets converted in the same pass (see
 * services/mesocycleBuilder.ts) — presets and bands convert together or the
 * tracking card and generator disagree.
 */
export const RESEARCH_VOLUME_BANDS: Record<CoarseMuscle, VolumeBand> = {
  chest: { mev: 8, mrv: 22 },
  back: { mev: 12, mrv: 28 },
  shoulders: { mev: 12, mrv: 26 },
  biceps: { mev: 10, mrv: 26 },
  triceps: { mev: 8, mrv: 24 },
  quads: { mev: 8, mrv: 20 },
  hamstrings: { mev: 8, mrv: 20 },
  glutes: { mev: 6, mrv: 24 },
  calves: { mev: 8, mrv: 20 },
  abs: { mev: 6, mrv: 20 },
  traps: { mev: 6, mrv: 20 },
  forearms: { mev: 4, mrv: 14 },
  adductors: { mev: 4, mrv: 12 },
};

/**
 * Coarse group → the standard muscles it aggregates. A coarse row's set count
 * is the sum of its children's credited sets; the "fine" children
 * (subdivisions — see FINE_CHILD_MUSCLES) are carried on the row wherever
 * reachable. Also the grouping the generator's indirect-aware allocator
 * rolls per-standard-muscle credit up through.
 */
export const COARSE_CHILDREN: Record<CoarseMuscle, StandardMuscleGroup[]> = {
  chest: ['chest_upper', 'chest_lower'],
  back: ['lats', 'upper_back', 'erectors'],
  shoulders: ['front_delts', 'lateral_delts', 'rear_delts'],
  biceps: ['biceps'],
  triceps: ['triceps'],
  quads: ['quads'],
  hamstrings: ['hamstrings'],
  glutes: ['glutes', 'glute_med'],
  calves: ['calves', 'gastrocnemius', 'soleus'],
  abs: ['abs', 'obliques'],
  traps: ['traps', 'upper_traps', 'mid_lower_traps'],
  forearms: ['forearms'],
  adductors: ['adductors'],
};

/** Reverse map: every standard muscle to its coarse display parent. */
export const STANDARD_TO_COARSE: Record<StandardMuscleGroup, CoarseMuscle> = (() => {
  const map = {} as Record<StandardMuscleGroup, CoarseMuscle>;
  for (const coarse of COARSE_MUSCLES) {
    for (const child of COARSE_CHILDREN[coarse]) map[child] = coarse;
  }
  return map;
})();

/**
 * Standard muscles that render as INDENTED child rows under their coarse
 * parent (anatomical subdivisions). The single-muscle coarse groups (biceps,
 * quads, …) have no fine children and never expand. The allocator floors
 * these at their OWN MEV_TARGETS when deducting indirect credit.
 */
export const FINE_CHILD_MUSCLES = new Set<StandardMuscleGroup>([
  'chest_upper', 'chest_lower',
  'front_delts', 'lateral_delts', 'rear_delts',
  'lats', 'upper_back', 'erectors',
  'glute_med', 'obliques',
  'upper_traps', 'mid_lower_traps',
  'gastrocnemius', 'soleus',
]);

/**
 * MEV per standard muscle (24 muscles) — the threshold for the 'low' status
 * on the warning surfaces AND the per-child direct-work floor in the
 * generator's indirect-aware allocator.
 *
 * TOTAL-INCLUSIVE (Phase 5b, adopted): the counter credits secondary work at
 * 0.5/set, so thresholds are stated against that total. front_delts 2 and
 * rear_delts 3 are deliberately below their direct-work literature values —
 * pressing routinely supplies 4–6 indirect front-delt sets (rows/pulldowns
 * 1–3 rear-delt sets), and warning at a direct-work threshold would nag users
 * whose indirect volume already covers the muscle.
 */
export const MEV_TARGETS: Record<StandardMuscleGroup, number> = {
  chest_upper: 4, chest_lower: 4,
  front_delts: 2, lateral_delts: 6, rear_delts: 3,
  lats: 6, upper_back: 4, traps: 4, upper_traps: 3, mid_lower_traps: 2,
  biceps: 4, triceps: 4, forearms: 4,
  quads: 6, hamstrings: 4, glutes: 4, glute_med: 2, adductors: 4,
  calves: 6, gastrocnemius: 4, soleus: 3,
  abs: 6, obliques: 4, erectors: 4,
};
