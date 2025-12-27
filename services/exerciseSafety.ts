/**
 * Exercise Failure Safety Tiers
 *
 * Classifies exercises by how safe it is to push to failure.
 * This is separate from injury-based safety (lib/training/exercise-safety.ts).
 *
 * Pure functions - no database calls.
 */

// ============================================
// TYPES
// ============================================

/**
 * Safety tier for pushing to failure
 * - push_freely: Safe to fail (machines, cables, isolation)
 * - push_cautiously: Moderate risk (dumbbells, lunges, supported rows)
 * - protect: High injury risk at failure (heavy barbell compounds)
 */
export type FailureSafetyTier = 'push_freely' | 'push_cautiously' | 'protect';

/**
 * Display information for a safety tier
 */
export interface TierDisplayInfo {
  label: string;
  color: 'green' | 'yellow' | 'red';
  shortLabel: string;
  description: string;
  emoji: string;
}

// ============================================
// PATTERN MATCHING
// ============================================

/** Exercises where failure is dangerous - heavy barbells with no escape */
const PROTECT_PATTERNS = [
  'barbell bench', 'bb bench', 'bench press', 'flat bench',
  'barbell squat', 'bb squat', 'back squat', 'front squat',
  'deadlift', 'conventional deadlift', 'sumo deadlift',
  'barbell row', 'bb row', 'bent over row', 'pendlay row',
  'overhead press', 'ohp', 'military press', 'barbell press',
  'standing press', 'strict press',
  'good morning', // Loaded spinal flexion
];

/** Exercises with moderate risk - free weights that can be dropped or controlled */
const CAUTIOUS_PATTERNS = [
  'dumbbell', 'db ',
  'lunge', 'split squat', 'step up', 'step-up',
  'romanian', 'rdl', 'stiff leg',
  'hip thrust', // Heavy but supported
  'bulgarian',
  'goblet',
  'kettlebell', 'kb ',
  'single leg', 'single-leg',
];

/** Patterns that indicate machine/cable work - always safe */
const SAFE_PATTERNS = [
  'machine', 'cable', 'smith', 'hack squat',
  'leg press', 'leg extension', 'leg curl',
  'chest fly', 'pec deck', 'pec fly',
  'lat pulldown', 'pulldown', 'row machine',
  'seated row', 'chest press machine',
  'shoulder press machine',
  'assisted', // Assisted pull-ups, dips, etc.
];

// ============================================
// CORE FUNCTIONS
// ============================================

/**
 * Determine the failure safety tier for an exercise
 * Used to decide RIR floors and AMRAP eligibility
 */
export function getFailureSafetyTier(exerciseName: string): FailureSafetyTier {
  const lowerName = exerciseName.toLowerCase();

  // Check safe patterns first (machine overrides other patterns)
  if (SAFE_PATTERNS.some(p => lowerName.includes(p))) {
    return 'push_freely';
  }

  // Check protect patterns (dangerous barbell compounds)
  if (PROTECT_PATTERNS.some(p => lowerName.includes(p))) {
    return 'protect';
  }

  // Check cautious patterns (free weights, lunges, etc.)
  if (CAUTIOUS_PATTERNS.some(p => lowerName.includes(p))) {
    return 'push_cautiously';
  }

  // Default to push_freely for anything else (isolation, bodyweight, etc.)
  return 'push_freely';
}

/**
 * Get the minimum RIR (Reps In Reserve) floor for an exercise
 * This is the lowest RIR that should be prescribed for safety
 */
export function getRIRFloor(exerciseName: string): number {
  const tier = getFailureSafetyTier(exerciseName);
  switch (tier) {
    case 'protect':
      return 2; // Never go below RIR 2 on heavy barbell compounds
    case 'push_cautiously':
      return 1; // Keep at least 1 rep in reserve
    case 'push_freely':
      return 0; // Can go to true failure
  }
}

/**
 * Get display information for a safety tier
 */
export function getTierDisplayInfo(tier: FailureSafetyTier): TierDisplayInfo {
  switch (tier) {
    case 'push_freely':
      return {
        label: 'Safe to Fail',
        shortLabel: 'Safe',
        color: 'green',
        emoji: '🟢',
        description: 'Machine and isolation exercises. Safe to push to true failure - this is how we learn your limits.',
      };
    case 'push_cautiously':
      return {
        label: 'Moderate Risk',
        shortLabel: 'Caution',
        color: 'yellow',
        emoji: '🟡',
        description: 'Free weight compounds. Push hard but keep 1 rep in reserve. We\'ll test limits at mesocycle end.',
      };
    case 'protect':
      return {
        label: 'Protect',
        shortLabel: 'Protect',
        color: 'red',
        emoji: '🔴',
        description: 'Heavy barbell compounds. Stay at 2+ RIR minimum. The injury risk of failure far outweighs the benefit of that last rep.',
      };
  }
}

/**
 * Check if an exercise is eligible for AMRAP sets
 * Protected exercises should never be AMRAP unless at mesocycle end
 */
export function isAMRAPEligible(
  exerciseName: string,
  context: {
    isMesocycleEnd?: boolean;
    isReturnFromDeload?: boolean;
    hasRecentAMRAP?: boolean;
  } = {}
): boolean {
  const tier = getFailureSafetyTier(exerciseName);
  const { isMesocycleEnd = false, isReturnFromDeload = false, hasRecentAMRAP = false } = context;

  switch (tier) {
    case 'push_freely':
      // Safe exercises can AMRAP if no recent AMRAP
      return !hasRecentAMRAP;
    case 'push_cautiously':
      // Moderate risk - only at mesocycle end or return from deload
      return isMesocycleEnd || isReturnFromDeload;
    case 'protect':
      // Never AMRAP on protected exercises
      return false;
  }
}

/**
 * Get a warning message if the user is pushing too hard on a protected exercise
 */
export function getProtectWarning(
  exerciseName: string,
  reportedRIR: number
): string | null {
  const tier = getFailureSafetyTier(exerciseName);

  if (tier !== 'protect') return null;

  if (reportedRIR === 0) {
    return `Going to failure on ${exerciseName} significantly increases injury risk. A torn pec, blown disc, or dropped bar isn't worth that last rep. Stay at 2+ RIR on heavy barbell compounds.`;
  }

  if (reportedRIR === 1) {
    return `That was close to failure on ${exerciseName}. We recommend staying at 2+ RIR on heavy compounds to reduce injury risk.`;
  }

  return null;
}

/**
 * Get equipment-specific safety notes
 */
export function getEquipmentSafetyNote(equipment: string): string | null {
  const lowerEquipment = equipment.toLowerCase();

  if (lowerEquipment === 'barbell') {
    return 'Use safety pins/catches when training alone. Never bench or squat heavy without spotters or safeties.';
  }

  if (lowerEquipment === 'dumbbell') {
    return 'Can be dropped safely if you reach failure. Use controlled negatives.';
  }

  if (lowerEquipment === 'machine' || lowerEquipment === 'cable') {
    return 'Safe to push to failure. The machine catches the weight.';
  }

  return null;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if an exercise name matches any patterns in a list
 */
export function matchesAnyPattern(
  exerciseName: string,
  patterns: string[]
): boolean {
  const lowerName = exerciseName.toLowerCase();
  return patterns.some(p => lowerName.includes(p));
}

/**
 * Get all exercises in a tier from a list
 */
export function filterByTier(
  exercises: Array<{ name: string }>,
  tier: FailureSafetyTier
): Array<{ name: string }> {
  return exercises.filter(e => getFailureSafetyTier(e.name) === tier);
}
