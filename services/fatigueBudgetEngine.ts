/**
 * Fatigue Budget Engine
 * Tracks systemic and local fatigue to prevent junk volume and optimize
 * stimulus-to-fatigue ratios.
 */

import type {
  Goal,
  Experience,
  MuscleGroup,
  MovementPattern,
  Equipment,
  Rating,
  ExerciseEntry,
  ExtendedUserProfile,
  ExerciseFatigueProfile,
  FatigueBudgetConfig,
  ExerciseAddResult,
  SessionFatigueSummary,
  MuscleRecoveryStatus,
  WeeklyMuscleVolumeStatus,
} from '@/types/schema';
import { MUSCLE_FIBER_PROFILE } from './repRangeEngine';

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

/**
 * Equipment modifiers for fatigue
 * Free weights require more stabilization = more fatigue
 */
export const EQUIPMENT_FATIGUE_MODIFIER: Record<Equipment, number> = {
  barbell: 1.3,        // Highest stability demand
  dumbbell: 1.1,
  kettlebell: 1.15,
  cable: 0.8,          // Low stability demand
  machine: 0.6,        // Lowest - very efficient
  bodyweight: 1.0,
};

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
  
  // Rep range affects fatigue differently
  if (reps <= 5) {
    systemicCost *= 1.2;  // CNS-heavy
  } else if (reps >= 15) {
    systemicCost *= 0.9;  // Less CNS, more metabolic
  }
  
  // === LOCAL FATIGUE ===
  const localCost = new Map<MuscleGroup, number>();
  
  // Primary muscle gets full local fatigue
  const primaryLocalCost = sets * 8 * intensityFactor;
  localCost.set(exercise.primaryMuscle, primaryLocalCost);
  
  // Secondary muscles get partial fatigue
  for (const secondary of exercise.secondaryMuscles) {
    const secondaryCost = sets * 4 * intensityFactor;
    localCost.set(secondary, secondaryCost);
  }
  
  // === STIMULUS-TO-FATIGUE RATIO ===
  const baseSFR = BASE_SFR[exercise.pattern]?.[exercise.equipment] ?? 1.0;
  
  // SFR decreases later in workout (diminishing returns)
  const positionSFRPenalty = Math.max(0.5, 1 - (positionInWorkout - 1) * 0.1);
  const stimulusPerFatigue = baseSFR * positionSFRPenalty;
  
  // === RECOVERY TIME ===
  let recoveryDays = 2;  // Base recovery
  
  // Big compounds need more recovery
  if (['squat', 'hip_hinge'].includes(exercise.pattern)) {
    recoveryDays = 3;
  }
  
  // High intensity extends recovery
  if (rirTarget <= 1) {
    recoveryDays += 0.5;
  }
  
  // Fast-twitch dominant muscles recover slower from heavy work
  const fiberType = MUSCLE_FIBER_PROFILE[exercise.primaryMuscle];
  if (fiberType === 'fast' && reps <= 6) {
    recoveryDays += 0.5;
  }
  
  return {
    systemicCost: Math.round(systemicCost * 10) / 10,
    localCost,
    stimulusPerFatigue: Math.round(stimulusPerFatigue * 100) / 100,
    recoveryDays: Math.round(recoveryDays * 2) / 2,  // Round to nearest 0.5
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
  
  // Age adjustments
  if (profile.age >= 45) {
    systemicLimit *= 0.85;
    localLimit *= 0.9;
    minSFRThreshold = 0.7;
  } else if (profile.age >= 55) {
    systemicLimit *= 0.7;
    localLimit *= 0.8;
    minSFRThreshold = 0.8;
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
  currentLocal: Map<MuscleGroup, number>;
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
    localByMuscle: Map<MuscleGroup, number>;
    percentUsed: number;
  } {
    const localRemaining = new Map<MuscleGroup, number>();
    
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
// WEEKLY FATIGUE TRACKER
// ============================================================

interface WeeklyFatigueState {
  muscleRecoveryStatus: Map<MuscleGroup, MuscleRecoveryStatus>;
  totalWeeklyVolume: Map<MuscleGroup, number>;
  cumulativeSystemicFatigue: number;
}

/**
 * Tracks fatigue and recovery across the training week
 */
export class WeeklyFatigueTracker {
  private state: WeeklyFatigueState;
  private profile: ExtendedUserProfile;
  
  constructor(profile: ExtendedUserProfile) {
    this.profile = profile;
    this.state = {
      muscleRecoveryStatus: new Map(),
      totalWeeklyVolume: new Map(),
      cumulativeSystemicFatigue: 0,
    };
    
    // Initialize all muscles
    const allMuscles: MuscleGroup[] = [
      'chest', 'back', 'shoulders', 'biceps', 'triceps',
      'quads', 'hamstrings', 'glutes', 'calves', 'abs',
    ];
    
    for (const muscle of allMuscles) {
      this.state.muscleRecoveryStatus.set(muscle, {
        lastTrainedDay: -7,  // Assume fully recovered at start
        fatigueLevel: 0,
        recoveryRate: this.calculateRecoveryRate(muscle),
      });
      this.state.totalWeeklyVolume.set(muscle, 0);
    }
  }
  
  private calculateRecoveryRate(muscle: MuscleGroup): number {
    // Base recovery: clear ~30 fatigue points per day
    let rate = 30;
    
    // Adjust by age
    if (this.profile.age >= 45) rate *= 0.85;
    if (this.profile.age >= 55) rate *= 0.75;
    
    // Adjust by sleep
    rate *= 0.7 + (this.profile.sleepQuality / 5) * 0.6;
    
    // Fiber type affects recovery
    const fiberType = MUSCLE_FIBER_PROFILE[muscle];
    if (fiberType === 'fast') {
      rate *= 0.9;  // Fast-twitch recovers slower
    } else if (fiberType === 'slow') {
      rate *= 1.1;  // Slow-twitch recovers faster
    }
    
    return rate;
  }
  
  /**
   * Check if a muscle is ready to be trained
   */
  canTrainMuscle(muscle: MuscleGroup, currentDay: number, plannedFatigue: number): {
    ready: boolean;
    currentFatigue: number;
    daysUntilReady: number;
    recommendation: string;
  } {
    const status = this.state.muscleRecoveryStatus.get(muscle)!;
    
    // Calculate current fatigue (decays over time)
    const daysSinceTraining = currentDay - status.lastTrainedDay;
    const recoveredAmount = daysSinceTraining * status.recoveryRate;
    const currentFatigue = Math.max(0, status.fatigueLevel - recoveredAmount);
    
    // Threshold: can train if below 30% residual fatigue
    const fatigueThreshold = 25;
    const ready = currentFatigue < fatigueThreshold;
    
    // Calculate days until ready
    const daysUntilReady = ready ? 0 : Math.ceil(
      (currentFatigue - fatigueThreshold) / status.recoveryRate
    );
    
    // Build recommendation
    let recommendation: string;
    if (currentFatigue === 0) {
      recommendation = 'Fully recovered - can train at full intensity';
    } else if (currentFatigue < 15) {
      recommendation = 'Well recovered - normal training';
    } else if (currentFatigue < 30) {
      recommendation = 'Moderate residual fatigue - consider reducing intensity';
    } else if (currentFatigue < 50) {
      recommendation = 'High residual fatigue - reduce volume significantly or skip';
    } else {
      recommendation = 'Not recovered - skip this muscle today';
    }
    
    return { ready, currentFatigue, daysUntilReady, recommendation };
  }
  
  /**
   * Record that a muscle was trained
   */
  recordTraining(muscle: MuscleGroup, day: number, fatigueAdded: number, sets: number): void {
    const status = this.state.muscleRecoveryStatus.get(muscle)!;
    
    // Update fatigue level (accounting for decay since last training)
    const daysSince = day - status.lastTrainedDay;
    const recoveredAmount = daysSince * status.recoveryRate;
    const currentFatigue = Math.max(0, status.fatigueLevel - recoveredAmount);
    
    status.fatigueLevel = currentFatigue + fatigueAdded;
    status.lastTrainedDay = day;
    
    // Track weekly volume
    const currentVolume = this.state.totalWeeklyVolume.get(muscle) ?? 0;
    this.state.totalWeeklyVolume.set(muscle, currentVolume + sets);
  }
  
  /**
   * Get weekly volume status for all muscles
   */
  getWeeklyVolumeStatus(): Map<MuscleGroup, WeeklyMuscleVolumeStatus> {
    const result = new Map<MuscleGroup, WeeklyMuscleVolumeStatus>();
    
    const volumeEntries = Array.from(this.state.totalWeeklyVolume.entries());
    for (const [muscle, sets] of volumeEntries) {
      const isSmallMuscle = ['biceps', 'triceps', 'calves', 'abs'].includes(muscle);
      const target = isSmallMuscle 
        ? { min: 8, max: 14 } 
        : { min: 10, max: 20 };
      
      let status: 'under' | 'optimal' | 'over';
      if (sets < target.min) status = 'under';
      else if (sets > target.max) status = 'over';
      else status = 'optimal';
      
      result.set(muscle, { currentSets: sets, targetSets: target, status });
    }
    
    return result;
  }
  
  /**
   * Reset weekly counters (call at start of new week)
   */
  resetWeek(): void {
    const muscleKeys = Array.from(this.state.totalWeeklyVolume.keys());
    for (const muscle of muscleKeys) {
      this.state.totalWeeklyVolume.set(muscle, 0);
    }
    this.state.cumulativeSystemicFatigue = 0;
  }
}

