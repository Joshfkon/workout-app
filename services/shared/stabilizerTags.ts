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
};

/**
 * Stock exercises deliberately left UNSEEDED because their stabilizer
 * classification was not obvious — enumerated so the review can fill them in
 * rather than the seed guessing (approved-plan rule). Each entry names the
 * open question.
 */
export const UNSEEDED_STABILIZER_EXERCISES: ReadonlyArray<{
  name: string;
  question: string;
}> = [
  { name: 'Barbell Curl', question: 'standing barbell arm work — is the erector demand meaningful, or noise relative to a curl anchor?' },
  { name: 'EZ Bar Curl', question: 'same question as Barbell Curl' },
  { name: 'Bulgarian Split Squat', question: 'erectors likely; forearms only when dumbbell-held — equipment varies per user' },
  { name: 'Cossack Squat', question: 'loaded vs bodyweight varies; erector demand unclear' },
  { name: 'Adductor Side Lunge', question: 'loaded vs bodyweight varies; erector demand unclear' },
  { name: 'Cable Fly', question: 'cuff loaded in deep stretch — stabilizer-grade or negligible?' },
  { name: 'Seated Cable Fly', question: 'same question as Cable Fly' },
  { name: 'Dumbbell Fly', question: 'same question as Cable Fly, deeper stretch under load' },
  { name: 'Pec Deck', question: 'same question as Cable Fly' },
  { name: 'Lateral Raise', question: 'cuff involvement is real but loads are light — gate-worthy?' },
  { name: 'Behind-the-Back Cable Lateral Raise', question: 'same question as Lateral Raise' },
  { name: 'Cable Cross Body Lateral Raise', question: 'same question as Lateral Raise' },
  { name: 'Machine Lateral Raise', question: 'same question as Lateral Raise' },
  { name: 'Front Raise', question: 'same question as Lateral Raise' },
  { name: 'Cable Y-Raise', question: 'raise vs pull — forearm and cuff grading unclear' },
  { name: 'Overhead Tricep Extension', question: 'shoulder held at end-range overhead — cuff stabilizer?' },
  { name: 'Cable Overhead Tricep Extension', question: 'same question as Overhead Tricep Extension' },
  { name: 'Katana Tricep Extension', question: 'same question as Overhead Tricep Extension' },
  { name: 'L-Sit', question: 'scapular/cuff loading in support position?' },
  { name: 'Cable Woodchop', question: 'standing anti-rotation — erector grading unclear' },
  { name: 'Pallof Press', question: 'standing anti-rotation — erector grading unclear' },
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
