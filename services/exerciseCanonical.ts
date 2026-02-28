/**
 * Exercise Canonicalization Module
 *
 * Centralized logic for normalizing and matching exercise names.
 * This module provides consistent exercise name matching across the codebase,
 * supporting fuzzy matching, aliases, and name normalization.
 */

export interface CanonicalExercise {
  key: string;           // Lowercase, normalized key for lookups
  displayName: string;   // User-friendly name
  aliases: string[];     // Alternative names that map to this
}

/**
 * Canonical exercise definitions with their aliases
 * These are the "standard" exercise names used throughout the app
 */
const CANONICAL_EXERCISES: CanonicalExercise[] = [
  // Chest exercises
  {
    key: 'barbell_bench_press',
    displayName: 'Barbell Bench Press',
    aliases: ['bench press', 'flat bench', 'bb bench', 'barbell bench', 'bench']
  },
  {
    key: 'incline_barbell_press',
    displayName: 'Incline Barbell Press',
    aliases: ['incline press', 'incline bench', 'incline bb press', 'incline barbell bench']
  },
  {
    key: 'dumbbell_bench_press',
    displayName: 'Dumbbell Bench Press',
    aliases: ['db bench', 'dumbbell bench', 'db bench press', 'dumbbell flat bench']
  },
  {
    key: 'incline_dumbbell_press',
    displayName: 'Incline Dumbbell Press',
    aliases: ['incline db press', 'incline dumbbell bench', 'db incline press']
  },
  {
    key: 'cable_fly',
    displayName: 'Cable Fly',
    aliases: ['fly', 'chest fly', 'pec fly', 'cable crossover', 'cable flyes']
  },
  {
    key: 'machine_chest_press',
    displayName: 'Machine Chest Press',
    aliases: ['chest press machine', 'machine press', 'seated chest press']
  },

  // Back exercises
  {
    key: 'deadlift',
    displayName: 'Deadlift',
    aliases: ['conventional deadlift', 'barbell deadlift', 'bb deadlift']
  },
  {
    key: 'romanian_deadlift',
    displayName: 'Romanian Deadlift',
    aliases: ['rdl', 'romanian', 'stiff leg deadlift', 'barbell rdl']
  },
  {
    key: 'barbell_row',
    displayName: 'Barbell Row',
    aliases: ['row', 'bent over row', 'bb row', 'barbell bent over row', 'bent row']
  },
  {
    key: 'dumbbell_row',
    displayName: 'Dumbbell Row',
    aliases: ['db row', 'one arm row', 'single arm row', 'one arm db row']
  },
  {
    key: 'lat_pulldown',
    displayName: 'Lat Pulldown',
    aliases: ['pulldown', 'lat pull', 'lat pull down', 'cable pulldown']
  },
  {
    key: 'pull_up',
    displayName: 'Pull-Up',
    aliases: ['pull-up', 'pullup', 'chin-up', 'chinup', 'chin up', 'pull up']
  },
  {
    key: 'seated_cable_row',
    displayName: 'Seated Cable Row',
    aliases: ['cable row', 'seated row', 'low row']
  },

  // Leg exercises
  {
    key: 'barbell_back_squat',
    displayName: 'Barbell Back Squat',
    aliases: ['squat', 'back squat', 'bb squat', 'barbell squat']
  },
  {
    key: 'front_squat',
    displayName: 'Front Squat',
    aliases: ['barbell front squat', 'bb front squat']
  },
  {
    key: 'leg_press',
    displayName: 'Leg Press',
    aliases: ['leg press machine', 'machine leg press', '45 degree leg press']
  },
  {
    key: 'hack_squat',
    displayName: 'Hack Squat',
    aliases: ['hack squat machine', 'machine hack squat']
  },
  {
    key: 'leg_extension',
    displayName: 'Leg Extension',
    aliases: ['leg extensions', 'quad extension', 'machine leg extension']
  },
  {
    key: 'lying_leg_curl',
    displayName: 'Lying Leg Curl',
    aliases: ['leg curl', 'hamstring curl', 'lying hamstring curl', 'prone leg curl']
  },
  {
    key: 'seated_leg_curl',
    displayName: 'Seated Leg Curl',
    aliases: ['seated hamstring curl']
  },
  {
    key: 'hip_thrust',
    displayName: 'Hip Thrust',
    aliases: ['glute bridge', 'barbell hip thrust', 'bb hip thrust']
  },
  {
    key: 'standing_calf_raise',
    displayName: 'Standing Calf Raise',
    aliases: ['calf raise', 'standing calf', 'calves']
  },

  // Shoulder exercises
  {
    key: 'overhead_press',
    displayName: 'Overhead Press',
    aliases: ['shoulder press', 'military press', 'ohp', 'barbell overhead press', 'standing press']
  },
  {
    key: 'dumbbell_shoulder_press',
    displayName: 'Dumbbell Shoulder Press',
    aliases: ['db shoulder press', 'dumbbell press', 'db ohp', 'seated dumbbell press']
  },
  {
    key: 'lateral_raise',
    displayName: 'Lateral Raise',
    aliases: ['side raise', 'dumbbell lateral raise', 'db lateral raise', 'side lateral raise']
  },
  {
    key: 'face_pull',
    displayName: 'Face Pull',
    aliases: ['cable face pull', 'face pulls']
  },

  // Arm exercises
  {
    key: 'barbell_curl',
    displayName: 'Barbell Curl',
    aliases: ['curl', 'bicep curl', 'bb curl', 'standing barbell curl']
  },
  {
    key: 'dumbbell_curl',
    displayName: 'Dumbbell Curl',
    aliases: ['db curl', 'dumbbell bicep curl']
  },
  {
    key: 'hammer_curl',
    displayName: 'Hammer Curl',
    aliases: ['db hammer curl', 'dumbbell hammer curl']
  },
  {
    key: 'tricep_pushdown',
    displayName: 'Tricep Pushdown',
    aliases: ['pushdown', 'tricep push', 'cable pushdown', 'triceps pushdown', 'rope pushdown']
  },
  {
    key: 'overhead_tricep_extension',
    displayName: 'Overhead Tricep Extension',
    aliases: ['extension', 'tricep extension', 'triceps extension', 'dumbbell tricep', 'dumbbell triceps', 'overhead extension']
  },
];

// Build lookup maps for efficient matching
const DISPLAY_NAME_TO_CANONICAL = new Map<string, CanonicalExercise>();
const ALIAS_TO_CANONICAL = new Map<string, CanonicalExercise>();

for (const exercise of CANONICAL_EXERCISES) {
  DISPLAY_NAME_TO_CANONICAL.set(exercise.displayName.toLowerCase(), exercise);
  for (const alias of exercise.aliases) {
    ALIAS_TO_CANONICAL.set(alias.toLowerCase(), exercise);
  }
}

/**
 * Normalize an exercise name for matching purposes.
 * Removes common prefixes/modifiers and standardizes format.
 */
export function normalizeExerciseName(name: string): string {
  return name.toLowerCase()
    .replace(/bent[ -]?over/gi, '')
    .replace(/seated/gi, '')
    .replace(/standing/gi, '')
    .replace(/lying/gi, '')
    .replace(/machine/gi, '')
    .replace(/cable/gi, '')
    .replace(/ez[ -]?bar/gi, 'barbell')
    .replace(/smith[ -]?machine/gi, 'barbell')
    .replace(/dumbbell/gi, 'db')
    .replace(/barbell/gi, 'bb')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Match patterns for fuzzy exercise name resolution
 * Maps partial name matches to canonical exercise display names
 */
const MATCH_PATTERNS: Record<string, string> = {
  'bench press': 'Barbell Bench Press',
  'incline press': 'Incline Barbell Press',
  'incline bench': 'Incline Barbell Press',
  'overhead press': 'Overhead Press',
  'shoulder press': 'Overhead Press',
  'military press': 'Overhead Press',
  'squat': 'Barbell Back Squat',
  'back squat': 'Barbell Back Squat',
  'front squat': 'Front Squat',
  'leg press': 'Leg Press',
  'hack squat': 'Hack Squat',
  'deadlift': 'Deadlift',
  'rdl': 'Romanian Deadlift',
  'romanian': 'Romanian Deadlift',
  'row': 'Barbell Row',
  'bent over row': 'Barbell Row',
  'db row': 'Dumbbell Row',
  'dumbbell row': 'Dumbbell Row',
  'pulldown': 'Lat Pulldown',
  'lat pull': 'Lat Pulldown',
  'pull-up': 'Pull-Up',
  'pullup': 'Pull-Up',
  'chin-up': 'Pull-Up',
  'curl': 'Barbell Curl',
  'bicep curl': 'Barbell Curl',
  'hammer curl': 'Hammer Curl',
  'pushdown': 'Tricep Pushdown',
  'tricep push': 'Tricep Pushdown',
  'extension': 'Overhead Tricep Extension',
  'tricep extension': 'Overhead Tricep Extension',
  'triceps extension': 'Overhead Tricep Extension',
  'dumbbell tricep': 'Overhead Tricep Extension',
  'dumbbell triceps': 'Overhead Tricep Extension',
  'lateral raise': 'Lateral Raise',
  'side raise': 'Lateral Raise',
  'face pull': 'Face Pull',
  'leg curl': 'Lying Leg Curl',
  'hamstring curl': 'Lying Leg Curl',
  'leg extension': 'Leg Extension',
  'calf raise': 'Standing Calf Raise',
  'hip thrust': 'Hip Thrust',
  'glute bridge': 'Hip Thrust',
  'fly': 'Cable Fly',
  'chest fly': 'Cable Fly',
  'pec fly': 'Cable Fly',
  'cable row': 'Seated Cable Row',
  'seated row': 'Seated Cable Row',
  'machine press': 'Machine Chest Press',
  'chest press': 'Machine Chest Press',
};

/**
 * Find the canonical exercise name for a given input name.
 * Uses multiple strategies:
 * 1. Exact match against display names
 * 2. Alias lookup
 * 3. Pattern-based fuzzy matching
 *
 * @returns The canonical display name, or null if no match found
 */
export function findExerciseMatch(exerciseName: string): string | null {
  const lowerName = exerciseName.toLowerCase();

  // Strategy 1: Exact match against display names
  const exactMatch = DISPLAY_NAME_TO_CANONICAL.get(lowerName);
  if (exactMatch) {
    return exactMatch.displayName;
  }

  // Strategy 2: Alias lookup
  const aliasMatch = ALIAS_TO_CANONICAL.get(lowerName);
  if (aliasMatch) {
    return aliasMatch.displayName;
  }

  // Strategy 3: Pattern-based fuzzy match
  for (const [pattern, displayName] of Object.entries(MATCH_PATTERNS)) {
    if (lowerName.includes(pattern)) {
      return displayName;
    }
  }

  return null;
}

/**
 * Get the canonical key for an exercise name.
 * This is useful for database lookups and consistent storage.
 *
 * @returns The canonical key (e.g., 'barbell_bench_press'), or a normalized version of the input
 */
export function getCanonicalKey(name: string): string {
  const displayName = findExerciseMatch(name);
  if (displayName) {
    const canonical = DISPLAY_NAME_TO_CANONICAL.get(displayName.toLowerCase());
    if (canonical) {
      return canonical.key;
    }
  }
  // Fallback: convert to snake_case
  return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

/**
 * Get the display name for an exercise.
 * If no canonical match is found, returns the original name.
 */
export function getDisplayName(name: string): string {
  return findExerciseMatch(name) || name;
}

/**
 * Canonicalize an exercise name to its standard form.
 * Returns full CanonicalExercise object if found, null otherwise.
 */
export function canonicalizeExercise(name: string): CanonicalExercise | null {
  const displayName = findExerciseMatch(name);
  if (displayName) {
    return DISPLAY_NAME_TO_CANONICAL.get(displayName.toLowerCase()) || null;
  }
  return null;
}

/**
 * Check if two exercise names refer to the same exercise
 */
export function isSameExercise(name1: string, name2: string): boolean {
  const canonical1 = findExerciseMatch(name1) || name1.toLowerCase();
  const canonical2 = findExerciseMatch(name2) || name2.toLowerCase();
  return canonical1.toLowerCase() === canonical2.toLowerCase();
}

/**
 * Get all canonical exercises
 */
export function getAllCanonicalExercises(): readonly CanonicalExercise[] {
  return CANONICAL_EXERCISES;
}
