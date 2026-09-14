/**
 * stabilizerTags — canonical stabilizer classification for the STOCK exercise
 * library (the reconciled source of truth for `exercises.stabilizers`).
 *
 * History: the `stabilizers` column has existed since 20241221000001 but the
 * seed never populated it (every stock row carried '{}'), while
 * services/exerciseService.ts shipped a drifted, hand-written fallback list
 * using coarse legacy tags ('back', 'abs') that nothing consumed. This module
 * replaces both: the seed migration (20260825000002_seed_stabilizers.sql) is
 * generated from THIS map, the static fallback catalog overrides its entries
 * from it (same mechanism as SEED_EXERCISE_TAGS), and mapDbExercise falls back
 * to it on rows the migration has not reached. A drift-guard test parses the
 * migration and compares it to this map
 * (services/__tests__/stabilizerSeed.test.ts).
 *
 * CUSTOM rows never fall back at read time, but a one-time backfill
 * (20260913000001_backfill_custom_stabilizers.sql, its own drift guard in
 * services/__tests__/stabilizerCustomBackfill.test.ts) copied an entry's tags
 * onto EMPTY custom rows whose normalized name token-set matches it (a user's
 * 'Shrug (Dumbbell)' ↔ 'Dumbbell Shrug') — on a custom row, '{}' is
 * indistinguishable from never-classified, and such rows silently opted out
 * of the warning AND the dose credit. Custom rows already carrying tags were
 * not touched. Editing this map means updating BOTH migrations.
 *
 * SEMANTICS — a stabilizer tag means two things, both consumed ONLY by the
 * stabilizer-recovery channel in services/muscleRecovery (never volume credit,
 * never the prescription engine):
 *   1. DOSE: sets of this exercise load the listed muscle isometrically, at
 *      `stabilizerDoseFactor` of a primary set (capped, never stacked with a
 *      primary/secondary tag for the same muscle).
 *   2. REQUIREMENT: the exercise cannot be performed heavy without this
 *      muscle, so a fatigued stabilizer gates a pre-set warning on it
 *      (evaluateStabilizerWarning). A muscle that is merely a SECONDARY mover
 *      does not gate — only a stabilizer tag does.
 *
 * SCOPE: values are restricted to the stabilizer-TRACKED muscles
 * (STABILIZER_TRACKED_MUSCLES): erectors, rotator_cuff, rear_delts, forearms.
 * Other isometric contributors (abs on nearly everything) are deliberately
 * not tagged — they are not what this channel models and would only add noise.
 *
 * CLASSIFICATION RULES (approved spec):
 *   - erectors      → rows (unsupported), hinges, squats, carries, and heavy
 *                     standing loaded work. NOT on machine-supported variants
 *                     (that support is exactly the mitigation the warning
 *                     suggests) and NOT where erectors are already the primary
 *                     mover (the muscle-readiness sheet covers those).
 *   - rotator_cuff  → horizontal/vertical pressing and heavy overhead work;
 *                     also direct external-rotation-dominant pulls (face
 *                     pulls, reverse flys) so cuff dose from that work is not
 *                     invisible to the channel.
 *   - rear_delts    → horizontal/vertical pressing (isometric humeral-head
 *                     control). Not listed where rear_delts is already a
 *                     primary/secondary mover.
 *   - forearms      → all hand-supported pulling (rows, pulldowns, pull-ups,
 *                     shrugs, upright rows, hangs from a bar) where forearms
 *                     is not already the primary mover.
 *
 * Exercises whose classification was NOT obvious are deliberately absent and
 * enumerated in UNSEEDED_STABILIZER_EXERCISES for Josh to fill in — per the
 * approved plan, no guessing.
 *
 * COVERAGE (2026-09-13 audit, docs/STABILIZER_COVERAGE_AUDIT.md, approved):
 * every stock exercise now lives in exactly ONE of STABILIZERS_BY_EXERCISE_NAME,
 * NO_STABILIZERS_BY_DECISION, or UNSEEDED_STABILIZER_EXERCISES — enforced by
 * services/__tests__/stabilizerCoverage.test.ts, so a new stock exercise fails
 * CI until it is classified. The audit's additions ship in
 * 20260913000002 (stock) + 20260913000003 (matching customs).
 */

import type { StandardMuscleGroup } from '@/types/schema';

/** The muscles the stabilizer-recovery channel tracks (window overrides in
 *  services/muscleRecovery RECOVERY_CONFIG.stabilizerWindowHoursByMuscle). */
export const STABILIZER_TRACKED_MUSCLES = [
  'erectors',
  'rotator_cuff',
  'rear_delts',
  'forearms',
] as const satisfies readonly StandardMuscleGroup[];

export type StabilizerTrackedMuscle = (typeof STABILIZER_TRACKED_MUSCLES)[number];

/**
 * Canonical stock-library stabilizer tags, keyed by exercise name (the same
 * name key SEED_EXERCISE_TAGS uses). Only names present here are seeded;
 * absent names keep whatever their row already carries.
 */
export const STABILIZERS_BY_EXERCISE_NAME: Record<string, StabilizerTrackedMuscle[]> = {
  // ── Hinges ───────────────────────────────────────────────────────────────
  'Deadlift': ['erectors', 'forearms'],
  'Sumo Deadlift': ['erectors', 'forearms'],
  'Romanian Deadlift': ['erectors', 'forearms'],
  'Stiff Leg Deadlift': ['erectors', 'forearms'],
  'Single Leg RDL': ['erectors', 'forearms'],
  'Good Morning': ['erectors'],
  'Cable Pull Through': ['erectors', 'forearms'],

  // ── Squats / standing lower-body ─────────────────────────────────────────
  'Barbell Back Squat': ['erectors'],
  'Smith Machine Squat': ['erectors'],
  // Audit 2026-09-13: heavy rear-elevated work is un-supported standing load,
  // matching the lunge family below. Forearms deliberately NOT tagged — it
  // only applies when dumbbell-held and tags cannot condition on equipment.
  'Bulgarian Split Squat': ['erectors'],
  'Walking Lunges': ['erectors'],
  'Reverse Lunge': ['erectors'],
  'Step Up': ['erectors'],
  'Standing Calf Raise': ['erectors'],
  'Smith Machine Calf Raise': ['erectors'],

  // ── Carries ──────────────────────────────────────────────────────────────
  "Farmer's Carry": ['erectors'],
  'Suitcase Carry': ['erectors', 'forearms'],
  'Overhead Carry': ['erectors', 'rotator_cuff'],

  // ── Rows and hand-supported pulling ──────────────────────────────────────
  'Barbell Row': ['erectors', 'forearms'],
  'Meadows Row': ['erectors', 'forearms'],
  'Cable Row': ['erectors', 'forearms'],
  'Wide-Grip Seated Cable Row': ['erectors', 'forearms'],
  'Dumbbell Row': ['forearms'],
  'Seated Machine Row': ['forearms'],
  'Chest Supported Row': ['forearms'],
  'Seal Row': ['forearms'],
  'Pull-Ups': ['forearms'],
  'Assisted Pull-Up': ['forearms'],
  'Assisted Pull-Up Machine': ['forearms'],
  'Lat Pulldown': ['forearms'],
  'Close Grip Lat Pulldown': ['forearms'],
  'Straight Arm Pulldown': ['forearms'],
  'Hanging Leg Raise': ['forearms'],
  'Barbell Shrug': ['erectors', 'forearms'],
  'Dumbbell Shrug': ['erectors', 'forearms'],
  'Upright Row': ['forearms', 'rotator_cuff'],
  'Cable Upright Row': ['forearms', 'rotator_cuff'],

  // ── Horizontal pressing ──────────────────────────────────────────────────
  'Barbell Bench Press': ['rotator_cuff', 'rear_delts'],
  'Dumbbell Bench Press': ['rotator_cuff', 'rear_delts'],
  'Incline Dumbbell Press': ['rotator_cuff', 'rear_delts'],
  'Decline Barbell Press': ['rotator_cuff', 'rear_delts'],
  'Machine Chest Press': ['rotator_cuff', 'rear_delts'],
  'Smith Machine Bench Press': ['rotator_cuff', 'rear_delts'],
  'Smith Machine Incline Press': ['rotator_cuff', 'rear_delts'],
  'Close Grip Bench Press': ['rotator_cuff', 'rear_delts'],
  'Dips (Chest Focus)': ['rotator_cuff', 'rear_delts'],
  'Dips (Tricep Focus)': ['rotator_cuff', 'rear_delts'],
  'Assisted Dip Machine': ['rotator_cuff', 'rear_delts'],

  // ── Overhead pressing (standing barbell adds the erector demand) ─────────
  'Overhead Press': ['rotator_cuff', 'rear_delts', 'erectors'],
  'Dumbbell Shoulder Press': ['rotator_cuff', 'rear_delts'],
  'Smith Machine Shoulder Press': ['rotator_cuff', 'rear_delts'],

  // ── External-rotation-dominant pulls (cuff dose visibility) ──────────────
  'Face Pull': ['rotator_cuff'],
  'Rear Delt Fly': ['rotator_cuff'],
  'Rear Delt Machine': ['rotator_cuff'],
  'Reverse Cable Crossover': ['rotator_cuff'],
  'Prone Y-Raise': ['rotator_cuff'],
  'Band Pull-Apart': ['rotator_cuff'],

  // ── Cuff loaded at end range (2026-09-13 audit) ───────────────────────────
  // Dumbbell Fly is the one fly variant where the cuff carries full load in
  // the deepest stretch (cable flys and Pec Deck stay untagged — resistance
  // falls off / machine guides the path). The overhead extensions hold the
  // shoulder at end-range flexion under load for the whole set — the same
  // dose-visibility argument as the external-rotation group above.
  'Dumbbell Fly': ['rotator_cuff'],
  'Overhead Tricep Extension': ['rotator_cuff'],
  'Cable Overhead Tricep Extension': ['rotator_cuff'],
  'Katana Tricep Extension': ['rotator_cuff'],
};

/**
 * Stock exercises deliberately left UNSEEDED because their stabilizer
 * classification was not obvious — enumerated so the review can fill them in
 * rather than the seed guessing (approved-plan rule). Each entry names the
 * open question.
 *
 * Emptied 2026-09-13: every open question was resolved by the coverage audit
 * (docs/STABILIZER_COVERAGE_AUDIT.md, approved by Josh). Six names moved into
 * STABILIZERS_BY_EXERCISE_NAME; the rest are recorded in
 * NO_STABILIZERS_BY_DECISION. A NEW stock exercise with a genuinely open
 * question goes here — the coverage guard test forces every stock name into
 * exactly one of the three lists.
 */
export const UNSEEDED_STABILIZER_EXERCISES: ReadonlyArray<{
  name: string;
  question: string;
}> = [];

/**
 * Stock exercises DECIDED to carry no stabilizer tags — the explicit
 * complement of STABILIZERS_BY_EXERCISE_NAME, so "no tags by decision" is
 * distinguishable from "no tags by omission" (the failure mode that made an
 * exercise silently invisible to the stabilizer-recovery channel).
 *
 * Per-exercise reasons live in docs/STABILIZER_COVERAGE_AUDIT.md (reason
 * groups A–H and F3); the common ones: the tracked muscle is already the
 * PRIMARY mover (wrist curls, dead hang — the mover tag feeds the dose
 * channel and the readiness sheet covers the warning), machine/bench/pad
 * support removes the demand (leg press family), loads too light to gate
 * (lateral raises, standing curls), or core work whose tracked-muscle demand
 * is minimal. Documentation + guard-test input only — no runtime consumer.
 */
export const NO_STABILIZERS_BY_DECISION: readonly string[] = [
  '45° Preacher Curl',
  'Ab Wheel Rollout',
  'Adductor Side Lunge',
  'Back Extension',
  'Banded Lateral Walk',
  'Barbell Curl',
  'Barbell Reverse Wrist Curl',
  'Barbell Wrist Curl',
  'Bayesian Cable Curl',
  'Behind-the-Back Cable Lateral Raise',
  'Behind-the-Back Wrist Curl',
  'Cable Bicep Curl',
  'Cable Cross Body Lateral Raise',
  'Cable Crunch',
  'Cable Curl',
  'Cable Fly',
  'Cable Hip Abduction',
  'Cable Hip Adduction',
  'Cable Tricep Pushdown',
  'Cable Woodchop',
  'Cable Y-Raise',
  'Calf Press Machine',
  "Captain's Chair Leg Raise",
  'Clamshell',
  'Concentration Curl',
  'Copenhagen Plank',
  'Cossack Squat',
  'Dead Bug',
  'Dead Hang',
  'Decline Crunch',
  'Donkey Calf Raise',
  'Dumbbell Curl',
  'Dumbbell Kickback',
  'Dumbbell Side Bend',
  'Dumbbell Wrist Curl',
  'EZ Bar Curl',
  'EZ Bar Reverse Curl',
  'Front Raise',
  'Glute Bridge',
  'Glute Bridge Hold',
  'Glute Drive Machine',
  'Hack Squat',
  'Hammer Curl',
  'Hammer Strength Ab Crunch',
  'Hip Abduction Machine',
  'Hip Adduction Machine',
  'Hip Thrust',
  'Hollow Body Hold',
  'Incline Dumbbell Curl',
  'Incline Leg Press',
  'Jefferson Curl',
  'L-Sit',
  'Lateral Raise',
  'Leg Extension',
  'Leg Press',
  'Leg Press Calf Raise',
  'Lying Leg Curl',
  'Machine Ab Crunch',
  'Machine Back Extension',
  'Machine Bicep Curl',
  'Machine Lateral Raise',
  'Machine Tricep Extension',
  'Nordic Curl',
  'Pallof Press',
  'Pec Deck',
  'Pendulum Squat',
  'Plank',
  'Plate Pinch Hold',
  'Preacher Curl',
  'RKC Plank',
  'Reverse Wrist Curl',
  'Rope Tricep Pushdown',
  'Russian Twist',
  'Seated Cable Fly',
  'Seated Calf Raise',
  'Seated Leg Curl',
  'Side Plank',
  'Side-Lying Hip Abduction',
  'Single Leg Calf Raise',
  'Single Leg Hip Thrust',
  'Sissy Squat',
  'Skull Crusher',
  'Superman Hold',
  'Tricep Pushdown',
  'Triceps Extension (Dumbbell)',
  'Wall Sit',
  'Wrist Roller',
];

/** Lookup with the same name-key convention as SEED_EXERCISE_TAGS. */
export function stabilizersForExerciseName(name: string): StabilizerTrackedMuscle[] | undefined {
  return STABILIZERS_BY_EXERCISE_NAME[name];
}

/**
 * Per-muscle mitigation copy for the pre-set stabilizer warning banner.
 * The load-drop suggestion is computed by the caller (it needs the reference
 * load and the configured intensity gate); these are the qualitative options.
 */
export const STABILIZER_MITIGATIONS: Record<StabilizerTrackedMuscle, string[]> = {
  erectors: [
    'Swap to a chest-supported or machine variant',
    'Move this exercise later in the session',
  ],
  forearms: [
    'Use straps',
    'Swap to a supported or neutral-grip variant',
    'Skip direct grip work today',
  ],
  rotator_cuff: [
    'Warm the cuff up thoroughly before working sets',
    'Swap to a machine press or neutral-grip variant',
  ],
  rear_delts: [
    'Swap to a supported variant',
    'Move pressing later in the session',
  ],
};
