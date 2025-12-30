'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, LoadingAnimation } from '@/components/ui';
import Link from 'next/link';
import { WorkoutCard } from '@/components/workout/WorkoutCard';

// Dynamically import ExercisesPage to avoid code duplication
const ExercisesTab = dynamic(() => import('../exercises/page'), {
  loading: () => (
    <div className="flex justify-center py-12">
      <LoadingAnimation type="random" size="lg" text="Loading exercises..." />
    </div>
  ),
});
import { createUntypedClient } from '@/lib/supabase/client';
import { MuscleRecoveryCard } from '@/components/dashboard/MuscleRecoveryCard';
import { generateWarmupProtocol } from '@/services/progressionEngine';
import { formatWeight, convertWeight } from '@/lib/utils';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
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

// History types
interface SetDetail {
  id: string;
  weight_kg: number;
  reps: number;
  rpe: number | null;
}

interface ExerciseDetail {
  id: string;
  exerciseId: string;
  name: string;
  primaryMuscle: string;
  sets: SetDetail[];
}

interface WorkoutHistory {
  id: string;
  planned_date: string;
  completed_at: string | null;
  state: string;
  session_rpe: number | null;
  session_notes: string | null;
  pump_rating: number | null;
  exercises: ExerciseDetail[];
  totalSets: number;
  totalVolume: number;
}

interface ExerciseHistoryEntry {
  date: string;
  displayDate: string;
  bestWeight: number;
  bestReps: number;
  totalSets: number;
  totalVolume: number;
  estimatedE1RM: number;
  sets: { weight: number; reps: number; rpe: number | null }[];
}

interface ExerciseHistoryData {
  exerciseId: string;
  exerciseName: string;
  primaryMuscle: string;
  history: ExerciseHistoryEntry[];
  currentE1RM: number;
  allTimeMaxE1RM: number;
  allTimeBestWeight: number;
  allTimeBestReps: number;
  totalSetsAllTime: number;
  progressPercent: number;
}

type Goal = 'bulk' | 'cut' | 'maintain';

// Calculate estimated 1RM using Brzycki formula
function calculateE1RM(weight: number, reps: number): number {
  if (reps === 1) return weight;
  if (reps > 12) return weight * (1 + reps / 30);
  return weight * (36 / (37 - reps));
}

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
function getRestPeriod(isCompound: boolean, goal: Goal, primaryMuscle?: MuscleGroup): number {
  // Ab exercises need shorter rest periods (recover faster)
  if (primaryMuscle === 'abs') {
    return goal === 'cut' ? 30 : 45;
  }

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

type TabType = 'workouts' | 'mesocycle' | 'history' | 'exercises';

// Card identifiers for reordering in the Workouts tab
type WorkoutTabCardId =
  | 'active-mesocycle'
  | 'ai-planned'
  | 'in-progress'
  | 'muscle-recovery'
  | 'templates';

const DEFAULT_WORKOUT_CARD_ORDER: WorkoutTabCardId[] = [
  'active-mesocycle',
  'ai-planned',
  'in-progress',
  'muscle-recovery',
  'templates',
];

const WORKOUT_CARD_ORDER_STORAGE_KEY = 'workout-card-order';
const WORKOUT_HIDDEN_CARDS_STORAGE_KEY = 'workout-hidden-cards';

// Card identifiers for reordering in the Mesocycle tab
type MesocycleTabCardId =
  | 'today-workout'
  | 'mesocycle-overview'
  | 'program-logic'
  | 'what-is-mesocycle'
  | 'past-mesocycles';

const DEFAULT_MESOCYCLE_CARD_ORDER: MesocycleTabCardId[] = [
  'today-workout',
  'mesocycle-overview',
  'program-logic',
  'what-is-mesocycle',
  'past-mesocycles',
];

const MESOCYCLE_CARD_ORDER_STORAGE_KEY = 'mesocycle-card-order';
const MESOCYCLE_HIDDEN_CARDS_STORAGE_KEY = 'mesocycle-hidden-cards';

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

  // History states
  const [workoutHistory, setWorkoutHistory] = useState<WorkoutHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyDeletingId, setHistoryDeletingId] = useState<string | null>(null);
  const [expandedWorkout, setExpandedWorkout] = useState<string | null>(null);
  const [selectedExercise, setSelectedExercise] = useState<ExerciseHistoryData | null>(null);
  const [loadingExercise, setLoadingExercise] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedWorkouts, setSelectedWorkouts] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const { preferences } = useUserPreferences();
  const unit = preferences.units;

  // Edit mode state for rearranging workout cards
  const [isEditMode, setIsEditMode] = useState(false);
  const [cardOrder, setCardOrder] = useState<WorkoutTabCardId[]>(DEFAULT_WORKOUT_CARD_ORDER);
  const [hiddenCards, setHiddenCards] = useState<Set<WorkoutTabCardId>>(new Set());

  // Edit mode state for rearranging mesocycle cards
  const [isMesocycleEditMode, setIsMesocycleEditMode] = useState(false);
  const [mesocycleCardOrder, setMesocycleCardOrder] = useState<MesocycleTabCardId[]>(DEFAULT_MESOCYCLE_CARD_ORDER);
  const [mesocycleHiddenCards, setMesocycleHiddenCards] = useState<Set<MesocycleTabCardId>>(new Set());

  const supabase = createUntypedClient();

  useEffect(() => {
    fetchWorkouts();
    fetchTemplates();
    fetchMesocycles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load card order and hidden cards from localStorage on mount
  useEffect(() => {
    try {
      const savedOrder = localStorage.getItem(WORKOUT_CARD_ORDER_STORAGE_KEY);
      if (savedOrder) {
        const parsed = JSON.parse(savedOrder) as WorkoutTabCardId[];
        // Validate that all cards are present (in case we add new cards in the future)
        const validOrder = DEFAULT_WORKOUT_CARD_ORDER.filter(id => parsed.includes(id));
        const newCards = DEFAULT_WORKOUT_CARD_ORDER.filter(id => !parsed.includes(id));
        setCardOrder([...parsed.filter(id => DEFAULT_WORKOUT_CARD_ORDER.includes(id)), ...newCards]);
      }
    } catch (e) {
      console.error('Failed to load card order:', e);
    }

    try {
      const savedHidden = localStorage.getItem(WORKOUT_HIDDEN_CARDS_STORAGE_KEY);
      if (savedHidden) {
        const parsed = JSON.parse(savedHidden) as WorkoutTabCardId[];
        // Only keep valid card IDs
        const validHidden = parsed.filter(id => DEFAULT_WORKOUT_CARD_ORDER.includes(id));
        setHiddenCards(new Set(validHidden));
      }
    } catch (e) {
      console.error('Failed to load hidden cards:', e);
    }

    // Load mesocycle card order
    try {
      const savedOrder = localStorage.getItem(MESOCYCLE_CARD_ORDER_STORAGE_KEY);
      if (savedOrder) {
        const parsed = JSON.parse(savedOrder) as MesocycleTabCardId[];
        const newCards = DEFAULT_MESOCYCLE_CARD_ORDER.filter(id => !parsed.includes(id));
        setMesocycleCardOrder([...parsed.filter(id => DEFAULT_MESOCYCLE_CARD_ORDER.includes(id)), ...newCards]);
      }
    } catch (e) {
      console.error('Failed to load mesocycle card order:', e);
    }

    // Load mesocycle hidden cards
    try {
      const savedHidden = localStorage.getItem(MESOCYCLE_HIDDEN_CARDS_STORAGE_KEY);
      if (savedHidden) {
        const parsed = JSON.parse(savedHidden) as MesocycleTabCardId[];
        const validHidden = parsed.filter(id => DEFAULT_MESOCYCLE_CARD_ORDER.includes(id));
        setMesocycleHiddenCards(new Set(validHidden));
      }
    } catch (e) {
      console.error('Failed to load mesocycle hidden cards:', e);
    }
  }, []);

  // Save card order to localStorage
  const saveCardOrder = useCallback((newOrder: WorkoutTabCardId[]) => {
    setCardOrder(newOrder);
    try {
      localStorage.setItem(WORKOUT_CARD_ORDER_STORAGE_KEY, JSON.stringify(newOrder));
    } catch (e) {
      console.error('Failed to save card order:', e);
    }
  }, []);

  // Move card up in order
  const moveCardUp = useCallback((cardId: WorkoutTabCardId) => {
    const index = cardOrder.indexOf(cardId);
    if (index > 0) {
      const newOrder = [...cardOrder];
      [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
      saveCardOrder(newOrder);
    }
  }, [cardOrder, saveCardOrder]);

  // Move card down in order
  const moveCardDown = useCallback((cardId: WorkoutTabCardId) => {
    const index = cardOrder.indexOf(cardId);
    if (index < cardOrder.length - 1) {
      const newOrder = [...cardOrder];
      [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
      saveCardOrder(newOrder);
    }
  }, [cardOrder, saveCardOrder]);

  // Toggle card visibility (hide/show)
  const toggleCardVisibility = useCallback((cardId: WorkoutTabCardId) => {
    setHiddenCards(prev => {
      const newHidden = new Set(prev);
      if (newHidden.has(cardId)) {
        newHidden.delete(cardId);
      } else {
        newHidden.add(cardId);
      }
      // Save to localStorage
      try {
        localStorage.setItem(WORKOUT_HIDDEN_CARDS_STORAGE_KEY, JSON.stringify(Array.from(newHidden)));
      } catch (e) {
        console.error('Failed to save hidden cards:', e);
      }
      return newHidden;
    });
  }, []);

  // Save mesocycle card order to localStorage
  const saveMesocycleCardOrder = useCallback((newOrder: MesocycleTabCardId[]) => {
    setMesocycleCardOrder(newOrder);
    try {
      localStorage.setItem(MESOCYCLE_CARD_ORDER_STORAGE_KEY, JSON.stringify(newOrder));
    } catch (e) {
      console.error('Failed to save mesocycle card order:', e);
    }
  }, []);

  // Move mesocycle card up in order
  const moveMesocycleCardUp = useCallback((cardId: MesocycleTabCardId) => {
    const index = mesocycleCardOrder.indexOf(cardId);
    if (index > 0) {
      const newOrder = [...mesocycleCardOrder];
      [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
      saveMesocycleCardOrder(newOrder);
    }
  }, [mesocycleCardOrder, saveMesocycleCardOrder]);

  // Move mesocycle card down in order
  const moveMesocycleCardDown = useCallback((cardId: MesocycleTabCardId) => {
    const index = mesocycleCardOrder.indexOf(cardId);
    if (index < mesocycleCardOrder.length - 1) {
      const newOrder = [...mesocycleCardOrder];
      [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
      saveMesocycleCardOrder(newOrder);
    }
  }, [mesocycleCardOrder, saveMesocycleCardOrder]);

  // Toggle mesocycle card visibility (hide/show)
  const toggleMesocycleCardVisibility = useCallback((cardId: MesocycleTabCardId) => {
    setMesocycleHiddenCards(prev => {
      const newHidden = new Set(prev);
      if (newHidden.has(cardId)) {
        newHidden.delete(cardId);
      } else {
        newHidden.add(cardId);
      }
      // Save to localStorage
      try {
        localStorage.setItem(MESOCYCLE_HIDDEN_CARDS_STORAGE_KEY, JSON.stringify(Array.from(newHidden)));
      } catch (e) {
        console.error('Failed to save mesocycle hidden cards:', e);
      }
      return newHidden;
    });
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

  // History functions
  async function fetchHistory() {
    setHistoryLoading(true);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setHistoryLoading(false);
      return;
    }

    const { data } = await supabase
      .from('workout_sessions')
      .select(`
        id,
        planned_date,
        completed_at,
        state,
        session_rpe,
        session_notes,
        pump_rating,
        exercise_blocks (
          id,
          order,
          exercise_id,
          exercises (
            id,
            name,
            primary_muscle
          ),
          set_logs (
            id,
            set_number,
            weight_kg,
            reps,
            rpe,
            is_warmup
          )
        )
      `)
      .eq('user_id', user.id)
      .in('state', ['completed', 'in_progress'])
      .order('completed_at', { ascending: false, nullsFirst: false });

    if (data) {
      const transformed: WorkoutHistory[] = data.map((workout: any) => {
        const exercises: ExerciseDetail[] = (workout.exercise_blocks || [])
          .sort((a: any, b: any) => a.order - b.order)
          .filter((block: any) => block.exercises)
          .map((block: any) => {
            const workingSets = (block.set_logs || [])
              .filter((set: any) => !set.is_warmup)
              .sort((a: any, b: any) => a.set_number - b.set_number);

            return {
              id: block.id,
              exerciseId: block.exercise_id,
              name: block.exercises.name,
              primaryMuscle: block.exercises.primary_muscle,
              sets: workingSets.map((set: any) => ({
                id: set.id,
                weight_kg: set.weight_kg,
                reps: set.reps,
                rpe: set.rpe,
              })),
            };
          });

        const totalSets = exercises.reduce((sum, ex) => sum + ex.sets.length, 0);
        const totalVolume = exercises.reduce((sum, ex) =>
          sum + ex.sets.reduce((setSum, set) => setSum + (set.weight_kg * set.reps), 0), 0
        );

        return {
          id: workout.id,
          planned_date: workout.planned_date,
          completed_at: workout.completed_at,
          state: workout.state,
          session_rpe: workout.session_rpe,
          session_notes: workout.session_notes,
          pump_rating: workout.pump_rating,
          exercises,
          totalSets,
          totalVolume,
        };
      });
      setWorkoutHistory(transformed);
    }

    setHistoryLoading(false);
  }

  const handleDeleteWorkout = async (workoutId: string, state: string) => {
    const action = state === 'in_progress' ? 'cancel' : 'delete';
    if (!confirm(`Are you sure you want to ${action} this workout? This cannot be undone.`)) {
      return;
    }

    setHistoryDeletingId(workoutId);
    try {
      const { data: blocks } = await supabase
        .from('exercise_blocks')
        .select('id')
        .eq('workout_session_id', workoutId);

      if (blocks && blocks.length > 0) {
        const blockIds = blocks.map((b: { id: string }) => b.id);
        await supabase.from('set_logs').delete().in('exercise_block_id', blockIds);
      }

      await supabase.from('exercise_blocks').delete().eq('workout_session_id', workoutId);
      await supabase.from('workout_sessions').delete().eq('id', workoutId);

      setWorkoutHistory(workoutHistory.filter(w => w.id !== workoutId));
    } catch (err) {
      console.error('Failed to delete workout:', err);
      alert('Failed to delete workout. Please try again.');
    } finally {
      setHistoryDeletingId(null);
    }
  };

  const toggleSelectMode = () => {
    setIsSelectMode(!isSelectMode);
    if (isSelectMode) {
      setSelectedWorkouts(new Set());
    }
  };

  const toggleWorkoutSelection = (workoutId: string) => {
    setSelectedWorkouts(prev => {
      const next = new Set(prev);
      if (next.has(workoutId)) {
        next.delete(workoutId);
      } else {
        next.add(workoutId);
      }
      return next;
    });
  };

  const selectAllWorkouts = () => {
    if (selectedWorkouts.size === workoutHistory.length) {
      setSelectedWorkouts(new Set());
    } else {
      setSelectedWorkouts(new Set(workoutHistory.map(w => w.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedWorkouts.size === 0) return;

    const count = selectedWorkouts.size;
    if (!confirm(`Are you sure you want to delete ${count} workout${count > 1 ? 's' : ''}? This cannot be undone.`)) {
      return;
    }

    setIsBulkDeleting(true);
    try {
      const workoutIds = Array.from(selectedWorkouts);

      const { data: blocks } = await supabase
        .from('exercise_blocks')
        .select('id')
        .in('workout_session_id', workoutIds);

      if (blocks && blocks.length > 0) {
        const blockIds = blocks.map((b: { id: string }) => b.id);
        await supabase.from('set_logs').delete().in('exercise_block_id', blockIds);
      }

      await supabase.from('exercise_blocks').delete().in('workout_session_id', workoutIds);
      await supabase.from('workout_sessions').delete().in('id', workoutIds);

      setWorkoutHistory(workoutHistory.filter(w => !selectedWorkouts.has(w.id)));
      setSelectedWorkouts(new Set());
      setIsSelectMode(false);
    } catch (err) {
      console.error('Failed to delete workouts:', err);
      alert('Failed to delete workouts. Please try again.');
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const fetchExerciseHistory = async (exerciseId: string, exerciseName: string, primaryMuscle: string) => {
    setLoadingExercise(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) return;

      const { data: blocks } = await supabase
        .from('exercise_blocks')
        .select(`
          id,
          workout_session_id,
          workout_sessions!inner (
            id,
            completed_at,
            state,
            user_id
          ),
          set_logs (
            id,
            weight_kg,
            reps,
            rpe,
            is_warmup,
            logged_at
          )
        `)
        .eq('exercise_id', exerciseId)
        .eq('workout_sessions.user_id', user.id)
        .eq('workout_sessions.state', 'completed')
        .order('workout_sessions(completed_at)', { ascending: true });

      if (!blocks || blocks.length === 0) {
        setSelectedExercise({
          exerciseId,
          exerciseName,
          primaryMuscle,
          history: [],
          currentE1RM: 0,
          allTimeMaxE1RM: 0,
          allTimeBestWeight: 0,
          allTimeBestReps: 0,
          totalSetsAllTime: 0,
          progressPercent: 0,
        });
        return;
      }

      const historyMap = new Map<string, ExerciseHistoryEntry>();
      let allTimeMaxE1RM = 0;
      let allTimeBestWeight = 0;
      let allTimeBestReps = 0;
      let totalSetsAllTime = 0;

      blocks.forEach((block: any) => {
        const session = block.workout_sessions;
        if (!session?.completed_at) return;

        const dateKey = session.completed_at.split('T')[0];
        const workingSets = (block.set_logs || []).filter((s: any) => !s.is_warmup);

        if (workingSets.length === 0) return;

        let sessionBestWeight = 0;
        let sessionBestReps = 0;
        let sessionBestE1RM = 0;
        let sessionVolume = 0;
        const sets: { weight: number; reps: number; rpe: number | null }[] = [];

        workingSets.forEach((set: any) => {
          const e1rm = calculateE1RM(set.weight_kg, set.reps);
          sets.push({ weight: set.weight_kg, reps: set.reps, rpe: set.rpe });
          sessionVolume += set.weight_kg * set.reps;

          if (e1rm > sessionBestE1RM) {
            sessionBestE1RM = e1rm;
            sessionBestWeight = set.weight_kg;
            sessionBestReps = set.reps;
          }

          if (e1rm > allTimeMaxE1RM) {
            allTimeMaxE1RM = e1rm;
          }
          if (set.weight_kg > allTimeBestWeight) {
            allTimeBestWeight = set.weight_kg;
          }
          if (set.reps > allTimeBestReps && set.weight_kg >= allTimeBestWeight * 0.8) {
            allTimeBestReps = set.reps;
          }
        });

        totalSetsAllTime += workingSets.length;

        if (historyMap.has(dateKey)) {
          const existing = historyMap.get(dateKey)!;
          if (sessionBestE1RM > existing.estimatedE1RM) {
            existing.estimatedE1RM = sessionBestE1RM;
            existing.bestWeight = sessionBestWeight;
            existing.bestReps = sessionBestReps;
          }
          existing.totalSets += workingSets.length;
          existing.totalVolume += sessionVolume;
          existing.sets.push(...sets);
        } else {
          historyMap.set(dateKey, {
            date: dateKey,
            displayDate: new Date(dateKey).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            bestWeight: sessionBestWeight,
            bestReps: sessionBestReps,
            totalSets: workingSets.length,
            totalVolume: sessionVolume,
            estimatedE1RM: sessionBestE1RM,
            sets,
          });
        }
      });

      const history = Array.from(historyMap.values()).sort((a, b) =>
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );

      const currentE1RM = history.length > 0 ? history[history.length - 1].estimatedE1RM : 0;
      const firstE1RM = history.length > 0 ? history[0].estimatedE1RM : 0;
      const progressPercent = firstE1RM > 0 ? ((currentE1RM - firstE1RM) / firstE1RM) * 100 : 0;

      setSelectedExercise({
        exerciseId,
        exerciseName,
        primaryMuscle,
        history,
        currentE1RM,
        allTimeMaxE1RM,
        allTimeBestWeight,
        allTimeBestReps,
        totalSetsAllTime,
        progressPercent,
      });
    } catch (err) {
      console.error('Failed to fetch exercise history:', err);
    } finally {
      setLoadingExercise(false);
    }
  };

  const toggleExpand = (workoutId: string) => {
    setExpandedWorkout(expandedWorkout === workoutId ? null : workoutId);
  };

  const formatHistoryDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Load history when switching to history tab
  useEffect(() => {
    if (activeTab === 'history' && workoutHistory.length === 0 && !historyLoading) {
      fetchHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

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
              target_rest_seconds: getRestPeriod(isCompound, userGoal, exercise.primary_muscle as MuscleGroup),
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
        <div className="flex items-center gap-2">
          {activeTab === 'workouts' && (
            <Button
              variant={isEditMode ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setIsEditMode(!isEditMode)}
              className={isEditMode ? 'bg-primary-500 hover:bg-primary-600' : ''}
            >
              {isEditMode ? (
                <>
                  <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Done
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit
                </>
              )}
            </Button>
          )}
          {activeTab === 'mesocycle' && (
            <Button
              variant={isMesocycleEditMode ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setIsMesocycleEditMode(!isMesocycleEditMode)}
              className={isMesocycleEditMode ? 'bg-primary-500 hover:bg-primary-600' : ''}
            >
              {isMesocycleEditMode ? (
                <>
                  <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Done
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit
                </>
              )}
            </Button>
          )}
          <Button onClick={handleQuickStart} isLoading={isStarting}>
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Workout
          </Button>
        </div>
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
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'history'
              ? 'bg-surface-700 text-surface-100'
              : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          History
        </button>
        <button
          onClick={() => setActiveTab('exercises')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'exercises'
              ? 'bg-surface-700 text-surface-100'
              : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          Exercises
        </button>
      </div>

      {activeTab === 'workouts' ? (
        <div className={`space-y-6 ${isEditMode ? 'pl-14' : ''}`}>
          {/* Render cards in order based on cardOrder */}
          {cardOrder.map((cardId, index) => {
            const isHidden = hiddenCards.has(cardId);
            // Skip hidden cards when not in edit mode
            if (isHidden && !isEditMode) return null;

            // Get visible cards for determining first/last
            const visibleCards = cardOrder.filter(id => isEditMode || !hiddenCards.has(id));
            const visibleIndex = visibleCards.indexOf(cardId);
            const isFirst = visibleIndex === 0;
            const isLast = visibleIndex === visibleCards.length - 1;

            // Render each card based on its ID
            switch (cardId) {
              case 'active-mesocycle':
                // Only render if there's an active mesocycle
                if (!activeMesocycle) return null;
                return (
                  <WorkoutCard
                    key={cardId}
                    id={cardId}
                    isEditMode={isEditMode}
                    isFirst={isFirst}
                    isLast={isLast}
                    isHidden={isHidden}
                    onMoveUp={() => moveCardUp(cardId)}
                    onMoveDown={() => moveCardDown(cardId)}
                    onToggleVisibility={() => toggleCardVisibility(cardId)}
                  >
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
                  </WorkoutCard>
                );

              case 'ai-planned':
                return (
                  <WorkoutCard
                    key={cardId}
                    id={cardId}
                    isEditMode={isEditMode}
                    isFirst={isFirst}
                    isLast={isLast}
                    isHidden={isHidden}
                    onMoveUp={() => moveCardUp(cardId)}
                    onMoveDown={() => moveCardDown(cardId)}
                    onToggleVisibility={() => toggleCardVisibility(cardId)}
                  >
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
                  </WorkoutCard>
                );

              case 'in-progress':
                // Only render if there's an in-progress workout
                if (!inProgressWorkout) return null;
                return (
                  <WorkoutCard
                    key={cardId}
                    id={cardId}
                    isEditMode={isEditMode}
                    isFirst={isFirst}
                    isLast={isLast}
                    isHidden={isHidden}
                    onMoveUp={() => moveCardUp(cardId)}
                    onMoveDown={() => moveCardDown(cardId)}
                    onToggleVisibility={() => toggleCardVisibility(cardId)}
                  >
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
                  </WorkoutCard>
                );

              case 'muscle-recovery':
                return (
                  <WorkoutCard
                    key={cardId}
                    id={cardId}
                    isEditMode={isEditMode}
                    isFirst={isFirst}
                    isLast={isLast}
                    isHidden={isHidden}
                    onMoveUp={() => moveCardUp(cardId)}
                    onMoveDown={() => moveCardDown(cardId)}
                    onToggleVisibility={() => toggleCardVisibility(cardId)}
                  >
                    <MuscleRecoveryCard />
                  </WorkoutCard>
                );

              case 'templates':
                return (
                  <WorkoutCard
                    key={cardId}
                    id={cardId}
                    isEditMode={isEditMode}
                    isFirst={isFirst}
                    isLast={isLast}
                    isHidden={isHidden}
                    onMoveUp={() => moveCardUp(cardId)}
                    onMoveDown={() => moveCardDown(cardId)}
                    onToggleVisibility={() => toggleCardVisibility(cardId)}
                  >
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
                  </WorkoutCard>
                );

              default:
                return null;
            }
          })}

          {/* Empty state - shown outside of the card order system */}
          {!isLoading && !inProgressWorkout && !activeMesocycle && !isEditMode && (
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
        </div>
      ) : activeTab === 'mesocycle' ? (
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
            <div className={`space-y-6 ${isMesocycleEditMode ? 'pl-14' : ''}`}>
              {/* Render cards in order based on mesocycleCardOrder */}
              {mesocycleCardOrder.map((cardId) => {
                const isHidden = mesocycleHiddenCards.has(cardId);
                // Skip hidden cards when not in edit mode
                if (isHidden && !isMesocycleEditMode) return null;

                // Get visible cards for determining first/last
                const visibleCards = mesocycleCardOrder.filter(id => isMesocycleEditMode || !mesocycleHiddenCards.has(id));
                const visibleIndex = visibleCards.indexOf(cardId);
                const isFirst = visibleIndex === 0;
                const isLast = visibleIndex === visibleCards.length - 1;

                // Render each card based on its ID
                switch (cardId) {
                  case 'today-workout':
                    return (
                      <WorkoutCard
                        key={cardId}
                        id={cardId}
                        isEditMode={isMesocycleEditMode}
                        isFirst={isFirst}
                        isLast={isLast}
                        isHidden={isHidden}
                        hiddenLabel="Hidden from mesocycle"
                        onMoveUp={() => moveMesocycleCardUp(cardId)}
                        onMoveDown={() => moveMesocycleCardDown(cardId)}
                        onToggleVisibility={() => toggleMesocycleCardVisibility(cardId)}
                      >
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
                      </WorkoutCard>
                    );

                  case 'mesocycle-overview':
                    return (
                      <WorkoutCard
                        key={cardId}
                        id={cardId}
                        isEditMode={isMesocycleEditMode}
                        isFirst={isFirst}
                        isLast={isLast}
                        isHidden={isHidden}
                        hiddenLabel="Hidden from mesocycle"
                        onMoveUp={() => moveMesocycleCardUp(cardId)}
                        onMoveDown={() => moveMesocycleCardDown(cardId)}
                        onToggleVisibility={() => toggleMesocycleCardVisibility(cardId)}
                      >
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
                      </WorkoutCard>
                    );

                  case 'program-logic':
                    return (
                      <WorkoutCard
                        key={cardId}
                        id={cardId}
                        isEditMode={isMesocycleEditMode}
                        isFirst={isFirst}
                        isLast={isLast}
                        isHidden={isHidden}
                        hiddenLabel="Hidden from mesocycle"
                        onMoveUp={() => moveMesocycleCardUp(cardId)}
                        onMoveDown={() => moveMesocycleCardDown(cardId)}
                        onToggleVisibility={() => toggleMesocycleCardVisibility(cardId)}
                      >
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
                      </WorkoutCard>
                    );

                  case 'what-is-mesocycle':
                    return (
                      <WorkoutCard
                        key={cardId}
                        id={cardId}
                        isEditMode={isMesocycleEditMode}
                        isFirst={isFirst}
                        isLast={isLast}
                        isHidden={isHidden}
                        hiddenLabel="Hidden from mesocycle"
                        onMoveUp={() => moveMesocycleCardUp(cardId)}
                        onMoveDown={() => moveMesocycleCardDown(cardId)}
                        onToggleVisibility={() => toggleMesocycleCardVisibility(cardId)}
                      >
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
                      </WorkoutCard>
                    );

                  case 'past-mesocycles':
                    // Only render if there are past mesocycles
                    if (pastMesocycles.length === 0) return null;
                    return (
                      <WorkoutCard
                        key={cardId}
                        id={cardId}
                        isEditMode={isMesocycleEditMode}
                        isFirst={isFirst}
                        isLast={isLast}
                        isHidden={isHidden}
                        hiddenLabel="Hidden from mesocycle"
                        onMoveUp={() => moveMesocycleCardUp(cardId)}
                        onMoveDown={() => moveMesocycleCardDown(cardId)}
                        onToggleVisibility={() => toggleMesocycleCardVisibility(cardId)}
                      >
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
                      </WorkoutCard>
                    );

                  default:
                    return null;
                }
              })}
            </div>
          )}
        </div>
      ) : activeTab === 'history' ? (
        /* History Tab Content */
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-surface-100">Workout History</h2>
              <p className="text-surface-400 text-sm mt-1">Your past training sessions</p>
            </div>
            {workoutHistory.length > 0 && (
              <div className="flex items-center gap-2">
                {isSelectMode && (
                  <>
                    <button
                      onClick={selectAllWorkouts}
                      className="px-3 py-1.5 text-sm text-surface-300 hover:text-surface-100 hover:bg-surface-800 rounded-lg transition-colors"
                    >
                      {selectedWorkouts.size === workoutHistory.length ? 'Deselect All' : 'Select All'}
                    </button>
                    {selectedWorkouts.size > 0 && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={handleBulkDelete}
                        disabled={isBulkDeleting}
                      >
                        {isBulkDeleting ? (
                          <span className="flex items-center gap-2">
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Deleting...
                          </span>
                        ) : (
                          `Delete ${selectedWorkouts.size} Selected`
                        )}
                      </Button>
                    )}
                  </>
                )}
                <Button
                  variant={isSelectMode ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={toggleSelectMode}
                >
                  {isSelectMode ? 'Cancel' : 'Select'}
                </Button>
              </div>
            )}
          </div>

          {historyLoading ? (
            <Card className="text-center py-12">
              <LoadingAnimation type="random" size="md" />
              <p className="text-surface-400 mt-4">Loading your workout history...</p>
            </Card>
          ) : workoutHistory.length === 0 ? (
            <Card className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-800 flex items-center justify-center">
                <svg className="w-8 h-8 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-surface-200">No workout history yet</h2>
              <p className="text-surface-500 mt-2 max-w-md mx-auto">
                Complete your first workout to start building your training history.
              </p>
              <Link href="/dashboard/workout/new">
                <Button className="mt-6">Start Your First Workout</Button>
              </Link>
            </Card>
          ) : (
            <div className="space-y-4">
              {workoutHistory.map((workout) => {
                const isExpanded = expandedWorkout === workout.id;
                const isSelected = selectedWorkouts.has(workout.id);

                return (
                  <Card key={workout.id} className={`overflow-hidden group relative ${isSelectMode && isSelected ? 'ring-2 ring-primary-500' : ''}`}>
                    {/* Checkbox for select mode */}
                    {isSelectMode && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleWorkoutSelection(workout.id);
                        }}
                        className="absolute top-4 left-4 z-10"
                      >
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'bg-primary-500 border-primary-500'
                            : 'border-surface-500 hover:border-surface-400'
                        }`}>
                          {isSelected && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      </button>
                    )}

                    {/* Delete button */}
                    {!isSelectMode && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDeleteWorkout(workout.id, workout.state);
                        }}
                        disabled={historyDeletingId === workout.id}
                        className="absolute top-3 right-3 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-danger-500/20 text-surface-500 hover:text-danger-400 transition-all z-10"
                        title={workout.state === 'in_progress' ? 'Cancel workout' : 'Delete workout'}
                      >
                        {historyDeletingId === workout.id ? (
                          <div className="w-4 h-4 border-2 border-danger-400 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        )}
                      </button>
                    )}

                    {/* Main clickable area */}
                    {isSelectMode ? (
                      <button
                        onClick={() => toggleWorkoutSelection(workout.id)}
                        className="block w-full text-left"
                      >
                        <div className={`p-4 sm:p-6 hover:bg-surface-800/30 transition-colors cursor-pointer ${isSelectMode ? 'pl-12' : ''}`}>
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                            <div className="flex-1 pr-8">
                              <div className="flex items-center gap-3 mb-2">
                                <h3 className="text-lg font-semibold text-surface-100">
                                  {workout.completed_at
                                    ? formatHistoryDate(workout.completed_at)
                                    : formatHistoryDate(workout.planned_date)}
                                </h3>
                                <Badge
                                  variant={workout.state === 'completed' ? 'success' : 'warning'}
                                  size="sm"
                                >
                                  {workout.state === 'completed' ? 'Completed' : 'In Progress'}
                                </Badge>
                              </div>
                              <div className="flex flex-wrap gap-4 text-sm text-surface-400">
                                {workout.completed_at && (
                                  <span>Finished at {formatTime(workout.completed_at)}</span>
                                )}
                                <span>{workout.exercises.length} exercises</span>
                                <span>{workout.totalSets} sets</span>
                                <span>{formatWeight(workout.totalVolume, unit)} total</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </button>
                    ) : (
                      <Link href={`/dashboard/workout/${workout.id}`} className="block">
                        <div className="p-4 sm:p-6 hover:bg-surface-800/30 transition-colors cursor-pointer">
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                            <div className="flex-1 pr-8">
                              <div className="flex items-center gap-3 mb-2">
                                <h3 className="text-lg font-semibold text-surface-100">
                                  {workout.completed_at
                                    ? formatHistoryDate(workout.completed_at)
                                    : formatHistoryDate(workout.planned_date)}
                                </h3>
                                <Badge
                                  variant={workout.state === 'completed' ? 'success' : 'warning'}
                                  size="sm"
                                >
                                  {workout.state === 'completed' ? 'Completed' : 'In Progress'}
                                </Badge>
                                {workout.state === 'in_progress' && (
                                  <Badge variant="info" size="sm">
                                    Continue →
                                  </Badge>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-4 text-sm text-surface-400">
                                {workout.completed_at && (
                                  <span>Finished at {formatTime(workout.completed_at)}</span>
                                )}
                                <span>{workout.exercises.length} exercises</span>
                                <span>{workout.totalSets} sets</span>
                                <span>{formatWeight(workout.totalVolume, unit)} total</span>
                                {workout.session_rpe && (
                                  <span className="flex items-center gap-1">
                                    RPE: <span className={workout.session_rpe >= 8 ? 'text-danger-400' : workout.session_rpe >= 6 ? 'text-warning-400' : 'text-surface-300'}>{workout.session_rpe}</span>
                                  </span>
                                )}
                                {workout.pump_rating && (
                                  <span>
                                    {workout.pump_rating === 5 && '🔥'}
                                    {workout.pump_rating === 4 && '😄'}
                                    {workout.pump_rating === 3 && '😊'}
                                    {workout.pump_rating === 2 && '🙂'}
                                    {workout.pump_rating === 1 && '😐'}
                                  </span>
                                )}
                              </div>
                              {workout.session_notes && (
                                <p className="mt-2 text-sm text-surface-500 line-clamp-2">
                                  {workout.session_notes}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </Link>
                    )}

                    {/* Exercise summary */}
                    {workout.exercises.length > 0 && !isSelectMode && (
                      <div className="px-4 sm:px-6 pb-4 sm:pb-6 pt-0 border-t border-surface-800">
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleExpand(workout.id);
                          }}
                          className="flex items-center gap-2 text-sm text-surface-400 hover:text-surface-200 transition-colors py-3"
                        >
                          <svg
                            className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          {isExpanded ? 'Hide details' : 'Show exercise details'}
                        </button>

                        {/* Quick exercise list */}
                        {!isExpanded && (
                          <div className="flex flex-wrap gap-2">
                            {workout.exercises.map((exercise) => (
                              <button
                                key={exercise.id}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  fetchExerciseHistory(exercise.exerciseId, exercise.name, exercise.primaryMuscle);
                                }}
                                className="px-2 py-1 bg-surface-800 hover:bg-surface-700 rounded text-xs text-surface-300 transition-colors"
                              >
                                {exercise.name} ({exercise.sets.length})
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Detailed exercise breakdown */}
                        {isExpanded && (
                          <div className="space-y-4">
                            {workout.exercises.map((exercise) => (
                              <div key={exercise.id} className="bg-surface-800/50 rounded-lg p-3">
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    fetchExerciseHistory(exercise.exerciseId, exercise.name, exercise.primaryMuscle);
                                  }}
                                  className="flex items-center justify-between mb-2 w-full text-left group/ex"
                                >
                                  <h4 className="font-medium text-surface-200 group-hover/ex:text-primary-400 transition-colors">
                                    {exercise.name}
                                    <svg className="w-4 h-4 inline ml-2 opacity-0 group-hover/ex:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                    </svg>
                                  </h4>
                                  <Badge variant="default" size="sm">
                                    {exercise.primaryMuscle}
                                  </Badge>
                                </button>

                                {exercise.sets.length > 0 ? (
                                  <div className="space-y-1">
                                    {exercise.sets.map((set, idx) => (
                                      <div
                                        key={set.id}
                                        className="flex items-center gap-4 text-sm py-1 px-2 rounded hover:bg-surface-700/50"
                                      >
                                        <span className="text-surface-500 w-8">#{idx + 1}</span>
                                        <span className="text-surface-200 font-medium">
                                          {formatWeight(set.weight_kg, unit)}
                                        </span>
                                        <span className="text-surface-400">×</span>
                                        <span className="text-surface-200 font-medium">
                                          {set.reps} reps
                                        </span>
                                        {set.rpe && (
                                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                                            set.rpe >= 9 ? 'bg-danger-500/20 text-danger-400' :
                                            set.rpe >= 7 ? 'bg-warning-500/20 text-warning-400' :
                                            'bg-surface-700 text-surface-400'
                                          }`}>
                                            RPE {set.rpe}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-sm text-surface-500">No sets recorded</p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Exercises Tab Content */
        <ExercisesTab />
      )}

      {/* Exercise History Modal */}
      {selectedExercise && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-surface-900 rounded-xl max-w-3xl w-full max-h-[90vh] overflow-hidden shadow-2xl border border-surface-700">
            <div className="p-4 border-b border-surface-800 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-surface-100">{selectedExercise.exerciseName}</h2>
                <p className="text-sm text-surface-400 capitalize">{selectedExercise.primaryMuscle}</p>
              </div>
              <button
                onClick={() => setSelectedExercise(null)}
                className="p-2 hover:bg-surface-800 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 overflow-y-auto max-h-[calc(90vh-80px)]">
              {loadingExercise ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
                </div>
              ) : selectedExercise.history.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-surface-400">No history found for this exercise</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Stats cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-surface-800 rounded-lg p-3 text-center">
                      <p className="text-xs text-surface-500 uppercase">Current E1RM</p>
                      <p className="text-xl font-bold text-primary-400">
                        {formatWeight(selectedExercise.currentE1RM, unit)}
                      </p>
                    </div>
                    <div className="bg-surface-800 rounded-lg p-3 text-center">
                      <p className="text-xs text-surface-500 uppercase">All-Time Best</p>
                      <p className="text-xl font-bold text-success-400">
                        {formatWeight(selectedExercise.allTimeMaxE1RM, unit)}
                      </p>
                    </div>
                    <div className="bg-surface-800 rounded-lg p-3 text-center">
                      <p className="text-xs text-surface-500 uppercase">Best Lift</p>
                      <p className="text-xl font-bold text-surface-200">
                        {formatWeight(selectedExercise.allTimeBestWeight, unit)}
                      </p>
                      <p className="text-xs text-surface-500">× {selectedExercise.allTimeBestReps} reps</p>
                    </div>
                    <div className="bg-surface-800 rounded-lg p-3 text-center">
                      <p className="text-xs text-surface-500 uppercase">Progress</p>
                      <p className={`text-xl font-bold ${selectedExercise.progressPercent >= 0 ? 'text-success-400' : 'text-danger-400'}`}>
                        {selectedExercise.progressPercent >= 0 ? '+' : ''}{selectedExercise.progressPercent.toFixed(1)}%
                      </p>
                      <p className="text-xs text-surface-500">{selectedExercise.totalSetsAllTime} total sets</p>
                    </div>
                  </div>

                  {/* Progress chart */}
                  {selectedExercise.history.length > 1 && (
                    <div className="bg-surface-800 rounded-lg p-4">
                      <h3 className="text-sm font-semibold text-surface-300 mb-4">Estimated 1RM Progress</h3>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={selectedExercise.history.map(h => ({
                            date: h.displayDate,
                            e1rm: Math.round(convertWeight(h.estimatedE1RM, 'kg', unit)),
                            weight: Math.round(convertWeight(h.bestWeight, 'kg', unit)),
                          }))} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis
                              dataKey="date"
                              stroke="#9CA3AF"
                              tick={{ fontSize: 11 }}
                              interval="preserveStartEnd"
                            />
                            <YAxis
                              stroke="#9CA3AF"
                              tick={{ fontSize: 11 }}
                              domain={['auto', 'auto']}
                              tickFormatter={(value) => `${value}`}
                            />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: '#1F2937',
                                border: '1px solid #374151',
                                borderRadius: '8px',
                              }}
                              labelStyle={{ color: '#9CA3AF' }}
                              formatter={(value: number, name: string) => [
                                `${value} ${unit}`,
                                name === 'e1rm' ? 'Est. 1RM' : 'Best Weight'
                              ]}
                            />
                            <Line
                              type="monotone"
                              dataKey="e1rm"
                              stroke="#8B5CF6"
                              strokeWidth={2}
                              dot={{ fill: '#8B5CF6', strokeWidth: 0, r: 4 }}
                              activeDot={{ r: 6 }}
                            />
                            <ReferenceLine
                              y={Math.round(convertWeight(selectedExercise.allTimeMaxE1RM, 'kg', unit))}
                              stroke="#22C55E"
                              strokeDasharray="5 5"
                              label={{ value: 'PR', fill: '#22C55E', fontSize: 11 }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* History list */}
                  <div>
                    <h3 className="text-sm font-semibold text-surface-300 mb-3">Workout History</h3>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {[...selectedExercise.history].reverse().map((entry, idx) => (
                        <div key={idx} className="bg-surface-800/50 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-surface-200">
                              {new Date(entry.date).toLocaleDateString('en-US', {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </span>
                            <Badge variant="info" size="sm">
                              E1RM: {formatWeight(entry.estimatedE1RM, unit)}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {entry.sets.map((set, setIdx) => (
                              <span
                                key={setIdx}
                                className="px-2 py-1 bg-surface-700 rounded text-xs text-surface-300"
                              >
                                {formatWeight(set.weight, unit)} × {set.reps}
                                {set.rpe && <span className="text-surface-500"> @{set.rpe}</span>}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
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
