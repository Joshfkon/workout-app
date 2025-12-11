// ============================================================
// PROGRAM ENGINE
// Core service for generating and managing training programs
// ============================================================

import { createUntypedClient } from '@/lib/supabase/client';
import type {
  UserProfile,
  BodyComposition,
  Experience,
  Goal,
  Sex,
  Equipment,
  FullProgramRecommendation,
  DetailedSession,
  DetailedExercise,
  RepRangeConfig,
  WorkingWeightRecommendation,
  StrengthCalibrationRow,
  ExerciseHistoryRow,
  WeeklyFatigueLogRow,
  DeloadTriggers,
  MesocycleWeek,
  PeriodizationPlan,
  FatigueBudgetConfig,
  RecoveryFactors,
  Confidence,
  WarmupSet,
  VolumePerMuscle,
  Split,
  PeriodizationModel,
  WeeklyProgression,
  Exercise,
  FatigueProfile,
  FFMIBracket,
} from '@/types/training';
import type { MuscleGroup } from '@/types/schema';
import {
  EXERCISE_DATABASE,
  MUSCLE_FIBER_PROFILE,
  STRENGTH_STANDARDS,
  BASE_SFR,
  SYSTEMIC_FATIGUE_BY_PATTERN,
  EQUIPMENT_FATIGUE_MODIFIER,
  EXERCISE_RELATIONSHIPS,
} from './constants';

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function calculateAge(birthDate: string | null): number {
  if (!birthDate) return 30;
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

export function calculateBodyComposition(
  weightKg: number,
  bodyFatPercentage: number,
  heightCm: number
): BodyComposition {
  const leanMassKg = weightKg * (1 - bodyFatPercentage / 100);
  const heightM = heightCm / 100;
  const ffmi = (leanMassKg / (heightM * heightM)) + 6.1 * (1.8 - heightM);
  
  return {
    totalWeightKg: weightKg,
    heightCm,
    bodyFatPercentage,
    leanMassKg,
    ffmi: Math.round(ffmi * 10) / 10
  };
}

export function estimate1RM(weight: number, reps: number, rpe?: number): number {
  if (reps === 1) return weight;
  if (reps > 12) {
    return weight * (1 + reps / 40);
  }
  
  const effectiveReps = rpe ? reps + (10 - rpe) : reps;
  const brzycki = weight * (36 / (37 - effectiveReps));
  const epley = weight * (1 + effectiveReps / 30);
  const lombardi = weight * Math.pow(effectiveReps, 0.10);
  
  return Math.round(((brzycki + epley + lombardi) / 3) * 10) / 10;
}

export function calculateWorkingWeight(estimated1RM: number, targetReps: number, targetRIR: number): number {
  const effectiveReps = targetReps + targetRIR;
  const percentage = (37 - effectiveReps) / 36;
  const safetyMargin = 0.95;
  return Math.round(estimated1RM * percentage * safetyMargin * 10) / 10;
}

function roundToNearestPlate(weight: number): number {
  if (weight < 20) return Math.round(weight);
  return Math.round(weight / 2.5) * 2.5;
}

function getFFMIBracket(ffmi: number): FFMIBracket {
  if (ffmi < 18) return 'below_average';
  if (ffmi < 20) return 'average';
  if (ffmi < 22) return 'above_average';
  if (ffmi < 24) return 'excellent';
  return 'elite';
}

// ============================================================
// PROGRAM ENGINE CLASS
// ============================================================

export class ProgramEngine {
  private userId: string;
  private supabase: ReturnType<typeof createUntypedClient>;
  
  // Cached data
  private userProfile: UserProfile | null = null;
  private bodyComposition: BodyComposition | null = null;
  private calibrations: Map<string, StrengthCalibrationRow> = new Map();
  private exerciseHistory: Map<string, ExerciseHistoryRow[]> = new Map();
  
  constructor(userId: string) {
    this.userId = userId;
    this.supabase = createUntypedClient();
  }
  
  // ---- Static Factory ----
  
  static async create(userId: string): Promise<ProgramEngine> {
    const engine = new ProgramEngine(userId);
    await engine.loadUserData();
    return engine;
  }
  
  // ---- Data Loading ----
  
  async loadUserData(): Promise<void> {
    await Promise.all([
      this.loadTrainingProfile(),
      this.loadBodyComposition(),
      this.loadCalibrations(),
      this.loadExerciseHistory(),
    ]);
  }
  
  private async loadTrainingProfile(): Promise<void> {
    const { data } = await this.supabase
      .from('users')
      .select('*')
      .eq('id', this.userId)
      .single();
    
    if (data) {
      this.userProfile = {
        age: calculateAge(data.birth_date),
        sex: data.sex || 'male',
        experience: data.experience || 'novice',
        goal: data.goal || 'bulk',
        sleepQuality: (data.sleep_quality || 3) as 1 | 2 | 3 | 4 | 5,
        stressLevel: (data.stress_level || 3) as 1 | 2 | 3 | 4 | 5,
        availableEquipment: data.available_equipment || ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'],
        injuryHistory: data.injury_history || [],
        trainingAge: data.training_age_years || 0,
      };
    } else {
      // Default profile
      this.userProfile = {
        age: 30,
        sex: 'male',
        experience: 'novice',
        goal: 'bulk',
        sleepQuality: 3,
        stressLevel: 3,
        availableEquipment: ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'],
        injuryHistory: [],
        trainingAge: 0,
      };
    }
  }
  
  private async loadBodyComposition(): Promise<void> {
    const { data } = await this.supabase
      .from('dexa_scans')
      .select('*')
      .eq('user_id', this.userId)
      .order('scan_date', { ascending: false })
      .limit(1)
      .single();
    
    if (data) {
      // Get height from users table
      const { data: userData } = await this.supabase
        .from('users')
        .select('height_cm, weight_kg')
        .eq('id', this.userId)
        .single();
      
      const heightCm = userData?.height_cm || 175;
      
      this.bodyComposition = calculateBodyComposition(
        data.weight_kg,
        data.body_fat_percent,
        heightCm
      );
    }
  }
  
  private async loadCalibrations(): Promise<void> {
    // Try strength_calibrations first, fall back to calibrated_lifts
    const { data } = await this.supabase
      .from('calibrated_lifts')
      .select('*')
      .eq('user_id', this.userId)
      .order('tested_at', { ascending: false });
    
    if (data) {
      for (const row of data) {
        const exerciseName = row.lift_name || row.exercise_name;
        if (exerciseName && !this.calibrations.has(exerciseName)) {
          this.calibrations.set(exerciseName, {
            id: row.id,
            user_id: row.user_id,
            exercise_name: exerciseName,
            tested_weight_kg: row.tested_weight_kg,
            tested_reps: row.tested_reps,
            tested_rpe: row.tested_rpe,
            estimated_1rm_kg: row.estimated_1rm,
            confidence: 'high',
            source: 'calibration',
            percentile_general: row.percentile_vs_general,
            percentile_trained: row.percentile_vs_trained,
            strength_level: row.strength_level,
            tested_at: row.tested_at,
          });
        }
      }
    }
  }
  
  private async loadExerciseHistory(): Promise<void> {
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    
    const { data } = await this.supabase
      .from('exercise_history')
      .select('*')
      .eq('user_id', this.userId)
      .gte('performed_at', fourWeeksAgo.toISOString())
      .order('performed_at', { ascending: false });
    
    if (data) {
      for (const row of data as ExerciseHistoryRow[]) {
        const existing = this.exerciseHistory.get(row.exercise_name) || [];
        existing.push(row);
        this.exerciseHistory.set(row.exercise_name, existing);
      }
    }
  }
  
  // ---- Getters ----
  
  getUserProfile(): UserProfile {
    if (!this.userProfile) {
      throw new Error('User profile not loaded');
    }
    return this.userProfile;
  }
  
  getBodyComposition(): BodyComposition | null {
    return this.bodyComposition;
  }
  
  hasCompletedOnboarding(): boolean {
    return this.bodyComposition !== null && this.calibrations.size >= 3;
  }
  
  // ---- Recovery Factors ----
  
  calculateRecoveryFactors(): RecoveryFactors {
    const profile = this.getUserProfile();
    const warnings: string[] = [];
    
    let volumeMultiplier = 1.0;
    let frequencyMultiplier = 1.0;
    let baseDeloadWeeks = 5;
    
    // Age adjustments
    if (profile.age < 25) {
      volumeMultiplier *= 1.05;
      frequencyMultiplier *= 1.05;
      baseDeloadWeeks = 6;
    } else if (profile.age >= 35 && profile.age < 45) {
      volumeMultiplier *= 0.95;
      baseDeloadWeeks = 5;
    } else if (profile.age >= 45 && profile.age < 55) {
      volumeMultiplier *= 0.85;
      frequencyMultiplier *= 0.95;
      baseDeloadWeeks = 4;
      warnings.push('Consider extra warm-up sets and joint-friendly exercise variations.');
    } else if (profile.age >= 55) {
      volumeMultiplier *= 0.75;
      frequencyMultiplier *= 0.90;
      baseDeloadWeeks = 3;
      warnings.push('Prioritize recovery. Consider 2-on-1-off training schedules.');
    }
    
    // Sleep adjustments
    const sleepMultiplier: Record<number, number> = { 1: 0.70, 2: 0.85, 3: 1.00, 4: 1.05, 5: 1.10 };
    volumeMultiplier *= sleepMultiplier[profile.sleepQuality] || 1.0;
    
    if (profile.sleepQuality <= 2) {
      warnings.push('Sleep quality is limiting recovery. Fix this before adding volume.');
      baseDeloadWeeks = Math.max(3, baseDeloadWeeks - 1);
    }
    
    // Stress adjustments
    const stressMultiplier: Record<number, number> = { 1: 1.10, 2: 1.05, 3: 1.00, 4: 0.90, 5: 0.75 };
    volumeMultiplier *= stressMultiplier[profile.stressLevel] || 1.0;
    
    if (profile.stressLevel >= 4) {
      warnings.push('High life stress impairs recovery. Training should be a release, not another stressor.');
      baseDeloadWeeks = Math.max(3, baseDeloadWeeks - 1);
    }
    
    // Training age adjustments
    if (profile.trainingAge < 1) {
      volumeMultiplier *= 0.8;
      baseDeloadWeeks = 8;
    } else if (profile.trainingAge >= 5) {
      baseDeloadWeeks = Math.max(3, baseDeloadWeeks - 1);
    }
    
    // Clamp values
    volumeMultiplier = Math.max(0.5, Math.min(1.3, volumeMultiplier));
    frequencyMultiplier = Math.max(0.7, Math.min(1.2, frequencyMultiplier));
    
    return {
      volumeMultiplier,
      frequencyMultiplier,
      deloadFrequencyWeeks: Math.round(baseDeloadWeeks),
      warnings
    };
  }
  
  // ---- Fatigue Budget ----
  
  calculateFatigueBudget(): FatigueBudgetConfig {
    const profile = this.getUserProfile();
    
    let systemicLimit = 100;
    let localLimit = 80;
    let minSFRThreshold = 0.6;
    
    if (profile.age >= 45) {
      systemicLimit *= 0.85;
      localLimit *= 0.9;
      minSFRThreshold = 0.7;
    } else if (profile.age >= 55) {
      systemicLimit *= 0.7;
      localLimit *= 0.8;
      minSFRThreshold = 0.8;
    }
    
    if (profile.experience === 'novice') {
      systemicLimit *= 0.75;
      localLimit *= 0.8;
      minSFRThreshold = 0.8;
    } else if (profile.experience === 'advanced') {
      systemicLimit *= 1.15;
      localLimit *= 1.1;
      minSFRThreshold = 0.5;
    }
    
    const recoveryMultiplier = (profile.sleepQuality / 5) * (1 - (profile.stressLevel - 1) / 8);
    systemicLimit *= (0.7 + recoveryMultiplier * 0.6);
    
    if (profile.goal === 'cut') {
      systemicLimit *= 0.85;
      localLimit *= 0.9;
    }
    
    return {
      systemicLimit: Math.round(systemicLimit),
      localLimit: Math.round(localLimit),
      minSFRThreshold: Math.round(minSFRThreshold * 100) / 100,
      warningThreshold: 0.8
    };
  }
  
  // ---- Volume Recommendations ----
  
  calculateVolumePerMuscle(
    daysPerWeek: number,
    split: string
  ): Record<MuscleGroup, VolumePerMuscle> {
    const profile = this.getUserProfile();
    const recovery = this.calculateRecoveryFactors();
    
    // Base volume ranges by experience
    const volumeRanges: Record<Experience, { mev: number; mrv: number }> = {
      novice: { mev: 6, mrv: 12 },
      intermediate: { mev: 10, mrv: 18 },
      advanced: { mev: 12, mrv: 25 }
    };
    
    const { mev, mrv } = volumeRanges[profile.experience];
    
    // Adjust for goal
    let targetVolume: number;
    switch (profile.goal) {
      case 'cut':
        targetVolume = mev + (mrv - mev) * 0.3;
        break;
      case 'bulk':
        targetVolume = mev + (mrv - mev) * 0.7;
        break;
      default:
        targetVolume = mev + (mrv - mev) * 0.5;
    }
    
    // Apply recovery multiplier
    targetVolume = Math.round(targetVolume * recovery.volumeMultiplier);
    
    // Calculate frequency based on split
    const frequency = split === 'Full Body' ? Math.min(daysPerWeek, 3) : 2;
    
    const allMuscles: MuscleGroup[] = [
      'chest', 'back', 'shoulders', 'biceps', 'triceps',
      'quads', 'hamstrings', 'glutes', 'calves', 'abs'
    ];
    
    const result: Record<string, VolumePerMuscle> = {};
    
    for (const muscle of allMuscles) {
      let sets = targetVolume;
      
      // Small muscles get less volume
      if (['biceps', 'triceps', 'calves', 'abs'].includes(muscle)) {
        sets = Math.round(sets * 0.7);
      }
      
      result[muscle] = {
        sets: Math.max(4, sets),
        frequency
      };
    }
    
    return result as Record<MuscleGroup, VolumePerMuscle>;
  }
  
  // ---- Rep Range Calculation ----
  
  calculateRepRange(
    exerciseName: string,
    muscleGroup: MuscleGroup,
    pattern: string,
    positionInWorkout: number,
    weekInMesocycle: number,
    totalWeeks: number,
    periodizationModel: string
  ): RepRangeConfig {
    const profile = this.getUserProfile();
    const isCompound = pattern !== 'isolation';
    const fiberType = MUSCLE_FIBER_PROFILE[muscleGroup] || 'mixed';
    
    // Base ranges by goal
    const baseRanges: Record<Goal, { compound: number[]; isolation: number[] }> = {
      cut: { compound: [4, 6], isolation: [8, 12] },
      bulk: { compound: [6, 10], isolation: [10, 15] },
      recomp: { compound: [5, 8], isolation: [8, 12] },
      maintain: { compound: [5, 8], isolation: [8, 12] }
    };
    
    const base = isCompound 
      ? baseRanges[profile.goal].compound 
      : baseRanges[profile.goal].isolation;
    
    let minReps = base[0];
    let maxReps = base[1];
    
    // Fiber type adjustment
    if (fiberType === 'fast') {
      minReps = Math.max(3, minReps - 1);
      maxReps = Math.max(minReps + 2, maxReps - 1);
    } else if (fiberType === 'slow') {
      minReps += 2;
      maxReps += 3;
    }
    
    // Position adjustment (later = higher reps)
    if (positionInWorkout > 4) {
      minReps += 2;
      maxReps += 2;
    } else if (positionInWorkout > 2) {
      minReps += 1;
      maxReps += 1;
    }
    
    // Periodization phase adjustment
    const progress = weekInMesocycle / totalWeeks;
    if (periodizationModel === 'linear') {
      if (progress < 0.33) {
        minReps += 2;
        maxReps += 2;
      } else if (progress > 0.66) {
        minReps = Math.max(3, minReps - 1);
        maxReps = Math.max(minReps + 2, maxReps - 1);
      }
    } else if (periodizationModel === 'block') {
      if (progress < 0.5) {
        minReps += 2;
        maxReps += 3;
      } else if (progress < 0.85) {
        minReps = Math.max(3, minReps - 2);
        maxReps = Math.max(minReps + 2, maxReps - 2);
      }
    }
    
    // Experience adjustment
    if (profile.experience === 'novice') {
      minReps = Math.max(6, minReps);
      maxReps = Math.max(8, maxReps);
    }
    
    // Calculate RIR
    let targetRIR: number;
    if (profile.experience === 'novice') {
      targetRIR = 3 - Math.floor(progress * 1.5);
    } else if (profile.experience === 'intermediate') {
      targetRIR = 3 - Math.floor(progress * 2);
    } else {
      targetRIR = 2 - Math.floor(progress * 2);
    }
    targetRIR = Math.max(0, Math.min(4, targetRIR));
    
    // Tempo
    let tempo = '2-0-1-0';
    if (profile.goal === 'bulk' && progress < 0.5) {
      tempo = isCompound ? '3-0-1-1' : '3-1-1-0';
    }
    
    return {
      min: Math.max(1, Math.min(20, minReps)),
      max: Math.max(minReps + 2, Math.min(30, maxReps)),
      targetRIR,
      tempoRecommendation: tempo,
      notes: this.buildRepRangeNotes(fiberType, muscleGroup, positionInWorkout, targetRIR)
    };
  }
  
  private buildRepRangeNotes(
    fiberType: string,
    muscle: MuscleGroup,
    position: number,
    rir: number
  ): string {
    const notes: string[] = [];
    
    if (fiberType === 'fast') {
      notes.push(`${muscle} responds well to heavier loads`);
    } else if (fiberType === 'slow') {
      notes.push(`${muscle} benefits from higher reps and time under tension`);
    }
    
    if (position > 4) {
      notes.push('Late in workout - prioritize form over load');
    }
    
    if (rir <= 1) {
      notes.push('High intensity - push close to failure');
    }
    
    return notes.join('. ');
  }
  
  // ---- Weight Recommendations ----
  
  getWeightRecommendation(
    exerciseName: string,
    targetReps: { min: number; max: number },
    targetRIR: number
  ): WorkingWeightRecommendation {
    // Try calibration first
    const calibration = this.calibrations.get(exerciseName);
    if (calibration) {
      return this.calculateFromCalibration(exerciseName, calibration, targetReps, targetRIR);
    }
    
    // Try exercise history
    const history = this.exerciseHistory.get(exerciseName);
    if (history && history.length > 0) {
      return this.calculateFromHistory(exerciseName, history, targetReps, targetRIR);
    }
    
    // Try related exercises
    const relatedEstimate = this.estimateFromRelatedExercises(exerciseName);
    if (relatedEstimate) {
      return this.calculateFromEstimate(exerciseName, relatedEstimate, targetReps, targetRIR, 'low');
    }
    
    // Fall back to strength standards
    const standardEstimate = this.estimateFromStrengthStandards(exerciseName);
    if (standardEstimate) {
      return this.calculateFromEstimate(exerciseName, standardEstimate, targetReps, targetRIR, 'low');
    }
    
    // Last resort: finding weight protocol
    return this.generateFindingWeightProtocol(exerciseName, targetReps, targetRIR);
  }
  
  private calculateFromCalibration(
    exerciseName: string,
    calibration: StrengthCalibrationRow,
    targetReps: { min: number; max: number },
    targetRIR: number
  ): WorkingWeightRecommendation {
    const avgReps = Math.round((targetReps.min + targetReps.max) / 2);
    const workingWeight = calculateWorkingWeight(calibration.estimated_1rm_kg, avgReps, targetRIR);
    
    const confidence = calibration.confidence as Confidence;
    const variance = confidence === 'high' ? 0.05 : 0.10;
    
    return {
      exercise: exerciseName,
      targetReps,
      targetRIR,
      recommendedWeight: roundToNearestPlate(workingWeight),
      weightRange: {
        low: roundToNearestPlate(workingWeight * (1 - variance)),
        high: roundToNearestPlate(workingWeight * (1 + variance))
      },
      confidence,
      rationale: `Based on calibration test. Estimated 1RM: ${calibration.estimated_1rm_kg}kg.`,
      warmupProtocol: this.generateWarmupSets(workingWeight, exerciseName)
    };
  }
  
  private calculateFromHistory(
    exerciseName: string,
    history: ExerciseHistoryRow[],
    targetReps: { min: number; max: number },
    targetRIR: number
  ): WorkingWeightRecommendation {
    // Calculate best estimated 1RM from recent history
    const estimates: number[] = [];
    for (const session of history.slice(0, 10)) {
      for (const set of session.sets) {
        if (set.completed && set.reps >= 1 && set.reps <= 12) {
          estimates.push(estimate1RM(set.weight, set.reps, set.rpe));
        }
      }
    }
    
    if (estimates.length === 0) {
      return this.generateFindingWeightProtocol(exerciseName, targetReps, targetRIR);
    }
    
    estimates.sort((a, b) => b - a);
    const estimated1RM = estimates[Math.floor(estimates.length * 0.1)] || estimates[0];
    
    const avgReps = Math.round((targetReps.min + targetReps.max) / 2);
    const workingWeight = calculateWorkingWeight(estimated1RM, avgReps, targetRIR);
    
    const confidence: Confidence = history.length >= 3 ? 'high' : 'medium';
    const variance = confidence === 'high' ? 0.05 : 0.10;
    
    return {
      exercise: exerciseName,
      targetReps,
      targetRIR,
      recommendedWeight: roundToNearestPlate(workingWeight),
      weightRange: {
        low: roundToNearestPlate(workingWeight * (1 - variance)),
        high: roundToNearestPlate(workingWeight * (1 + variance))
      },
      confidence,
      rationale: `Based on recent training history. Estimated 1RM: ${Math.round(estimated1RM)}kg.`,
      warmupProtocol: this.generateWarmupSets(workingWeight, exerciseName)
    };
  }
  
  private estimateFromRelatedExercises(exerciseName: string): number | null {
    const relationship = EXERCISE_RELATIONSHIPS[exerciseName];
    if (!relationship) return null;
    
    // Try parent exercise
    if (relationship.parent !== exerciseName) {
      const parentCal = this.calibrations.get(relationship.parent);
      if (parentCal) {
        return parentCal.estimated_1rm_kg * relationship.ratioToParent;
      }
      
      const parentHistory = this.exerciseHistory.get(relationship.parent);
      if (parentHistory && parentHistory.length > 0) {
        const estimates = parentHistory.flatMap(h => 
          h.sets.filter(s => s.completed && s.reps <= 12)
            .map(s => estimate1RM(s.weight, s.reps, s.rpe))
        );
        if (estimates.length > 0) {
          const best = Math.max(...estimates);
          return best * relationship.ratioToParent;
        }
      }
    }
    
    return null;
  }
  
  private estimateFromStrengthStandards(exerciseName: string): number | null {
    if (!this.bodyComposition || !this.userProfile) return null;
    
    const ffmiBracket = getFFMIBracket(this.bodyComposition.ffmi);
    const standards = STRENGTH_STANDARDS[this.userProfile.experience]?.[ffmiBracket];
    if (!standards) return null;
    
    const standardMap: Record<string, keyof typeof standards> = {
      'Barbell Bench Press': 'benchPress',
      'Barbell Back Squat': 'squat',
      'Conventional Deadlift': 'deadlift',
      'Standing Overhead Press': 'overheadPress',
      'Barbell Row': 'barbellRow',
    };
    
    const key = standardMap[exerciseName];
    if (key) {
      return this.bodyComposition.totalWeightKg * standards[key];
    }
    
    // Try deriving from parent
    const relationship = EXERCISE_RELATIONSHIPS[exerciseName];
    if (relationship) {
      const parentKey = standardMap[relationship.parent];
      if (parentKey) {
        return this.bodyComposition.totalWeightKg * standards[parentKey] * relationship.ratioToParent;
      }
    }
    
    return null;
  }
  
  private calculateFromEstimate(
    exerciseName: string,
    estimated1RM: number,
    targetReps: { min: number; max: number },
    targetRIR: number,
    confidence: Confidence
  ): WorkingWeightRecommendation {
    const avgReps = Math.round((targetReps.min + targetReps.max) / 2);
    const workingWeight = calculateWorkingWeight(estimated1RM, avgReps, targetRIR);
    const conservativeWeight = workingWeight * 0.85;
    
    return {
      exercise: exerciseName,
      targetReps,
      targetRIR,
      recommendedWeight: roundToNearestPlate(conservativeWeight),
      weightRange: {
        low: roundToNearestPlate(conservativeWeight * 0.85),
        high: roundToNearestPlate(workingWeight)
      },
      confidence,
      rationale: 'Estimated from strength standards or related exercises. Start conservative.',
      warmupProtocol: this.generateWarmupSets(conservativeWeight, exerciseName),
      findingWeightProtocol: {
        startingWeight: roundToNearestPlate(conservativeWeight * 0.7),
        incrementKg: this.getAppropriateIncrement(exerciseName),
        targetRPE: 10 - targetRIR,
        maxAttempts: 4,
        instructions: `Start at ${roundToNearestPlate(conservativeWeight * 0.7)}kg and work up.`
      }
    };
  }
  
  private generateFindingWeightProtocol(
    exerciseName: string,
    targetReps: { min: number; max: number },
    targetRIR: number
  ): WorkingWeightRecommendation {
    // Very conservative starting point
    const startWeight = this.bodyComposition 
      ? this.bodyComposition.totalWeightKg * 0.2 
      : 20;
    
    const increment = this.getAppropriateIncrement(exerciseName);
    
    return {
      exercise: exerciseName,
      targetReps,
      targetRIR,
      recommendedWeight: 0,
      weightRange: { low: 0, high: 0 },
      confidence: 'find_working_weight',
      rationale: 'No history available. Use finding weight protocol.',
      findingWeightProtocol: {
        startingWeight: roundToNearestPlate(startWeight),
        incrementKg: increment,
        targetRPE: 10 - targetRIR,
        maxAttempts: 5,
        instructions: `Start with ${roundToNearestPlate(startWeight)}kg for ${targetReps.max} reps. If RPE < ${10 - targetRIR - 1}: Add ${increment}kg, rest 2-3 min, repeat. If RPE = ${10 - targetRIR}: You've found your working weight. Record for next session.`
      }
    };
  }
  
  private getAppropriateIncrement(exerciseName: string): number {
    const smallMuscle = ['Lateral Raise', 'Cable', 'Curl', 'Tricep', 'Face Pull', 'Reverse Fly'];
    if (smallMuscle.some(s => exerciseName.includes(s))) return 1;
    if (exerciseName.includes('Dumbbell')) return 2;
    return 2.5;
  }
  
  private generateWarmupSets(workingWeight: number, exerciseName: string): WarmupSet[] {
    if (workingWeight < 20) {
      return [{ percentOfWorking: 50, reps: 12, rest: 60, notes: 'Light warmup' }];
    }
    
    const warmups: WarmupSet[] = [
      { percentOfWorking: 40, reps: 10, rest: 60, notes: 'Empty bar or very light' },
      { percentOfWorking: 60, reps: 6, rest: 90, notes: 'Building up' },
      { percentOfWorking: 80, reps: 3, rest: 120, notes: 'Near working weight' },
    ];
    
    const heavyCompounds = ['Squat', 'Deadlift', 'Bench Press', 'Overhead Press'];
    if (heavyCompounds.some(c => exerciseName.includes(c)) && workingWeight > 80) {
      warmups.push({ percentOfWorking: 90, reps: 1, rest: 120, notes: 'Final warmup single' });
    }
    
    return warmups;
  }
  
  // ---- Program Generation ----
  
  async generateMesocycle(config: {
    daysPerWeek: number;
    sessionMinutes?: number;
    name?: string;
  }): Promise<{
    mesocycleId: string;
    program: FullProgramRecommendation;
  }> {
    const profile = this.getUserProfile();
    const sessionMinutes = config.sessionMinutes || 60;
    
    // Calculate all components
    const recoveryFactors = this.calculateRecoveryFactors();
    const fatigueBudget = this.calculateFatigueBudget();
    const split = this.recommendSplit(config.daysPerWeek, sessionMinutes);
    const volumePerMuscle = this.calculateVolumePerMuscle(config.daysPerWeek, split);
    const periodization = this.buildPeriodizationPlan(recoveryFactors);
    const schedule = this.buildSchedule(split, config.daysPerWeek);
    
    // Build session templates
    const sessionTemplates = this.buildSessionTemplates(schedule, split, volumePerMuscle);
    
    // Build full mesocycle weeks
    const mesocycleWeeks = this.buildMesocycleWeeks(
      sessionTemplates,
      volumePerMuscle,
      periodization,
      fatigueBudget
    );
    
    const program: FullProgramRecommendation = {
      split: split as Split,
      schedule,
      periodization,
      recoveryProfile: recoveryFactors,
      fatigueBudget,
      volumePerMuscle,
      sessions: mesocycleWeeks[0].sessions,
      mesocycleWeeks,
      warnings: recoveryFactors.warnings,
      programNotes: [
        `Periodization: ${periodization.model}`,
        `Mesocycle: ${periodization.mesocycleWeeks} weeks`,
        `Deload: Week ${periodization.deloadFrequency + 1}`
      ]
    };
    
    // Save to database
    const { data, error } = await this.supabase
      .from('mesocycles')
      .insert({
        user_id: this.userId,
        name: config.name || `${split} - ${new Date().toLocaleDateString()}`,
        state: 'active',
        total_weeks: periodization.mesocycleWeeks,
        current_week: 1,
        days_per_week: config.daysPerWeek,
        split_type: split,
        deload_week: periodization.deloadFrequency + 1,
        periodization_model: periodization.model,
        program_data: program,
        fatigue_budget_config: fatigueBudget,
        volume_per_muscle: volumePerMuscle,
        recovery_multiplier: recoveryFactors.volumeMultiplier,
        is_active: true,
        start_date: new Date().toISOString().split('T')[0],
      })
      .select('id')
      .single();
    
    if (error || !data) {
      throw new Error('Failed to create mesocycle');
    }
    
    return { mesocycleId: data.id, program };
  }
  
  private recommendSplit(daysPerWeek: number, sessionMinutes: number): string {
    const profile = this.getUserProfile();
    const timeConstrained = sessionMinutes < 45;
    
    if (daysPerWeek <= 3) {
      return 'Full Body';
    }
    
    if (daysPerWeek === 4) {
      return 'Upper/Lower';
    }
    
    if (daysPerWeek === 5) {
      if (profile.experience === 'novice' || timeConstrained) {
        return 'Upper/Lower';
      }
      return 'Arnold';
    }
    
    if (daysPerWeek >= 6) {
      return 'PPL';
    }
    
    return 'Upper/Lower';
  }
  
  private buildPeriodizationPlan(recoveryFactors: RecoveryFactors): PeriodizationPlan {
    const profile = this.getUserProfile();
    
    let model: PeriodizationModel;
    if (profile.experience === 'novice' || profile.trainingAge < 1) {
      model = 'linear';
    } else if (profile.experience === 'intermediate' || profile.trainingAge < 3) {
      model = profile.goal === 'cut' ? 'weekly_undulating' : 'daily_undulating';
    } else {
      model = 'block';
    }
    
    const deloadFrequency = recoveryFactors.deloadFrequencyWeeks;
    const mesocycleWeeks = deloadFrequency + 1;
    
    const weeklyProgression = this.buildWeeklyProgression(model, deloadFrequency);
    
    return {
      model,
      mesocycleWeeks,
      weeklyProgression,
      deloadFrequency,
      deloadStrategy: profile.experience === 'novice' ? 'reactive' : 'proactive'
    };
  }
  
  private buildWeeklyProgression(model: PeriodizationModel, trainingWeeks: number): WeeklyProgression[] {
    const weeks: WeeklyProgression[] = [];
    
    for (let i = 1; i <= trainingWeeks; i++) {
      const progress = i / trainingWeeks;
      
      if (model === 'linear') {
        weeks.push({
          week: i,
          intensityModifier: 0.85 + (progress * 0.15),
          volumeModifier: 0.9 + (progress * 0.1),
          rpeTarget: { min: 6 + Math.floor(progress * 2), max: 7 + Math.floor(progress * 2) },
          focus: progress < 0.5 ? 'Technique and base building' : 'Progressive overload'
        });
      } else if (model === 'daily_undulating') {
        weeks.push({
          week: i,
          intensityModifier: 0.9 + (progress * 0.1),
          volumeModifier: 0.85 + (progress * 0.15),
          rpeTarget: { min: 7, max: 9 },
          focus: `DUP Week ${i}: Rotate hypertrophy/strength/power daily`
        });
      } else if (model === 'block') {
        const hypertrophyWeeks = Math.ceil(trainingWeeks * 0.5);
        const strengthWeeks = Math.ceil(trainingWeeks * 0.35);
        
        if (i <= hypertrophyWeeks) {
          weeks.push({
            week: i,
            intensityModifier: 0.70 + (i / hypertrophyWeeks * 0.1),
            volumeModifier: 1.1,
            rpeTarget: { min: 7, max: 8 },
            focus: 'Hypertrophy block: Volume accumulation'
          });
        } else if (i <= hypertrophyWeeks + strengthWeeks) {
          weeks.push({
            week: i,
            intensityModifier: 0.85 + ((i - hypertrophyWeeks) / strengthWeeks * 0.1),
            volumeModifier: 0.8,
            rpeTarget: { min: 8, max: 9 },
            focus: 'Strength block: Heavy loads'
          });
        } else {
          weeks.push({
            week: i,
            intensityModifier: 0.95,
            volumeModifier: 0.6,
            rpeTarget: { min: 9, max: 10 },
            focus: 'Peaking block: Low volume, max intensity'
          });
        }
      } else {
        // weekly_undulating
        const isHighVolume = i % 2 === 1;
        weeks.push({
          week: i,
          intensityModifier: isHighVolume ? 0.85 + (progress * 0.1) : 0.95,
          volumeModifier: isHighVolume ? 1.0 + (progress * 0.1) : 0.7,
          rpeTarget: isHighVolume ? { min: 7, max: 8 } : { min: 8, max: 9 },
          focus: isHighVolume ? 'Volume accumulation' : 'Intensity/recovery'
        });
      }
    }
    
    // Deload week
    weeks.push({
      week: trainingWeeks + 1,
      intensityModifier: 0.6,
      volumeModifier: 0.5,
      rpeTarget: { min: 5, max: 6 },
      focus: 'DELOAD: Recovery week'
    });
    
    return weeks;
  }
  
  private buildSchedule(split: string, daysPerWeek: number): string[] {
    const schedules: Record<string, Record<number, string[]>> = {
      'Full Body': {
        2: ['Full Body', 'Rest', 'Rest', 'Full Body', 'Rest', 'Rest', 'Rest'],
        3: ['Full Body', 'Rest', 'Full Body', 'Rest', 'Full Body', 'Rest', 'Rest']
      },
      'Upper/Lower': {
        4: ['Upper', 'Lower', 'Rest', 'Upper', 'Lower', 'Rest', 'Rest'],
        5: ['Upper', 'Lower', 'Rest', 'Upper', 'Lower', 'Upper', 'Rest']
      },
      'Arnold': {
        5: ['Chest/Back', 'Shoulders/Arms', 'Legs', 'Chest/Back', 'Shoulders/Arms', 'Rest', 'Rest'],
        6: ['Chest/Back', 'Shoulders/Arms', 'Legs', 'Chest/Back', 'Shoulders/Arms', 'Legs', 'Rest']
      },
      'PPL': {
        6: ['Push', 'Pull', 'Legs', 'Push', 'Pull', 'Legs', 'Rest']
      }
    };
    
    return schedules[split]?.[daysPerWeek] || schedules['Upper/Lower'][4];
  }
  
  private buildSessionTemplates(
    schedule: string[],
    split: string,
    volumePerMuscle: Record<MuscleGroup, VolumePerMuscle>
  ): { day: string; targetMuscles: MuscleGroup[] }[] {
    const musclesBySession: Record<string, MuscleGroup[]> = {
      'Full Body': ['chest', 'back', 'shoulders', 'quads', 'hamstrings', 'glutes', 'biceps', 'triceps'],
      'Upper': ['chest', 'back', 'shoulders', 'biceps', 'triceps'],
      'Lower': ['quads', 'hamstrings', 'glutes', 'calves', 'abs'],
      'Push': ['chest', 'shoulders', 'triceps'],
      'Pull': ['back', 'biceps', 'hamstrings'],
      'Legs': ['quads', 'hamstrings', 'glutes', 'calves'],
      'Chest/Back': ['chest', 'back', 'abs'],
      'Shoulders/Arms': ['shoulders', 'biceps', 'triceps'],
    };
    
    return schedule
      .filter(d => d !== 'Rest')
      .map(day => ({
        day,
        targetMuscles: musclesBySession[day] || []
      }));
  }
  
  private buildMesocycleWeeks(
    sessionTemplates: { day: string; targetMuscles: MuscleGroup[] }[],
    volumePerMuscle: Record<MuscleGroup, VolumePerMuscle>,
    periodization: PeriodizationPlan,
    fatigueBudget: FatigueBudgetConfig
  ): MesocycleWeek[] {
    const weeks: MesocycleWeek[] = [];
    
    for (let weekNum = 1; weekNum <= periodization.mesocycleWeeks; weekNum++) {
      const weekProgression = periodization.weeklyProgression[weekNum - 1];
      const isDeload = weekNum === periodization.mesocycleWeeks;
      
      const sessions = sessionTemplates.map((template, dayIndex) => 
        this.buildDetailedSession(
          template,
          dayIndex,
          volumePerMuscle,
          weekNum,
          periodization.mesocycleWeeks,
          periodization.model,
          weekProgression,
          isDeload ? { ...fatigueBudget, systemicLimit: fatigueBudget.systemicLimit * 0.5 } : fatigueBudget
        )
      );
      
      weeks.push({
        weekNumber: weekNum,
        focus: weekProgression.focus,
        intensityModifier: weekProgression.intensityModifier,
        volumeModifier: weekProgression.volumeModifier,
        rpeTarget: weekProgression.rpeTarget,
        sessions,
        isDeload
      });
    }
    
    return weeks;
  }
  
  private buildDetailedSession(
    template: { day: string; targetMuscles: MuscleGroup[] },
    dayIndex: number,
    volumePerMuscle: Record<MuscleGroup, VolumePerMuscle>,
    weekInMesocycle: number,
    totalWeeks: number,
    periodizationModel: PeriodizationModel,
    weekProgression: WeeklyProgression,
    fatigueBudget: FatigueBudgetConfig
  ): DetailedSession {
    const profile = this.getUserProfile();
    const exercises: DetailedExercise[] = [];
    
    // Order: compounds first
    const muscleOrder: MuscleGroup[] = [
      'quads', 'hamstrings', 'glutes', 'back', 'chest',
      'shoulders', 'biceps', 'triceps', 'calves', 'abs'
    ];
    
    const orderedMuscles = template.targetMuscles.sort((a, b) =>
      muscleOrder.indexOf(a) - muscleOrder.indexOf(b)
    );
    
    let exercisePosition = 1;
    let totalSystemicFatigue = 0;
    
    for (const muscle of orderedMuscles) {
      const muscleVolume = volumePerMuscle[muscle];
      if (!muscleVolume) continue;
      
      let setsThisSession = Math.ceil(muscleVolume.sets / muscleVolume.frequency);
      setsThisSession = Math.round(setsThisSession * weekProgression.volumeModifier);
      setsThisSession = Math.max(1, setsThisSession);
      
      // Select exercises for this muscle
      const selectedExercises = this.selectExercisesForMuscle(muscle, setsThisSession, exercisePosition);
      
      for (const selection of selectedExercises) {
        const repConfig = this.calculateRepRange(
          selection.exercise.name,
          muscle,
          selection.exercise.pattern,
          exercisePosition,
          weekInMesocycle,
          totalWeeks,
          periodizationModel
        );
        
        // Adjust RIR based on week progression
        const adjustedRIR = Math.max(0, Math.min(4,
          repConfig.targetRIR + Math.round((1 - weekProgression.intensityModifier) * 3)
        ));
        
        const weightRec = this.getWeightRecommendation(
          selection.exercise.name,
          { min: repConfig.min, max: repConfig.max },
          adjustedRIR
        );
        
        // Calculate fatigue
        const baseFatigue = SYSTEMIC_FATIGUE_BY_PATTERN[selection.exercise.pattern] || 5;
        const equipmentMod = EQUIPMENT_FATIGUE_MODIFIER[selection.exercise.equipment] || 1.0;
        const systemicCost = baseFatigue * equipmentMod * selection.sets * 0.15;
        
        totalSystemicFatigue += systemicCost;
        
        // Check fatigue budget
        if (totalSystemicFatigue > fatigueBudget.systemicLimit) {
          break;
        }
        
        const sfr = BASE_SFR[selection.exercise.pattern]?.[selection.exercise.equipment] || 1.0;
        
        const fatigueProfile: FatigueProfile = {
          systemicCost,
          localCost: { [muscle]: selection.sets * 8 },
          sfr,
          efficiency: sfr >= 1.0 ? 'optimal' : sfr >= 0.8 ? 'acceptable' : 'suboptimal'
        };
        
        exercises.push({
          exercise: selection.exercise,
          sets: selection.sets,
          reps: { ...repConfig, targetRIR: adjustedRIR },
          restSeconds: this.getRestPeriod(selection.exercise.pattern, profile.goal),
          loadGuidance: weightRec.recommendedWeight > 0
            ? `${weightRec.recommendedWeight}kg × ${repConfig.min}-${repConfig.max} @ ${adjustedRIR} RIR`
            : `Find working weight (start: ${weightRec.findingWeightProtocol?.startingWeight || 20}kg)`,
          notes: repConfig.notes,
          weightRecommendation: weightRec,
          fatigueProfile
        });
        
        exercisePosition++;
      }
    }
    
    const totalSets = exercises.reduce((sum, e) => sum + e.sets, 0);
    const avgSFR = exercises.reduce((sum, e) => sum + e.fatigueProfile.sfr, 0) / exercises.length || 0;
    
    return {
      dayIndex,
      day: template.day,
      focus: `${template.day} - Week ${weekInMesocycle}`,
      exercises,
      totalSets,
      estimatedMinutes: Math.round(totalSets * 2.5 + 10),
      warmup: this.generateWarmup(orderedMuscles[0]),
      fatigueSummary: {
        systemicFatigueGenerated: Math.round(totalSystemicFatigue),
        systemicCapacityUsed: Math.round((totalSystemicFatigue / fatigueBudget.systemicLimit) * 100),
        averageSFR: Math.round(avgSFR * 100) / 100,
        localFatigueByMuscle: exercises.reduce((acc, e) => {
          for (const [m, v] of Object.entries(e.fatigueProfile.localCost)) {
            acc[m] = (acc[m] || 0) + v;
          }
          return acc;
        }, {} as Record<string, number>)
      }
    };
  }
  
  private selectExercisesForMuscle(
    muscle: MuscleGroup,
    setsNeeded: number,
    startingPosition: number
  ): { exercise: Exercise; sets: number }[] {
    const profile = this.getUserProfile();
    
    // Filter exercises
    let candidates = EXERCISE_DATABASE.filter(e =>
      e.primaryMuscle === muscle &&
      profile.availableEquipment.includes(e.equipment) &&
      !profile.injuryHistory.includes(muscle)
    );
    
    // Filter by experience
    if (profile.experience === 'novice') {
      candidates = candidates.filter(e => e.difficulty === 'beginner');
    } else if (profile.experience === 'intermediate') {
      candidates = candidates.filter(e => e.difficulty !== 'advanced');
    }
    
    if (candidates.length === 0) {
      candidates = EXERCISE_DATABASE.filter(e => e.primaryMuscle === muscle);
    }
    
    // Sort by SFR
    candidates.sort((a, b) => {
      const sfrA = BASE_SFR[a.pattern]?.[a.equipment] || 1.0;
      const sfrB = BASE_SFR[b.pattern]?.[b.equipment] || 1.0;
      
      if (startingPosition <= 2) {
        const aCompound = a.pattern !== 'isolation' ? 0 : 1;
        const bCompound = b.pattern !== 'isolation' ? 0 : 1;
        if (aCompound !== bCompound) return aCompound - bCompound;
      }
      
      return sfrB - sfrA;
    });
    
    const selected: { exercise: Exercise; sets: number }[] = [];
    let remainingSets = setsNeeded;
    
    for (const exercise of candidates) {
      if (remainingSets <= 0) break;
      
      const maxSets = exercise.pattern === 'isolation' ? 3 : 4;
      const setsForThis = Math.min(remainingSets, maxSets);
      
      selected.push({ exercise, sets: setsForThis });
      remainingSets -= setsForThis;
    }
    
    return selected;
  }
  
  private getRestPeriod(pattern: string, goal: Goal): number {
    const isCompound = pattern !== 'isolation';
    
    if (goal === 'cut') {
      return isCompound ? 120 : 60;
    }
    if (goal === 'bulk') {
      return isCompound ? 180 : 90;
    }
    return isCompound ? 150 : 75;
  }
  
  private generateWarmup(primaryMuscle: MuscleGroup): string[] {
    if (['quads', 'hamstrings', 'glutes', 'calves'].includes(primaryMuscle)) {
      return [
        '5 min bike or walking',
        'Leg swings x 10 each direction',
        'Bodyweight squats x 10',
        'Glute bridges x 10'
      ];
    }
    return [
      '5 min rowing or arm circles',
      'Band pull-aparts x 15',
      'Push-ups x 10',
      'Face pulls x 10 (light)'
    ];
  }
  
  // ---- Today's Workout ----
  
  async getTodayWorkout(mesocycleId: string): Promise<DetailedSession | null> {
    const { data: mesocycle } = await this.supabase
      .from('mesocycles')
      .select('*')
      .eq('id', mesocycleId)
      .single();
    
    if (!mesocycle || mesocycle.state !== 'active') return null;
    
    const today = new Date();
    const dayOfWeek = today.getDay() || 7; // 1-7, Monday = 1
    
    const program = mesocycle.program_data as FullProgramRecommendation;
    if (!program) return null;
    
    const trainingDayMaps: Record<number, number[]> = {
      2: [1, 4],
      3: [1, 3, 5],
      4: [1, 2, 4, 5],
      5: [1, 2, 3, 5, 6],
      6: [1, 2, 3, 4, 5, 6],
    };
    
    const trainingDays = trainingDayMaps[mesocycle.days_per_week] || trainingDayMaps[4];
    const dayIndex = trainingDays.indexOf(dayOfWeek);
    
    if (dayIndex === -1) return null; // Rest day
    
    const currentWeek = program.mesocycleWeeks[mesocycle.current_week - 1];
    if (!currentWeek) return null;
    
    const sessionIndex = dayIndex % currentWeek.sessions.length;
    return currentWeek.sessions[sessionIndex];
  }
  
  // ---- Deload Detection ----
  
  async checkDeloadTriggers(mesocycleId: string): Promise<DeloadTriggers> {
    const profile = this.getUserProfile();
    
    const { data: logs } = await this.supabase
      .from('weekly_fatigue_logs')
      .select('*')
      .eq('mesocycle_id', mesocycleId)
      .order('week_number', { ascending: false })
      .limit(3);
    
    if (!logs || logs.length < 2) {
      return { shouldDeload: false, reasons: [], suggestedDeloadType: 'volume' };
    }
    
    const recent = logs as WeeklyFatigueLogRow[];
    const lastWeek = recent[0];
    const previousWeek = recent[1];
    
    const reasons: string[] = [];
    let shouldDeload = false;
    let suggestedDeloadType: 'volume' | 'intensity' | 'full' = 'volume';
    
    if ((lastWeek.perceived_fatigue || 0) >= 4 && (previousWeek.perceived_fatigue || 0) >= 3) {
      reasons.push('Perceived fatigue elevated for 2+ weeks');
      shouldDeload = true;
    }
    
    if (lastWeek.strength_decline || lastWeek.missed_reps > 5) {
      reasons.push('Strength regression or significant missed reps');
      shouldDeload = true;
      suggestedDeloadType = 'intensity';
    }
    
    if ((lastWeek.sleep_quality || 3) <= 2 && (previousWeek.sleep_quality || 3) <= 2) {
      reasons.push('Poor sleep for 2+ weeks');
      shouldDeload = true;
      suggestedDeloadType = 'full';
    }
    
    if ((lastWeek.motivation_level || 3) <= 2 && (previousWeek.motivation_level || 3) <= 3) {
      reasons.push('Declining motivation - possible overreaching');
      shouldDeload = true;
    }
    
    if (lastWeek.joint_pain) {
      reasons.push('Joint pain reported');
      shouldDeload = true;
      suggestedDeloadType = 'intensity';
    }
    
    if (profile.experience === 'novice' && reasons.length < 2) {
      shouldDeload = false;
    }
    
    return { shouldDeload, reasons, suggestedDeloadType };
  }
  
  // ---- Record Workout Results ----
  
  async recordExerciseHistory(
    exerciseName: string,
    workoutSessionId: string,
    sets: { weight: number; reps: number; rpe?: number; completed: boolean }[]
  ): Promise<void> {
    const completedSets = sets.filter(s => s.completed && s.reps >= 1 && s.reps <= 12);
    let estimated1RM: number | null = null;
    
    if (completedSets.length > 0) {
      const estimates = completedSets.map(s => estimate1RM(s.weight, s.reps, s.rpe));
      estimated1RM = Math.max(...estimates);
    }
    
    await this.supabase.from('exercise_history').insert({
      user_id: this.userId,
      workout_session_id: workoutSessionId,
      exercise_name: exerciseName,
      performed_at: new Date().toISOString(),
      sets,
      estimated_1rm_kg: estimated1RM
    });
    
    // Update calibration if this is a new PR
    if (estimated1RM) {
      const existing = this.calibrations.get(exerciseName);
      if (!existing || estimated1RM > existing.estimated_1rm_kg * 0.98) {
        await this.supabase.from('strength_calibrations').upsert({
          user_id: this.userId,
          exercise_name: exerciseName,
          tested_weight_kg: completedSets[0].weight,
          tested_reps: completedSets[0].reps,
          tested_rpe: completedSets[0].rpe,
          estimated_1rm_kg: estimated1RM,
          confidence: 'high',
          source: 'workout',
          tested_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,exercise_name,tested_at'
        });
      }
    }
  }
}

