/**
 * Smart Macro Calculator v3.2 (Josh edition)
 *
 * Design goals:
 * - Goals expressed as %BW/week
 * - Tiered loss-rate caps by BF% (leaner = slower)
 * - Calories are a hard budget (guardrails reallocate macros inside budget)
 * - Floors: fat + carbs (contextual), clamps: protein (relative to LBM)
 * - Deterministic behavior (no silent calorie creep). If constraints are impossible,
 *   it bumps calories ONLY as a last resort and logs it.
 *
 * v3.2 Changes:
 * - Added Zone 2 cardio prescription when macro floors block desired cut rate
 * - Cardio taps stored body fat WITHOUT reducing dietary nutrients (fat/carbs)
 *   that hormones and brain need to function
 * - Key insight: "eating less" vs "burning more" are NOT equivalent when floors exist
 *   - Eating less → deprives body of essential dietary fat/carbs
 *   - Cardio → burns adipose tissue, preserves dietary intake
 * - Prescription includes: minutes/day, kcal shortfall, net efficiency assumption
 * - Rate comparison trio: target vs diet-only vs with-cardio
 * - Lifestyle mode cap: 45 min/day | Prep mode cap: 90 min/day
 * - User-facing explanation of why cardio ≠ just eating less
 *
 * v3.1 Changes:
 * - Protein floor raised to 1.0 g/lb LBM (was 0.9) - "lifting floor" not "survival floor"
 * - Protein is now PROTECTED - never reduced to meet carb floor
 * - If carbs can't hit floor within budget, calories bump (don't steal from protein)
 * - Peptide multipliers adjusted to 1.05-1.10 range (evidence-based for GLP-1 lean mass loss)
 * - Carb floors scale with training frequency (80/110/130/150g)
 */

export type Goal =
  | "aggressive_cut"
  | "moderate_cut"
  | "slow_cut"
  | "maintain"
  | "slow_bulk"
  | "moderate_bulk"
  | "aggressive_bulk";

export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "active"
  | "very_active"
  | "athlete";

export type Sex = "male" | "female";

export type Peptide =
  | "none"
  | "semaglutide"
  | "tirzepatide"
  | "retatrutide"
  | "liraglutide"
  | "tesofensine"
  | "gh_peptides";

export interface PeptideInfo {
  id: Peptide;
  name: string;
  description: string;
  // Modest bump (1.05-1.10) to offset documented lean mass loss risk
  // Still bounded by protein clamp (0.9-1.2 g/lb LBM)
  proteinMultiplier: number;
  notes: string;
}

export interface UserStats {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
  bodyFatPercent?: number;
}

export interface ActivityConfig {
  activityLevel: ActivityLevel;
  workoutsPerWeek: number;
  avgWorkoutMinutes: number;
  workoutIntensity: "light" | "moderate" | "intense";
}

export interface GoalConfig {
  goal: Goal;
  targetWeightChangePerWeek?: number; // kg/week override
  peptide?: Peptide;
}

// ---------------------- Cardio Prescription Types ----------------------

export type CardioModality = "incline_walk" | "bike" | "elliptical" | "rower";

export interface CardioConfig {
  enabled: boolean;
  
  // "lifestyle" caps cardio lower; "prep" allows more
  mode: "lifestyle" | "prep";
  
  // How much of displayed cardio burn "counts" after compensation (NEAT drop, efficiency)
  // Typical useful range: 0.6–0.75
  netEfficiency?: number; // default 0.65
  
  // Modality affects MET estimate
  modality?: CardioModality; // default incline_walk
  
  // Hard cap (minutes/day) - overrides mode default if set
  maxMinutesPerDay?: number;
}

export interface CardioPrescription {
  needed: boolean;
  prescribedMinutesPerDay: number;
  prescribedMinutesPerWeek: number;
  
  // Energy accounting
  shortfallKcalPerDay: number;
  nominalKcalPerMinute: number;
  assumedNetEfficiency: number;
  
  // Rate comparison
  dietOnlyWeeklyLossLbs: number;
  withCardioWeeklyLossLbs: number;
  targetWeeklyLossLbs: number;
  
  // Safety flags
  hitCap: boolean;
  capMinutesPerDay: number;
  
  // Human-readable explanation
  summary: string;
  whyCardioNotDiet: string;
}

export interface MacroRecommendation {
  // Final macros
  calories: number;
  protein: number;
  carbs: number;
  fat: number;

  // Requested target (pre-guardrail allocation)
  requestedCalories: number;
  requestedWeeklyChangeKg: number;

  // Estimated energy numbers
  tdee: number;
  bmr: number;

  // Final implied deficit/surplus + rate
  deficit: number; // finalCalories - tdee
  weeklyChangeKg: number;
  weeklyChangeLbs: number;

  // Percent splits (final)
  proteinPercent: number;
  carbsPercent: number;
  fatPercent: number;

  explanation: string;
  peptideNotes?: string;
  guardrailsApplied?: string[];
  
  // Cardio prescription when floors block desired cut rate
  cardioPrescription?: CardioPrescription;
}

// ---------------------- Constants ----------------------

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
  athlete: 2.1,
};

// %BW/week goals
const GOAL_PERCENT_BW: Record<Goal, { percentBW: number; description: string }> = {
  aggressive_cut: { percentBW: -0.75, description: "Aggressive cut (~0.75% BW/week)" },
  moderate_cut: { percentBW: -0.5, description: "Moderate cut (~0.5% BW/week)" },
  slow_cut: { percentBW: -0.25, description: "Slow cut (~0.25% BW/week)" },
  maintain: { percentBW: 0, description: "Maintain weight" },
  slow_bulk: { percentBW: 0.25, description: "Lean bulk (~0.25% BW/week)" },
  moderate_bulk: { percentBW: 0.5, description: "Moderate bulk (~0.5% BW/week)" },
  aggressive_bulk: { percentBW: 0.75, description: "Aggressive bulk (~0.75% BW/week)" },
};

const CALORIES_PER_KG = 7700;

const GUARDRAILS = {
  // Tiered max loss (%BW/week)
  LOSS_RATE_BY_BF: [
    { maxBF: 12, maxLossPercent: 0.30 },
    { maxBF: 15, maxLossPercent: 0.35 },
    { maxBF: 20, maxLossPercent: 0.50 },
    { maxBF: 25, maxLossPercent: 0.60 },
    { maxBF: 100, maxLossPercent: 0.75 },
  ],
  DEFAULT_LOSS_RATE_CAP: 0.50,

  // Protein clamps (g/lb LBM)
  // Floor raised to 1.0 - "don't die" is 0.8, "lifting" floor is 1.0
  PROTEIN_MIN_PER_LB_LBM: 1.0,
  PROTEIN_MAX_PER_LB_LBM: 1.2,

  // Fat floor
  MIN_FAT_PER_LB_BW: 0.35,

  // Carb floors (scale with resistance training workload)
  MIN_CARBS_LIGHT: 80,
  MIN_CARBS_LIFT_2_3: 110,
  MIN_CARBS_LIFT_4_5: 130,
  MIN_CARBS_LIFT_6P: 150,

  // Calorie floors
  MIN_CALORIES_MALE: 1500,
  MIN_CALORIES_FEMALE: 1200,
};

// Peptide multipliers adjusted to 1.05-1.10 range
// Evidence supports elevated protein needs on GLP-1s due to accelerated lean mass loss
// Clamp still prevents runaway values
const PEPTIDE_CONFIG: Record<Peptide, PeptideInfo> = {
  none: {
    id: "none",
    name: "None",
    description: "Not using peptides",
    proteinMultiplier: 1.0,
    notes: "",
  },
  semaglutide: {
    id: "semaglutide",
    name: "Semaglutide",
    description: "GLP-1 agonist",
    proteinMultiplier: 1.08,
    notes: "Hit protein reliably; don't chase suppression with deeper deficits.",
  },
  tirzepatide: {
    id: "tirzepatide",
    name: "Tirzepatide",
    description: "GLP-1/GIP dual agonist",
    proteinMultiplier: 1.08,
    notes: "Keep deficits moderate; appetite suppression ≠ CNS tolerance.",
  },
  retatrutide: {
    id: "retatrutide",
    name: "Retatrutide",
    description: "GLP-1/GIP/Glucagon triple agonist",
    proteinMultiplier: 1.10,
    notes: "Most potent suppression; keep deficit sane and carbs non-trivial.",
  },
  liraglutide: {
    id: "liraglutide",
    name: "Liraglutide",
    description: "GLP-1 agonist (daily)",
    proteinMultiplier: 1.07,
    notes: "Keep protein consistent; avoid very low carbs for long stretches.",
  },
  tesofensine: {
    id: "tesofensine",
    name: "Tesofensine",
    description: "Appetite suppressant",
    proteinMultiplier: 1.05,
    notes: "Nutrient density matters; don't let calories drift too low.",
  },
  gh_peptides: {
    id: "gh_peptides",
    name: "GH Peptides",
    description: "Secretagogues",
    proteinMultiplier: 1.05,
    notes: "No special deficit tolerance; keep protein adequate.",
  },
};

// ---------------------- Helpers ----------------------

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

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

export function calculateBMR(stats: UserStats): number {
  if (stats.bodyFatPercent && stats.bodyFatPercent > 0) {
    const leanMassKg = stats.weightKg * (1 - stats.bodyFatPercent / 100);
    return 370 + 21.6 * leanMassKg; // Katch-McArdle
  }
  // Mifflin-St Jeor
  if (stats.sex === "male") {
    return 10 * stats.weightKg + 6.25 * stats.heightCm - 5 * stats.age + 5;
  }
  return 10 * stats.weightKg + 6.25 * stats.heightCm - 5 * stats.age - 161;
}

export function calculateTDEE(stats: UserStats, activity: ActivityConfig): number {
  const bmr = calculateBMR(stats);
  let tdee = bmr * ACTIVITY_MULTIPLIERS[activity.activityLevel];

  // Small "intense" bump to avoid double counting
  if (activity.workoutsPerWeek >= 4 && activity.workoutIntensity === "intense") {
    const met = 8.0;
    const hoursPerWeek = (activity.workoutsPerWeek * activity.avgWorkoutMinutes) / 60;
    const weeklyCalories = met * stats.weightKg * hoursPerWeek;
    tdee += (weeklyCalories / 7) * 0.5;
  }

  return Math.round(tdee);
}

function getLossRateCap(bodyFatPercent?: number): number {
  if (!bodyFatPercent || bodyFatPercent <= 0) return GUARDRAILS.DEFAULT_LOSS_RATE_CAP;
  for (const tier of GUARDRAILS.LOSS_RATE_BY_BF) {
    if (bodyFatPercent <= tier.maxBF) return tier.maxLossPercent;
  }
  return GUARDRAILS.DEFAULT_LOSS_RATE_CAP;
}

function getLeanMassLbs(stats: UserStats): number {
  const bw = kgToLbs(stats.weightKg);
  if (stats.bodyFatPercent && stats.bodyFatPercent > 0) {
    return bw * (1 - stats.bodyFatPercent / 100);
  }
  // fallback estimate (kept simple)
  const est = stats.sex === "male" ? 0.20 : 0.28;
  return bw * (1 - est);
}

function getCarbFloor(activity: ActivityConfig): { grams: number; tag: string } {
  const weeklyMinutes = activity.workoutsPerWeek * activity.avgWorkoutMinutes;
  const isLiftingish = activity.workoutIntensity !== "light" && weeklyMinutes >= 120; // 2h+ /wk at least moderate
  if (!isLiftingish) return { grams: GUARDRAILS.MIN_CARBS_LIGHT, tag: "light activity" };

  const w = activity.workoutsPerWeek;
  if (w >= 6) return { grams: GUARDRAILS.MIN_CARBS_LIFT_6P, tag: "lifting 6+ days/wk" };
  if (w >= 4) return { grams: GUARDRAILS.MIN_CARBS_LIFT_4_5, tag: "lifting 4–5 days/wk" };
  return { grams: GUARDRAILS.MIN_CARBS_LIFT_2_3, tag: "lifting 2–3 days/wk" };
}

/**
 * Allocate macros inside a calorie budget with deterministic reconciliation.
 *
 * Priority order (bodybuilding-focused):
 * 1) Protein is PROTECTED - set at target (clamped), never reduced below floor
 * 2) Fat floor - hormonal health
 * 3) Carb floor - CNS/training support
 * 4) If floors can't be met within budget, bump calories (don't steal from protein)
 *
 * Policy:
 * 1) Set protein (clamped by LBM range) - this is sacred
 * 2) Set fat to floor
 * 3) Put the rest into carbs
 * 4) If carbs < carb floor: bump calories (protein is protected)
 * 5) Recompute fat as remaining calories after P+C, but never below fat floor
 */
function allocateMacros(
  budgetCalories: number,
  stats: UserStats,
  goal: Goal,
  peptide: Peptide,
  activity: ActivityConfig
): {
  protein: number;
  carbs: number;
  fat: number;
  finalCalories: number;
  guardrails: string[];
  bumpedCaloriesBy: number;
} {
  const guardrails: string[] = [];
  const peptideCfg = PEPTIDE_CONFIG[peptide];
  const bwLbs = kgToLbs(stats.weightKg);
  const lbm = getLeanMassLbs(stats);

  const isCut = goal.includes("cut");

  // Protein target (then clamp) - THIS IS PROTECTED
  const base = isCut ? 1.1 : 1.0;
  const requestedPPerLb = base * peptideCfg.proteinMultiplier;

  const pPerLb = clamp(
    requestedPPerLb,
    GUARDRAILS.PROTEIN_MIN_PER_LB_LBM,
    GUARDRAILS.PROTEIN_MAX_PER_LB_LBM
  );

  if (pPerLb !== requestedPPerLb) {
    guardrails.push(`Protein clamped to ${pPerLb.toFixed(2)} g/lb LBM`);
  }

  // Protein is set and protected - no reduction allowed
  const protein = Math.round(lbm * pPerLb);

  const fatFloor = Math.round(bwLbs * GUARDRAILS.MIN_FAT_PER_LB_BW);
  const { grams: carbFloor, tag: carbTag } = getCarbFloor(activity);

  let bumpedCaloriesBy = 0;

  // First pass: fat at floor, carbs are remainder
  let fat = fatFloor;
  let carbs = Math.floor((budgetCalories - protein * 4 - fat * 9) / 4);

  // If carbs too low, bump calories (protein is protected, don't steal from it)
  if (carbs < carbFloor) {
    const bump = (carbFloor - carbs) * 4;
    budgetCalories += bump;
    bumpedCaloriesBy += bump;
    carbs = carbFloor;
    guardrails.push(`Calories +${bump} to meet carb floor (${carbFloor}g, ${carbTag}) while protecting protein`);
  }

  // Recompute fat as remainder after protein + carbs, but not below floor
  const remainingForFat = Math.max(0, budgetCalories - protein * 4 - carbs * 4);
  fat = Math.floor(remainingForFat / 9);

  if (fat < fatFloor) {
    fat = fatFloor;
    guardrails.push(`Fat held at floor (${fatFloor}g)`);
  }

  // Reconcile if fat floor causes calories to exceed budget: trim carbs down to carbFloor
  let finalCalories = protein * 4 + carbs * 4 + fat * 9;

  if (finalCalories > budgetCalories) {
    const over = finalCalories - budgetCalories;
    const reducibleCarbs = Math.max(0, carbs - carbFloor);
    const reducibleCarbCals = reducibleCarbs * 4;

    if (reducibleCarbCals > 0) {
      const reduceBy = Math.min(reducibleCarbs, Math.ceil(over / 4));
      carbs -= reduceBy;
      guardrails.push(`Carbs reduced by ${reduceBy}g to stay within calorie budget`);
      finalCalories = protein * 4 + carbs * 4 + fat * 9;
    }

    // If still over (carbs at floor + fat at floor), bump calories
    if (finalCalories > budgetCalories) {
      const bump = finalCalories - budgetCalories;
      bumpedCaloriesBy += bump;
      guardrails.push(`Calories +${bump} to satisfy fat+carb floors`);
    }
  }

  finalCalories = protein * 4 + carbs * 4 + fat * 9;

  // Defensive: never negative
  const safeCarbs = Math.max(0, carbs);
  const safeProtein = Math.max(0, protein);
  const safeFat = Math.max(0, fat);

  return { protein: safeProtein, carbs: safeCarbs, fat: safeFat, finalCalories, guardrails, bumpedCaloriesBy };
}

// ---------------------- Cardio Prescription ----------------------

/**
 * Estimate Zone 2 calorie burn per minute based on weight and modality.
 * METs are intentionally conservative; adaptive TDEE will correct over time.
 */
function estimateZone2KcalPerMinute(weightKg: number, modality: CardioModality): number {
  const MET: Record<CardioModality, number> = {
    incline_walk: 6.0, // brisk incline walk
    bike: 6.5,         // steady bike
    elliptical: 6.0,   // steady elliptical
    rower: 7.0,        // steady row
  };
  
  // kcal/min = MET * 3.5 * kg / 200
  return (MET[modality] * 3.5 * weightKg) / 200;
}

/**
 * WHY CARDIO ISN'T THE SAME AS EATING LESS:
 * 
 * Dietary fat/carbs → Required for hormone production, brain function, training quality
 * Body fat (adipose) → Stored energy you can burn through activity
 * 
 * When you cut calories below macro floors, you're depriving your body of nutrients
 * it needs to function. But when you add cardio, you're tapping into stored body fat
 * WITHOUT reducing the essential nutrients your hormones and brain need.
 * 
 * This is why "just eat less" has limits, but "eat enough + move more" can safely
 * extend your deficit beyond what diet alone allows.
 */
function prescribeZone2Cardio(params: {
  weightKg: number;
  tdee: number;
  desiredWeeklyChangeKg: number;   // After loss-rate cap (negative for loss)
  achievableWeeklyChangeKg: number; // Implied by final calories (negative for loss)
  caloriesPerKg: number;
  cardio: CardioConfig;
}): CardioPrescription {
  const {
    weightKg,
    desiredWeeklyChangeKg,
    achievableWeeklyChangeKg,
    caloriesPerKg,
    cardio,
  } = params;

  const WHY_CARDIO = 
    "Cutting more calories would mean less dietary fat/carbs, which your hormones and brain need to function. " +
    "Cardio burns stored body fat instead — same deficit, but you're not starving your systems of essential nutrients.";

  if (!cardio.enabled) {
    return {
      needed: false,
      prescribedMinutesPerDay: 0,
      prescribedMinutesPerWeek: 0,
      shortfallKcalPerDay: 0,
      nominalKcalPerMinute: 0,
      assumedNetEfficiency: cardio.netEfficiency ?? 0.65,
      dietOnlyWeeklyLossLbs: Math.abs(achievableWeeklyChangeKg * 2.20462),
      withCardioWeeklyLossLbs: Math.abs(achievableWeeklyChangeKg * 2.20462),
      targetWeeklyLossLbs: Math.abs(desiredWeeklyChangeKg * 2.20462),
      hitCap: false,
      capMinutesPerDay: 0,
      summary: "Cardio prescription disabled.",
      whyCardioNotDiet: WHY_CARDIO,
    };
  }

  // If not cutting, no prescription needed
  if (desiredWeeklyChangeKg >= 0) {
    return {
      needed: false,
      prescribedMinutesPerDay: 0,
      prescribedMinutesPerWeek: 0,
      shortfallKcalPerDay: 0,
      nominalKcalPerMinute: 0,
      assumedNetEfficiency: cardio.netEfficiency ?? 0.65,
      dietOnlyWeeklyLossLbs: 0,
      withCardioWeeklyLossLbs: 0,
      targetWeeklyLossLbs: 0,
      hitCap: false,
      capMinutesPerDay: cardio.maxMinutesPerDay ?? (cardio.mode === "prep" ? 90 : 45),
      summary: "No cardio prescribed (not in a cutting phase).",
      whyCardioNotDiet: WHY_CARDIO,
    };
  }

  // Calculate shortfall between desired and achievable loss rates
  const desiredLossKg = Math.abs(desiredWeeklyChangeKg);
  const achievableLossKg = Math.abs(achievableWeeklyChangeKg);
  const shortfallKgPerWeek = Math.max(0, desiredLossKg - achievableLossKg);

  const shortfallKcalPerWeek = shortfallKgPerWeek * caloriesPerKg;
  const shortfallKcalPerDay = shortfallKcalPerWeek / 7;

  // Deadband: don't prescribe cardio for tiny shortfalls
  const DEADBAND_KCAL_PER_DAY = 50;
  const defaultCap = cardio.mode === "prep" ? 90 : 45;
  const cap = cardio.maxMinutesPerDay ?? defaultCap;

  if (shortfallKcalPerDay < DEADBAND_KCAL_PER_DAY) {
    return {
      needed: false,
      prescribedMinutesPerDay: 0,
      prescribedMinutesPerWeek: 0,
      shortfallKcalPerDay: Math.round(shortfallKcalPerDay),
      nominalKcalPerMinute: 0,
      assumedNetEfficiency: cardio.netEfficiency ?? 0.65,
      dietOnlyWeeklyLossLbs: achievableLossKg * 2.20462,
      withCardioWeeklyLossLbs: achievableLossKg * 2.20462,
      targetWeeklyLossLbs: desiredLossKg * 2.20462,
      hitCap: false,
      capMinutesPerDay: cap,
      summary: "No cardio needed — macro floors already support your selected cut rate.",
      whyCardioNotDiet: WHY_CARDIO,
    };
  }

  // Calculate cardio prescription
  const modality = cardio.modality ?? "incline_walk";
  const nominalKcalPerMin = estimateZone2KcalPerMinute(weightKg, modality);
  const netEff = cardio.netEfficiency ?? 0.65;
  const effectiveKcalPerMin = nominalKcalPerMin * netEff;

  let minutesPerDay = shortfallKcalPerDay / effectiveKcalPerMin;
  const hitCap = minutesPerDay > cap;
  minutesPerDay = Math.min(minutesPerDay, cap);
  const minutesPerWeek = minutesPerDay * 7;

  // Calculate what we can actually achieve with capped cardio
  const actualCardioKcalPerDay = minutesPerDay * effectiveKcalPerMin;
  const actualAdditionalLossKgPerWeek = (actualCardioKcalPerDay * 7) / caloriesPerKg;
  const withCardioLossKg = achievableLossKg + actualAdditionalLossKgPerWeek;

  // Build summary
  const summaryParts: string[] = [];
  summaryParts.push(
    `Macro floors are protecting your hormones and training quality. ` +
    `Diet alone achieves ${(achievableLossKg * 2.20462).toFixed(2)} lb/wk; ` +
    `you selected ${(desiredLossKg * 2.20462).toFixed(2)} lb/wk.`
  );
  summaryParts.push(
    `To close the gap without cutting essential nutrients: ` +
    `${Math.round(minutesPerDay)} min/day Zone 2 ${modality.replace("_", " ")} ` +
    `(${Math.round(minutesPerWeek)} min/week).`
  );
  summaryParts.push(
    `This burns ~${Math.round(shortfallKcalPerDay)} kcal/day from stored body fat ` +
    `(${Math.round(netEff * 100)}% net efficiency assumed).`
  );

  if (hitCap) {
    summaryParts.push(
      `⚠️ Cardio capped at ${cap} min/day (${cardio.mode} mode). ` +
      `To go faster: increase cap, relax a floor, or extend your timeline.`
    );
  }

  return {
    needed: true,
    prescribedMinutesPerDay: Math.round(minutesPerDay),
    prescribedMinutesPerWeek: Math.round(minutesPerWeek),
    shortfallKcalPerDay: Math.round(shortfallKcalPerDay),
    nominalKcalPerMinute: Number(nominalKcalPerMin.toFixed(2)),
    assumedNetEfficiency: netEff,
    dietOnlyWeeklyLossLbs: Number((achievableLossKg * 2.20462).toFixed(2)),
    withCardioWeeklyLossLbs: Number((withCardioLossKg * 2.20462).toFixed(2)),
    targetWeeklyLossLbs: Number((desiredLossKg * 2.20462).toFixed(2)),
    hitCap,
    capMinutesPerDay: cap,
    summary: summaryParts.join(" "),
    whyCardioNotDiet: WHY_CARDIO,
  };
}

// ---------------------- Main ----------------------

export function calculateMacros(
  stats: UserStats,
  activity: ActivityConfig,
  goalConfig: GoalConfig,
  overrideTDEE?: number,
  cardioConfig?: CardioConfig
): MacroRecommendation {
  const bmr = calculateBMR(stats);
  const formulaTDEE = calculateTDEE(stats, activity);
  const tdee = overrideTDEE ?? formulaTDEE;

  const guardrailsApplied: string[] = [];

  const peptide = goalConfig.peptide ?? "none";
  const peptideCfg = PEPTIDE_CONFIG[peptide];

  // Requested weekly change
  const goalDef = GOAL_PERCENT_BW[goalConfig.goal];
  let requestedWeeklyChangeKg =
    goalConfig.targetWeightChangePerWeek !== undefined
      ? goalConfig.targetWeightChangePerWeek
      : stats.weightKg * (goalDef.percentBW / 100);

  // Apply tiered loss-rate cap (only for cuts)
  if (requestedWeeklyChangeKg < 0) {
    const capPct = getLossRateCap(stats.bodyFatPercent);
    const maxLossKg = stats.weightKg * (capPct / 100);
    const reqPct = (Math.abs(requestedWeeklyChangeKg) / stats.weightKg) * 100;

    if (Math.abs(requestedWeeklyChangeKg) > maxLossKg) {
      requestedWeeklyChangeKg = -maxLossKg;
      guardrailsApplied.push(
        `Loss-rate cap applied: ${reqPct.toFixed(2)}% → ${capPct.toFixed(2)}% BW/week` +
          (stats.bodyFatPercent ? ` (BF ${stats.bodyFatPercent}%)` : "")
      );
    }
  }

  // Calories from requested weekly change
  const dailyAdj = (requestedWeeklyChangeKg * CALORIES_PER_KG) / 7;
  let requestedCalories = Math.round(tdee + dailyAdj);

  // Apply calorie floor
  const calFloor = stats.sex === "male" ? GUARDRAILS.MIN_CALORIES_MALE : GUARDRAILS.MIN_CALORIES_FEMALE;
  if (requestedCalories < calFloor) {
    requestedCalories = calFloor;
    guardrailsApplied.push(`Calorie floor applied (${calFloor})`);
  }

  // Allocate macros inside budget
  const alloc = allocateMacros(requestedCalories, stats, goalConfig.goal, peptide, activity);
  guardrailsApplied.push(...alloc.guardrails);

  const { protein, carbs, fat, finalCalories } = alloc;

  // Compute final deficit and implied weekly change
  const deficit = Math.round(finalCalories - tdee);
  const weeklyChangeKg = deficit / (CALORIES_PER_KG / 7);
  const weeklyChangeLbs = weeklyChangeKg * 2.20462;

  const proteinPercent = Math.round(((protein * 4) / finalCalories) * 100);
  const carbsPercent = Math.round(((carbs * 4) / finalCalories) * 100);
  const fatPercent = Math.round(((fat * 9) / finalCalories) * 100);

  const lbm = getLeanMassLbs(stats);
  const pctBW = ((Math.abs(weeklyChangeKg) / stats.weightKg) * 100).toFixed(2);

  let explanation = `TDEE: ${tdee} kcal/day. `;
  if (weeklyChangeKg < -0.05) {
    explanation += `Target loss: ${Math.abs(weeklyChangeLbs).toFixed(2)} lb/wk (${pctBW}% BW). `;
  } else if (weeklyChangeKg > 0.05) {
    explanation += `Target gain: ${weeklyChangeLbs.toFixed(2)} lb/wk. `;
  } else {
    explanation += `Near maintenance. `;
  }
  explanation += `Protein: ${protein}g (${(protein / lbm).toFixed(2)} g/lb LBM).`;

  // Calculate cardio prescription if config provided and we're cutting
  let cardioPrescription: CardioPrescription | undefined;
  
  if (cardioConfig && weeklyChangeKg < 0) {
    cardioPrescription = prescribeZone2Cardio({
      weightKg: stats.weightKg,
      tdee,
      desiredWeeklyChangeKg: requestedWeeklyChangeKg,
      achievableWeeklyChangeKg: weeklyChangeKg,
      caloriesPerKg: CALORIES_PER_KG,
      cardio: cardioConfig,
    });
  }

  return {
    calories: finalCalories,
    protein,
    carbs,
    fat,

    requestedCalories,
    requestedWeeklyChangeKg,

    tdee,
    bmr,

    deficit,
    weeklyChangeKg,
    weeklyChangeLbs,

    proteinPercent,
    carbsPercent,
    fatPercent,

    explanation,
    peptideNotes: peptide !== "none" ? peptideCfg.notes : undefined,
    guardrailsApplied: guardrailsApplied.length ? guardrailsApplied : undefined,
    cardioPrescription,
  };
}

// ---------------------- UI helpers ----------------------

export function getGoalOptions(): Array<{ value: Goal; label: string; description: string }> {
  return [
    { value: "aggressive_cut", label: "Aggressive Cut", description: "~0.75% BW/week (capped by leanness)" },
    { value: "moderate_cut", label: "Moderate Cut", description: "~0.5% BW/week" },
    { value: "slow_cut", label: "Slow Cut", description: "~0.25% BW/week" },
    { value: "maintain", label: "Maintain", description: "Stay at current weight" },
    { value: "slow_bulk", label: "Lean Bulk", description: "~0.25% BW/week" },
    { value: "moderate_bulk", label: "Moderate Bulk", description: "~0.5% BW/week" },
    { value: "aggressive_bulk", label: "Aggressive Bulk", description: "~0.75% BW/week" },
  ];
}

export function getActivityOptions(): Array<{ value: ActivityLevel; label: string; description: string }> {
  return [
    { value: "sedentary", label: "Sedentary", description: "Desk job, little exercise" },
    { value: "light", label: "Lightly Active", description: "Light exercise 1–3 days/week" },
    { value: "moderate", label: "Moderately Active", description: "Moderate exercise 3–5 days/week" },
    { value: "active", label: "Very Active", description: "Hard exercise 6–7 days/week" },
    { value: "very_active", label: "Extremely Active", description: "Very hard exercise + physical job" },
    { value: "athlete", label: "Athlete", description: "Professional/competitive athlete" },
  ];
}

export function getPeptideOptions(): Array<{ value: Peptide; label: string; description: string }> {
  return Object.values(PEPTIDE_CONFIG).map((p) => ({
    value: p.id,
    label: p.name,
    description: p.description,
  }));
}
