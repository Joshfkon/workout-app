/**
 * Preset re-derivation for the group set-credit cap — REPORT ONLY.
 *
 * Context (Change 2 of the group-cap follow-up, 2026-07-30): the authored
 * GROUP BANDS in services/volumeBands are external research landmarks and are
 * NOT touched here. mesocycleBuilder's volume presets (recommendVolume's base
 * table, the ×0.7 cut / ×1.1 bulk multipliers, and the MRV clamp) are a
 * different thing: they were tuned against observed app behavior — i.e.
 * against the PRE-CAP inflated credited numerator — and are therefore
 * miscalibrated now that tracking applies the per-group cap
 * (services/shared/volumeCredit).
 *
 * This module DERIVES the recalibrated values; it does not apply them.
 * recommendVolume still returns the old values until the proposal table
 * (docs/PRESET_RECALIBRATION_PROPOSAL.md) is reviewed and applied.
 *
 * Method:
 *  1. Measure each group's cap ratio ρ = capped / uncapped credited volume
 *     over the generated reference templates (3d / 4d / 6d, intermediate),
 *     under BOTH tag sources: the template pool as currently authored, and
 *     the seed-convention tags each exercise will carry after the Change-4
 *     retag (the state the recalibration will ship into).
 *  2. Same-real-dose value: a preset stated in CAPPED currency that makes a
 *     capped-projecting generator (Change 3) prescribe the SAME real working
 *     sets the old preset produced: P_same = ρ × P_old.
 *  3. GOAL-AWARE floor (corrected 2026-07-30): growth-goal outputs
 *     (bulk / maintenance / recomp) must clear the group's band MEV; CUT
 *     outputs must clear MAINTENANCE VOLUME (MV) — the retention minimum,
 *     which sits below MEV. MV is not authored anywhere in the zone config;
 *     PROPOSED_MAINTENANCE_VOLUME below is a flagged authoring proposal, not
 *     an adopted landmark.
 *  4. Proposed value = max(round(P_same), floor). Where the floor binds, the
 *     proposal INCREASES the real dose relative to pre-cap behavior —
 *     flagged so a dose change is always a visible, deliberate correction.
 *
 * STATUS: application ATTEMPTED 2026-07-30 and REVERTED the same day (PR
 * #568, Codex P1). The "P′ = ρ × P_old + capped projection cancels" argument
 * holds only where the allocator's TRIM pass is the binding constraint; where
 * selection caps / fatigue budgets bind, preset changes shift the initial
 * allocation non-proportionally. Measured full-grid deltas at the attempted
 * v3 values: advanced-maintenance calves 6 → 12 real sets (4d/6d), advanced
 * bulk 3d triceps 14 → 10, advanced bulk glutes 11 → 14. DO NOT re-apply
 * until the pairing is validated (or the allocation constrained) across the
 * FULL experience × goal × days grid, not just intermediate bulk/cut.
 *
 * Placeholder-MV gate result (still valid, application-independent): the
 * five 0.5×MEV placeholders (glutes/abs/traps/forearms/adductors) are INERT —
 * cutFloor(MV) < group MEV for each, so the base floor is always the MEV
 * constraint and no proposal is raised by an invented number. Real MV
 * authoring stays deferred until one would bind.
 */

import { generateFullProgram, recommendVolume } from './mesocycleBuilder';
import { perSetGroupCredits } from './shared/volumeCredit';
import { SEED_EXERCISE_TAGS } from './generated/seedExerciseTags';
import {
  COARSE_MUSCLES,
  getEffectiveBand,
  type CoarseMuscle,
  type RecoveryProfile,
} from './volumeBands';
import type { ExtendedUserProfile, Goal, Rating } from '@/types/schema';

export type Experience = 'novice' | 'intermediate' | 'advanced';
export const EXPERIENCES: readonly Experience[] = ['novice', 'intermediate', 'advanced'];
export const GOALS: readonly Goal[] = ['bulk', 'maintenance', 'cut', 'recomp'];

/** Which muscle tags the measurement resolves each generated exercise with. */
export type TagSource = 'template' | 'seed-convention';

const REFERENCE_DAYS = [3, 4, 6] as const;

function referenceProfile(goal: Goal): ExtendedUserProfile {
  return {
    goal,
    experience: 'intermediate',
    heightCm: 175,
    latestDexa: null,
    age: 30,
    sleepQuality: 3 as Rating,
    stressLevel: 3 as Rating,
    trainingAge: 2,
    availableEquipment: ['barbell', 'dumbbell', 'cable', 'machine'],
    injuryHistory: [],
    enhancedAthleteMode: false,
  };
}

export interface CapRatio {
  group: CoarseMuscle;
  /** Pooled uncapped credited sets across the reference templates. */
  uncapped: number;
  /** Pooled capped credited sets across the same templates. */
  capped: number;
  /** capped / uncapped; 1 when the group receives no credit. */
  ratio: number;
}

/**
 * Measure per-group cap ratios over the generated reference templates.
 * Pooled (Σcapped / Σuncapped) across 3d/4d/6d AND the given goals, so
 * neither a single template's nor a single goal's exercise mix dominates
 * (e.g. glutes bind in the bulk mix but not the cut mix).
 */
export function measureCapRatios(
  goals: readonly Goal[],
  tagSource: TagSource
): Record<CoarseMuscle, CapRatio> {
  const uncapped = new Map<CoarseMuscle, number>();
  const capped = new Map<CoarseMuscle, number>();

  for (const goal of goals) for (const days of REFERENCE_DAYS) {
    const program = generateFullProgram(days, referenceProfile(goal), 60);
    for (const session of program.sessions) {
      for (const ex of session.exercises) {
        const seed = SEED_EXERCISE_TAGS[ex.exercise.name];
        const primary =
          tagSource === 'seed-convention' && seed ? seed.primary : ex.exercise.primaryMuscle;
        const secondaries =
          tagSource === 'seed-convention' && seed
            ? seed.secondaries
            : ex.exercise.secondaryMuscles ?? [];
        for (const g of perSetGroupCredits(primary, secondaries)) {
          uncapped.set(g.group, (uncapped.get(g.group) ?? 0) + g.uncapped * ex.sets);
          capped.set(g.group, (capped.get(g.group) ?? 0) + g.credit * ex.sets);
        }
      }
    }
  }

  const out = {} as Record<CoarseMuscle, CapRatio>;
  for (const group of COARSE_MUSCLES) {
    const u = uncapped.get(group) ?? 0;
    const c = capped.get(group) ?? 0;
    out[group] = { group, uncapped: u, capped: c, ratio: u > 0 ? c / u : 1 };
  }
  return out;
}

function goalMultiplier(goal: Goal): number {
  if (goal === 'cut') return 0.7;
  if (goal === 'bulk') return 1.1;
  return 1;
}

// ─── MAINTENANCE VOLUME (MV) — PROVISIONAL AUTHORING PROPOSAL ───────────────
//
// The zone config authors MEV/MAV/MRV only; NO maintenance-volume landmark
// exists anywhere in the app (verified 2026-07-30). That is the real gap the
// original "cut preset below MEV" finding pointed at: MEV is the minimum for
// GROWTH; a cut targets RETENTION, whose minimum (MV) sits meaningfully
// below MEV — so a ×0.7 cut output under MEV is not per-se a defect. The
// corrected floor rule is therefore:
//     bulk / maintenance / recomp outputs ≥ group MEV
//     cut outputs                        ≥ group MV
//
// The values below are a PROPOSAL requiring an explicit authoring decision —
// they are NOT silently derived as one uniform fraction of MEV:
//  - Where Renaissance Periodization publishes per-muscle MV alongside MEV
//    (Israetel et al., RP hypertrophy guides), the RP MV:MEV ratio is applied
//    to OUR authored (total-inclusive) group MEV: pecs 8/10 → chest ×0.8,
//    back 8/10 → ×0.8, quads 6/8 → ×0.75, hamstrings 4/6 → ×0.67,
//    side delts 6/8 → shoulders ×0.75, biceps 5/8 → ×0.62,
//    triceps 4/6 → ×0.67, calves 6/8 → ×0.75.
//  - glutes / abs / traps: RP lists MV ≈ 0 for lifters doing compound work.
//    Our counter is total-inclusive and already credits that compound work,
//    but a literal 0 would let a cut prescribe zero — these use a DECLARED
//    0.5 × MEV placeholder instead (flagged, not evidence-derived).
//  - forearms / adductors: no published MV — same declared 0.5 × MEV
//    placeholder.
// Maintenance-dose literature (Bickel 2011: 1/9–1/3 of building volume
// maintained size in younger adults; Iversen 2021: ~4 weekly sets as a
// minimum effective dose) suggests these values are conservative (high) —
// safe as floors.
export const PROPOSED_MAINTENANCE_VOLUME: Record<CoarseMuscle, number> = {
  chest: 6, //      8 × 0.8
  back: 8, //      10 × 0.8 (tracked its band down when erectors were promoted
  //                out of the group — same RP ×0.8 rule, new group MEV)
  shoulders: 9, // 12 × 0.75
  biceps: 6, //    10 × 0.62
  triceps: 5, //    8 × 0.67
  quads: 6, //      8 × 0.75
  hamstrings: 5, // 8 × 0.67
  glutes: 3, //     6 × 0.5 (placeholder)
  calves: 6, //     8 × 0.75
  abs: 3, //        6 × 0.5 (placeholder)
  traps: 3, //      6 × 0.5 (placeholder)
  forearms: 2, //   4 × 0.5 (placeholder)
  adductors: 2, //  4 × 0.5 (placeholder)
  // Erectors: RP lists MV ≈ 0 for lifters doing compound work, and erector
  // volume is almost entirely hinge/squat credit — same declared 0.5 × MEV
  // placeholder as glutes/abs/traps, for the same reason (a literal 0 would
  // let a cut prescribe zero).
  erectors: 2, //   4 × 0.5 (placeholder)
};

/** The volume floor a preset's output must clear at a given goal:
 *  MV on a cut (retention), MEV everywhere else (growth). */
export function goalVolumeFloor(
  goal: Goal,
  group: CoarseMuscle,
  recoveryProfile: RecoveryProfile = 'standard'
): number {
  if (goal === 'cut') return PROPOSED_MAINTENANCE_VOLUME[group];
  return getEffectiveBand(group, { recoveryProfile }).mev;
}

/** Smallest integer base preset whose ×0.7 cut output still clears `mv`. */
export function cutFloorPreset(mv: number): number {
  let p = 1;
  while (Math.round(p * 0.7) < mv) p++;
  return p;
}

/**
 * The base-preset floor under the goal-aware rule: maintenance/recomp output
 * IS the base (so base ≥ MEV), bulk (×1.1) is implied by that, and the cut
 * output must clear MV.
 */
export function presetFloor(group: CoarseMuscle): number {
  return Math.max(getEffectiveBand(group).mev, cutFloorPreset(PROPOSED_MAINTENANCE_VOLUME[group]));
}

export interface PresetRecalibrationRow {
  group: CoarseMuscle;
  experience: Experience;
  /** Current base preset (maintenance output of recommendVolume). */
  oldPreset: number;
  /** Current per-goal outputs — also what tracking read PRE-cap (the
   *  allocator converges the uncapped credited total to these). */
  oldOutput: Record<Goal, number>;
  /** Measured cap ratio under seed-convention tags (the post-Change-4 state). */
  capRatio: number;
  /** What tracking reads POST-cap for the same generated program if the
   *  presets are left as-is: ratio × oldOutput. */
  newTrackedOutput: Record<Goal, number>;
  /** Capped-currency preset preserving the pre-cap REAL set dose (one decimal). */
  sameRealDosePreset: number;
  /** Goal-aware base floor: max(MEV for maintenance output, cut-output ≥ MV). */
  floor: number;
  /** max(round(sameRealDose), floor) — the value proposed for review. */
  proposedPreset: number;
  /** true where the floor raised the proposal ABOVE the same-real-dose value —
   *  i.e. the old preset was prescribing below the applicable floor in real
   *  terms (under the corrected rule: MEV for growth goals, MV for cut). */
  floorBinds: boolean;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Derive the full recalibration table from measured cap ratios.
 * `ratios` should be the seed-convention measurement (the state the values
 * will ship into); pass a template-tag measurement to see the interim world.
 */
export function derivePresetRecalibration(
  ratios: Record<CoarseMuscle, CapRatio>
): PresetRecalibrationRow[] {
  const rows: PresetRecalibrationRow[] = [];
  for (const group of COARSE_MUSCLES) {
    const ratio = ratios[group].ratio;
    for (const experience of EXPERIENCES) {
      const oldPreset = recommendVolume(experience, 'maintenance', group);
      const oldOutput = {} as Record<Goal, number>;
      const newTrackedOutput = {} as Record<Goal, number>;
      for (const goal of GOALS) {
        oldOutput[goal] = recommendVolume(experience, goal, group);
        newTrackedOutput[goal] = round1(oldOutput[goal] * ratio);
      }
      const sameRealDosePreset = round1(oldPreset * ratio);
      const floor = presetFloor(group);
      const proposedPreset = Math.max(Math.round(sameRealDosePreset), floor);
      rows.push({
        group,
        experience,
        oldPreset,
        oldOutput,
        capRatio: Math.round(ratio * 1000) / 1000,
        newTrackedOutput,
        sameRealDosePreset,
        floor,
        proposedPreset,
        floorBinds: floor > Math.round(sameRealDosePreset),
      });
    }
  }
  return rows;
}

/**
 * THE hard assertion (Change-2 requirement, corrected 2026-07-30): a preset's
 * output must clear the GOAL-APPROPRIATE floor — MEV for growth goals
 * (bulk / maintenance / recomp), MV for cut (retention). Returns
 * human-readable violations; empty = compliant.
 *
 * Applied to both the PROPOSED and the LIVE values (the live table is
 * compliant under the corrected rule — the earlier "seven novice-cut
 * violations" were an artifact of holding cut outputs to the growth floor).
 */
export function presetFloorViolations(
  presetFor: (experience: Experience, goal: Goal, group: CoarseMuscle) => number,
  recoveryProfile: RecoveryProfile = 'standard'
): string[] {
  const violations: string[] = [];
  for (const group of COARSE_MUSCLES) {
    for (const experience of EXPERIENCES) {
      for (const goal of GOALS) {
        const floor = goalVolumeFloor(goal, group, recoveryProfile);
        const out = presetFor(experience, goal, group);
        if (out < floor) {
          violations.push(
            `${group}/${experience}/${goal}: ${out} < ${goal === 'cut' ? 'MV' : 'MEV'} ${floor}`
          );
        }
      }
    }
  }
  return violations;
}

/** Goal-adjusted output of a PROPOSED base preset, mirroring recommendVolume's
 *  arithmetic (multiplier, rounding, MRV clamp). */
export function proposedOutput(
  base: number,
  goal: Goal,
  group: CoarseMuscle,
  recoveryProfile: RecoveryProfile = 'standard'
): number {
  const v = Math.round(base * goalMultiplier(goal));
  return Math.min(v, getEffectiveBand(group, { recoveryProfile }).mrv);
}

/**
 * The LIVE table's violations of the goal-aware floor rule, in its own
 * (pre-cap) currency. EMPTY under the corrected rule (pinned): every current
 * cut output clears the proposed MV, and every growth-goal output clears
 * MEV — the previously reported "seven novice-cut MEV violations" dissolve
 * once cut presets are held to the retention floor they actually target.
 */
export function currentPresetFloorViolations(): string[] {
  return presetFloorViolations((experience, goal, group) =>
    recommendVolume(experience, goal, group)
  );
}
