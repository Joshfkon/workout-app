/**
 * Fatigue Budget Engine
 * Tracks systemic and local fatigue to prevent junk volume and optimize
 * stimulus-to-fatigue ratios.
 */

import type {
  MovementPattern,
  Equipment,
  ExerciseEntry,
  ExtendedUserProfile,
  ExerciseFatigueProfile,
  FatigueBudgetConfig,
  ExerciseAddResult,
  SessionFatigueSummary,
} from '@/types/schema';
import { toStandardMuscleForVolume } from '@/lib/migrations/muscle-groups';
import { SECONDARY_MUSCLE_CREDIT } from '@/services/shared/volumeCredit';

// ============================================================
// FATIGUE COST CONSTANTS
// ============================================================

/**
 * Systemic (CNS) fatigue by movement pattern
 * Higher values = more demanding on the nervous system
 */
export const SYSTEMIC_FATIGUE_BY_PATTERN: Record<MovementPattern | 'isolation' | 'carry', number> = {
  squat: 25,           // Very high systemic demand
  hip_hinge: 30,       // Deadlifts are the most fatiguing
  horizontal_push: 12,
  horizontal_pull: 10,
  vertical_push: 10,
  vertical_pull: 8,
  lunge: 15,
  knee_flexion: 5,
  elbow_flexion: 3,
  elbow_extension: 3,
  shoulder_isolation: 4,
  calf_raise: 4,
  core: 5,
  isolation: 3,
  carry: 12,
};

// Import and re-export the shared equipment fatigue multiplier
import { EQUIPMENT_FATIGUE_MULTIPLIER } from '@/services/shared/fatigueConstants';
export const EQUIPMENT_FATIGUE_MODIFIER = EQUIPMENT_FATIGUE_MULTIPLIER;

/**
 * Stimulus-to-Fatigue Ratios (SFR) by exercise type
 * Higher = more bang for your buck (more muscle stimulus per unit of fatigue)
 */
export const BASE_SFR: Record<MovementPattern | 'isolation' | 'carry', Record<Equipment, number>> = {
  squat: { barbell: 0.7, dumbbell: 0.8, machine: 1.2, cable: 0.9, bodyweight: 0.6, kettlebell: 0.75 },
  hip_hinge: { barbell: 0.5, dumbbell: 0.7, machine: 1.0, cable: 1.1, bodyweight: 0.5, kettlebell: 0.8 },
  horizontal_push: { barbell: 0.8, dumbbell: 0.9, machine: 1.3, cable: 1.1, bodyweight: 0.7, kettlebell: 0.7 },
  horizontal_pull: { barbell: 0.7, dumbbell: 0.9, machine: 1.2, cable: 1.2, bodyweight: 0.8, kettlebell: 0.7 },
  vertical_push: { barbell: 0.8, dumbbell: 0.9, machine: 1.2, cable: 1.0, bodyweight: 0.6, kettlebell: 0.7 },
  vertical_pull: { barbell: 0.7, dumbbell: 0.8, machine: 1.1, cable: 1.3, bodyweight: 0.9, kettlebell: 0.6 },
  lunge: { barbell: 0.7, dumbbell: 0.9, machine: 1.0, cable: 0.8, bodyweight: 0.8, kettlebell: 0.85 },
  knee_flexion: { barbell: 0.8, dumbbell: 0.9, machine: 1.4, cable: 1.2, bodyweight: 0.7, kettlebell: 0.7 },
  elbow_flexion: { barbell: 0.9, dumbbell: 1.0, machine: 1.3, cable: 1.5, bodyweight: 0.8, kettlebell: 0.8 },
  elbow_extension: { barbell: 0.9, dumbbell: 1.0, machine: 1.3, cable: 1.5, bodyweight: 0.8, kettlebell: 0.8 },
  shoulder_isolation: { barbell: 0.8, dumbbell: 1.0, machine: 1.2, cable: 1.4, bodyweight: 0.7, kettlebell: 0.8 },
  calf_raise: { barbell: 0.8, dumbbell: 0.9, machine: 1.4, cable: 1.0, bodyweight: 0.7, kettlebell: 0.7 },
  core: { barbell: 0.7, dumbbell: 0.8, machine: 1.2, cable: 1.3, bodyweight: 1.0, kettlebell: 0.9 },
  isolation: { barbell: 0.9, dumbbell: 1.0, machine: 1.4, cable: 1.5, bodyweight: 0.8, kettlebell: 0.8 },
  carry: { barbell: 0.6, dumbbell: 1.0, machine: 0.5, cable: 0.5, bodyweight: 0.7, kettlebell: 1.1 },
};

// ============================================================
// EXERCISE FATIGUE CALCULATION
// ============================================================

/**
 * Calculate the fatigue profile for a single exercise
 */
export function calculateExerciseFatigue(
  exercise: ExerciseEntry,
  sets: number,
  reps: number,
  rirTarget: number,
  positionInWorkout: number
): ExerciseFatigueProfile {
  
  // Base systemic cost from movement pattern
  let systemicCost = SYSTEMIC_FATIGUE_BY_PATTERN[exercise.pattern] || 5;
  
  // Equipment modifier
  systemicCost *= EQUIPMENT_FATIGUE_MODIFIER[exercise.equipment];
  
  // Volume scaling (non-linear - fatigue accumulates faster at higher volumes)
  const volumeFactor = sets * (1 + (sets - 1) * 0.1);  // 3 sets = 3.6x, 4 sets = 5.2x
  systemicCost *= volumeFactor * 0.15;
  
  // Intensity scaling (lower RIR = harder = more fatigue)
  const intensityFactor = 1 + (3 - rirTarget) * 0.15;  // RIR 0 = 1.45x, RIR 3 = 1.0x
  systemicCost *= intensityFactor;
  
  // Position penalty - fatigue accumulates, later exercises cost more
  const positionPenalty = 1 + (positionInWorkout - 1) * 0.05;
  systemicCost *= positionPenalty;
  
  // Rep range affects fatigue differently. Duration exercises pass SECONDS in
  // the reps argument, so the rep-count heuristic would misread every hold
  // (60s ≠ 60 reps): treat timed isometric work as metabolic, never CNS-heavy.
  const isDurationExercise = exercise.exerciseType === 'duration_based';
  if (isDurationExercise) {
    systemicCost *= 0.9;
  } else if (reps <= 5) {
    systemicCost *= 1.2;  // CNS-heavy
  } else if (reps >= 15) {
    systemicCost *= 0.9;  // Less CNS, more metabolic
  }
  
  // === LOCAL FATIGUE ===
  // Normalize muscle keys to standard format for consistent lookups.
  // Secondary involvement is derived from the app's ONE secondary coefficient
  // (SECONDARY_MUSCLE_CREDIT, 0.5) rather than a parallel constant — the
  // historical 8-vs-4 point split was that same ratio restated (#634).
  const localCost = new Map<string, number>();
  const primaryPointsPerSet = 8;

  // Primary muscle gets full local fatigue
  const primaryLocalCost = sets * primaryPointsPerSet * intensityFactor;
  const normalizedPrimary = toStandardMuscleForVolume(exercise.primaryMuscle) ?? exercise.primaryMuscle;
  localCost.set(normalizedPrimary, primaryLocalCost);

  // Secondary muscles get partial fatigue
  for (const secondary of exercise.secondaryMuscles) {
    const secondaryCost = sets * primaryPointsPerSet * SECONDARY_MUSCLE_CREDIT * intensityFactor;
    const normalizedSecondary = toStandardMuscleForVolume(secondary) ?? secondary;
    // Accumulate if same standard muscle hit multiple times
    const existing = localCost.get(normalizedSecondary) ?? 0;
    localCost.set(normalizedSecondary, existing + secondaryCost);
  }

  // === STIMULUS-TO-FATIGUE RATIO ===
  const baseSFR = BASE_SFR[exercise.pattern]?.[exercise.equipment] ?? 1.0;

  // SFR decreases later in workout (diminishing returns)
  const positionSFRPenalty = Math.max(0.5, 1 - (positionInWorkout - 1) * 0.1);
  const stimulusPerFatigue = baseSFR * positionSFRPenalty;

  // (recoveryDays was computed here for years and read by nothing — between-
  // session recovery belongs to services/muscleRecovery, which planning now
  // consults via services/plannedRecovery. Removed in #634.)

  return {
    systemicCost: Math.round(systemicCost * 10) / 10,
    localCost,
    stimulusPerFatigue: Math.round(stimulusPerFatigue * 100) / 100,
  };
}

// ============================================================
// FATIGUE BUDGET CONFIGURATION
// ============================================================

/**
 * Create fatigue budget limits based on user profile
 */
export function createFatigueBudget(profile: ExtendedUserProfile): FatigueBudgetConfig {
  let systemicLimit = 100;
  let localLimit = 80;
  let minSFRThreshold = 0.6;
  
  // Age adjustment. (A stricter >=55 tier used to sit in an `else if` AFTER
  // the >=45 check, making it unreachable — every 55+ profile matched >=45
  // first. Deleted rather than reordered in #634 so shipped behavior is
  // preserved exactly; introducing a real 55+ tier is a plan-shape change
  // that needs its own review.)
  if (profile.age >= 45) {
    systemicLimit *= 0.85;
    localLimit *= 0.9;
    minSFRThreshold = 0.7;
  }
  
  // Experience adjustments
  if (profile.experience === 'novice') {
    systemicLimit *= 0.75;
    localLimit *= 0.8;
    minSFRThreshold = 0.8;  // Stick to efficient exercises
  } else if (profile.experience === 'advanced') {
    systemicLimit *= 1.15;
    localLimit *= 1.1;
    minSFRThreshold = 0.5;  // Can tolerate less efficient exercises
  }
  
  // Sleep/stress adjustments
  const recoveryMultiplier = (profile.sleepQuality / 5) * (1 - (profile.stressLevel - 1) / 8);
  systemicLimit *= (0.7 + recoveryMultiplier * 0.6);  // Range: 0.7 to 1.3
  
  // Goal adjustments
  if (profile.goal === 'cut') {
    systemicLimit *= 0.85;  // Less capacity in a deficit
    localLimit *= 0.9;
  }
  
  return {
    systemicLimit: Math.round(systemicLimit),
    localLimit: Math.round(localLimit),
    minSFRThreshold: Math.round(minSFRThreshold * 100) / 100,
    warningThreshold: 0.8,
  };
}

// ============================================================
// SESSION FATIGUE MANAGER
// ============================================================

interface SessionFatigueState {
  currentSystemic: number;
  currentLocal: Map<string, number>;
  exercisesPerformed: number;
  sfrRunningAverage: number;
}

/**
 * Manages fatigue accumulation during a single workout session
 */
export class SessionFatigueManager {
  private state: SessionFatigueState;
  private config: FatigueBudgetConfig;
  private warnings: string[];
  
  constructor(config: FatigueBudgetConfig) {
    this.config = config;
    this.warnings = [];
    this.state = {
      currentSystemic: 0,
      currentLocal: new Map(),
      exercisesPerformed: 0,
      sfrRunningAverage: 0,
    };
  }
  
  /**
   * Check if an exercise can be added without exceeding fatigue limits
   */
  canAddExercise(fatigue: ExerciseFatigueProfile): ExerciseAddResult {
    // Check systemic limit
    if (this.state.currentSystemic + fatigue.systemicCost > this.config.systemicLimit) {
      return {
        allowed: false,
        reason: `Would exceed systemic fatigue limit (${this.config.systemicLimit})`,
        efficiency: 'junk',
      };
    }
    
    // Check local limits for all muscles hit
    const localEntries = Array.from(fatigue.localCost.entries());
    for (const [muscle, cost] of localEntries) {
      const current = this.state.currentLocal.get(muscle) ?? 0;
      if (current + cost > this.config.localLimit) {
        return {
          allowed: false,
          reason: `Would exceed local fatigue limit for ${muscle} (${this.config.localLimit})`,
          efficiency: 'junk',
        };
      }
    }
    
    // Check SFR threshold
    if (fatigue.stimulusPerFatigue < this.config.minSFRThreshold) {
      return {
        allowed: false,
        reason: `SFR (${fatigue.stimulusPerFatigue}) below threshold (${this.config.minSFRThreshold})`,
        efficiency: 'junk',
      };
    }
    
    // Determine efficiency rating
    let efficiency: 'optimal' | 'acceptable' | 'suboptimal' | 'junk';
    if (fatigue.stimulusPerFatigue >= 1.0) {
      efficiency = 'optimal';
    } else if (fatigue.stimulusPerFatigue >= 0.8) {
      efficiency = 'acceptable';
    } else {
      efficiency = 'suboptimal';
    }
    
    // Warn if approaching limits
    if (this.state.currentSystemic / this.config.systemicLimit > this.config.warningThreshold) {
      this.warnings.push('Approaching systemic fatigue limit');
    }
    
    return { allowed: true, efficiency };
  }
  
  /**
   * Add exercise fatigue to the session totals
   */
  addExercise(fatigue: ExerciseFatigueProfile): void {
    this.state.currentSystemic += fatigue.systemicCost;
    
    const fatigueEntries = Array.from(fatigue.localCost.entries());
    for (const [muscle, cost] of fatigueEntries) {
      const current = this.state.currentLocal.get(muscle) ?? 0;
      this.state.currentLocal.set(muscle, current + cost);
    }
    
    // Update running SFR average
    const totalExercises = this.state.exercisesPerformed + 1;
    this.state.sfrRunningAverage = 
      (this.state.sfrRunningAverage * this.state.exercisesPerformed + fatigue.stimulusPerFatigue) 
      / totalExercises;
    
    this.state.exercisesPerformed = totalExercises;
  }
  
  /**
   * Get remaining fatigue budget
   */
  getRemainingBudget(): {
    systemic: number;
    localByMuscle: Map<string, number>;
    percentUsed: number;
  } {
    const localRemaining = new Map<string, number>();
    
    const currentLocalEntries = Array.from(this.state.currentLocal.entries());
    for (const [muscle, current] of currentLocalEntries) {
      localRemaining.set(muscle, this.config.localLimit - current);
    }
    
    return {
      systemic: this.config.systemicLimit - this.state.currentSystemic,
      localByMuscle: localRemaining,
      percentUsed: (this.state.currentSystemic / this.config.systemicLimit) * 100,
    };
  }
  
  /**
   * Get complete session fatigue summary
   */
  getSessionSummary(): SessionFatigueSummary {
    const capacityUsed = (this.state.currentSystemic / this.config.systemicLimit) * 100;
    
    let recommendation: string;
    if (capacityUsed < 60) {
      recommendation = 'Session may be too light - consider adding volume or intensity';
    } else if (capacityUsed < 80) {
      recommendation = 'Good session intensity - sustainable long-term';
    } else if (capacityUsed < 95) {
      recommendation = 'High intensity session - ensure adequate recovery';
    } else {
      recommendation = 'Maximum intensity reached - do not exceed, prioritize recovery';
    }
    
    return {
      totalSystemicFatigue: Math.round(this.state.currentSystemic * 10) / 10,
      systemicCapacityUsed: Math.round(capacityUsed),
      localFatigueByMuscle: Object.fromEntries(this.state.currentLocal),
      averageSFR: Math.round(this.state.sfrRunningAverage * 100) / 100,
      exerciseCount: this.state.exercisesPerformed,
      warnings: this.warnings,
      recommendation,
    };
  }
  
  /**
   * Estimate how many sets of a given exercise type can still fit
   */
  estimateRemainingSets(
    pattern: MovementPattern | 'isolation' | 'carry',
    equipment: Equipment,
    targetRIR: number
  ): number {
    const remainingSystemic = this.config.systemicLimit - this.state.currentSystemic;
    
    const baseCost = (SYSTEMIC_FATIGUE_BY_PATTERN[pattern] || 5) * EQUIPMENT_FATIGUE_MODIFIER[equipment];
    const intensityFactor = 1 + (3 - targetRIR) * 0.15;
    const costPerSet = baseCost * 0.15 * intensityFactor;
    
    return Math.floor(remainingSystemic / costPerSet);
  }
}

// ============================================================
// (WeeklyFatigueTracker lived here until #634. It was a second between-
// session fatigue model — its own accumulation points, decay rate and
// thresholds, disagreeing with the readiness model users see. Mesocycle
// generation now consults the shared model through
// services/plannedRecovery.PlannedWeekRecovery instead. This module keeps
// only the WITHIN-SESSION systemic/local budget, which has no counterpart
// in services/muscleRecovery.)
// ============================================================
