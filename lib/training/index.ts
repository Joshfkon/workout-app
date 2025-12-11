// Training Science Module Exports
export { ProgramEngine, calculateBodyComposition, estimate1RM, calculateWorkingWeight } from './programEngine';
export { CoachingService } from './coachingService';
export {
  getWeightRecommendationsForWorkout,
  getTodayMesocycleWorkout,
  checkShouldDeload,
  recordWorkoutExerciseHistory,
  getUserRecoveryFactors,
  hasCompletedTrainingOnboarding,
} from './workoutIntegration';
export {
  EXERCISE_DATABASE,
  BENCHMARK_LIFTS,
  MUSCLE_FIBER_PROFILE,
  STRENGTH_STANDARDS,
  BASE_SFR,
  SYSTEMIC_FATIGUE_BY_PATTERN,
  EQUIPMENT_FATIGUE_MODIFIER,
  EXERCISE_RELATIONSHIPS,
  getExercisesByMuscle,
  getExercisesByPattern,
  getExercisesByEquipment,
  getBenchmarkById,
  getExerciseRelationship,
  getSFR,
  getSystemicFatigue,
} from './constants';

