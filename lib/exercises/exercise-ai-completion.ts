/**
 * AI Exercise Completion Service
 *
 * Uses Claude to intelligently complete exercise metadata
 * based on minimal user input.
 */

import type { MuscleGroup, MovementPattern } from '@/types/schema';
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
- Primary Muscle: {{primaryMuscle}}
- Equipment: {{equipment}}
{{#if description}}
- Description: {{description}}
{{/if}}
{{#if variationOfName}}
- This is a variation of: {{variationOfName}}
{{/if}}

Please analyze this exercise and provide the following data in JSON format:

{
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

Field Definitions:
- secondaryMuscles: Other muscles significantly worked (valid values: chest, back, shoulders, biceps, triceps, quads, hamstrings, glutes, calves, abs, adductors, forearms, traps)
- stabilizers: Muscles used for stability, not primary movers (same valid values)
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

Guidelines:
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

const VALID_MUSCLES: MuscleGroup[] = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps',
  'quads', 'hamstrings', 'glutes', 'calves', 'abs',
  'adductors', 'forearms', 'traps',
];

const VALID_PATTERNS: (MovementPattern | 'isolation' | 'carry')[] = [
  'horizontal_push', 'horizontal_pull', 'vertical_push', 'vertical_pull',
  'hip_hinge', 'squat', 'lunge', 'knee_flexion', 'elbow_flexion',
  'elbow_extension', 'shoulder_isolation', 'calf_raise', 'core',
  'isolation', 'carry',
];

function parseAIResponse(
  response: AIResponse,
  input: BasicExerciseInput
): CompletedExerciseData {
  // Validate and filter muscles
  const secondaryMuscles = (response.secondaryMuscles || [])
    .filter((m): m is MuscleGroup => VALID_MUSCLES.includes(m as MuscleGroup));

  const stabilizers = (response.stabilizers || [])
    .filter((m): m is MuscleGroup => VALID_MUSCLES.includes(m as MuscleGroup));

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
    // User provided
    name: input.name,
    primaryMuscle: input.primaryMuscle,
    equipment: input.equipment,
    description: input.description,
    variationOf: input.variationOf,

    // AI completed (use user-provided values if available, otherwise use AI response)
    secondaryMuscles: input.secondaryMuscles && input.secondaryMuscles.length > 0
      ? input.secondaryMuscles
      : secondaryMuscles,
    stabilizers: input.stabilizers && input.stabilizers.length > 0
      ? input.stabilizers
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

export function getDefaultsByEquipment(input: BasicExerciseInput): CompletedExerciseData {
  const defaults = EQUIPMENT_DEFAULTS[input.equipment] as EquipmentDefaults;

  // Derive mechanic from primary muscle
  const isolationMuscles: MuscleGroup[] = ['biceps', 'triceps', 'calves', 'forearms', 'abs'];
  const mechanic: 'compound' | 'isolation' = isolationMuscles.includes(input.primaryMuscle)
    ? 'isolation'
    : 'compound';

  // Derive pattern from primary muscle
  const patternMap: Record<MuscleGroup, MovementPattern | 'isolation' | 'carry'> = {
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

  return {
    name: input.name,
    primaryMuscle: input.primaryMuscle,
    equipment: input.equipment,
    description: input.description,
    variationOf: input.variationOf,
    secondaryMuscles: [],
    stabilizers: [],
    pattern: patternMap[input.primaryMuscle] || 'isolation',
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
  return {
    secondaryMuscles: baseExercise.secondaryMuscles,
    stabilizers: baseExercise.stabilizers || [],
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
