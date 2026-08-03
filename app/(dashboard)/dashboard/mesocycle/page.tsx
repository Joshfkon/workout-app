'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button, Slider, Input } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { generateFullMesocycleWithFatigue } from '@/services/sessionBuilderWithFatigue';
import { calculateRecoveryFactors } from '@/services/mesocycleBuilder';
import { analyzeRegionalComposition } from '@/services/regionalAnalysis';
import { getSessionFromProgramData, type ExerciseOverride, type ExtractedSession } from '@/services/mesocycleHelpers';
import {
  startMesocycleWorkoutSession,
  getWorkoutForDate,
  getTrainingDays,
  countCompletedSessions,
  programSessionHasUsableExercises,
  type TodayWorkout,
} from '@/lib/training/startMesocycleSession';
import {
  buildTrainingSchedule,
  describeTrainingSchedule,
  intervalDaysPerWeek,
  numberToDayName,
  parseLocalDate,
  scheduledDatesBetween,
  sessionsPerWeek,
  type ScheduleMode,
  type TrainingSchedule,
} from '@/lib/training/trainingSchedule';
import { TrainingScheduleSelector } from '@/components/mesocycle';
import { getLocalDateString, muscleDisplayName } from '@/lib/utils';
import { sessionIndexFromCompleted } from '@/lib/training/mesocycleProgress';
import { insertWorkoutSessions } from '@/lib/training/sessionOrigin';
import type { MuscleGroup, WorkoutDay, ExtendedUserProfile, DexaRegionalData, Goal as SchemaGoal, Experience, Rating, Equipment, DexaScan, FullProgramRecommendation } from '@/types/schema';

function getDefaultPreferredDays(daysPerWeek: number): WorkoutDay[] {
  return getTrainingDays(daysPerWeek).map(numberToDayName);
}

/** Interval cadences aren't whole numbers — every other day is 3.5/week. */
function formatDaysPerWeek(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function areSameWorkoutDays(a: WorkoutDay[], b: WorkoutDay[]): boolean {
  if (a.length !== b.length) return false;
  const normalizedA = [...a].sort();
  const normalizedB = [...b].sort();
  return normalizedA.every((day, index) => day === normalizedB[index]);
}

interface Mesocycle {
  id: string;
  name: string;
  state: string;
  total_weeks: number;
  current_week: number;
  days_per_week: number;
  split_type: string;
  deload_week: number;
  created_at: string;
  start_date: string;
  preferred_workout_days: WorkoutDay[] | null;
  /** 'fixed_days' (weekdays) or 'interval' (every N days). Null on legacy rows. */
  schedule_mode?: ScheduleMode | null;
  /** Interval schedules only: train every N days from start_date. */
  training_interval_days?: number | null;
  session_duration_minutes: number | null;
  program_data: unknown;
  exercise_overrides?: ExerciseOverride[];
  /** Enhanced Athlete Mode at (re)generation time (null for legacy rows). */
  generated_with_enhanced_mode?: boolean | null;
}

/**
 * The program-slot session Start will actually launch for this mesocycle,
 * or null exactly when the start path falls back to the calendar workout:
 * program_data yields no session for the slot, or none of its exercises
 * resolve in the library (programSessionHasUsableExercises). Every caller
 * that rewrites program_data must re-run this so the card keeps advertising
 * what Start launches.
 */
async function resolveProgramSlotSession(
  supabase: ReturnType<typeof createUntypedClient>,
  mesocycle: Mesocycle,
  programData: FullProgramRecommendation | null,
  completedCount: number
): Promise<ExtractedSession | null> {
  const sessionFromProgram = getSessionFromProgramData(
    programData,
    sessionIndexFromCompleted(completedCount, mesocycle.days_per_week),
    mesocycle.current_week,
    mesocycle.total_weeks
  );
  const slotUsable = await programSessionHasUsableExercises(
    supabase,
    sessionFromProgram,
    mesocycle.exercise_overrides
  );
  return slotUsable ? sessionFromProgram : null;
}

function RenameEditor({
  value,
  onChange,
  onSave,
  onCancel,
  isSaving,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  return (
    <div className="flex-1 flex items-center gap-2">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="Mesocycle name"
        autoFocus
      />
      <Button size="sm" onClick={onSave} isLoading={isSaving} disabled={!value.trim()}>
        Save
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSaving}>
        Cancel
      </Button>
    </div>
  );
}

function RenameButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={`text-surface-500 hover:text-primary-400 hover:bg-primary-500/10 rounded transition-colors ${className || 'p-1'}`}
      title="Rename mesocycle"
      aria-label="Rename mesocycle"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    </button>
  );
}

export default function MesocyclePage() {
  const router = useRouter();
  const [mesocycles, setMesocycles] = useState<Mesocycle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingWorkout, setIsStartingWorkout] = useState(false);
  const [todayWorkout, setTodayWorkout] = useState<TodayWorkout | null>(null);
  const [completedSessions, setCompletedSessions] = useState<number>(0);
  const [programSession, setProgramSession] = useState<ExtractedSession | null>(null);
  const [estimatedSessionTime, setEstimatedSessionTime] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Edit session duration state
  const [isEditingDuration, setIsEditingDuration] = useState(false);
  const [editDuration, setEditDuration] = useState(60);
  const [editPreferredDays, setEditPreferredDays] = useState<WorkoutDay[]>([]);
  const [editScheduleMode, setEditScheduleMode] = useState<ScheduleMode>('fixed_days');
  const [editIntervalDays, setEditIntervalDays] = useState(2);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // Rename mesocycle state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);

  const startRename = (meso: Mesocycle) => {
    setRenamingId(meso.id);
    setRenameValue(meso.name);
  };

  const handleRenameMesocycle = async () => {
    const trimmed = renameValue.trim();
    if (!renamingId || !trimmed) return;

    setIsSavingName(true);
    try {
      const supabase = createUntypedClient();
      const { error } = await supabase
        .from('mesocycles')
        .update({ name: trimmed })
        .eq('id', renamingId);

      if (error) throw error;

      setMesocycles(prev => prev.map(m =>
        m.id === renamingId ? { ...m, name: trimmed } : m
      ));
      setRenamingId(null);
    } catch (error) {
      console.error('Failed to rename mesocycle:', error);
    } finally {
      setIsSavingName(false);
    }
  };

  // Regenerate mesocycle program with new session duration and/or schedule
  const handleUpdateSessionDuration = async (
    mesocycleId: string,
    newDuration: number,
    newScheduleInput: { mode: ScheduleMode; preferredDays: WorkoutDay[]; intervalDays: number }
  ) => {
    setIsRegenerating(true);
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not logged in');

      // Fetch user profile data needed for regeneration
      const { data: userProfile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();

      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();

      // Fetch latest DEXA scan if available
      const { data: dexaScans } = await supabase
        .from('dexa_scans')
        .select('*')
        .eq('user_id', user.id)
        .order('scan_date', { ascending: false })
        .limit(1);

      const latestDexa: DexaScan | null = dexaScans?.[0] ? {
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
      } : null;

      // Get the current mesocycle
      const mesocycle = mesocycles.find(m => m.id === mesocycleId);
      if (!mesocycle) throw new Error('Mesocycle not found');

      // An interval cadence sets its own sessions/week (the nearest whole
      // number to 7 / interval); a fixed-day schedule keeps the block's.
      const newDaysPerWeek =
        newScheduleInput.mode === 'interval'
          ? intervalDaysPerWeek(newScheduleInput.intervalDays)
          : mesocycle.days_per_week;

      // Normalize the requested preferred days (fall back to the default
      // spread if the count no longer matches days/week), then detect whether
      // the schedule actually changed — we only rewrite planned sessions
      // when it did.
      const normalizedPreferredDays = newScheduleInput.preferredDays.length === newDaysPerWeek
        ? newScheduleInput.preferredDays
        : getDefaultPreferredDays(newDaysPerWeek);

      const currentSchedule = buildTrainingSchedule(mesocycle);
      const newSchedule = buildTrainingSchedule({
        days_per_week: newDaysPerWeek,
        preferred_workout_days: normalizedPreferredDays,
        schedule_mode: newScheduleInput.mode,
        training_interval_days: newScheduleInput.intervalDays,
        start_date: mesocycle.start_date,
      });

      const scheduleChanged =
        currentSchedule.mode !== newSchedule.mode ||
        currentSchedule.intervalDays !== newSchedule.intervalDays ||
        !areSameWorkoutDays(
          normalizedPreferredDays,
          currentSchedule.preferredWorkoutDays?.length
            ? currentSchedule.preferredWorkoutDays
            : getDefaultPreferredDays(mesocycle.days_per_week)
        );

      // Keep the plan's generation-time mode on a duration/day edit — the
      // enhanced toggle has its own explicit mid-meso flow.
      const mesoEnhancedMode =
        mesocycle.generated_with_enhanced_mode ?? (userData?.enhanced_athlete_mode === true);

      // Build extended user profile
      const extendedProfile: ExtendedUserProfile = {
        age: userData?.age || 30,
        experience: (userProfile?.experience as Experience) || 'intermediate',
        goal: (userProfile?.goal as SchemaGoal) || 'maintenance',
        sleepQuality: (userData?.sleep_quality as Rating) || 3,
        stressLevel: (userData?.stress_level as Rating) || 3,
        trainingAge: userData?.training_age_years || 1,
        availableEquipment: (userData?.available_equipment as Equipment[]) || ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'],
        injuryHistory: (userData?.injury_history as MuscleGroup[]) || [],
        heightCm: userData?.height_cm || null,
        latestDexa: latestDexa,
        enhancedAthleteMode: mesoEnhancedMode,
      };

      // Analyze regional data for lagging areas (if available)
      let laggingAreas: string[] = [];
      if (latestDexa?.regionalData && latestDexa.leanMassKg) {
        const regionalAnalysis = analyzeRegionalComposition(
          latestDexa.regionalData as DexaRegionalData,
          latestDexa.leanMassKg
        );
        laggingAreas = regionalAnalysis.laggingAreas;
      }

      // Regenerate the program with new session duration
      const newProgram = generateFullMesocycleWithFatigue(
        newDaysPerWeek,
        extendedProfile,
        newDuration,
        laggingAreas,
        [] // unavailableEquipmentIds - could fetch from gym locations if needed
      );

      // Calculate recovery factors
      const recoveryFactors = calculateRecoveryFactors(extendedProfile);

      // generateFullMesocycleWithFatigue picks the split from days/week
      // (recommendSplit), so switching to an interval cadence that moves
      // days/week can regenerate onto a different split — 6-day PPL at every
      // 3 days becomes 2 sessions/week, which is Full Body. split_type has to
      // follow the program that was actually generated: the calendar surfaces
      // derive the day name and their fallback muscles from split_type while
      // Start builds from program_data, so leaving it stale would advertise
      // "Push" and launch Full Body.
      const newSplitType = newProgram?.split || mesocycle.split_type;

      // If the schedule changed, regenerate future planned sessions onto the
      // new training dates: delete future `planned` rows and re-insert on the
      // new dates, skipping today's-and-past dates already locked by a
      // non-planned (in-progress/completed) session. Completed/in-progress
      // sessions are never touched.
      if (scheduleChanged) {
        type WorkoutSessionRow = { id: string; planned_date: string; state: string };
        const { data: existingSessions } = await supabase
          .from('workout_sessions')
          .select('id, planned_date, state')
          .eq('mesocycle_id', mesocycleId);

        const plannedSessions = (existingSessions as WorkoutSessionRow[] | null)?.filter(session => session.state === 'planned') || [];

        if (plannedSessions.length > 0) {
          const today = getLocalDateString();

          await supabase
            .from('workout_sessions')
            .delete()
            .eq('mesocycle_id', mesocycleId)
            .eq('state', 'planned')
            .gte('planned_date', today);

          const lockedDates = new Set(
            ((existingSessions as WorkoutSessionRow[] | null) || [])
              .filter(session => session.state !== 'planned')
              .map(session => session.planned_date)
          );

          // Parse start_date (a YYYY-MM-DD string) as a LOCAL date — `new
          // Date('2026-07-04')` parses as UTC midnight, which in negative-offset
          // timezones shifts the window back a day and drops the block's final
          // training day. Local parsing keeps the schedule window correct
          // (per the app-wide local-timezone date convention).
          const startDate = parseLocalDate(mesocycle.start_date);
          if (!startDate) throw new Error('Mesocycle has no usable start date');
          const endDate = new Date(startDate);
          endDate.setDate(endDate.getDate() + (mesocycle.total_weeks * 7) - 1);

          const newSessions = [];
          for (const date of scheduledDatesBetween(newSchedule, startDate, endDate)) {
            const plannedDate = getLocalDateString(date);
            if (plannedDate < today) continue;
            if (lockedDates.has(plannedDate)) continue;

            newSessions.push({
              user_id: user.id,
              mesocycle_id: mesocycleId,
              planned_date: plannedDate,
              state: 'planned',
              completion_percent: 0,
              origin: 'scheduled' as const,
            });
          }

          if (newSessions.length > 0) {
            const { error: insertError } = await insertWorkoutSessions(supabase, newSessions);
            if (insertError) throw insertError;
          }
        }
      }

      // Update the mesocycle in the database
      const { error: updateError } = await supabase
        .from('mesocycles')
        .update({
          session_duration_minutes: newDuration,
          days_per_week: newDaysPerWeek,
          split_type: newSplitType,
          schedule_mode: newSchedule.mode,
          training_interval_days: newSchedule.mode === 'interval' ? newSchedule.intervalDays : null,
          preferred_workout_days: normalizedPreferredDays,
          program_data: newProgram,
          fatigue_budget_config: newProgram?.fatigueBudget || null,
          volume_per_muscle: newProgram?.volumePerMuscle || null,
          periodization_model: newProgram?.periodization?.model || 'linear',
          recovery_multiplier: recoveryFactors?.volumeMultiplier || 1.0,
          generated_with_enhanced_mode: mesoEnhancedMode,
        })
        .eq('id', mesocycleId);

      if (updateError) throw updateError;

      // Update local state
      setMesocycles(mesocycles.map(m =>
        m.id === mesocycleId
          ? {
            ...m,
            session_duration_minutes: newDuration,
            days_per_week: newDaysPerWeek,
            split_type: newSplitType,
            schedule_mode: newSchedule.mode,
            training_interval_days:
              newSchedule.mode === 'interval' ? newSchedule.intervalDays : null,
            preferred_workout_days: normalizedPreferredDays,
            program_data: newProgram,
          }
          : m
      ));

      // Refresh today's workout so the schedule reflects the new training days
      if (mesocycleId === mesocycles.find(m => m.state === 'active')?.id) {
        setTodayWorkout(getWorkoutForDate(newSplitType, new Date(), newSchedule));

        // program_data was just rewritten, and Start will build from the
        // regenerated program — re-resolve the slot session so the card's
        // day name / muscle badges / time estimate advertise the new
        // program instead of the one loaded on mount.
        const slotSession = await resolveProgramSlotSession(
          supabase,
          { ...mesocycle, days_per_week: newDaysPerWeek, split_type: newSplitType },
          newProgram,
          completedSessions
        );
        setProgramSession(slotSession);
        setEstimatedSessionTime(slotSession ? slotSession.estimatedMinutes : null);
      }

      setIsEditingDuration(false);
    } catch (error) {
      console.error('Failed to update session duration:', error);
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleDeleteMesocycle = async (id: string) => {
    setDeletingId(id);
    try {
      const supabase = createUntypedClient();
      
      // Delete associated workout sessions and exercise blocks first
      const { data: sessions } = await supabase
        .from('workout_sessions')
        .select('id')
        .eq('mesocycle_id', id);
      
      if (sessions && sessions.length > 0) {
        const sessionIds = sessions.map((s: { id: string }) => s.id);
        // Delete exercise blocks for these sessions
        await supabase
          .from('exercise_blocks')
          .delete()
          .in('workout_session_id', sessionIds);
        // Delete the sessions
        await supabase
          .from('workout_sessions')
          .delete()
          .eq('mesocycle_id', id);
      }
      
      // Delete the mesocycle
      await supabase
        .from('mesocycles')
        .delete()
        .eq('id', id);
      
      // Update local state
      setMesocycles(mesocycles.filter(m => m.id !== id));
      setConfirmDeleteId(null);
    } catch (error) {
      console.error('Failed to delete mesocycle:', error);
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    async function fetchMesocycles() {
      const supabase = createUntypedClient();
      const { data, error } = await supabase
        .from('mesocycles')
        .select('*')
        .order('created_at', { ascending: false });

      if (data && !error) {
        setMesocycles(data);

        // Calculate today's workout for active mesocycle
        const active = data.find((m: Mesocycle) => m.state === 'active');
        if (active) {
          const workout = getWorkoutForDate(
            active.split_type,
            new Date(),
            buildTrainingSchedule(active)
          );
          setTodayWorkout(workout);

          // TOTAL completed sessions drive progression: session index is
          // count % days_per_week (skipped days never drop a session).
          const completedCount = await countCompletedSessions(supabase, active.id);
          setCompletedSessions(completedCount);

          // The program-slot session Start will actually launch (also gives
          // the estimated time for the time-budget warning). Keep it only if
          // its exercises still resolve in the library — otherwise Start's
          // block-building loop skips every entry and falls back to the
          // calendar workout, so the card must advertise that instead.
          const slotSession = await resolveProgramSlotSession(
            supabase,
            active,
            active.program_data as FullProgramRecommendation | null,
            completedCount
          );
          setProgramSession(slotSession);
          if (slotSession) {
            setEstimatedSessionTime(slotSession.estimatedMinutes);
          }
        }
      }
      setIsLoading(false);
    }
    fetchMesocycles();
  }, []);

  const activeMesocycle = mesocycles.find(m => m.state === 'active');
  const pastMesocycles = mesocycles.filter(m => m.state !== 'active');

  // Resolved calendar for the active block — fixed weekdays or every-N-days.
  // Never null so the JSX below (already guarded on activeMesocycle) can use
  // it without re-narrowing; the placeholder is inert when there is no block.
  const activeSchedule: TrainingSchedule = activeMesocycle
    ? buildTrainingSchedule(activeMesocycle)
    : buildTrainingSchedule({ days_per_week: 4 });

  // The card must advertise the workout Start actually launches: the program
  // slot at completedSessions % days_per_week, which diverges from the
  // calendar weekday after skipped days. programSession is null (→ calendar
  // fallback) exactly when the start path itself falls back to building from
  // todayWorkout's muscles: program_data yields nothing, or none of its
  // exercises resolve in the library (programSessionHasUsableExercises).
  const cardDayName = programSession?.dayName ?? todayWorkout?.dayName;
  const cardMuscles: MuscleGroup[] = programSession
    ? Array.from(new Set(programSession.exercises.map(ex => ex.primaryMuscle)))
    : todayWorkout?.muscles ?? [];

  // Start today's workout from the mesocycle (shared start path)
  const handleStartWorkout = async () => {
    if (!activeMesocycle || !todayWorkout) return;

    setIsStartingWorkout(true);

    try {
      const supabase = createUntypedClient();
      const { sessionId } = await startMesocycleWorkoutSession({
        supabase,
        mesocycle: activeMesocycle,
        todayWorkout,
        completedSessions,
      });

      router.push(`/dashboard/workout/${sessionId}`);
    } catch (error) {
      console.error('Failed to start workout:', error);
      setIsStartingWorkout(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-surface-100">Mesocycle</h1>
            <div className="group relative">
              <button className="w-5 h-5 rounded-full bg-surface-700 hover:bg-surface-600 text-surface-400 text-xs flex items-center justify-center">
                ?
              </button>
              <div className="absolute left-0 top-7 w-72 p-3 bg-surface-800 border border-surface-700 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                <p className="text-sm font-medium text-surface-200 mb-1">What is a Mesocycle?</p>
                <p className="text-xs text-surface-400">
                  A <span className="text-primary-400">mesocycle</span> is a training block lasting 4-8 weeks, designed to achieve specific goals. It includes progressive overload weeks followed by a deload week to manage fatigue and maximize adaptation.
                </p>
                <p className="text-xs text-surface-500 mt-2">
                  Think of it as a &ldquo;chapter&rdquo; in your training story—focused, structured, and building toward the next phase.
                </p>
              </div>
            </div>
          </div>
          <p className="text-surface-400 mt-1">Plan and track your training blocks</p>
        </div>
        <Link href="/dashboard/mesocycle/new">
          <Button>
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Mesocycle
          </Button>
        </Link>
      </div>

      {isLoading ? (
        // Skeletons approximating the loaded layout (today card + overview)
        // instead of a spinner: structural guard against load-time layout
        // shift on this page (audit: CLS 0.417) + perceived-perf (PERF item 2)
        <>
          <Card variant="elevated" aria-busy="true">
            <CardContent className="p-6">
              <div className="animate-pulse space-y-3">
                <div className="h-4 w-28 bg-surface-800 rounded" />
                <div className="h-6 w-48 bg-surface-800 rounded" />
                <div className="flex gap-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-6 w-16 bg-surface-800 rounded-full" />
                  ))}
                </div>
                <div className="h-4 w-56 bg-surface-800 rounded" />
              </div>
            </CardContent>
          </Card>
          <Card aria-busy="true">
            <CardContent className="p-6">
              <div className="animate-pulse space-y-6">
                <div className="grid gap-4 grid-cols-2 sm:grid-cols-5">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-20 bg-surface-800 rounded-lg" />
                  ))}
                </div>
                <div className="h-2 bg-surface-800 rounded-full" />
                <div className="flex gap-2 overflow-hidden">
                  {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="h-16 min-w-[80px] bg-surface-800 rounded-lg" />
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : !activeMesocycle ? (
        <Card className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-surface-200">No active mesocycle</h2>
          <p className="text-surface-500 mt-2 max-w-md mx-auto">
            Create a mesocycle to plan your training with progressive overload and scheduled deloads.
          </p>
          <Link href="/dashboard/mesocycle/new">
            <Button className="mt-6">Create Your First Mesocycle</Button>
          </Link>
        </Card>
      ) : (
        <>
          {/* Today's Workout Card */}
          {todayWorkout ? (
            <Card variant="elevated" className="border-2 border-primary-500/30 bg-gradient-to-br from-primary-500/5 to-accent-500/5">
              <CardContent className="p-6">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-3xl">🏋️</span>
                      <div>
                        <p className="text-sm text-primary-400 font-medium">Today&apos;s Workout</p>
                        <h2 className="text-xl font-bold text-surface-100">{cardDayName}</h2>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {cardMuscles.map(muscle => (
                        <Badge key={muscle} variant="default">
                          {muscleDisplayName(muscle)}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 mt-3 text-sm">
                      <span className="text-surface-400">
                        Week {activeMesocycle.current_week} • Session {sessionIndexFromCompleted(completedSessions, activeMesocycle.days_per_week) + 1} of {activeMesocycle.days_per_week}
                      </span>
                      {estimatedSessionTime && (
                        <span className={`flex items-center gap-1 ${
                          estimatedSessionTime > (activeMesocycle.session_duration_minutes || 60) * 1.1
                            ? 'text-warning-400'
                            : 'text-surface-500'
                        }`}>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          ~{estimatedSessionTime} min
                        </span>
                      )}
                    </div>
                    {estimatedSessionTime && estimatedSessionTime > (activeMesocycle.session_duration_minutes || 60) * 1.1 && (
                      <div className="mt-2 p-2 bg-warning-500/10 border border-warning-500/20 rounded-lg">
                        <p className="text-xs text-warning-400">
                          This session may exceed your {activeMesocycle.session_duration_minutes || 60} min target by ~{Math.round(estimatedSessionTime - (activeMesocycle.session_duration_minutes || 60))} min.
                          Consider adjusting session duration or reducing exercises.
                        </p>
                      </div>
                    )}
                  </div>
                  <Button
                    size="lg"
                    onClick={handleStartWorkout}
                    isLoading={isStartingWorkout}
                    className="shrink-0 w-full sm:w-auto"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Start Workout
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border border-surface-700">
              <CardContent className="p-6 text-center">
                <span className="text-4xl block mb-3">😴</span>
                <h3 className="text-lg font-semibold text-surface-200">Rest Day</h3>
                <p className="text-surface-400 mt-1">
                  No workout scheduled for today. Recovery is part of the process!
                </p>
                <Link href="/dashboard/workout/new">
                  <Button variant="secondary" className="mt-4">
                    Start Ad-hoc Workout
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Mesocycle Overview Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                {renamingId === activeMesocycle.id ? (
                  <RenameEditor
                    value={renameValue}
                    onChange={setRenameValue}
                    onSave={handleRenameMesocycle}
                    onCancel={() => setRenamingId(null)}
                    isSaving={isSavingName}
                  />
                ) : (
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle>{activeMesocycle.name}</CardTitle>
                      <RenameButton onClick={() => startRename(activeMesocycle)} />
                    </div>
                    <p className="text-surface-400 text-sm mt-1">{activeMesocycle.split_type}</p>
                  </div>
                )}
                <Badge variant="success">Active</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-5">
                <div className="text-center p-4 bg-surface-800/50 rounded-lg">
                  <p className="text-2xl font-bold text-surface-100">
                    {activeMesocycle.current_week}/{activeMesocycle.total_weeks}
                  </p>
                  <p className="text-sm text-surface-500">Current Week</p>
                </div>
                <div className="text-center p-4 bg-surface-800/50 rounded-lg">
                  <p className="text-2xl font-bold text-surface-100">
                    {formatDaysPerWeek(sessionsPerWeek(activeSchedule))}
                  </p>
                  <p className="text-sm text-surface-500">Days/Week</p>
                </div>
                <div
                  className="text-center p-4 bg-surface-800/50 rounded-lg cursor-pointer hover:bg-surface-700/50 transition-colors"
                  onClick={() => {
                    setEditDuration(activeMesocycle.session_duration_minutes || 60);
                    setEditPreferredDays(
                      activeMesocycle.preferred_workout_days?.length
                        ? activeMesocycle.preferred_workout_days
                        : getDefaultPreferredDays(activeMesocycle.days_per_week)
                    );
                    setEditScheduleMode(activeSchedule.mode);
                    setEditIntervalDays(activeSchedule.intervalDays ?? 2);
                    setIsEditingDuration(true);
                  }}
                  title="Click to edit session duration and training schedule"
                >
                  <p className="text-2xl font-bold text-surface-100">{activeMesocycle.session_duration_minutes || 60}</p>
                  <p className="text-sm text-surface-500">Min/Session</p>
                  <p className="text-xs text-primary-400 mt-1">Edit</p>
                </div>
                <div className="text-center p-4 bg-surface-800/50 rounded-lg">
                  <p className="text-2xl font-bold text-surface-100">{activeMesocycle.deload_week}</p>
                  <p className="text-sm text-surface-500">Deload Week</p>
                </div>
                <div className="text-center p-4 bg-surface-800/50 rounded-lg col-span-2 sm:col-span-1">
                  <p className="text-2xl font-bold text-primary-400">
                    {Math.round((activeMesocycle.current_week / activeMesocycle.total_weeks) * 100)}%
                  </p>
                  <p className="text-sm text-surface-500">Complete</p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mt-6">
                <div className="flex justify-between text-sm text-surface-400 mb-2">
                  <span>Progress</span>
                  <span>Week {activeMesocycle.current_week} of {activeMesocycle.total_weeks}</span>
                </div>
                <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full transition-all"
                    style={{ width: `${(activeMesocycle.current_week / activeMesocycle.total_weeks) * 100}%` }}
                  />
                </div>
              </div>

              {/* Edit Session Duration */}
              {isEditingDuration && (
                <div className="mt-6 p-4 bg-surface-800/50 rounded-lg border border-primary-500/30">
                  <h4 className="text-sm font-medium text-surface-300 mb-4">Edit Schedule</h4>
                  <p className="text-xs text-surface-400 mb-4">
                    Changing your time or training schedule will regenerate your workout program and move future planned sessions to fit the updated schedule.
                  </p>
                  <div className="mb-4">
                    <div className="flex justify-between text-sm text-surface-400 mb-2">
                      <span>Time per session</span>
                      <span className="text-primary-400 font-medium">{editDuration} min</span>
                    </div>
                    <Slider
                      value={editDuration}
                      onChange={(e) => setEditDuration(parseInt(e.target.value, 10))}
                      min={15}
                      max={120}
                      step={5}
                    />
                    <div className="flex justify-between text-xs text-surface-500 mt-1">
                      <span>15 min</span>
                      <span>120 min</span>
                    </div>
                  </div>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-surface-200 mb-2">
                      When do you train?
                    </label>
                    <p className="text-xs text-surface-500 mb-2">
                      {editScheduleMode === 'fixed_days'
                        ? `Pick ${activeMesocycle.days_per_week} days that match your new schedule.`
                        : 'Sessions roll through the week from this block’s start date.'}
                    </p>
                    <TrainingScheduleSelector
                      daysPerWeek={activeMesocycle.days_per_week}
                      mode={editScheduleMode}
                      onModeChange={setEditScheduleMode}
                      selectedDays={editPreferredDays}
                      onDaysChange={setEditPreferredDays}
                      intervalDays={editIntervalDays}
                      onIntervalChange={setEditIntervalDays}
                      anchorDate={activeMesocycle.start_date}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsEditingDuration(false)}
                      disabled={isRegenerating}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        handleUpdateSessionDuration(activeMesocycle.id, editDuration, {
                          mode: editScheduleMode,
                          preferredDays: editPreferredDays,
                          intervalDays: editIntervalDays,
                        })
                      }
                      disabled={
                        isRegenerating
                        || (
                          editScheduleMode === 'fixed_days'
                          && editPreferredDays.length !== activeMesocycle.days_per_week
                        )
                        || (
                          editDuration === (activeMesocycle.session_duration_minutes || 60)
                          && editScheduleMode === activeSchedule.mode
                          && editIntervalDays === (activeSchedule.intervalDays ?? 2)
                          && areSameWorkoutDays(
                            editPreferredDays,
                            activeMesocycle.preferred_workout_days?.length
                              ? activeMesocycle.preferred_workout_days
                              : getDefaultPreferredDays(activeMesocycle.days_per_week)
                          )
                        )
                      }
                    >
                      {isRegenerating ? 'Regenerating...' : 'Update & Regenerate'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Upcoming schedule — dated, not Mon-to-Sun, so a rolling
                  every-N-days cadence renders as truthfully as fixed days. */}
              <div className="mt-6 pt-6 border-t border-surface-800">
                <div className="flex items-baseline justify-between mb-3 gap-2">
                  <h4 className="text-sm font-medium text-surface-300">Next 7 Days</h4>
                  <span className="text-xs text-surface-500 truncate">
                    {describeTrainingSchedule(activeSchedule, { short: true })}
                  </span>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {Array.from({ length: 7 }, (_, offset) => {
                    const date = new Date();
                    date.setHours(0, 0, 0, 0);
                    date.setDate(date.getDate() + offset);
                    const workout = getWorkoutForDate(
                      activeMesocycle.split_type,
                      date,
                      activeSchedule
                    );
                    const isToday = offset === 0;

                    return (
                      <div
                        key={getLocalDateString(date)}
                        className={`shrink-0 p-3 rounded-lg text-center min-w-[80px] ${
                          isToday
                            ? 'bg-primary-500/20 border border-primary-500/40'
                            : workout
                              ? 'bg-surface-800/50'
                              : 'bg-surface-900/30'
                        }`}
                      >
                        <p className={`text-xs font-medium ${isToday ? 'text-primary-400' : 'text-surface-500'}`}>
                          {isToday
                            ? 'Today'
                            : date.toLocaleDateString('en-US', { weekday: 'short' })}
                        </p>
                        {workout ? (
                          <p className="text-xs text-surface-300 mt-1 truncate" title={workout.dayName}>
                            {workout.dayName.split(' ')[0]}
                          </p>
                        ) : (
                          <p className="text-xs text-surface-600 mt-1">Rest</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Programming Logic - show when there's an active mesocycle */}
      {activeMesocycle && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              How Your Program Works
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* Split Logic */}
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h3 className="font-medium text-surface-200 mb-2">🗓️ {activeMesocycle.split_type} Split</h3>
                <p className="text-sm text-surface-400">
                  {activeMesocycle.split_type === 'Full Body' 
                    ? 'Each workout hits all muscle groups. This maximizes training frequency (2-3x/week per muscle) which is great for strength and hypertrophy.'
                    : activeMesocycle.split_type === 'Upper/Lower'
                    ? 'Alternating between upper and lower body allows high volume per session while maintaining 2x/week frequency.'
                    : activeMesocycle.split_type === 'PPL'
                    ? 'Push/Pull/Legs groups muscles by movement pattern. Great for high volume training with 1-2x frequency.'
                    : 'Your split is designed to balance volume and recovery.'}
                </p>
              </div>

              {/* Rep Ranges */}
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h3 className="font-medium text-surface-200 mb-2">🎯 Smart Rep Ranges</h3>
                <p className="text-sm text-surface-400 mb-2">
                  Rep ranges vary based on muscle fiber composition:
                </p>
                <ul className="text-xs text-surface-500 space-y-1">
                  <li>• <span className="text-danger-400">Hamstrings/Triceps:</span> Lower reps (fast-twitch)</li>
                  <li>• <span className="text-warning-400">Chest/Back/Quads:</span> Moderate reps (mixed)</li>
                  <li>• <span className="text-success-400">Calves/Delts/Core:</span> Higher reps (slow-twitch)</li>
                </ul>
              </div>

              {/* Progressive Overload */}
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h3 className="font-medium text-surface-200 mb-2">📈 Weekly Progression</h3>
                <p className="text-sm text-surface-400">
                  Each week, we aim to add 1-2 reps or 2.5% weight to key lifts. This progressive overload drives adaptation.
                </p>
                <div className="flex gap-2 mt-2">
                  {Array.from({ length: activeMesocycle.total_weeks }).map((_, i) => (
                    <div
                      key={i}
                      className={`flex-1 h-2 rounded ${
                        i === activeMesocycle.total_weeks - 1
                          ? 'bg-warning-500'
                          : i < activeMesocycle.current_week
                          ? 'bg-primary-500'
                          : 'bg-surface-700'
                      }`}
                      title={i === activeMesocycle.total_weeks - 1 ? 'Deload' : `Week ${i + 1}`}
                    />
                  ))}
                </div>
                <p className="text-xs text-surface-500 mt-1">
                  Weeks 1-{activeMesocycle.total_weeks - 1}: Build • Week {activeMesocycle.total_weeks}: Deload
                </p>
              </div>

              {/* Volume */}
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h3 className="font-medium text-surface-200 mb-2">💪 Volume Targets</h3>
                <p className="text-sm text-surface-400 mb-2">
                  Weekly sets per muscle group:
                </p>
                <div className="flex items-center gap-2 text-xs">
                  <span className="px-2 py-1 bg-surface-700 rounded">MV: 6</span>
                  <span className="text-surface-600">→</span>
                  <span className="px-2 py-1 bg-success-500/20 text-success-300 rounded">Target: 10-20</span>
                  <span className="text-surface-600">→</span>
                  <span className="px-2 py-1 bg-surface-700 rounded">MRV: 20+</span>
                </div>
                <p className="text-xs text-surface-500 mt-2">
                  MV = Minimum Viable • MRV = Maximum Recoverable
                </p>
              </div>

              {/* Fatigue */}
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h3 className="font-medium text-surface-200 mb-2">⚡ Fatigue Tracking</h3>
                <p className="text-sm text-surface-400">
                  We monitor systemic and local fatigue. High RPE, poor sleep, or missed reps trigger adaptive responses.
                </p>
                <div className="mt-2 p-2 bg-surface-900/50 rounded text-xs text-surface-500">
                  <strong className="text-surface-400">Auto-deload triggers:</strong> Performance drop, RPE 9.5+, poor recovery
                </div>
              </div>

              {/* Deload */}
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h3 className="font-medium text-surface-200 mb-2">😴 Deload Week</h3>
                <p className="text-sm text-surface-400">
                  Week {activeMesocycle.deload_week} reduces volume by 50% while maintaining intensity. This lets accumulated fatigue dissipate.
                </p>
                <div className="mt-2 flex gap-2 text-xs">
                  <span className="px-2 py-1 bg-surface-700 rounded">Volume: -50%</span>
                  <span className="px-2 py-1 bg-surface-700 rounded">Intensity: Same</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* What is a mesocycle - always show after loading */}
      {!isLoading && (
        <Card>
          <CardHeader>
            <CardTitle>What is a Mesocycle?</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-surface-400 mb-4">
              A mesocycle is a training block typically lasting 4-8 weeks, designed to progressively overload your muscles before a recovery (deload) week.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h3 className="font-medium text-surface-200">📈 Progressive Overload</h3>
                <p className="text-sm text-surface-500 mt-1">
                  Gradually increase volume and intensity week over week
                </p>
              </div>
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h3 className="font-medium text-surface-200">😴 Planned Deloads</h3>
                <p className="text-sm text-surface-500 mt-1">
                  Scheduled recovery weeks to manage fatigue
                </p>
              </div>
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h3 className="font-medium text-surface-200">🎯 Auto-Regulation</h3>
                <p className="text-sm text-surface-500 mt-1">
                  Adjust based on readiness and performance
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Past mesocycles - at the bottom */}
      {pastMesocycles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Past Mesocycles</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pastMesocycles.map((meso) => (
                <div key={meso.id} className="flex items-center justify-between gap-3 p-3 bg-surface-800/50 rounded-lg">
                  {renamingId === meso.id ? (
                    <RenameEditor
                      value={renameValue}
                      onChange={setRenameValue}
                      onSave={handleRenameMesocycle}
                      onCancel={() => setRenamingId(null)}
                      isSaving={isSavingName}
                    />
                  ) : (
                  <div>
                    <p className="font-medium text-surface-200">{meso.name}</p>
                    <p className="text-sm text-surface-500">
                      {meso.split_type} • {meso.total_weeks} weeks • {new Date(meso.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Badge variant={meso.state === 'completed' ? 'default' : 'warning'}>
                      {meso.state}
                    </Badge>
                    {renamingId !== meso.id && (
                      <RenameButton onClick={() => startRename(meso)} className="p-1.5" />
                    )}
                    {confirmDeleteId === meso.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleDeleteMesocycle(meso.id)}
                          isLoading={deletingId === meso.id}
                        >
                          Confirm
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(meso.id)}
                        className="p-1.5 text-surface-500 hover:text-danger-400 hover:bg-danger-500/10 rounded transition-colors"
                        title="Delete mesocycle"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
