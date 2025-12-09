// ============ ENUMS ============

/** User's primary training goal */
export type Goal = 'bulk' | 'cut' | 'maintenance';

/** User's training experience level */
export type Experience = 'novice' | 'intermediate' | 'advanced';

/** Exercise mechanic type - affects recovery and volume recommendations */
export type Mechanic = 'compound' | 'isolation';

/** Current state of a workout session */
export type SessionState = 'planned' | 'in_progress' | 'completed' | 'skipped';

/** Quality classification for a logged set based on RPE/RIR analysis */
export type SetQuality = 'junk' | 'effective' | 'stimulative' | 'excessive';

/** Type of progression applied to an exercise */
export type ProgressionType = 'load' | 'reps' | 'sets' | 'technique';

/** Volume status relative to user's landmarks */
export type VolumeStatus = 'below_mev' | 'effective' | 'optimal' | 'approaching_mrv' | 'exceeding_mrv';

/** Weight unit preference */
export type WeightUnit = 'kg' | 'lb';

/** Rating scale for subjective measures (1-5) */
export type Rating = 1 | 2 | 3 | 4 | 5;

/** Bodyweight entry source */
export type BodyweightSource = 'manual' | 'pre_workout';

/** Mesocycle state */
export type MesocycleState = 'planned' | 'active' | 'completed';

// ============ USER ============

/**
 * User profile with training preferences and customizable volume landmarks
 */
export interface User {
  id: string;
  email: string;
  createdAt: string;
  
  /** Primary training goal affects progression strategies */
  goal: Goal;
  
  /** Experience level affects default volume landmarks and progression rates */
  experience: Experience;
  
  preferences: UserPreferences;
  
  /** 
   * Customizable volume landmarks per muscle group
   * Keys are muscle group names (lowercase, e.g., 'chest', 'back', 'quads')
   */
  volumeLandmarks: Record<string, VolumeLandmarks>;
}

export interface UserPreferences {
  /** Weight unit preference */
  units: WeightUnit;
  
  /** Default rest timer duration in seconds */
  restTimerDefault: number;
  
  /** Show form cues during workout */
  showFormCues: boolean;
  
  /** Show warmup set suggestions */
  showWarmupSuggestions: boolean;
}

/**
 * Volume landmarks for a muscle group (sets per week)
 * MEV = Minimum Effective Volume
 * MAV = Maximum Adaptive Volume (optimal range)
 * MRV = Maximum Recoverable Volume
 */
export interface VolumeLandmarks {
  /** Minimum Effective Volume - minimum sets to maintain muscle */
  mev: number;
  
  /** Maximum Adaptive Volume - optimal training zone */
  mav: number;
  
  /** Maximum Recoverable Volume - upper limit before excessive fatigue */
  mrv: number;
}

// ============ BODYWEIGHT ============

/**
 * Bodyweight entry for tracking weight over time
 */
export interface BodyweightEntry {
  id: string;
  userId: string;
  
  /** Date of the entry (YYYY-MM-DD format) */
  date: string;
  
  /** Weight in kilograms (converted for display based on user preference) */
  weightKg: number;
  
  /** Source of the entry */
  source: BodyweightSource;
}

// ============ EXERCISE LIBRARY ============

/**
 * Exercise definition with metadata for intelligent suggestions
 */
export interface Exercise {
  id: string;
  name: string;
  
  /** Primary muscle targeted (e.g., 'chest', 'quads', 'lats') */
  primaryMuscle: string;
  
  /** Secondary muscles worked */
  secondaryMuscles: string[];
  
  /** Compound exercises have higher systemic fatigue */
  mechanic: Mechanic;
  
  /** Default rep range [min, max] */
  defaultRepRange: [number, number];
  
  /** Default Reps In Reserve target */
  defaultRir: number;
  
  /** Smallest weight increment possible (e.g., 2.5kg for barbell, 2kg for dumbbells) */
  minWeightIncrementKg: number;
  
  /** Key form cues for proper execution */
  formCues: string[];
  
  /** Common mistakes to avoid */
  commonMistakes: string[];
  
  /** Setup instructions or notes */
  setupNote: string;
  
  /** Movement pattern for finding similar exercises (e.g., 'horizontal_push', 'hip_hinge') */
  movementPattern: string;
  
  /** Equipment needed for this exercise */
  equipmentRequired: string[];
}

// ============ MESOCYCLE ============

/**
 * Training mesocycle (typically 4-8 weeks) with progressive overload structure
 */
export interface Mesocycle {
  id: string;
  userId: string;
  name: string;
  state: MesocycleState;
  
  /** Total planned weeks in the mesocycle */
  totalWeeks: number;
  
  /** Current week (1-indexed) */
  currentWeek: number;
  
  /** Week number designated as deload (usually last week) */
  deloadWeek: number;
  
  /** Training days per week */
  daysPerWeek: number;
  
  /** Split type (e.g., 'PPL', 'Upper/Lower', 'Full Body', 'Bro Split') */
  splitType: string;
  
  /** Accumulated fatigue score (0-100), triggers deload recommendations */
  fatigueScore: number;
  
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

// ============ WORKOUT SESSION ============

/**
 * A single workout session within a mesocycle
 */
export interface WorkoutSession {
  id: string;
  userId: string;
  
  /** Null if workout is outside a mesocycle (ad-hoc session) */
  mesocycleId: string | null;
  
  state: SessionState;
  
  /** Scheduled date for the workout (YYYY-MM-DD) */
  plannedDate: string;
  
  startedAt: string | null;
  completedAt: string | null;
  
  /** Pre-workout readiness check-in */
  preWorkoutCheckIn: PreWorkoutCheckIn | null;
  
  /** Overall session RPE (Rate of Perceived Exertion) 1-10 */
  sessionRpe: number | null;
  
  /** Subjective pump rating (1-5) */
  pumpRating: number | null;
  
  /** Free-form session notes */
  sessionNotes: string | null;
  
  /** Percentage of planned sets completed (0-100) */
  completionPercent: number;
}

/**
 * Pre-workout check-in for auto-regulation adjustments
 */
export interface PreWorkoutCheckIn {
  /** Hours of sleep last night */
  sleepHours: number | null;
  
  /** Subjective sleep quality (1-5) */
  sleepQuality: Rating | null;
  
  /** Current stress level (1=low, 5=high) */
  stressLevel: Rating | null;
  
  /** Nutrition quality rating (1-5) */
  nutritionRating: Rating | null;
  
  /** Current bodyweight in kg */
  bodyweightKg: number | null;
  
  /** Calculated readiness score (0-100) based on check-in factors */
  readinessScore: number;
}

// ============ EXERCISE BLOCK ============

/**
 * An exercise within a workout session with targets and tracking
 */
export interface ExerciseBlock {
  id: string;
  workoutSessionId: string;
  exerciseId: string;
  
  /** Order of exercise in the workout (1-indexed) */
  order: number;
  
  /** For superset grouping - exercises with same groupId are supersetted */
  supersetGroupId: string | null;
  
  /** Order within the superset group */
  supersetOrder: number | null;
  
  // === Targets (from progression engine) ===
  
  /** Target number of working sets */
  targetSets: number;
  
  /** Target rep range [min, max] */
  targetRepRange: [number, number];
  
  /** Target Reps In Reserve */
  targetRir: number;
  
  /** Target working weight in kg */
  targetWeightKg: number;
  
  /** Recommended rest between sets in seconds */
  targetRestSeconds: number;
  
  // === Engine Context ===
  
  /** Type of progression applied for this session */
  progressionType: ProgressionType | null;
  
  /** Human-readable explanation for the suggested targets */
  suggestionReason: string;
  
  /** Generated warmup protocol */
  warmupProtocol: WarmupSet[];
  
  /** User notes for this exercise block */
  note: string | null;
}

/**
 * A warmup set within the warmup protocol
 */
export interface WarmupSet {
  /** Warmup set number (1-indexed) */
  setNumber: number;
  
  /** Percentage of working weight (e.g., 50, 70, 85) */
  percentOfWorking: number;
  
  /** Suggested reps for this warmup set */
  targetReps: number;
  
  /** Purpose of this warmup set (e.g., 'activation', 'groove practice', 'potentiation') */
  purpose: string;
}

// ============ SET LOG ============

/**
 * Logged data for a single set (working or warmup)
 */
export interface SetLog {
  id: string;
  exerciseBlockId: string;
  
  /** Set number within the exercise block (1-indexed) */
  setNumber: number;
  
  /** Weight used in kg */
  weightKg: number;
  
  /** Reps completed */
  reps: number;
  
  /** Rate of Perceived Exertion (1-10) */
  rpe: number;
  
  /** Rest taken after this set in seconds */
  restSeconds: number | null;
  
  /** Whether this is a warmup set */
  isWarmup: boolean;
  
  /** Quality classification based on RPE analysis */
  quality: SetQuality;
  
  /** Explanation for the quality classification */
  qualityReason: string;
  
  /** Optional note for this specific set */
  note: string | null;
  
  /** Timestamp when the set was logged */
  loggedAt: string;
}

// ============ ANALYTICS ============

/**
 * Snapshot of exercise performance for tracking progress over time
 */
export interface ExercisePerformanceSnapshot {
  id: string;
  userId: string;
  exerciseId: string;
  
  /** Date of the session (YYYY-MM-DD) */
  sessionDate: string;
  
  /** Best set weight in kg */
  topSetWeightKg: number;
  
  /** Reps achieved on the top set */
  topSetReps: number;
  
  /** RPE of the top set */
  topSetRpe: number;
  
  /** Total working sets completed */
  totalWorkingSets: number;
  
  /** Calculated Estimated 1 Rep Max */
  estimatedE1RM: number;
}

/**
 * Weekly volume aggregation per muscle group
 */
export interface WeeklyMuscleVolume {
  userId: string;
  
  /** Start of the week (YYYY-MM-DD, typically Monday) */
  weekStart: string;
  
  /** Muscle group name */
  muscleGroup: string;
  
  /** Total working sets for this muscle group this week */
  totalSets: number;
  
  /** Status relative to user's volume landmarks */
  status: VolumeStatus;
}

/**
 * Alert for exercise plateau detection
 */
export interface PlateauAlert {
  id: string;
  userId: string;
  exerciseId: string;
  
  /** When the plateau was detected */
  detectedAt: string;
  
  /** Number of weeks without meaningful progress */
  weeksSinceProgress: number;
  
  /** Suggested actions to break the plateau */
  suggestedActions: string[];
  
  /** Whether user has dismissed this alert */
  dismissed: boolean;
}

// ============ HELPER TYPES ============

/**
 * Targets calculated by the progression engine
 */
export interface ProgressionTargets {
  weightKg: number;
  repRange: [number, number];
  targetRir: number;
  sets: number;
  restSeconds: number;
  progressionType: ProgressionType;
  reason: string;
}

/**
 * Last session performance data for progression calculations
 */
export interface LastSessionPerformance {
  exerciseId: string;
  weightKg: number;
  reps: number;
  rpe: number;
  sets: number;
  allSetsCompleted: boolean;
  averageRpe: number;
}

/**
 * Readiness factors for fatigue calculations
 */
export interface ReadinessFactors {
  sleepHours: number;
  sleepQuality: Rating;
  stressLevel: Rating;
  nutritionRating: Rating;
  previousSessionRpe?: number;
  daysSinceLastSession?: number;
}

/**
 * Trend data for plateau detection
 */
export interface ExerciseTrend {
  exerciseId: string;
  dataPoints: Array<{
    date: string;
    e1rm: number;
  }>;
  weeklyChange: number;
  isPlateaued: boolean;
}

/**
 * Exercise swap suggestion
 */
export interface SwapSuggestion {
  exercise: Exercise;
  matchScore: number;
  reason: string;
}

// ============ DEFAULT VALUES ============

/**
 * Default volume landmarks by muscle group for different experience levels
 */
export const DEFAULT_VOLUME_LANDMARKS: Record<Experience, Record<string, VolumeLandmarks>> = {
  novice: {
    chest: { mev: 6, mav: 12, mrv: 16 },
    back: { mev: 8, mav: 14, mrv: 20 },
    shoulders: { mev: 6, mav: 12, mrv: 18 },
    biceps: { mev: 4, mav: 10, mrv: 14 },
    triceps: { mev: 4, mav: 10, mrv: 14 },
    quads: { mev: 6, mav: 12, mrv: 18 },
    hamstrings: { mev: 4, mav: 10, mrv: 14 },
    glutes: { mev: 4, mav: 10, mrv: 16 },
    calves: { mev: 6, mav: 12, mrv: 18 },
    abs: { mev: 4, mav: 10, mrv: 16 },
  },
  intermediate: {
    chest: { mev: 8, mav: 14, mrv: 20 },
    back: { mev: 10, mav: 16, mrv: 24 },
    shoulders: { mev: 8, mav: 14, mrv: 22 },
    biceps: { mev: 6, mav: 12, mrv: 18 },
    triceps: { mev: 6, mav: 12, mrv: 18 },
    quads: { mev: 8, mav: 14, mrv: 22 },
    hamstrings: { mev: 6, mav: 12, mrv: 18 },
    glutes: { mev: 6, mav: 12, mrv: 20 },
    calves: { mev: 8, mav: 14, mrv: 22 },
    abs: { mev: 6, mav: 12, mrv: 20 },
  },
  advanced: {
    chest: { mev: 10, mav: 18, mrv: 26 },
    back: { mev: 12, mav: 20, mrv: 30 },
    shoulders: { mev: 10, mav: 18, mrv: 26 },
    biceps: { mev: 8, mav: 16, mrv: 22 },
    triceps: { mev: 8, mav: 16, mrv: 22 },
    quads: { mev: 10, mav: 18, mrv: 26 },
    hamstrings: { mev: 8, mav: 14, mrv: 22 },
    glutes: { mev: 8, mav: 16, mrv: 24 },
    calves: { mev: 10, mav: 18, mrv: 26 },
    abs: { mev: 8, mav: 16, mrv: 24 },
  },
};

/**
 * Default user preferences
 */
export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  units: 'kg',
  restTimerDefault: 180,
  showFormCues: true,
  showWarmupSuggestions: true,
};

/**
 * Muscle groups list
 */
export const MUSCLE_GROUPS = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'abs',
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

/**
 * Movement patterns for exercise classification
 */
export const MOVEMENT_PATTERNS = [
  'horizontal_push',
  'horizontal_pull',
  'vertical_push',
  'vertical_pull',
  'hip_hinge',
  'squat',
  'lunge',
  'knee_flexion',
  'elbow_flexion',
  'elbow_extension',
  'shoulder_isolation',
  'calf_raise',
  'core',
] as const;

export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

// ============ DEXA SCAN & BODY COMPOSITION ============

/**
 * DEXA scan entry for body composition tracking
 */
export interface DexaScan {
  id: string;
  userId: string;
  
  /** Date of the scan (YYYY-MM-DD) */
  scanDate: string;
  
  /** Total body weight in kg */
  weightKg: number;
  
  /** Lean mass (muscle + organs) in kg */
  leanMassKg: number;
  
  /** Fat mass in kg */
  fatMassKg: number;
  
  /** Body fat percentage */
  bodyFatPercent: number;
  
  /** Bone mineral content in kg (optional) */
  boneMassKg: number | null;
  
  /** Notes about the scan */
  notes: string | null;
  
  createdAt: string;
}

/**
 * FFMI (Fat-Free Mass Index) calculation result
 */
export interface FFMIResult {
  /** Raw FFMI = lean mass (kg) / height (m)² */
  ffmi: number;
  
  /** Normalized FFMI (adjusted for height) = FFMI + 6.1 × (1.8 - height in m) */
  normalizedFfmi: number;
  
  /** Classification based on FFMI */
  classification: FFMIClassification;
  
  /** Estimated natural limit based on experience */
  naturalLimit: number;
  
  /** Percentage of natural limit achieved */
  percentOfLimit: number;
}

/** FFMI classification thresholds */
export type FFMIClassification = 
  | 'below_average'  // < 18
  | 'average'        // 18-20
  | 'above_average'  // 20-22
  | 'excellent'      // 22-23
  | 'superior'       // 23-25
  | 'suspicious';    // > 25 (likely enhanced)

/**
 * Body composition trend analysis
 */
export interface BodyCompTrend {
  /** Monthly rate of lean mass change (kg/month) */
  leanMassChangeRate: number;
  
  /** Monthly rate of fat mass change (kg/month) */
  fatMassChangeRate: number;
  
  /** Monthly rate of body fat % change */
  bodyFatChangeRate: number;
  
  /** Monthly rate of FFMI change */
  ffmiChangeRate: number;
  
  /** Trend direction */
  trend: 'gaining_muscle' | 'losing_muscle' | 'gaining_fat' | 'losing_fat' | 'recomping' | 'stable';
  
  /** Number of data points used */
  dataPoints: number;
}

/**
 * Coaching recommendation based on body composition data
 */
export interface BodyCompRecommendation {
  /** Type of recommendation */
  type: 'warning' | 'suggestion' | 'achievement' | 'info';
  
  /** Short title */
  title: string;
  
  /** Detailed recommendation */
  message: string;
  
  /** Priority (higher = more important) */
  priority: number;
}

/**
 * Body composition targets
 */
export interface BodyCompTargets {
  /** Target body fat percentage */
  targetBodyFat: number;
  
  /** Target FFMI */
  targetFfmi: number;
  
  /** Estimated weeks to reach target */
  estimatedWeeks: number;
  
  /** Required weekly calorie adjustment */
  calorieAdjustment: number;
  
  /** Target direction */
  direction: 'bulk' | 'cut' | 'maintain';
}

