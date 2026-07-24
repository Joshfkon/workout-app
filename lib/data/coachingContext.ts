/**
 * Coaching Context Service
 *
 * Aggregates user data from multiple sources to build a comprehensive
 * coaching context for AI-powered personalized training advice.
 */

import { createClient } from '@/lib/supabase/server';
import { estimateE1RM, getLocalDateString } from '@/lib/utils';
import type { CoachingContext, RecentLift, PhaseType } from '@/types/coaching';
import type {
  UserRow,
  TrainingPhaseRow,
  BodyweightEntryRow,
  DexaScanRow,
  MesocycleRow,
  CalibratedLiftRow,
  SetLogRow,
} from '@/types/database-queries';

/** User preferences row from database */
interface UserPreferencesRow {
  user_id: string;
  coaching?: {
    primaryGoal?: string;
  };
}

/** Convert database phase type to PhaseType (maintenance -> maintain) */
function toPhaseType(dbPhaseType: string): PhaseType {
  if (dbPhaseType === 'maintenance') return 'maintain';
  return dbPhaseType as PhaseType;
}

/** Workout session with exercise blocks for coaching context */
interface WorkoutSessionWithBlocks {
  id: string;
  planned_date: string;
  exercise_blocks: Array<{
    exercise_name: string;
    exercises?: { exercise_type?: string | null } | null;
    set_logs: Array<Pick<SetLogRow, 'weight_kg' | 'reps' | 'rpe' | 'is_warmup'>>;
  }>;
}

/**
 * Builds a complete coaching context for the current user
 *
 * Aggregates data from:
 * - User profile (age, sex, height, training age)
 * - Active training phase (cut/bulk/maintain)
 * - Body composition (weight, DEXA scans)
 * - Active mesocycle (training block)
 * - Recent workout performance
 *
 * @returns CoachingContext with all available user data, or null if user not found
 */
export async function buildCoachingContext(): Promise<CoachingContext | null> {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) {
      console.log('[CoachingContext] No authenticated user');
      return null;
    }

    // Fetch user profile
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single();

    if (userError) {
      console.error('[CoachingContext] Error fetching user:', userError.message);
      return null;
    }

    if (!userData) {
      console.log('[CoachingContext] No user data found');
      return null;
    }
    const user = userData as UserRow;

  // Calculate age from birth_date
  const age = user.birth_date
    ? new Date().getFullYear() - new Date(user.birth_date).getFullYear()
    : 30; // Default if not set

  // Get active training phase
  const { data: phaseData } = await supabase
    .from('training_phases')
    .select('*')
    .eq('user_id', authUser.id)
    .eq('is_active', true)
    .single();

  const phase = phaseData as TrainingPhaseRow | null;

  // Get most recent bodyweight
  const { data: recentWeight } = await supabase
    .from('bodyweight_entries')
    .select('weight_kg, date')
    .eq('user_id', authUser.id)
    .order('date', { ascending: false })
    .limit(1)
    .single();

  const latestWeight = recentWeight as Pick<BodyweightEntryRow, 'weight_kg' | 'date'> | null;

  // Get bodyweight trend (last 2 weeks)
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const { data: recentWeights } = await supabase
    .from('bodyweight_entries')
    .select('weight_kg, date')
    .eq('user_id', authUser.id)
    .gte('date', getLocalDateString(twoWeeksAgo))
    .order('date', { ascending: true });

  const weights = recentWeights as Pick<BodyweightEntryRow, 'weight_kg' | 'date'>[] | null;

  // Calculate weight trend
  let weightTrend: 'increasing' | 'stable' | 'decreasing' | undefined;
  if (weights && weights.length >= 3) {
    const firstWeight = weights[0].weight_kg;
    const lastWeight = weights[weights.length - 1].weight_kg;
    const diff = lastWeight - firstWeight;
    const percentChange = (diff / firstWeight) * 100;

    if (percentChange > 0.5) weightTrend = 'increasing';
    else if (percentChange < -0.5) weightTrend = 'decreasing';
    else weightTrend = 'stable';
  }

  // Get most recent DEXA scan
  const { data: dexaData } = await supabase
    .from('dexa_scans')
    .select('*')
    .eq('user_id', authUser.id)
    .order('scan_date', { ascending: false })
    .limit(1)
    .single();

  const dexa = dexaData as DexaScanRow | null;

  // Get active mesocycle
  const { data: mesocycleData } = await supabase
    .from('mesocycles')
    .select('*')
    .eq('user_id', authUser.id)
    .eq('state', 'active')
    .single();

  const mesocycle = mesocycleData as MesocycleRow | null;

  // Get strength calibrations (from coaching system)
  const { data: calibrationsData } = await supabase
    .from('calibrated_lifts')
    .select('*')
    .eq('user_id', authUser.id)
    .order('tested_at', { ascending: false });

  const calibrations = (calibrationsData as CalibratedLiftRow[] | null) || [];

  // Get user preferences/goals
  const { data: prefsData } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', authUser.id)
    .single();

  const prefs = prefsData as UserPreferencesRow | null;

  // Get recent lift performance (last 30 days, top sets only)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: recentSessions } = await supabase
    .from('workout_sessions')
    .select(`
      id,
      planned_date,
      exercise_blocks (
        exercise_name,
        exercises (
          exercise_type
        ),
        set_logs (
          weight_kg,
          reps,
          rpe,
          is_warmup
        )
      )
    `)
    .eq('user_id', authUser.id)
    .eq('state', 'completed')
    .gte('planned_date', getLocalDateString(thirtyDaysAgo))
    .order('planned_date', { ascending: false })
    .limit(20);

  const sessions = recentSessions as WorkoutSessionWithBlocks[] | null;

  // Process recent lifts to get top sets per exercise
  const recentLifts: RecentLift[] = [];
  const exerciseTopSets = new Map<string, RecentLift>();

  if (sessions) {
    for (const session of sessions) {
      if (!session.exercise_blocks) continue;

      for (const block of session.exercise_blocks) {
        if (!block.set_logs || block.set_logs.length === 0) continue;

        // Get top working set (non-warmup, highest weight, valid data)
        type SetLogSubset = Pick<SetLogRow, 'weight_kg' | 'reps' | 'rpe' | 'is_warmup'>;
        const workingSets = block.set_logs.filter(
          (set: SetLogSubset) => !set.is_warmup &&
                        set.weight_kg != null &&
                        set.weight_kg > 0 &&
                        set.reps != null &&
                        set.reps > 0
        );

        if (workingSets.length === 0) continue;

        // Duration exercises store seconds in reps: their top set is the
        // longest hold and they carry NO e1RM (Epley on seconds is fiction).
        const isDuration = block.exercises?.exercise_type === 'duration_based';

        const topSet = workingSets.reduce((best: SetLogSubset, current: SetLogSubset) => {
          if (isDuration) {
            return (current.reps || 0) > (best.reps || 0) ? current : best;
          }
          const currentWeight = current.weight_kg || 0;
          const currentReps = current.reps || 0;
          const bestWeight = best.weight_kg || 0;
          const bestReps = best.reps || 0;
          const currentE1RM = estimateE1RM(currentWeight, currentReps);
          const bestE1RM = estimateE1RM(bestWeight, bestReps);
          return currentE1RM > bestE1RM ? current : best;
        });

        if (!topSet.weight_kg || !topSet.reps) continue;

        const estimated1RM = isDuration ? 0 : estimateE1RM(topSet.weight_kg, topSet.reps);

        const lift: RecentLift = {
          exerciseName: block.exercise_name,
          date: session.planned_date,
          topSetWeight: topSet.weight_kg,
          topSetReps: topSet.reps,
          topSetRpe: topSet.rpe || 0,
          estimated1RM,
          ...(isDuration ? { isDuration: true } : {}),
        };

        // Keep most recent top set per exercise
        const existing = exerciseTopSets.get(block.exercise_name);
        if (!existing || new Date(lift.date) > new Date(existing.date)) {
          exerciseTopSets.set(block.exercise_name, lift);
        }
      }
    }

    // Convert map to array and sort by date
    recentLifts.push(...Array.from(exerciseTopSets.values()));
    recentLifts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  // Process calibrated lifts (convert null to undefined for type compatibility)
  const calibratedLifts = calibrations.map((cal: CalibratedLiftRow) => ({
    liftName: cal.lift_name,
    estimated1RM: cal.estimated_1rm,
    testedWeight: cal.tested_weight_kg,
    testedReps: cal.tested_reps,
    percentileVsTrained: cal.percentile_vs_trained ?? undefined,
    strengthLevel: cal.strength_level ?? undefined,
    testedAt: cal.tested_at,
  }));

  // Calculate FFMI if we have the data
  let ffmi: number | undefined;
  if (dexa?.lean_mass_kg && user.height_cm) {
    const heightM = user.height_cm / 100;
    ffmi = dexa.lean_mass_kg / (heightM * heightM);
  }

  // Build coaching context
  const context: CoachingContext = {
    user: {
      name: authUser.email?.split('@')[0] || 'User',
      age,
      sex: user.sex || 'male',
      height: user.height_cm || 175,
      trainingAge: user.training_age_years || 1,
      goal: prefs?.coaching?.primaryGoal || user.goal || undefined,
      experience: user.experience || undefined,
      enhancedAthleteMode: user.enhanced_athlete_mode === true,
    },
    phase: phase
      ? {
          type: toPhaseType(phase.phase_type),
          weekNumber: phase.current_week,
          startWeight: phase.start_weight_kg,
          targetWeight: phase.target_weight_kg ?? undefined,
        }
      : undefined,
    currentStats: {
      weight: latestWeight?.weight_kg || user.weight_kg || 75,
      weightTrend,
      bodyFat: dexa?.body_fat_percent,
      leanMass: dexa?.lean_mass_kg,
      ffmi,
      lastDexaDate: dexa?.scan_date,
    },
    training: {
      currentBlock: mesocycle?.name,
      weekInBlock: mesocycle?.current_week,
      daysPerWeek: mesocycle?.days_per_week,
      recentLifts: recentLifts.slice(0, 15), // Limit to 15 most relevant lifts
    },
    strength: calibratedLifts.length > 0
      ? {
          calibratedLifts: calibratedLifts.slice(0, 6), // Top 6 lifts
          overallLevel: calibrations[0]?.strength_level ?? undefined,
        }
      : undefined,
  };

  return context;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[CoachingContext] Error building context:', message);
    return null;
  }
}
