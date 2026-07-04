'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button, Slider, Input } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { generateFullMesocycleWithFatigue } from '@/services/sessionBuilderWithFatigue';
import { calculateRecoveryFactors } from '@/services/mesocycleBuilder';
import { analyzeRegionalComposition } from '@/services/regionalAnalysis';
import { getSessionFromProgramData, type ExerciseOverride } from '@/services/mesocycleHelpers';
import {
  startMesocycleWorkoutSession,
  getWorkoutForDay,
  getTrainingDays,
  getWeekStart,
  type TodayWorkout,
} from '@/lib/training/startMesocycleSession';
import { WorkoutDaySelector } from '@/components/mesocycle';
import { getLocalDateString } from '@/lib/utils';
import type { MuscleGroup, WorkoutDay, ExtendedUserProfile, DexaRegionalData, Goal as SchemaGoal, Experience, Rating, Equipment, DexaScan, FullProgramRecommendation } from '@/types/schema';

const WEEKDAY_NAMES: WorkoutDay[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function numberToDayName(dayNumber: number): WorkoutDay {
  return WEEKDAY_NAMES[dayNumber - 1] || 'Monday';
}

function getDefaultPreferredDays(daysPerWeek: number): WorkoutDay[] {
  return getTrainingDays(daysPerWeek).map(numberToDayName);
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
  session_duration_minutes: number | null;
  program_data: unknown;
  exercise_overrides?: ExerciseOverride[];
}

export default function MesocyclePage() {
  const router = useRouter();
  const [mesocycles, setMesocycles] = useState<Mesocycle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingWorkout, setIsStartingWorkout] = useState(false);
  const [todayWorkout, setTodayWorkout] = useState<TodayWorkout | null>(null);
  const [completedSessionsThisWeek, setCompletedSessionsThisWeek] = useState<number>(0);
  const [estimatedSessionTime, setEstimatedSessionTime] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Edit session duration state
  const [isEditingDuration, setIsEditingDuration] = useState(false);
  const [editDuration, setEditDuration] = useState(60);
  const [editPreferredDays, setEditPreferredDays] = useState<WorkoutDay[]>([]);
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

  // Regenerate mesocycle program with new session duration and/or preferred training days
  const handleUpdateSessionDuration = async (
    mesocycleId: string,
    newDuration: number,
    newPreferredDays: WorkoutDay[]
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

      // Normalize the requested preferred days (fall back to the default
      // spread if the count no longer matches days/week), then detect whether
      // the training days actually changed — we only rewrite planned sessions
      // when they did.
      const normalizedPreferredDays = newPreferredDays.length === mesocycle.days_per_week
        ? newPreferredDays
        : getDefaultPreferredDays(mesocycle.days_per_week);

      const currentPreferredDays = mesocycle.preferred_workout_days?.length
        ? mesocycle.preferred_workout_days
        : getDefaultPreferredDays(mesocycle.days_per_week);

      const daysChanged = !areSameWorkoutDays(normalizedPreferredDays, currentPreferredDays);

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
        mesocycle.days_per_week,
        extendedProfile,
        newDuration,
        laggingAreas,
        [] // unavailableEquipmentIds - could fetch from gym locations if needed
      );

      // Calculate recovery factors
      const recoveryFactors = calculateRecoveryFactors(extendedProfile);

      // If the training days changed, regenerate future planned sessions onto
      // the new weekdays: delete future `planned` rows and re-insert on the new
      // training days, skipping today's-and-past dates already locked by a
      // non-planned (in-progress/completed) session. Completed/in-progress
      // sessions are never touched.
      if (daysChanged) {
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

          const trainingDays = new Set(
            getTrainingDays(mesocycle.days_per_week, normalizedPreferredDays)
          );

          // Parse start_date (a YYYY-MM-DD string) as a LOCAL date — `new
          // Date('2026-07-04')` parses as UTC midnight, which in negative-offset
          // timezones shifts the window back a day and drops the block's final
          // training day. Local parsing keeps the schedule window correct
          // (per the app-wide local-timezone date convention).
          const [startYear, startMonth, startDay] = mesocycle.start_date.split('-').map(Number);
          const startDate = new Date(startYear, startMonth - 1, startDay);
          const endDate = new Date(startYear, startMonth - 1, startDay);
          endDate.setDate(endDate.getDate() + (mesocycle.total_weeks * 7) - 1);

          const newSessions = [];
          for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
            const dayNumber = date.getDay() === 0 ? 7 : date.getDay();
            if (!trainingDays.has(dayNumber)) continue;

            const plannedDate = getLocalDateString(date);
            if (plannedDate < today) continue;
            if (lockedDates.has(plannedDate)) continue;

            newSessions.push({
              user_id: user.id,
              mesocycle_id: mesocycleId,
              planned_date: plannedDate,
              state: 'planned',
              completion_percent: 0,
            });
          }

          if (newSessions.length > 0) {
            const { error: insertError } = await supabase
              .from('workout_sessions')
              .insert(newSessions);
            if (insertError) throw insertError;
          }
        }
      }

      // Update the mesocycle in the database
      const { error: updateError } = await supabase
        .from('mesocycles')
        .update({
          session_duration_minutes: newDuration,
          preferred_workout_days: normalizedPreferredDays,
          program_data: newProgram,
          fatigue_budget_config: newProgram?.fatigueBudget || null,
          volume_per_muscle: newProgram?.volumePerMuscle || null,
          periodization_model: newProgram?.periodization?.model || 'linear',
          recovery_multiplier: recoveryFactors?.volumeMultiplier || 1.0,
        })
        .eq('id', mesocycleId);

      if (updateError) throw updateError;

      // Update local state
      setMesocycles(mesocycles.map(m =>
        m.id === mesocycleId
          ? {
            ...m,
            session_duration_minutes: newDuration,
            preferred_workout_days: normalizedPreferredDays,
            program_data: newProgram,
          }
          : m
      ));

      // Refresh today's workout so the schedule reflects the new training days
      if (mesocycleId === mesocycles.find(m => m.state === 'active')?.id) {
        const today = new Date();
        const dayOfWeek = today.getDay() || 7;
        setTodayWorkout(
          getWorkoutForDay(
            mesocycle.split_type,
            dayOfWeek,
            mesocycle.days_per_week,
            normalizedPreferredDays
          )
        );
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
          const today = new Date();
          const dayOfWeek = today.getDay() || 7; // Convert Sunday(0) to 7
          const workout = getWorkoutForDay(
            active.split_type,
            dayOfWeek,
            active.days_per_week,
            active.preferred_workout_days
          );
          setTodayWorkout(workout);

          // Fetch completed sessions this week for session tracking
          const weekStart = getWeekStart();
          const { data: completedSessions } = await supabase
            .from('workout_sessions')
            .select('id')
            .eq('mesocycle_id', active.id)
            .eq('state', 'completed')
            .gte('planned_date', weekStart);

          const completedCount = completedSessions?.length || 0;
          setCompletedSessionsThisWeek(completedCount);

          // Get estimated time from program_data for time budget validation
          const programData = active.program_data as FullProgramRecommendation | null;
          const sessionFromProgram = getSessionFromProgramData(
            programData,
            completedCount, // Use completed count as session index
            active.current_week,
            active.total_weeks
          );
          if (sessionFromProgram) {
            setEstimatedSessionTime(sessionFromProgram.estimatedMinutes);
          }
        }
      }
      setIsLoading(false);
    }
    fetchMesocycles();
  }, []);

  const activeMesocycle = mesocycles.find(m => m.state === 'active');
  const pastMesocycles = mesocycles.filter(m => m.state !== 'active');

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
        completedSessionsThisWeek,
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
                        <h2 className="text-xl font-bold text-surface-100">{todayWorkout.dayName}</h2>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {todayWorkout.muscles.map(muscle => (
                        <Badge key={muscle} variant="default" className="capitalize">
                          {muscle}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 mt-3 text-sm">
                      <span className="text-surface-400">
                        Week {activeMesocycle.current_week} • Session {completedSessionsThisWeek + 1} of {activeMesocycle.days_per_week}
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
                  <div className="flex-1 flex items-center gap-2">
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameMesocycle();
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      placeholder="Mesocycle name"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      onClick={handleRenameMesocycle}
                      isLoading={isSavingName}
                      disabled={!renameValue.trim()}
                    >
                      Save
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRenamingId(null)}
                      disabled={isSavingName}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle>{activeMesocycle.name}</CardTitle>
                      <button
                        onClick={() => startRename(activeMesocycle)}
                        className="p-1 text-surface-500 hover:text-primary-400 hover:bg-primary-500/10 rounded transition-colors"
                        title="Rename mesocycle"
                        aria-label="Rename mesocycle"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
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
                  <p className="text-2xl font-bold text-surface-100">{activeMesocycle.days_per_week}</p>
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
                    setIsEditingDuration(true);
                  }}
                  title="Click to edit session duration and training days"
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
                    Changing your time or preferred days will regenerate your workout program and move future planned sessions to fit the updated schedule.
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
                      Preferred workout days
                    </label>
                    <p className="text-xs text-surface-500 mb-2">
                      Pick {activeMesocycle.days_per_week} days that match your new schedule.
                    </p>
                    <WorkoutDaySelector
                      daysPerWeek={activeMesocycle.days_per_week}
                      selectedDays={editPreferredDays}
                      onChange={setEditPreferredDays}
                      showPresets
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
                      onClick={() => handleUpdateSessionDuration(activeMesocycle.id, editDuration, editPreferredDays)}
                      disabled={
                        isRegenerating
                        || editPreferredDays.length !== activeMesocycle.days_per_week
                        || (
                          editDuration === (activeMesocycle.session_duration_minutes || 60)
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

              {/* Week Schedule */}
              <div className="mt-6 pt-6 border-t border-surface-800">
                <h4 className="text-sm font-medium text-surface-300 mb-3">This Week&apos;s Schedule</h4>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, index) => {
                    const dayNum = index + 1;
                    const workout = getWorkoutForDay(
                      activeMesocycle.split_type,
                      dayNum,
                      activeMesocycle.days_per_week,
                      activeMesocycle.preferred_workout_days
                    );
                    const isToday = (new Date().getDay() || 7) === dayNum;

                    return (
                      <div
                        key={day}
                        className={`shrink-0 p-3 rounded-lg text-center min-w-[80px] ${
                          isToday
                            ? 'bg-primary-500/20 border border-primary-500/40'
                            : workout
                              ? 'bg-surface-800/50'
                              : 'bg-surface-900/30'
                        }`}
                      >
                        <p className={`text-xs font-medium ${isToday ? 'text-primary-400' : 'text-surface-500'}`}>
                          {day}
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
                    <div className="flex-1 flex items-center gap-2">
                      <Input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameMesocycle();
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        placeholder="Mesocycle name"
                        autoFocus
                      />
                      <Button
                        size="sm"
                        onClick={handleRenameMesocycle}
                        isLoading={isSavingName}
                        disabled={!renameValue.trim()}
                      >
                        Save
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRenamingId(null)}
                        disabled={isSavingName}
                      >
                        Cancel
                      </Button>
                    </div>
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
                      <button
                        onClick={() => startRename(meso)}
                        className="p-1.5 text-surface-500 hover:text-primary-400 hover:bg-primary-500/10 rounded transition-colors"
                        title="Rename mesocycle"
                        aria-label="Rename mesocycle"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
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
