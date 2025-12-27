'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Card, Input, Badge, Button, LoadingAnimation, SkeletonExercise } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { MUSCLE_GROUPS } from '@/types/schema';
import { EQUIPMENT_OPTIONS } from '@/lib/exercises/types';
import { formatWeight, convertWeight } from '@/lib/utils';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { useExercisePreferences } from '@/hooks/useExercisePreferences';
import { ExerciseOptionsMenu } from '@/components/exercises/ExerciseOptionsMenu';
import { ExerciseStatusModal } from '@/components/exercises/ExerciseStatusModal';
import type { ExerciseVisibilityStatus, ExerciseHideReason } from '@/types/user-exercise-preferences';
import { batchCompleteAllExercises } from '@/lib/actions/exercise-completion';

// Dynamic import for charts - only loaded when user expands an exercise
const ExerciseHistoryCharts = dynamic(
  () => import('@/components/exercises/ExerciseHistoryCharts').then(m => m.ExerciseHistoryCharts),
  {
    ssr: false,
    loading: () => <div className="h-48 animate-pulse bg-surface-700 rounded" />,
  }
);

interface Exercise {
  id: string;
  name: string;
  primary_muscle: string;
  secondary_muscles: string[];
  mechanic: 'compound' | 'isolation';
  form_cues: string[];
  common_mistakes: string[];
  equipment_required: string[];
  equipment?: string;
  movement_pattern?: string;
  is_bodyweight?: boolean;
  bodyweight_type?: 'pure' | 'weighted_possible' | 'assisted_possible' | 'both' | null;
  assistance_type?: 'machine' | 'band' | 'partner' | null;
  is_custom?: boolean;
  // Hypertrophy scoring (Nippard methodology)
  hypertrophy_tier?: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
  stretch_under_load?: number;
  resistance_profile?: number;
  progression_ease?: number;
}

// Get color classes for hypertrophy tier badge
function getTierColorClasses(tier: string): string {
  switch (tier) {
    case 'S': return 'bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-bold';
    case 'A': return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
    case 'B': return 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
    case 'C': return 'bg-surface-600 text-surface-300';
    case 'D': return 'bg-orange-500/20 text-orange-400 border border-orange-500/30';
    case 'F': return 'bg-red-500/20 text-red-400 border border-red-500/30';
    default: return 'bg-surface-700 text-surface-400';
  }
}

// Rating bar component
function RatingBar({ label, value, maxValue = 5 }: { label: string; value: number; maxValue?: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-surface-500 w-20">{label}</span>
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`w-4 h-2 rounded-sm ${
              i <= value
                ? value >= 4 ? 'bg-emerald-500' : value >= 3 ? 'bg-blue-500' : 'bg-amber-500'
                : 'bg-surface-700'
            }`}
          />
        ))}
      </div>
      <span className="text-xs text-surface-400">{value}/{maxValue}</span>
    </div>
  );
}

interface SessionData {
  date: string;
  displayDate: string;
  volume: number;
  e1rm: number;
  bestWeight: number;
  bestReps: number;
  sets: number;
}

interface ExerciseHistory {
  lastWorkoutDate: string;
  lastWorkoutSets: { weightKg: number; reps: number; rpe?: number }[];
  estimatedE1RM: number;
  personalRecord: { weightKg: number; reps: number; e1rm: number; date: string } | null;
  totalSessions: number;
  chartData: SessionData[];
}

// Calculate E1RM using Brzycki formula
function calculateE1RM(weight: number, reps: number): number {
  if (reps === 1) return weight;
  if (reps > 12) return weight * (1 + reps / 30);
  return weight * (36 / (37 - reps));
}

export default function ExercisesPage() {
  const [mounted, setMounted] = useState(false);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);
  const [selectedEquipment, setSelectedEquipment] = useState<string | null>(null);
  const [expandedExercise, setExpandedExercise] = useState<string | null>(null);
  const [exerciseHistories, setExerciseHistories] = useState<Record<string, ExerciseHistory>>({});
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null);
  const [activeChart, setActiveChart] = useState<'e1rm' | 'volume' | 'best'>('e1rm');
  const { preferences } = useUserPreferences();
  const unit = preferences?.units || 'kg'; // Default fallback

  // Edit exercise state
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);
  const [editData, setEditData] = useState<{
    primaryMuscle: string;
    isBodyweight: boolean;
    bodyweightType: 'pure' | 'weighted_possible' | 'assisted_possible' | 'both' | null;
    assistanceType: 'machine' | 'band' | 'partner' | null;
    equipment: string;
    equipmentRequired: string[];
    movementPattern: string;
    secondaryMuscles: string[];
    hypertrophyTier?: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
    defaultRepRangeMin?: number;
    defaultRepRangeMax?: number;
    defaultRir?: number;
    setupNote?: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showAdvancedFields, setShowAdvancedFields] = useState(false);
  const [equipmentTypes, setEquipmentTypes] = useState<Array<{ id: string; name: string }>>([]);

  // Exercise preferences
  const {
    getExerciseStatus,
    muteExercise,
    archiveExercise,
    restoreExercise,
    summary: prefsSummary,
    isLoading: prefsLoading
  } = useExercisePreferences();
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'muted' | 'archived'>('all');
  const [statusModalExercise, setStatusModalExercise] = useState<{ id: string; name: string; action: 'mute' | 'archive' } | null>(null);
  const [deletingExercise, setDeletingExercise] = useState<{ id: string; name: string; isCustom: boolean } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  
  // Batch completion state
  const [isBatchCompleting, setIsBatchCompleting] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; exerciseName: string } | null>(null);
  const [batchResult, setBatchResult] = useState<{ processed: number; updated: number; skipped: number; errors: number } | null>(null);

  // Set mounted flag to prevent hydration mismatches
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    async function fetchExercises() {
      const supabase = createUntypedClient();
      const { data, error } = await supabase
        .from('exercises')
        .select('id, name, primary_muscle, secondary_muscles, mechanic, form_cues, common_mistakes, equipment_required, equipment, movement_pattern, is_bodyweight, bodyweight_type, assistance_type, is_custom, hypertrophy_tier, stretch_under_load, resistance_profile, progression_ease, demo_gif_url, demo_thumbnail_url, youtube_video_id')
        .order('name');

      if (data && !error) {
        setExercises(data);
      }
      setIsLoading(false);
    }

    if (mounted) {
      fetchExercises();
    }
  }, [mounted]);

  const fetchExerciseHistory = async (exerciseId: string) => {
    if (exerciseHistories[exerciseId]) return; // Already loaded
    
    setLoadingHistory(exerciseId);
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setLoadingHistory(null);
        return;
      }

      const { data: historyBlocks } = await supabase
        .from('exercise_blocks')
        .select(`
          id,
          workout_sessions!inner (
            id,
            completed_at,
            state,
            user_id
          ),
          set_logs (
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
        .order('workout_sessions(completed_at)', { ascending: true })
        .limit(50);

      if (historyBlocks && historyBlocks.length > 0) {
        let bestE1RM = 0;
        let personalRecord: ExerciseHistory['personalRecord'] = null;
        const sessionMap = new Map<string, SessionData>();

        historyBlocks.forEach((block: any) => {
          const session = block.workout_sessions;
          if (!session?.completed_at) return;

          const sessionId = session.id;
          const date = session.completed_at;
          // Use a consistent date format to avoid hydration mismatches
          const dateObj = new Date(date);
          const displayDate = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;

          const sets = (block.set_logs || []).filter((s: any) => !s.is_warmup);
          
          let sessionVolume = 0;
          let sessionBestE1RM = 0;
          let sessionBestWeight = 0;
          let sessionBestReps = 0;

          sets.forEach((set: any) => {
            const weight = set.weight_kg || 0;
            const reps = set.reps || 0;
            sessionVolume += weight * reps;
            
            const e1rm = calculateE1RM(weight, reps);
            if (e1rm > sessionBestE1RM) {
              sessionBestE1RM = e1rm;
              sessionBestWeight = weight;
              sessionBestReps = reps;
            }

            if (e1rm > bestE1RM) {
              bestE1RM = e1rm;
              personalRecord = {
                weightKg: weight,
                reps: reps,
                e1rm,
                date,
              };
            }
          });

          // Aggregate by session (in case of multiple blocks per session)
          if (sessionMap.has(sessionId)) {
            const existing = sessionMap.get(sessionId)!;
            existing.volume += sessionVolume;
            existing.sets += sets.length;
            if (sessionBestE1RM > existing.e1rm) {
              existing.e1rm = sessionBestE1RM;
              existing.bestWeight = sessionBestWeight;
              existing.bestReps = sessionBestReps;
            }
          } else {
            sessionMap.set(sessionId, {
              date,
              displayDate,
              volume: sessionVolume,
              e1rm: sessionBestE1RM,
              bestWeight: sessionBestWeight,
              bestReps: sessionBestReps,
              sets: sets.length,
            });
          }
        });

        const chartData = Array.from(sessionMap.values()).sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );

        // Get the last session's sets for display
        const lastBlock = historyBlocks[historyBlocks.length - 1];
        const lastSets = ((lastBlock.set_logs as any[]) || [])
          .filter((s: any) => !s.is_warmup)
          .map((s: any) => ({
            weightKg: s.weight_kg,
            reps: s.reps,
            rpe: s.rpe,
          }));

        setExerciseHistories(prev => ({
          ...prev,
          [exerciseId]: {
            lastWorkoutDate: chartData[chartData.length - 1]?.date || '',
            lastWorkoutSets: lastSets,
            estimatedE1RM: chartData[chartData.length - 1]?.e1rm || 0,
            personalRecord,
            totalSessions: chartData.length,
            chartData,
          },
        }));
      } else {
        // No history found
        setExerciseHistories(prev => ({
          ...prev,
          [exerciseId]: {
            lastWorkoutDate: '',
            lastWorkoutSets: [],
            estimatedE1RM: 0,
            personalRecord: null,
            totalSessions: 0,
            chartData: [],
          },
        }));
      }
    } catch (err) {
      console.error('Failed to fetch exercise history:', err);
    } finally {
      setLoadingHistory(null);
    }
  };

  const toggleExpand = (exerciseId: string) => {
    if (expandedExercise === exerciseId) {
      setExpandedExercise(null);
    } else {
      setExpandedExercise(exerciseId);
      fetchExerciseHistory(exerciseId);
    }
  };

  const handleEditExercise = (exercise: Exercise) => {
    setEditingExercise(exercise);
    setEditData({
      primaryMuscle: exercise.primary_muscle,
      isBodyweight: exercise.is_bodyweight || false,
      bodyweightType: exercise.bodyweight_type || null,
      assistanceType: exercise.assistance_type || null,
      equipment: exercise.equipment || 'barbell',
      equipmentRequired: Array.isArray(exercise.equipment_required) ? exercise.equipment_required : [],
      movementPattern: exercise.movement_pattern || 'compound',
      secondaryMuscles: Array.isArray(exercise.secondary_muscles) ? exercise.secondary_muscles : [],
      hypertrophyTier: exercise.hypertrophy_tier,
    });
    setShowAdvancedFields(false);
    setSaveResult(null);
  };

  const handleSaveExercise = async () => {
    if (!editingExercise || !editData) return;
    
    setIsSaving(true);
    setSaveResult(null);
    
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setSaveResult({ success: false, message: '❌ You must be logged in to edit exercises' });
        return;
      }
      
      // Build update payload
      const updatePayload: any = {
        primary_muscle: editData.primaryMuscle,
        is_bodyweight: editData.isBodyweight,
        bodyweight_type: editData.bodyweightType,
        assistance_type: editData.assistanceType,
        equipment: editData.equipment,
        equipment_required: editData.equipmentRequired.length > 0 ? editData.equipmentRequired : [],
        movement_pattern: editData.movementPattern,
        secondary_muscles: editData.secondaryMuscles || [],
        hypertrophy_tier: editData.hypertrophyTier,
        default_rep_range: editData.defaultRepRangeMin && editData.defaultRepRangeMax
          ? [editData.defaultRepRangeMin, editData.defaultRepRangeMax]
          : undefined,
        default_rir: editData.defaultRir,
        setup_note: editData.setupNote,
      };
      
      // Remove null/undefined values
      Object.keys(updatePayload).forEach(key => {
        if (updatePayload[key] === null || updatePayload[key] === undefined) {
          delete updatePayload[key];
        }
      });
      
      const { error } = await supabase
        .from('exercises')
        .update(updatePayload)
        .eq('id', editingExercise.id);
      
      if (error) throw error;
      
      // Update local state
      setExercises(prev => prev.map(ex => 
        ex.id === editingExercise.id 
          ? { 
              ...ex, 
              primary_muscle: editData.primaryMuscle,
              is_bodyweight: editData.isBodyweight,
              bodyweight_type: editData.bodyweightType,
              assistance_type: editData.assistanceType,
              equipment: editData.equipment,
              movement_pattern: editData.movementPattern,
            }
          : ex
      ));
      
      setSaveResult({ success: true, message: '✅ Exercise updated successfully!' });
      
      // Close modal after a short delay
      setTimeout(() => {
        setEditingExercise(null);
        setEditData(null);
        setSaveResult(null);
      }, 1500);
    } catch (error: any) {
      console.error('Failed to update exercise:', error);
      setSaveResult({ success: false, message: `❌ Failed to update exercise: ${error?.message || 'Please try again.'}` });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteExercise = async () => {
    if (!deletingExercise) return;
    
    setIsDeleting(true);
    setDeleteError(null);
    
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setDeleteError('You must be logged in to delete exercises');
        return;
      }
      
      // For custom exercises, use the existing service function
      if (deletingExercise.isCustom) {
        const { deleteCustomExercise } = await import('@/services/exerciseService');
        const success = await deleteCustomExercise(deletingExercise.id, user.id);
        if (!success) {
          setDeleteError('Failed to delete exercise. It may not be a custom exercise or you may not have permission.');
          return;
        }
      } else {
        // For non-custom exercises, delete directly (with warning)
        // Note: This will only work if RLS allows it
        const { error } = await supabase
          .from('exercises')
          .delete()
          .eq('id', deletingExercise.id);
        
        if (error) {
          console.error('Failed to delete exercise:', error);
          setDeleteError(error.message || 'Failed to delete exercise. You may only be able to delete custom exercises.');
          return;
        }
      }
      
      // Remove from local state
      setExercises(prev => prev.filter(ex => ex.id !== deletingExercise.id));
      
      // Close modal
      setDeletingExercise(null);
      setDeleteError(null);
    } catch (err: any) {
      console.error('Error deleting exercise:', err);
      setDeleteError(err?.message || 'An error occurred while deleting the exercise');
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredExercises = exercises.filter((ex) => {
    const matchesSearch = ex.name.toLowerCase().includes(search.toLowerCase());
    const matchesMuscle = !selectedMuscle || ex.primary_muscle === selectedMuscle;

    // Equipment filtering - check both equipment field and equipment_required array
    const matchesEquipment = !selectedEquipment ||
      ex.equipment === selectedEquipment ||
      (ex.equipment_required && ex.equipment_required.some(eq =>
        eq.toLowerCase() === selectedEquipment.toLowerCase()
      ));

    const status = getExerciseStatus ? getExerciseStatus(ex.id) : 'active';

    // Status filtering
    let matchesStatus = true;
    if (statusFilter === 'all') {
      // When searching, show all including archived
      // Otherwise hide archived
      matchesStatus = search.length > 0 || status !== 'archived';
    } else if (statusFilter === 'active') {
      matchesStatus = status === 'active';
    } else if (statusFilter === 'muted') {
      matchesStatus = status === 'do_not_suggest';
    } else if (statusFilter === 'archived') {
      matchesStatus = status === 'archived';
    }

    return matchesSearch && matchesMuscle && matchesEquipment && matchesStatus;
  });

  // Transform chart data for display with unit conversion
  const getChartData = (history: ExerciseHistory) => {
    return history.chartData.map(d => ({
      date: d.displayDate,
      e1rm: Math.round(convertWeight(d.e1rm, 'kg', unit)),
      volume: Math.round(convertWeight(d.volume, 'kg', unit)),
      bestWeight: Math.round(convertWeight(d.bestWeight, 'kg', unit)),
      bestReps: d.bestReps,
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Exercise Library</h1>
          <p className="text-surface-400 mt-1">
            {isLoading ? 'Loading...' : `${exercises.length} exercises available`}
          </p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={async () => {
              if (!confirm('This will run AI completion on all exercises. This may take several minutes and use your AI quota. Continue?')) {
                return;
              }
              setIsBatchCompleting(true);
              setBatchProgress(null);
              setBatchResult(null);
              
              const result = await batchCompleteAllExercises((current, total, exerciseName) => {
                setBatchProgress({ current, total, exerciseName });
              });
              
              setIsBatchCompleting(false);
              setBatchProgress(null);
              setBatchResult(result);
              
              // Refresh exercises list
              const supabase = createUntypedClient();
              const { data } = await supabase.from('exercises').select('*').order('name');
              if (data) {
                setExercises(data as Exercise[]);
              }
            }}
            disabled={isBatchCompleting}
            isLoading={isBatchCompleting}
          >
            {isBatchCompleting ? (
              <>
                <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {batchProgress ? `${batchProgress.current}/${batchProgress.total}` : 'Processing...'}
              </>
            ) : (
              <>
                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Complete All with AI
              </>
            )}
          </Button>
          <Link href="/dashboard/exercises/add">
            <Button>
              <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Custom
            </Button>
          </Link>
        </div>
      </div>

      {/* Batch completion progress */}
      {batchProgress && (
        <div className="bg-primary-500/10 border border-primary-500/20 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-primary-300">
              Processing: {batchProgress.exerciseName}
            </p>
            <p className="text-xs text-primary-400">
              {batchProgress.current} / {batchProgress.total}
            </p>
          </div>
          <div className="w-full bg-surface-800 rounded-full h-2">
            <div
              className="bg-primary-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Batch completion result */}
      {batchResult && !isBatchCompleting && (
        <div className={`rounded-lg p-4 ${
          batchResult.errors > 0 
            ? 'bg-orange-500/10 border border-orange-500/20' 
            : 'bg-emerald-500/10 border border-emerald-500/20'
        }`}>
          <p className={`text-sm font-medium mb-2 ${
            batchResult.errors > 0 ? 'text-orange-300' : 'text-emerald-300'
          }`}>
            Batch completion finished!
          </p>
          <div className="text-xs space-y-1 text-surface-400">
            <p>Processed: {batchResult.processed}</p>
            <p>Updated: {batchResult.updated}</p>
            <p>Skipped: {batchResult.skipped}</p>
            {batchResult.errors > 0 && <p className="text-orange-400">Errors: {batchResult.errors}</p>}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <Input
            placeholder="Search exercises..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            }
          />
        </div>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-surface-500 uppercase tracking-wide">Status:</span>
        <button
          onClick={() => setStatusFilter('all')}
          className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
            statusFilter === 'all'
              ? 'bg-primary-500 text-white'
              : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setStatusFilter('active')}
          className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
            statusFilter === 'active'
              ? 'bg-primary-500 text-white'
              : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
          }`}
        >
          Active {prefsSummary && `(${prefsSummary.activeCount})`}
        </button>
        <button
          onClick={() => setStatusFilter('muted')}
          className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
            statusFilter === 'muted'
              ? 'bg-amber-500 text-white'
              : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
          }`}
        >
          Not Suggesting {prefsSummary && prefsSummary.doNotSuggestCount > 0 && `(${prefsSummary.doNotSuggestCount})`}
        </button>
        <button
          onClick={() => setStatusFilter('archived')}
          className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
            statusFilter === 'archived'
              ? 'bg-surface-600 text-white'
              : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
          }`}
        >
          Archived {prefsSummary && prefsSummary.archivedCount > 0 && `(${prefsSummary.archivedCount})`}
        </button>
      </div>

      {/* Muscle filter chips */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-surface-500 uppercase tracking-wide self-center mr-1">Muscle:</span>
        <button
          onClick={() => setSelectedMuscle(null)}
          className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
            !selectedMuscle
              ? 'bg-primary-500 text-white'
              : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
          }`}
        >
          All
        </button>
        {MUSCLE_GROUPS.map((muscle) => (
          <button
            key={muscle}
            onClick={() => setSelectedMuscle(muscle)}
            className={`px-3 py-1.5 rounded-full text-sm capitalize transition-colors ${
              selectedMuscle === muscle
                ? 'bg-primary-500 text-white'
                : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
            }`}
          >
            {muscle}
          </button>
        ))}
      </div>

      {/* Equipment filter chips */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-surface-500 uppercase tracking-wide self-center mr-1">Equipment:</span>
        <button
          onClick={() => setSelectedEquipment(null)}
          className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
            !selectedEquipment
              ? 'bg-primary-500 text-white'
              : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
          }`}
        >
          All
        </button>
        {EQUIPMENT_OPTIONS.map((eq) => (
          <button
            key={eq.value}
            onClick={() => setSelectedEquipment(eq.value)}
            className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
              selectedEquipment === eq.value
                ? 'bg-primary-500 text-white'
                : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
            }`}
          >
            {eq.label}
          </button>
        ))}
      </div>

      {/* Exercise list */}
      {!mounted || isLoading ? (
        <div className="space-y-4">
          <div className="flex justify-center py-8">
            <LoadingAnimation type="random" size="lg" text="Loading exercises..." />
          </div>
          <div className="grid gap-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <SkeletonExercise key={i} />
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {filteredExercises.map((exercise) => {
            const isExpanded = expandedExercise === exercise.id;
            const history = exerciseHistories[exercise.id];
            const isLoadingThis = loadingHistory === exercise.id;
            const chartData = history ? getChartData(history) : [];
            const hasChartData = chartData.length >= 2;
            const exerciseStatus = getExerciseStatus ? getExerciseStatus(exercise.id) : 'active';

            return (
              <Card
                key={exercise.id}
                className={`transition-all ${isExpanded ? 'ring-1 ring-primary-500/30' : 'hover:border-surface-700'} ${
                  exerciseStatus === 'archived' ? 'opacity-75' : ''
                }`}
              >
                {/* Header - always visible */}
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => toggleExpand(exercise.id)}
                    className="flex-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-surface-100">{exercise.name}</h3>
                      {exercise.hypertrophy_tier && (
                        <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${getTierColorClasses(exercise.hypertrophy_tier)}`}>
                          {exercise.hypertrophy_tier}
                        </span>
                      )}
                      {/* Status indicators */}
                      {exerciseStatus === 'do_not_suggest' && (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                          </svg>
                          Muted
                        </span>
                      )}
                      {exerciseStatus === 'archived' && (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-surface-700 text-surface-400 border border-surface-600">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                          </svg>
                          Archived
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-sm text-surface-500 capitalize">
                        {exercise.primary_muscle}
                      </span>
                      <span className="text-surface-700">•</span>
                      <Badge variant={exercise.mechanic === 'compound' ? 'info' : 'default'} size="sm">
                        {exercise.mechanic}
                      </Badge>
                      {history && history.totalSessions > 0 && (
                        <>
                          <span className="text-surface-700">•</span>
                          <span className="text-xs text-primary-400">
                            {history.totalSessions} sessions
                          </span>
                        </>
                      )}
                      {exerciseStatus === 'archived' && search.length > 0 && (
                        <>
                          <span className="text-surface-700">•</span>
                          <span className="text-xs text-surface-500">
                            Found in search
                          </span>
                        </>
                      )}
                    </div>
                  </button>
                  <div className="flex items-center gap-1">
                    <ExerciseOptionsMenu
                      exerciseId={exercise.id}
                      exerciseName={exercise.name}
                      status={exerciseStatus}
                      onMute={() => setStatusModalExercise({ id: exercise.id, name: exercise.name, action: 'mute' })}
                      onArchive={() => setStatusModalExercise({ id: exercise.id, name: exercise.name, action: 'archive' })}
                      onRestore={() => restoreExercise(exercise.id)}
                      onDelete={() => setDeletingExercise({ id: exercise.id, name: exercise.name, isCustom: exercise.is_custom || false })}
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditExercise(exercise);
                      }}
                      className="p-1.5 text-surface-500 hover:text-primary-400 hover:bg-surface-800 rounded transition-colors"
                      title="Edit exercise"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => toggleExpand(exercise.id)}
                      className="p-1"
                    >
                      <svg
                        className={`w-5 h-5 text-surface-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-surface-800 space-y-4">
                    {/* Loading state */}
                    {isLoadingThis && (
                      <div className="flex items-center justify-center py-4">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-500"></div>
                      </div>
                    )}

                    {/* Stats */}
                    {!isLoadingThis && history && history.totalSessions > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-surface-800/50 rounded-lg p-3 text-center">
                          <p className="text-xs text-surface-500 uppercase">Est 1RM</p>
                          <p className="text-lg font-bold text-primary-400">
                            {formatWeight(history.estimatedE1RM, unit)} {unit}
                          </p>
                        </div>
                        {history.personalRecord && (
                          <div className="bg-surface-800/50 rounded-lg p-3 text-center">
                            <p className="text-xs text-surface-500 uppercase">PR</p>
                            <p className="text-lg font-bold text-success-400">
                              {formatWeight(history.personalRecord.weightKg, unit)} × {history.personalRecord.reps}
                            </p>
                          </div>
                        )}
                        <div className="bg-surface-800/50 rounded-lg p-3 text-center">
                          <p className="text-xs text-surface-500 uppercase">Sessions</p>
                          <p className="text-lg font-bold text-surface-200">
                            {history.totalSessions}
                          </p>
                        </div>
                        <div className="bg-surface-800/50 rounded-lg p-3 text-center">
                          <p className="text-xs text-surface-500 uppercase">Last Done</p>
                          <p className="text-sm font-medium text-surface-300">
                            {(() => {
                              const date = new Date(history.lastWorkoutDate);
                              return `${date.getMonth() + 1}/${date.getDate()}`;
                            })()}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Charts */}
                    {!isLoadingThis && history && hasChartData && (
                      <div className="bg-surface-800/30 rounded-lg p-4">
                        {/* Chart tabs */}
                        <div className="flex gap-2 mb-4">
                          <button
                            onClick={() => setActiveChart('e1rm')}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                              activeChart === 'e1rm'
                                ? 'bg-primary-500 text-white'
                                : 'bg-surface-700 text-surface-400 hover:text-surface-200'
                            }`}
                          >
                            Est 1RM
                          </button>
                          <button
                            onClick={() => setActiveChart('volume')}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                              activeChart === 'volume'
                                ? 'bg-primary-500 text-white'
                                : 'bg-surface-700 text-surface-400 hover:text-surface-200'
                            }`}
                          >
                            Volume
                          </button>
                          <button
                            onClick={() => setActiveChart('best')}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                              activeChart === 'best'
                                ? 'bg-primary-500 text-white'
                                : 'bg-surface-700 text-surface-400 hover:text-surface-200'
                            }`}
                          >
                            Best Set
                          </button>
                        </div>

                        {/* Charts - dynamically loaded */}
                        <ExerciseHistoryCharts
                          chartData={chartData}
                          personalRecord={history.personalRecord}
                          activeChart={activeChart}
                          unit={unit}
                        />
                      </div>
                    )}

                    {/* Not enough data for charts */}
                    {!isLoadingThis && history && history.totalSessions > 0 && !hasChartData && (
                      <div className="bg-surface-800/30 rounded-lg p-4 text-center">
                        <p className="text-surface-500 text-sm">
                          Complete at least 2 workouts with this exercise to see progress charts
                        </p>
                      </div>
                    )}

                    {/* Last workout sets */}
                    {!isLoadingThis && history && history.lastWorkoutSets.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                          Last Workout Sets
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {history.lastWorkoutSets.map((set, idx) => (
                            <span 
                              key={idx}
                              className="px-3 py-1.5 bg-surface-800 rounded-lg text-sm text-surface-300"
                            >
                              {formatWeight(set.weightKg, unit)} × {set.reps}
                              {set.rpe && <span className="text-surface-500 ml-1">@{set.rpe}</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* No history message */}
                    {!isLoadingThis && (!history || history.totalSessions === 0) && (
                      <div className="text-center py-6">
                        <svg className="w-12 h-12 mx-auto text-surface-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                        <p className="text-surface-400 text-sm">No workout history for this exercise yet</p>
                        <p className="text-surface-600 text-xs mt-1">Add it to a workout to start tracking progress!</p>
                      </div>
                    )}

                    {/* Hypertrophy Effectiveness */}
                    {(exercise.hypertrophy_tier || exercise.stretch_under_load || exercise.resistance_profile || exercise.progression_ease) && (
                      <div className="bg-surface-800/30 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-medium text-surface-400 uppercase tracking-wider">
                            Hypertrophy Effectiveness
                          </p>
                          {exercise.hypertrophy_tier && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-surface-500">Tier</span>
                              <span className={`px-2 py-0.5 rounded text-sm font-bold ${getTierColorClasses(exercise.hypertrophy_tier)}`}>
                                {exercise.hypertrophy_tier}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="space-y-2">
                          {exercise.stretch_under_load && (
                            <RatingBar 
                              label="Stretch" 
                              value={exercise.stretch_under_load} 
                            />
                          )}
                          {exercise.resistance_profile && (
                            <RatingBar 
                              label="Resistance" 
                              value={exercise.resistance_profile} 
                            />
                          )}
                          {exercise.progression_ease && (
                            <RatingBar 
                              label="Progression" 
                              value={exercise.progression_ease} 
                            />
                          )}
                        </div>
                        <p className="text-xs text-surface-600 mt-3">
                          Based on Jeff Nippard&apos;s evidence-based exercise rankings
                        </p>
                      </div>
                    )}

                    {/* Exercise details */}
                    <div className="grid sm:grid-cols-2 gap-4">
                      {/* Secondary muscles */}
                      {exercise.secondary_muscles && exercise.secondary_muscles.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                            Secondary Muscles
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {exercise.secondary_muscles.map((muscle, idx) => (
                              <Badge key={idx} variant="default" size="sm">
                                {muscle}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Equipment */}
                      {exercise.equipment_required && exercise.equipment_required.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                            Equipment
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {exercise.equipment_required.map((eq, idx) => (
                              <Badge key={idx} variant="default" size="sm">
                                {eq}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Exercise Demo Video/Image */}
                    {(() => {
                      const demoGifUrl = (exercise as any).demo_gif_url;
                      const youtubeVideoId = (exercise as any).youtube_video_id;
                      
                      if (!demoGifUrl && !youtubeVideoId) return null;
                      
                      const isVideo = demoGifUrl && (demoGifUrl.endsWith('.mp4') || demoGifUrl.endsWith('.webm') || demoGifUrl.endsWith('.mov'));
                      const isImage = demoGifUrl && !isVideo;

                      return (
                        <div>
                          <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                            Exercise Demo
                          </p>
                          {isVideo && (
                            <div className="relative rounded-lg overflow-hidden bg-surface-900 border border-surface-700 aspect-video">
                              <video
                                src={demoGifUrl}
                                className="w-full h-full object-contain"
                                autoPlay
                                loop
                                muted
                                playsInline
                                controls
                                onError={(e) => {
                                  console.error('[ExercisesPage] Failed to load video:', demoGifUrl);
                                  (e.target as HTMLVideoElement).style.display = 'none';
                                }}
                              />
                            </div>
                          )}
                          {isImage && (
                            <div className="relative rounded-lg overflow-hidden bg-surface-900 border border-surface-700">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={demoGifUrl}
                                alt={`${exercise.name} demonstration`}
                                className="w-full h-auto max-h-64 object-contain"
                                loading="lazy"
                                onError={(e) => {
                                  console.error('[ExercisesPage] Failed to load image:', demoGifUrl);
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                              />
                            </div>
                          )}
                          {youtubeVideoId && (
                            <div className="relative rounded-lg overflow-hidden bg-surface-900 border border-surface-700 aspect-video mt-2">
                              <iframe
                                src={`https://www.youtube.com/embed/${youtubeVideoId}?rel=0`}
                                title={`${exercise.name} form video`}
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowFullScreen
                                className="absolute inset-0 w-full h-full"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Form cues */}
                    {exercise.form_cues && exercise.form_cues.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                          Form Cues
                        </p>
                        <ul className="space-y-1">
                          {exercise.form_cues.map((cue, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-sm text-surface-300">
                              <span className="text-primary-400">•</span>
                              {cue}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Common mistakes */}
                    {exercise.common_mistakes && exercise.common_mistakes.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                          Common Mistakes
                        </p>
                        <ul className="space-y-1">
                          {exercise.common_mistakes.map((mistake, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-sm text-danger-400/80">
                              <span>✗</span>
                              {mistake}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-2 pt-2">
                      <a
                        href={`https://www.youtube.com/results?search_query=${encodeURIComponent(exercise.name + ' exercise form')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-2 bg-surface-800 hover:bg-surface-700 rounded-lg text-sm text-surface-300 transition-colors"
                      >
                        <svg className="w-4 h-4 text-red-500" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                        </svg>
                        Watch Form
                      </a>
                      <Link 
                        href="/dashboard/workout/new"
                        className="flex items-center gap-1.5 px-3 py-2 bg-primary-500 hover:bg-primary-600 rounded-lg text-sm text-white transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add to Workout
                      </Link>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {!isLoading && filteredExercises.length === 0 && (
        <Card className="text-center py-12">
          <p className="text-surface-400">No exercises found</p>
          <p className="text-sm text-surface-500 mt-1">
            Try adjusting your search or filters
          </p>
        </Card>
      )}

      {/* Edit Exercise Modal */}
      {editingExercise && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-surface-100">Edit Exercise</h3>
                <button
                  onClick={() => setEditingExercise(null)}
                  className="p-1 text-surface-400 hover:text-surface-200 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-surface-400 mb-1">Exercise Name</label>
                  <p className="text-surface-100 font-medium">{editingExercise.name}</p>
                </div>

                {editData && (
                  <>
                    {/* Primary Muscle Group */}
                    <div>
                      <label className="block text-sm text-surface-400 mb-2">Primary Muscle Group</label>
                      <div className="grid grid-cols-3 gap-2">
                        {MUSCLE_GROUPS.map((muscle) => (
                          <button
                            key={muscle}
                            onClick={() => setEditData({ ...editData, primaryMuscle: muscle })}
                            className={`px-3 py-2 rounded-lg text-sm capitalize transition-colors ${
                              editData.primaryMuscle === muscle
                                ? 'bg-primary-500 text-white'
                                : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                            }`}
                          >
                            {muscle}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Bodyweight Settings */}
                    <div className="space-y-3">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={editData.isBodyweight}
                          onChange={(e) => setEditData({ ...editData, isBodyweight: e.target.checked })}
                          className="w-4 h-4 rounded border-surface-600 bg-surface-900 text-primary-500 focus:ring-primary-500"
                        />
                        <span className="text-sm text-surface-200">Bodyweight Exercise</span>
                      </label>
                      
                      {editData.isBodyweight && (
                        <div className="ml-6 space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-surface-400 mb-1">Bodyweight Type</label>
                            <select
                              value={editData.bodyweightType || ''}
                              onChange={(e) => setEditData({ ...editData, bodyweightType: e.target.value as any || null })}
                              className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 text-sm"
                            >
                              <option value="">Not specified</option>
                              <option value="pure">Pure (always bodyweight)</option>
                              <option value="weighted_possible">Can add weight</option>
                              <option value="assisted_possible">Can use assistance</option>
                              <option value="both">Can be weighted OR assisted</option>
                            </select>
                          </div>
                          
                          {(editData.bodyweightType === 'assisted_possible' || editData.bodyweightType === 'both') && (
                            <div>
                              <label className="block text-xs font-medium text-surface-400 mb-1">Assistance Type</label>
                              <select
                                value={editData.assistanceType || ''}
                                onChange={(e) => setEditData({ ...editData, assistanceType: e.target.value as any || null })}
                                className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 text-sm"
                              >
                                <option value="">Not specified</option>
                                <option value="machine">Machine</option>
                                <option value="band">Band</option>
                                <option value="partner">Partner</option>
                              </select>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Equipment */}
                    <div>
                      <label className="block text-sm text-surface-400 mb-1">Equipment</label>
                      <select
                        value={editData.equipment}
                        onChange={(e) => setEditData({ ...editData, equipment: e.target.value })}
                        className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 text-sm"
                      >
                        <option value="barbell">Barbell</option>
                        <option value="dumbbell">Dumbbell</option>
                        <option value="machine">Machine</option>
                        <option value="cable">Cable</option>
                        <option value="bodyweight">Bodyweight</option>
                        <option value="kettlebell">Kettlebell</option>
                        <option value="band">Band</option>
                        <option value="other">Other</option>
                      </select>
                    </div>

                    {/* Movement Pattern */}
                    <div>
                      <label className="block text-sm text-surface-400 mb-1">Movement Pattern</label>
                      <select
                        value={editData.movementPattern}
                        onChange={(e) => setEditData({ ...editData, movementPattern: e.target.value })}
                        className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 text-sm"
                      >
                        <option value="horizontal_push">Horizontal Push</option>
                        <option value="horizontal_pull">Horizontal Pull</option>
                        <option value="vertical_push">Vertical Push</option>
                        <option value="vertical_pull">Vertical Pull</option>
                        <option value="hip_hinge">Hip Hinge</option>
                        <option value="squat">Squat</option>
                        <option value="lunge">Lunge</option>
                        <option value="knee_flexion">Knee Flexion</option>
                        <option value="elbow_flexion">Elbow Flexion</option>
                        <option value="elbow_extension">Elbow Extension</option>
                        <option value="shoulder_isolation">Shoulder Isolation</option>
                        <option value="calf_raise">Calf Raise</option>
                        <option value="core">Core</option>
                        <option value="isolation">Isolation</option>
                        <option value="carry">Carry</option>
                        <option value="compound">Compound</option>
                      </select>
                    </div>

                    {/* Advanced Fields Toggle */}
                    <div className="pt-2 border-t border-surface-700">
                      <button
                        type="button"
                        onClick={() => setShowAdvancedFields(!showAdvancedFields)}
                        className="flex items-center justify-between w-full text-sm text-surface-400 hover:text-surface-200 transition-colors"
                      >
                        <span>Advanced Fields</span>
                        <svg 
                          className={`w-4 h-4 transition-transform ${showAdvancedFields ? 'rotate-180' : ''}`}
                          fill="none" 
                          viewBox="0 0 24 24" 
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>

                    {/* Advanced Fields */}
                    {showAdvancedFields && editData && (
                      <div className="space-y-4 pt-2 border-t border-surface-700">
                        {/* Equipment Required (Multi-select) */}
                        <div>
                          <label className="block text-sm font-medium text-surface-300 mb-2">
                            Equipment Required (select all that apply)
                          </label>
                          <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 bg-surface-800/50 rounded-lg">
                            {equipmentTypes.map((eq) => (
                              <label
                                key={eq.id}
                                className="flex items-center gap-2 p-2 rounded hover:bg-surface-700/50 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={editData.equipmentRequired.includes(eq.name.toLowerCase())}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setEditData(prev => prev ? ({
                                        ...prev,
                                        equipmentRequired: [...prev.equipmentRequired, eq.name.toLowerCase()]
                                      }) : null);
                                    } else {
                                      setEditData(prev => prev ? ({
                                        ...prev,
                                        equipmentRequired: prev.equipmentRequired.filter(e => e !== eq.name.toLowerCase())
                                      }) : null);
                                    }
                                  }}
                                  className="w-4 h-4 text-primary-500 bg-surface-700 border-surface-600 rounded focus:ring-primary-500"
                                />
                                <span className="text-sm text-surface-300">{eq.name}</span>
                              </label>
                            ))}
                          </div>
                          {editData.equipmentRequired.length > 0 && (
                            <p className="text-xs text-surface-500 mt-1">
                              Selected: {editData.equipmentRequired.join(', ')}
                            </p>
                          )}
                        </div>

                        {/* Secondary Muscles */}
                        <div>
                          <label className="block text-sm font-medium text-surface-300 mb-2">
                            Secondary Muscles
                          </label>
                          <div className="grid grid-cols-3 gap-2 max-h-32 overflow-y-auto p-2 bg-surface-800/50 rounded-lg">
                            {MUSCLE_GROUPS.filter(m => m !== editData.primaryMuscle).map((muscle) => (
                              <label
                                key={muscle}
                                className="flex items-center gap-2 p-1.5 rounded hover:bg-surface-700/50 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={editData.secondaryMuscles.includes(muscle)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setEditData(prev => prev ? ({
                                        ...prev,
                                        secondaryMuscles: [...prev.secondaryMuscles, muscle]
                                      }) : null);
                                    } else {
                                      setEditData(prev => prev ? ({
                                        ...prev,
                                        secondaryMuscles: prev.secondaryMuscles.filter(m => m !== muscle)
                                      }) : null);
                                    }
                                  }}
                                  className="w-4 h-4 text-primary-500 bg-surface-700 border-surface-600 rounded focus:ring-primary-500"
                                />
                                <span className="text-xs text-surface-300 capitalize">{muscle}</span>
                              </label>
                            ))}
                          </div>
                        </div>

                        {/* Hypertrophy Tier */}
                        <div>
                          <label className="block text-sm text-surface-400 mb-1">Hypertrophy Tier</label>
                          <select
                            value={editData.hypertrophyTier || ''}
                            onChange={(e) => setEditData(prev => prev ? ({ ...prev, hypertrophyTier: e.target.value as any || undefined }) : null)}
                            className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 text-sm"
                          >
                            <option value="">Not set</option>
                            <option value="S">S (Best)</option>
                            <option value="A">A</option>
                            <option value="B">B</option>
                            <option value="C">C</option>
                            <option value="D">D</option>
                            <option value="F">F (Worst)</option>
                          </select>
                        </div>

                        {/* Rep Range */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm text-surface-400 mb-1">Default Rep Range (Min)</label>
                            <input
                              type="number"
                              value={editData.defaultRepRangeMin?.toString() || ''}
                              onChange={(e) => setEditData(prev => prev ? ({ 
                                ...prev, 
                                defaultRepRangeMin: e.target.value ? parseInt(e.target.value) : undefined 
                              }) : null)}
                              placeholder="8"
                              className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-surface-400 mb-1">Default Rep Range (Max)</label>
                            <input
                              type="number"
                              value={editData.defaultRepRangeMax?.toString() || ''}
                              onChange={(e) => setEditData(prev => prev ? ({ 
                                ...prev, 
                                defaultRepRangeMax: e.target.value ? parseInt(e.target.value) : undefined 
                              }) : null)}
                              placeholder="12"
                              className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 text-sm"
                            />
                          </div>
                        </div>

                        {/* Default RIR */}
                        <div>
                          <label className="block text-sm text-surface-400 mb-1">Default RIR (Reps In Reserve)</label>
                          <input
                            type="number"
                            value={editData.defaultRir?.toString() || ''}
                            onChange={(e) => setEditData(prev => prev ? ({ 
                              ...prev, 
                              defaultRir: e.target.value ? parseInt(e.target.value) : undefined 
                            }) : null)}
                            placeholder="2"
                            className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 text-sm"
                          />
                        </div>

                        {/* Setup Note */}
                        <div>
                          <label className="block text-sm text-surface-400 mb-1">Setup Note</label>
                          <textarea
                            value={editData.setupNote || ''}
                            onChange={(e) => setEditData(prev => prev ? ({ ...prev, setupNote: e.target.value }) : null)}
                            placeholder="Instructions for setting up the exercise..."
                            className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                            rows={2}
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}

                {saveResult && (
                  <div className={`p-3 rounded-lg text-sm ${
                    saveResult.success 
                      ? 'bg-success-500/10 text-success-400 border border-success-500/20'
                      : 'bg-danger-500/10 text-danger-400 border border-danger-500/20'
                  }`}>
                    {saveResult.message}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <Button
                    variant="ghost"
                    onClick={() => setEditingExercise(null)}
                    className="flex-1"
                    disabled={isSaving}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleSaveExercise}
                    className="flex-1"
                    disabled={isSaving || !editData}
                  >
                    {isSaving ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                        Saving...
                      </>
                    ) : (
                      'Save Changes'
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Exercise Status Modal */}
      {statusModalExercise && (
        <ExerciseStatusModal
          isOpen={true}
          onClose={() => setStatusModalExercise(null)}
          exerciseName={statusModalExercise.name}
          action={statusModalExercise.action}
          onConfirm={async (reason, reasonNote) => {
            if (statusModalExercise.action === 'mute') {
              await muteExercise(statusModalExercise.id, reason, reasonNote);
            } else {
              await archiveExercise(statusModalExercise.id, reason, reasonNote);
            }
          }}
        />
      )}

      {/* Delete Exercise Confirmation Modal */}
      {deletingExercise && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-surface-100">Delete Exercise</h3>
                <button
                  onClick={() => {
                    setDeletingExercise(null);
                    setDeleteError(null);
                  }}
                  className="p-1 text-surface-400 hover:text-surface-200 transition-colors"
                  disabled={isDeleting}
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <p className="text-surface-200 mb-2">
                    Are you sure you want to delete <span className="font-semibold">{deletingExercise.name}</span>?
                  </p>
                  {!deletingExercise.isCustom && (
                    <p className="text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                      ⚠️ This is not a custom exercise. Deleting it may affect other users or system functionality.
                    </p>
                  )}
                  <p className="text-sm text-surface-400 mt-2">
                    This action cannot be undone. All exercise data, including workout history, will be permanently deleted.
                  </p>
                </div>

                {deleteError && (
                  <div className="p-3 bg-danger-500/10 text-danger-400 border border-danger-500/20 rounded-lg text-sm">
                    {deleteError}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setDeletingExercise(null);
                      setDeleteError(null);
                    }}
                    className="flex-1"
                    disabled={isDeleting}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    onClick={handleDeleteExercise}
                    className="flex-1"
                    disabled={isDeleting}
                  >
                    {isDeleting ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                        Deleting...
                      </>
                    ) : (
                      'Delete Exercise'
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
