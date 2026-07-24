'use server';

import { createClient } from '@/lib/supabase/server';
import { getLocalDateString } from '@/lib/utils';
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

/** Raw coaching data fetched from the database */
export interface RawCoachingData {
  authUserId: string;
  authEmail: string | undefined;
  user: UserRow;
  phase: TrainingPhaseRow | null;
  latestWeight: Pick<BodyweightEntryRow, 'weight_kg' | 'date'> | null;
  recentWeights: Pick<BodyweightEntryRow, 'weight_kg' | 'date'>[] | null;
  dexa: DexaScanRow | null;
  mesocycle: MesocycleRow | null;
  calibrations: CalibratedLiftRow[];
  prefs: UserPreferencesRow | null;
  sessions: WorkoutSessionWithBlocks[] | null;
}

/**
 * Fetch all coaching context data from the database
 */
export async function fetchCoachingContextData(): Promise<RawCoachingData | null> {
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

    if (userError || !userData) {
      console.error('[CoachingContext] Error fetching user:', userError?.message);
      return null;
    }

    const user = userData as UserRow;

    // Get active training phase
    const { data: phaseData } = await supabase
      .from('training_phases')
      .select('*')
      .eq('user_id', authUser.id)
      .eq('is_active', true)
      .single();

    // Get most recent bodyweight
    const { data: recentWeight } = await supabase
      .from('bodyweight_entries')
      .select('weight_kg, date')
      .eq('user_id', authUser.id)
      .order('date', { ascending: false })
      .limit(1)
      .single();

    // Get bodyweight trend (last 2 weeks)
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const { data: recentWeights } = await supabase
      .from('bodyweight_entries')
      .select('weight_kg, date')
      .eq('user_id', authUser.id)
      .gte('date', getLocalDateString(twoWeeksAgo))
      .order('date', { ascending: true });

    // Get most recent DEXA scan
    const { data: dexaData } = await supabase
      .from('dexa_scans')
      .select('*')
      .eq('user_id', authUser.id)
      .order('scan_date', { ascending: false })
      .limit(1)
      .single();

    // Get active mesocycle
    const { data: mesocycleData } = await supabase
      .from('mesocycles')
      .select('*')
      .eq('user_id', authUser.id)
      .eq('state', 'active')
      .single();

    // Get strength calibrations
    const { data: calibrationsData } = await supabase
      .from('calibrated_lifts')
      .select('*')
      .eq('user_id', authUser.id)
      .order('tested_at', { ascending: false });

    // Get user preferences/goals
    const { data: prefsData } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', authUser.id)
      .single();

    // Get recent lift performance (last 30 days)
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

    return {
      authUserId: authUser.id,
      authEmail: authUser.email,
      user,
      phase: phaseData as TrainingPhaseRow | null,
      latestWeight: recentWeight as Pick<BodyweightEntryRow, 'weight_kg' | 'date'> | null,
      recentWeights: recentWeights as Pick<BodyweightEntryRow, 'weight_kg' | 'date'>[] | null,
      dexa: dexaData as DexaScanRow | null,
      mesocycle: mesocycleData as MesocycleRow | null,
      calibrations: (calibrationsData as CalibratedLiftRow[] | null) || [],
      prefs: prefsData as UserPreferencesRow | null,
      sessions: recentSessions as WorkoutSessionWithBlocks[] | null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[CoachingContext] Error fetching data:', message);
    return null;
  }
}
