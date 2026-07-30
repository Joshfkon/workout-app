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
 *  3. MEV floor: the smallest integer preset whose WORST goal output (cut,
 *     ×0.7 with rounding) still lands at/above the group's band MEV — a
 *     preset that prescribes below the minimum effective dose is broken, not
 *     conservative.
 *  4. Proposed value = max(round(P_same), MEV floor). Where the floor binds,
 *     the proposal INCREASES the real dose relative to pre-cap behavior —
 *     flagged, because those are exactly the presets that were prescribing
 *     below MEV all along (the cap only made it visible).
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

/**
 * The smallest integer base preset whose output at `goal` (recommendVolume's
 * rounding included) is still ≥ mev. Cut (×0.7) is always the binding goal.
 */
function goalMultiplier(goal: Goal): number {
  if (goal === 'cut') return 0.7;
  if (goal === 'bulk') return 1.1;
  return 1;
}

export function mevFloorPreset(mev: number): number {
  let p = 1;
  while (Math.round(p * 0.7) < mev) p++;
  return p;
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
  /** Smallest integer preset whose cut output still clears the band MEV. */
  mevFloor: number;
  /** max(round(sameRealDose), mevFloor) — the value proposed for review. */
  proposedPreset: number;
  /** true where the MEV floor raised the proposal ABOVE the same-real-dose
   *  value — i.e. the old preset was prescribing below MEV in real terms. */
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
    const band = getEffectiveBand(group);
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
      const floor = mevFloorPreset(band.mev);
      const proposedPreset = Math.max(Math.round(sameRealDosePreset), floor);
      rows.push({
        group,
        experience,
        oldPreset,
        oldOutput,
        capRatio: Math.round(ratio * 1000) / 1000,
        newTrackedOutput,
        sameRealDosePreset,
        mevFloor: floor,
        proposedPreset,
        floorBinds: floor > Math.round(sameRealDosePreset),
      });
    }
  }
  return rows;
}

/**
 * THE hard assertion (Change-2 requirement): no preset may prescribe below
 * the group's band MEV for ANY goal setting. Returns human-readable
 * violations; empty = compliant.
 *
 * Applied to the PROPOSED values now (they must ship compliant); when the
 * proposal is applied to recommendVolume, point this at the live outputs and
 * it becomes the permanent regression gate — see
 * currentPresetMevViolations() for why it cannot be pointed at the live
 * table yet.
 */
export function presetMevViolations(
  presetFor: (experience: Experience, goal: Goal, group: CoarseMuscle) => number,
  recoveryProfile: RecoveryProfile = 'standard'
): string[] {
  const violations: string[] = [];
  for (const group of COARSE_MUSCLES) {
    const mev = getEffectiveBand(group, { recoveryProfile }).mev;
    for (const experience of EXPERIENCES) {
      for (const goal of GOALS) {
        const out = presetFor(experience, goal, group);
        if (out < mev) {
          violations.push(`${group}/${experience}/${goal}: ${out} < MEV ${mev}`);
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
 * The LIVE table's violations of the MEV rule, in its own (pre-cap) currency.
 * Pinned in the test so the current state is explicit: several novice cut
 * outputs sit below MEV even before the cap — the recalibration must fix
 * these, which is why the hard assertion can only gate the proposal until
 * the new values are applied.
 */
export function currentPresetMevViolations(): string[] {
  return presetMevViolations((experience, goal, group) =>
    recommendVolume(experience, goal, group)
  );
}
