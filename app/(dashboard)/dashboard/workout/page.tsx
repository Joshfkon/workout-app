'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, LoadingAnimation } from '@/components/ui';
import Link from 'next/link';
import { createUntypedClient } from '@/lib/supabase/client';
import { MuscleRecoveryCard } from '@/components/dashboard/MuscleRecoveryCard';
import { generateWarmupProtocol } from '@/services/progressionEngine';
import type { WorkoutFolder, WorkoutTemplate, WorkoutTemplateExercise } from '@/types/templates';
import type { MuscleGroup } from '@/types/schema';

interface PlannedWorkout {
  id: string;
  planned_date: string;
  state: string;
  exercise_count: number;
}

interface ActiveMesocycle {
  id: string;
  name: string;
  startDate: string;
  weeks: number;
  currentWeek: number;
  daysPerWeek: number;
  workoutsThisWeek: number;
  split: string;
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
}

interface TodayWorkout {
  dayName: string;
  muscles: MuscleGroup[];
  dayNumber: number;
}

interface FolderWithTemplates extends WorkoutFolder {
  templates: (WorkoutTemplate & { exercises: WorkoutTemplateExercise[] })[];
  isExpanded: boolean;
}

type Goal = 'bulk' | 'cut' | 'maintain';

const FOLDER_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
];

const QUICK_TEMPLATES = [
  { name: 'Push', muscles: 'Chest, Shoulders, Triceps', icon: '💪', muscleIds: 'chest,shoulders,triceps' },
  { name: 'Pull', muscles: 'Back, Biceps, Rear Delts', icon: '🏋️', muscleIds: 'back,biceps,shoulders' },
  { name: 'Legs', muscles: 'Quads, Hamstrings, Glutes', icon: '🦵', muscleIds: 'quads,hamstrings,glutes,calves' },
  { name: 'Upper', muscles: 'Chest, Back, Shoulders, Arms', icon: '👆', muscleIds: 'chest,back,shoulders,biceps,triceps' },
  { name: 'Lower', muscles: 'Quads, Hamstrings, Glutes', icon: '👇', muscleIds: 'quads,hamstrings,glutes,calves' },
  { name: 'Full Body', muscles: 'All muscle groups', icon: '🔥', muscleIds: 'chest,back,shoulders,quads,biceps,triceps' },
];

/**
 * Get rest period based on exercise type and user's goal
 */
function getRestPeriod(isCompound: boolean, goal: Goal): number {
  if (goal === 'cut') {
    return isCompound ? 120 : 60;
  }
  if (goal === 'bulk') {
    return isCompound ? 180 : 90;
  }
  return isCompound ? 150 : 75;
}

// Get workout schedule based on split type
function getWorkoutForDay(splitType: string, dayOfWeek: number, daysPerWeek: number): TodayWorkout | null {
  const splits: Record<string, { dayName: string; muscles: MuscleGroup[] }[]> = {
    'Full Body': [
      { dayName: 'Full Body A', muscles: ['chest', 'back', 'quads', 'shoulders', 'triceps'] },
      { dayName: 'Full Body B', muscles: ['back', 'hamstrings', 'glutes', 'biceps', 'calves'] },
      { dayName: 'Full Body C', muscles: ['chest', 'quads', 'shoulders', 'biceps', 'abs'] },
    ],
    'Upper/Lower': [
      { dayName: 'Upper A', muscles: ['chest', 'back', 'shoulders', 'biceps', 'triceps'] },
      { dayName: 'Lower A', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
      { dayName: 'Upper B', muscles: ['back', 'chest', 'shoulders', 'triceps', 'biceps'] },
      { dayName: 'Lower B', muscles: ['hamstrings', 'quads', 'glutes', 'calves', 'abs'] },
    ],
    'PPL': [
      { dayName: 'Push', muscles: ['chest', 'shoulders', 'triceps'] },
      { dayName: 'Pull', muscles: ['back', 'biceps', 'shoulders'] },
      { dayName: 'Legs', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
      { dayName: 'Push 2', muscles: ['chest', 'shoulders', 'triceps'] },
      { dayName: 'Pull 2', muscles: ['back', 'biceps', 'shoulders'] },
      { dayName: 'Legs 2', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
    ],
    'Arnold': [
      { dayName: 'Chest & Back', muscles: ['chest', 'back'] },
      { dayName: 'Shoulders & Arms', muscles: ['shoulders', 'biceps', 'triceps'] },
      { dayName: 'Legs', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
    ],
    'Bro Split': [
      { dayName: 'Chest', muscles: ['chest'] },
      { dayName: 'Back', muscles: ['back'] },
      { dayName: 'Shoulders', muscles: ['shoulders'] },
      { dayName: 'Arms', muscles: ['biceps', 'triceps'] },
      { dayName: 'Legs', muscles: ['quads', 'hamstrings', 'glutes', 'calves'] },
    ],
  };

  const schedule = splits[splitType] || splits['Upper/Lower'];

  const trainingDayMaps: Record<number, number[]> = {
    2: [1, 4],
    3: [1, 3, 5],
    4: [1, 2, 4, 5],
    5: [1, 2, 3, 5, 6],
    6: [1, 2, 3, 4, 5, 6],
  };

  const trainingDays = trainingDayMaps[daysPerWeek] || trainingDayMaps[4];
  const dayIndex = trainingDays.indexOf(dayOfWeek);

  if (dayIndex === -1) {
    return null;
  }

  const workoutIndex = dayIndex % schedule.length;
  return {
    ...schedule[workoutIndex],
    dayNumber: dayIndex + 1,
  };
}

type TabType = 'workouts' | 'mesocycle';

export default function WorkoutPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('workouts');
  const [isStarting, setIsStarting] = useState(false);
  const [inProgressWorkout, setInProgressWorkout] = useState<PlannedWorkout | null>(null);
  const [activeMesocycle, setActiveMesocycle] = useState<ActiveMesocycle | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Template states
  const [folders, setFolders] = useState<FolderWithTemplates[]>([]);
  const [unfolderedTemplates, setUnfolderedTemplates] = useState<(WorkoutTemplate & { exercises: WorkoutTemplateExercise[] })[]>([]);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderColor, setFolderColor] = useState(FOLDER_COLORS[0]);
  const [templateName, setTemplateName] = useState('');
  const [templateFolderId, setTemplateFolderId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  // Mesocycle states
  const [mesocycles, setMesocycles] = useState<Mesocycle[]>([]);
  const [isStartingWorkout, setIsStartingWorkout] = useState(false);
  const [todayWorkout, setTodayWorkout] = useState<TodayWorkout | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const supabase = createUntypedClient();

  useEffect(() => {
    fetchWorkouts();
    fetchTemplates();
    fetchMesocycles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchTemplates() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [foldersResult, templatesResult, exercisesResult] = await Promise.all([
      supabase.from('workout_folders').select('*').eq('user_id', user.id).order('sort_order'),
      supabase.from('workout_templates').select('*').eq('user_id', user.id).order('sort_order'),
      supabase.from('workout_template_exercises').select('*').order('sort_order'),
    ]);

    const foldersData = foldersResult.data || [];
    const templatesData = templatesResult.data || [];
    const exercisesData = exercisesResult.data || [];

    const templatesWithExercises = templatesData.map((t: WorkoutTemplate) => ({
      ...t,
      exercises: exercisesData.filter((e: WorkoutTemplateExercise) => e.template_id === t.id),
    }));

    const foldersWithTemplates: FolderWithTemplates[] = foldersData.map((f: WorkoutFolder) => ({
      ...f,
      templates: templatesWithExercises.filter((t: WorkoutTemplate) => t.folder_id === f.id),
      isExpanded: true,
    }));

    setFolders(foldersWithTemplates);
    setUnfolderedTemplates(templatesWithExercises.filter((t: WorkoutTemplate) => !t.folder_id));
  }

  async function fetchWorkouts() {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setIsLoading(false);
      return;
    }

    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const weekStart = new Date(now);
    weekStart.setDate(diff);
    weekStart.setHours(0, 0, 0, 0);

    try {
      const [inProgressResult, mesocycleResult] = await Promise.all([
        supabase
          .from('workout_sessions')
          .select(`
            id,
            planned_date,
            state,
            exercise_blocks (id)
          `)
          .eq('user_id', user.id)
          .eq('state', 'in_progress')
          .maybeSingle(),

        supabase
          .from('mesocycles')
          .select(`
            id,
            name,
            start_date,
            total_weeks,
            days_per_week,
            split_type,
            workout_sessions!inner (
              id,
              state,
              completed_at
            )
          `)
          .eq('user_id', user.id)
          .eq('is_active', true)
          .gte('workout_sessions.completed_at', weekStart.toISOString())
          .maybeSingle(),
      ]);

      if (inProgressResult.data) {
        setInProgressWorkout({
          id: inProgressResult.data.id,
          planned_date: inProgressResult.data.planned_date,
          state: inProgressResult.data.state,
          exercise_count: inProgressResult.data.exercise_blocks?.length || 0,
        });
      }

      if (mesocycleResult.data) {
        const mesocycle = mesocycleResult.data;
        const startDate = new Date(mesocycle.start_date);
        const weeksSinceStart = Math.floor((now.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
        const currentWeek = Math.min(weeksSinceStart, mesocycle.total_weeks);

        const weeklyCount = mesocycle.workout_sessions?.filter(
          (s: any) => s.state === 'completed'
        ).length || 0;

        setActiveMesocycle({
          id: mesocycle.id,
          name: mesocycle.name,
          startDate: mesocycle.start_date,
          weeks: mesocycle.total_weeks,
          currentWeek,
          daysPerWeek: mesocycle.days_per_week || 3,
          workoutsThisWeek: weeklyCount,
          split: mesocycle.split_type || 'custom',
        });
      }
    } catch (error) {
      console.error('Error fetching workouts:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchMesocycles() {
    const { data, error } = await supabase
      .from('mesocycles')
      .select('*')
      .order('created_at', { ascending: false });

    if (data && !error) {
      setMesocycles(data);

      const active = data.find((m: Mesocycle) => m.state === 'active');
      if (active) {
        const today = new Date();
        const dayOfWeek = today.getDay() || 7;
        const workout = getWorkoutForDay(active.split_type, dayOfWeek, active.days_per_week);
        setTodayWorkout(workout);
      }
    }
  }

  const handleDeleteMesocycle = async (id: string) => {
    setDeletingId(id);
    try {
      const { data: sessions } = await supabase
        .from('workout_sessions')
        .select('id')
        .eq('mesocycle_id', id);

      if (sessions && sessions.length > 0) {
        const sessionIds = sessions.map((s: { id: string }) => s.id);
        await supabase
          .from('exercise_blocks')
          .delete()
          .in('workout_session_id', sessionIds);
        await supabase
          .from('workout_sessions')
          .delete()
          .eq('mesocycle_id', id);
      }

      await supabase
        .from('mesocycles')
        .delete()
        .eq('id', id);

      setMesocycles(mesocycles.filter(m => m.id !== id));
      setConfirmDeleteId(null);
    } catch (error) {
      console.error('Failed to delete mesocycle:', error);
    } finally {
      setDeletingId(null);
    }
  };

  const handleQuickStart = () => {
    setIsStarting(true);
    router.push('/dashboard/workout/new');
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow';
    } else {
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    }
  };

  function toggleFolder(folderId: string) {
    setFolders(prev => prev.map(f =>
      f.id === folderId ? { ...f, isExpanded: !f.isExpanded } : f
    ));
  }

  async function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!folderName.trim()) return;
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('workout_folders').insert({
        user_id: user.id,
        name: folderName.trim(),
        color: folderColor,
        sort_order: folders.length,
      });
      setFolderName('');
      setShowCreateFolder(false);
      await fetchTemplates();
    } catch (err) {
      console.error('Error creating folder:', err);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreateTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!templateName.trim()) return;
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('workout_templates').insert({
        user_id: user.id,
        name: templateName.trim(),
        folder_id: templateFolderId,
      }).select('id').single();
      setTemplateName('');
      setShowCreateTemplate(false);
      if (data) {
        router.push(`/dashboard/templates/${data.id}`);
      }
    } catch (err) {
      console.error('Error creating template:', err);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteTemplate(templateId: string) {
    if (!confirm('Delete this template?')) return;
    await supabase.from('workout_templates').delete().eq('id', templateId);
    await fetchTemplates();
    setOpenMenu(null);
  }

  async function handleDeleteFolder(folderId: string) {
    if (!confirm('Delete this folder? Templates will be moved out.')) return;
    await supabase.from('workout_templates').update({ folder_id: null }).eq('folder_id', folderId);
    await supabase.from('workout_folders').delete().eq('id', folderId);
    await fetchTemplates();
    setOpenMenu(null);
  }

  function formatExerciseList(exercises: WorkoutTemplateExercise[]) {
    if (!exercises?.length) return 'No exercises';
    const names = exercises.map(e => e.exercise_name);
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} & ${names.length - 2} more`;
  }

  // Start today's workout from the mesocycle
  const handleStartMesocycleWorkout = async () => {
    const activeMeso = mesocycles.find(m => m.state === 'active');
    if (!activeMeso || !todayWorkout) return;

    setIsStartingWorkout(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) throw new Error('Not logged in');

      const { data: userProfile } = await supabase
        .from('user_profiles')
        .select('goal')
        .eq('user_id', user.id)
        .single();

      const userGoal: Goal = (userProfile?.goal as Goal) || 'maintain';

      const today = new Date().toISOString().split('T')[0];
      const { data: existingWorkout } = await supabase
        .from('workout_sessions')
        .select('id')
        .eq('user_id', user.id)
        .eq('planned_date', today)
        .in('state', ['planned', 'in_progress'])
        .single();

      if (existingWorkout) {
        router.push(`/dashboard/workout/${existingWorkout.id}`);
        return;
      }

      const { data: session, error: sessionError } = await supabase
        .from('workout_sessions')
        .insert({
          user_id: user.id,
          mesocycle_id: activeMeso.id,
          planned_date: today,
          state: 'in_progress',
          started_at: new Date().toISOString(),
          completion_percent: 0,
        })
        .select()
        .single();

      if (sessionError || !session) throw sessionError || new Error('Failed to create session');

      const { data: exercises } = await supabase
        .from('exercises')
        .select('*')
        .in('primary_muscle', todayWorkout.muscles);

      if (exercises && exercises.length > 0) {
        type ExerciseRow = { id: string; name: string; primary_muscle: string; mechanic: string; default_rep_range: number[]; default_rir: number };
        const exercisesByMuscle: Record<string, ExerciseRow[]> = {};
        (exercises as ExerciseRow[]).forEach((ex: ExerciseRow) => {
          if (!exercisesByMuscle[ex.primary_muscle]) {
            exercisesByMuscle[ex.primary_muscle] = [];
          }
          exercisesByMuscle[ex.primary_muscle].push(ex);
        });

        const blocks = [];
        let order = 1;
        const seenMuscles = new Set<string>();

        for (const muscle of todayWorkout.muscles) {
          const muscleExercises = exercisesByMuscle[muscle] || [];
          const selected = muscleExercises.slice(0, Math.min(2, muscleExercises.length));

          let isFirstExerciseForMuscle = !seenMuscles.has(muscle);

          for (const exercise of selected) {
            const isCompound = exercise.mechanic === 'compound';

            let warmupSets: any[] = [];
            if (isFirstExerciseForMuscle && isCompound) {
              const repRange = (exercise.default_rep_range && exercise.default_rep_range.length >= 2
                ? [exercise.default_rep_range[0], exercise.default_rep_range[1]]
                : [8, 12]) as [number, number];

              warmupSets = generateWarmupProtocol({
                workingWeight: 60,
                exercise: {
                  id: exercise.id,
                  name: exercise.name,
                  primaryMuscle: exercise.primary_muscle,
                  secondaryMuscles: [],
                  mechanic: isCompound ? 'compound' : 'isolation',
                  defaultRepRange: repRange,
                  defaultRir: exercise.default_rir || 2,
                  minWeightIncrementKg: 2.5,
                  formCues: [],
                  commonMistakes: [],
                  equipmentRequired: [],
                  setupNote: '',
                  movementPattern: 'compound',
                },
                isFirstExercise: order === 1,
              });
              seenMuscles.add(muscle);
              isFirstExerciseForMuscle = false;
            }

            blocks.push({
              workout_session_id: session.id,
              exercise_id: exercise.id,
              order: order++,
              target_sets: isCompound ? 4 : 3,
              target_rep_range: exercise.default_rep_range || [8, 12],
              target_rir: exercise.default_rir || 2,
              target_weight_kg: 0,
              target_rest_seconds: getRestPeriod(isCompound, userGoal),
              suggestion_reason: `${todayWorkout.dayName} - Week ${activeMeso.current_week}`,
              warmup_protocol: { sets: warmupSets },
            });
          }
        }

        if (blocks.length > 0) {
          await supabase.from('exercise_blocks').insert(blocks);
        }
      }

      router.push(`/dashboard/workout/${session.id}`);
    } catch (error) {
      console.error('Failed to start workout:', error);
      setIsStartingWorkout(false);
    }
  };

  const activeMeso = mesocycles.find(m => m.state === 'active');
  const pastMesocycles = mesocycles.filter(m => m.state !== 'active');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Workouts</h1>
          <p className="text-surface-400 mt-1">Start a workout or view planned sessions</p>
        </div>
        <Button onClick={handleQuickStart} isLoading={isStarting}>
          <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Workout
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-surface-800/50 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('workouts')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'workouts'
              ? 'bg-surface-700 text-surface-100'
              : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          Workouts
        </button>
        <button
          onClick={() => setActiveTab('mesocycle')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'mesocycle'
              ? 'bg-surface-700 text-surface-100'
              : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          Mesocycle
        </button>
      </div>

      {activeTab === 'workouts' ? (
        <>
          {/* Active Mesocycle */}
          {activeMesocycle && (
            <Card className="border border-primary-500/20 bg-gradient-to-r from-primary-500/5 to-transparent">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="info" size="sm">Week {activeMesocycle.currentWeek}/{activeMesocycle.weeks}</Badge>
                      <span className="text-sm text-surface-400 capitalize">{activeMesocycle.split.replace('_', '/')} Split</span>
                    </div>
                    <h3 className="text-lg font-semibold text-surface-100 mt-1">{activeMesocycle.name}</h3>
                    <p className="text-sm text-surface-400">
                      {activeMesocycle.workoutsThisWeek} of {activeMesocycle.daysPerWeek} workouts this week
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1.5">
                      {Array.from({ length: activeMesocycle.daysPerWeek }).map((_, i) => (
                        <div
                          key={i}
                          className={`w-3 h-3 rounded-full ${
                            i < activeMesocycle.workoutsThisWeek
                              ? 'bg-success-500'
                              : 'bg-surface-700'
                          }`}
                        />
                      ))}
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setActiveTab('mesocycle')}>
                      View Plan →
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* AI-Planned Workout */}
          <Card className="border border-accent-500/30 bg-gradient-to-r from-accent-500/10 via-primary-500/5 to-transparent overflow-hidden relative">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-accent-500/20 to-transparent rounded-bl-full" />
            <CardContent className="p-6 relative">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent-500 to-primary-500 flex items-center justify-center flex-shrink-0">
                    <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-semibold text-surface-100">AI-Planned Workout</h3>
                      <Badge variant="info" size="sm">Smart</Badge>
                    </div>
                    <p className="text-surface-400 text-sm">
                      Get a personalized workout based on your recovery, goals, and training history
                    </p>
                  </div>
                </div>
                <Link href="/dashboard/workout/new?ai=true">
                  <Button className="whitespace-nowrap bg-gradient-to-r from-accent-500 to-primary-500 hover:from-accent-600 hover:to-primary-600">
                    <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Generate Workout
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* In-progress workout */}
          {inProgressWorkout && (
            <Card variant="elevated" className="border-2 border-warning-500/50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <Badge variant="warning">In Progress</Badge>
                      <h3 className="text-lg font-semibold text-surface-100">
                        Continue Your Workout
                      </h3>
                    </div>
                    <p className="text-surface-400 mt-1">
                      {inProgressWorkout.exercise_count} exercises • Started {formatDate(inProgressWorkout.planned_date)}
                    </p>
                  </div>
                  <Link href={`/dashboard/workout/${inProgressWorkout.id}`}>
                    <Button>Continue</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Muscle Recovery Card */}
          <MuscleRecoveryCard />

          {/* Empty state */}
          {!isLoading && !inProgressWorkout && !activeMesocycle && (
            <Card variant="elevated" className="overflow-hidden">
              <div className="p-8 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-800 flex items-center justify-center">
                  <svg className="w-8 h-8 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-surface-100">No planned workouts</h2>
                <p className="text-surface-400 mt-2 max-w-md mx-auto">
                  Start a quick workout or create a mesocycle to plan your training.
                </p>
                <div className="flex justify-center gap-3 mt-6">
                  <Link href="/dashboard/workout/new">
                    <Button>Start Quick Workout</Button>
                  </Link>
                  <Button variant="secondary" onClick={() => setActiveTab('mesocycle')}>
                    Create Mesocycle
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {/* Workout templates */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Workout Templates</CardTitle>
                <div className="flex gap-2">
                  <Button variant="primary" size="sm" onClick={() => setShowCreateTemplate(true)}>
                    + Template
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowCreateFolder(true)}>
                    📁
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Custom Templates - Folders */}
              {folders.map((folder) => (
                <div key={folder.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => toggleFolder(folder.id)}
                      className="flex items-center gap-2 text-sm font-medium text-surface-300 hover:text-surface-100"
                    >
                      <span style={{ color: folder.color }}>📁</span>
                      {folder.name} ({folder.templates.length})
                      <span className="text-xs">{folder.isExpanded ? '▼' : '▶'}</span>
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => setOpenMenu(openMenu === folder.id ? null : folder.id)}
                        className="p-1 text-surface-500 hover:text-surface-300"
                      >
                        •••
                      </button>
                      {openMenu === folder.id && (
                        <div className="absolute right-0 top-full mt-1 bg-surface-800 border border-surface-700 rounded-lg shadow-xl z-10 min-w-[120px]">
                          <button
                            onClick={() => { setTemplateFolderId(folder.id); setShowCreateTemplate(true); setOpenMenu(null); }}
                            className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-700"
                          >
                            Add Template
                          </button>
                          <button
                            onClick={() => handleDeleteFolder(folder.id)}
                            className="w-full px-3 py-2 text-left text-sm text-danger-400 hover:bg-surface-700"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  {folder.isExpanded && folder.templates.length > 0 && (
                    <div className="grid gap-2 sm:grid-cols-2 pl-5">
                      {folder.templates.map((template) => (
                        <TemplateCard
                          key={template.id}
                          template={template}
                          formatExerciseList={formatExerciseList}
                          onDelete={() => handleDeleteTemplate(template.id)}
                          menuOpen={openMenu === template.id}
                          onMenuToggle={() => setOpenMenu(openMenu === template.id ? null : template.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* Unfoldered Custom Templates */}
              {unfolderedTemplates.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {unfolderedTemplates.map((template) => (
                    <TemplateCard
                      key={template.id}
                      template={template}
                      formatExerciseList={formatExerciseList}
                      onDelete={() => handleDeleteTemplate(template.id)}
                      menuOpen={openMenu === template.id}
                      onMenuToggle={() => setOpenMenu(openMenu === template.id ? null : template.id)}
                    />
                  ))}
                </div>
              )}

              {/* Quick Start Templates */}
              <div>
                <p className="text-xs text-surface-500 uppercase tracking-wide mb-2">Quick Start</p>
                <div className="grid gap-2 grid-cols-3 sm:grid-cols-6">
                  {QUICK_TEMPLATES.map((template) => (
                    <Link
                      key={template.name}
                      href={`/dashboard/workout/new?template=${encodeURIComponent(template.name)}&muscles=${template.muscleIds}`}
                      className="p-3 bg-surface-800/50 rounded-lg text-center hover:bg-surface-800 transition-colors group"
                    >
                      <span className="text-xl block">{template.icon}</span>
                      <span className="text-xs font-medium text-surface-400 group-hover:text-surface-200">
                        {template.name}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        /* Mesocycle Tab Content */
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold text-surface-100">Mesocycle</h2>
              <div className="group relative">
                <button className="w-5 h-5 rounded-full bg-surface-700 hover:bg-surface-600 text-surface-400 text-xs flex items-center justify-center">
                  ?
                </button>
                <div className="absolute left-0 top-7 w-72 p-3 bg-surface-800 border border-surface-700 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                  <p className="text-sm font-medium text-surface-200 mb-1">What is a Mesocycle?</p>
                  <p className="text-xs text-surface-400">
                    A <span className="text-primary-400">mesocycle</span> is a training block lasting 4-8 weeks, designed to achieve specific goals. It includes progressive overload weeks followed by a deload week to manage fatigue and maximize adaptation.
                  </p>
                </div>
              </div>
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
            <Card className="text-center py-12">
              <LoadingAnimation type="random" size="md" text="Loading your training plan..." />
            </Card>
          ) : !activeMeso ? (
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
                    <div className="flex items-center justify-between">
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
                        <p className="text-sm text-surface-400 mt-3">
                          Week {activeMeso.current_week} • Day {todayWorkout.dayNumber} of {activeMeso.days_per_week}
                        </p>
                      </div>
                      <Button
                        size="lg"
                        onClick={handleStartMesocycleWorkout}
                        isLoading={isStartingWorkout}
                        className="shrink-0"
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
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>{activeMeso.name}</CardTitle>
                      <p className="text-surface-400 text-sm mt-1">{activeMeso.split_type}</p>
                    </div>
                    <Badge variant="success">Active</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-4">
                    <div className="text-center p-4 bg-surface-800/50 rounded-lg">
                      <p className="text-2xl font-bold text-surface-100">
                        {activeMeso.current_week}/{activeMeso.total_weeks}
                      </p>
                      <p className="text-sm text-surface-500">Current Week</p>
                    </div>
                    <div className="text-center p-4 bg-surface-800/50 rounded-lg">
                      <p className="text-2xl font-bold text-surface-100">{activeMeso.days_per_week}</p>
                      <p className="text-sm text-surface-500">Days/Week</p>
                    </div>
                    <div className="text-center p-4 bg-surface-800/50 rounded-lg">
                      <p className="text-2xl font-bold text-surface-100">{activeMeso.deload_week}</p>
                      <p className="text-sm text-surface-500">Deload Week</p>
                    </div>
                    <div className="text-center p-4 bg-surface-800/50 rounded-lg">
                      <p className="text-2xl font-bold text-primary-400">
                        {Math.round((activeMeso.current_week / activeMeso.total_weeks) * 100)}%
                      </p>
                      <p className="text-sm text-surface-500">Complete</p>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="mt-6">
                    <div className="flex justify-between text-sm text-surface-400 mb-2">
                      <span>Progress</span>
                      <span>Week {activeMeso.current_week} of {activeMeso.total_weeks}</span>
                    </div>
                    <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full transition-all"
                        style={{ width: `${(activeMeso.current_week / activeMeso.total_weeks) * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Week Schedule */}
                  <div className="mt-6 pt-6 border-t border-surface-800">
                    <h4 className="text-sm font-medium text-surface-300 mb-3">This Week&apos;s Schedule</h4>
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, index) => {
                        const dayNum = index + 1;
                        const workout = getWorkoutForDay(activeMeso.split_type, dayNum, activeMeso.days_per_week);
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

          {/* Programming Logic */}
          {activeMeso && (
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
                  <div className="p-4 bg-surface-800/50 rounded-lg">
                    <h3 className="font-medium text-surface-200 mb-2">🗓️ {activeMeso.split_type} Split</h3>
                    <p className="text-sm text-surface-400">
                      {activeMeso.split_type === 'Full Body'
                        ? 'Each workout hits all muscle groups. This maximizes training frequency (2-3x/week per muscle) which is great for strength and hypertrophy.'
                        : activeMeso.split_type === 'Upper/Lower'
                        ? 'Alternating between upper and lower body allows high volume per session while maintaining 2x/week frequency.'
                        : activeMeso.split_type === 'PPL'
                        ? 'Push/Pull/Legs groups muscles by movement pattern. Great for high volume training with 1-2x frequency.'
                        : 'Your split is designed to balance volume and recovery.'}
                    </p>
                  </div>

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

                  <div className="p-4 bg-surface-800/50 rounded-lg">
                    <h3 className="font-medium text-surface-200 mb-2">📈 Weekly Progression</h3>
                    <p className="text-sm text-surface-400">
                      Each week, we aim to add 1-2 reps or 2.5% weight to key lifts. This progressive overload drives adaptation.
                    </p>
                    <div className="flex gap-2 mt-2">
                      {Array.from({ length: activeMeso.total_weeks }).map((_, i) => (
                        <div
                          key={i}
                          className={`flex-1 h-2 rounded ${
                            i === activeMeso.total_weeks - 1
                              ? 'bg-warning-500'
                              : i < activeMeso.current_week
                              ? 'bg-primary-500'
                              : 'bg-surface-700'
                          }`}
                          title={i === activeMeso.total_weeks - 1 ? 'Deload' : `Week ${i + 1}`}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-surface-500 mt-1">
                      Weeks 1-{activeMeso.total_weeks - 1}: Build • Week {activeMeso.total_weeks}: Deload
                    </p>
                  </div>

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

                  <div className="p-4 bg-surface-800/50 rounded-lg">
                    <h3 className="font-medium text-surface-200 mb-2">⚡ Fatigue Tracking</h3>
                    <p className="text-sm text-surface-400">
                      We monitor systemic and local fatigue. High RPE, poor sleep, or missed reps trigger adaptive responses.
                    </p>
                    <div className="mt-2 p-2 bg-surface-900/50 rounded text-xs text-surface-500">
                      <strong className="text-surface-400">Auto-deload triggers:</strong> Performance drop, RPE 9.5+, poor recovery
                    </div>
                  </div>

                  <div className="p-4 bg-surface-800/50 rounded-lg">
                    <h3 className="font-medium text-surface-200 mb-2">😴 Deload Week</h3>
                    <p className="text-sm text-surface-400">
                      Week {activeMeso.deload_week} reduces volume by 50% while maintaining intensity. This lets accumulated fatigue dissipate.
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

          {/* What is a mesocycle */}
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

          {/* Past mesocycles */}
          {pastMesocycles.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Past Mesocycles</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {pastMesocycles.map((meso) => (
                    <div key={meso.id} className="flex items-center justify-between p-3 bg-surface-800/50 rounded-lg">
                      <div>
                        <p className="font-medium text-surface-200">{meso.name}</p>
                        <p className="text-sm text-surface-500">
                          {meso.split_type} • {meso.total_weeks} weeks • {new Date(meso.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={meso.state === 'completed' ? 'default' : 'warning'}>
                          {meso.state}
                        </Badge>
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
      )}

      {/* Create Folder Modal */}
      {showCreateFolder && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-900 border border-surface-700 rounded-xl w-full max-w-sm">
            <div className="p-4 border-b border-surface-700">
              <h2 className="text-lg font-semibold text-surface-100">Create Folder</h2>
            </div>
            <form onSubmit={handleCreateFolder}>
              <div className="p-4 space-y-4">
                <input
                  type="text"
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  placeholder="Folder name..."
                  className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100"
                  autoFocus
                />
                <div className="flex gap-2">
                  {FOLDER_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setFolderColor(color)}
                      className={`w-6 h-6 rounded-full ${folderColor === color ? 'ring-2 ring-white' : ''}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
              <div className="p-4 border-t border-surface-700 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setShowCreateFolder(false)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={isSubmitting}>Create</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Template Modal */}
      {showCreateTemplate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-900 border border-surface-700 rounded-xl w-full max-w-sm">
            <div className="p-4 border-b border-surface-700">
              <h2 className="text-lg font-semibold text-surface-100">Create Template</h2>
            </div>
            <form onSubmit={handleCreateTemplate}>
              <div className="p-4 space-y-4">
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Template name..."
                  className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100"
                  autoFocus
                />
                {folders.length > 0 && (
                  <select
                    value={templateFolderId || ''}
                    onChange={(e) => setTemplateFolderId(e.target.value || null)}
                    className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100"
                  >
                    <option value="">No folder</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="p-4 border-t border-surface-700 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => { setShowCreateTemplate(false); setTemplateFolderId(null); }}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={isSubmitting}>Create</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {openMenu && <div className="fixed inset-0 z-0" onClick={() => setOpenMenu(null)} />}
    </div>
  );
}

// Template Card Component
function TemplateCard({
  template,
  formatExerciseList,
  onDelete,
  menuOpen,
  onMenuToggle,
}: {
  template: WorkoutTemplate & { exercises: WorkoutTemplateExercise[] };
  formatExerciseList: (exercises: WorkoutTemplateExercise[]) => string;
  onDelete: () => void;
  menuOpen: boolean;
  onMenuToggle: () => void;
}) {
  return (
    <div className="relative p-3 bg-surface-800/50 rounded-lg hover:bg-surface-800 transition-colors group">
      <div className="flex justify-between items-start">
        <Link href={`/dashboard/templates/${template.id}`} className="flex-1">
          <h4 className="font-medium text-surface-200 group-hover:text-surface-100 text-sm">
            {template.name}
          </h4>
          <p className="text-xs text-surface-500 mt-0.5 line-clamp-1">
            {formatExerciseList(template.exercises)}
          </p>
        </Link>
        <div className="relative">
          <button onClick={onMenuToggle} className="p-1 text-surface-500 hover:text-surface-300 text-xs">
            •••
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-surface-800 border border-surface-700 rounded-lg shadow-xl z-20 min-w-[100px]">
              <Link
                href={`/dashboard/workout/new?template=${template.id}`}
                className="block px-3 py-2 text-sm text-surface-200 hover:bg-surface-700"
              >
                Start
              </Link>
              <Link
                href={`/dashboard/templates/${template.id}`}
                className="block px-3 py-2 text-sm text-surface-200 hover:bg-surface-700"
              >
                Edit
              </Link>
              <button
                onClick={onDelete}
                className="w-full px-3 py-2 text-left text-sm text-danger-400 hover:bg-surface-700"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
