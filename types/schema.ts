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

/** Form quality rating for a set */
export type FormRating = 'clean' | 'some_breakdown' | 'ugly';

/** Reps in tank (RIR) values: 4 means "4+", 2 represents "2-3" range */
export type RepsInTank = 0 | 1 | 2 | 4;

/** Body parts for discomfort logging */
export type DiscomfortBodyPart =
  | 'lower_back'
  | 'upper_back'
  | 'neck'
  | 'left_shoulder'
  | 'right_shoulder'
  | 'shoulders'
  | 'left_elbow'
  | 'right_elbow'
  | 'elbows'
  | 'left_wrist'
  | 'right_wrist'
  | 'wrists'
  | 'left_knee'
  | 'right_knee'
  | 'knees'
  | 'left_hip'
  | 'right_hip'
  | 'hips'
  | 'other';

/** Discomfort severity levels */
export type DiscomfortSeverity = 'twinge' | 'discomfort' | 'pain';

/**
 * Discomfort logged during a set
 */
export interface SetDiscomfort {
  /** Body part affected */
  bodyPart: DiscomfortBodyPart;
  /** Which side if applicable */
  side?: 'left' | 'right' | 'both';
  /** Severity of the discomfort */
  severity: DiscomfortSeverity;
  /** Optional notes about the discomfort */
  notes?: string;
}

/**
 * Structured feedback for a set - replaces passive RPE input
 */
export interface SetFeedback {
  /** Reps left in reserve (4 = "4+ Easy", 2 = "2-3 Good", 1 = "Hard", 0 = "Maxed Out") */
  repsInTank: RepsInTank;
  /** Form quality during the set */
  form: FormRating;
  /** Optional discomfort logged during the set */
  discomfort?: SetDiscomfort;
}

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

/** Equipment types available for training */
export type Equipment = 'barbell' | 'dumbbell' | 'cable' | 'machine' | 'bodyweight' | 'kettlebell';

/** Training split types */
export type Split = 'Full Body' | 'Upper/Lower' | 'PPL' | 'Arnold' | 'Bro Split';

/** Periodization models for mesocycle planning */
export type PeriodizationModel = 'linear' | 'daily_undulating' | 'weekly_undulating' | 'block';

/** Deload strategy types */
export type DeloadStrategy = 'proactive' | 'reactive' | 'none';

/** Exercise difficulty levels */
export type ExerciseDifficulty = 'beginner' | 'intermediate' | 'advanced';

/** Fatigue rating (1 = low CNS demand, 3 = high) */
export type FatigueRating = 1 | 2 | 3;

/** Hypertrophy tier rating (S = best, F = worst) */
export type HypertrophyTier = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

/** Rating scale for hypertrophy metrics (1-5) */
export type HypertrophyRating = 1 | 2 | 3 | 4 | 5;

// ============ HYPERTROPHY SCORING ============

/**
 * Hypertrophy score for an exercise based on Jeff Nippard's methodology
 * Higher scores indicate better hypertrophy potential
 */
export interface HypertrophyScore {
  /** Overall tier ranking (S = best for hypertrophy, F = worst) */
  tier: HypertrophyTier;
  
  /** 
   * Stretch under load rating (1-5)
   * How well the exercise provides tension at the lengthened/stretched position
   * Higher = better for muscle growth (lengthened partials principle)
   */
  stretchUnderLoad: HypertrophyRating;
  
  /**
   * Resistance profile rating (1-5)
   * How smooth/consistent the resistance is throughout the range of motion
   * Higher = more even muscle tension (cables/machines score higher)
   */
  resistanceProfile: HypertrophyRating;
  
  /**
   * Progression ease rating (1-5)
   * How easy it is to progressively overload the exercise
   * Higher = easier to add weight/reps consistently
   */
  progressionEase: HypertrophyRating;
}

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
  
  /** 
   * Prioritize hypertrophy-optimal exercises in program generation
   * When true, S-tier exercises are preferred over lower tiers
   * Default: true
   */
  prioritizeHypertrophy?: boolean;
  
  /**
   * Skip the pre-workout readiness check-in
   * When true, workouts start immediately without the check-in screen
   * Default: false
   */
  skipPreWorkoutCheckIn?: boolean;
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
  
  /** Hypertrophy effectiveness score based on Nippard methodology (optional) */
  hypertrophyScore?: HypertrophyScore;

  // === Video Demonstration Fields ===

  /** URL to demonstration GIF/animation (from MuscleWiki, Supabase Storage, etc.) */
  demoGifUrl?: string;

  /** URL to thumbnail image for the demo (optional) */
  demoThumbnailUrl?: string;

  /** YouTube video ID for form tutorials (e.g., "dQw4w9WgXcQ") */
  youtubeVideoId?: string;
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
 * Temporary injury reported before or during workout
 */
export interface TemporaryInjury {
  /** Body area affected */
  area: 'lower_back' | 'upper_back' | 'neck' | 'shoulder_left' | 'shoulder_right' | 'elbow_left' | 'elbow_right' | 'wrist_left' | 'wrist_right' | 'hip_left' | 'hip_right' | 'knee_left' | 'knee_right' | 'ankle_left' | 'ankle_right' | 'chest' | 'other';
  
  /** Severity: 1=mild discomfort, 2=moderate pain, 3=significant pain */
  severity: 1 | 2 | 3;
  
  /** Brief description (optional) */
  description?: string;
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
  
  /** Mental focus/clarity rating (1-5) - important for detecting need for refeed during cut */
  focusRating?: Rating | null;
  
  /** Libido rating (1-5) - important indicator of hormonal health during cut */
  libidoRating?: Rating | null;
  
  /** Calculated readiness score (0-100) based on check-in factors */
  readinessScore: number;
  
  /** Whether a refeed might be needed (calculated from focus, libido, etc.) */
  refeedRecommended?: boolean;
  
  /** Temporary injuries or pain to avoid during this workout */
  temporaryInjuries?: TemporaryInjury[];
}

/**
 * Daily check-in for tracking wellness indicators
 */
export interface DailyCheckIn {
  id: string;
  userId: string;
  date: string;
  
  /** Hours of sleep */
  sleepHours?: number | null;
  
  /** Sleep quality (1-5) */
  sleepQuality?: Rating | null;
  
  /** Energy level (1-5) */
  energyLevel?: Rating | null;
  
  /** Mental focus/clarity (1-5) */
  focusRating?: Rating | null;
  
  /** Libido (1-5) - hormonal health indicator */
  libidoRating?: Rating | null;
  
  /** Mood (1-5) */
  moodRating?: Rating | null;
  
  /** Stress level (1-5, 1=high stress, 5=low stress) */
  stressLevel?: Rating | null;
  
  /** Muscle soreness level (1-5, 1=very sore, 5=no soreness) */
  sorenessLevel?: Rating | null;
  
  /** Hunger level (1-5, 1=very hungry, 5=satisfied) */
  hungerLevel?: Rating | null;
  
  /** Free-form notes */
  notes?: string;
  
  /** Timestamp */
  createdAt: string;
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

  /** Number of drops per main set (0 = no dropsets) */
  dropsetsPerSet: number;

  /** Weight reduction percentage for each drop (0.25 = 25% reduction) */
  dropPercentage: number;
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

  /** Rest time in seconds after this warmup set (shorter than working sets) */
  restSeconds: number;

  /** Indicates this is a bar-only warmup for barbell exercises (no plates) */
  isBarOnly?: boolean;
}

// ============ BODYWEIGHT EXERCISE TYPES ============

/**
 * Type of bodyweight exercise modification
 * - pure: Always just bodyweight (e.g., plank, dead bug)
 * - weighted_possible: Can add weight (e.g., push-up, glute bridge)
 * - assisted_possible: Can use assistance (e.g., assisted pull-up machine)
 * - both: Can be weighted OR assisted (e.g., pull-ups, dips)
 */
export type BodyweightType = 'pure' | 'weighted_possible' | 'assisted_possible' | 'both';

/**
 * Type of modification applied to a bodyweight exercise
 */
export type BodyweightModification = 'none' | 'weighted' | 'assisted';

/**
 * Type of assistance used for assisted exercises
 */
export type AssistanceType = 'machine' | 'band' | 'partner';

/**
 * Band color/strength for assistance band exercises
 */
export interface BandAssistance {
  color: 'yellow' | 'red' | 'black' | 'purple' | 'green';
  label: string;
  /** Approximate assistance range in lbs [min, max] */
  assistanceLbsRange: [number, number];
}

/**
 * Band assistance presets with approximate resistance values
 */
export const BAND_ASSISTANCE_PRESETS: BandAssistance[] = [
  { color: 'yellow', label: 'Extra Light', assistanceLbsRange: [5, 15] },
  { color: 'red', label: 'Light', assistanceLbsRange: [15, 25] },
  { color: 'black', label: 'Medium', assistanceLbsRange: [25, 40] },
  { color: 'purple', label: 'Heavy', assistanceLbsRange: [40, 60] },
  { color: 'green', label: 'Extra Heavy', assistanceLbsRange: [60, 80] },
];

/**
 * Bodyweight-specific data for a set
 * Tracks user's bodyweight, any modifications, and calculates effective load
 */
export interface BodyweightData {
  /** User's body weight at time of set (in kg) */
  userBodyweightKg: number;

  /** Type of modification applied */
  modification: BodyweightModification;

  /** Weight added via vest, belt, or plate (in kg) - for weighted sets */
  addedWeightKg?: number;

  /** Amount of assistance provided (in kg) - for assisted sets */
  assistanceWeightKg?: number;

  /** Type of assistance used */
  assistanceType?: AssistanceType;

  /** Band color if using band assistance */
  bandColor?: BandAssistance['color'];

  /**
   * Calculated effective load = bodyweight + added - assistance (in kg)
   * This is what the user is actually "lifting"
   */
  effectiveLoadKg: number;

  /**
   * Flag indicating this data needs user review (used during migration)
   */
  _needsReview?: boolean;
}

/**
 * Calculate effective load for bodyweight exercises
 */
export function calculateEffectiveLoad(
  bodyweightKg: number,
  modification: BodyweightModification,
  addedWeightKg?: number,
  assistanceWeightKg?: number
): number {
  switch (modification) {
    case 'none':
      return bodyweightKg;
    case 'weighted':
      return bodyweightKg + (addedWeightKg || 0);
    case 'assisted':
      return Math.max(0, bodyweightKg - (assistanceWeightKg || 0));
  }
}

/**
 * Get approximate band assistance in kg from color
 */
export function getBandAssistanceKg(color: BandAssistance['color']): number {
  const preset = BAND_ASSISTANCE_PRESETS.find(b => b.color === color);
  if (!preset) return 0;
  // Return midpoint of range, converted to kg
  const midpointLbs = (preset.assistanceLbsRange[0] + preset.assistanceLbsRange[1]) / 2;
  return Math.round(midpointLbs * 0.453592 * 10) / 10;
}

// ============ SET LOG ============

/**
 * Type of set for advanced training techniques
 */
export type SetType = 'normal' | 'warmup' | 'dropset' | 'myorep' | 'rest_pause';

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

  /** Rate of Perceived Exertion (1-10) - derived from feedback.repsInTank */
  rpe: number;

  /** Rest taken after this set in seconds */
  restSeconds: number | null;

  /** Whether this is a warmup set (deprecated: use setType instead) */
  isWarmup: boolean;

  /** Type of set for advanced training techniques */
  setType: SetType;

  /** For dropsets: references the parent set this dropset follows */
  parentSetId: string | null;

  /** Quality classification based on RPE analysis */
  quality: SetQuality;

  /** Explanation for the quality classification */
  qualityReason: string;

  /** Optional note for this specific set */
  note: string | null;

  /** Timestamp when the set was logged */
  loggedAt: string;

  /** Structured feedback for this set (RIR, form quality, discomfort) */
  feedback?: SetFeedback;

  /** Bodyweight-specific data for bodyweight exercises */
  bodyweightData?: BodyweightData;
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
  prioritizeHypertrophy: true,
  skipPreWorkoutCheckIn: false,
};

// ============ EXTENDED USER PROFILE (for AI mesocycle builder) ============

/**
 * Extended user profile for comprehensive program generation
 * Includes recovery factors, equipment access, and injury history
 */
export interface ExtendedUserProfile {
  /** User's age in years */
  age: number;
  
  /** Training experience level */
  experience: Experience;
  
  /** Primary training goal */
  goal: Goal;
  
  /** Subjective sleep quality (1 = poor, 5 = excellent) */
  sleepQuality: Rating;
  
  /** Current life stress level (1 = low, 5 = high) */
  stressLevel: Rating;
  
  /** Equipment available at user's gym */
  availableEquipment: Equipment[];
  
  /** Muscle groups with injury history to be cautious with */
  injuryHistory: MuscleGroup[];
  
  /** Years of consistent training */
  trainingAge: number;
  
  /** Height in cm (for FFMI calculations) */
  heightCm: number | null;
  
  /** Latest DEXA scan data */
  latestDexa: DexaScan | null;
}

/**
 * Recovery factors calculated from user profile
 * Used to adjust volume and frequency recommendations
 */
export interface RecoveryFactors {
  /** Volume multiplier (0.5-1.3) based on recovery capacity */
  volumeMultiplier: number;
  
  /** Frequency multiplier (0.7-1.2) based on recovery capacity */
  frequencyMultiplier: number;
  
  /** Recommended weeks between deloads */
  deloadFrequencyWeeks: number;
  
  /** Warnings about recovery limitations */
  warnings: string[];
}

/**
 * Weekly progression targets within a periodization plan
 */
export interface WeeklyProgression {
  /** Week number (1-indexed) */
  week: number;
  
  /** Intensity modifier (multiplier: 1.0 = baseline) */
  intensityModifier: number;
  
  /** Volume modifier */
  volumeModifier: number;
  
  /** Target RPE range */
  rpeTarget: { min: number; max: number };
  
  /** Focus/theme for this week */
  focus: string;
}

/**
 * Complete periodization plan for a mesocycle
 */
export interface PeriodizationPlan {
  /** Selected periodization model */
  model: PeriodizationModel;
  
  /** Total weeks including deload */
  mesocycleWeeks: number;
  
  /** Week-by-week progression targets */
  weeklyProgression: WeeklyProgression[];
  
  /** Training weeks before deload */
  deloadFrequency: number;
  
  /** Deload strategy */
  deloadStrategy: DeloadStrategy;
}

/**
 * Session template for split planning
 */
export interface SessionTemplate {
  /** Day name (e.g., "Push A", "Upper") */
  day: string;
  
  /** Focus description */
  focus: string;
  
  /** Target muscle groups for this session */
  targetMuscles: MuscleGroup[];
}

/**
 * Detailed exercise entry in the exercise database
 * Includes both builder fields and progression fields
 */
export interface ExerciseEntry {
  name: string;
  primaryMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  pattern: MovementPattern | 'isolation' | 'carry';
  equipment: Equipment;
  difficulty: ExerciseDifficulty;
  fatigueRating: FatigueRating;
  notes?: string;
  
  // Progression-related fields (optional for backwards compatibility)
  /** Default rep range [min, max] - derived from pattern if not set */
  defaultRepRange?: [number, number];
  /** Default RIR target - derived from difficulty if not set */
  defaultRir?: number;
  /** Smallest weight increment in kg */
  minWeightIncrementKg?: number;
  /** Mechanic type for progression engine */
  mechanic?: Mechanic;
  
  // Hypertrophy scoring (Nippard methodology)
  /** Hypertrophy effectiveness score for exercise selection prioritization */
  hypertrophyScore?: HypertrophyScore;
}

/**
 * Detailed workout session with full exercise information
 */
export interface DetailedSession {
  /** Day name */
  day: string;
  
  /** Session focus description */
  focus: string;
  
  /** Exercises with full details */
  exercises: DetailedExercise[];
  
  /** Total sets in session */
  totalSets: number;
  
  /** Estimated session duration in minutes */
  estimatedMinutes: number;
  
  /** Warmup instructions */
  warmup: string[];
}

/**
 * Detailed exercise within a session
 */
export interface DetailedExercise {
  exercise: ExerciseEntry;
  sets: number;
  repRange: string;
  restSeconds: number;
  notes: string;
}

/**
 * Complete program recommendation from the AI builder
 */
export interface FullProgramRecommendation {
  /** Recommended training split */
  split: Split;
  
  /** Weekly schedule (e.g., ["Mon", "Wed", "Fri"]) */
  schedule: string[];
  
  /** Periodization plan */
  periodization: PeriodizationPlan;
  
  /** User's recovery profile */
  recoveryProfile: RecoveryFactors;
  
  /** Fatigue budget configuration */
  fatigueBudget?: FatigueBudgetConfig;
  
  /** Volume per muscle group with frequency */
  volumePerMuscle: Record<MuscleGroup, { sets: number; frequency: number }>;
  
  /** Detailed workout sessions */
  sessions: DetailedSession[];
  
  /** Full mesocycle week-by-week breakdown */
  mesocycleWeeks?: MesocycleWeek[];
  
  /** Warnings about potential issues */
  warnings: string[];
  
  /** Program notes and recommendations */
  programNotes: string[];
}

// ============ REP RANGE SYSTEM ============

/** Position of exercise within a workout session */
export type ExercisePosition = 'first' | 'early' | 'mid' | 'late';

/** DUP (Daily Undulating Periodization) day types */
export type DUPDayType = 'hypertrophy' | 'strength' | 'power';

/** Muscle fiber type dominance - affects optimal rep ranges */
export type FiberType = 'fast' | 'mixed' | 'slow';

/**
 * Rep range configuration with tempo and RIR guidance
 */
export interface RepRangeConfig {
  /** Minimum reps in range */
  min: number;
  
  /** Maximum reps in range */
  max: number;
  
  /** Target Reps in Reserve (0-4) */
  targetRIR: number;
  
  /** Tempo recommendation (format: Eccentric-Pause-Concentric-Pause, e.g., "3-1-1-0") */
  tempoRecommendation: string;
  
  /** Notes explaining the rep range selection */
  notes: string;
}

/**
 * Factors that influence rep range selection
 */
export interface RepRangeFactors {
  goal: Goal;
  experience: Experience;
  exercisePattern: MovementPattern | 'isolation' | 'carry';
  muscleGroup: MuscleGroup;
  positionInWorkout: ExercisePosition;
  weekInMesocycle: number;
  totalMesocycleWeeks: number;
  periodizationModel: PeriodizationModel;
}

// ============ FATIGUE BUDGET SYSTEM ============

/**
 * Fatigue profile for a single exercise
 */
export interface ExerciseFatigueProfile {
  /** Systemic/CNS fatigue cost (0-50 typically) */
  systemicCost: number;
  
  /** Local fatigue per muscle hit */
  localCost: Map<MuscleGroup, number>;
  
  /** Stimulus-to-Fatigue Ratio (higher = more efficient, 1.0+ is good) */
  stimulusPerFatigue: number;
  
  /** Days before this muscle can be trained hard again */
  recoveryDays: number;
}

/**
 * Configuration for session fatigue limits
 */
export interface FatigueBudgetConfig {
  /** Maximum systemic fatigue per session (typically 80-120) */
  systemicLimit: number;
  
  /** Maximum local fatigue per muscle group */
  localLimit: number;
  
  /** Minimum SFR threshold - exercises below this are "junk volume" */
  minSFRThreshold: number;
  
  /** Percentage of limit at which to warn user */
  warningThreshold: number;
}

/** Exercise efficiency rating based on SFR */
export type ExerciseEfficiency = 'optimal' | 'acceptable' | 'suboptimal' | 'junk';

/**
 * Result of checking if an exercise can be added to a session
 */
export interface ExerciseAddResult {
  allowed: boolean;
  reason?: string;
  efficiency: ExerciseEfficiency;
}

/**
 * Summary of fatigue accumulated during a session
 */
export interface SessionFatigueSummary {
  totalSystemicFatigue: number;
  systemicCapacityUsed: number;
  localFatigueByMuscle: Record<string, number>;
  averageSFR: number;
  exerciseCount: number;
  warnings: string[];
  recommendation: string;
}

/**
 * Muscle recovery status for weekly tracking
 */
export interface MuscleRecoveryStatus {
  lastTrainedDay: number;
  fatigueLevel: number;
  recoveryRate: number;
}

/**
 * Weekly volume status for a muscle group
 */
export interface WeeklyMuscleVolumeStatus {
  currentSets: number;
  targetSets: { min: number; max: number };
  status: 'under' | 'optimal' | 'over';
}

// ============ MESOCYCLE WEEK STRUCTURE ============

/**
 * Complete week within a mesocycle
 */
export interface MesocycleWeek {
  weekNumber: number;
  focus: string;
  intensityModifier: number;
  volumeModifier: number;
  rpeTarget: { min: number; max: number };
  sessions: DetailedSessionWithFatigue[];
  isDeload: boolean;
}

/**
 * Detailed session with fatigue tracking information
 */
export interface DetailedSessionWithFatigue {
  day: string;
  focus: string;
  exercises: DetailedExerciseWithFatigue[];
  totalSets: number;
  estimatedMinutes: number;
  warmup: string[];
  fatigueSummary: {
    systemicFatigueGenerated: number;
    systemicCapacityUsed: number;
    averageSFR: number;
    localFatigueByMuscle: Record<string, number>;
  };
}

/**
 * Detailed exercise with full fatigue and rep range information
 */
export interface DetailedExerciseWithFatigue {
  exercise: ExerciseEntry;
  sets: number;
  reps: RepRangeConfig;
  restSeconds: number;
  loadGuidance: string;
  notes: string;
  fatigueProfile: {
    systemicCost: number;
    localCost: Record<string, number>;
    sfr: number;
    efficiency: ExerciseEfficiency;
  };
}

// ============ REACTIVE DELOAD DETECTION ============

/**
 * Weekly performance data for deload detection
 */
export interface WeeklyPerformanceData {
  weekNumber: number;
  missedReps: number;
  perceivedFatigue: Rating;
  sleepQuality: Rating;
  motivationLevel: Rating;
  jointPain: boolean;
  strengthDecline: boolean;
}

/**
 * Result of checking deload triggers
 */
export interface DeloadTriggers {
  shouldDeload: boolean;
  reasons: string[];
  suggestedDeloadType: 'volume' | 'intensity' | 'full';
}

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
  'adductors',
  'forearms',
  'traps',
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
 * Regional body composition data from a single body region
 */
export interface RegionalBodyComp {
  /** Fat mass in grams */
  fat_g: number;
  /** Lean mass in grams */
  lean_g: number;
}

/**
 * Complete regional body composition data from DEXA scan
 */
export interface DexaRegionalData {
  left_arm: RegionalBodyComp;
  right_arm: RegionalBodyComp;
  left_leg: RegionalBodyComp;
  right_leg: RegionalBodyComp;
  trunk: RegionalBodyComp;
  /** Android region (belly/abdominal) - fat only */
  android: { fat_g: number };
  /** Gynoid region (hips/thighs) - fat only */
  gynoid: { fat_g: number };
}

/**
 * Analysis of a single body part from regional DEXA data
 */
export interface BodyPartAnalysis {
  name: string;
  leanMassKg: number;
  fatMassKg: number;
  percentOfTotal: number;
  /** Symmetry score (100 = perfect symmetry between left/right) */
  symmetryScore?: number;
  status: 'lagging' | 'balanced' | 'dominant';
  recommendation?: string;
}

/**
 * Complete regional body composition analysis
 */
export interface RegionalAnalysis {
  parts: BodyPartAnalysis[];
  asymmetries: {
    /** % difference between arms (positive = right dominant) */
    arms: number;
    /** % difference between legs (positive = right dominant) */
    legs: number;
  };
  /** Upper/lower body ratio (arms lean mass / legs lean mass). Ideal: 0.35-0.45 */
  upperLowerRatio: number;
  /** Android/Gynoid fat ratio (health marker - lower is better) */
  androidGynoidRatio: number;
  laggingAreas: string[];
  dominantAreas: string[];
}

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

  /** Regional body composition data (optional) */
  regionalData: DexaRegionalData | null;

  /** Notes about the scan */
  notes: string | null;

  createdAt: string;
}

/**
 * Progress photo entry for visual body composition tracking
 */
export interface ProgressPhoto {
  id: string;
  userId: string;

  /** Date of the photo (YYYY-MM-DD) */
  photoDate: string;

  /** Storage path to the photo */
  photoUrl: string;

  /** Optional weight at time of photo in kg */
  weightKg: number | null;

  /** Optional body fat percentage at time of photo */
  bodyFatPercent: number | null;

  /** Notes about the photo */
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

// ============ SET QUALITY FEEDBACK & PR TRACKING ============

/**
 * PR (Personal Record) determination result
 */
export interface PRResult {
  /** Whether this qualifies as a personal record */
  isPR: boolean;
  /** Type of PR if applicable */
  type?: 'weight' | 'reps' | 'e1rm' | 'volume' | 'form';
  /** Reason code for the result */
  reason: 'new_pr' | 'form_breakdown' | 'form_regression' | 'not_better' | 'first_time';
  /** Human-readable message */
  message: string;
  /** Improvement percentage if applicable */
  improvement?: number;
}

/**
 * Criteria used to evaluate a potential PR
 */
export interface PRCriteria {
  weight: number;
  reps: number;
  repsInTank: RepsInTank;
  form: FormRating;
  e1rm?: number;
}

/**
 * Weight suggestion with form-based context
 */
export interface WeightSuggestion {
  /** Suggested weight in kg */
  weight: number;
  /** Reason for the suggestion */
  reason:
    | 'form_correction'
    | 'form_consolidation'
    | 'progression'
    | 'on_target'
    | 'intensity_reduction'
    | 'first_time';
  /** Human-readable explanation */
  message: string;
  /** Confidence level in the suggestion */
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Form trend warning for exercise history
 */
export interface FormTrendWarning {
  /** Type of form issue detected */
  type: 'declining_form' | 'persistent_breakdown';
  /** Warning message */
  message: string;
  /** Suggested action */
  suggestion: string;
  /** Recommended action type */
  action: 'deload_suggested' | 'deload_required' | 'monitor';
}

/**
 * Session history for form tracking
 */
export interface SessionFormHistory {
  sessionDate: string;
  exerciseId: string;
  sets: Array<{
    weight: number;
    reps: number;
    form: FormRating;
    repsInTank: RepsInTank;
  }>;
}

// ============ UTILITY FUNCTIONS ============

/**
 * Convert Reps In Reserve to RPE
 * RIR 4+ = RPE 6, RIR 2-3 = RPE 7.5, RIR 1 = RPE 9, RIR 0 = RPE 10
 */
export function rirToRpe(rir: RepsInTank): number {
  switch (rir) {
    case 4:
      return 6; // 4+ RIR = Easy
    case 2:
      return 7.5; // 2-3 RIR = Good
    case 1:
      return 9; // 1 RIR = Hard
    case 0:
      return 10; // 0 RIR = Maxed out
    default:
      return 10 - rir;
  }
}

/**
 * Convert RPE to approximate Reps In Reserve
 */
export function rpeToRir(rpe: number): RepsInTank {
  if (rpe <= 6) return 4;
  if (rpe <= 8) return 2;
  if (rpe <= 9) return 1;
  return 0;
}

/**
 * Calculate form score (0-1 scale)
 * clean = 1.0, some_breakdown = 0.5, ugly = 0
 */
export function calculateFormScore(form: FormRating): number {
  switch (form) {
    case 'clean':
      return 1.0;
    case 'some_breakdown':
      return 0.5;
    case 'ugly':
      return 0;
  }
}

/**
 * Calculate average form score from an array of form ratings
 */
export function calculateAvgFormScore(forms: FormRating[]): number {
  if (forms.length === 0) return 1.0;
  return forms.reduce((sum, form) => sum + calculateFormScore(form), 0) / forms.length;
}

// ============ BODYWEIGHT PR & PROGRESSION ============

/**
 * PR type for bodyweight exercises
 */
export type BodyweightPRType = 'weighted' | 'assisted' | 'pure_reps';

/**
 * Personal record for bodyweight exercises
 * Tracks different types of PRs (weighted, assisted, pure BW)
 */
export interface BodyweightPR {
  type: BodyweightPRType;

  /** For weighted PRs: highest added weight */
  maxAddedWeightKg?: number;
  /** Reps achieved at max added weight */
  maxAddedWeightReps?: number;

  /** For assisted PRs: lowest assistance weight (lower = better) */
  minAssistanceWeightKg?: number;
  /** Reps achieved at min assistance */
  minAssistanceReps?: number;

  /** For pure bodyweight PRs: max reps */
  maxReps?: number;

  /** Calculated max effective load */
  maxEffectiveLoadKg?: number;
  /** Reps at max effective load */
  maxEffectiveLoadReps?: number;

  /** User's bodyweight at time of PR */
  bodyweightAtPRKg: number;

  /** Date of the PR */
  date: string;
}

/**
 * Metrics for tracking bodyweight exercise progression
 */
export interface BodyweightProgressionMetrics {
  /** Track added weight increases over time (for weighted sets) */
  addedWeightProgression: number[];

  /** Track assistance reduction over time (for assisted sets) - lower is better */
  assistanceReduction: number[];

  /** Track effective load over time */
  effectiveLoadProgression: number[];

  /** Track percentage of bodyweight being moved */
  percentBodyweightProgression: number[];
}

/**
 * Suggestion for bodyweight exercise progression
 */
export interface BodyweightProgressionSuggestion {
  type: 'graduate' | 'reduce_assistance' | 'add_weight' | 'increase_weight' | 'maintain';
  message: string;
  suggestion: string;
  /** Suggested value (new assistance weight, new added weight, etc.) */
  suggestedValue?: number;
}

/**
 * Context for bodyweight changes between sessions
 */
export interface BodyweightChangeContext {
  message: string;
  previousTotalKg: number;
  newTotalKg: number;
  suggestedAdjustment: string;
}

/**
 * Calculate percentage of bodyweight being moved
 */
export function calculatePercentBodyweight(
  effectiveLoadKg: number,
  userBodyweightKg: number
): number {
  if (userBodyweightKg <= 0) return 100;
  return Math.round((effectiveLoadKg / userBodyweightKg) * 100);
}

