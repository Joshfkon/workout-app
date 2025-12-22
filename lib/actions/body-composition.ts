'use server';

import { createClient } from '@/lib/supabase/server';
import {
  type DEXAScan,
  type DEXAScanInput,
  type UserBodyCompProfile,
  type BodyCompPrediction,
  type PRatioInputs,
  type ScanConditions,
  calculateScanConfidence,
  calculatePRatio,
  predictBodyComposition,
  calibratePRatioFromScans,
  processNewDEXAScan,
  generateBodyCompRecommendations,
  createEmptyProfile,
} from '@/src/lib/body-composition';

// ============================================
// DEXA SCAN ACTIONS
// ============================================

/**
 * Save a new DEXA scan
 */
export async function saveDEXAScan(input: DEXAScanInput): Promise<DEXAScan | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // Calculate confidence based on conditions
  const confidence = calculateScanConfidence(input.conditions);

  // Calculate masses if not provided
  let fatMass = input.fatMass;
  let leanMass = input.leanMass;
  const totalWeight = input.totalWeight;
  const bodyFatPercent = input.bodyFatPercent;

  if (!fatMass) {
    fatMass = totalWeight * (bodyFatPercent / 100);
  }

  if (!leanMass) {
    leanMass = totalWeight - fatMass - (input.boneMass || 0);
  }

  // Check if this is the first scan (baseline)
  const { count } = await supabase
    .from('dexa_scans')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id);

  const isBaseline = count === 0;

  // Check if same provider as previous
  let sameProvider = false;
  if (input.provider) {
    const { data: lastScan } = await supabase
      .from('dexa_scans')
      .select('provider')
      .eq('user_id', user.id)
      .order('scan_date', { ascending: false })
      .limit(1)
      .single();

    sameProvider = lastScan?.provider === input.provider;
  }

  const conditions: ScanConditions = {
    ...input.conditions,
    sameProviderAsPrevious: sameProvider,
  };

  const { data, error } = await supabase
    .from('dexa_scans')
    .insert({
      user_id: user.id,
      scan_date: input.scanDate.toISOString().split('T')[0],
      weight_kg: totalWeight,
      fat_mass_kg: fatMass,
      lean_mass_kg: leanMass,
      body_fat_percent: bodyFatPercent,
      bone_mass_kg: input.boneMass || null,
      regional_data: input.regional || null,
      notes: input.notes || null,
      provider: input.provider || null,
      conditions: conditions,
      is_baseline: isBaseline,
      confidence: confidence,
    })
    .select()
    .single();

  if (error) {
    console.error('Error saving DEXA scan:', error);
    return null;
  }

  // Transform to DEXAScan type
  const scan: DEXAScan = {
    id: data.id,
    userId: data.user_id,
    scanDate: new Date(data.scan_date),
    provider: data.provider,
    totalMassKg: data.weight_kg,
    fatMassKg: data.fat_mass_kg,
    leanMassKg: data.lean_mass_kg,
    boneMineralKg: data.bone_mass_kg,
    bodyFatPercent: data.body_fat_percent,
    fatFreeMassKg: data.lean_mass_kg + (data.bone_mass_kg || 0),
    regional: data.regional_data,
    notes: data.notes,
    scanImageUrl: data.scan_image_url,
    conditions: data.conditions,
    isBaseline: data.is_baseline,
    confidence: data.confidence,
    createdAt: new Date(data.created_at),
  };

  // Update body comp profile with new calibration
  await recalibrateProfile(user.id);

  return scan;
}

/**
 * Get all DEXA scans for the current user
 */
export async function getDEXAScans(): Promise<DEXAScan[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return [];
  }

  const { data, error } = await supabase
    .from('dexa_scans')
    .select('*')
    .eq('user_id', user.id)
    .order('scan_date', { ascending: false });

  if (error || !data) {
    return [];
  }

  return data.map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    scanDate: new Date(row.scan_date),
    provider: row.provider,
    totalMassKg: row.weight_kg,
    fatMassKg: row.fat_mass_kg,
    leanMassKg: row.lean_mass_kg,
    boneMineralKg: row.bone_mass_kg,
    bodyFatPercent: row.body_fat_percent,
    fatFreeMassKg: row.lean_mass_kg + (row.bone_mass_kg || 0),
    regional: row.regional_data,
    notes: row.notes,
    scanImageUrl: row.scan_image_url,
    conditions: row.conditions || {
      timeOfDay: 'morning_fasted',
      hydrationStatus: 'normal',
      recentWorkout: false,
      sameProviderAsPrevious: false,
    },
    isBaseline: row.is_baseline || false,
    confidence: row.confidence || 'medium',
    createdAt: new Date(row.created_at),
  }));
}

/**
 * Get the most recent DEXA scan
 */
export async function getLatestDEXAScan(): Promise<DEXAScan | null> {
  const scans = await getDEXAScans();
  return scans[0] || null;
}

/**
 * Delete a DEXA scan
 */
export async function deleteDEXAScan(scanId: string): Promise<boolean> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return false;
  }

  const { error } = await supabase
    .from('dexa_scans')
    .delete()
    .eq('id', scanId)
    .eq('user_id', user.id);

  if (error) {
    console.error('Error deleting DEXA scan:', error);
    return false;
  }

  // Recalibrate profile after deletion
  await recalibrateProfile(user.id);

  return true;
}

// ============================================
// BODY COMP PROFILE ACTIONS
// ============================================

/**
 * Get user's body composition profile
 */
export async function getBodyCompProfile(): Promise<UserBodyCompProfile | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // Get profile
  const { data: profile } = await (
    supabase.from('body_comp_profiles') as ReturnType<typeof supabase.from>
  )
    .select('*')
    .eq('user_id', user.id)
    .single();

  // Get scans
  const scans = await getDEXAScans();

  if (!profile) {
    // Return empty profile with scans
    const emptyProfile = createEmptyProfile(user.id);
    emptyProfile.scans = scans;
    return emptyProfile;
  }

  return {
    userId: profile.user_id,
    scans,
    learnedPRatio: profile.learned_p_ratio,
    pRatioConfidence: profile.p_ratio_confidence,
    pRatioDataPoints: profile.p_ratio_data_points,
    proteinModifier: profile.protein_modifier,
    trainingModifier: profile.training_modifier,
    deficitModifier: profile.deficit_modifier,
    trainingAge: profile.training_age,
    isEnhanced: profile.is_enhanced,
    lastUpdated: new Date(profile.updated_at),
  };
}

/**
 * Update body composition profile settings
 */
export async function updateBodyCompProfile(updates: {
  trainingAge?: 'beginner' | 'intermediate' | 'advanced';
  isEnhanced?: boolean;
}): Promise<boolean> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return false;
  }

  const { error } = await (
    supabase.from('body_comp_profiles') as ReturnType<typeof supabase.from>
  ).upsert(
    {
      user_id: user.id,
      training_age: updates.trainingAge,
      is_enhanced: updates.isEnhanced,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: 'user_id',
    }
  );

  return !error;
}

/**
 * Recalibrate profile based on current DEXA scans
 */
async function recalibrateProfile(userId: string): Promise<void> {
  const supabase = await createClient();

  // Get all scans
  const { data: scansData } = await supabase
    .from('dexa_scans')
    .select('*')
    .eq('user_id', userId)
    .order('scan_date', { ascending: true });

  if (!scansData || scansData.length < 2) {
    return;
  }

  // Transform to DEXAScan type
  const scans: DEXAScan[] = scansData.map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    scanDate: new Date(row.scan_date),
    provider: row.provider,
    totalMassKg: row.weight_kg,
    fatMassKg: row.fat_mass_kg,
    leanMassKg: row.lean_mass_kg,
    boneMineralKg: row.bone_mass_kg,
    bodyFatPercent: row.body_fat_percent,
    fatFreeMassKg: row.lean_mass_kg + (row.bone_mass_kg || 0),
    regional: row.regional_data,
    notes: row.notes,
    scanImageUrl: row.scan_image_url,
    conditions: row.conditions || {
      timeOfDay: 'morning_fasted',
      hydrationStatus: 'normal',
      recentWorkout: false,
      sameProviderAsPrevious: false,
    },
    isBaseline: row.is_baseline || false,
    confidence: row.confidence || 'medium',
    createdAt: new Date(row.created_at),
  }));

  // Calibrate P-ratio
  const calibration = calibratePRatioFromScans(scans);

  if (!calibration) {
    return;
  }

  // Update profile
  await (supabase.from('body_comp_profiles') as ReturnType<typeof supabase.from>).upsert(
    {
      user_id: userId,
      learned_p_ratio: calibration.learnedPRatio,
      p_ratio_confidence: calibration.confidence,
      p_ratio_data_points: calibration.dataPoints,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: 'user_id',
    }
  );
}

// ============================================
// PREDICTION ACTIONS
// ============================================

/**
 * Get P-ratio inputs from user's recent data
 */
async function getPRatioInputsFromUserData(
  userId: string,
  latestScan: DEXAScan,
  profile: UserBodyCompProfile
): Promise<PRatioInputs> {
  const supabase = await createClient();

  // Get user profile for sex
  const { data: userProfile } = await supabase
    .from('users')
    .select('sex')
    .eq('id', userId)
    .single();

  // Get recent nutrition data (last 14 days)
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  const { data: nutritionLogs } = await supabase
    .from('food_log')
    .select('protein, calories')
    .eq('user_id', userId)
    .gte('logged_at', twoWeeksAgo.toISOString().split('T')[0]);

  // Get recent workout data
  const { data: workoutData } = await supabase
    .from('workout_sessions')
    .select(`
      id,
      exercise_blocks!inner (
        id,
        set_logs!inner (
          id,
          is_warmup
        )
      )
    `)
    .eq('user_id', userId)
    .eq('state', 'completed')
    .gte('completed_at', twoWeeksAgo.toISOString());

  // Get nutrition targets for deficit calculation
  const { data: nutritionTargets } = await supabase
    .from('nutrition_targets')
    .select('calories')
    .eq('user_id', userId)
    .single();

  // Get TDEE estimate if available
  const { data: tdeeEstimate } = await (
    supabase.from('tdee_estimates') as ReturnType<typeof supabase.from>
  )
    .select('estimated_tdee')
    .eq('user_id', userId)
    .single();

  // Calculate averages
  let avgDailyProtein = 150; // Default
  let avgDailyCalories = 2000; // Default

  if (nutritionLogs && nutritionLogs.length > 0) {
    const totalProtein = nutritionLogs.reduce((sum, log) => sum + (log.protein || 0), 0);
    const totalCalories = nutritionLogs.reduce((sum, log) => sum + (log.calories || 0), 0);
    const days = Math.min(14, nutritionLogs.length);
    avgDailyProtein = totalProtein / days;
    avgDailyCalories = totalCalories / days;
  }

  // Calculate weekly sets
  let avgWeeklySets = 60; // Default
  if (workoutData && workoutData.length > 0) {
    let totalSets = 0;
    workoutData.forEach((session: any) => {
      session.exercise_blocks?.forEach((block: any) => {
        const workingSets = block.set_logs?.filter((s: any) => !s.is_warmup) || [];
        totalSets += workingSets.length;
      });
    });
    avgWeeklySets = Math.round(totalSets / 2); // 2 weeks of data
  }

  // Calculate deficit
  const tdee = tdeeEstimate?.estimated_tdee || 2500;
  const targetCalories = nutritionTargets?.calories || avgDailyCalories;
  const deficit = tdee - targetCalories;
  const deficitPercent = (deficit / tdee) * 100;

  // Calculate protein per kg
  const avgProteinPerKg = avgDailyProtein / latestScan.totalMassKg;

  return {
    avgDailyProteinGrams: avgDailyProtein,
    avgDailyProteinPerKgBW: avgProteinPerKg,
    avgWeeklyTrainingSets: avgWeeklySets,
    avgDailyDeficitCals: Math.max(0, deficit),
    deficitPercent: Math.max(0, deficitPercent),
    currentBodyFatPercent: latestScan.bodyFatPercent,
    currentLeanMassKg: latestScan.leanMassKg,
    trainingAge: profile.trainingAge,
    isEnhanced: profile.isEnhanced,
    biologicalSex: (userProfile?.sex as 'male' | 'female') || 'male',
    personalPRatioHistory: profile.learnedPRatio ? [profile.learnedPRatio] : undefined,
  };
}

/**
 * Generate body composition prediction for a target weight
 */
export async function generatePrediction(
  targetWeight: number
): Promise<{
  prediction: BodyCompPrediction;
  recommendations: ReturnType<typeof generateBodyCompRecommendations>;
  pRatioInputs: PRatioInputs;
} | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // Get profile and latest scan
  const profile = await getBodyCompProfile();
  if (!profile) {
    return null;
  }

  const latestScan = await getLatestDEXAScan();
  if (!latestScan) {
    return null;
  }

  // Get P-ratio inputs
  const pRatioInputs = await getPRatioInputsFromUserData(user.id, latestScan, profile);

  // Calculate P-ratio factors
  const pRatioFactors = calculatePRatio(pRatioInputs);

  // Generate prediction
  const prediction = predictBodyComposition(
    latestScan,
    targetWeight,
    pRatioFactors,
    profile
  );

  // Update prediction with actual assumptions
  prediction.assumptions = {
    avgDailyDeficit: pRatioInputs.avgDailyDeficitCals,
    avgDailyProtein: pRatioInputs.avgDailyProteinGrams,
    avgWeeklyVolume: pRatioInputs.avgWeeklyTrainingSets,
    pRatioUsed: pRatioFactors.finalPRatio,
  };

  // Generate recommendations
  const recommendations = generateBodyCompRecommendations(pRatioFactors, pRatioInputs);

  return {
    prediction,
    recommendations,
    pRatioInputs,
  };
}

/**
 * Save a prediction for later comparison
 */
export async function savePrediction(
  prediction: BodyCompPrediction,
  sourceScanId: string
): Promise<boolean> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return false;
  }

  // Mark previous active predictions as inactive
  await (supabase.from('body_comp_predictions') as ReturnType<typeof supabase.from>)
    .update({ is_active: false })
    .eq('user_id', user.id)
    .eq('is_active', true);

  // Save new prediction
  const { error } = await (
    supabase.from('body_comp_predictions') as ReturnType<typeof supabase.from>
  ).insert({
    user_id: user.id,
    source_scan_id: sourceScanId,
    target_date: prediction.targetDate.toISOString().split('T')[0],
    target_weight: prediction.targetWeight,
    predicted_fat_mass: prediction.predictedFatMass,
    predicted_lean_mass: prediction.predictedLeanMass,
    predicted_body_fat_percent: prediction.predictedBodyFatPercent,
    fat_mass_range: prediction.fatMassRange,
    lean_mass_range: prediction.leanMassRange,
    body_fat_range: prediction.bodyFatPercentRange,
    confidence_level: prediction.confidenceLevel,
    confidence_factors: prediction.confidenceFactors,
    assumptions: prediction.assumptions,
    is_active: true,
  });

  return !error;
}

/**
 * Get active prediction
 */
export async function getActivePrediction(): Promise<BodyCompPrediction | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data } = await (
    supabase.from('body_comp_predictions') as ReturnType<typeof supabase.from>
  )
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single();

  if (!data) {
    return null;
  }

  return {
    targetDate: new Date(data.target_date),
    targetWeight: data.target_weight,
    predictedFatMass: data.predicted_fat_mass,
    predictedLeanMass: data.predicted_lean_mass,
    predictedBodyFatPercent: data.predicted_body_fat_percent,
    fatMassRange: data.fat_mass_range,
    leanMassRange: data.lean_mass_range,
    bodyFatPercentRange: data.body_fat_range,
    confidenceLevel: data.confidence_level,
    confidenceFactors: data.confidence_factors,
    assumptions: data.assumptions,
  };
}
