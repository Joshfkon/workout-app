'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { useSubscription } from '@/hooks/useSubscription';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { UpgradePrompt } from '@/components/subscription';
import {
  type StrengthProfile,
  type CalibrationResult,
  type BodyComposition,
  CoachingSessionManager,
  formatStrengthLevel,
  getStrengthLevelBadgeVariant,
  getStrengthLevelColor,
  generatePercentileSegments
} from '@/services/coachingEngine';
import { kgToLbs, roundToIncrement, formatWeight, formatDuration } from '@/lib/utils';

function PercentileBar({ percentile, label, showValue = true }: { percentile: number; label: string; showValue?: boolean }) {
  const segments = generatePercentileSegments(percentile);

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-surface-400">
        <span>{label}</span>
        {showValue && <span className="font-medium">{percentile}th</span>}
      </div>
      <div className="flex gap-0.5">
        {segments.map((seg, i) => (
          <div
            key={i}
            className="h-2 flex-1 rounded-sm transition-colors"
            style={{ backgroundColor: seg.color }}
          />
        ))}
      </div>
    </div>
  );
}

interface CoachingSessionSummary {
  id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  lift_count: number;
}

interface CoachingPreferences {
  primaryGoal: string;
  daysPerWeek: number;
  sessionDuration: number;
  experience: string;
  equipment: string[];
  injuries: string[];
}

interface WorkoutSummary {
  id: string;
  date: string;
  duration: number;
  totalSets: number;
  totalReps: number;
  totalVolume: number;
  sessionRpe: number | null;
  pumpRating: number | null;
}

interface MuscleVolumeData {
  muscle: string;
  sets: number;
  workouts: number;
}

interface ExercisePerformance {
  exerciseId: string;
  exerciseName: string;
  bestWeight: number;
  bestReps: number;
  estimatedE1RM: number;
  totalSets: number;
  lastPerformed: string;
}

interface AnalyticsData {
  totalWorkouts: number;
  totalSets: number;
  totalVolume: number;
  avgWorkoutDuration: number;
  avgSessionRpe: number;
  recentWorkouts: WorkoutSummary[];
  weeklyMuscleVolume: MuscleVolumeData[];
  topExercises: ExercisePerformance[];
  currentStreak: number;
}

const GOAL_OPTIONS = [
  { value: 'hypertrophy', label: 'Build Muscle', description: 'Maximize muscle size and aesthetics' },
  { value: 'strength', label: 'Get Stronger', description: 'Increase 1RM on major lifts' },
  { value: 'recomp', label: 'Body Recomp', description: 'Build muscle while losing fat' },
  { value: 'endurance', label: 'Muscular Endurance', description: 'Improve stamina and work capacity' },
  { value: 'maintenance', label: 'Maintain', description: 'Keep current fitness level' },
];

const EQUIPMENT_OPTIONS = [
  { value: 'full_gym', label: 'Full Commercial Gym' },
  { value: 'home_basic', label: 'Home Gym (Basic)' },
  { value: 'home_full', label: 'Home Gym (Full)' },
  { value: 'dumbbells_only', label: 'Dumbbells Only' },
  { value: 'bodyweight', label: 'Bodyweight Only' },
];

const INJURY_OPTIONS = [
  { value: 'none', label: 'No injuries' },
  { value: 'lower_back', label: 'Lower back issues' },
  { value: 'shoulder', label: 'Shoulder issues' },
  { value: 'knee', label: 'Knee issues' },
  { value: 'wrist', label: 'Wrist issues' },
  { value: 'neck', label: 'Neck issues' },
  { value: 'elbow', label: 'Elbow issues' },
];

// Calculate estimated 1RM using Brzycki formula
function calculateE1RM(weight: number, reps: number): number {
  if (reps === 1) return weight;
  if (reps > 12) return weight * (1 + reps / 30);
  return weight * (36 / (37 - reps));
}

export default function CoachingPage() {
  const router = useRouter();
  const { canAccess, isLoading: subLoading } = useSubscription();
  const { preferences } = useUserPreferences();
  const [isLoading, setIsLoading] = useState(true);
  const [profile, setProfile] = useState<StrengthProfile | null>(null);
  const [sessions, setSessions] = useState<CoachingSessionSummary[]>([]);
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [showQuestionnaire, setShowQuestionnaire] = useState(false);
  const [isSavingPrefs, setIsSavingPrefs] = useState(false);
  const [coachingPrefs, setCoachingPrefs] = useState<CoachingPreferences>({
    primaryGoal: 'hypertrophy',
    daysPerWeek: 4,
    sessionDuration: 60,
    experience: 'intermediate',
    equipment: ['full_gym'],
    injuries: [],
  });
  const [hasSetPrefs, setHasSetPrefs] = useState(false);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | 'all'>('30d');

  // Unit display helpers
  const units = preferences?.units || 'lb';
  const displayWeight = (kg: number) => {
    const value = units === 'lb' ? kgToLbs(kg) : kg;
    return roundToIncrement(value, 2.5);
  };
  const weightUnit = units === 'lb' ? 'lbs' : 'kg';

  useEffect(() => {
    async function fetchData() {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login');
        return;
      }

      // Get user data including coaching preferences
      const { data: userData } = await supabase
        .from('users')
        .select('sex, goal, experience, preferences')
        .eq('id', user.id)
        .single();

      setSex((userData?.sex as 'male' | 'female') || 'male');

      // Load coaching preferences
      const prefs = userData?.preferences as Record<string, unknown> | null;
      if (prefs?.coaching) {
        const coaching = prefs.coaching as CoachingPreferences;
        setCoachingPrefs({
          primaryGoal: coaching.primaryGoal || userData?.goal || 'hypertrophy',
          daysPerWeek: coaching.daysPerWeek || 4,
          sessionDuration: coaching.sessionDuration || 60,
          experience: coaching.experience || userData?.experience || 'intermediate',
          equipment: coaching.equipment || ['full_gym'],
          injuries: coaching.injuries || [],
        });
        setHasSetPrefs(true);
      } else if (userData?.goal || userData?.experience) {
        setCoachingPrefs(prev => ({
          ...prev,
          primaryGoal: userData.goal || prev.primaryGoal,
          experience: userData.experience || prev.experience,
        }));
      }

      // Get all coaching sessions
      const { data: sessionsData } = await supabase
        .from('coaching_sessions')
        .select('id, status, created_at, completed_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      // Get most recent completed session with lifts
      const completedSessions = sessionsData?.filter((s: { status: string }) => s.status === 'completed') || [];

      if (completedSessions.length > 0) {
        const latestSession = completedSessions[0];

        // Get the strength profile from session
        const { data: sessionWithProfile } = await supabase
          .from('coaching_sessions')
          .select('*, calibrated_lifts:calibrated_lifts(*)')
          .eq('id', latestSession.id)
          .single();

        if (sessionWithProfile?.strength_profile) {
          setProfile(sessionWithProfile.strength_profile as StrengthProfile);
        } else if (sessionWithProfile?.calibrated_lifts?.length > 0) {
          // Rebuild profile from lifts if needed
          const bodyComp = sessionWithProfile.body_composition as BodyComposition;
          const calibratedLifts: CalibrationResult[] = sessionWithProfile.calibrated_lifts.map((lift: {
            lift_name: string;
            benchmark_id: string;
            tested_weight_kg: number;
            tested_reps: number;
            tested_rpe: number | null;
            estimated_1rm: number;
            percentile_vs_general: number;
            percentile_vs_trained: number;
            percentile_vs_body_comp: number;
            strength_level: string;
          }) => ({
            lift: lift.lift_name,
            benchmarkId: lift.benchmark_id,
            testedWeight: lift.tested_weight_kg,
            testedReps: lift.tested_reps,
            testedRPE: lift.tested_rpe,
            estimated1RM: lift.estimated_1rm,
            percentileScore: {
              vsGeneralPopulation: lift.percentile_vs_general,
              vsTrainedPopulation: lift.percentile_vs_trained,
              vsBodyComposition: lift.percentile_vs_body_comp
            },
            strengthLevel: lift.strength_level
          }));

          const manager = new CoachingSessionManager();
          manager.loadSession({
            bodyComposition: bodyComp,
            completedBenchmarks: calibratedLifts
          });

          const generatedProfile = manager.generateStrengthProfile(sex);
          if (generatedProfile) {
            setProfile(generatedProfile);
          }
        }
      }

      // Get lift counts for sessions
      if (sessionsData) {
        const sessionsWithCounts = await Promise.all(
          sessionsData.map(async (s: { id: string; status: string; created_at: string; completed_at: string | null }) => {
            const { count } = await supabase
              .from('calibrated_lifts')
              .select('*', { count: 'exact', head: true })
              .eq('coaching_session_id', s.id);

            return {
              ...s,
              lift_count: count || 0
            };
          })
        );
        setSessions(sessionsWithCounts);
      }

      setIsLoading(false);
    }

    fetchData();
  }, [router, sex]);

  // Fetch analytics data
  useEffect(() => {
    async function fetchAnalytics() {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Calculate date range
        const now = new Date();
        let startDate: Date | null = null;
        if (timeRange === '7d') {
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        } else if (timeRange === '30d') {
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }

        // Fetch workout data
        let query = supabase
          .from('workout_sessions')
          .select(`
            id,
            started_at,
            completed_at,
            session_rpe,
            pump_rating,
            planned_date,
            exercise_blocks!inner (
              id,
              workout_session_id,
              exercises!inner (
                id,
                name,
                primary_muscle
              ),
              set_logs!inner (
                id,
                exercise_block_id,
                weight_kg,
                reps,
                is_warmup,
                logged_at
              )
            )
          `)
          .eq('user_id', user.id)
          .eq('state', 'completed')
          .order('completed_at', { ascending: false });

        if (startDate) {
          query = query.gte('completed_at', startDate.toISOString());
        }

        const { data: workoutSessions, error } = await query;

        if (error) throw error;

        if (!workoutSessions || workoutSessions.length === 0) {
          setAnalytics(null);
          return;
        }

        // Process analytics data
        let totalSets = 0;
        let totalVolume = 0;
        let totalRpeSum = 0;
        let rpeCount = 0;
        const durations: number[] = [];
        const muscleVolumeMap = new Map<string, { sets: number; workouts: Set<string> }>();
        const exercisePerformanceMap = new Map<string, ExercisePerformance>();

        workoutSessions.forEach((session: any) => {
          if (session.started_at && session.completed_at) {
            const duration = Math.floor(
              (new Date(session.completed_at).getTime() - new Date(session.started_at).getTime()) / 1000
            );
            durations.push(duration);
          }

          if (session.session_rpe) {
            totalRpeSum += session.session_rpe;
            rpeCount++;
          }

          if (session.exercise_blocks) {
            session.exercise_blocks.forEach((block: any) => {
              if (!block.exercises || !block.set_logs) return;

              const muscle = block.exercises.primary_muscle;
              const exerciseId = block.exercises.id;
              const exerciseName = block.exercises.name;

              const workingSets = block.set_logs.filter((s: any) => !s.is_warmup);

              if (!muscleVolumeMap.has(muscle)) {
                muscleVolumeMap.set(muscle, { sets: 0, workouts: new Set() });
              }
              const muscleData = muscleVolumeMap.get(muscle)!;
              muscleData.sets += workingSets.length;
              muscleData.workouts.add(session.id);

              workingSets.forEach((set: any) => {
                totalSets++;
                totalVolume += set.weight_kg * set.reps;

                const e1rm = calculateE1RM(set.weight_kg, set.reps);

                if (!exercisePerformanceMap.has(exerciseId)) {
                  exercisePerformanceMap.set(exerciseId, {
                    exerciseId,
                    exerciseName,
                    bestWeight: set.weight_kg,
                    bestReps: set.reps,
                    estimatedE1RM: e1rm,
                    totalSets: 0,
                    lastPerformed: set.logged_at,
                  });
                }

                const exData = exercisePerformanceMap.get(exerciseId)!;
                exData.totalSets++;
                if (e1rm > exData.estimatedE1RM) {
                  exData.estimatedE1RM = e1rm;
                  exData.bestWeight = set.weight_kg;
                  exData.bestReps = set.reps;
                }
                if (new Date(set.logged_at) > new Date(exData.lastPerformed)) {
                  exData.lastPerformed = set.logged_at;
                }
              });
            });
          }
        });

        const totalWorkouts = workoutSessions.length;
        const avgWorkoutDuration = durations.length > 0
          ? Math.floor(durations.reduce((a, b) => a + b, 0) / durations.length)
          : 0;
        const avgSessionRpe = rpeCount > 0
          ? Math.round((totalRpeSum / rpeCount) * 10) / 10
          : 0;

        const recentWorkouts: WorkoutSummary[] = workoutSessions.slice(0, 5).map((session: any) => {
          let sessionSets = 0;
          let sessionReps = 0;
          let sessionVolume = 0;

          if (session.exercise_blocks) {
            session.exercise_blocks.forEach((block: any) => {
              if (block.set_logs) {
                block.set_logs.forEach((set: any) => {
                  if (!set.is_warmup) {
                    sessionSets++;
                    sessionReps += set.reps;
                    sessionVolume += set.weight_kg * set.reps;
                  }
                });
              }
            });
          }

          const duration = session.started_at && session.completed_at
            ? Math.floor((new Date(session.completed_at).getTime() - new Date(session.started_at).getTime()) / 1000)
            : 0;

          return {
            id: session.id,
            date: session.completed_at || session.planned_date,
            duration,
            totalSets: sessionSets,
            totalReps: sessionReps,
            totalVolume: sessionVolume,
            sessionRpe: session.session_rpe,
            pumpRating: session.pump_rating,
          };
        });

        const weeklyMuscleVolume: MuscleVolumeData[] = Array.from(muscleVolumeMap.entries())
          .map(([muscle, data]) => ({
            muscle,
            sets: data.sets,
            workouts: data.workouts.size,
          }))
          .sort((a, b) => b.sets - a.sets);

        const topExercises = Array.from(exercisePerformanceMap.values())
          .sort((a, b) => b.estimatedE1RM - a.estimatedE1RM)
          .slice(0, 10);

        // Calculate streak
        let currentStreak = 0;
        if (workoutSessions.length > 0) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          let lastWorkoutDate = new Date(workoutSessions[0].completed_at);
          lastWorkoutDate.setHours(0, 0, 0, 0);

          const daysSinceLastWorkout = Math.floor((today.getTime() - lastWorkoutDate.getTime()) / (24 * 60 * 60 * 1000));

          if (daysSinceLastWorkout <= 2) {
            currentStreak = 1;

            for (let i = 1; i < workoutSessions.length; i++) {
              const prevDate = new Date(workoutSessions[i - 1].completed_at);
              const currDate = new Date(workoutSessions[i].completed_at);
              prevDate.setHours(0, 0, 0, 0);
              currDate.setHours(0, 0, 0, 0);

              const gap = Math.floor((prevDate.getTime() - currDate.getTime()) / (24 * 60 * 60 * 1000));

              if (gap <= 3) {
                currentStreak++;
              } else {
                break;
              }
            }
          }
        }

        setAnalytics({
          totalWorkouts,
          totalSets,
          totalVolume,
          avgWorkoutDuration,
          avgSessionRpe,
          recentWorkouts,
          weeklyMuscleVolume,
          topExercises,
          currentStreak,
        });
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
      }
    }

    fetchAnalytics();
  }, [timeRange]);

  const handleStartCalibration = () => {
    router.push('/onboarding');
  };

  const saveCoachingPrefs = async () => {
    setIsSavingPrefs(true);
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: userData } = await supabase
        .from('users')
        .select('preferences')
        .eq('id', user.id)
        .single();

      const existingPrefs = (userData?.preferences as Record<string, unknown>) || {};

      const { error } = await supabase
        .from('users')
        .update({
          preferences: {
            ...existingPrefs,
            coaching: coachingPrefs,
          },
          goal: coachingPrefs.primaryGoal,
          experience: coachingPrefs.experience,
        })
        .eq('id', user.id);

      if (!error) {
        setHasSetPrefs(true);
        setShowQuestionnaire(false);
      }
    } catch (err) {
      console.error('Failed to save coaching preferences:', err);
    } finally {
      setIsSavingPrefs(false);
    }
  };

  // Check subscription access
  if (!subLoading && !canAccess('coachingCalibration')) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Strength & Analytics</h1>
          <p className="text-surface-400 mt-1">Track your strength calibration, percentile rankings, and workout analytics</p>
        </div>
        <UpgradePrompt feature="coachingCalibration" requiredTier="elite" />
      </div>
    );
  }

  if (isLoading || subLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Strength & Analytics</h1>
          <p className="text-surface-400">Track your calibration, percentile rankings, and workout progress</p>
        </div>
        <div className="flex gap-2">
          {/* Time range selector for analytics */}
          <div className="flex gap-1 bg-surface-800 p-1 rounded-lg">
            {(['7d', '30d', 'all'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                  timeRange === range
                    ? 'bg-primary-500 text-white'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                {range === '7d' ? '7d' : range === '30d' ? '30d' : 'All'}
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" onClick={() => setShowQuestionnaire(true)}>
            {hasSetPrefs ? 'Edit Goals' : 'Set Goals'}
          </Button>
          <Button size="sm" onClick={handleStartCalibration}>
            {profile ? 'Re-Calibrate' : 'Strength Test'}
          </Button>
        </div>
      </div>

      {/* Coaching Questionnaire Modal */}
      {showQuestionnaire && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => setShowQuestionnaire(false)}>
          <div
            className="w-full max-w-2xl bg-surface-900 rounded-xl shadow-2xl border border-surface-700 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-surface-700">
              <h3 className="text-xl font-bold text-white">Your Training Profile</h3>
              <p className="text-sm text-surface-400 mt-1">
                Help us personalize your coaching recommendations
              </p>
            </div>

            <div className="p-6 space-y-6">
              {/* Primary Goal */}
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-3">Primary Training Goal</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {GOAL_OPTIONS.map((goal) => (
                    <button
                      key={goal.value}
                      onClick={() => setCoachingPrefs(p => ({ ...p, primaryGoal: goal.value }))}
                      className={`p-4 rounded-lg border text-left transition-all ${
                        coachingPrefs.primaryGoal === goal.value
                          ? 'border-primary-500 bg-primary-500/10'
                          : 'border-surface-700 hover:border-surface-600 bg-surface-800/50'
                      }`}
                    >
                      <p className="font-medium text-surface-100">{goal.label}</p>
                      <p className="text-xs text-surface-500 mt-1">{goal.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Schedule */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-2">Days per Week</label>
                  <div className="flex gap-2">
                    {[2, 3, 4, 5, 6].map((d) => (
                      <button
                        key={d}
                        onClick={() => setCoachingPrefs(p => ({ ...p, daysPerWeek: d }))}
                        className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-all ${
                          coachingPrefs.daysPerWeek === d
                            ? 'border-primary-500 bg-primary-500/20 text-primary-300'
                            : 'border-surface-700 text-surface-400 hover:border-surface-600'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-2">Session Duration</label>
                  <div className="flex gap-2">
                    {[45, 60, 75, 90].map((m) => (
                      <button
                        key={m}
                        onClick={() => setCoachingPrefs(p => ({ ...p, sessionDuration: m }))}
                        className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-all ${
                          coachingPrefs.sessionDuration === m
                            ? 'border-primary-500 bg-primary-500/20 text-primary-300'
                            : 'border-surface-700 text-surface-400 hover:border-surface-600'
                        }`}
                      >
                        {m}m
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Experience */}
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-2">Training Experience</label>
                <div className="flex gap-2">
                  {[
                    { value: 'novice', label: 'Novice', desc: '<1 year' },
                    { value: 'intermediate', label: 'Intermediate', desc: '1-3 years' },
                    { value: 'advanced', label: 'Advanced', desc: '3+ years' },
                  ].map((exp) => (
                    <button
                      key={exp.value}
                      onClick={() => setCoachingPrefs(p => ({ ...p, experience: exp.value }))}
                      className={`flex-1 py-3 rounded-lg border text-sm font-medium transition-all ${
                        coachingPrefs.experience === exp.value
                          ? 'border-primary-500 bg-primary-500/20 text-primary-300'
                          : 'border-surface-700 text-surface-400 hover:border-surface-600'
                      }`}
                    >
                      <p>{exp.label}</p>
                      <p className="text-xs opacity-60">{exp.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Equipment */}
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-2">Available Equipment</label>
                <div className="flex flex-wrap gap-2">
                  {EQUIPMENT_OPTIONS.map((eq) => (
                    <button
                      key={eq.value}
                      onClick={() => setCoachingPrefs(p => ({
                        ...p,
                        equipment: p.equipment.includes(eq.value)
                          ? p.equipment.filter(e => e !== eq.value)
                          : [...p.equipment, eq.value]
                      }))}
                      className={`px-3 py-2 rounded-lg border text-sm transition-all ${
                        coachingPrefs.equipment.includes(eq.value)
                          ? 'border-primary-500 bg-primary-500/20 text-primary-300'
                          : 'border-surface-700 text-surface-400 hover:border-surface-600'
                      }`}
                    >
                      {eq.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Injuries */}
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-2">Any Limitations or Injuries?</label>
                <div className="flex flex-wrap gap-2">
                  {INJURY_OPTIONS.map((inj) => (
                    <button
                      key={inj.value}
                      onClick={() => {
                        if (inj.value === 'none') {
                          setCoachingPrefs(p => ({ ...p, injuries: [] }));
                        } else {
                          setCoachingPrefs(p => ({
                            ...p,
                            injuries: p.injuries.includes(inj.value)
                              ? p.injuries.filter(i => i !== inj.value)
                              : [...p.injuries.filter(i => i !== 'none'), inj.value]
                          }));
                        }
                      }}
                      className={`px-3 py-2 rounded-lg border text-sm transition-all ${
                        (inj.value === 'none' && coachingPrefs.injuries.length === 0) ||
                        coachingPrefs.injuries.includes(inj.value)
                          ? 'border-warning-500 bg-warning-500/20 text-warning-300'
                          : 'border-surface-700 text-surface-400 hover:border-surface-600'
                      }`}
                    >
                      {inj.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-surface-700 flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setShowQuestionnaire(false)}>
                Cancel
              </Button>
              <Button onClick={saveCoachingPrefs} isLoading={isSavingPrefs}>
                Save Preferences
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Show prompt if no preferences set */}
      {!hasSetPrefs && !profile && (
        <Card className="border-2 border-dashed border-accent-500/30 bg-gradient-to-r from-accent-500/5 to-primary-500/5">
          <CardContent className="p-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-accent-500/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-surface-100">Set Your Training Goals</h3>
            <p className="text-sm text-surface-400 mt-2 max-w-md mx-auto">
              Answer a few quick questions to help us personalize your training recommendations,
              exercise selection, and coaching insights.
            </p>
            <Button className="mt-4" onClick={() => setShowQuestionnaire(true)}>
              Get Started
              <svg className="w-4 h-4 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Analytics Quick Stats */}
      {analytics && analytics.totalWorkouts > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <Card className="p-4">
            <p className="text-xs text-surface-500 uppercase tracking-wider">Workouts</p>
            <p className="text-2xl font-bold text-primary-400 mt-1">{analytics.totalWorkouts}</p>
            {analytics.currentStreak > 1 && (
              <p className="text-xs text-success-400 mt-1">🔥 {analytics.currentStreak} workout streak</p>
            )}
          </Card>
          <Card className="p-4">
            <p className="text-xs text-surface-500 uppercase tracking-wider">Total Sets</p>
            <p className="text-2xl font-bold text-primary-400 mt-1">{analytics.totalSets}</p>
            <p className="text-xs text-surface-500 mt-1">
              ~{Math.round(analytics.totalSets / analytics.totalWorkouts)} per workout
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-surface-500 uppercase tracking-wider">Total Volume</p>
            <p className="text-2xl font-bold text-primary-400 mt-1">
              {formatWeight(analytics.totalVolume / 1000, units, 0)}k
            </p>
            <p className="text-xs text-surface-500 mt-1">
              ~{formatWeight(analytics.totalVolume / analytics.totalWorkouts, units, 0)} per workout
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-surface-500 uppercase tracking-wider">Avg Duration</p>
            <p className="text-2xl font-bold text-primary-400 mt-1">
              {formatDuration(analytics.avgWorkoutDuration)}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-surface-500 uppercase tracking-wider">Avg RPE</p>
            <p className="text-2xl font-bold text-primary-400 mt-1">
              {analytics.avgSessionRpe > 0 ? analytics.avgSessionRpe : '-'}
            </p>
            <p className="text-xs text-surface-500 mt-1">
              {analytics.avgSessionRpe >= 8 ? 'High intensity' : analytics.avgSessionRpe >= 6 ? 'Moderate' : 'Building up'}
            </p>
          </Card>
        </div>
      )}

      {profile ? (
        <>
          {/* Overall score card */}
          <Card className="bg-gradient-to-br from-primary-500/10 to-accent-500/10 border-primary-500/30">
            <CardContent className="p-8">
              <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                {/* Score circle */}
                <div className="relative">
                  <svg className="w-40 h-40" viewBox="0 0 100 100">
                    <circle
                      cx="50"
                      cy="50"
                      r="45"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="8"
                      className="text-surface-800"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="45"
                      fill="none"
                      stroke="url(#gradient)"
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={`${profile.overallScore * 2.83} 283`}
                      transform="rotate(-90 50 50)"
                    />
                    <defs>
                      <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#8b5cf6" />
                        <stop offset="100%" stopColor="#d946ef" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-4xl font-bold text-white">{profile.overallScore}</span>
                    <span className="text-sm text-surface-400">/ 100</span>
                  </div>
                </div>

                {/* Stats */}
                <div className="flex-1 space-y-4">
                  <div>
                    <p className="text-sm text-surface-400">Overall Strength Level</p>
                    <p className={`text-3xl font-bold capitalize ${getStrengthLevelColor(profile.strengthLevel)}`}>
                      {formatStrengthLevel(profile.strengthLevel)}
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-3 bg-surface-900/50 rounded-lg">
                      <p className="text-xs text-surface-500">Balance</p>
                      <p className="text-2xl font-bold text-white">{profile.balanceScore}%</p>
                    </div>
                    <div className="p-3 bg-surface-900/50 rounded-lg">
                      <p className="text-xs text-surface-500">FFMI</p>
                      <p className="text-2xl font-bold text-white">{profile.bodyComposition.ffmi.toFixed(1)}</p>
                    </div>
                    <div className="p-3 bg-surface-900/50 rounded-lg">
                      <p className="text-xs text-surface-500">Lean Mass</p>
                      <p className="text-2xl font-bold text-white">{displayWeight(profile.bodyComposition.leanMassKg)} {weightUnit}</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Calibrated lifts */}
            <Card>
              <CardHeader>
                <CardTitle>Calibrated Lifts</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {profile.calibratedLifts.map((lift) => (
                    <div key={lift.benchmarkId} className="p-4 bg-surface-800/50 rounded-xl">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h4 className="font-medium text-surface-200">{lift.lift}</h4>
                          <p className="text-sm text-surface-500">
                            {lift.benchmarkId === 'pullup'
                              ? `${lift.testedReps} reps`
                              : `E1RM: ${displayWeight(lift.estimated1RM)} ${weightUnit}`}
                          </p>
                        </div>
                        <Badge variant={getStrengthLevelBadgeVariant(lift.strengthLevel)}>
                          {formatStrengthLevel(lift.strengthLevel)}
                        </Badge>
                      </div>
                      <PercentileBar
                        percentile={lift.percentileScore.vsTrainedPopulation}
                        label="vs Trained Lifters"
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Volume by muscle */}
            {analytics && analytics.weeklyMuscleVolume.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Volume by Muscle Group</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {analytics.weeklyMuscleVolume.slice(0, 8).map((muscle) => {
                      const maxSets = Math.max(...analytics.weeklyMuscleVolume.map(m => m.sets));
                      const percentage = maxSets > 0 ? (muscle.sets / maxSets) * 100 : 0;

                      return (
                        <div key={muscle.muscle}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-surface-200 capitalize">
                              {muscle.muscle}
                            </span>
                            <span className="text-sm text-surface-400">
                              {muscle.sets} sets
                            </span>
                          </div>
                          <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full transition-all duration-500"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Imbalances and Recommendations */}
            <div className="space-y-6">
              {profile.imbalances.length > 0 && (
                <Card className="border-warning-500/30">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <span>⚠️</span>
                      Detected Imbalances
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {profile.imbalances.map((imbalance, i) => (
                        <div
                          key={i}
                          className={`p-4 rounded-lg ${
                            imbalance.severity === 'significant'
                              ? 'bg-danger-500/10 border border-danger-500/30'
                              : imbalance.severity === 'moderate'
                              ? 'bg-warning-500/10 border border-warning-500/30'
                              : 'bg-surface-800/50'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-surface-200 text-sm">{imbalance.description}</p>
                              <p className="text-xs text-surface-400 mt-1">{imbalance.recommendation}</p>
                            </div>
                            <Badge size="sm" variant={
                              imbalance.severity === 'significant' ? 'danger' :
                              imbalance.severity === 'moderate' ? 'warning' : 'default'
                            }>
                              {imbalance.severity}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Recommendations</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {profile.recommendations.map((rec, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-surface-800/50 rounded-lg">
                        <div className="w-6 h-6 rounded-full bg-primary-500/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-primary-400 text-xs font-medium">{i + 1}</span>
                        </div>
                        <p className="text-sm text-surface-300">{rec}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Top exercises */}
            {analytics && analytics.topExercises.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Top Exercises (Est. 1RM)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {analytics.topExercises.slice(0, 8).map((exercise, idx) => (
                      <div key={exercise.exerciseId} className="flex items-center gap-3">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                          idx < 3 ? 'bg-primary-500/20 text-primary-400' : 'bg-surface-800 text-surface-500'
                        }`}>
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-surface-200 truncate">
                            {exercise.exerciseName}
                          </p>
                          <p className="text-xs text-surface-500">
                            Best: {formatWeight(exercise.bestWeight, units)} × {exercise.bestReps}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-primary-400">
                            {formatWeight(exercise.estimatedE1RM, units)}
                          </p>
                          <p className="text-xs text-surface-500">{exercise.totalSets} sets</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Recent workouts */}
          {analytics && analytics.recentWorkouts.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Recent Workouts</CardTitle>
                  <Link href="/dashboard/history">
                    <Button variant="ghost" size="sm">View All →</Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {analytics.recentWorkouts.map((workout) => (
                    <Link
                      key={workout.id}
                      href={`/dashboard/workout/${workout.id}`}
                      className="block"
                    >
                      <div className="p-3 bg-surface-800/50 rounded-lg hover:bg-surface-800 transition-colors">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-surface-200">
                              {new Date(workout.date).toLocaleDateString('en-US', {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                              })}
                            </p>
                            <p className="text-xs text-surface-500">
                              {workout.totalSets} sets · {workout.totalReps} reps · {formatWeight(workout.totalVolume, units)} total
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {workout.sessionRpe && (
                              <Badge variant={workout.sessionRpe >= 8 ? 'danger' : workout.sessionRpe >= 6 ? 'warning' : 'default'}>
                                RPE {workout.sessionRpe}
                              </Badge>
                            )}
                            {workout.pumpRating && (
                              <span className="text-sm">
                                {workout.pumpRating === 5 && '🔥'}
                                {workout.pumpRating === 4 && '😄'}
                                {workout.pumpRating === 3 && '😊'}
                                {workout.pumpRating === 2 && '🙂'}
                                {workout.pumpRating === 1 && '😐'}
                              </span>
                            )}
                            <span className="text-xs text-surface-500">
                              {formatDuration(workout.duration)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Calibration history */}
          {sessions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Calibration History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex items-center justify-between p-3 bg-surface-800/50 rounded-lg"
                    >
                      <div>
                        <p className="font-medium text-surface-200">
                          {new Date(session.created_at).toLocaleDateString('en-US', {
                            month: 'long',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </p>
                        <p className="text-sm text-surface-500">
                          {session.lift_count} lifts tested
                        </p>
                      </div>
                      <Badge variant={session.status === 'completed' ? 'success' : 'warning'}>
                        {session.status === 'completed' ? 'Complete' : 'In Progress'}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        // No profile yet - show onboarding prompt
        <Card className="bg-surface-800/50">
          <CardContent className="p-12 text-center">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-primary-500/20 flex items-center justify-center">
              <svg className="w-10 h-10 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-3">Calibrate Your Strength</h2>
            <p className="text-surface-400 mb-6 max-w-md mx-auto">
              Test your key lifts to get personalized weight recommendations, percentile rankings,
              and identify any strength imbalances. Takes about 15-30 minutes.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" onClick={handleStartCalibration}>
                Start Strength Calibration
                <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Button>
            </div>

            <div className="mt-8 grid sm:grid-cols-3 gap-4 text-left">
              <div className="p-4 bg-surface-900/50 rounded-lg">
                <div className="w-8 h-8 rounded-lg bg-primary-500/20 flex items-center justify-center mb-2">
                  <span className="text-lg">📊</span>
                </div>
                <h3 className="font-medium text-surface-200 mb-1">Percentile Rankings</h3>
                <p className="text-sm text-surface-500">See how you compare to general population and trained lifters</p>
              </div>
              <div className="p-4 bg-surface-900/50 rounded-lg">
                <div className="w-8 h-8 rounded-lg bg-primary-500/20 flex items-center justify-center mb-2">
                  <span className="text-lg">⚖️</span>
                </div>
                <h3 className="font-medium text-surface-200 mb-1">Balance Analysis</h3>
                <p className="text-sm text-surface-500">Identify push/pull, upper/lower, and anterior/posterior imbalances</p>
              </div>
              <div className="p-4 bg-surface-900/50 rounded-lg">
                <div className="w-8 h-8 rounded-lg bg-primary-500/20 flex items-center justify-center mb-2">
                  <span className="text-lg">🎯</span>
                </div>
                <h3 className="font-medium text-surface-200 mb-1">Smart Recommendations</h3>
                <p className="text-sm text-surface-500">Get accurate weight suggestions for all exercises</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
