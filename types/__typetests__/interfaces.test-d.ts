/**
 * Type tests for complex interfaces in schema.ts
 * These tests verify that interfaces correctly enforce required/optional fields
 * and proper types for nested structures.
 */
import { expectType, expectAssignable, expectNotAssignable } from 'tsd';
import type {
  User,
  UserPreferences,
  VolumeLandmarks,
  Exercise,
  Mesocycle,
  WorkoutSession,
  ExerciseBlock,
  SetLog,
  SetFeedback,
  SetDiscomfort,
  PreWorkoutCheckIn,
  DailyCheckIn,
  WarmupSet,
  BodyweightEntry,
  BodyweightData,
  HypertrophyScore,
  TemporaryInjury,
  BandAssistance,
} from '../schema';

// ============================================================================
// User Interface Tests
// ============================================================================

// Valid complete User object
const validUser: User = {
  id: 'user-123',
  email: 'test@example.com',
  createdAt: '2024-01-01T00:00:00Z',
  goal: 'bulk',
  experience: 'intermediate',
  preferences: {
    units: 'kg',
    restTimerDefault: 90,
    showFormCues: true,
    showWarmupSuggestions: true,
  },
  volumeLandmarks: {
    chest: { mev: 8, mav: 16, mrv: 24 },
  },
};
expectAssignable<User>(validUser);

// User with optional preferences
const userWithOptionalPrefs: User = {
  id: 'user-456',
  email: 'test2@example.com',
  createdAt: '2024-01-02T00:00:00Z',
  goal: 'cut',
  experience: 'advanced',
  preferences: {
    units: 'lb',
    restTimerDefault: 120,
    showFormCues: false,
    showWarmupSuggestions: false,
    prioritizeHypertrophy: true,
    skipPreWorkoutCheckIn: true,
  },
  volumeLandmarks: {},
};
expectAssignable<User>(userWithOptionalPrefs);

// User goal must be valid
expectNotAssignable<User['goal']>('gain');
expectNotAssignable<User['goal']>('lose');

// User experience must be valid
expectNotAssignable<User['experience']>('beginner');
expectNotAssignable<User['experience']>('expert');

// ============================================================================
// UserPreferences Interface Tests
// ============================================================================

// Minimal valid UserPreferences
const minimalPrefs: UserPreferences = {
  units: 'kg',
  restTimerDefault: 90,
  showFormCues: true,
  showWarmupSuggestions: true,
};
expectAssignable<UserPreferences>(minimalPrefs);

// Full UserPreferences with optionals
const fullPrefs: UserPreferences = {
  units: 'lb',
  restTimerDefault: 120,
  showFormCues: true,
  showWarmupSuggestions: false,
  prioritizeHypertrophy: false,
  skipPreWorkoutCheckIn: true,
};
expectAssignable<UserPreferences>(fullPrefs);

// Units must be valid
expectNotAssignable<UserPreferences['units']>('lbs');
expectNotAssignable<UserPreferences['units']>('pounds');

// ============================================================================
// VolumeLandmarks Interface Tests
// ============================================================================

const validLandmarks: VolumeLandmarks = {
  mev: 6,
  mav: 12,
  mrv: 20,
};
expectAssignable<VolumeLandmarks>(validLandmarks);

// All fields are required
expectNotAssignable<VolumeLandmarks>({ mev: 6, mav: 12 });
expectNotAssignable<VolumeLandmarks>({ mev: 6 });
expectNotAssignable<VolumeLandmarks>({});

// ============================================================================
// Exercise Interface Tests
// ============================================================================

// Minimal valid Exercise
const minimalExercise: Exercise = {
  id: 'bench-press',
  name: 'Bench Press',
  primaryMuscle: 'chest',
  secondaryMuscles: ['triceps', 'front_delts'],
  mechanic: 'compound',
  defaultRepRange: [6, 10],
  defaultRir: 2,
  minWeightIncrementKg: 2.5,
  formCues: ['Retract shoulder blades', 'Arch upper back'],
  commonMistakes: ['Flaring elbows too much'],
  setupNote: 'Position eyes under bar',
  movementPattern: 'horizontal_push',
  equipmentRequired: ['barbell', 'bench'],
};
expectAssignable<Exercise>(minimalExercise);

// Exercise with hypertrophyScore
const exerciseWithHypertrophy: Exercise = {
  ...minimalExercise,
  id: 'incline-db-press',
  name: 'Incline Dumbbell Press',
  hypertrophyScore: {
    tier: 'S',
    stretchUnderLoad: 5,
    resistanceProfile: 4,
    progressionEase: 4,
  },
};
expectAssignable<Exercise>(exerciseWithHypertrophy);

// Exercise with video fields
const exerciseWithVideo: Exercise = {
  ...minimalExercise,
  demoGifUrl: 'https://example.com/demo.gif',
  demoThumbnailUrl: 'https://example.com/thumb.jpg',
  youtubeVideoId: 'abc123',
  exerciseType: 'rep_based',
};
expectAssignable<Exercise>(exerciseWithVideo);

// Rep range must be a tuple of two numbers
expectType<[number, number]>(minimalExercise.defaultRepRange);

// Mechanic must be valid
expectNotAssignable<Exercise['mechanic']>('multi-joint');

// ============================================================================
// HypertrophyScore Interface Tests
// ============================================================================

const validHypertrophyScore: HypertrophyScore = {
  tier: 'A',
  stretchUnderLoad: 4,
  resistanceProfile: 3,
  progressionEase: 5,
};
expectAssignable<HypertrophyScore>(validHypertrophyScore);

// Tier must be S-F
expectNotAssignable<HypertrophyScore['tier']>('E');
expectNotAssignable<HypertrophyScore['tier']>('G');

// Ratings must be 1-5
expectNotAssignable<HypertrophyScore['stretchUnderLoad']>(0);
expectNotAssignable<HypertrophyScore['stretchUnderLoad']>(6);

// ============================================================================
// Mesocycle Interface Tests
// ============================================================================

const validMesocycle: Mesocycle = {
  id: 'meso-123',
  userId: 'user-123',
  name: 'Hypertrophy Block 1',
  state: 'active',
  totalWeeks: 6,
  currentWeek: 3,
  deloadWeek: 6,
  daysPerWeek: 4,
  splitType: 'Upper/Lower',
  fatigueScore: 45,
  preferredWorkoutDays: ['Monday', 'Tuesday', 'Thursday', 'Friday'],
  sessionDurationMinutes: 60,
  createdAt: '2024-01-01T00:00:00Z',
  startedAt: '2024-01-01T00:00:00Z',
  completedAt: null,
};
expectAssignable<Mesocycle>(validMesocycle);

// State must be valid MesocycleState
expectNotAssignable<Mesocycle['state']>('in_progress');
expectNotAssignable<Mesocycle['state']>('done');

// preferredWorkoutDays can be null
const mesoWithNullDays: Mesocycle = {
  ...validMesocycle,
  preferredWorkoutDays: null,
};
expectAssignable<Mesocycle>(mesoWithNullDays);

// ============================================================================
// WorkoutSession Interface Tests
// ============================================================================

const validSession: WorkoutSession = {
  id: 'session-123',
  userId: 'user-123',
  mesocycleId: 'meso-123',
  state: 'in_progress',
  plannedDate: '2024-01-15',
  startedAt: '2024-01-15T09:00:00Z',
  completedAt: null,
  durationSeconds: null,
  preWorkoutCheckIn: null,
  sessionRpe: null,
  pumpRating: null,
  sessionNotes: null,
  completionPercent: 50,
};
expectAssignable<WorkoutSession>(validSession);

// Session state must be valid
expectNotAssignable<WorkoutSession['state']>('active');
expectNotAssignable<WorkoutSession['state']>('done');

// Ad-hoc session (no mesocycle)
const adhocSession: WorkoutSession = {
  ...validSession,
  mesocycleId: null,
};
expectAssignable<WorkoutSession>(adhocSession);

// ============================================================================
// ExerciseBlock Interface Tests
// ============================================================================

const validBlock: ExerciseBlock = {
  id: 'block-123',
  workoutSessionId: 'session-123',
  exerciseId: 'bench-press',
  order: 1,
  supersetGroupId: null,
  supersetOrder: null,
  targetSets: 4,
  targetRepRange: [8, 12],
  targetRir: 2,
  targetWeightKg: 80,
  targetRestSeconds: 90,
  progressionType: 'load',
  suggestionReason: 'Weight increase based on previous performance',
  warmupProtocol: [],
  note: null,
  dropsetsPerSet: 0,
  dropPercentage: 0,
};
expectAssignable<ExerciseBlock>(validBlock);

// Rep range must be tuple
expectType<[number, number]>(validBlock.targetRepRange);

// Progression type can be null
const blockNoProgression: ExerciseBlock = {
  ...validBlock,
  progressionType: null,
};
expectAssignable<ExerciseBlock>(blockNoProgression);

// ============================================================================
// SetLog Interface Tests
// ============================================================================

const validSetLog: SetLog = {
  id: 'set-123',
  exerciseBlockId: 'block-123',
  setNumber: 1,
  weightKg: 80,
  reps: 10,
  rpe: 8,
  restSeconds: 90,
  isWarmup: false,
  setType: 'normal',
  parentSetId: null,
  quality: 'stimulative',
  qualityReason: 'RPE 8 is in stimulative range',
  note: null,
  loggedAt: '2024-01-15T09:15:00Z',
  feedback: {
    repsInTank: 2,
    form: 'clean',
  },
};
expectAssignable<SetLog>(validSetLog);

// Quality must be valid SetQuality
expectNotAssignable<SetLog['quality']>('good');
expectNotAssignable<SetLog['quality']>('optimal');

// SetType must be valid
expectNotAssignable<SetLog['setType']>('working');

// ============================================================================
// SetFeedback Interface Tests
// ============================================================================

// Minimal feedback
const minimalFeedback: SetFeedback = {
  repsInTank: 2,
  form: 'clean',
};
expectAssignable<SetFeedback>(minimalFeedback);

// Feedback with discomfort
const feedbackWithDiscomfort: SetFeedback = {
  repsInTank: 1,
  form: 'some_breakdown',
  discomfort: {
    bodyPart: 'left_shoulder',
    severity: 'twinge',
  },
};
expectAssignable<SetFeedback>(feedbackWithDiscomfort);

// RepsInTank must be valid (0, 1, 2, 3, 4)
expectAssignable<SetFeedback['repsInTank']>(3);
expectNotAssignable<SetFeedback['repsInTank']>(5);

// Form must be valid
expectNotAssignable<SetFeedback['form']>('good');
expectNotAssignable<SetFeedback['form']>('perfect');

// ============================================================================
// SetDiscomfort Interface Tests
// ============================================================================

const validDiscomfort: SetDiscomfort = {
  bodyPart: 'lower_back',
  severity: 'discomfort',
};
expectAssignable<SetDiscomfort>(validDiscomfort);

// With optional fields
const fullDiscomfort: SetDiscomfort = {
  bodyPart: 'left_knee',
  side: 'left',
  severity: 'pain',
  notes: 'Felt grinding sensation',
};
expectAssignable<SetDiscomfort>(fullDiscomfort);

// Severity must be valid
expectNotAssignable<SetDiscomfort['severity']>('mild');
expectNotAssignable<SetDiscomfort['severity']>('severe');

// Body part must be valid
expectNotAssignable<SetDiscomfort['bodyPart']>('arm');
expectNotAssignable<SetDiscomfort['bodyPart']>('leg');

// ============================================================================
// PreWorkoutCheckIn Interface Tests
// ============================================================================

const validCheckIn: PreWorkoutCheckIn = {
  sleepHours: 7.5,
  sleepQuality: 4,
  stressLevel: 2,
  nutritionRating: 4,
  bodyweightKg: 85,
  readinessScore: 82,
};
expectAssignable<PreWorkoutCheckIn>(validCheckIn);

// With optional fields
const fullCheckIn: PreWorkoutCheckIn = {
  sleepHours: 8,
  sleepQuality: 5,
  stressLevel: 1,
  nutritionRating: 5,
  bodyweightKg: 85,
  focusRating: 4,
  libidoRating: 3,
  readinessScore: 95,
  refeedRecommended: false,
  temporaryInjuries: [
    { area: 'lower_back', severity: 1 },
  ],
};
expectAssignable<PreWorkoutCheckIn>(fullCheckIn);

// Rating fields must be 1-5 (type is Rating | null)
// These are nullable, so we test the base Rating type separately in union-types.test-d.ts

// ============================================================================
// TemporaryInjury Interface Tests
// ============================================================================

const validInjury: TemporaryInjury = {
  area: 'shoulder_left',
  severity: 2,
};
expectAssignable<TemporaryInjury>(validInjury);

// With description
const injuryWithDesc: TemporaryInjury = {
  area: 'knee_right',
  severity: 1,
  description: 'Slight discomfort from running',
};
expectAssignable<TemporaryInjury>(injuryWithDesc);

// Area must be valid
expectNotAssignable<TemporaryInjury['area']>('arm');

// Severity must be 1, 2, or 3
expectNotAssignable<TemporaryInjury['severity']>(0);
expectNotAssignable<TemporaryInjury['severity']>(4);

// ============================================================================
// WarmupSet Interface Tests
// ============================================================================

const validWarmup: WarmupSet = {
  setNumber: 1,
  percentOfWorking: 50,
  targetReps: 10,
  purpose: 'activation',
  restSeconds: 60,
};
expectAssignable<WarmupSet>(validWarmup);

// With bar only flag
const barOnlyWarmup: WarmupSet = {
  setNumber: 1,
  percentOfWorking: 0,
  targetReps: 15,
  purpose: 'warm up joints',
  restSeconds: 30,
  isBarOnly: true,
};
expectAssignable<WarmupSet>(barOnlyWarmup);

// ============================================================================
// BodyweightEntry Interface Tests
// ============================================================================

const validBodyweight: BodyweightEntry = {
  id: 'bw-123',
  userId: 'user-123',
  date: '2024-01-15',
  weightKg: 85,
  source: 'manual',
};
expectAssignable<BodyweightEntry>(validBodyweight);

// Source must be valid
expectNotAssignable<BodyweightEntry['source']>('scale');
expectNotAssignable<BodyweightEntry['source']>('automatic');

// ============================================================================
// BodyweightData Interface Tests
// ============================================================================

// Pure bodyweight (no modification)
const pureBodyweight: BodyweightData = {
  userBodyweightKg: 80,
  modification: 'none',
  effectiveLoadKg: 80,
};
expectAssignable<BodyweightData>(pureBodyweight);

// Weighted bodyweight exercise
const weightedBw: BodyweightData = {
  userBodyweightKg: 80,
  modification: 'weighted',
  addedWeightKg: 20,
  effectiveLoadKg: 100,
};
expectAssignable<BodyweightData>(weightedBw);

// Assisted bodyweight exercise
const assistedBw: BodyweightData = {
  userBodyweightKg: 80,
  modification: 'assisted',
  assistanceWeightKg: 30,
  assistanceType: 'machine',
  effectiveLoadKg: 50,
};
expectAssignable<BodyweightData>(assistedBw);

// Band assisted
const bandAssisted: BodyweightData = {
  userBodyweightKg: 70,
  modification: 'assisted',
  assistanceWeightKg: 20,
  assistanceType: 'band',
  bandColor: 'purple',
  effectiveLoadKg: 50,
};
expectAssignable<BodyweightData>(bandAssisted);

// Modification must be valid
expectNotAssignable<BodyweightData['modification']>('added');
expectNotAssignable<BodyweightData['modification']>('unweighted');

// AssistanceType must be valid
expectNotAssignable<BodyweightData['assistanceType']>('spotter');

// ============================================================================
// DailyCheckIn Interface Tests
// ============================================================================

const minimalDailyCheckIn: DailyCheckIn = {
  id: 'checkin-123',
  userId: 'user-123',
  date: '2024-01-15',
  createdAt: '2024-01-15T08:00:00Z',
};
expectAssignable<DailyCheckIn>(minimalDailyCheckIn);

// Full daily check-in
const fullDailyCheckIn: DailyCheckIn = {
  id: 'checkin-456',
  userId: 'user-123',
  date: '2024-01-16',
  sleepHours: 7,
  sleepQuality: 4,
  energyLevel: 3,
  focusRating: 4,
  libidoRating: 3,
  moodRating: 4,
  stressLevel: 2,
  sorenessLevel: 3,
  hungerLevel: 4,
  notes: 'Feeling good today',
  createdAt: '2024-01-16T08:00:00Z',
};
expectAssignable<DailyCheckIn>(fullDailyCheckIn);

// ============================================================================
// BandAssistance Interface Tests
// ============================================================================

const validBand: BandAssistance = {
  color: 'purple',
  label: 'Heavy',
  assistanceLbsRange: [40, 60],
};
expectAssignable<BandAssistance>(validBand);

// Color must be valid
expectNotAssignable<BandAssistance['color']>('blue');
expectNotAssignable<BandAssistance['color']>('orange');

// Range must be tuple of two numbers
expectType<[number, number]>(validBand.assistanceLbsRange);
