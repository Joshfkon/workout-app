/**
 * Injury-Aware Exercise Swapper
 * 
 * Intelligent exercise filtering and swapping based on injury considerations.
 * Distinguishes between exercises that TARGET a muscle vs exercises that LOAD/STRESS a body part.
 * 
 * Key insight: "lower back injury" ≠ "avoid back exercises"
 * It means "avoid exercises that load the lumbar spine" - not lat pulldowns.
 */

import type { Exercise } from '@/types/schema';

// ============================================
// TYPES
// ============================================

export type InjuryArea = 
  | 'lower_back' 
  | 'upper_back'
  | 'shoulder_left'
  | 'shoulder_right'
  | 'shoulder'  // Generic shoulder
  | 'knee_left'
  | 'knee_right'
  | 'knee'  // Generic knee
  | 'hip_left'
  | 'hip_right'
  | 'hip'  // Generic hip
  | 'elbow_left'
  | 'elbow_right'
  | 'elbow'  // Generic elbow
  | 'wrist_left'
  | 'wrist_right'
  | 'wrist'  // Generic wrist
  | 'ankle_left'
  | 'ankle_right'
  | 'ankle'  // Generic ankle
  | 'neck'
  | 'chest';

export type InjuryRisk = 'safe' | 'caution' | 'avoid';

export interface InjuryContext {
  area: InjuryArea;
  severity: 1 | 2 | 3;  // 1=mild, 2=moderate, 3=severe
}

export interface InjurySafeSwap {
  exercise: Exercise;
  risk: InjuryRisk;
  matchScore: number;
  reason: string;
  safetyNote?: string;
}

// Normalize injury areas (left/right -> generic)
function normalizeInjuryArea(area: InjuryArea): InjuryArea {
  if (area === 'shoulder_left' || area === 'shoulder_right') return 'shoulder';
  if (area === 'knee_left' || area === 'knee_right') return 'knee';
  if (area === 'hip_left' || area === 'hip_right') return 'hip';
  if (area === 'elbow_left' || area === 'elbow_right') return 'elbow';
  if (area === 'wrist_left' || area === 'wrist_right') return 'wrist';
  if (area === 'ankle_left' || area === 'ankle_right') return 'ankle';
  return area;
}

// ============================================
// EXERCISE RISK CLASSIFICATION
// ============================================

/**
 * Exercises explicitly known to be problematic for specific injuries.
 * These override the inference logic.
 */
const EXPLICIT_AVOID: Record<string, string[]> = {
  lower_back: [
    'deadlift', 'sumo deadlift', 'rdl', 'romanian deadlift',
    'stiff leg', 'single leg rdl', 'good morning',
    'bent over row', 'barbell row', 'pendlay row', 't-bar row',
    'hyperextension', 'back extension',
    'barbell squat', 'back squat', 'front squat',
  ],
  upper_back: [
    'shrug', 'upright row', 'face pull',
  ],
  shoulder: [
    'overhead press', 'ohp', 'military press', 'shoulder press',
    'arnold press', 'behind neck press', 'push press',
    'upright row', 'dip', 'bench dip',
    'lateral raise', 'front raise',  // At heavy weights
  ],
  knee: [
    'squat', 'front squat', 'back squat', 'sissy squat',
    'walking lunge', 'jumping lunge', 'jump squat', 'box jump',
    'leg extension',  // Can be problematic
  ],
  hip: [
    'hip thrust', 'sumo deadlift', 'sumo squat',
    'hip abduction', 'hip adduction',
    'bulgarian split squat', 'lunge',
  ],
  elbow: [
    'skull crusher', 'lying tricep extension',
    'close grip bench', 'dip', 'chin up',
    'preacher curl', 'concentration curl',
  ],
  wrist: [
    'front squat', 'clean', 'snatch',
    'push up', 'pushup', 'wrist curl',
    'barbell bench press',
  ],
  ankle: [
    'calf raise', 'jump', 'box jump', 'squat',
    'lunge', 'running',
  ],
  neck: [
    'shrug', 'behind neck press', 'behind neck pulldown',
    'neck curl', 'neck extension', 'upright row',
  ],
  chest: [
    'bench press', 'dumbbell press', 'fly', 'flye',
    'push up', 'pushup', 'dip', 'cable crossover',
  ],
};

/**
 * Exercises explicitly known to be SAFE for specific injuries.
 * Great alternatives when someone has limitations.
 */
const EXPLICIT_SAFE: Record<string, string[]> = {
  lower_back: [
    // Back exercises that don't load the spine
    'lat pulldown', 'pulldown', 'pull up', 'pullup', 'chin up',
    'chest supported row', 'machine row', 'cable row', 'seated row',
    'straight arm pulldown', 'pullover',
    // Leg exercises without spinal loading
    'leg press', 'hack squat', 'pendulum squat',
    'leg extension', 'leg curl', 'lying leg curl', 'seated leg curl',
    'hip thrust', 'glute bridge', 'glute drive',
    'hip abduction', 'hip adduction',
    // All machines generally
    'machine', 'cable',
  ],
  upper_back: [
    'lat pulldown', 'pulldown', 'chest supported row',
    'machine row', 'cable row', 'pull up', 'pullup',
    // Lower body
    'squat', 'leg press', 'lunge', 'deadlift',
  ],
  shoulder: [
    // Lower body - completely fine
    'leg press', 'squat', 'hack squat', 'leg extension', 'leg curl',
    'hip thrust', 'calf raise', 'deadlift', 'rdl',
    // Low-stress upper body
    'cable curl', 'machine curl', 'tricep pushdown', 'rope pushdown',
    'machine tricep',
    // Actually therapeutic
    'face pull', 'band pull apart', 'external rotation',
    // Pulling is generally safe
    'lat pulldown', 'pulldown', 'row', 'pull up', 'pullup',
  ],
  knee: [
    // Hip-dominant movements
    'rdl', 'romanian deadlift', 'hip thrust', 'glute bridge',
    'cable pull through', 'lying leg curl', 'seated leg curl',
    // Upper body - completely fine
    'bench press', 'row', 'pulldown', 'curl', 'tricep',
    'shoulder press', 'lateral raise',
  ],
  hip: [
    // Knee-dominant
    'leg extension', 'leg curl',
    // Upper body - completely fine
    'bench press', 'row', 'pulldown', 'curl', 'tricep',
    'shoulder press', 'lateral raise',
  ],
  elbow: [
    // Lower body - completely fine
    'squat', 'leg press', 'leg curl', 'leg extension',
    'hip thrust', 'calf raise', 'deadlift',
    // Shoulder work that bypasses elbow
    'lateral raise', 'face pull', 'reverse fly', 'shrug',
  ],
  wrist: [
    // Can use straps or neutral grip
    'lat pulldown', 'cable row', 'machine row',
    // Lower body - completely fine
    'leg press', 'squat', 'leg curl', 'leg extension',
    'hip thrust', 'calf raise',
    // Machines
    'machine',
  ],
  ankle: [
    // Upper body - completely fine
    'bench press', 'row', 'pulldown', 'curl', 'tricep',
    'shoulder press', 'lateral raise',
    // Seated leg work
    'leg extension', 'seated leg curl', 'leg press',
  ],
  neck: [
    // Pretty much everything except direct neck work
    'bench press', 'squat', 'deadlift', 'row', 'pulldown',
    'curl', 'tricep', 'leg press', 'leg curl',
  ],
  chest: [
    // All non-chest work
    'row', 'pulldown', 'curl', 'tricep pushdown',
    'squat', 'leg press', 'deadlift', 'shoulder press',
    'lateral raise', 'leg curl', 'leg extension',
  ],
};

// ============================================
// CORE RISK ASSESSMENT
// ============================================

/**
 * Determine injury risk for an exercise based on injury area.
 * Uses explicit lists first, then infers from exercise properties.
 */
export function getInjuryRisk(exercise: Exercise, injuryArea: InjuryArea): InjuryRisk {
  const normalizedArea = normalizeInjuryArea(injuryArea);
  const nameLower = exercise.name.toLowerCase();
  const muscleLower = exercise.primaryMuscle.toLowerCase();
  
  // Check explicit avoid list first
  const avoidList = EXPLICIT_AVOID[normalizedArea] || [];
  if (avoidList.some(term => nameLower.includes(term.toLowerCase()))) {
    return 'avoid';
  }
  
  // Check explicit safe list
  const safeList = EXPLICIT_SAFE[normalizedArea] || [];
  if (safeList.some(term => nameLower.includes(term.toLowerCase()))) {
    return 'safe';
  }
  
  // Infer from exercise properties
  return inferInjuryRisk(exercise, normalizedArea);
}

/**
 * Infer injury risk based on exercise properties when not explicitly classified
 */
function inferInjuryRisk(exercise: Exercise, injury: string): InjuryRisk {
  const nameLower = exercise.name.toLowerCase();
  const muscleLower = exercise.primaryMuscle.toLowerCase();
  const mechanic = exercise.mechanic;
  const pattern = exercise.movementPattern?.toLowerCase() || '';
  const equipment = exercise.equipmentRequired?.[0]?.toLowerCase() || '';
  
  switch (injury) {
    case 'lower_back':
      return inferLowerBackRisk(nameLower, muscleLower, mechanic, pattern, equipment);
    case 'upper_back':
      return inferUpperBackRisk(nameLower, muscleLower, mechanic);
    case 'shoulder':
      return inferShoulderRisk(nameLower, muscleLower, mechanic, pattern);
    case 'knee':
      return inferKneeRisk(nameLower, muscleLower, mechanic, pattern);
    case 'hip':
      return inferHipRisk(nameLower, muscleLower, mechanic, pattern);
    case 'elbow':
      return inferElbowRisk(nameLower, muscleLower, mechanic);
    case 'wrist':
      return inferWristRisk(nameLower, equipment, mechanic);
    case 'ankle':
      return inferAnkleRisk(nameLower, muscleLower);
    case 'neck':
      return inferNeckRisk(nameLower);
    case 'chest':
      return inferChestRisk(nameLower, muscleLower);
    default:
      return 'safe';
  }
}

function inferLowerBackRisk(name: string, muscle: string, mechanic: string, pattern: string, equipment: string): InjuryRisk {
  // Hip hinge = spinal loading
  if (pattern.includes('hinge') || name.includes('hinge')) {
    return 'avoid';
  }
  
  // Bent over positions
  if (name.includes('bent') || name.includes('pendlay')) {
    return 'avoid';
  }
  
  // Standing barbell compounds with axial loading
  if (equipment === 'barbell' && (name.includes('squat') || name.includes('deadlift'))) {
    return 'avoid';
  }
  
  // Standing overhead pressing (compressive)
  if (name.includes('standing') && (name.includes('press') || name.includes('ohp'))) {
    return 'caution';
  }
  
  // Carries (core stabilization demand)
  if (name.includes('carry') || name.includes('walk')) {
    return 'caution';
  }
  
  // Machine exercises are generally safer
  if (equipment === 'machine' || name.includes('machine')) {
    return 'safe';
  }
  
  // Isolation work is generally fine
  if (mechanic === 'isolation') {
    return 'safe';
  }
  
  // Supported positions
  if (name.includes('seated') || name.includes('chest supported') || name.includes('lying') || name.includes('incline')) {
    return 'safe';
  }
  
  // Cable work is usually safe
  if (equipment === 'cable' || name.includes('cable')) {
    return 'safe';
  }
  
  return 'safe';
}

function inferUpperBackRisk(name: string, muscle: string, mechanic: string): InjuryRisk {
  // Direct trap work
  if (name.includes('shrug') || name.includes('upright')) {
    return 'avoid';
  }
  
  // Heavy rows can stress upper back
  if (name.includes('row') && mechanic === 'compound') {
    return 'caution';
  }
  
  return 'safe';
}

function inferShoulderRisk(name: string, muscle: string, mechanic: string, pattern: string): InjuryRisk {
  // Overhead pressing = highest risk
  if (name.includes('overhead') || name.includes('military') || pattern.includes('vertical_push')) {
    return 'avoid';
  }
  
  // Horizontal pressing = moderate risk
  if (name.includes('bench') || name.includes('press') && muscle === 'chest') {
    return 'caution';
  }
  
  // Behind neck anything
  if (name.includes('behind') && name.includes('neck')) {
    return 'avoid';
  }
  
  // Dips - shoulder extension under load
  if (name.includes('dip')) {
    return 'avoid';
  }
  
  // Shoulder isolation at low weight is often okay
  if (muscle === 'shoulders' && mechanic === 'isolation') {
    if (name.includes('face pull') || name.includes('external rotation')) {
      return 'safe';  // Actually therapeutic
    }
    return 'caution';
  }
  
  // Pulling is generally shoulder-friendly
  if (pattern.includes('pull') || name.includes('row') || name.includes('pulldown') || name.includes('pull up')) {
    return 'safe';
  }
  
  // Lower body is fine
  if (['quads', 'hamstrings', 'glutes', 'calves'].includes(muscle)) {
    return 'safe';
  }
  
  return 'safe';
}

function inferKneeRisk(name: string, muscle: string, mechanic: string, pattern: string): InjuryRisk {
  // Squat patterns
  if (pattern.includes('squat') || name.includes('squat')) {
    if (name.includes('machine') || name.includes('hack') || name.includes('leg press')) {
      return 'caution';
    }
    return 'avoid';
  }
  
  // Lunge patterns
  if (name.includes('lunge') || name.includes('split squat')) {
    return 'caution';
  }
  
  // Jumping/plyometrics
  if (name.includes('jump') || name.includes('plyo')) {
    return 'avoid';
  }
  
  // Leg extension can be fine with controlled ROM
  if (name.includes('extension') && muscle === 'quads') {
    return 'caution';
  }
  
  // Hip hinge is usually knee-friendly
  if (pattern.includes('hinge') || name.includes('deadlift') || name.includes('rdl')) {
    return 'safe';
  }
  
  // Upper body
  if (['chest', 'back', 'shoulders', 'biceps', 'triceps'].includes(muscle)) {
    return 'safe';
  }
  
  return 'safe';
}

function inferHipRisk(name: string, muscle: string, mechanic: string, pattern: string): InjuryRisk {
  // Direct hip work
  if (name.includes('hip') && (name.includes('abduction') || name.includes('adduction'))) {
    return 'avoid';
  }
  
  // Wide stance movements
  if (name.includes('sumo')) {
    return 'avoid';
  }
  
  // Hip-dominant movements
  if (pattern.includes('hinge') || name.includes('thrust') || name.includes('bridge')) {
    return 'caution';
  }
  
  // Lunges stress the hip flexors
  if (name.includes('lunge') || name.includes('split')) {
    return 'caution';
  }
  
  // Upper body is fine
  if (['chest', 'back', 'shoulders', 'biceps', 'triceps'].includes(muscle)) {
    return 'safe';
  }
  
  return 'safe';
}

function inferElbowRisk(name: string, muscle: string, mechanic: string): InjuryRisk {
  // Direct elbow stress exercises
  if (name.includes('skull') || name.includes('crusher')) {
    return 'avoid';
  }
  
  // Tricep isolation with elbow as fulcrum
  if (muscle === 'triceps' && mechanic === 'isolation') {
    if (name.includes('overhead') || name.includes('extension')) {
      return 'caution';
    }
    // Pushdowns are lower stress
    if (name.includes('pushdown')) {
      return 'safe';
    }
  }
  
  // Bicep curls - usually okay unless very heavy
  if (muscle === 'biceps') {
    return 'caution';
  }
  
  // Chin-ups stress the elbow more than pull-ups
  if (name.includes('chin')) {
    return 'caution';
  }
  
  // Close grip pressing
  if (name.includes('close grip') || name.includes('close-grip')) {
    return 'caution';
  }
  
  // Lower body is fine
  if (['quads', 'hamstrings', 'glutes', 'calves'].includes(muscle)) {
    return 'safe';
  }
  
  return 'safe';
}

function inferWristRisk(name: string, equipment: string, mechanic: string): InjuryRisk {
  // Front rack position
  if (name.includes('front squat') || name.includes('clean') || name.includes('snatch')) {
    return 'avoid';
  }
  
  // Barbell pressing (wrist extension under load)
  if (equipment === 'barbell' && name.includes('press')) {
    return 'caution';
  }
  
  // Push-ups (wrist extension)
  if (name.includes('push-up') || name.includes('pushup')) {
    return 'caution';
  }
  
  // Wrist curls obviously
  if (name.includes('wrist')) {
    return 'avoid';
  }
  
  // Machines and cables are wrist-friendly
  if (equipment === 'machine' || equipment === 'cable' || name.includes('machine') || name.includes('cable')) {
    return 'safe';
  }
  
  return 'safe';
}

function inferAnkleRisk(name: string, muscle: string): InjuryRisk {
  // Calf work
  if (name.includes('calf') || muscle === 'calves') {
    return 'avoid';
  }
  
  // Jumping
  if (name.includes('jump') || name.includes('plyo')) {
    return 'avoid';
  }
  
  // Standing exercises that load the ankle
  if (name.includes('squat') || name.includes('lunge')) {
    return 'caution';
  }
  
  // Upper body is fine
  if (['chest', 'back', 'shoulders', 'biceps', 'triceps'].includes(muscle)) {
    return 'safe';
  }
  
  // Seated leg work is fine
  if (name.includes('seated') || name.includes('lying') || name.includes('leg press')) {
    return 'safe';
  }
  
  return 'safe';
}

function inferNeckRisk(name: string): InjuryRisk {
  // Direct neck work
  if (name.includes('neck') || name.includes('shrug')) {
    return 'avoid';
  }
  
  // Behind neck movements
  if (name.includes('behind') && name.includes('neck')) {
    return 'avoid';
  }
  
  // Upright rows (trap involvement, neck strain)
  if (name.includes('upright')) {
    return 'caution';
  }
  
  return 'safe';
}

function inferChestRisk(name: string, muscle: string): InjuryRisk {
  // Direct chest work
  if (muscle === 'chest') {
    return 'avoid';
  }
  
  // Pressing movements that involve chest
  if (name.includes('bench') || name.includes('fly') || name.includes('flye') || name.includes('crossover')) {
    return 'avoid';
  }
  
  // Dips involve chest
  if (name.includes('dip')) {
    return 'avoid';
  }
  
  // Push-ups
  if (name.includes('push-up') || name.includes('pushup')) {
    return 'avoid';
  }
  
  return 'safe';
}

// ============================================
// FILTERING & ALTERNATIVES
// ============================================

/**
 * Filter exercises for injury safety
 */
export function filterForInjury(
  exercises: Exercise[],
  injuries: InjuryContext[]
): Exercise[] {
  return exercises.filter(ex => {
    for (const injury of injuries) {
      const risk = getInjuryRisk(ex, injury.area);
      // Severity 3 = avoid caution exercises too
      if (risk === 'avoid') return false;
      if (risk === 'caution' && injury.severity >= 3) return false;
    }
    return true;
  });
}

/**
 * Get safe alternatives for an exercise given injuries
 */
export function getSafeAlternatives(
  source: Exercise,
  allExercises: Exercise[],
  injuries: InjuryContext[]
): InjurySafeSwap[] {
  // Get exercises that match the same primary muscle
  const sameMuscle = allExercises.filter(
    ex => ex.id !== source.id && 
          ex.primaryMuscle === source.primaryMuscle &&
          ex.name !== source.name
  );
  
  // Score and filter by safety
  const scored = sameMuscle.map(exercise => {
    let worstRisk: InjuryRisk = 'safe';
    const reasons: string[] = [];
    
    for (const injury of injuries) {
      const risk = getInjuryRisk(exercise, injury.area);
      if (risk === 'avoid') {
        worstRisk = 'avoid';
      } else if (risk === 'caution' && worstRisk !== 'avoid') {
        worstRisk = 'caution';
      }
    }
    
    const matchScore = calculateMatchScore(source, exercise);
    
    return {
      exercise,
      risk: worstRisk,
      matchScore,
      reason: generateSwapReason(source, exercise, injuries),
      safetyNote: getSafetyNote(exercise, injuries, worstRisk),
    };
  });
  
  // Filter based on severity
  const maxSeverity = Math.max(...injuries.map(i => i.severity));
  const filtered = scored.filter(s => {
    if (s.risk === 'avoid') return false;
    if (s.risk === 'caution' && maxSeverity >= 3) return false;
    return true;
  });
  
  // Sort by: safe > caution, then by match score
  filtered.sort((a, b) => {
    if (a.risk === 'safe' && b.risk === 'caution') return -1;
    if (a.risk === 'caution' && b.risk === 'safe') return 1;
    return b.matchScore - a.matchScore;
  });
  
  return filtered.slice(0, 10);
}

function calculateMatchScore(source: Exercise, candidate: Exercise): number {
  let score = 0;
  
  // Same primary muscle (already filtered)
  if (source.primaryMuscle === candidate.primaryMuscle) score += 40;
  
  // Same movement pattern
  if (source.movementPattern === candidate.movementPattern) score += 25;
  
  // Same mechanic
  if (source.mechanic === candidate.mechanic) score += 15;
  
  // Overlapping secondary muscles
  const srcSecondary = source.secondaryMuscles || [];
  const candSecondary = candidate.secondaryMuscles || [];
  const overlap = srcSecondary.filter(m => candSecondary.includes(m)).length;
  score += Math.min(10, overlap * 3);
  
  // Similar rep range
  if (source.defaultRepRange && candidate.defaultRepRange) {
    const [srcMin, srcMax] = source.defaultRepRange;
    const [candMin, candMax] = candidate.defaultRepRange;
    if (Math.abs(srcMin - candMin) <= 2 && Math.abs(srcMax - candMax) <= 2) {
      score += 5;
    }
  }
  
  // Bonus for same hypertrophy tier
  if (source.hypertrophyScore?.tier === candidate.hypertrophyScore?.tier) {
    score += 5;
  }
  
  return Math.min(100, score);
}

function generateSwapReason(source: Exercise, candidate: Exercise, injuries: InjuryContext[]): string {
  const reasons: string[] = [];
  
  if (source.primaryMuscle === candidate.primaryMuscle) {
    reasons.push(`targets ${source.primaryMuscle}`);
  }
  
  const candName = candidate.name.toLowerCase();
  
  // Injury-specific notes
  for (const injury of injuries) {
    const area = normalizeInjuryArea(injury.area);
    
    if (area === 'lower_back') {
      if (candName.includes('machine') || candName.includes('cable')) {
        reasons.push('machine/cable provides back support');
      }
      if (candName.includes('supported') || candName.includes('seated')) {
        reasons.push('supported position protects spine');
      }
      if (candName.includes('pulldown') || candName.includes('pull up')) {
        reasons.push('decompresses the spine');
      }
    }
    
    if (area === 'shoulder') {
      if (candName.includes('row') || candName.includes('pulldown') || candName.includes('pull')) {
        reasons.push('pulling is shoulder-friendly');
      }
      if (candName.includes('face pull')) {
        reasons.push('promotes shoulder health');
      }
    }
    
    if (area === 'knee') {
      if (candName.includes('curl') || candName.includes('hip') || candName.includes('rdl')) {
        reasons.push('hip-dominant, spares knees');
      }
    }
  }
  
  return reasons.length > 0 ? reasons.join('; ') : 'similar exercise';
}

function getSafetyNote(exercise: Exercise, injuries: InjuryContext[], risk: InjuryRisk): string | undefined {
  if (risk === 'safe') return undefined;
  
  return 'Use caution. Start light and stop if pain occurs.';
}

// ============================================
// AUTO-SWAP FOR WORKOUT
// ============================================

export interface AutoSwapResult {
  originalId: string;
  originalName: string;
  replacement: Exercise | null;
  reason: string;
  action: 'swapped' | 'removed';
}

/**
 * Automatically swap or remove exercises based on injuries
 */
export function autoSwapForInjuries(
  workoutExercises: { id: string; exercise: Exercise }[],
  allExercises: Exercise[],
  injuries: InjuryContext[]
): AutoSwapResult[] {
  const results: AutoSwapResult[] = [];
  const maxSeverity = Math.max(...injuries.map(i => i.severity));
  
  for (const { id, exercise } of workoutExercises) {
    let needsSwap = false;
    
    for (const injury of injuries) {
      const risk = getInjuryRisk(exercise, injury.area);
      if (risk === 'avoid') {
        needsSwap = true;
        break;
      }
      if (risk === 'caution' && injury.severity >= 2) {
        needsSwap = true;
        break;
      }
    }
    
    if (needsSwap) {
      const alternatives = getSafeAlternatives(exercise, allExercises, injuries);
      
      // Filter out exercises already in workout
      const usedIds = new Set(workoutExercises.map(w => w.exercise.id));
      const available = alternatives.filter(a => !usedIds.has(a.exercise.id));
      
      if (available.length > 0 && available[0].risk === 'safe') {
        results.push({
          originalId: id,
          originalName: exercise.name,
          replacement: available[0].exercise,
          reason: available[0].reason,
          action: 'swapped',
        });
        usedIds.add(available[0].exercise.id);
      } else {
        results.push({
          originalId: id,
          originalName: exercise.name,
          replacement: null,
          reason: 'No safe alternative for this muscle group',
          action: 'removed',
        });
      }
    }
  }
  
  return results;
}

// ============================================
// UTILITY EXPORTS
// ============================================

export const INJURY_LABELS: Record<string, string> = {
  lower_back: 'Lower Back',
  upper_back: 'Upper Back',
  shoulder: 'Shoulder',
  shoulder_left: 'Left Shoulder',
  shoulder_right: 'Right Shoulder',
  knee: 'Knee',
  knee_left: 'Left Knee',
  knee_right: 'Right Knee',
  hip: 'Hip',
  hip_left: 'Left Hip',
  hip_right: 'Right Hip',
  elbow: 'Elbow',
  elbow_left: 'Left Elbow',
  elbow_right: 'Right Elbow',
  wrist: 'Wrist',
  wrist_left: 'Left Wrist',
  wrist_right: 'Right Wrist',
  ankle: 'Ankle',
  ankle_left: 'Left Ankle',
  ankle_right: 'Right Ankle',
  neck: 'Neck',
  chest: 'Chest',
};

export function getInjuryDescription(injury: InjuryArea): string {
  const normalized = normalizeInjuryArea(injury);
  
  switch (normalized) {
    case 'lower_back':
      return 'Avoids spinal loading and bent-over positions. Favors machines, cables, and supported exercises. Lat pulldowns are safe!';
    case 'upper_back':
      return 'Avoids shrugs and heavy trap work. Most exercises are fine.';
    case 'shoulder':
      return 'Avoids overhead pressing and deep stretches. Pulling movements are generally safe.';
    case 'knee':
      return 'Avoids squats, lunges, and jumping. Hip-dominant movements are safe.';
    case 'hip':
      return 'Avoids wide stances and hip-dominant movements. Knee-dominant work is fine.';
    case 'elbow':
      return 'Avoids heavy tricep extensions and skull crushers. Pushdowns are usually fine.';
    case 'wrist':
      return 'Avoids front rack and heavy pressing. Machines and cables are safe.';
    case 'ankle':
      return 'Avoids calf work and standing lower body. Seated exercises are fine.';
    case 'neck':
      return 'Avoids shrugs and behind-neck movements. Most exercises are fine.';
    case 'chest':
      return 'Avoids pressing and fly movements. Back and lower body work is fine.';
    default:
      return 'Exercise selection will be adjusted for safety.';
  }
}

