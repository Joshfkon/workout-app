/**
 * AI Exercise Completion Service
 *
 * Uses Claude to intelligently complete exercise metadata
 * based on minimal user input.
 *
 * Uses the two-tier muscle group system:
 * - DetailedMuscleGroup (33 muscles) for precise AI exercise targeting
 * - StandardMuscleGroup (20 muscles) for volume tracking (converted automatically)
 */

import type { MovementPattern, DetailedMuscleGroup, StandardMuscleGroup } from '@/types/schema';
import { DETAILED_MUSCLE_GROUPS, isDetailedMuscle, toStandardMuscle } from '@/types/schema';
import type {
  BasicExerciseInput,
  CompletedExerciseData,
  AIConfidence,
  ValidationResult,
  EquipmentDefaults,
} from './types';
import { EQUIPMENT_DEFAULTS } from './types';
import type { Exercise, SpinalLoading, PositionStress } from '@/services/exerciseService';

// ============================================
// LLM PROMPT TEMPLATE
// ============================================

const EXERCISE_COMPLETION_PROMPT = `You are an exercise science expert helping to catalog a new exercise for a fitness tracking app.

Given the following basic exercise information:
- Name: {{name}}
- Primary Muscle (general): {{primaryMuscle}}
- Equipment: {{equipment}}
{{#if description}}
- Description: {{description}}
{{/if}}
{{#if variationOfName}}
- This is a variation of: {{variationOfName}}
{{/if}}

Please analyze this exercise and provide the following data in JSON format:

{
  "primaryMuscleDetailed": "",
  "secondaryMuscles": [],
  "stabilizers": [],
  "pattern": "",
  "mechanic": "",
  "difficulty": "",
  "fatigueRating": 0,
  "defaultRepRange": [0, 0],
  "defaultRir": 0,
  "minWeightIncrementKg": 0,
  "spinalLoading": "",
  "requiresBackArch": false,
  "requiresSpinalFlexion": false,
  "requiresSpinalExtension": false,
  "requiresSpinalRotation": false,
  "positionStress": {
    "lowerBack": false,
    "upperBack": false,
    "shoulders": false,
    "knees": false,
    "wrists": false,
    "elbows": false,
    "hips": false,
    "neck": false
  },
  "contraindications": [],
  "hypertrophyScore": {
    "tier": "",
    "stretchUnderLoad": 0,
    "resistanceProfile": 0,
    "progressionEase": 0
  },
  "formCues": [],
  "confidence": "",
  "notes": ""
}

MUSCLE GROUPS (Detailed - use these exact values):

Chest:
- chest_upper (clavicular head - incline movements)
- chest_lower (sternal head - flat/decline movements)
- chest_mid (inner sternal fibers - cable crossovers, squeezing movements)

Shoulders:
- front_delts (anterior deltoid - pressing, front raises)
- lateral_delts (lateral deltoid - lateral raises, upright rows)
- rear_delts (posterior deltoid - reverse flyes, face pulls)

Back:
- lats (latissimus dorsi - pulldowns, rows with elbow tucked)
- upper_back (general upper back - rows with flared elbows)
- rhomboids (scapular retraction focus)
- lower_traps (scapular depression, face pulls)
- upper_traps (shrugging movements)

Spine:
- erectors (spinal erectors - deadlifts, back extensions)

Arms:
- triceps_long (long head - overhead extensions, close grip pressing)
- triceps_lateral (lateral head - pushdowns, pressing)
- triceps_medial (medial head - all tricep movements, especially neutral grip)
- biceps_long (long head - incline curls, narrow grip)
- biceps_short (short head - preacher curls, wide grip)
- brachialis (hammer curls, neutral grip curls)
- brachioradialis (hammer curls, reverse curls)
- forearm_flexors (wrist curls, gripping)
- forearm_extensors (reverse wrist curls)

Legs:
- quads_rectus_femoris (crosses hip - leg extensions, sissy squats)
- quads_vastus (VMO/VL/VI - squats, leg press)
- hamstrings_biceps_femoris (lateral hamstring - leg curls)
- hamstrings_semis (medial hamstrings - Romanian deadlifts, good mornings)
- glute_max (gluteus maximus - hip extension, squats, hip thrusts)
- glute_med (gluteus medius - hip abduction, lateral movements)
- adductors (hip adduction)
- abductors (hip abduction - often same exercises as glute_med)
- calves_gastrocnemius (straight-leg calf raises)
- calves_soleus (bent-knee calf raises)

Core:
- abs_rectus (rectus abdominis - crunches, leg raises)
- abs_obliques (obliques - side bends, rotational movements)

FIELD INSTRUCTIONS:

- primaryMuscleDetailed: The SINGLE most targeted detailed muscle from the list above
- secondaryMuscles: Other muscles significantly worked (use detailed muscle names from above)
- stabilizers: Muscles used for stability, not primary movers (use detailed muscle names)
- pattern: Movement pattern - one of: horizontal_push, horizontal_pull, vertical_push, vertical_pull, hip_hinge, squat, lunge, knee_flexion, elbow_flexion, elbow_extension, shoulder_isolation, calf_raise, core, isolation, carry
- mechanic: "compound" (multi-joint) or "isolation" (single-joint)
- difficulty: "beginner" | "intermediate" | "advanced"
- fatigueRating: 1 (low CNS demand) to 3 (high CNS demand)
- defaultRepRange: [min, max] typical hypertrophy range for this exercise
- defaultRir: Typical RIR target (usually 2)
- minWeightIncrementKg: Smallest practical weight jump
- spinalLoading: "none" | "low" | "moderate" | "high" - compression/shear on spine
- requiresBackArch: Does proper form require arching the back?
- requiresSpinalFlexion: Does movement involve spinal flexion?
- requiresSpinalExtension: Does movement involve spinal extension?
- requiresSpinalRotation: Does movement involve spinal rotation?
- positionStress: Which body positions are stressed during exercise
- contraindications: Injury types to avoid (e.g., "herniated_disc", "shoulder_impingement", "knee_injury", "lower_back_strain", "wrist_injury", "elbow_injury")
- hypertrophyScore.tier: "S" | "A" | "B" | "C" based on overall hypertrophy effectiveness
- hypertrophyScore.stretchUnderLoad: 1-5, does muscle get stretched while under tension?
- hypertrophyScore.resistanceProfile: 1-5, is resistance consistent through ROM?
- hypertrophyScore.progressionEase: 1-5, how easy to progressively overload?
- formCues: 3-5 key form tips for this exercise
- confidence: "high" | "medium" | "low" - your confidence in this analysis
- notes: Any assumptions made or caveats

MUSCLE SELECTION GUIDELINES:

For chest exercises:
- Incline = chest_upper primary
- Flat = chest_lower primary (or chest_upper for some people)
- Decline = chest_lower primary
- Flyes/crossovers often hit chest_mid as secondary

For triceps:
- Overhead movements emphasize triceps_long
- Pushdowns emphasize triceps_lateral
- Close-grip pressing hits all three, triceps_medial often works hardest
- Most tricep exercises hit triceps_medial to some degree

For biceps:
- Incline curls emphasize biceps_long (stretched position)
- Preacher/spider curls emphasize biceps_short
- Hammer curls emphasize brachialis and brachioradialis
- Standard curls hit both heads relatively equally

For back:
- Vertical pulls (pulldowns, pull-ups) = lats primary
- Horizontal pulls with elbows flared = upper_back primary
- Horizontal pulls with elbows tucked = lats primary
- Face pulls = rear_delts primary, lower_traps and rhomboids secondary

For legs:
- Squats = quads_vastus primary (quads_rectus_femoris gets less work due to hip flexion)
- Leg extensions = both quad muscles, but quads_rectus_femoris works through full ROM
- RDLs/good mornings = hamstrings_semis primary (stretched at hip)
- Leg curls = hamstrings_biceps_femoris primary

For calves:
- Straight leg = calves_gastrocnemius primary
- Bent knee (seated) = calves_soleus primary (gastrocnemius is shortened)

SCORING GUIDELINES:
- For hypertrophy tier: S = best in class (e.g., cable flyes for chest), A = excellent, B = good, C = acceptable
- Machine exercises typically have: low/no spinal loading, good resistance profile (4-5), high progression ease (5)
- Free weight compounds typically have: moderate-high spinal loading, moderate resistance profile (3), good progression ease (4-5)
- Isolation exercises are typically: low fatigue (1), beginner difficulty, 10-15 rep range
- Be conservative with contraindications - only list clear conflicts
- Consider the specific equipment when assessing spinal loading and stability requirements
- Cables typically have great stretch under load and resistance profile

Respond with ONLY the JSON object, no additional text or markdown.`;

// ============================================
// TEMPLATE RENDERING
// ============================================

function renderPrompt(input: BasicExerciseInput): string {
  let prompt = EXERCISE_COMPLETION_PROMPT;

  prompt = prompt.replace('{{name}}', input.name);
  prompt = prompt.replace('{{primaryMuscle}}', input.primaryMuscle);
  prompt = prompt.replace('{{equipment}}', input.equipment);

  if (input.description) {
    prompt = prompt.replace('{{#if description}}', '');
    prompt = prompt.replace('{{/if}}', '');
    prompt = prompt.replace('{{description}}', input.description);
  } else {
    prompt = prompt.replace(/\{\{#if description\}\}[\s\S]*?\{\{\/if\}\}/g, '');
  }

  if (input.variationOfName) {
    prompt = prompt.replace('{{#if variationOfName}}', '');
    prompt = prompt.replace('{{/if}}', '');
    prompt = prompt.replace('{{variationOfName}}', input.variationOfName);
  } else {
    prompt = prompt.replace(/\{\{#if variationOfName\}\}[\s\S]*?\{\{\/if\}\}/g, '');
  }

  return prompt;
}

// ============================================
// AI RESPONSE PARSING
// ============================================

interface AIResponse {
  primaryMuscleDetailed: string;
  secondaryMuscles: string[];
  stabilizers: string[];
  pattern: string;
  mechanic: string;
  difficulty: string;
  fatigueRating: number;
  defaultRepRange: [number, number];
  defaultRir: number;
  minWeightIncrementKg: number;
  spinalLoading: string;
  requiresBackArch: boolean;
  requiresSpinalFlexion: boolean;
  requiresSpinalExtension: boolean;
  requiresSpinalRotation: boolean;
  positionStress: PositionStress;
  contraindications: string[];
  hypertrophyScore: {
    tier: string;
    stretchUnderLoad: number;
    resistanceProfile: number;
    progressionEase: number;
  };
  formCues: string[];
  confidence: string;
  notes: string;
}

/**
 * Valid detailed muscle groups for AI response validation
 */
const VALID_DETAILED_MUSCLES: DetailedMuscleGroup[] = [
  // Chest
  'chest_upper', 'chest_lower', 'chest_mid',
  // Delts
  'front_delts', 'lateral_delts', 'rear_delts',
  // Back
  'lats', 'upper_back', 'rhomboids', 'lower_traps', 'upper_traps',
  // Spine
  'erectors',
  // Triceps
  'triceps_long', 'triceps_lateral', 'triceps_medial',
  // Biceps
  'biceps_long', 'biceps_short', 'brachialis', 'brachioradialis',
  // Forearms
  'forearm_flexors', 'forearm_extensors',
  // Quads
  'quads_rectus_femoris', 'quads_vastus',
  // Hamstrings
  'hamstrings_biceps_femoris', 'hamstrings_semis',
  // Glutes
  'glute_max', 'glute_med',
  // Hip
  'adductors', 'abductors',
  // Calves
  'calves_gastrocnemius', 'calves_soleus',
  // Core
  'abs_rectus', 'abs_obliques',
];

const VALID_PATTERNS: (MovementPattern | 'isolation' | 'carry')[] = [
  'horizontal_push', 'horizontal_pull', 'vertical_push', 'vertical_pull',
  'hip_hinge', 'squat', 'lunge', 'knee_flexion', 'elbow_flexion',
  'elbow_extension', 'shoulder_isolation', 'calf_raise', 'core',
  'isolation', 'carry',
];

/**
 * Map legacy muscle names to best-guess detailed equivalents
 * Used when AI returns an old-format muscle name
 */
const LEGACY_TO_DETAILED_FALLBACK: Record<string, DetailedMuscleGroup> = {
  'chest': 'chest_lower',
  'back': 'lats',
  'shoulders': 'lateral_delts',
  'biceps': 'biceps_short',
  'triceps': 'triceps_long',
  'quads': 'quads_vastus',
  'hamstrings': 'hamstrings_biceps_femoris',
  'glutes': 'glute_max',
  'calves': 'calves_gastrocnemius',
  'abs': 'abs_rectus',
  'adductors': 'adductors',
  'forearms': 'forearm_flexors',
  'traps': 'upper_traps',
};

/**
 * Convert a muscle string to a valid DetailedMuscleGroup
 * Handles both new detailed format and legacy format
 */
function toDetailedMuscle(muscle: string): DetailedMuscleGroup | null {
  const lowerMuscle = muscle.toLowerCase();

  // Check if it's already a valid detailed muscle
  if (isDetailedMuscle(lowerMuscle)) {
    return lowerMuscle as DetailedMuscleGroup;
  }

  // Check if it's a legacy muscle name
  if (lowerMuscle in LEGACY_TO_DETAILED_FALLBACK) {
    return LEGACY_TO_DETAILED_FALLBACK[lowerMuscle];
  }

  return null;
}

function parseAIResponse(
  response: AIResponse,
  input: BasicExerciseInput
): CompletedExerciseData {
  // Validate and convert primary muscle to detailed format
  let primaryMuscleDetailed: DetailedMuscleGroup;
  const aiPrimary = response.primaryMuscleDetailed?.toLowerCase();

  if (aiPrimary && isDetailedMuscle(aiPrimary)) {
    primaryMuscleDetailed = aiPrimary as DetailedMuscleGroup;
  } else if (aiPrimary && aiPrimary in LEGACY_TO_DETAILED_FALLBACK) {
    primaryMuscleDetailed = LEGACY_TO_DETAILED_FALLBACK[aiPrimary];
  } else {
    // Fallback: convert the user's input primaryMuscle to detailed
    const inputPrimary = input.primaryMuscle.toLowerCase();
    primaryMuscleDetailed = LEGACY_TO_DETAILED_FALLBACK[inputPrimary] ?? 'chest_lower';
  }

  // Validate and filter secondary muscles (detailed format)
  const secondaryMuscles = (response.secondaryMuscles || [])
    .map((m) => toDetailedMuscle(m))
    .filter((m): m is DetailedMuscleGroup => m !== null);

  // Validate and filter stabilizers (detailed format)
  const stabilizers = (response.stabilizers || [])
    .map((m) => toDetailedMuscle(m))
    .filter((m): m is DetailedMuscleGroup => m !== null);

  // Validate pattern
  const pattern = VALID_PATTERNS.includes(response.pattern as any)
    ? (response.pattern as MovementPattern | 'isolation' | 'carry')
    : 'isolation';

  // Validate other fields with fallbacks
  const mechanic = response.mechanic === 'compound' ? 'compound' : 'isolation';
  const difficulty = ['beginner', 'intermediate', 'advanced'].includes(response.difficulty)
    ? (response.difficulty as 'beginner' | 'intermediate' | 'advanced')
    : 'intermediate';
  const fatigueRating = [1, 2, 3].includes(response.fatigueRating)
    ? (response.fatigueRating as 1 | 2 | 3)
    : 2;

  const spinalLoading = ['none', 'low', 'moderate', 'high'].includes(response.spinalLoading)
    ? (response.spinalLoading as SpinalLoading)
    : EQUIPMENT_DEFAULTS[input.equipment].spinalLoading;

  const tier = ['S', 'A', 'B', 'C', 'D', 'F'].includes(response.hypertrophyScore?.tier)
    ? (response.hypertrophyScore.tier as 'S' | 'A' | 'B' | 'C' | 'D' | 'F')
    : 'B';

  const clampRating = (n: number): 1 | 2 | 3 | 4 | 5 =>
    Math.max(1, Math.min(5, Math.round(n || 3))) as 1 | 2 | 3 | 4 | 5;

  const confidence = ['high', 'medium', 'low'].includes(response.confidence)
    ? (response.confidence as AIConfidence)
    : 'medium';

  return {
    // User provided (keep original legacy format for backwards compatibility)
    name: input.name,
    primaryMuscle: input.primaryMuscle, // User's original legacy muscle input
    equipment: input.equipment,
    description: input.description,
    variationOf: input.variationOf,

    // AI's detailed classification of the primary muscle
    primaryMuscleDetailed,

    // AI completed (use user-provided values if available, otherwise use AI response)
    // All muscle arrays now use DetailedMuscleGroup
    secondaryMuscles: input.secondaryMuscles && input.secondaryMuscles.length > 0
      ? input.secondaryMuscles.map((m) => toDetailedMuscle(m)).filter((m): m is DetailedMuscleGroup => m !== null)
      : secondaryMuscles,
    stabilizers: input.stabilizers && input.stabilizers.length > 0
      ? input.stabilizers.map((m) => toDetailedMuscle(m)).filter((m): m is DetailedMuscleGroup => m !== null)
      : stabilizers,
    pattern: input.pattern || pattern,
    mechanic: input.mechanic || mechanic,
    difficulty: input.difficulty || difficulty,
    fatigueRating: input.fatigueRating || fatigueRating,
    defaultRepRange: input.defaultRepRange || (
      Array.isArray(response.defaultRepRange) && response.defaultRepRange.length === 2
        ? [response.defaultRepRange[0], response.defaultRepRange[1]]
        : EQUIPMENT_DEFAULTS[input.equipment].defaultRepRange
    ),
    defaultRir: input.defaultRir || (typeof response.defaultRir === 'number' ? response.defaultRir : 2),
    minWeightIncrementKg: input.minWeightIncrementKg || (
      typeof response.minWeightIncrementKg === 'number'
        ? response.minWeightIncrementKg
        : EQUIPMENT_DEFAULTS[input.equipment].minWeightIncrementKg
    ),

    // Spinal/safety metadata (use user-provided values if available)
    spinalLoading: input.spinalLoading || spinalLoading,
    requiresBackArch: input.requiresBackArch !== undefined ? input.requiresBackArch : !!response.requiresBackArch,
    requiresSpinalFlexion: input.requiresSpinalFlexion !== undefined ? input.requiresSpinalFlexion : !!response.requiresSpinalFlexion,
    requiresSpinalExtension: input.requiresSpinalExtension !== undefined ? input.requiresSpinalExtension : !!response.requiresSpinalExtension,
    requiresSpinalRotation: input.requiresSpinalRotation !== undefined ? input.requiresSpinalRotation : !!response.requiresSpinalRotation,
    positionStress: input.positionStress && Object.keys(input.positionStress).length > 0
      ? input.positionStress
      : (response.positionStress || {}),
    contraindications: input.contraindications && input.contraindications.length > 0
      ? input.contraindications
      : (Array.isArray(response.contraindications) ? response.contraindications : []),

    // Hypertrophy scoring (use user-provided values if available)
    hypertrophyScore: {
      tier: input.hypertrophyTier || tier,
      stretchUnderLoad: input.stretchUnderLoad || clampRating(response.hypertrophyScore?.stretchUnderLoad),
      resistanceProfile: input.resistanceProfile || clampRating(response.hypertrophyScore?.resistanceProfile),
      progressionEase: input.progressionEase || clampRating(response.hypertrophyScore?.progressionEase),
    },

    // Form guidance (use user-provided values if available)
    formCues: input.formCues && input.formCues.length > 0
      ? input.formCues
      : (Array.isArray(response.formCues) ? response.formCues.slice(0, 5) : []),
    commonMistakes: input.commonMistakes && input.commonMistakes.length > 0
      ? input.commonMistakes
      : [],
    setupNote: input.setupNote || '',

    // Metadata
    aiConfidence: confidence,
    aiNotes: response.notes || undefined,
  };
}

// ============================================
// FALLBACK DEFAULTS
// ============================================

/**
 * Legacy muscle group list for determining mechanic type
 */
const LEGACY_ISOLATION_MUSCLES = ['biceps', 'triceps', 'calves', 'forearms', 'abs'];

/**
 * Pattern map for legacy muscle groups (used in fallback)
 */
const LEGACY_PATTERN_MAP: Record<string, MovementPattern | 'isolation' | 'carry'> = {
  chest: 'horizontal_push',
  back: 'horizontal_pull',
  shoulders: 'vertical_push',
  biceps: 'elbow_flexion',
  triceps: 'elbow_extension',
  quads: 'squat',
  hamstrings: 'hip_hinge',
  glutes: 'hip_hinge',
  calves: 'calf_raise',
  abs: 'core',
  adductors: 'isolation',
  forearms: 'isolation',
  traps: 'vertical_pull',
};

export function getDefaultsByEquipment(input: BasicExerciseInput): CompletedExerciseData {
  const defaults = EQUIPMENT_DEFAULTS[input.equipment] as EquipmentDefaults;

  // Convert input primaryMuscle to detailed format
  const inputPrimary = input.primaryMuscle.toLowerCase();
  const primaryMuscleDetailed: DetailedMuscleGroup =
    LEGACY_TO_DETAILED_FALLBACK[inputPrimary] ?? 'chest_lower';

  // Derive mechanic from primary muscle (using legacy mapping)
  const mechanic: 'compound' | 'isolation' = LEGACY_ISOLATION_MUSCLES.includes(inputPrimary)
    ? 'isolation'
    : 'compound';

  // Derive pattern from primary muscle (using legacy mapping)
  const pattern = LEGACY_PATTERN_MAP[inputPrimary] || 'isolation';

  return {
    name: input.name,
    primaryMuscle: input.primaryMuscle, // Keep user's original legacy input
    equipment: input.equipment,
    description: input.description,
    variationOf: input.variationOf,
    primaryMuscleDetailed, // AI's detailed classification
    secondaryMuscles: [],
    stabilizers: [],
    pattern,
    mechanic,
    difficulty: defaults.difficulty,
    fatigueRating: defaults.fatigueRating,
    defaultRepRange: defaults.defaultRepRange,
    defaultRir: 2,
    minWeightIncrementKg: defaults.minWeightIncrementKg,
    spinalLoading: defaults.spinalLoading,
    requiresBackArch: false,
    requiresSpinalFlexion: false,
    requiresSpinalExtension: false,
    requiresSpinalRotation: false,
    positionStress: {},
    contraindications: [],
    hypertrophyScore: defaults.hypertrophyScore,
    formCues: [
      'Control the weight through full range of motion',
      'Keep core engaged throughout the movement',
      'Focus on the target muscle contraction',
    ],
    aiConfidence: 'low',
    aiNotes: 'AI unavailable - using equipment-based defaults. Please review all fields.',
  };
}

// ============================================
// VARIATION INHERITANCE
// ============================================

export function inheritFromBaseExercise(
  input: BasicExerciseInput,
  baseExercise: Exercise
): Partial<CompletedExerciseData> {
  // Convert string[] muscle arrays to DetailedMuscleGroup[] for type compatibility
  const secondaryMuscles = baseExercise.secondaryMuscles
    .map(m => toDetailedMuscle(m))
    .filter((m): m is DetailedMuscleGroup => m !== null);
  const stabilizers = (baseExercise.stabilizers || [])
    .map(m => toDetailedMuscle(m))
    .filter((m): m is DetailedMuscleGroup => m !== null);

  return {
    secondaryMuscles,
    stabilizers,
    pattern: baseExercise.pattern,
    mechanic: baseExercise.mechanic,
    difficulty: baseExercise.difficulty,
    fatigueRating: baseExercise.fatigueRating,
    defaultRepRange: baseExercise.defaultRepRange,
    defaultRir: baseExercise.defaultRir,
    spinalLoading: baseExercise.spinalLoading,
    requiresBackArch: baseExercise.requiresBackArch,
    requiresSpinalFlexion: baseExercise.requiresSpinalFlexion,
    requiresSpinalExtension: baseExercise.requiresSpinalExtension,
    requiresSpinalRotation: baseExercise.requiresSpinalRotation,
    positionStress: baseExercise.positionStress,
    contraindications: baseExercise.contraindications || [],
    hypertrophyScore: baseExercise.hypertrophyScore,
  };
}

// ============================================
// VALIDATION
// ============================================

export function validateCompletedExercise(exercise: CompletedExerciseData): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!exercise.name?.trim()) {
    errors.push('Name is required');
  }
  if (!exercise.primaryMuscle) {
    errors.push('Primary muscle is required');
  }
  if (!exercise.equipment) {
    errors.push('Equipment is required');
  }
  if (!exercise.pattern) {
    errors.push('Movement pattern is required');
  }
  if (!exercise.hypertrophyScore?.tier) {
    errors.push('Hypertrophy tier is required');
  }

  // Logical checks (warnings only)
  if (exercise.mechanic === 'compound' && exercise.secondaryMuscles.length === 0) {
    warnings.push('Compound exercises usually have secondary muscles');
  }

  if (exercise.equipment === 'barbell' && exercise.spinalLoading === 'none') {
    warnings.push('Barbell exercises typically have some spinal loading');
  }

  if (exercise.mechanic === 'isolation' && exercise.fatigueRating > 1) {
    warnings.push('Isolation exercises are usually low fatigue');
  }

  if (exercise.formCues.length === 0) {
    warnings.push('Consider adding form cues for this exercise');
  }

  if (exercise.mechanic === 'compound' && exercise.fatigueRating === 1) {
    warnings.push('Compound exercises typically have moderate to high fatigue');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================
// EXPORT API TYPES
// ============================================

export interface CompleteExerciseResult {
  success: boolean;
  data?: CompletedExerciseData;
  error?: string;
}

export { renderPrompt, parseAIResponse };
export type { AIResponse };
