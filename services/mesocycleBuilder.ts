/**
 * AI-Assisted Mesocycle Builder
 * Comprehensive training program generator based on user profile, recovery factors,
 * and evidence-based periodization principles.
 * 
 * This module integrates:
 * - Rep Range Engine: Fiber type-aware rep range calculations
 * - Fatigue Budget Engine: SFR tracking and junk volume prevention
 * - Deload Engine: Reactive and proactive deload detection
 */

import type {
  Goal,
  Experience,
  DexaScan,
  Equipment,
  Split,
  PeriodizationModel,
  DeloadStrategy,
  ExerciseDifficulty,
  FatigueRating,
  MuscleGroup,
  MovementPattern,
  Rating,
  ExtendedUserProfile,
  RecoveryFactors,
  WeeklyProgression,
  PeriodizationPlan,
  SessionTemplate,
  ExerciseEntry,
  DetailedSession,
  DetailedExercise,
  FullProgramRecommendation,
  FatigueBudgetConfig,
  RepRangeConfig,
} from '@/types/schema';
import { calculateFFMI, getNaturalFFMILimit } from './bodyCompEngine';

// Re-export from sub-engines for convenience
export {
  calculateRepRange,
  getDUPRepRange,
  getDUPTempo,
  getDUPRestPeriod,
  getDUPNotes,
  getDUPTargetRIR,
  getPositionCategory,
  formatRepRange,
  buildLoadGuidance,
  MUSCLE_FIBER_PROFILE,
} from './repRangeEngine';

export {
  calculateExerciseFatigue,
  createFatigueBudget,
  SessionFatigueManager,
  WeeklyFatigueTracker,
  SYSTEMIC_FATIGUE_BY_PATTERN,
  EQUIPMENT_FATIGUE_MODIFIER,
  BASE_SFR,
} from './fatigueBudgetEngine';

export {
  checkDeloadTriggers,
  generateDeloadWeek,
  calculateDeloadFrequency,
  getDeloadStrategy,
  calculateFatigueScore,
  assessFatigueScore,
  analyzeFatigueTrend,
} from './deloadEngine';

export {
  buildDetailedSessionWithFatigue,
  buildDUPSession,
  generateFullMesocycleWithFatigue,
  formatSessionForDisplay,
  formatMesocycleForDisplay,
} from './sessionBuilderWithFatigue';

// ============================================================
// LEGACY TYPES (for backwards compatibility)
// ============================================================

export interface UserProfile {
  goal: Goal;
  experience: Experience;
  heightCm: number | null;
  latestDexa: DexaScan | null;
}

export interface MesocycleRecommendation {
  splitType: string;
  splitReason: string;
  daysPerWeek: number;
  totalWeeks: number;
  deloadWeek: number;
  volumePerMuscle: Record<string, number>;
  focusMuscles: string[];
  recommendations: string[];
}

export interface WorkoutTemplate {
  dayName: string;
  muscles: string[];
  exercises: ExerciseTemplate[];
}

export interface ExerciseTemplate {
  exerciseId: string;
  exerciseName: string;
  sets: number;
  repRange: [number, number];
  rir: number;
  suggestedWeightKg: number;
  notes: string;
}

// ============================================================
// EXERCISE DATABASE
// ============================================================
// Imported from unified exercise service - single source of truth
import { 
  getExercisesSync, 
  getExercisesForMuscleSync,
  getExerciseByNameSync,
  type Exercise as ServiceExercise 
} from './exerciseService';

/**
 * Get exercise database as ExerciseEntry format for backward compatibility
 * Uses cached exercises from the service (DB-backed with fallback)
 */
function getExerciseDatabase(): ExerciseEntry[] {
  const exercises = getExercisesSync();
  return exercises.map(e => ({
    name: e.name,
    primaryMuscle: e.primaryMuscle,
    secondaryMuscles: e.secondaryMuscles,
    pattern: e.pattern,
    equipment: e.equipment,
    difficulty: e.difficulty,
    fatigueRating: e.fatigueRating,
    notes: e.notes,
    hypertrophyScore: e.hypertrophyScore,
  }));
}

// For backward compatibility - getter function that returns current exercises
const EXERCISE_DATABASE: ExerciseEntry[] = getExerciseDatabase();

// ============================================================
// RECOVERY FACTOR CALCULATIONS
// ============================================================

/**
 * Calculate recovery factors based on user profile
 * These affect volume, frequency, and deload recommendations
 */
export function calculateRecoveryFactors(profile: ExtendedUserProfile): RecoveryFactors {
  const warnings: string[] = [];
  
  let volumeMultiplier = 1.0;
  let frequencyMultiplier = 1.0;
  let baseDeloadWeeks = 5;
  
  // Age adjustments
  if (profile.age < 25) {
    volumeMultiplier *= 1.05;
    frequencyMultiplier *= 1.05;
    baseDeloadWeeks = 6;
  } else if (profile.age >= 25 && profile.age < 35) {
    // Prime recovery years - no adjustment
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
  const sleepMultiplier: Record<Rating, number> = {
    1: 0.70,  // Poor sleep = significant reduction
    2: 0.85,
    3: 1.00,
    4: 1.05,
    5: 1.10   // Excellent sleep = can handle more
  };
  
  volumeMultiplier *= sleepMultiplier[profile.sleepQuality];
  
  if (profile.sleepQuality <= 2) {
    warnings.push('Sleep quality is limiting recovery. Fix this before adding volume.');
    baseDeloadWeeks = Math.max(3, baseDeloadWeeks - 1);
  }
  
  // Stress adjustments
  const stressMultiplier: Record<Rating, number> = {
    1: 1.10,  // Low stress = better recovery
    2: 1.05,
    3: 1.00,
    4: 0.90,
    5: 0.75   // High stress = significant reduction
  };
  
  volumeMultiplier *= stressMultiplier[profile.stressLevel];
  
  if (profile.stressLevel >= 4) {
    warnings.push('High life stress impairs recovery. Training should be a release, not another stressor.');
    baseDeloadWeeks = Math.max(3, baseDeloadWeeks - 1);
  }
  
  // Training age adjustments
  if (profile.trainingAge < 1) {
    volumeMultiplier *= 0.8;  // New lifters need less volume
    baseDeloadWeeks = 8;      // But can go longer without deloads
  } else if (profile.trainingAge >= 5) {
    baseDeloadWeeks = Math.max(3, baseDeloadWeeks - 1);  // Experienced lifters need more frequent deloads
  }
  
  // Compound adjustments - don't let it get too extreme
  volumeMultiplier = Math.max(0.5, Math.min(1.3, volumeMultiplier));
  frequencyMultiplier = Math.max(0.7, Math.min(1.2, frequencyMultiplier));
  
  return {
    volumeMultiplier,
    frequencyMultiplier,
    deloadFrequencyWeeks: Math.round(baseDeloadWeeks),
    warnings
  };
}

// ============================================================
// SPLIT RECOMMENDATIONS (NEW IMPROVED LOGIC)
// ============================================================

/**
 * Split selection matrix based on frequency, goal, experience, and session time
 */
interface SplitMatrix {
  split: Split;
  reason: string;
  minSessionMinutes: number;
  frequency: number;
}

const SPLIT_RECOMMENDATIONS: SplitMatrix[] = [
  // 2 days - Full Body only
  { split: 'Full Body', reason: 'Full body is optimal for 2x/week to hit each muscle twice', 
    minSessionMinutes: 45, frequency: 2 },
  
  // 3 days - Full Body preferred, Upper/Lower possible
  { split: 'Full Body', reason: 'Full body allows hitting each muscle 3x/week for maximum frequency', 
    minSessionMinutes: 60, frequency: 3 },
  
  // 4 days - Upper/Lower is gold standard
  { split: 'Upper/Lower', reason: 'Upper/Lower hits each muscle 2x/week with great recovery balance', 
    minSessionMinutes: 45, frequency: 4 },
  
  // 5 days - PPL + Upper/Lower hybrid OR Arnold
  { split: 'Arnold', reason: 'Arnold split (Chest/Back, Shoulders/Arms, Legs) works well for 5 days with good frequency', 
    minSessionMinutes: 60, frequency: 5 },
  
  // 6 days - PPL x2
  { split: 'PPL', reason: 'Push/Pull/Legs twice per week maximizes frequency and volume capacity', 
    minSessionMinutes: 45, frequency: 6 },
];

/**
 * Recommend optimal training split based on comprehensive factors
 */
export function recommendSplit(
  daysPerWeek: number,
  goal: Goal,
  experience: Experience,
  sessionMinutes: number = 60
): { split: Split; reason: string; alternatives: { split: Split; reason: string }[] } {
  
  const alternatives: { split: Split; reason: string }[] = [];
  
  // Novices should stick to simpler splits regardless of frequency
  if (experience === 'novice') {
    if (daysPerWeek <= 3) {
      return {
        split: 'Full Body',
        reason: 'Full body is ideal for novices - practice movements frequently and build base strength',
        alternatives: []
      };
    }
    if (daysPerWeek === 4) {
      return {
        split: 'Upper/Lower',
        reason: 'Upper/Lower is perfect for novices training 4x/week - simple to follow with good frequency',
        alternatives: [
          { split: 'Full Body', reason: 'Full body 4x/week is also viable if sessions are shorter' }
        ]
      };
    }
    // 5-6 days for novice - still recommend simpler split
    return {
      split: 'Upper/Lower',
      reason: 'Even at 5-6 days, novices benefit from simpler splits. Consider reducing frequency instead.',
      alternatives: [
        { split: 'PPL', reason: 'PPL is manageable if you have the time and commitment' }
      ]
    };
  }
  
  // Intermediate and Advanced logic
  switch (daysPerWeek) {
    case 2:
      return {
        split: 'Full Body',
        reason: 'With only 2 days, full body is essential to hit each muscle group twice per week',
        alternatives: []
      };
      
    case 3:
      // Goal-specific nuances for 3 days
      if (goal === 'cut') {
        return {
          split: 'Full Body',
          reason: 'Full body 3x/week maintains frequency while managing fatigue during a caloric deficit',
          alternatives: [
            { split: 'PPL', reason: 'PPL works if you want more focus per session, but lower frequency per muscle' }
          ]
        };
      }
      return {
        split: 'Full Body',
        reason: 'Full body 3x/week maximizes protein synthesis spikes throughout the week',
        alternatives: [
          { split: 'PPL', reason: 'PPL once through gives more volume per muscle per session' },
          { split: 'Upper/Lower', reason: 'Upper/Lower/Full is a valid 3-day hybrid' }
        ]
      };
      
    case 4:
      if (sessionMinutes < 45) {
        alternatives.push({ split: 'Full Body', reason: 'Shorter full body sessions 4x/week' });
      }
      return {
        split: 'Upper/Lower',
        reason: 'Upper/Lower 4x/week is the gold standard - optimal frequency with great recovery',
        alternatives
      };
      
    case 5:
      // 5 days is tricky - PPL doesn't divide evenly
      if (goal === 'bulk') {
        return {
          split: 'Arnold',
          reason: 'Arnold split (Chest/Back, Shoulders/Arms, Legs x2) gives great volume distribution for 5 days',
          alternatives: [
            { split: 'Upper/Lower', reason: 'ULULU pattern hits everything with good frequency' },
            { split: 'PPL', reason: 'PPLPP or PPLUL hybrid patterns work too' }
          ]
        };
      }
      return {
        split: 'Upper/Lower',
        reason: 'Upper/Lower/Upper/Lower/Upper (ULULU) pattern provides excellent frequency for 5 days',
        alternatives: [
          { split: 'Arnold', reason: 'Arnold split if you want more specialization' },
          { split: 'PPL', reason: 'PPL + Upper or PPL + Lower works for variety' }
        ]
      };
      
    case 6:
      return {
        split: 'PPL',
        reason: 'Push/Pull/Legs twice through is optimal for 6 days - high frequency and volume capacity',
        alternatives: [
          { split: 'Arnold', reason: 'Arnold split 2x if you prefer that grouping' },
          { split: 'Upper/Lower', reason: 'Upper/Lower 3x is very high frequency but doable' }
        ]
      };
      
    default:
      // 7 days or edge cases
      return {
        split: 'PPL',
        reason: 'PPL with strategic rest days allows daily training if desired',
        alternatives: []
      };
  }
}

// ============================================================
// PERIODIZATION
// ============================================================

/**
 * Build periodization plan based on experience and recovery factors
 */
export function buildPeriodizationPlan(
  profile: ExtendedUserProfile,
  recoveryFactors: RecoveryFactors
): PeriodizationPlan {
  
  // Select periodization model based on experience and training age
  let model: PeriodizationModel;
  
  if (profile.experience === 'novice' || profile.trainingAge < 1) {
    model = 'linear';
  } else if (profile.experience === 'intermediate' || profile.trainingAge < 3) {
    model = profile.goal === 'cut' ? 'weekly_undulating' : 'daily_undulating';
  } else {
    model = 'block';
  }
  
  const deloadFrequency = recoveryFactors.deloadFrequencyWeeks;
  const mesocycleWeeks = deloadFrequency + 1;  // Training weeks + deload
  
  const weeklyProgression = buildWeeklyProgression(model, deloadFrequency, profile.goal);
  
  // Reactive deloads for novices, proactive for everyone else
  const deloadStrategy: DeloadStrategy = profile.experience === 'novice' ? 'reactive' : 'proactive';
  
  return {
    model,
    mesocycleWeeks,
    weeklyProgression,
    deloadFrequency,
    deloadStrategy
  };
}

/**
 * Build week-by-week progression targets
 */
function buildWeeklyProgression(
  model: PeriodizationModel,
  trainingWeeks: number,
  goal: Goal
): WeeklyProgression[] {
  
  const weeks: WeeklyProgression[] = [];
  
  switch (model) {
    case 'linear':
      // Simple linear ramp
      for (let i = 1; i <= trainingWeeks; i++) {
        const progress = i / trainingWeeks;
        weeks.push({
          week: i,
          intensityModifier: 0.85 + (progress * 0.15),  // 85% -> 100%
          volumeModifier: 0.9 + (progress * 0.1),       // 90% -> 100%
          rpeTarget: { min: 6 + Math.floor(progress * 2), max: 7 + Math.floor(progress * 2) },
          focus: progress < 0.5 ? 'Technique and base building' : 'Progressive overload'
        });
      }
      break;
      
    case 'daily_undulating':
      // Volume waves within weeks, overall progression across mesocycle
      for (let i = 1; i <= trainingWeeks; i++) {
        const progress = i / trainingWeeks;
        weeks.push({
          week: i,
          intensityModifier: 0.9 + (progress * 0.1),
          volumeModifier: 0.85 + (progress * 0.15),
          rpeTarget: { min: 7, max: 9 },
          focus: `DUP Week ${i}: Rotate hypertrophy/strength/power daily`
        });
      }
      break;
      
    case 'weekly_undulating':
      // Alternate high/low volume weeks
      for (let i = 1; i <= trainingWeeks; i++) {
        const isHighVolume = i % 2 === 1;
        const progress = i / trainingWeeks;
        weeks.push({
          week: i,
          intensityModifier: isHighVolume ? 0.85 + (progress * 0.1) : 0.95 + (progress * 0.05),
          volumeModifier: isHighVolume ? 1.0 + (progress * 0.1) : 0.7,
          rpeTarget: isHighVolume ? { min: 7, max: 8 } : { min: 8, max: 9 },
          focus: isHighVolume ? 'Volume accumulation' : 'Intensity/recovery'
        });
      }
      break;
      
    case 'block':
      // Distinct phases
      const hypertrophyWeeks = Math.ceil(trainingWeeks * 0.5);
      const strengthWeeks = Math.ceil(trainingWeeks * 0.35);
      const peakWeeks = Math.max(1, trainingWeeks - hypertrophyWeeks - strengthWeeks);
      
      for (let i = 1; i <= trainingWeeks; i++) {
        if (i <= hypertrophyWeeks) {
          weeks.push({
            week: i,
            intensityModifier: 0.70 + (i / hypertrophyWeeks * 0.1),
            volumeModifier: 1.1,
            rpeTarget: { min: 7, max: 8 },
            focus: 'Hypertrophy block: Volume accumulation, moderate loads'
          });
        } else if (i <= hypertrophyWeeks + strengthWeeks) {
          const blockProgress = (i - hypertrophyWeeks) / strengthWeeks;
          weeks.push({
            week: i,
            intensityModifier: 0.85 + (blockProgress * 0.1),
            volumeModifier: 0.8,
            rpeTarget: { min: 8, max: 9 },
            focus: 'Strength block: Moderate volume, heavy loads'
          });
        } else {
          weeks.push({
            week: i,
            intensityModifier: 0.95 + ((i - hypertrophyWeeks - strengthWeeks) / peakWeeks * 0.05),
            volumeModifier: 0.6,
            rpeTarget: { min: 9, max: 10 },
            focus: 'Peaking block: Low volume, maximal intensity'
          });
        }
      }
      break;
  }
  
  // Add deload week
  weeks.push({
    week: trainingWeeks + 1,
    intensityModifier: 0.6,
    volumeModifier: 0.5,
    rpeTarget: { min: 5, max: 6 },
    focus: 'DELOAD: Recovery and adaptation. Same exercises, 50% volume, light loads.'
  });
  
  return weeks;
}

// ============================================================
// VOLUME RECOMMENDATIONS
// ============================================================

/**
 * Recommend sets per muscle group per week based on comprehensive factors
 */
export function recommendVolume(
  experience: Experience,
  goal: Goal,
  muscleGroup: string
): number {
  // Base volumes (MAV - Maximum Adaptive Volume estimates)
  const baseVolumes: Record<string, Record<Experience, number>> = {
    chest: { novice: 10, intermediate: 14, advanced: 18 },
    back: { novice: 12, intermediate: 16, advanced: 20 },
    shoulders: { novice: 10, intermediate: 14, advanced: 18 },
    biceps: { novice: 8, intermediate: 12, advanced: 16 },
    triceps: { novice: 8, intermediate: 12, advanced: 16 },
    quads: { novice: 10, intermediate: 14, advanced: 18 },
    hamstrings: { novice: 8, intermediate: 12, advanced: 14 },
    glutes: { novice: 8, intermediate: 12, advanced: 16 },
    calves: { novice: 10, intermediate: 14, advanced: 18 },
    abs: { novice: 8, intermediate: 12, advanced: 16 },
  };

  let volume = baseVolumes[muscleGroup]?.[experience] || 12;

  // Adjust for goal
  if (goal === 'cut') {
    volume = Math.round(volume * 0.7); // Reduce volume during cut to manage recovery
  } else if (goal === 'bulk') {
    volume = Math.round(volume * 1.1); // Slightly increase during surplus
  }

  return volume;
}

/**
 * Calculate volume distribution with frequency
 * Optionally adjusts volume based on regional body composition analysis (lagging areas get more volume)
 */
export function calculateVolumeDistribution(
  split: Split,
  daysPerWeek: number,
  experience: Experience,
  goal: Goal,
  recoveryFactors: RecoveryFactors,
  laggingAreas?: string[]  // From regional analysis
): Record<MuscleGroup, { sets: number; frequency: number }> {
  
  const muscles: MuscleGroup[] = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs'];
  const result: Record<MuscleGroup, { sets: number; frequency: number }> = {} as Record<MuscleGroup, { sets: number; frequency: number }>;
  
  // Determine frequency based on split
  const frequencyMap: Record<Split, Record<MuscleGroup, number>> = {
    'Full Body': {
      chest: Math.min(daysPerWeek, 3), back: Math.min(daysPerWeek, 3), shoulders: Math.min(daysPerWeek, 3),
      biceps: Math.min(daysPerWeek, 2), triceps: Math.min(daysPerWeek, 2), quads: Math.min(daysPerWeek, 3),
      hamstrings: Math.min(daysPerWeek, 2), glutes: Math.min(daysPerWeek, 2), calves: Math.min(daysPerWeek, 2), abs: Math.min(daysPerWeek, 2),
      adductors: Math.min(daysPerWeek, 2), forearms: Math.min(daysPerWeek, 2), traps: Math.min(daysPerWeek, 2)
    },
    'Upper/Lower': {
      chest: 2, back: 2, shoulders: 2, biceps: 2, triceps: 2,
      quads: 2, hamstrings: 2, glutes: 2, calves: 2, abs: 2,
      adductors: 2, forearms: 2, traps: 2
    },
    'PPL': {
      chest: daysPerWeek >= 6 ? 2 : 1, back: daysPerWeek >= 6 ? 2 : 1, shoulders: daysPerWeek >= 6 ? 2 : 1,
      biceps: daysPerWeek >= 6 ? 2 : 1, triceps: daysPerWeek >= 6 ? 2 : 1, quads: daysPerWeek >= 6 ? 2 : 1,
      hamstrings: daysPerWeek >= 6 ? 2 : 1, glutes: daysPerWeek >= 6 ? 2 : 1, calves: daysPerWeek >= 6 ? 2 : 1, abs: daysPerWeek >= 6 ? 2 : 1,
      adductors: daysPerWeek >= 6 ? 2 : 1, forearms: daysPerWeek >= 6 ? 2 : 1, traps: daysPerWeek >= 6 ? 2 : 1
    },
    'Arnold': {
      chest: 2, back: 2, shoulders: 2, biceps: 2, triceps: 2,
      quads: 2, hamstrings: 2, glutes: 2, calves: 2, abs: 2,
      adductors: 2, forearms: 2, traps: 2
    },
    'Bro Split': {
      chest: 1, back: 1, shoulders: 1, biceps: 1, triceps: 1,
      quads: 1, hamstrings: 1, glutes: 1, calves: 1, abs: 1,
      adductors: 1, forearms: 1, traps: 1
    }
  };
  
  const frequencies = frequencyMap[split];
  
  // Map regional areas to muscle groups
  const regionalToMuscles: Record<string, MuscleGroup[]> = {
    'Arms': ['biceps', 'triceps'],
    'Legs': ['quads', 'hamstrings', 'glutes', 'calves'],
    'Trunk': ['chest', 'back', 'shoulders', 'abs'],
  };
  
  // Determine which muscles need extra volume based on regional analysis
  const laggingMuscles: Set<MuscleGroup> = new Set();
  if (laggingAreas) {
    for (const area of laggingAreas) {
      // Check if it's a general area (Arms, Legs, Trunk)
      if (regionalToMuscles[area]) {
        regionalToMuscles[area].forEach(m => laggingMuscles.add(m));
      }
      // Check for specific side mentions (e.g., "Left arm", "Right leg")
      if (area.toLowerCase().includes('arm')) {
        laggingMuscles.add('biceps');
        laggingMuscles.add('triceps');
      }
      if (area.toLowerCase().includes('leg')) {
        laggingMuscles.add('quads');
        laggingMuscles.add('hamstrings');
        laggingMuscles.add('glutes');
        laggingMuscles.add('calves');
      }
    }
  }
  
  muscles.forEach(muscle => {
    let baseVolume = recommendVolume(experience, goal, muscle);
    
    // Boost volume for lagging areas (10-20% extra)
    if (laggingMuscles.has(muscle)) {
      baseVolume = Math.round(baseVolume * 1.15);  // 15% extra sets for lagging muscles
    }
    
    const adjustedVolume = Math.round(baseVolume * recoveryFactors.volumeMultiplier);
    const frequency = Math.round(frequencies[muscle] * recoveryFactors.frequencyMultiplier);
    
    result[muscle] = {
      sets: adjustedVolume,
      frequency: Math.max(1, frequency)
    };
  });
  
  return result;
}

// ============================================================
// EXERCISE SELECTION
// ============================================================

/**
 * Hypertrophy tier ranking for sorting (S = best = 0, F = worst = 5)
 */
const HYPERTROPHY_TIER_RANK: Record<string, number> = {
  'S': 0, 'A': 1, 'B': 2, 'C': 3, 'D': 4, 'F': 5
};

/**
 * Select exercises for a muscle group considering equipment, experience, fatigue,
 * and hypertrophy effectiveness (Nippard methodology)
 */
export function selectExercises(
  muscle: MuscleGroup,
  setsNeeded: number,
  profile: ExtendedUserProfile,
  sessionFatigueBudget: number,
  prioritizeHypertrophy: boolean = true
): { exercises: ExerciseEntry[]; setsPerExercise: number[]; remainingFatigueBudget: number } {
  
  // Filter available exercises
  let candidates = EXERCISE_DATABASE.filter(e => 
    e.primaryMuscle === muscle &&
    profile.availableEquipment.includes(e.equipment) &&
    !profile.injuryHistory.includes(muscle)  // Be cautious with injured areas
  );
  
  // Filter by difficulty - but always allow S-tier and A-tier exercises regardless of difficulty
  // (these are the best exercises and should be available to everyone with proper coaching)
  if (profile.experience === 'novice') {
    candidates = candidates.filter(e => 
      e.difficulty === 'beginner' || 
      (prioritizeHypertrophy && ['S', 'A'].includes(e.hypertrophyScore?.tier || ''))
    );
  } else if (profile.experience === 'intermediate') {
    candidates = candidates.filter(e => 
      e.difficulty !== 'advanced' ||
      (prioritizeHypertrophy && ['S', 'A'].includes(e.hypertrophyScore?.tier || ''))
    );
  }
  // Advanced can use anything
  
  if (candidates.length === 0) {
    // Fallback: allow any difficulty but still respect equipment
    candidates = EXERCISE_DATABASE.filter(e =>
      e.primaryMuscle === muscle &&
      profile.availableEquipment.includes(e.equipment)
    );
  }
  
  if (candidates.length === 0) {
    // Ultimate fallback: any exercise for this muscle
    candidates = EXERCISE_DATABASE.filter(e => e.primaryMuscle === muscle);
  }
  
  // Sort by: 1) Hypertrophy tier (if enabled), 2) Compound vs isolation, 3) Fatigue rating
  candidates.sort((a, b) => {
    // First: Hypertrophy tier (S-tier first)
    if (prioritizeHypertrophy) {
      const aTier = HYPERTROPHY_TIER_RANK[a.hypertrophyScore?.tier || 'C'] ?? 3;
      const bTier = HYPERTROPHY_TIER_RANK[b.hypertrophyScore?.tier || 'C'] ?? 3;
      if (aTier !== bTier) return aTier - bTier;
    }
    
    // Second: Compounds first (for first half of workout)
    const aCompound = a.pattern !== 'isolation' ? 0 : 1;
    const bCompound = b.pattern !== 'isolation' ? 0 : 1;
    if (aCompound !== bCompound) return aCompound - bCompound;
    
    // Third: Lower fatigue rating preferred (better SFR)
    return a.fatigueRating - b.fatigueRating;
  });
  
  const exercises: ExerciseEntry[] = [];
  const setsPerExercise: number[] = [];
  let remainingSets = setsNeeded;
  let fatigueBudget = sessionFatigueBudget;
  
  // Pick exercises
  for (const exercise of candidates) {
    if (remainingSets <= 0) break;
    if (fatigueBudget < exercise.fatigueRating) continue;
    
    // Determine sets for this exercise
    // Compounds get more sets, isolations get fewer
    const maxSetsForExercise = exercise.pattern === 'isolation' ? 3 : 4;
    const setsForThis = Math.min(remainingSets, maxSetsForExercise);
    
    exercises.push(exercise);
    setsPerExercise.push(setsForThis);
    remainingSets -= setsForThis;
    fatigueBudget -= exercise.fatigueRating;
  }
  
  // If we still have sets to allocate, add to existing exercises
  while (remainingSets > 0 && exercises.length > 0) {
    for (let i = 0; i < exercises.length && remainingSets > 0; i++) {
      setsPerExercise[i]++;
      remainingSets--;
    }
  }
  
  return { exercises, setsPerExercise, remainingFatigueBudget: fatigueBudget };
}

// ============================================================
// SESSION BUILDING
// ============================================================

/**
 * Get rep range based on exercise type and goal
 */
function getRepRange(exercise: ExerciseEntry, goal: Goal): string {
  const isCompound = exercise.pattern !== 'isolation';
  
  if (goal === 'cut') {
    // Maintain strength on cut: lower reps, heavier weight
    return isCompound ? '4-6' : '8-12';
  }
  if (goal === 'bulk') {
    // Hypertrophy focus
    return isCompound ? '6-10' : '10-15';
  }
  // Maintenance/recomp: middle ground
  return isCompound ? '6-8' : '8-12';
}

/**
 * Get rest period based on exercise type and goal
 */
function getRestPeriod(exercise: ExerciseEntry, goal: Goal): number {
  const isCompound = exercise.pattern !== 'isolation';
  
  if (goal === 'cut') {
    // Shorter rest, keep metabolic demand
    return isCompound ? 120 : 60;
  }
  if (goal === 'bulk') {
    // Full recovery for performance
    return isCompound ? 180 : 90;
  }
  return isCompound ? 150 : 75;
}

/**
 * Generate warmup instructions based on primary muscle
 */
export function generateWarmup(primaryMuscle: MuscleGroup): string[] {
  const warmups: Record<string, string[]> = {
    lower: [
      '5 min bike or walking',
      'Leg swings (front/back, side to side) x 10 each',
      'Goblet squat x 10 (bodyweight or light)',
      'Glute bridges x 10'
    ],
    upper: [
      '5 min rowing or arm circles',
      'Band pull-aparts x 15',
      'Push-ups x 10',
      'Face pulls x 10 (light)'
    ],
    full: [
      '5 min cardio',
      'World\'s greatest stretch x 5 each side',
      'Arm circles and leg swings',
      'Bodyweight squats x 10',
      'Push-ups x 10'
    ]
  };
  
  if (['quads', 'hamstrings', 'glutes', 'calves'].includes(primaryMuscle)) {
    return warmups.lower;
  }
  if (['chest', 'back', 'shoulders', 'biceps', 'triceps'].includes(primaryMuscle)) {
    return warmups.upper;
  }
  return warmups.full;
}

/**
 * Build session templates based on split
 */
export function buildSessionTemplates(
  split: Split,
  daysPerWeek: number
): SessionTemplate[] {
  
  const templates: Record<Split, SessionTemplate[]> = {
    'Full Body': [
      { day: 'Full Body A', focus: 'Quad/Push emphasis', targetMuscles: ['quads', 'chest', 'shoulders', 'triceps', 'abs'] },
      { day: 'Full Body B', focus: 'Hinge/Pull emphasis', targetMuscles: ['hamstrings', 'back', 'biceps', 'glutes', 'calves'] },
      { day: 'Full Body C', focus: 'Balanced', targetMuscles: ['quads', 'back', 'shoulders', 'biceps', 'triceps'] },
    ],
    'Upper/Lower': [
      { day: 'Upper A', focus: 'Horizontal emphasis', targetMuscles: ['chest', 'back', 'shoulders', 'biceps', 'triceps'] },
      { day: 'Lower A', focus: 'Quad emphasis', targetMuscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
      { day: 'Upper B', focus: 'Vertical emphasis', targetMuscles: ['back', 'chest', 'shoulders', 'triceps', 'biceps'] },
      { day: 'Lower B', focus: 'Hinge emphasis', targetMuscles: ['hamstrings', 'quads', 'glutes', 'calves', 'abs'] },
    ],
    'PPL': [
      { day: 'Push', focus: 'Chest, shoulders, triceps', targetMuscles: ['chest', 'shoulders', 'triceps'] },
      { day: 'Pull', focus: 'Back, biceps, rear delts', targetMuscles: ['back', 'biceps', 'shoulders'] },
      { day: 'Legs', focus: 'Quads, hamstrings, glutes', targetMuscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
    ],
    'Arnold': [
      { day: 'Chest & Back', focus: 'Antagonist supersets', targetMuscles: ['chest', 'back'] },
      { day: 'Shoulders & Arms', focus: 'Upper body detail', targetMuscles: ['shoulders', 'biceps', 'triceps'] },
      { day: 'Legs', focus: 'Complete lower body', targetMuscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
    ],
    'Bro Split': [
      { day: 'Chest', focus: 'Chest only', targetMuscles: ['chest'] },
      { day: 'Back', focus: 'Back only', targetMuscles: ['back'] },
      { day: 'Shoulders', focus: 'All three heads', targetMuscles: ['shoulders'] },
      { day: 'Arms', focus: 'Biceps & Triceps', targetMuscles: ['biceps', 'triceps'] },
      { day: 'Legs', focus: 'Complete lower body', targetMuscles: ['quads', 'hamstrings', 'glutes', 'calves'] },
    ],
  };
  
  const baseTemplates = templates[split];
  
  // Adjust number of templates based on days per week
  if (split === 'PPL' && daysPerWeek >= 6) {
    // Double up PPL for 6 days
    return [
      ...baseTemplates.map(t => ({ ...t, day: t.day + ' 1' })),
      ...baseTemplates.map(t => ({ ...t, day: t.day + ' 2' })),
    ].slice(0, daysPerWeek);
  }
  
  return baseTemplates.slice(0, daysPerWeek);
}

/**
 * Build a detailed workout session
 */
export function buildDetailedSession(
  sessionTemplate: SessionTemplate,
  volumePerMuscle: Record<MuscleGroup, { sets: number; frequency: number }>,
  profile: ExtendedUserProfile
): DetailedSession {
  
  const exercises: DetailedExercise[] = [];
  
  // Fatigue budget: higher for advanced, lower for novices
  let fatigueBudget = profile.experience === 'advanced' ? 15 : 
                      profile.experience === 'intermediate' ? 12 : 9;
  
  // Order muscles: compounds first (big muscles), then isolations
  const muscleOrder: MuscleGroup[] = [
    'quads', 'hamstrings', 'glutes',  // Legs first if present
    'back', 'chest',                   // Big upper body
    'shoulders',                       // Medium
    'biceps', 'triceps', 'calves', 'abs'  // Small/isolation last
  ];
  
  const orderedMuscles = sessionTemplate.targetMuscles.sort((a, b) =>
    muscleOrder.indexOf(a) - muscleOrder.indexOf(b)
  );
  
  for (const muscle of orderedMuscles) {
    const muscleVolume = volumePerMuscle[muscle];
    if (!muscleVolume) continue;
    
    const setsThisSession = Math.ceil(muscleVolume.sets / muscleVolume.frequency);
    
    const selection = selectExercises(muscle, setsThisSession, profile, fatigueBudget);
    fatigueBudget = selection.remainingFatigueBudget;
    
    for (let i = 0; i < selection.exercises.length; i++) {
      const ex = selection.exercises[i];
      const sets = selection.setsPerExercise[i];
      
      exercises.push({
        exercise: ex,
        sets,
        repRange: getRepRange(ex, profile.goal),
        restSeconds: getRestPeriod(ex, profile.goal),
        notes: ex.notes || ''
      });
    }
  }
  
  // Calculate time
  const totalSets = exercises.reduce((sum, e) => sum + e.sets, 0);
  const totalRestMinutes = exercises.reduce((sum, e) => 
    sum + (e.sets * e.restSeconds / 60), 0);
  const estimatedMinutes = Math.round(totalRestMinutes + (totalSets * 0.75) + 10); // Sets + warmup
  
  return {
    day: sessionTemplate.day,
    focus: sessionTemplate.focus,
    exercises,
    totalSets,
    estimatedMinutes,
    warmup: generateWarmup(orderedMuscles[0])
  };
}

// ============================================================
// UNIFIED PROGRAM GENERATOR
// ============================================================

/**
 * Generate a complete training program based on user profile
 * @param laggingAreas - Optional array of lagging muscle areas from regional DEXA analysis
 */
export function generateFullProgram(
  daysPerWeek: number,
  profile: ExtendedUserProfile,
  sessionMinutes: number = 60,
  laggingAreas?: string[]  // From regional body composition analysis
): FullProgramRecommendation {
  
  const warnings: string[] = [];
  const programNotes: string[] = [];
  
  // Step 1: Calculate recovery factors
  const recoveryFactors = calculateRecoveryFactors(profile);
  warnings.push(...recoveryFactors.warnings);
  
  // Step 2: Get split recommendation
  const splitRec = recommendSplit(daysPerWeek, profile.goal, profile.experience, sessionMinutes);
  
  programNotes.push(`Split: ${splitRec.split} - ${splitRec.reason}`);
  if (splitRec.alternatives.length > 0) {
    programNotes.push(`Alternatives: ${splitRec.alternatives.map(a => a.split).join(', ')}`);
  }
  
  // Step 3: Build periodization plan
  const periodization = buildPeriodizationPlan(profile, recoveryFactors);
  
  programNotes.push(`Periodization: ${periodization.model}`);
  programNotes.push(`Mesocycle length: ${periodization.mesocycleWeeks} weeks (${periodization.deloadFrequency} training + 1 deload)`);
  programNotes.push(`Deload strategy: ${periodization.deloadStrategy}`);
  
  // Step 4: Calculate volume distribution (with extra volume for lagging areas if provided)
  const volumePerMuscle = calculateVolumeDistribution(
    splitRec.split,
    daysPerWeek,
    profile.experience,
    profile.goal,
    recoveryFactors,
    laggingAreas
  );
  
  // Add note if lagging areas are being addressed
  if (laggingAreas && laggingAreas.length > 0) {
    programNotes.push(`🎯 Extra volume allocated for: ${laggingAreas.join(', ')}`);
  }
  
  // Step 5: Build session templates
  const sessionTemplates = buildSessionTemplates(splitRec.split, daysPerWeek);
  
  // Step 6: Build detailed sessions
  const sessions = sessionTemplates.map(template =>
    buildDetailedSession(template, volumePerMuscle, profile)
  );
  
  // Step 7: Generate schedule
  const schedulePatterns: Record<number, string[]> = {
    2: ['Mon', 'Thu'],
    3: ['Mon', 'Wed', 'Fri'],
    4: ['Mon', 'Tue', 'Thu', 'Fri'],
    5: ['Mon', 'Tue', 'Wed', 'Fri', 'Sat'],
    6: ['Mon', 'Tue', 'Wed', 'Fri', 'Sat', 'Sun'],
  };
  const schedule = schedulePatterns[daysPerWeek] || schedulePatterns[4];
  
  // Step 8: Validate and warn
  const avgSessionTime = sessions.reduce((sum, s) => sum + s.estimatedMinutes, 0) / sessions.length;
  if (avgSessionTime > sessionMinutes * 1.2) {
    warnings.push(
      `Sessions averaging ${Math.round(avgSessionTime)} min may exceed your ${sessionMinutes} min target. ` +
      `Consider reducing volume or extending session time.`
    );
  }
  
  // Check for equipment limitations
  const usedEquipment = new Set(
    sessions.flatMap(s => s.exercises.map(e => e.exercise.equipment))
  );
  const missingEquipment = Array.from(usedEquipment).filter(e => !profile.availableEquipment.includes(e));
  if (missingEquipment.length > 0) {
    warnings.push(`Some exercises require equipment you may not have: ${missingEquipment.join(', ')}`);
  }
  
  // Body composition recommendations
  if (profile.latestDexa && profile.heightCm) {
    const ffmi = calculateFFMI(profile.latestDexa.leanMassKg, profile.heightCm);
    
    if (ffmi.percentOfLimit > 90) {
      programNotes.push('You\'re near your genetic potential - focus on maintaining and small improvements');
    }
    
    if (profile.latestDexa.bodyFatPercent > 20 && profile.goal === 'bulk') {
      warnings.push('Consider a mini-cut before continuing to bulk - you\'re above 20% body fat');
    }
    
    if (profile.latestDexa.bodyFatPercent < 12 && profile.goal === 'cut') {
      warnings.push('You\'re already quite lean - be careful not to cut too aggressively');
    }
  }
  
  return {
    split: splitRec.split,
    schedule,
    periodization,
    recoveryProfile: recoveryFactors,
    volumePerMuscle,
    sessions,
    warnings,
    programNotes
  };
}

// ============================================================
// LEGACY FUNCTIONS (for backwards compatibility)
// ============================================================

/**
 * @deprecated Use generateFullProgram instead
 */
export function generateMesocycleRecommendation(
  profile: UserProfile,
  daysPerWeek: number
): MesocycleRecommendation {
  const { goal, experience, heightCm, latestDexa } = profile;
  
  const splitRec = recommendSplit(daysPerWeek, goal, experience);
  const durationRec = recommendDuration(experience, goal);
  
  // Calculate volumes for each muscle
  const muscles = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs'];
  const volumePerMuscle: Record<string, number> = {};
  muscles.forEach(m => {
    volumePerMuscle[m] = recommendVolume(experience, goal, m);
  });

  // Determine focus muscles based on FFMI and goal
  let focusMuscles: string[] = [];
  const recommendations: string[] = [];

  if (latestDexa && heightCm) {
    const ffmi = calculateFFMI(latestDexa.leanMassKg, heightCm);
    
    if (ffmi.percentOfLimit > 90) {
      recommendations.push('You\'re near your genetic potential - focus on maintaining and small improvements');
    }
    
    if (latestDexa.bodyFatPercent > 20 && goal === 'bulk') {
      recommendations.push('Consider a mini-cut before continuing to bulk - you\'re above 20% body fat');
    }
    
    if (latestDexa.bodyFatPercent < 12 && goal === 'cut') {
      recommendations.push('You\'re already quite lean - be careful not to cut too aggressively');
    }
  }

  // Goal-specific recommendations
  if (goal === 'bulk') {
    recommendations.push('Prioritize progressive overload - aim to add weight or reps each week');
    recommendations.push('Ensure you\'re in a caloric surplus of 200-400 calories');
    focusMuscles = ['chest', 'back', 'quads'];
  } else if (goal === 'cut') {
    recommendations.push('Maintain intensity (weight on bar) even as volume decreases');
    recommendations.push('Prioritize protein intake at 2.3-3.1g per kg of lean mass');
    focusMuscles = ['back', 'shoulders', 'glutes'];
  } else {
    recommendations.push('Focus on technique refinement and gradual progression');
    focusMuscles = ['chest', 'back', 'shoulders'];
  }

  return {
    splitType: splitRec.split,
    splitReason: splitRec.reason,
    daysPerWeek,
    totalWeeks: durationRec.weeks,
    deloadWeek: durationRec.weeks,
    volumePerMuscle,
    focusMuscles,
    recommendations,
  };
}

/**
 * @deprecated Use recommendDuration via buildPeriodizationPlan instead
 */
export function recommendDuration(experience: Experience, goal: Goal): { weeks: number; reason: string } {
  if (goal === 'cut') {
    return {
      weeks: 6,
      reason: 'Shorter blocks during a cut help manage fatigue and diet adherence',
    };
  }

  switch (experience) {
    case 'novice':
      return { weeks: 4, reason: 'Shorter blocks let novices adapt and progress faster' };
    case 'intermediate':
      return { weeks: 6, reason: '6 weeks balances progression and recovery' };
    case 'advanced':
      return { weeks: 8, reason: 'Advanced lifters need longer to accumulate stimulus' };
    default:
      return { weeks: 6, reason: 'Standard mesocycle length' };
  }
}

/**
 * Get recommended exercises for a muscle group
 */
export function getRecommendedExercises(
  muscleGroup: string,
  mechanic: 'compound' | 'isolation' | 'both' = 'both'
): string[] {
  const exercises = EXERCISE_DATABASE.filter(e => e.primaryMuscle === muscleGroup);
  
  if (mechanic === 'compound') {
    return exercises.filter(e => e.pattern !== 'isolation').map(e => e.name);
  }
  if (mechanic === 'isolation') {
    return exercises.filter(e => e.pattern === 'isolation').map(e => e.name);
  }
  return exercises.map(e => e.name);
}

/**
 * Estimate starting weights based on body composition and experience
 */
export function estimateStartingWeight(
  exerciseName: string,
  leanMassKg: number,
  experience: Experience
): number {
  const strengthMultipliers: Record<string, Record<Experience, number>> = {
    'Barbell Bench Press': { novice: 0.5, intermediate: 0.75, advanced: 1.0 },
    'Dumbbell Bench Press': { novice: 0.2, intermediate: 0.3, advanced: 0.4 },
    'Incline Dumbbell Press': { novice: 0.15, intermediate: 0.25, advanced: 0.35 },
    'Barbell Back Squat': { novice: 0.6, intermediate: 0.9, advanced: 1.2 },
    'Leg Press': { novice: 1.2, intermediate: 1.8, advanced: 2.5 },
    'Romanian Deadlift': { novice: 0.5, intermediate: 0.75, advanced: 1.0 },
    'Barbell Row': { novice: 0.4, intermediate: 0.6, advanced: 0.8 },
    'Overhead Press': { novice: 0.3, intermediate: 0.45, advanced: 0.6 },
    'Lat Pulldown': { novice: 0.5, intermediate: 0.7, advanced: 0.9 },
    'Lateral Raise': { novice: 0.05, intermediate: 0.08, advanced: 0.12 },
    'Cable Fly': { novice: 0.1, intermediate: 0.15, advanced: 0.2 },
    'Leg Extension': { novice: 0.3, intermediate: 0.45, advanced: 0.6 },
    'Leg Curl': { novice: 0.2, intermediate: 0.35, advanced: 0.5 },
    'Barbell Curl': { novice: 0.15, intermediate: 0.25, advanced: 0.35 },
    'Cable Tricep Pushdown': { novice: 0.15, intermediate: 0.25, advanced: 0.35 },
  };

  const multiplier = strengthMultipliers[exerciseName]?.[experience] || 0.3;
  const estimatedWeight = leanMassKg * multiplier;

  const increment = exerciseName.toLowerCase().includes('dumbbell') ? 2 : 2.5;
  return Math.round(estimatedWeight / increment) * increment;
}

/**
 * Generate workout templates for a split
 */
export function generateWorkoutTemplates(
  splitType: string,
  volumePerMuscle: Record<string, number>,
  leanMassKg: number | null,
  experience: Experience
): WorkoutTemplate[] {
  const templates: WorkoutTemplate[] = [];

  const splitStructures: Record<string, { dayName: string; muscles: string[] }[]> = {
    'Full Body': [
      { dayName: 'Full Body A', muscles: ['chest', 'back', 'shoulders', 'quads', 'hamstrings'] },
      { dayName: 'Full Body B', muscles: ['chest', 'back', 'biceps', 'triceps', 'glutes', 'calves'] },
      { dayName: 'Full Body C', muscles: ['shoulders', 'back', 'quads', 'abs'] },
    ],
    'Upper/Lower': [
      { dayName: 'Upper A', muscles: ['chest', 'back', 'shoulders', 'biceps', 'triceps'] },
      { dayName: 'Lower A', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
      { dayName: 'Upper B', muscles: ['back', 'chest', 'shoulders', 'biceps', 'triceps'] },
      { dayName: 'Lower B', muscles: ['hamstrings', 'quads', 'glutes', 'calves', 'abs'] },
    ],
    'PPL': [
      { dayName: 'Push', muscles: ['chest', 'shoulders', 'triceps'] },
      { dayName: 'Pull', muscles: ['back', 'biceps'] },
      { dayName: 'Legs', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
    ],
  };

  const structure = splitStructures[splitType] || splitStructures['Upper/Lower'];

  structure.forEach(day => {
    const exercises: ExerciseTemplate[] = [];

    day.muscles.forEach(muscle => {
      const weeklyVolume = volumePerMuscle[muscle] || 12;
      const sessionsPerWeek = splitType === 'PPL' ? 2 : (splitType === 'Full Body' ? 3 : 2);
      const setsThisSession = Math.ceil(weeklyVolume / sessionsPerWeek);

      const muscleExercises = getRecommendedExercises(muscle);
      const exerciseCount = Math.min(2, Math.ceil(setsThisSession / 3));

      for (let i = 0; i < exerciseCount && i < muscleExercises.length; i++) {
        const exerciseName = muscleExercises[i];
        const isCompound = getRecommendedExercises(muscle, 'compound').includes(exerciseName);
        const setsForExercise = Math.ceil(setsThisSession / exerciseCount);

        exercises.push({
          exerciseId: '',
          exerciseName,
          sets: Math.min(setsForExercise, 4),
          repRange: isCompound ? [6, 10] : [10, 15],
          rir: isCompound ? 2 : 1,
          suggestedWeightKg: leanMassKg ? estimateStartingWeight(exerciseName, leanMassKg, experience) : 0,
          notes: isCompound ? 'Focus on progressive overload' : 'Focus on mind-muscle connection',
        });
      }
    });

    templates.push({
      dayName: day.dayName,
      muscles: day.muscles,
      exercises,
    });
  });

  return templates;
}

/**
 * Calculate weekly volume per muscle for a given split
 */
export function calculateWeeklyVolumePerMuscle(
  sessions: { muscles: string[]; exercises: { sets: number; exerciseName: string }[] }[]
): Record<string, number> {
  const volume: Record<string, number> = {};
  
  sessions.forEach(session => {
    session.exercises.forEach(ex => {
      // Try to find the exercise in our database
      const dbExercise = EXERCISE_DATABASE.find(e => e.name === ex.exerciseName);
      if (dbExercise) {
        volume[dbExercise.primaryMuscle] = (volume[dbExercise.primaryMuscle] || 0) + ex.sets;
        dbExercise.secondaryMuscles.forEach(m => {
          volume[m] = (volume[m] || 0) + Math.floor(ex.sets * 0.5); // Count secondary at 50%
        });
      }
    });
  });
  
  return volume;
}

// Re-export from exercise service for backward compatibility
export { getExercisesSync as getExerciseDatabase } from './exerciseService';
