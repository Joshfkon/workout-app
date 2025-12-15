/**
 * Smart Macro Calculator
 * 
 * Calculates TDEE (Total Daily Energy Expenditure) and recommended macros
 * based on user stats, goals, and activity level.
 */

export type Goal = 'aggressive_cut' | 'moderate_cut' | 'slow_cut' | 'maintain' | 'slow_bulk' | 'moderate_bulk' | 'aggressive_bulk';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active' | 'athlete';
export type Sex = 'male' | 'female';

// GLP-1 and weight loss peptides
export type Peptide = 
  | 'none'
  | 'semaglutide'      // Ozempic, Wegovy
  | 'tirzepatide'      // Mounjaro, Zepbound
  | 'retatrutide'      // Triple agonist (experimental)
  | 'liraglutide'      // Saxenda
  | 'tesofensine'      // Appetite suppressant
  | 'gh_peptides';     // CJC-1295, Ipamorelin, etc.

export interface PeptideInfo {
  id: Peptide;
  name: string;
  description: string;
  proteinMultiplier: number;  // Increase protein needs
  deficitTolerance: number;   // Can handle larger deficit
  notes: string;
}

export interface UserStats {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
  bodyFatPercent?: number; // Optional - for more accurate calculations
}

export interface ActivityConfig {
  activityLevel: ActivityLevel;
  workoutsPerWeek: number;
  avgWorkoutMinutes: number;
  workoutIntensity: 'light' | 'moderate' | 'intense';
}

export interface GoalConfig {
  goal: Goal;
  targetWeightChangePerWeek?: number; // in kg, negative for loss, positive for gain
  peptide?: Peptide;
}

export interface MacroRecommendation {
  calories: number;
  protein: number; // grams
  carbs: number; // grams
  fat: number; // grams
  proteinPercent: number;
  carbsPercent: number;
  fatPercent: number;
  tdee: number;
  bmr: number;
  deficit: number; // negative = deficit, positive = surplus
  weeklyChange: number; // estimated kg change per week
  explanation: string;
  peptideNotes?: string; // Special notes for peptide users
}

// Activity multipliers for TDEE calculation
const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,      // Little or no exercise
  light: 1.375,        // Light exercise 1-3 days/week
  moderate: 1.55,      // Moderate exercise 3-5 days/week
  active: 1.725,       // Hard exercise 6-7 days/week
  very_active: 1.9,    // Very hard exercise, physical job
  athlete: 2.1,        // Professional athlete level
};

// Goal calorie adjustments
const GOAL_ADJUSTMENTS: Record<Goal, { weeklyKg: number; description: string }> = {
  aggressive_cut: { weeklyKg: -1.0, description: 'Aggressive fat loss (-1kg/week)' },
  moderate_cut: { weeklyKg: -0.5, description: 'Moderate fat loss (-0.5kg/week)' },
  slow_cut: { weeklyKg: -0.25, description: 'Slow fat loss (-0.25kg/week)' },
  maintain: { weeklyKg: 0, description: 'Maintain current weight' },
  slow_bulk: { weeklyKg: 0.25, description: 'Lean bulk (+0.25kg/week)' },
  moderate_bulk: { weeklyKg: 0.5, description: 'Moderate bulk (+0.5kg/week)' },
  aggressive_bulk: { weeklyKg: 0.75, description: 'Aggressive bulk (+0.75kg/week)' },
};

// 1 kg of body weight ≈ 7700 calories
const CALORIES_PER_KG = 7700;

// Peptide configurations
const PEPTIDE_CONFIG: Record<Peptide, PeptideInfo> = {
  none: {
    id: 'none',
    name: 'None',
    description: 'Not using any peptides',
    proteinMultiplier: 1.0,
    deficitTolerance: 1.0,
    notes: '',
  },
  semaglutide: {
    id: 'semaglutide',
    name: 'Semaglutide (Ozempic/Wegovy)',
    description: 'GLP-1 agonist for weight loss',
    proteinMultiplier: 1.25, // 25% more protein
    deficitTolerance: 1.3,   // Can handle 30% larger deficit
    notes: 'Prioritize protein at every meal to prevent muscle loss. Eat protein first.',
  },
  tirzepatide: {
    id: 'tirzepatide',
    name: 'Tirzepatide (Mounjaro/Zepbound)',
    description: 'GLP-1/GIP dual agonist',
    proteinMultiplier: 1.25,
    deficitTolerance: 1.35,
    notes: 'Even stronger appetite suppression. Focus heavily on protein and nutrient density.',
  },
  retatrutide: {
    id: 'retatrutide',
    name: 'Retatrutide',
    description: 'Triple agonist (GLP-1/GIP/Glucagon)',
    proteinMultiplier: 1.3, // 30% more protein
    deficitTolerance: 1.4,
    notes: 'Most potent option. Prioritize 40-50g protein per meal. Consider resistance training.',
  },
  liraglutide: {
    id: 'liraglutide',
    name: 'Liraglutide (Saxenda)',
    description: 'GLP-1 agonist (daily injection)',
    proteinMultiplier: 1.2,
    deficitTolerance: 1.2,
    notes: 'Moderate appetite suppression. Keep protein high to preserve muscle.',
  },
  tesofensine: {
    id: 'tesofensine',
    name: 'Tesofensine',
    description: 'Appetite suppressant (research peptide)',
    proteinMultiplier: 1.15,
    deficitTolerance: 1.25,
    notes: 'Focus on nutrient-dense foods when eating.',
  },
  gh_peptides: {
    id: 'gh_peptides',
    name: 'GH Peptides (CJC-1295, Ipamorelin, etc.)',
    description: 'Growth hormone secretagogues',
    proteinMultiplier: 1.1,
    deficitTolerance: 1.0, // No extra deficit tolerance
    notes: 'Supports muscle retention. Maintain high protein for muscle growth benefits.',
  },
};

/**
 * Calculate BMR using Mifflin-St Jeor equation (most accurate for most people)
 * If body fat is known, uses Katch-McArdle (more accurate for athletes)
 */
export function calculateBMR(stats: UserStats): number {
  if (stats.bodyFatPercent && stats.bodyFatPercent > 0) {
    // Katch-McArdle formula (uses lean body mass)
    const leanMassKg = stats.weightKg * (1 - stats.bodyFatPercent / 100);
    return 370 + (21.6 * leanMassKg);
  }

  // Mifflin-St Jeor formula
  if (stats.sex === 'male') {
    return (10 * stats.weightKg) + (6.25 * stats.heightCm) - (5 * stats.age) + 5;
  } else {
    return (10 * stats.weightKg) + (6.25 * stats.heightCm) - (5 * stats.age) - 161;
  }
}

/**
 * Calculate additional calories burned from workouts
 */
function calculateWorkoutCalories(activity: ActivityConfig, weightKg: number): number {
  // MET values by intensity
  const metValues = {
    light: 3.5,    // Light weight training
    moderate: 5.0, // Moderate weight training
    intense: 8.0,  // Intense weight training/HIIT
  };

  const met = metValues[activity.workoutIntensity];
  const hoursPerWeek = (activity.workoutsPerWeek * activity.avgWorkoutMinutes) / 60;
  const weeklyCalories = met * weightKg * hoursPerWeek;
  
  return Math.round(weeklyCalories / 7); // Daily average
}

/**
 * Calculate TDEE (Total Daily Energy Expenditure)
 */
export function calculateTDEE(stats: UserStats, activity: ActivityConfig): number {
  const bmr = calculateBMR(stats);
  
  // Base TDEE from activity level
  let tdee = bmr * ACTIVITY_MULTIPLIERS[activity.activityLevel];
  
  // Add extra workout calories if activity level doesn't fully account for them
  if (activity.workoutsPerWeek >= 4 && activity.workoutIntensity === 'intense') {
    tdee += calculateWorkoutCalories(activity, stats.weightKg) * 0.5; // Partial addition to avoid double-counting
  }
  
  return Math.round(tdee);
}

/**
 * Calculate protein needs based on goals, body composition, and peptide use
 * Target: ~1g per lb of body weight (2.2g/kg) for most lifters
 * Higher during cuts and when using GLP-1s to preserve muscle
 */
function calculateProtein(stats: UserStats, goal: Goal, peptide: Peptide = 'none'): number {
  const weightKg = stats.weightKg;
  const weightLbs = weightKg * 2.20462;
  const peptideConfig = PEPTIDE_CONFIG[peptide];
  
  // For lifters, use ~1g per lb as baseline (industry standard)
  // Adjust based on goal and body composition
  let proteinPerLb: number;
  
  switch (goal) {
    case 'aggressive_cut':
      // Higher protein during aggressive cut to maximize muscle retention
      proteinPerLb = 1.2; // 1.2g per lb
      break;
    case 'moderate_cut':
      proteinPerLb = 1.1; // 1.1g per lb
      break;
    case 'slow_cut':
    case 'maintain':
      proteinPerLb = 1.0; // 1g per lb (standard recommendation)
      break;
    case 'slow_bulk':
    case 'moderate_bulk':
      proteinPerLb = 1.0; // 1g per lb
      break;
    case 'aggressive_bulk':
      // Slightly less needed when in large surplus
      proteinPerLb = 0.9; // 0.9g per lb
      break;
    default:
      proteinPerLb = 1.0;
  }

  // Apply peptide multiplier (GLP-1s increase protein needs due to muscle loss risk)
  proteinPerLb *= peptideConfig.proteinMultiplier;

  // If body fat is known and high (>25%), base protein on estimated lean mass
  if (stats.bodyFatPercent && stats.bodyFatPercent > 25) {
    const leanMassLbs = weightLbs * (1 - stats.bodyFatPercent / 100);
    // Use 1.2-1.3g per lb of lean mass for higher body fat individuals
    return Math.round(leanMassLbs * 1.25 * peptideConfig.proteinMultiplier);
  }

  return Math.round(weightLbs * proteinPerLb);
}

/**
 * Calculate fat needs (minimum for hormonal health)
 */
function calculateFat(calories: number, stats: UserStats): number {
  // Fat should be 20-35% of calories, minimum 0.5g per kg body weight
  const minFat = stats.weightKg * 0.5;
  const percentFat = 0.25; // 25% of calories
  
  const fatFromCalories = (calories * percentFat) / 9; // 9 calories per gram
  
  return Math.round(Math.max(minFat, fatFromCalories));
}

/**
 * Main function: Calculate complete macro recommendations
 */
export function calculateMacros(
  stats: UserStats,
  activity: ActivityConfig,
  goalConfig: GoalConfig
): MacroRecommendation {
  const bmr = calculateBMR(stats);
  const tdee = calculateTDEE(stats, activity);
  
  // Get peptide configuration
  const peptide = goalConfig.peptide || 'none';
  const peptideConfig = PEPTIDE_CONFIG[peptide];
  
  // Determine weekly weight change target
  const goalAdjustment = GOAL_ADJUSTMENTS[goalConfig.goal];
  let weeklyChangeKg = goalConfig.targetWeightChangePerWeek ?? goalAdjustment.weeklyKg;
  
  // Peptides allow for larger deficits due to appetite suppression
  if (weeklyChangeKg < 0 && peptide !== 'none') {
    weeklyChangeKg *= peptideConfig.deficitTolerance;
    // Cap at -1.5kg/week for safety
    weeklyChangeKg = Math.max(-1.5, weeklyChangeKg);
  }
  
  // Calculate calorie adjustment
  const dailyCalorieAdjustment = (weeklyChangeKg * CALORIES_PER_KG) / 7;
  const targetCalories = Math.round(tdee + dailyCalorieAdjustment);
  
  // Minimum calories for safety
  const minCalories = stats.sex === 'male' ? 1500 : 1200;
  const safeCalories = Math.max(minCalories, targetCalories);
  
  // Calculate macros (with peptide adjustments)
  const protein = calculateProtein(stats, goalConfig.goal, peptide);
  const fat = calculateFat(safeCalories, stats);
  
  // Remaining calories go to carbs
  const proteinCalories = protein * 4;
  const fatCalories = fat * 9;
  const carbCalories = safeCalories - proteinCalories - fatCalories;
  const carbs = Math.max(50, Math.round(carbCalories / 4)); // Minimum 50g carbs
  
  // Recalculate total to account for rounding
  const actualCalories = (protein * 4) + (carbs * 4) + (fat * 9);
  
  // Calculate percentages
  const proteinPercent = Math.round((protein * 4 / actualCalories) * 100);
  const carbsPercent = Math.round((carbs * 4 / actualCalories) * 100);
  const fatPercent = Math.round((fat * 9 / actualCalories) * 100);
  
  // Generate explanation
  let explanation = `Based on your stats, your maintenance calories (TDEE) is ${tdee} cal/day. `;
  
  if (weeklyChangeKg < 0) {
    const weeklyLbs = Math.abs(weeklyChangeKg * 2.20462).toFixed(1);
    explanation += `To lose ~${weeklyLbs} lbs per week, you need a ${Math.abs(Math.round(dailyCalorieAdjustment))} calorie daily deficit. `;
    explanation += `Protein is set high (${protein}g) to preserve muscle during your cut.`;
  } else if (weeklyChangeKg > 0) {
    const weeklyLbs = (weeklyChangeKg * 2.20462).toFixed(1);
    explanation += `To gain ~${weeklyLbs} lbs per week, you need a ${Math.round(dailyCalorieAdjustment)} calorie daily surplus. `;
    explanation += `Protein is set to ${protein}g to support muscle growth.`;
  } else {
    explanation += `These macros will help you maintain your current weight while supporting your training.`;
  }

  // Add peptide-specific notes
  let peptideNotes: string | undefined;
  if (peptide !== 'none') {
    peptideNotes = peptideConfig.notes;
    explanation += ` Adjusted for ${peptideConfig.name}.`;
  }
  
  return {
    calories: actualCalories,
    protein,
    carbs,
    fat,
    proteinPercent,
    carbsPercent,
    fatPercent,
    tdee,
    bmr,
    deficit: Math.round(dailyCalorieAdjustment),
    weeklyChange: weeklyChangeKg,
    explanation,
    peptideNotes,
  };
}

/**
 * Convert weight between units
 */
export function kgToLbs(kg: number): number {
  return kg * 2.20462;
}

export function lbsToKg(lbs: number): number {
  return lbs / 2.20462;
}

export function cmToInches(cm: number): number {
  return cm / 2.54;
}

export function inchesToCm(inches: number): number {
  return inches * 2.54;
}

/**
 * Get goal options for UI
 */
export function getGoalOptions(): Array<{ value: Goal; label: string; description: string }> {
  return [
    { value: 'aggressive_cut', label: 'Aggressive Cut', description: 'Lose ~2 lbs/week' },
    { value: 'moderate_cut', label: 'Moderate Cut', description: 'Lose ~1 lb/week' },
    { value: 'slow_cut', label: 'Slow Cut', description: 'Lose ~0.5 lbs/week' },
    { value: 'maintain', label: 'Maintain', description: 'Stay at current weight' },
    { value: 'slow_bulk', label: 'Lean Bulk', description: 'Gain ~0.5 lbs/week' },
    { value: 'moderate_bulk', label: 'Moderate Bulk', description: 'Gain ~1 lb/week' },
    { value: 'aggressive_bulk', label: 'Aggressive Bulk', description: 'Gain ~1.5 lbs/week' },
  ];
}

/**
 * Get activity level options for UI
 */
export function getActivityOptions(): Array<{ value: ActivityLevel; label: string; description: string }> {
  return [
    { value: 'sedentary', label: 'Sedentary', description: 'Desk job, little exercise' },
    { value: 'light', label: 'Lightly Active', description: 'Light exercise 1-3 days/week' },
    { value: 'moderate', label: 'Moderately Active', description: 'Moderate exercise 3-5 days/week' },
    { value: 'active', label: 'Very Active', description: 'Hard exercise 6-7 days/week' },
    { value: 'very_active', label: 'Extremely Active', description: 'Very hard exercise + physical job' },
    { value: 'athlete', label: 'Athlete', description: 'Professional/competitive athlete' },
  ];
}

/**
 * Get peptide options for UI
 */
export function getPeptideOptions(): Array<{ value: Peptide; label: string; description: string }> {
  return Object.values(PEPTIDE_CONFIG).map(p => ({
    value: p.id,
    label: p.name,
    description: p.description,
  }));
}

