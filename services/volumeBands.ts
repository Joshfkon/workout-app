/**
 * Coarse muscle groups and their research MEV–MRV bands — the SINGLE shared
 * denominator for every volume surface AND the program generator's target
 * ceiling. Pure data + the getEffectiveBand resolver; no side effects.
 *
 * Lives in /services (not the dashboard lib) because BOTH sides of the
 * volume contract consume it: the tracking surfaces read it through
 * app/(dashboard)/dashboard/_lib/weeklyVolume (which re-exports everything
 * here), and mesocycleBuilder clamps goal-adjusted volume targets to these
 * MRVs so a generated program can never prescribe past the ceiling the
 * tracking card would flag (bandPresetInvariant.test.ts).
 */

import { DEFAULT_VOLUME_LANDMARKS, type StandardMuscleGroup } from '@/types/schema';

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

// ============================================
// RECOVERY PROFILE + THE SINGLE BAND SOURCE
// ============================================

/**
 * Self-reported recovery profile, derived from the existing
 * users.enhanced_athlete_mode flag (neutral naming; the field is excluded
 * from share formatters, exports and analytics — audited in the residuals
 * pass). Default 'standard'.
 */
export type RecoveryProfile = 'standard' | 'enhanced';

export interface BandContext {
  recoveryProfile?: RecoveryProfile;
}

/**
 * ─── ENHANCED MRV SCALING (asymmetric, per-muscle-tiered) ──────────────────
 *
 * Rationale (definition-site record): enhanced recovery scales LOCAL muscular
 * recovery most, systemic/axial fatigue much less, and connective-tissue
 * adaptation not at all — so tolerance bumps concentrate in small,
 * isolation-friendly muscles, and spinal-loading-heavy groups stay closest
 * to natural ceilings.
 *
 * Approved multiplier tiers (MRV only):
 *   × 1.35 — delt heads (front/side/rear), biceps, triceps, calves
 *            (incl. gastrocnemius/soleus), forearms
 *   × 1.25 — chest (both heads), glutes (incl. glute_med), traps (all
 *            regions), abs/obliques, adductors
 *   × 1.15 — quads, back (lats/upper_back/erectors), hamstrings
 * Coarse group bands scale with their children's tier (each group's children
 * share one tier, so the roll-up is unambiguous).
 *
 * MEV × 1.0 everywhere — INVARIANT (pinned in bandPresetInvariant.test.ts):
 * enhanced MEV never exceeds standard MEV. Presets shift at most +10%
 * (see recommendVolume) — always less than the MRV scaling: the extra
 * ceiling is headroom for autoregulated exploration, not a prescription.
 *
 * DESIGN INTENT: the scaled MRV is a safe upper bound on rollover
 * exploration, NOT a claim about true individual MRV — the recovery-feedback
 * ramp (with its group budget, once landed) discovers the individual
 * ceiling; the band just bounds the search. Conservative-by-default is
 * deliberate.
 *
 * COMPUTED SCALED TABLE (0.5-set granularity — review record; flag anything
 * implausible here before amending tiers):
 *   coarse: chest 22→27.5, back 28→32, shoulders 26→35, biceps 26→35,
 *           triceps 24→32.5, quads 20→23, hamstrings 20→23, glutes 24→30,
 *           calves 20→27, abs 20→25, traps 20→25, forearms 14→19,
 *           adductors 12→15
 *   fine:   front_delts 14→19, lateral_delts 20→27, rear_delts 20→27,
 *           chest_upper 16→20, chest_lower 12→15, lats 20→23,
 *           upper_back 16→18.5, erectors 12→14, glute_med 10→12.5,
 *           obliques 10→12.5, upper_traps 12→15, mid_lower_traps 10→12.5,
 *           gastrocnemius 16→21.5, soleus 12→17 (via max(mev+2, table))
 *   FLAGGED as aggressive-looking but intentional: shoulders/biceps 35 —
 *   these are CREDITED (indirect-inclusive) ceilings; typical indirect
 *   inflow of 6–16 means the direct-work exploration bound is ~20–29.
 * ───────────────────────────────────────────────────────────────────────────
 */
export const ENHANCED_MRV_MULTIPLIERS: Record<CoarseMuscle, number> = {
  shoulders: 1.35, biceps: 1.35, triceps: 1.35, calves: 1.35, forearms: 1.35,
  chest: 1.25, glutes: 1.25, traps: 1.25, abs: 1.25, adductors: 1.25,
  quads: 1.15, back: 1.15, hamstrings: 1.15,
};

/** Adopted total-inclusive MRV overrides for cross-group-inflow fine muscles
 *  (moved here from weeklyVolume — part of the single band source). */
const FINE_BAND_TOTAL_INCLUSIVE_MRV: Partial<Record<StandardMuscleGroup, number>> = {
  front_delts: 14,
  rear_delts: 20,
};

/** Round a scaled ceiling to 0.5-set granularity. */
const roundHalf = (v: number): number => Math.round(v * 2) / 2;

function isCoarse(muscle: string): muscle is CoarseMuscle {
  return (COARSE_MUSCLES as readonly string[]).includes(muscle);
}

/**
 * THE single landmark read (close-out 3b): card rendering, the allocator
 * clamp, the goal-clamp, child-band synthesis — every consumer resolves
 * bands through this function; nothing outside this module (tests excepted)
 * may touch RESEARCH_VOLUME_BANDS / MEV_TARGETS / the fine-band table
 * directly (enforced by the band-source import-guard test).
 *
 * Coarse ids resolve to the group band; standard-muscle ids resolve to the
 * subdivision band (MEV from MEV_TARGETS — shared with the warning surface —
 * and MRV from the total-inclusive overrides or the intermediate research
 * table, floored at mev+2). Enhanced profiles scale the MRV by the muscle's
 * tier; MEV is NEVER scaled.
 */
/**
 * Per-STANDARD-muscle MEV — the warning-surface threshold. Distinct from
 * getEffectiveBand for the ten muscles whose id is both a standard muscle and
 * a coarse group (hamstrings: per-standard MEV 4, group band MEV 8): the MEV
 * summary and fine-child thresholds read the per-standard value; group rows
 * and generator clamps read the group band. Profile-independent — enhanced
 * scaling never touches an MEV.
 */
export function getStandardMev(muscle: StandardMuscleGroup): number {
  return MEV_TARGETS[muscle];
}

export function getEffectiveBand(
  muscle: CoarseMuscle | StandardMuscleGroup,
  ctx?: BandContext
): VolumeBand {
  let base: VolumeBand;
  let tierKey: CoarseMuscle;
  if (isCoarse(muscle)) {
    base = RESEARCH_VOLUME_BANDS[muscle];
    tierKey = muscle;
  } else {
    const mev = MEV_TARGETS[muscle];
    const mrv =
      FINE_BAND_TOTAL_INCLUSIVE_MRV[muscle] ??
      DEFAULT_VOLUME_LANDMARKS.intermediate[muscle].mrv;
    base = { mev, mrv: Math.max(mev + 2, mrv) };
    tierKey = STANDARD_TO_COARSE[muscle];
  }
  if (ctx?.recoveryProfile !== 'enhanced') return base;
  return { mev: base.mev, mrv: roundHalf(base.mrv * (ENHANCED_MRV_MULTIPLIERS[tierKey] ?? 1)) };
}
