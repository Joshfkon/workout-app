// ============================================================
// ENHANCED ATHLETE MODE — persistence + mid-mesocycle regeneration
//
// The flag itself lives on users.enhanced_athlete_mode (a physiological
// profile fact, alongside sex/height/experience). This module owns:
//
//   1. persistEnhancedAthleteMode — writes the users row and keeps the
//      adaptive-volume profile (user_volume_profiles) in sync via the
//      per-landmark rescale in setEnhancedStatus.
//   2. getActiveMesocycle — the mid-meso prompt only appears when one exists.
//   3. regenerateRemainingWeeksForEnhancedMode — the "Adjust remaining
//      weeks" path. Regenerates program_data from the LIVE profile + the new
//      flag (never from already-adjusted values, so repeated toggles are
//      idempotent), preserves the in-flight week's plan when the week has
//      already started, and stamps generated_with_enhanced_mode so in-flight
//      weekly progression follows the plan's mode, not the live flag.
//
// "Apply at next mesocycle" needs no code path here beyond persisting the
// flag: generation reads users.enhanced_athlete_mode, and the current meso
// keeps its old generated_with_enhanced_mode tag.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DexaRegionalData,
  DexaScan,
  Equipment,
  Experience,
  ExtendedUserProfile,
  FullProgramRecommendation,
  Goal,
  MuscleGroup,
  Rating,
} from '@/types/schema';
import { generateFullMesocycleWithFatigue } from '@/services/sessionBuilderWithFatigue';
import { calculateRecoveryFactors } from '@/services/mesocycleBuilder';
import { analyzeRegionalComposition } from '@/services/regionalAnalysis';
import { setEnhancedStatus, type UserVolumeProfile } from '@/src/lib/training/adaptive-volume';

/** The fields of the active mesocycle the toggle flow needs. */
export interface ActiveMesocycleRow {
  id: string;
  name: string;
  current_week: number;
  total_weeks: number;
  deload_week: number;
  days_per_week: number;
  session_duration_minutes: number | null;
  program_data: unknown;
}

/** Returns the user's active mesocycle, or null when none is in flight. */
export async function getActiveMesocycle(
  supabase: SupabaseClient,
  userId: string
): Promise<ActiveMesocycleRow | null> {
  const { data, error } = await supabase
    .from('mesocycles')
    .select(
      'id, name, current_week, total_weeks, deload_week, days_per_week, session_duration_minutes, program_data'
    )
    .eq('user_id', userId)
    .eq('state', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('getActiveMesocycle failed:', error);
    return null;
  }
  return (data as ActiveMesocycleRow) ?? null;
}

/**
 * Persist the flag to the users row and keep the adaptive-volume profile's
 * learned MEV/MRV estimates in sync (differentiated per-landmark rescale).
 */
export async function persistEnhancedAthleteMode(
  supabase: SupabaseClient,
  userId: string,
  enhancedAthleteMode: boolean
): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ enhanced_athlete_mode: enhancedAthleteMode })
    .eq('id', userId);
  if (error) throw error;

  // Sync the adaptive-volume subsystem (best effort — the users row is the
  // source of truth; the volume profile just mirrors it for its estimates).
  try {
    const { data: profileRow } = await supabase
      .from('user_volume_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileRow && (profileRow.is_enhanced ?? false) !== enhancedAthleteMode) {
      const profile: UserVolumeProfile = {
        userId: profileRow.user_id,
        updatedAt: new Date(profileRow.updated_at),
        muscleTolerance: profileRow.muscle_tolerance || {},
        globalRecoveryMultiplier: profileRow.global_recovery_multiplier || 1.0,
        isEnhanced: profileRow.is_enhanced || false,
        trainingAge: profileRow.training_age || 'intermediate',
      };
      const updated = setEnhancedStatus(profile, enhancedAthleteMode);
      await supabase.from('user_volume_profiles').upsert({
        user_id: updated.userId,
        muscle_tolerance: updated.muscleTolerance,
        global_recovery_multiplier: updated.globalRecoveryMultiplier,
        is_enhanced: updated.isEnhanced,
        training_age: updated.trainingAge,
        updated_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('Failed to sync user_volume_profiles enhanced status:', err);
  }
}

/**
 * "Adjust remaining weeks": regenerate the active mesocycle's plan under the
 * new mode. Completed weeks and logged data are untouched (reads only index
 * the current week forward). If the current week has already started, its
 * plan is carried over verbatim from the existing program so changes apply
 * from next week. total_weeks / deload_week stay as the user set them — the
 * +1 accumulation-week default only applies to newly generated mesocycles.
 *
 * Idempotent: the plan is always rebuilt from the live profile + flag, and
 * the carried-over week is copied (never rescaled), so on→adjust→off→adjust
 * within the same week converges instead of compounding.
 */
export async function regenerateRemainingWeeksForEnhancedMode(
  supabase: SupabaseClient,
  userId: string,
  mesocycle: ActiveMesocycleRow,
  enhancedAthleteMode: boolean
): Promise<void> {
  // Live profile inputs (same sources as mesocycle creation/regeneration).
  const [{ data: userProfile }, { data: userData }, { data: dexaScans }] = await Promise.all([
    supabase.from('user_profiles').select('goal, experience').eq('user_id', userId).single(),
    supabase.from('users').select('*').eq('id', userId).single(),
    supabase
      .from('dexa_scans')
      .select('*')
      .eq('user_id', userId)
      .order('scan_date', { ascending: false })
      .limit(1),
  ]);

  const latestDexa: DexaScan | null = dexaScans?.[0]
    ? {
        id: dexaScans[0].id,
        userId: dexaScans[0].user_id,
        scanDate: dexaScans[0].scan_date,
        weightKg: dexaScans[0].weight_kg,
        leanMassKg: dexaScans[0].lean_mass_kg,
        fatMassKg: dexaScans[0].fat_mass_kg,
        bodyFatPercent: dexaScans[0].body_fat_percent,
        boneMassKg: dexaScans[0].bone_mass_kg || null,
        regionalData: dexaScans[0].regional_data || null,
        notes: dexaScans[0].notes || null,
        createdAt: dexaScans[0].created_at,
      }
    : null;

  const extendedProfile: ExtendedUserProfile = {
    age: userData?.age || 30,
    experience: ((userData?.experience || userProfile?.experience) as Experience) || 'intermediate',
    goal: ((userProfile?.goal || userData?.goal) as Goal) || 'maintenance',
    sleepQuality: (userData?.sleep_quality as Rating) || 3,
    stressLevel: (userData?.stress_level as Rating) || 3,
    trainingAge: userData?.training_age_years || 1,
    availableEquipment:
      (userData?.available_equipment as Equipment[]) ||
      ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'],
    injuryHistory: (userData?.injury_history as MuscleGroup[]) || [],
    heightCm: userData?.height_cm || null,
    latestDexa,
    enhancedAthleteMode,
  };

  let laggingAreas: string[] = [];
  if (latestDexa?.regionalData && latestDexa.leanMassKg) {
    laggingAreas = analyzeRegionalComposition(
      latestDexa.regionalData as DexaRegionalData,
      latestDexa.leanMassKg
    ).laggingAreas;
  }

  const newProgram = generateFullMesocycleWithFatigue(
    mesocycle.days_per_week,
    extendedProfile,
    mesocycle.session_duration_minutes || 60,
    laggingAreas,
    []
  );

  // Mid-week? Carry the in-flight week's plan over so prescriptions the user
  // is mid-way through don't shift under them; changes start next week.
  const { count: completedCount } = await supabase
    .from('workout_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('mesocycle_id', mesocycle.id)
    .eq('state', 'completed');

  const sessionsIntoCurrentWeek = (completedCount ?? 0) % Math.max(1, mesocycle.days_per_week);
  if (sessionsIntoCurrentWeek > 0) {
    const oldProgram = mesocycle.program_data as FullProgramRecommendation | null;
    const weekIdx = mesocycle.current_week - 1;
    const oldWeek = oldProgram?.mesocycleWeeks?.[weekIdx];
    if (oldWeek && newProgram.mesocycleWeeks?.[weekIdx]) {
      newProgram.mesocycleWeeks[weekIdx] = oldWeek;
    }
  }

  const recoveryFactors = calculateRecoveryFactors(extendedProfile);

  const { error: updateError } = await supabase
    .from('mesocycles')
    .update({
      program_data: newProgram,
      fatigue_budget_config: newProgram?.fatigueBudget || null,
      volume_per_muscle: newProgram?.volumePerMuscle || null,
      periodization_model: newProgram?.periodization?.model || 'linear',
      recovery_multiplier: recoveryFactors?.volumeMultiplier || 1.0,
      generated_with_enhanced_mode: enhancedAthleteMode,
    })
    .eq('id', mesocycle.id);

  if (updateError) throw updateError;
}
