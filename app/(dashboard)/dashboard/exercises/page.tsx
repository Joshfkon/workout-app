'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, Input, Badge, Button, LoadingAnimation, SkeletonExercise } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { MUSCLE_GROUPS } from '@/types/schema';
import { formatWeight, convertWeight } from '@/lib/utils';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

interface Exercise {
  id: string;
  name: string;
  primary_muscle: string;
  secondary_muscles: string[];
  mechanic: 'compound' | 'isolation';
  form_cues: string[];
  common_mistakes: string[];
  equipment_required: string[];
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
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);
  const [expandedExercise, setExpandedExercise] = useState<string | null>(null);
  const [exerciseHistories, setExerciseHistories] = useState<Record<string, ExerciseHistory>>({});
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null);
  const [activeChart, setActiveChart] = useState<'e1rm' | 'volume' | 'best'>('e1rm');
  const { preferences } = useUserPreferences();
  const unit = preferences.units;
  
  // Edit exercise state
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);
  const [editMuscle, setEditMuscle] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    async function fetchExercises() {
      const supabase = createUntypedClient();
      const { data, error } = await supabase
        .from('exercises')
        .select('id, name, primary_muscle, secondary_muscles, mechanic, form_cues, common_mistakes, equipment_required, hypertrophy_tier, stretch_under_load, resistance_profile, progression_ease')
        .order('name');

      if (data && !error) {
        setExercises(data);
      }
      setIsLoading(false);
    }

    fetchExercises();
  }, []);

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
          const displayDate = new Date(date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          });

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
    setEditMuscle(exercise.primary_muscle);
    setSaveResult(null);
  };

  const handleSaveExercise = async () => {
    if (!editingExercise || !editMuscle) return;
    
    setIsSaving(true);
    setSaveResult(null);
    
    try {
      const supabase = createUntypedClient();
      
      const { error } = await supabase
        .from('exercises')
        .update({ primary_muscle: editMuscle })
        .eq('id', editingExercise.id);
      
      if (error) throw error;
      
      // Update local state
      setExercises(prev => prev.map(ex => 
        ex.id === editingExercise.id 
          ? { ...ex, primary_muscle: editMuscle }
          : ex
      ));
      
      setSaveResult({ success: true, message: '✅ Exercise updated successfully!' });
      
      // Close modal after a short delay
      setTimeout(() => {
        setEditingExercise(null);
        setSaveResult(null);
      }, 1500);
    } catch (error) {
      console.error('Failed to update exercise:', error);
      setSaveResult({ success: false, message: '❌ Failed to update exercise. Please try again.' });
    } finally {
      setIsSaving(false);
    }
  };

  const filteredExercises = exercises.filter((ex) => {
    const matchesSearch = ex.name.toLowerCase().includes(search.toLowerCase());
    const matchesMuscle = !selectedMuscle || ex.primary_muscle === selectedMuscle;
    return matchesSearch && matchesMuscle;
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
        <Link href="/dashboard/exercises/add">
          <Button>
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Custom
          </Button>
        </Link>
      </div>

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

      {/* Muscle filter chips */}
      <div className="flex flex-wrap gap-2">
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

      {/* Exercise list */}
      {isLoading ? (
        <div className="space-y-4">
          <div className="flex justify-center py-8">
            <LoadingAnimation type="dumbbell" size="lg" text="Loading exercises..." />
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

            return (
              <Card
                key={exercise.id}
                className={`transition-all ${isExpanded ? 'ring-1 ring-primary-500/30' : 'hover:border-surface-700'}`}
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
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
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
                            {new Date(history.lastWorkoutDate).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })}
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

                        {/* E1RM Chart */}
                        {activeChart === 'e1rm' && (
                          <div className="h-48">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={chartData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                <XAxis 
                                  dataKey="date" 
                                  stroke="#9ca3af" 
                                  fontSize={11}
                                  tick={{ fill: '#9ca3af' }}
                                />
                                <YAxis 
                                  stroke="#9ca3af" 
                                  fontSize={11}
                                  tick={{ fill: '#9ca3af' }}
                                  domain={['dataMin - 5', 'dataMax + 5']}
                                />
                                <Tooltip 
                                  contentStyle={{ 
                                    backgroundColor: '#1f2937', 
                                    border: '1px solid #374151', 
                                    borderRadius: '8px',
                                    color: '#f3f4f6' 
                                  }}
                                  formatter={(value: number) => [`${value} ${unit}`, 'Est 1RM']}
                                />
                                <Line 
                                  type="monotone" 
                                  dataKey="e1rm" 
                                  stroke="#8b5cf6" 
                                  strokeWidth={2}
                                  dot={{ r: 4, fill: '#8b5cf6' }}
                                  activeDot={{ r: 6, fill: '#a78bfa' }}
                                />
                                {history.personalRecord && (
                                  <ReferenceLine
                                    y={Math.round(convertWeight(history.personalRecord.e1rm, 'kg', unit))}
                                    stroke="#22c55e"
                                    strokeDasharray="5 5"
                                    label={{ 
                                      value: 'PR', 
                                      fill: '#22c55e', 
                                      fontSize: 11,
                                      position: 'right'
                                    }}
                                  />
                                )}
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        )}

                        {/* Volume Chart */}
                        {activeChart === 'volume' && (
                          <div className="h-48">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={chartData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                <XAxis 
                                  dataKey="date" 
                                  stroke="#9ca3af" 
                                  fontSize={11}
                                  tick={{ fill: '#9ca3af' }}
                                />
                                <YAxis 
                                  stroke="#9ca3af" 
                                  fontSize={11}
                                  tick={{ fill: '#9ca3af' }}
                                />
                                <Tooltip 
                                  contentStyle={{ 
                                    backgroundColor: '#1f2937', 
                                    border: '1px solid #374151', 
                                    borderRadius: '8px',
                                    color: '#f3f4f6' 
                                  }}
                                  formatter={(value: number) => [`${value.toLocaleString()} ${unit}`, 'Volume']}
                                />
                                <defs>
                                  <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                  </linearGradient>
                                </defs>
                                <Area 
                                  type="monotone" 
                                  dataKey="volume" 
                                  stroke="#3b82f6" 
                                  strokeWidth={2}
                                  fill="url(#volumeGradient)"
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        )}

                        {/* Best Set Chart */}
                        {activeChart === 'best' && (
                          <div className="h-48">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={chartData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                <XAxis 
                                  dataKey="date" 
                                  stroke="#9ca3af" 
                                  fontSize={11}
                                  tick={{ fill: '#9ca3af' }}
                                />
                                <YAxis 
                                  yAxisId="weight"
                                  stroke="#f59e0b" 
                                  fontSize={11}
                                  tick={{ fill: '#f59e0b' }}
                                  orientation="left"
                                />
                                <YAxis 
                                  yAxisId="reps"
                                  stroke="#10b981" 
                                  fontSize={11}
                                  tick={{ fill: '#10b981' }}
                                  orientation="right"
                                />
                                <Tooltip 
                                  contentStyle={{ 
                                    backgroundColor: '#1f2937', 
                                    border: '1px solid #374151', 
                                    borderRadius: '8px',
                                    color: '#f3f4f6' 
                                  }}
                                  formatter={(value: number, name: string) => {
                                    if (name === 'bestWeight') return [`${value} ${unit}`, 'Weight'];
                                    return [`${value}`, 'Reps'];
                                  }}
                                />
                                <Line 
                                  yAxisId="weight"
                                  type="monotone" 
                                  dataKey="bestWeight" 
                                  stroke="#f59e0b" 
                                  strokeWidth={2}
                                  dot={{ r: 4, fill: '#f59e0b' }}
                                  name="bestWeight"
                                />
                                <Line 
                                  yAxisId="reps"
                                  type="monotone" 
                                  dataKey="bestReps" 
                                  stroke="#10b981" 
                                  strokeWidth={2}
                                  dot={{ r: 4, fill: '#10b981' }}
                                  name="bestReps"
                                />
                              </LineChart>
                            </ResponsiveContainer>
                            <div className="flex justify-center gap-6 mt-2 text-xs">
                              <span className="flex items-center gap-1">
                                <span className="w-3 h-3 rounded-full bg-amber-500"></span>
                                <span className="text-surface-400">Weight ({unit})</span>
                              </span>
                              <span className="flex items-center gap-1">
                                <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
                                <span className="text-surface-400">Reps</span>
                              </span>
                            </div>
                          </div>
                        )}
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

                <div>
                  <label className="block text-sm text-surface-400 mb-2">Primary Muscle Group</label>
                  <div className="grid grid-cols-3 gap-2">
                    {MUSCLE_GROUPS.map((muscle) => (
                      <button
                        key={muscle}
                        onClick={() => setEditMuscle(muscle)}
                        className={`px-3 py-2 rounded-lg text-sm capitalize transition-colors ${
                          editMuscle === muscle
                            ? 'bg-primary-500 text-white'
                            : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                        }`}
                      >
                        {muscle}
                      </button>
                    ))}
                  </div>
                </div>

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
                    disabled={isSaving || editMuscle === editingExercise.primary_muscle}
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
    </div>
  );
}
