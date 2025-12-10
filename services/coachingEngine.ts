// ============================================================
// COACHING / CALIBRATION ENGINE
// Helps users calibrate their strength profile by testing
// key benchmark lifts and comparing to population standards
// ============================================================

import type { Experience } from '@/types/schema';

// ============================================================
// TYPES
// ============================================================

export type MovementPattern = 
  | 'horizontal_push' 
  | 'horizontal_pull' 
  | 'vertical_push' 
  | 'vertical_pull' 
  | 'squat' 
  | 'hip_hinge' 
  | 'lunge'
  | 'carry';

export type Equipment = 
  | 'barbell' 
  | 'dumbbell' 
  | 'machine' 
  | 'cable' 
  | 'bodyweight' 
  | 'kettlebell';

export type StrengthLevel = 
  | 'untrained' 
  | 'beginner' 
  | 'novice' 
  | 'intermediate' 
  | 'advanced' 
  | 'elite';

export type FFMIBracket = 
  | 'below_average' 
  | 'average' 
  | 'above_average' 
  | 'excellent' 
  | 'elite';

export interface WarmupSet {
  percentOfWorking: number;
  reps: number;
  rest: number;
  notes: string;
}

export interface TestingProtocol {
  type: 'rpe_based' | 'rep_max' | 'amrap';
  targetReps?: number;
  targetRPE?: number;
  warmupProtocol: WarmupSet[];
  instructions: string;
  safetyWarnings: string[];
  estimationAccuracy: number;
}

export interface PercentileTable {
  male: Record<number, number>;
  female: Record<number, number>;
}

export interface BenchmarkLift {
  id: string;
  name: string;
  pattern: MovementPattern;
  equipment: Equipment;
  description: string;
  safetyNotes: string;
  alternatives: string[];
  derivesExercises: string[];
  testingProtocol: TestingProtocol;
  populationPercentiles: PercentileTable;
}

export interface PercentileScore {
  vsGeneralPopulation: number;
  vsTrainedPopulation: number;
  vsBodyComposition: number;
}

export interface CalibrationResult {
  lift: string;
  benchmarkId: string;
  testedWeight: number;
  testedReps: number;
  testedRPE?: number;
  estimated1RM: number;
  percentileScore: PercentileScore;
  strengthLevel: StrengthLevel;
}

export interface StrengthImbalance {
  type: 'push_pull' | 'upper_lower' | 'anterior_posterior' | 'bilateral';
  description: string;
  severity: 'minor' | 'moderate' | 'significant';
  recommendation: string;
}

export interface BodyComposition {
  totalWeightKg: number;
  bodyFatPercentage: number;
  leanMassKg: number;
  ffmi: number;
  heightCm: number;
}

export interface StrengthProfile {
  overallScore: number;
  strengthLevel: StrengthLevel;
  balanceScore: number;
  imbalances: StrengthImbalance[];
  calibratedLifts: CalibrationResult[];
  bodyComposition: BodyComposition;
  recommendations: string[];
}

export interface CoachingSession {
  id: string;
  status: 'not_started' | 'in_progress' | 'completed';
  bodyComposition?: BodyComposition;
  selectedBenchmarks: string[];
  completedBenchmarks: CalibrationResult[];
  strengthProfile?: StrengthProfile;
  createdAt: Date;
  completedAt?: Date;
}

export interface EstimatedMax {
  exercise: string;
  estimated1RM: number;
  confidence: 'high' | 'medium' | 'low' | 'extrapolated';
  source: 'direct_history' | 'related_exercise' | 'strength_standards' | 'bodyweight_ratio' | 'calibration';
  lastUpdated?: Date;
}

// ============================================================
// BENCHMARK LIFT DEFINITIONS
// ============================================================

export const BENCHMARK_LIFTS: BenchmarkLift[] = [
  {
    id: 'bench_press',
    name: 'Barbell Bench Press',
    pattern: 'horizontal_push',
    equipment: 'barbell',
    description: 'The standard measure of upper body pushing strength.',
    safetyNotes: 'Use a spotter or safety bars. Do not test to absolute failure without spotters.',
    alternatives: ['Dumbbell Bench Press', 'Machine Chest Press'],
    derivesExercises: [
      'Dumbbell Bench Press', 'Incline Barbell Press', 'Incline Dumbbell Press',
      'Machine Chest Press', 'Close-Grip Bench Press', 'Dip (Chest Focus)',
      'Cable Fly', 'Push-Up'
    ],
    testingProtocol: {
      type: 'rpe_based',
      targetReps: 5,
      targetRPE: 8,
      warmupProtocol: [
        { percentOfWorking: 0.4, reps: 10, rest: 60, notes: 'Empty bar or light weight' },
        { percentOfWorking: 0.6, reps: 5, rest: 90, notes: 'Building up' },
        { percentOfWorking: 0.8, reps: 3, rest: 120, notes: 'Getting close' },
      ],
      instructions: `Find a weight you can lift for 5 reps with 2 reps left in the tank (RPE 8).

1. Start with a weight you know you can handle easily
2. Do 5 reps, assess difficulty
3. If RPE < 7: Add 5-10kg, rest 3 min, try again
4. If RPE 7-8: This is your test weight
5. If RPE > 8: Too heavy, but we can still use this data

Record: Weight × Reps @ RPE`,
      safetyWarnings: [
        'Always use safety bars or a spotter',
        'Do not attempt if you have shoulder injuries',
        'Stop immediately if you feel sharp pain'
      ],
      estimationAccuracy: 0.95
    },
    populationPercentiles: {
      male: {
        5: 0.40, 10: 0.50, 25: 0.65, 50: 0.85, 75: 1.10, 90: 1.35, 95: 1.55, 99: 1.85
      },
      female: {
        5: 0.20, 10: 0.25, 25: 0.35, 50: 0.50, 75: 0.65, 90: 0.80, 95: 0.95, 99: 1.15
      }
    }
  },
  {
    id: 'squat',
    name: 'Barbell Back Squat',
    pattern: 'squat',
    equipment: 'barbell',
    description: 'The king of lower body exercises. Tests overall leg strength and core stability.',
    safetyNotes: 'Use a squat rack with safety bars. Depth should be at least parallel (hip crease below knee).',
    alternatives: ['Leg Press', 'Goblet Squat', 'Hack Squat'],
    derivesExercises: [
      'Front Squat', 'Leg Press', 'Hack Squat', 'Bulgarian Split Squat',
      'Walking Lunge', 'Goblet Squat', 'Leg Extension', 'Hip Thrust'
    ],
    testingProtocol: {
      type: 'rpe_based',
      targetReps: 5,
      targetRPE: 8,
      warmupProtocol: [
        { percentOfWorking: 0.3, reps: 10, rest: 60, notes: 'Bodyweight or empty bar' },
        { percentOfWorking: 0.5, reps: 5, rest: 90, notes: 'Light weight, focus on depth' },
        { percentOfWorking: 0.7, reps: 3, rest: 120, notes: 'Moderate weight' },
        { percentOfWorking: 0.85, reps: 2, rest: 150, notes: 'Getting heavy' },
      ],
      instructions: `Find a weight you can squat for 5 reps with 2 reps left in the tank (RPE 8).

Depth requirement: Hip crease must go below the top of your knee.

1. Start conservative - squats are fatiguing
2. Build up in 10-20kg jumps
3. When the bar speed noticeably slows, you're getting close
4. Target: 5 reps where rep 5 is hard but doable for 2 more

Rest 3-4 minutes between attempts.`,
      safetyWarnings: [
        'Always use safety bars set just below your bottom position',
        'Do not attempt with lower back or knee injuries',
        'Keep core braced throughout - never relax at the bottom'
      ],
      estimationAccuracy: 0.93
    },
    populationPercentiles: {
      male: {
        5: 0.55, 10: 0.70, 25: 0.90, 50: 1.15, 75: 1.45, 90: 1.75, 95: 2.00, 99: 2.40
      },
      female: {
        5: 0.30, 10: 0.40, 25: 0.55, 50: 0.75, 75: 1.00, 90: 1.25, 95: 1.45, 99: 1.75
      }
    }
  },
  {
    id: 'deadlift',
    name: 'Conventional Deadlift',
    pattern: 'hip_hinge',
    equipment: 'barbell',
    description: 'Tests posterior chain strength - back, glutes, and hamstrings.',
    safetyNotes: 'Keep back neutral. If your lower back rounds significantly, the weight is too heavy.',
    alternatives: ['Romanian Deadlift', 'Trap Bar Deadlift', 'Dumbbell RDL'],
    derivesExercises: [
      'Romanian Deadlift', 'Dumbbell RDL', 'Barbell Row', 'Good Morning',
      'Hip Thrust', 'Lying Leg Curl', 'Cable Pull-Through', 'Kettlebell Swing'
    ],
    testingProtocol: {
      type: 'rpe_based',
      targetReps: 5,
      targetRPE: 8,
      warmupProtocol: [
        { percentOfWorking: 0.4, reps: 8, rest: 60, notes: 'Light weight, groove the pattern' },
        { percentOfWorking: 0.6, reps: 5, rest: 90, notes: 'Building up' },
        { percentOfWorking: 0.75, reps: 3, rest: 120, notes: 'Moderate-heavy' },
        { percentOfWorking: 0.85, reps: 1, rest: 150, notes: 'Heavy single' },
      ],
      instructions: `Find a weight you can deadlift for 5 reps with 2 reps left in the tank (RPE 8).

Form requirements:
- Bar starts over mid-foot
- Back stays neutral (no rounding)
- Full lockout at top (hips through, shoulders back)

Build up conservatively. Deadlifts are the most fatiguing lift to test.`,
      safetyWarnings: [
        'Stop immediately if lower back rounds',
        'Do not attempt with acute back injuries',
        'Reset between each rep - no touch and go during testing'
      ],
      estimationAccuracy: 0.92
    },
    populationPercentiles: {
      male: {
        5: 0.70, 10: 0.90, 25: 1.15, 50: 1.50, 75: 1.85, 90: 2.20, 95: 2.50, 99: 3.00
      },
      female: {
        5: 0.40, 10: 0.55, 25: 0.75, 50: 1.00, 75: 1.30, 90: 1.60, 95: 1.85, 99: 2.25
      }
    }
  },
  {
    id: 'overhead_press',
    name: 'Standing Overhead Press',
    pattern: 'vertical_push',
    equipment: 'barbell',
    description: 'Tests shoulder strength and overhead stability. Strict press - no leg drive.',
    safetyNotes: 'Keep core braced. Do not hyperextend lower back.',
    alternatives: ['Seated Dumbbell Shoulder Press', 'Machine Shoulder Press'],
    derivesExercises: [
      'Dumbbell Shoulder Press', 'Lateral Raise', 'Cable Lateral Raise',
      'Face Pull', 'Reverse Fly', 'Front Raise'
    ],
    testingProtocol: {
      type: 'rpe_based',
      targetReps: 5,
      targetRPE: 8,
      warmupProtocol: [
        { percentOfWorking: 0.4, reps: 10, rest: 60, notes: 'Empty bar' },
        { percentOfWorking: 0.6, reps: 5, rest: 90, notes: 'Light weight' },
        { percentOfWorking: 0.8, reps: 3, rest: 120, notes: 'Building up' },
      ],
      instructions: `Find a weight you can strict press for 5 reps with 2 reps left in the tank (RPE 8).

Form requirements:
- No leg drive (strict press only)
- Bar path goes around face, not forward
- Full lockout overhead with biceps by ears
- Core stays braced, no excessive back arch

OHP is typically the weakest of the big lifts - start conservative.`,
      safetyWarnings: [
        'Do not attempt with shoulder impingement',
        'Stop if you feel pinching in shoulders',
        'Excessive back arch = weight is too heavy'
      ],
      estimationAccuracy: 0.94
    },
    populationPercentiles: {
      male: {
        5: 0.25, 10: 0.35, 25: 0.45, 50: 0.60, 75: 0.75, 90: 0.90, 95: 1.05, 99: 1.25
      },
      female: {
        5: 0.15, 10: 0.20, 25: 0.28, 50: 0.38, 75: 0.50, 90: 0.62, 95: 0.72, 99: 0.88
      }
    }
  },
  {
    id: 'barbell_row',
    name: 'Barbell Row',
    pattern: 'horizontal_pull',
    equipment: 'barbell',
    description: 'Tests back thickness and horizontal pulling strength.',
    safetyNotes: 'Keep back at consistent angle. Some body English is acceptable but control the eccentric.',
    alternatives: ['Dumbbell Row', 'Seated Cable Row', 'Chest-Supported Row'],
    derivesExercises: [
      'Dumbbell Row', 'Seated Cable Row', 'T-Bar Row', 'Chest-Supported Row',
      'Lat Pulldown', 'Pull-Up', 'Barbell Curl', 'Dumbbell Curl'
    ],
    testingProtocol: {
      type: 'rpe_based',
      targetReps: 8,
      targetRPE: 8,
      warmupProtocol: [
        { percentOfWorking: 0.4, reps: 10, rest: 60, notes: 'Light weight, feel the lats' },
        { percentOfWorking: 0.6, reps: 6, rest: 90, notes: 'Building up' },
        { percentOfWorking: 0.8, reps: 4, rest: 90, notes: 'Getting close' },
      ],
      instructions: `Find a weight you can row for 8 reps with 2 reps left in the tank (RPE 8).

Form requirements:
- Back angle ~45 degrees (some variation is fine)
- Bar touches lower chest/upper abdomen
- Control the negative - no dropping
- Some body English is fine, but if you're heaving, it's too heavy

Rows are hard to standardize - be consistent with your form.`,
      safetyWarnings: [
        'Avoid if you have acute lower back issues',
        'Do not jerk the weight - control the movement',
        'Keep neck neutral, do not crane to watch mirror'
      ],
      estimationAccuracy: 0.88
    },
    populationPercentiles: {
      male: {
        5: 0.35, 10: 0.45, 25: 0.55, 50: 0.70, 75: 0.90, 90: 1.10, 95: 1.25, 99: 1.50
      },
      female: {
        5: 0.20, 10: 0.25, 25: 0.35, 50: 0.45, 75: 0.60, 90: 0.75, 95: 0.85, 99: 1.05
      }
    }
  },
  {
    id: 'pullup',
    name: 'Pull-Up',
    pattern: 'vertical_pull',
    equipment: 'bodyweight',
    description: 'Tests relative upper body pulling strength. Bodyweight is your load.',
    safetyNotes: 'Full range of motion - dead hang to chin over bar.',
    alternatives: ['Lat Pulldown', 'Assisted Pull-Up Machine'],
    derivesExercises: [
      'Lat Pulldown', 'Seated Cable Row', 'Dumbbell Row',
      'Barbell Curl', 'Hammer Curl'
    ],
    testingProtocol: {
      type: 'amrap',
      warmupProtocol: [
        { percentOfWorking: 0.5, reps: 5, rest: 60, notes: 'Band-assisted or lat pulldown' },
        { percentOfWorking: 0.8, reps: 3, rest: 90, notes: 'Few easy pull-ups' },
      ],
      instructions: `Perform as many pull-ups as possible with good form.

Form requirements:
- Start from dead hang (arms fully extended)
- Chin must clear the bar
- No kipping or swinging
- Full extension between each rep

If you can do 0-2 pull-ups, use the lat pulldown test instead.
If you can do 15+, consider adding weight for a more accurate test.`,
      safetyWarnings: [
        'Stop if you feel shoulder impingement',
        'Do not kip - this is a strength test',
        'Dropping from the bar can be hard on joints - lower controlled'
      ],
      estimationAccuracy: 0.90
    },
    populationPercentiles: {
      male: {
        5: 0, 10: 1, 25: 4, 50: 8, 75: 12, 90: 18, 95: 22, 99: 28
      },
      female: {
        5: 0, 10: 0, 25: 1, 50: 3, 75: 6, 90: 10, 95: 14, 99: 20
      }
    }
  },
  {
    id: 'leg_press',
    name: 'Leg Press (45°)',
    pattern: 'squat',
    equipment: 'machine',
    description: 'Alternative to squats for testing lower body pushing strength.',
    safetyNotes: 'Do not lock out knees aggressively. Keep lower back pressed into pad.',
    alternatives: ['Hack Squat'],
    derivesExercises: [
      'Barbell Back Squat', 'Front Squat', 'Hack Squat', 'Leg Extension',
      'Bulgarian Split Squat', 'Walking Lunge'
    ],
    testingProtocol: {
      type: 'rpe_based',
      targetReps: 10,
      targetRPE: 8,
      warmupProtocol: [
        { percentOfWorking: 0.3, reps: 15, rest: 60, notes: 'Very light' },
        { percentOfWorking: 0.5, reps: 10, rest: 90, notes: 'Building up' },
        { percentOfWorking: 0.7, reps: 6, rest: 90, notes: 'Getting heavier' },
      ],
      instructions: `Find a weight you can leg press for 10 reps with 2 reps left in the tank (RPE 8).

Form requirements:
- Feet shoulder width on platform
- Lower until knees at ~90 degrees
- Do NOT let lower back round off the pad
- Control the weight - no bouncing at bottom

Note: We'll convert this to estimate your free weight squat potential.`,
      safetyWarnings: [
        'Never lock out knees explosively',
        'Lower back must stay pressed into pad',
        'If lower back lifts, range of motion is too deep'
      ],
      estimationAccuracy: 0.82
    },
    populationPercentiles: {
      male: {
        5: 1.0, 10: 1.3, 25: 1.7, 50: 2.2, 75: 2.8, 90: 3.5, 95: 4.0, 99: 5.0
      },
      female: {
        5: 0.6, 10: 0.8, 25: 1.1, 50: 1.5, 75: 2.0, 90: 2.5, 95: 3.0, 99: 3.8
      }
    }
  },
];

// ============================================================
// 1RM ESTIMATION
// ============================================================

export function estimate1RM(weight: number, reps: number, rpe?: number): number {
  // Brzycki formula as base
  let baseEstimate = weight * (36 / (37 - reps));
  
  // Adjust for RPE if provided (each RPE point below 10 = ~2.5% more capacity)
  if (rpe !== undefined && rpe < 10) {
    const rirsRemaining = 10 - rpe;
    const adjustmentFactor = 1 + (rirsRemaining * 0.025);
    baseEstimate = baseEstimate * adjustmentFactor;
  }
  
  return Math.round(baseEstimate * 10) / 10;
}

// ============================================================
// FFMI CALCULATIONS
// ============================================================

export function calculateBodyComposition(
  weightKg: number,
  bodyFatPercentage: number,
  heightCm: number
): BodyComposition {
  const leanMassKg = weightKg * (1 - bodyFatPercentage / 100);
  const heightM = heightCm / 100;
  
  // FFMI = lean mass / height^2 + 6.1 * (1.8 - height)
  const ffmi = (leanMassKg / (heightM * heightM)) + 6.1 * (1.8 - heightM);
  
  return {
    totalWeightKg: weightKg,
    bodyFatPercentage,
    leanMassKg,
    ffmi: Math.round(ffmi * 10) / 10,
    heightCm
  };
}

export function getFFMIBracket(ffmi: number): FFMIBracket {
  if (ffmi < 18) return 'below_average';
  if (ffmi < 20) return 'average';
  if (ffmi < 22) return 'above_average';
  if (ffmi < 24) return 'excellent';
  return 'elite';
}

export function getFFMIAssessment(ffmi: number, sex: 'male' | 'female'): string {
  const adjustment = sex === 'female' ? -3 : 0;
  const adjustedFFMI = ffmi - adjustment;
  
  if (adjustedFFMI < 18) {
    return `Your FFMI of ${ffmi.toFixed(1)} indicates below-average muscle mass. ` +
      `This is common for beginners or those who haven't focused on resistance training. ` +
      `Good news: you have significant potential for muscle gain.`;
  }
  if (adjustedFFMI < 20) {
    return `Your FFMI of ${ffmi.toFixed(1)} indicates average muscle mass for someone who lifts. ` +
      `You have a solid foundation with room for continued growth.`;
  }
  if (adjustedFFMI < 22) {
    return `Your FFMI of ${ffmi.toFixed(1)} indicates above-average muscular development. ` +
      `You've built meaningful muscle mass. Continued gains will require progressive overload and patience.`;
  }
  if (adjustedFFMI < 24) {
    return `Your FFMI of ${ffmi.toFixed(1)} indicates excellent muscular development. ` +
      `You're approaching the upper end of what's achievable naturally for most people.`;
  }
  return `Your FFMI of ${ffmi.toFixed(1)} indicates elite muscular development. ` +
    `This is near the natural limit for most individuals. Impressive.`;
}

// ============================================================
// PERCENTILE CALCULATIONS
// ============================================================

function getPercentile(
  value: number,
  table: Record<number, number>
): number {
  const percentiles = Object.keys(table).map(Number).sort((a, b) => a - b);
  
  for (let i = 0; i < percentiles.length; i++) {
    const p = percentiles[i];
    const threshold = table[p];
    
    if (value < threshold) {
      if (i === 0) return p / 2;
      const prevP = percentiles[i - 1];
      const prevThreshold = table[prevP];
      const ratio = (value - prevThreshold) / (threshold - prevThreshold);
      return prevP + ratio * (p - prevP);
    }
  }
  
  return 99;
}

export function calculatePercentileScore(
  estimated1RM: number,
  bodyweightKg: number,
  benchmark: BenchmarkLift,
  sex: 'male' | 'female',
  ffmi: number
): PercentileScore {
  const table = sex === 'male' 
    ? benchmark.populationPercentiles.male 
    : benchmark.populationPercentiles.female;
  
  // Special handling for pull-ups (rep-based, not weight-based)
  if (benchmark.id === 'pullup') {
    const vsGeneral = getPercentile(estimated1RM, table);
    return {
      vsGeneralPopulation: Math.round(vsGeneral),
      vsTrainedPopulation: Math.round(Math.max(0, vsGeneral - 15)),
      vsBodyComposition: Math.round(vsGeneral)
    };
  }
  
  // For weight-based lifts, compare ratio to bodyweight
  const ratio = estimated1RM / bodyweightKg;
  const vsGeneral = getPercentile(ratio, table);
  
  // Trained population adjustment
  const vsTrainedAdjustment = 20;
  const vsTrained = Math.max(1, vsGeneral - vsTrainedAdjustment);
  
  // Body composition adjustment
  const ffmiBracket = getFFMIBracket(ffmi);
  const ffmiAdjustments: Record<FFMIBracket, number> = {
    'below_average': 5,
    'average': 0,
    'above_average': -5,
    'excellent': -10,
    'elite': -15
  };
  
  const vsBodyComp = Math.max(1, Math.min(99, vsGeneral + (ffmiAdjustments[ffmiBracket] || 0)));
  
  return {
    vsGeneralPopulation: Math.round(vsGeneral),
    vsTrainedPopulation: Math.round(vsTrained),
    vsBodyComposition: Math.round(vsBodyComp)
  };
}

export function calculateStrengthLevel(percentile: number): StrengthLevel {
  if (percentile < 10) return 'untrained';
  if (percentile < 25) return 'beginner';
  if (percentile < 50) return 'novice';
  if (percentile < 75) return 'intermediate';
  if (percentile < 95) return 'advanced';
  return 'elite';
}

// ============================================================
// STRENGTH BALANCE ANALYSIS
// ============================================================

interface LiftRatios {
  benchToSquat: number;
  benchToDeadlift: number;
  ohpToBench: number;
  rowToBench: number;
  squatToDeadlift: number;
}

const IDEAL_RATIOS: LiftRatios = {
  benchToSquat: 0.75,
  benchToDeadlift: 0.60,
  ohpToBench: 0.60,
  rowToBench: 0.75,
  squatToDeadlift: 0.80
};

const RATIO_TOLERANCE = 0.15;

export function analyzeStrengthBalance(
  calibrations: CalibrationResult[]
): { score: number; imbalances: StrengthImbalance[] } {
  const imbalances: StrengthImbalance[] = [];
  
  // Build lookup of estimated 1RMs
  const maxes: Record<string, number> = {};
  for (const cal of calibrations) {
    maxes[cal.lift] = cal.estimated1RM;
  }
  
  // Check bench to squat ratio
  if (maxes['Barbell Bench Press'] && maxes['Barbell Back Squat']) {
    const ratio = maxes['Barbell Bench Press'] / maxes['Barbell Back Squat'];
    const deviation = (ratio - IDEAL_RATIOS.benchToSquat) / IDEAL_RATIOS.benchToSquat;
    
    if (Math.abs(deviation) > RATIO_TOLERANCE) {
      const severity = Math.abs(deviation) > 0.3 ? 'significant' : 
                       Math.abs(deviation) > 0.2 ? 'moderate' : 'minor';
      
      if (deviation > 0) {
        imbalances.push({
          type: 'upper_lower',
          description: 'Upper body pushing is strong relative to lower body',
          severity,
          recommendation: 'Prioritize squat variations and leg development'
        });
      } else {
        imbalances.push({
          type: 'upper_lower',
          description: 'Lower body is strong relative to upper body pushing',
          severity,
          recommendation: 'Increase pressing volume and frequency'
        });
      }
    }
  }
  
  // Check row to bench ratio (push/pull balance)
  if (maxes['Barbell Bench Press'] && maxes['Barbell Row']) {
    const ratio = maxes['Barbell Row'] / maxes['Barbell Bench Press'];
    const deviation = (ratio - IDEAL_RATIOS.rowToBench) / IDEAL_RATIOS.rowToBench;
    
    if (deviation < -RATIO_TOLERANCE) {
      const severity = Math.abs(deviation) > 0.3 ? 'significant' : 
                       Math.abs(deviation) > 0.2 ? 'moderate' : 'minor';
      imbalances.push({
        type: 'push_pull',
        description: 'Pushing strength exceeds pulling strength',
        severity,
        recommendation: 'Add more rowing and pulling volume. Common issue that can lead to shoulder problems.'
      });
    }
  }
  
  // Check squat to deadlift ratio (anterior/posterior)
  if (maxes['Barbell Back Squat'] && maxes['Conventional Deadlift']) {
    const ratio = maxes['Barbell Back Squat'] / maxes['Conventional Deadlift'];
    const deviation = (ratio - IDEAL_RATIOS.squatToDeadlift) / IDEAL_RATIOS.squatToDeadlift;
    
    if (Math.abs(deviation) > RATIO_TOLERANCE) {
      const severity = Math.abs(deviation) > 0.3 ? 'significant' : 
                       Math.abs(deviation) > 0.2 ? 'moderate' : 'minor';
      
      if (deviation > 0) {
        imbalances.push({
          type: 'anterior_posterior',
          description: 'Quad-dominant: squat is strong relative to deadlift',
          severity,
          recommendation: 'Add more hip hinge work (RDLs, good mornings) and posterior chain development'
        });
      } else {
        imbalances.push({
          type: 'anterior_posterior',
          description: 'Hip-dominant: deadlift is strong relative to squat',
          severity,
          recommendation: 'Focus on squat technique and quad-focused accessories'
        });
      }
    }
  }
  
  // Check OHP to bench ratio
  if (maxes['Standing Overhead Press'] && maxes['Barbell Bench Press']) {
    const ratio = maxes['Standing Overhead Press'] / maxes['Barbell Bench Press'];
    const deviation = (ratio - IDEAL_RATIOS.ohpToBench) / IDEAL_RATIOS.ohpToBench;
    
    if (deviation < -RATIO_TOLERANCE) {
      const severity = Math.abs(deviation) > 0.3 ? 'significant' : 
                       Math.abs(deviation) > 0.2 ? 'moderate' : 'minor';
      imbalances.push({
        type: 'push_pull',
        description: 'Overhead pressing is weak relative to horizontal pressing',
        severity,
        recommendation: 'Increase overhead pressing frequency. Consider shoulder mobility work.'
      });
    }
  }
  
  // Calculate balance score
  const numPossibleImbalances = 4;
  const severityScores = { minor: 0.1, moderate: 0.2, significant: 0.35 };
  const totalPenalty = imbalances.reduce((sum, imb) => sum + severityScores[imb.severity], 0);
  const balanceScore = Math.max(0, Math.round((1 - totalPenalty / numPossibleImbalances) * 100));
  
  return { score: balanceScore, imbalances };
}

// ============================================================
// COACHING SESSION MANAGER
// ============================================================

export class CoachingSessionManager {
  private session: CoachingSession;
  
  constructor(sessionId?: string) {
    this.session = {
      id: sessionId || crypto.randomUUID(),
      status: 'not_started',
      selectedBenchmarks: [],
      completedBenchmarks: [],
      createdAt: new Date()
    };
  }
  
  // Load from existing session data
  loadSession(sessionData: Partial<CoachingSession>) {
    this.session = {
      ...this.session,
      ...sessionData,
      createdAt: sessionData.createdAt ? new Date(sessionData.createdAt) : this.session.createdAt,
      completedAt: sessionData.completedAt ? new Date(sessionData.completedAt) : undefined
    };
  }
  
  // Step 1: Set body composition
  setBodyComposition(
    heightCm: number,
    weightKg: number,
    bodyFatPercentage: number
  ): { bodyComposition: BodyComposition } {
    const bodyComp = calculateBodyComposition(weightKg, bodyFatPercentage, heightCm);
    this.session.bodyComposition = bodyComp;
    this.session.status = 'in_progress';
    
    return { bodyComposition: bodyComp };
  }
  
  // Step 2: Get available benchmarks
  getAvailableBenchmarks(): {
    recommended: BenchmarkLift[];
    optional: BenchmarkLift[];
    alternatives: { original: string; alternative: BenchmarkLift }[];
  } {
    const recommended = BENCHMARK_LIFTS.filter(b => 
      ['bench_press', 'squat', 'deadlift', 'barbell_row'].includes(b.id)
    );
    
    const optional = BENCHMARK_LIFTS.filter(b =>
      ['overhead_press', 'pullup'].includes(b.id)
    );
    
    const alternatives = [
      { original: 'Barbell Back Squat', alternative: BENCHMARK_LIFTS.find(b => b.id === 'leg_press')! }
    ].filter(a => a.alternative);
    
    return { recommended, optional, alternatives };
  }
  
  // Step 3: Select benchmarks to test
  selectBenchmarks(benchmarkIds: string[]): {
    selected: BenchmarkLift[];
    testingOrder: BenchmarkLift[];
    estimatedTime: number;
  } {
    const selected = BENCHMARK_LIFTS.filter(b => benchmarkIds.includes(b.id));
    this.session.selectedBenchmarks = benchmarkIds;
    
    // Optimal testing order: less fatiguing to more fatiguing
    const orderPriority: Record<string, number> = {
      'overhead_press': 1,
      'pullup': 2,
      'bench_press': 3,
      'barbell_row': 4,
      'squat': 5,
      'leg_press': 5,
      'deadlift': 6
    };
    
    const testingOrder = [...selected].sort((a, b) => 
      (orderPriority[a.id] || 99) - (orderPriority[b.id] || 99)
    );
    
    const estimatedTime = selected.length * 17;
    
    return { selected, testingOrder, estimatedTime };
  }
  
  // Step 4: Get testing instructions for a benchmark
  getTestingInstructions(benchmarkId: string): {
    benchmark: BenchmarkLift;
    suggestedStartWeight: number;
    protocol: TestingProtocol;
  } | null {
    const benchmark = BENCHMARK_LIFTS.find(b => b.id === benchmarkId);
    if (!benchmark || !this.session.bodyComposition) return null;
    
    const bw = this.session.bodyComposition.totalWeightKg;
    
    // Use lower end of novice standards as starting point
    const startingRatios: Record<string, number> = {
      'bench_press': 0.5,
      'squat': 0.7,
      'deadlift': 0.9,
      'overhead_press': 0.35,
      'barbell_row': 0.45,
      'leg_press': 1.3,
      'pullup': 0
    };
    
    const suggestedStartWeight = Math.round((bw * (startingRatios[benchmarkId] || 0.5)) / 2.5) * 2.5;
    
    return {
      benchmark,
      suggestedStartWeight,
      protocol: benchmark.testingProtocol
    };
  }
  
  // Step 5: Record benchmark result
  recordBenchmarkResult(
    benchmarkId: string,
    weight: number,
    reps: number,
    rpe: number | undefined,
    sex: 'male' | 'female'
  ): CalibrationResult | null {
    const benchmark = BENCHMARK_LIFTS.find(b => b.id === benchmarkId);
    if (!benchmark || !this.session.bodyComposition) return null;
    
    // Calculate estimated 1RM
    let estimated1RM: number;
    if (benchmark.testingProtocol.type === 'amrap') {
      // For pull-ups, reps IS the score (we'll use it directly for percentile)
      estimated1RM = reps;
    } else {
      estimated1RM = estimate1RM(weight, reps, rpe);
    }
    
    const percentileScore = calculatePercentileScore(
      estimated1RM,
      this.session.bodyComposition.totalWeightKg,
      benchmark,
      sex,
      this.session.bodyComposition.ffmi
    );
    
    const strengthLevel = calculateStrengthLevel(percentileScore.vsTrainedPopulation);
    
    const result: CalibrationResult = {
      lift: benchmark.name,
      benchmarkId: benchmark.id,
      testedWeight: weight,
      testedReps: reps,
      testedRPE: rpe,
      estimated1RM,
      percentileScore,
      strengthLevel
    };
    
    // Update session - replace if already exists
    this.session.completedBenchmarks = this.session.completedBenchmarks.filter(
      b => b.lift !== benchmark.name
    );
    this.session.completedBenchmarks.push(result);
    
    return result;
  }
  
  // Step 6: Generate strength profile
  generateStrengthProfile(sex: 'male' | 'female'): StrengthProfile | null {
    if (!this.session.bodyComposition || this.session.completedBenchmarks.length === 0) {
      return null;
    }
    
    // Calculate weighted overall score
    const weights: Record<string, number> = {
      'Barbell Bench Press': 1.0,
      'Barbell Back Squat': 1.2,
      'Conventional Deadlift': 1.2,
      'Standing Overhead Press': 0.8,
      'Barbell Row': 0.9,
      'Pull-Up': 0.7,
      'Leg Press (45°)': 1.0
    };
    
    let weightedSum = 0;
    let totalWeight = 0;
    
    for (const cal of this.session.completedBenchmarks) {
      const weight = weights[cal.lift] || 1.0;
      weightedSum += cal.percentileScore.vsTrainedPopulation * weight;
      totalWeight += weight;
    }
    
    const overallScore = Math.round(weightedSum / totalWeight);
    const overallStrengthLevel = calculateStrengthLevel(overallScore);
    
    // Analyze balance
    const { score: balanceScore, imbalances } = analyzeStrengthBalance(
      this.session.completedBenchmarks
    );
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(
      overallScore,
      balanceScore,
      imbalances,
      this.session.bodyComposition
    );
    
    const profile: StrengthProfile = {
      overallScore,
      strengthLevel: overallStrengthLevel,
      balanceScore,
      imbalances,
      calibratedLifts: this.session.completedBenchmarks,
      bodyComposition: this.session.bodyComposition,
      recommendations
    };
    
    this.session.strengthProfile = profile;
    this.session.status = 'completed';
    this.session.completedAt = new Date();
    
    return profile;
  }
  
  private generateRecommendations(
    overallScore: number,
    balanceScore: number,
    imbalances: StrengthImbalance[],
    bodyComp: BodyComposition
  ): string[] {
    const recs: string[] = [];
    
    // Strength level recommendations
    if (overallScore < 25) {
      recs.push('Focus on building foundational strength with a linear progression program. ' +
        'You can expect rapid progress at this stage.');
    } else if (overallScore < 50) {
      recs.push('Continue building strength with moderate volume. ' +
        'Consider transitioning to an intermediate program if progress stalls.');
    } else if (overallScore < 75) {
      recs.push('You have solid strength. Progress will be slower - focus on periodization ' +
        'and addressing weak points.');
    } else {
      recs.push('Advanced strength level. Focus on specific weaknesses and consider ' +
        'specialized programming for continued progress.');
    }
    
    // Balance recommendations
    if (balanceScore < 70) {
      recs.push('Your lift ratios show significant imbalances. Prioritize bringing up weak lifts ' +
        'before pushing strong ones further.');
    }
    
    // Add specific imbalance recommendations
    for (const imbalance of imbalances) {
      if (imbalance.severity !== 'minor') {
        recs.push(imbalance.recommendation);
      }
    }
    
    // Body composition recommendations
    if (bodyComp.ffmi < 19 && overallScore > 40) {
      recs.push('Your strength is good relative to your muscle mass. ' +
        'A hypertrophy phase could help you build a larger base for future strength gains.');
    }
    
    return recs;
  }
  
  // Get current session state
  getSession(): CoachingSession {
    return this.session;
  }
  
  // Export for weight estimation engine
  exportForWeightEngine(): EstimatedMax[] {
    return this.session.completedBenchmarks.map(cal => ({
      exercise: cal.lift,
      estimated1RM: cal.estimated1RM,
      confidence: 'high' as const,
      source: 'calibration' as const,
      lastUpdated: new Date()
    }));
  }
}

// ============================================================
// DISPLAY HELPERS
// ============================================================

export function getStrengthLevelColor(level: StrengthLevel): string {
  const colors: Record<StrengthLevel, string> = {
    'untrained': 'text-surface-500',
    'beginner': 'text-warning-400',
    'novice': 'text-info-400',
    'intermediate': 'text-success-400',
    'advanced': 'text-primary-400',
    'elite': 'text-accent-400'
  };
  return colors[level] || 'text-surface-400';
}

export function getStrengthLevelBadgeVariant(level: StrengthLevel): 'default' | 'warning' | 'info' | 'success' | 'danger' {
  const variants: Record<StrengthLevel, 'default' | 'warning' | 'info' | 'success' | 'danger'> = {
    'untrained': 'default',
    'beginner': 'warning',
    'novice': 'info',
    'intermediate': 'success',
    'advanced': 'success',
    'elite': 'success'
  };
  return variants[level] || 'default';
}

export function formatStrengthLevel(level: StrengthLevel): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

// Generate visual percentile segments for charts
export function generatePercentileSegments(
  percentile: number
): { filled: boolean; color: string }[] {
  const segments = [];
  
  for (let i = 0; i < 20; i++) {
    const threshold = i * 5;
    const filled = percentile > threshold;
    
    let color: string;
    if (threshold < 25) color = '#ef4444';      // Red
    else if (threshold < 50) color = '#f59e0b'; // Orange/Yellow
    else if (threshold < 75) color = '#84cc16'; // Lime
    else color = '#22c55e';                      // Green
    
    segments.push({ filled, color: filled ? color : '#374151' });
  }
  
  return segments;
}

