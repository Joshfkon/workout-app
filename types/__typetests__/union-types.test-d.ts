/**
 * Type tests for union types in schema.ts
 * These tests verify that TypeScript correctly accepts valid values
 * and rejects invalid values for our union types.
 */
import { expectAssignable, expectNotAssignable } from 'tsd';
import type {
  Goal,
  Experience,
  SetQuality,
  FormRating,
  RepsInTank,
  SessionState,
  ProgressionType,
  VolumeStatus,
  WeightUnit,
  Rating,
  Mechanic,
  Equipment,
  Split,
  PeriodizationModel,
  DeloadStrategy,
  ExerciseDifficulty,
  ExerciseType,
  FatigueRating,
  HypertrophyTier,
  HypertrophyRating,
  DiscomfortSeverity,
  MesocycleState,
  BodyweightModification,
  BodyweightType,
  AssistanceType,
  SetType,
  WorkoutDay,
} from '../schema';

// ============================================================================
// Goal Type Tests
// ============================================================================

// Valid Goal values should be accepted
expectAssignable<Goal>('bulk');
expectAssignable<Goal>('cut');
expectAssignable<Goal>('maintenance');
expectAssignable<Goal>('recomp');

// Invalid Goal values should be rejected
expectNotAssignable<Goal>('gain');
expectNotAssignable<Goal>('lose');
expectNotAssignable<Goal>('maintain'); // Use 'maintenance' instead
expectNotAssignable<Goal>('');

// ============================================================================
// Experience Type Tests
// ============================================================================

// Valid Experience values
expectAssignable<Experience>('novice');
expectAssignable<Experience>('intermediate');
expectAssignable<Experience>('advanced');

// Invalid Experience values
expectNotAssignable<Experience>('beginner');
expectNotAssignable<Experience>('expert');
expectNotAssignable<Experience>('');

// ============================================================================
// SetQuality Type Tests
// ============================================================================

// Valid SetQuality values - critical for set classification
expectAssignable<SetQuality>('junk');
expectAssignable<SetQuality>('effective');
expectAssignable<SetQuality>('stimulative');
expectAssignable<SetQuality>('excessive');

// Invalid SetQuality values
expectNotAssignable<SetQuality>('good');
expectNotAssignable<SetQuality>('bad');
expectNotAssignable<SetQuality>('optimal');
expectNotAssignable<SetQuality>('');

// ============================================================================
// FormRating Type Tests
// ============================================================================

// Valid FormRating values
expectAssignable<FormRating>('clean');
expectAssignable<FormRating>('some_breakdown');
expectAssignable<FormRating>('ugly');

// Invalid FormRating values
expectNotAssignable<FormRating>('good');
expectNotAssignable<FormRating>('bad');
expectNotAssignable<FormRating>('perfect');

// ============================================================================
// RepsInTank Type Tests (Numeric Union)
// ============================================================================

// Valid RepsInTank values (0, 1, 2, 3, 4) - full RIR scale
expectAssignable<RepsInTank>(0);
expectAssignable<RepsInTank>(1);
expectAssignable<RepsInTank>(2);
expectAssignable<RepsInTank>(3);
expectAssignable<RepsInTank>(4);

// Invalid RepsInTank values - these numbers are NOT valid
expectNotAssignable<RepsInTank>(5);
expectNotAssignable<RepsInTank>(-1);

// ============================================================================
// Rating Type Tests (1-5 Scale)
// ============================================================================

// Valid Rating values
expectAssignable<Rating>(1);
expectAssignable<Rating>(2);
expectAssignable<Rating>(3);
expectAssignable<Rating>(4);
expectAssignable<Rating>(5);

// Invalid Rating values
expectNotAssignable<Rating>(0);
expectNotAssignable<Rating>(6);
expectNotAssignable<Rating>(-1);

// ============================================================================
// FatigueRating Type Tests (1-3 Scale)
// ============================================================================

// Valid FatigueRating values
expectAssignable<FatigueRating>(1);
expectAssignable<FatigueRating>(2);
expectAssignable<FatigueRating>(3);

// Invalid FatigueRating values
expectNotAssignable<FatigueRating>(0);
expectNotAssignable<FatigueRating>(4);

// ============================================================================
// HypertrophyTier Type Tests
// ============================================================================

// Valid HypertrophyTier values (S through F)
expectAssignable<HypertrophyTier>('S');
expectAssignable<HypertrophyTier>('A');
expectAssignable<HypertrophyTier>('B');
expectAssignable<HypertrophyTier>('C');
expectAssignable<HypertrophyTier>('D');
expectAssignable<HypertrophyTier>('F');

// Invalid HypertrophyTier values
expectNotAssignable<HypertrophyTier>('E');
expectNotAssignable<HypertrophyTier>('s');
expectNotAssignable<HypertrophyTier>('1');

// ============================================================================
// HypertrophyRating Type Tests (1-5 Scale)
// ============================================================================

expectAssignable<HypertrophyRating>(1);
expectAssignable<HypertrophyRating>(5);
expectNotAssignable<HypertrophyRating>(0);
expectNotAssignable<HypertrophyRating>(6);

// ============================================================================
// SessionState Type Tests
// ============================================================================

expectAssignable<SessionState>('planned');
expectAssignable<SessionState>('in_progress');
expectAssignable<SessionState>('completed');
expectAssignable<SessionState>('skipped');

expectNotAssignable<SessionState>('active');
expectNotAssignable<SessionState>('done');

// ============================================================================
// ProgressionType Type Tests
// ============================================================================

expectAssignable<ProgressionType>('load');
expectAssignable<ProgressionType>('reps');
expectAssignable<ProgressionType>('sets');
expectAssignable<ProgressionType>('technique');

expectNotAssignable<ProgressionType>('weight');
expectNotAssignable<ProgressionType>('volume');

// ============================================================================
// VolumeStatus Type Tests
// ============================================================================

expectAssignable<VolumeStatus>('below_mev');
expectAssignable<VolumeStatus>('effective');
expectAssignable<VolumeStatus>('optimal');
expectAssignable<VolumeStatus>('approaching_mrv');
expectAssignable<VolumeStatus>('exceeding_mrv');

expectNotAssignable<VolumeStatus>('low');
expectNotAssignable<VolumeStatus>('high');
expectNotAssignable<VolumeStatus>('over_mrv');

// ============================================================================
// WeightUnit Type Tests
// ============================================================================

expectAssignable<WeightUnit>('kg');
expectAssignable<WeightUnit>('lb');

expectNotAssignable<WeightUnit>('lbs');
expectNotAssignable<WeightUnit>('pounds');
expectNotAssignable<WeightUnit>('kilograms');

// ============================================================================
// Mechanic Type Tests
// ============================================================================

expectAssignable<Mechanic>('compound');
expectAssignable<Mechanic>('isolation');

expectNotAssignable<Mechanic>('complex');
expectNotAssignable<Mechanic>('simple');

// ============================================================================
// Equipment Type Tests
// ============================================================================

expectAssignable<Equipment>('barbell');
expectAssignable<Equipment>('dumbbell');
expectAssignable<Equipment>('cable');
expectAssignable<Equipment>('machine');
expectAssignable<Equipment>('bodyweight');
expectAssignable<Equipment>('kettlebell');

expectNotAssignable<Equipment>('bands');
expectNotAssignable<Equipment>('freeweight');

// ============================================================================
// Split Type Tests
// ============================================================================

expectAssignable<Split>('Full Body');
expectAssignable<Split>('Upper/Lower');
expectAssignable<Split>('PPL');
expectAssignable<Split>('Arnold');
expectAssignable<Split>('Bro Split');

expectNotAssignable<Split>('Push Pull Legs');
expectNotAssignable<Split>('full body');

// ============================================================================
// PeriodizationModel Type Tests
// ============================================================================

expectAssignable<PeriodizationModel>('linear');
expectAssignable<PeriodizationModel>('daily_undulating');
expectAssignable<PeriodizationModel>('weekly_undulating');
expectAssignable<PeriodizationModel>('block');

expectNotAssignable<PeriodizationModel>('dup');
expectNotAssignable<PeriodizationModel>('conjugate');

// ============================================================================
// DeloadStrategy Type Tests
// ============================================================================

expectAssignable<DeloadStrategy>('proactive');
expectAssignable<DeloadStrategy>('reactive');
expectAssignable<DeloadStrategy>('none');

expectNotAssignable<DeloadStrategy>('auto');
expectNotAssignable<DeloadStrategy>('manual');

// ============================================================================
// ExerciseDifficulty Type Tests
// ============================================================================

expectAssignable<ExerciseDifficulty>('beginner');
expectAssignable<ExerciseDifficulty>('intermediate');
expectAssignable<ExerciseDifficulty>('advanced');

expectNotAssignable<ExerciseDifficulty>('novice');
expectNotAssignable<ExerciseDifficulty>('expert');

// ============================================================================
// ExerciseType Type Tests
// ============================================================================

expectAssignable<ExerciseType>('rep_based');
expectAssignable<ExerciseType>('duration_based');

expectNotAssignable<ExerciseType>('reps');
expectNotAssignable<ExerciseType>('time');

// ============================================================================
// DiscomfortSeverity Type Tests
// ============================================================================

expectAssignable<DiscomfortSeverity>('twinge');
expectAssignable<DiscomfortSeverity>('discomfort');
expectAssignable<DiscomfortSeverity>('pain');
expectAssignable<DiscomfortSeverity>('stop');

expectNotAssignable<DiscomfortSeverity>('mild');
expectNotAssignable<DiscomfortSeverity>('severe');

// ============================================================================
// MesocycleState Type Tests
// ============================================================================

expectAssignable<MesocycleState>('planned');
expectAssignable<MesocycleState>('active');
expectAssignable<MesocycleState>('completed');

expectNotAssignable<MesocycleState>('in_progress');
expectNotAssignable<MesocycleState>('done');

// ============================================================================
// BodyweightModification Type Tests
// ============================================================================

expectAssignable<BodyweightModification>('none');
expectAssignable<BodyweightModification>('weighted');
expectAssignable<BodyweightModification>('assisted');

expectNotAssignable<BodyweightModification>('unweighted');
expectNotAssignable<BodyweightModification>('added');

// ============================================================================
// BodyweightType Type Tests
// ============================================================================

expectAssignable<BodyweightType>('pure');
expectAssignable<BodyweightType>('weighted_possible');
expectAssignable<BodyweightType>('assisted_possible');
expectAssignable<BodyweightType>('both');

expectNotAssignable<BodyweightType>('bodyweight');
expectNotAssignable<BodyweightType>('weighted');

// ============================================================================
// AssistanceType Type Tests
// ============================================================================

expectAssignable<AssistanceType>('machine');
expectAssignable<AssistanceType>('band');
expectAssignable<AssistanceType>('partner');

expectNotAssignable<AssistanceType>('spotter');
expectNotAssignable<AssistanceType>('resistance_band');

// ============================================================================
// SetType Type Tests
// ============================================================================

expectAssignable<SetType>('normal');
expectAssignable<SetType>('warmup');
expectAssignable<SetType>('dropset');
expectAssignable<SetType>('myorep');
expectAssignable<SetType>('rest_pause');

expectNotAssignable<SetType>('working');
expectNotAssignable<SetType>('cluster');

// ============================================================================
// WorkoutDay Type Tests
// ============================================================================

expectAssignable<WorkoutDay>('Monday');
expectAssignable<WorkoutDay>('Tuesday');
expectAssignable<WorkoutDay>('Wednesday');
expectAssignable<WorkoutDay>('Thursday');
expectAssignable<WorkoutDay>('Friday');
expectAssignable<WorkoutDay>('Saturday');
expectAssignable<WorkoutDay>('Sunday');

expectNotAssignable<WorkoutDay>('monday');
expectNotAssignable<WorkoutDay>('Mon');
expectNotAssignable<WorkoutDay>('Weekend');
