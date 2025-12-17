'use client';

import { useState, useMemo } from 'react';
import { Button, Card, Badge } from '@/components/ui';
import type { WorkoutSession, SetLog, ExerciseBlock, MuscleGroup, WeightUnit } from '@/types/schema';
import { formatDuration, formatWeight } from '@/lib/utils';

interface ExerciseWithHistory {
  exerciseId: string;
  exerciseName: string;
  previousBest?: {
    weight: number;
    reps: number;
    e1rm: number;
  };
}

interface SessionSummaryProps {
  session: WorkoutSession;
  exerciseBlocks: ExerciseBlock[];
  allSets: SetLog[];
  exerciseHistories?: Record<string, ExerciseWithHistory>;
  unit?: WeightUnit;
  onSubmit?: (data: {
    sessionRpe: number;
    pumpRating: number;
    notes: string;
  }) => void;
  readOnly?: boolean;
}

// Convert kg to lbs
const kgToLbs = (kg: number) => Math.round(kg * 2.20462 * 10) / 10;

// Calculate estimated 1RM using Epley formula
function calculateE1RM(weight: number, reps: number): number {
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

// Estimate calories burned (rough estimate based on duration, sets, and intensity)
function estimateCaloriesBurned(durationMinutes: number, totalSets: number, avgRpe: number): number {
  // Base rate: ~5-8 cal/min for weight training
  const baseRate = 5 + (avgRpe / 10) * 3; // Higher RPE = more calories
  const setBonus = totalSets * 3; // ~3 extra calories per set
  return Math.round(durationMinutes * baseRate + setBonus);
}

export function SessionSummary({
  session,
  exerciseBlocks,
  allSets,
  exerciseHistories,
  unit = 'kg',
  onSubmit,
  readOnly = false,
}: SessionSummaryProps) {
  // Helper to display weight in user's preferred unit
  const displayWeight = (kg: number, decimals: number = 0) => {
    if (unit === 'lb') {
      const lbs = kgToLbs(kg);
      return decimals > 0 ? lbs.toFixed(decimals) : Math.round(lbs);
    }
    return decimals > 0 ? kg.toFixed(decimals) : Math.round(kg);
  };
  
  const weightUnit = unit === 'lb' ? 'lbs' : 'kg';
  const [sessionRpe, setSessionRpe] = useState(session.sessionRpe || 7);
  const [pumpRating, setPumpRating] = useState(session.pumpRating || 3);
  const [notes, setNotes] = useState(session.sessionNotes || '');
  const [showAllPRs, setShowAllPRs] = useState(false);
  const [showExerciseDetails, setShowExerciseDetails] = useState(true);
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(new Set());

  // Calculate stats
  const workingSets = allSets.filter((s) => !s.isWarmup);
  const totalSets = workingSets.length;
  const totalReps = workingSets.reduce((sum, s) => sum + s.reps, 0);
  const totalVolume = workingSets.reduce((sum, s) => sum + s.weightKg * s.reps, 0);
  const avgRpe = totalSets > 0
    ? Math.round((workingSets.reduce((sum, s) => sum + s.rpe, 0) / totalSets) * 10) / 10
    : 0;

  // Duration - use completedAt for completed workouts, otherwise current time
  const endTime = session.completedAt ? new Date(session.completedAt).getTime() : Date.now();
  const duration = session.startedAt
    ? Math.floor(
        (endTime - new Date(session.startedAt).getTime()) / 1000
      )
    : 0;
  const durationMinutes = Math.round(duration / 60);

  // Estimated calories burned
  const caloriesBurned = estimateCaloriesBurned(durationMinutes, totalSets, avgRpe);

  // Set quality breakdown
  const qualityBreakdown = workingSets.reduce(
    (acc, set) => {
      acc[set.quality] = (acc[set.quality] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  // Calculate quality score (0-100)
  const qualityScore = useMemo(() => {
    if (totalSets === 0) return 0;
    const stimulative = qualityBreakdown.stimulative || 0;
    const effective = qualityBreakdown.effective || 0;
    const junk = qualityBreakdown.junk || 0;
    const excessive = qualityBreakdown.excessive || 0;
    // Stimulative = 100pts, Effective = 75pts, Junk = 25pts, Excessive = 0pts
    const score = (stimulative * 100 + effective * 75 + junk * 25) / totalSets;
    return Math.round(score);
  }, [totalSets, qualityBreakdown]);

  // Detect Personal Records (PRs)
  const personalRecords = useMemo(() => {
    const prs: { exerciseName: string; type: 'weight' | 'reps' | 'e1rm' | 'volume'; value: number; improvement: number }[] = [];
    
    // Group sets by exercise
    const setsByExercise = new Map<string, SetLog[]>();
    workingSets.forEach(set => {
      const block = exerciseBlocks.find(b => b.id === set.exerciseBlockId);
      if (block) {
        const existing = setsByExercise.get(block.id) || [];
        existing.push(set);
        setsByExercise.set(block.id, existing);
      }
    });

    // Check each exercise for PRs
    exerciseBlocks.forEach(block => {
      const sets = setsByExercise.get(block.id) || [];
      if (sets.length === 0) return;

      const history = exerciseHistories?.[block.exerciseId || ''];
      if (!history?.previousBest) return;

      // Find best set this workout
      let bestWeight = 0;
      let bestReps = 0;
      let bestE1RM = 0;
      let totalVolume = 0;

      sets.forEach(set => {
        if (set.weightKg > bestWeight) bestWeight = set.weightKg;
        if (set.reps > bestReps) bestReps = set.reps;
        const e1rm = calculateE1RM(set.weightKg, set.reps);
        if (e1rm > bestE1RM) bestE1RM = e1rm;
        totalVolume += set.weightKg * set.reps;
      });

      const exerciseName = (block as any).exercise?.name || 'Exercise';

      // Check for E1RM PR (most meaningful)
      if (bestE1RM > history.previousBest.e1rm) {
        prs.push({
          exerciseName,
          type: 'e1rm',
          value: bestE1RM,
          improvement: Math.round(((bestE1RM - history.previousBest.e1rm) / history.previousBest.e1rm) * 100),
        });
      }
      // Check for weight PR
      else if (bestWeight > history.previousBest.weight) {
        prs.push({
          exerciseName,
          type: 'weight',
          value: bestWeight,
          improvement: Math.round(((bestWeight - history.previousBest.weight) / history.previousBest.weight) * 100),
        });
      }
      // Check for reps PR (at same or higher weight)
      else if (bestReps > history.previousBest.reps && bestWeight >= history.previousBest.weight * 0.95) {
        prs.push({
          exerciseName,
          type: 'reps',
          value: bestReps,
          improvement: bestReps - history.previousBest.reps,
        });
      }
    });

    return prs;
  }, [workingSets, exerciseBlocks, exerciseHistories]);

  // Volume by muscle group
  const volumeByMuscle = useMemo(() => {
    const volumes: Record<string, { sets: number; volume: number }> = {};
    
    exerciseBlocks.forEach(block => {
      const sets = workingSets.filter(s => s.exerciseBlockId === block.id);
      const muscle = (block as any).exercise?.primaryMuscle || 'other';
      
      if (!volumes[muscle]) {
        volumes[muscle] = { sets: 0, volume: 0 };
      }
      
      sets.forEach(set => {
        volumes[muscle].sets += 1;
        volumes[muscle].volume += set.weightKg * set.reps;
      });
    });

    // Sort by volume
    return Object.entries(volumes)
      .map(([muscle, data]) => ({ muscle, ...data }))
      .sort((a, b) => b.volume - a.volume);
  }, [exerciseBlocks, workingSets]);

  // Intensity distribution (RPE breakdown)
  const rpeDistribution = useMemo(() => {
    const distribution = { easy: 0, moderate: 0, hard: 0, maximal: 0 };
    workingSets.forEach(set => {
      if (set.rpe <= 6) distribution.easy++;
      else if (set.rpe <= 7) distribution.moderate++;
      else if (set.rpe <= 8) distribution.hard++;
      else distribution.maximal++;
    });
    return distribution;
  }, [workingSets]);

  // Effort timeline (RPE per set in order)
  const effortTimeline = useMemo(() => {
    return workingSets.map((set, index) => ({
      setNumber: index + 1,
      rpe: set.rpe,
      exercise: exerciseBlocks.find(b => b.id === set.exerciseBlockId),
    }));
  }, [workingSets, exerciseBlocks]);

  // Exercise details with sets
  const exerciseDetails = useMemo(() => {
    return exerciseBlocks.map(block => {
      const exercise = (block as any).exercise;
      const sets = workingSets.filter(s => s.exerciseBlockId === block.id);
      const warmupSets = allSets.filter(s => s.exerciseBlockId === block.id && s.isWarmup);
      
      // Calculate stats for this exercise
      const totalVolume = sets.reduce((sum, s) => sum + s.weightKg * s.reps, 0);
      const maxWeight = sets.length > 0 ? Math.max(...sets.map(s => s.weightKg)) : 0;
      const maxReps = sets.length > 0 ? Math.max(...sets.map(s => s.reps)) : 0;
      const avgRpe = sets.length > 0 
        ? Math.round((sets.reduce((sum, s) => sum + s.rpe, 0) / sets.length) * 10) / 10 
        : 0;
      const bestE1RM = sets.length > 0 
        ? Math.max(...sets.map(s => calculateE1RM(s.weightKg, s.reps))) 
        : 0;
      
      // Check if this exercise had a PR
      const history = exerciseHistories?.[block.exerciseId || ''];
      const hasPR = history?.previousBest && bestE1RM > history.previousBest.e1rm;
      
      return {
        blockId: block.id,
        exerciseId: block.exerciseId,
        name: exercise?.name || 'Unknown Exercise',
        muscle: exercise?.primaryMuscle || 'other',
        sets,
        warmupSets,
        totalVolume,
        maxWeight,
        maxReps,
        avgRpe,
        bestE1RM,
        hasPR,
        targetSets: block.targetSets,
        targetRepsMin: (block as any).targetRepsMin,
        targetRepsMax: (block as any).targetRepsMax,
      };
    }).filter(e => e.sets.length > 0); // Only show exercises with completed sets
  }, [exerciseBlocks, workingSets, allSets, exerciseHistories]);

  const toggleExerciseExpanded = (blockId: string) => {
    setExpandedExercises(prev => {
      const next = new Set(prev);
      if (next.has(blockId)) {
        next.delete(blockId);
      } else {
        next.add(blockId);
      }
      return next;
    });
  };

  const handleSubmit = () => {
    if (onSubmit) {
      onSubmit({
        sessionRpe,
        pumpRating,
        notes,
      });
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* Header with celebration animation for PRs */}
      <div className="text-center relative">
        {personalRecords.length > 0 && !readOnly && (
          <div className="absolute -top-4 left-1/2 -translate-x-1/2 animate-bounce">
            <span className="text-3xl">🎉</span>
          </div>
        )}
        <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${
          personalRecords.length > 0 
            ? 'bg-gradient-to-br from-yellow-500/30 to-amber-500/30 ring-2 ring-yellow-500/50' 
            : 'bg-success-500/20'
        }`}>
          {personalRecords.length > 0 ? (
            <span className="text-3xl">🏆</span>
          ) : (
            <svg className="w-8 h-8 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        <h2 className="text-2xl font-bold text-surface-100">
          {personalRecords.length > 0 && !readOnly 
            ? `${personalRecords.length} Personal Record${personalRecords.length > 1 ? 's' : ''}!` 
            : readOnly 
            ? 'Workout Summary' 
            : 'Workout Complete!'}
        </h2>
        <p className="text-surface-400 mt-1">
          {readOnly 
            ? session.completedAt 
              ? `Completed ${new Date(session.completedAt).toLocaleDateString()}`
              : 'Viewing past workout'
            : personalRecords.length > 0 
            ? "You're getting stronger! 💪" 
            : 'Great job finishing your session'}
        </p>
      </div>

      {/* Personal Records Celebration */}
      {personalRecords.length > 0 && (
        <Card className="bg-gradient-to-br from-yellow-500/10 to-amber-500/10 border-yellow-500/30">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xl">🏆</span>
            <h3 className="font-semibold text-yellow-400">Personal Records</h3>
          </div>
          <div className="space-y-2">
            {(showAllPRs ? personalRecords : personalRecords.slice(0, 3)).map((pr, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 bg-surface-900/50 rounded-lg">
                <div>
                  <p className="font-medium text-surface-100">{pr.exerciseName}</p>
                  <p className="text-xs text-surface-400">
                    {pr.type === 'e1rm' && `New Est. 1RM: ${displayWeight(pr.value)}${weightUnit}`}
                    {pr.type === 'weight' && `New Weight PR: ${displayWeight(pr.value)}${weightUnit}`}
                    {pr.type === 'reps' && `New Reps PR: ${pr.value} reps`}
                  </p>
                </div>
                <div className="text-right">
                  <Badge variant="warning" className="bg-yellow-500/20 text-yellow-400">
                    {pr.type === 'reps' ? `+${pr.improvement}` : `+${pr.improvement}%`}
                  </Badge>
                </div>
              </div>
            ))}
            {personalRecords.length > 3 && (
              <button 
                onClick={() => setShowAllPRs(!showAllPRs)}
                className="text-sm text-yellow-400 hover:text-yellow-300"
              >
                {showAllPRs ? 'Show less' : `+${personalRecords.length - 3} more PRs`}
              </button>
            )}
          </div>
        </Card>
      )}

      {/* Main Stats Grid - Enhanced */}
      <Card>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="text-center p-3 bg-surface-800/50 rounded-lg">
            <p className="text-2xl font-bold text-primary-400">{totalSets}</p>
            <p className="text-xs text-surface-500">Sets</p>
          </div>
          <div className="text-center p-3 bg-surface-800/50 rounded-lg">
            <p className="text-2xl font-bold text-primary-400">{totalReps}</p>
            <p className="text-xs text-surface-500">Reps</p>
          </div>
          <div className="text-center p-3 bg-surface-800/50 rounded-lg">
            <p className="text-2xl font-bold text-primary-400">
              {formatDuration(duration)}
            </p>
            <p className="text-xs text-surface-500">Duration</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border border-blue-500/20 rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm">⚖️</span>
              <span className="text-xs text-surface-400">Total Volume</span>
            </div>
            <p className="text-xl font-bold text-blue-400">
              {(() => {
                const vol = unit === 'lb' ? kgToLbs(totalVolume) : totalVolume;
                return vol >= 1000 ? `${(vol / 1000).toFixed(1)}k` : Math.round(vol);
              })()} {weightUnit}
            </p>
          </div>
          <div className="p-3 bg-gradient-to-br from-orange-500/10 to-red-500/10 border border-orange-500/20 rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm">🔥</span>
              <span className="text-xs text-surface-400">Est. Calories</span>
            </div>
            <p className="text-xl font-bold text-orange-400">{caloriesBurned}</p>
          </div>
        </div>
      </Card>

      {/* Quality Score Ring */}
      {totalSets > 0 && (
        <Card>
          <div className="flex items-center gap-6">
            {/* Circular quality score */}
            <div className="relative w-24 h-24 flex-shrink-0">
              <svg className="w-24 h-24 transform -rotate-90" viewBox="0 0 36 36">
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  className="text-surface-700"
                />
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeDasharray={`${qualityScore}, 100`}
                  className={
                    qualityScore >= 80 ? 'text-success-500' :
                    qualityScore >= 60 ? 'text-primary-500' :
                    qualityScore >= 40 ? 'text-warning-500' : 'text-danger-500'
                  }
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-2xl font-bold ${
                  qualityScore >= 80 ? 'text-success-400' :
                  qualityScore >= 60 ? 'text-primary-400' :
                  qualityScore >= 40 ? 'text-warning-400' : 'text-danger-400'
                }`}>
                  {qualityScore}
                </span>
                <span className="text-xs text-surface-500">Quality</span>
              </div>
            </div>

            {/* Quality breakdown */}
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium text-surface-200 mb-2">Set Quality Breakdown</p>
              {qualityBreakdown.stimulative > 0 && (
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-success-500" />
                  <span className="text-sm text-surface-300">{qualityBreakdown.stimulative} Stimulative</span>
                  <span className="text-xs text-surface-500 ml-auto">
                    {Math.round((qualityBreakdown.stimulative / totalSets) * 100)}%
                  </span>
                </div>
              )}
              {qualityBreakdown.effective > 0 && (
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-primary-500" />
                  <span className="text-sm text-surface-300">{qualityBreakdown.effective} Effective</span>
                  <span className="text-xs text-surface-500 ml-auto">
                    {Math.round((qualityBreakdown.effective / totalSets) * 100)}%
                  </span>
                </div>
              )}
              {qualityBreakdown.junk > 0 && (
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-surface-500" />
                  <span className="text-sm text-surface-300">{qualityBreakdown.junk} Junk</span>
                  <span className="text-xs text-surface-500 ml-auto">
                    {Math.round((qualityBreakdown.junk / totalSets) * 100)}%
                  </span>
                </div>
              )}
              {qualityBreakdown.excessive > 0 && (
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-danger-500" />
                  <span className="text-sm text-surface-300">{qualityBreakdown.excessive} Excessive</span>
                  <span className="text-xs text-surface-500 ml-auto">
                    {Math.round((qualityBreakdown.excessive / totalSets) * 100)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Volume by Muscle Group */}
      {volumeByMuscle.length > 0 && (
        <Card>
          <h3 className="text-sm font-medium text-surface-200 mb-3 flex items-center gap-2">
            <span>💪</span> Volume by Muscle
          </h3>
          <div className="space-y-3">
            {volumeByMuscle.slice(0, 5).map(({ muscle, sets, volume }) => {
              const maxVolume = volumeByMuscle[0].volume;
              const percentage = (volume / maxVolume) * 100;
              return (
                <div key={muscle}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-surface-300 capitalize">{muscle}</span>
                    <span className="text-surface-400">{sets} sets · {displayWeight(volume)}{weightUnit}</span>
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
        </Card>
      )}

      {/* Effort Timeline */}
      {effortTimeline.length > 0 && (
        <Card>
          <h3 className="text-sm font-medium text-surface-200 mb-3 flex items-center gap-2">
            <span>📈</span> Effort Timeline
          </h3>
          <div className="h-20 flex items-end gap-1">
            {effortTimeline.map((point, idx) => {
              const height = (point.rpe / 10) * 100;
              return (
                <div 
                  key={idx}
                  className="flex-1 min-w-[4px] rounded-t transition-all duration-300 hover:opacity-80"
                  style={{ 
                    height: `${height}%`,
                    backgroundColor: point.rpe >= 9 ? '#ef4444' : 
                                    point.rpe >= 8 ? '#f97316' : 
                                    point.rpe >= 7 ? '#eab308' : '#22c55e'
                  }}
                  title={`Set ${point.setNumber}: RPE ${point.rpe}`}
                />
              );
            })}
          </div>
          <div className="flex justify-between mt-2 text-xs text-surface-500">
            <span>Set 1</span>
            <span>Avg: {avgRpe}</span>
            <span>Set {effortTimeline.length}</span>
          </div>
        </Card>
      )}

      {/* Intensity Distribution */}
      <Card>
        <h3 className="text-sm font-medium text-surface-200 mb-3 flex items-center gap-2">
          <span>🎯</span> Intensity Distribution
        </h3>
        <div className="grid grid-cols-4 gap-2">
          <div className="text-center p-2 bg-success-500/10 rounded-lg border border-success-500/20">
            <p className="text-lg font-bold text-success-400">{rpeDistribution.easy}</p>
            <p className="text-xs text-surface-500">Easy</p>
            <p className="text-xs text-surface-600">RPE 1-6</p>
          </div>
          <div className="text-center p-2 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
            <p className="text-lg font-bold text-yellow-400">{rpeDistribution.moderate}</p>
            <p className="text-xs text-surface-500">Moderate</p>
            <p className="text-xs text-surface-600">RPE 7</p>
          </div>
          <div className="text-center p-2 bg-orange-500/10 rounded-lg border border-orange-500/20">
            <p className="text-lg font-bold text-orange-400">{rpeDistribution.hard}</p>
            <p className="text-xs text-surface-500">Hard</p>
            <p className="text-xs text-surface-600">RPE 8</p>
          </div>
          <div className="text-center p-2 bg-red-500/10 rounded-lg border border-red-500/20">
            <p className="text-lg font-bold text-red-400">{rpeDistribution.maximal}</p>
            <p className="text-xs text-surface-500">Max</p>
            <p className="text-xs text-surface-600">RPE 9-10</p>
          </div>
        </div>
      </Card>

      {/* Exercise Details */}
      {exerciseDetails.length > 0 && (
        <Card>
          <button
            onClick={() => setShowExerciseDetails(!showExerciseDetails)}
            className="w-full flex items-center justify-between mb-3"
          >
            <h3 className="text-sm font-medium text-surface-200 flex items-center gap-2">
              <span>📋</span> Exercise Details ({exerciseDetails.length})
            </h3>
            <svg 
              className={`w-5 h-5 text-surface-400 transition-transform ${showExerciseDetails ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showExerciseDetails && (
            <div className="space-y-3">
              {exerciseDetails.map((exercise) => {
                const isExpanded = expandedExercises.has(exercise.blockId);
                return (
                  <div 
                    key={exercise.blockId}
                    className="bg-surface-800/50 rounded-lg overflow-hidden"
                  >
                    {/* Exercise header */}
                    <button
                      onClick={() => toggleExerciseExpanded(exercise.blockId)}
                      className="w-full p-3 flex items-center gap-3 hover:bg-surface-800 transition-colors"
                    >
                      <div className="flex-1 text-left">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-surface-100">{exercise.name}</span>
                          {exercise.hasPR && (
                            <Badge variant="warning" size="sm" className="bg-yellow-500/20 text-yellow-400">
                              🏆 PR
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-surface-400">
                          <span className="capitalize">{exercise.muscle}</span>
                          <span>•</span>
                          <span>{exercise.sets.length} sets</span>
                          <span>•</span>
                          <span>{displayWeight(exercise.totalVolume)}{weightUnit} vol</span>
                          <span>•</span>
                          <span>RPE {exercise.avgRpe}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-primary-400">
                          {displayWeight(exercise.maxWeight)}{weightUnit}
                        </p>
                        <p className="text-xs text-surface-500">top weight</p>
                      </div>
                      <svg 
                        className={`w-4 h-4 text-surface-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {/* Expanded set details */}
                    {isExpanded && (
                      <div className="px-3 pb-3 border-t border-surface-700">
                        {/* Quick stats */}
                        <div className="grid grid-cols-4 gap-2 py-3">
                          <div className="text-center">
                            <p className="text-sm font-bold text-surface-200">{displayWeight(exercise.bestE1RM)}{weightUnit}</p>
                            <p className="text-xs text-surface-500">Est. 1RM</p>
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-bold text-surface-200">{exercise.maxReps}</p>
                            <p className="text-xs text-surface-500">Max Reps</p>
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-bold text-surface-200">{displayWeight(exercise.totalVolume)}</p>
                            <p className="text-xs text-surface-500">Vol ({weightUnit})</p>
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-bold text-surface-200">{exercise.avgRpe}</p>
                            <p className="text-xs text-surface-500">Avg RPE</p>
                          </div>
                        </div>

                        {/* Set table */}
                        <div className="bg-surface-900/50 rounded-lg overflow-hidden">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-surface-500 text-xs">
                                <th className="px-2 py-1.5 text-left">Set</th>
                                <th className="px-2 py-1.5 text-center">Weight</th>
                                <th className="px-2 py-1.5 text-center">Reps</th>
                                <th className="px-2 py-1.5 text-center">RPE</th>
                                <th className="px-2 py-1.5 text-right">Quality</th>
                              </tr>
                            </thead>
                            <tbody>
                              {exercise.warmupSets.length > 0 && (
                                <tr className="text-surface-500 bg-surface-800/30">
                                  <td colSpan={5} className="px-2 py-1 text-xs">
                                    Warmup: {exercise.warmupSets.length} sets
                                  </td>
                                </tr>
                              )}
                              {exercise.sets.map((set, idx) => (
                                <tr 
                                  key={set.id}
                                  className={`border-t border-surface-800 ${
                                    set.quality === 'stimulative' ? 'bg-success-500/5' :
                                    set.quality === 'excessive' ? 'bg-danger-500/5' : ''
                                  }`}
                                >
                                  <td className="px-2 py-1.5 text-surface-400">{idx + 1}</td>
                                  <td className="px-2 py-1.5 text-center font-medium text-surface-200">
                                    {displayWeight(set.weightKg)}{weightUnit}
                                  </td>
                                  <td className="px-2 py-1.5 text-center text-surface-200">
                                    {set.reps}
                                  </td>
                                  <td className="px-2 py-1.5 text-center">
                                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                      set.rpe >= 9 ? 'bg-red-500/20 text-red-400' :
                                      set.rpe >= 8 ? 'bg-orange-500/20 text-orange-400' :
                                      set.rpe >= 7 ? 'bg-yellow-500/20 text-yellow-400' :
                                      'bg-green-500/20 text-green-400'
                                    }`}>
                                      {set.rpe}
                                    </span>
                                  </td>
                                  <td className="px-2 py-1.5 text-right">
                                    <span className={`text-xs ${
                                      set.quality === 'stimulative' ? 'text-success-400' :
                                      set.quality === 'effective' ? 'text-primary-400' :
                                      set.quality === 'junk' ? 'text-surface-500' :
                                      'text-danger-400'
                                    }`}>
                                      {set.quality === 'stimulative' ? '✓ Stim' :
                                       set.quality === 'effective' ? '○ Eff' :
                                       set.quality === 'junk' ? '— Junk' :
                                       '⚠ Excess'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* E1RM comparison if PR */}
                        {exercise.hasPR && exerciseHistories?.[exercise.exerciseId || '']?.previousBest && (
                          <div className="mt-2 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-yellow-400">🏆 New Personal Record!</span>
                              <span className="text-surface-300">
                                {displayWeight(exerciseHistories[exercise.exerciseId || ''].previousBest?.e1rm || 0)}{weightUnit} → <span className="font-bold text-yellow-400">{displayWeight(exercise.bestE1RM)}{weightUnit}</span>
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* Session RPE */}
      <Card>
        <h3 className="text-sm font-medium text-surface-200 mb-3">
          {readOnly ? 'Session RPE' : 'How hard was this session?'}
        </h3>
        {readOnly ? (
          <div className="flex items-center gap-3">
            <div className={`px-4 py-2 rounded-lg font-bold text-lg ${
              sessionRpe >= 9
                ? 'bg-danger-500/20 text-danger-400'
                : sessionRpe >= 7
                ? 'bg-warning-500/20 text-warning-400'
                : 'bg-primary-500/20 text-primary-400'
            }`}>
              {sessionRpe}/10
            </div>
            <span className="text-surface-400 text-sm">
              {sessionRpe >= 9 ? 'Maximum Effort' : sessionRpe >= 7 ? 'Hard' : sessionRpe >= 5 ? 'Moderate' : 'Easy'}
            </span>
          </div>
        ) : (
          <>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rpe) => (
                <button
                  key={rpe}
                  onClick={() => setSessionRpe(rpe)}
                  className={`flex-1 py-3 rounded-lg text-sm font-medium transition-colors ${
                    sessionRpe === rpe
                      ? rpe >= 9
                        ? 'bg-danger-500 text-white'
                        : rpe >= 7
                        ? 'bg-warning-500 text-white'
                        : 'bg-primary-500 text-white'
                      : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                  }`}
                >
                  {rpe}
                </button>
              ))}
            </div>
            <p className="text-xs text-surface-500 mt-2 text-center">
              Session RPE (1 = Very Easy, 10 = Maximum Effort)
            </p>
          </>
        )}
      </Card>

      {/* Pump Rating */}
      <Card>
        <h3 className="text-sm font-medium text-surface-200 mb-3">
          {readOnly ? 'Pump Rating' : 'How was the pump/mind-muscle connection?'}
        </h3>
        {readOnly ? (
          <div className="flex items-center gap-3">
            <div className="px-4 py-2 rounded-lg bg-accent-500/20 text-accent-400 font-bold text-lg">
              {pumpRating === 1 && '😐'}
              {pumpRating === 2 && '🙂'}
              {pumpRating === 3 && '😊'}
              {pumpRating === 4 && '😄'}
              {pumpRating === 5 && '🔥'}
              {' '}{pumpRating}/5
            </div>
            <span className="text-surface-400 text-sm">
              {pumpRating === 5 ? 'Incredible Pump' : pumpRating >= 3 ? 'Good Connection' : 'Weak Connection'}
            </span>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  onClick={() => setPumpRating(rating)}
                  className={`flex-1 py-3 rounded-lg text-sm font-medium transition-colors ${
                    pumpRating === rating
                      ? 'bg-accent-500 text-white'
                      : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                  }`}
                >
                  {rating === 1 && '😐'}
                  {rating === 2 && '🙂'}
                  {rating === 3 && '😊'}
                  {rating === 4 && '😄'}
                  {rating === 5 && '🔥'}
                </button>
              ))}
            </div>
            <p className="text-xs text-surface-500 mt-2 text-center">
              1 = Poor Connection, 5 = Incredible Pump
            </p>
          </>
        )}
      </Card>

      {/* Notes */}
      {(notes || !readOnly) && (
        <Card>
          <h3 className="text-sm font-medium text-surface-200 mb-3">
            Session Notes {!readOnly && '(optional)'}
          </h3>
          {readOnly ? (
            <p className="text-surface-300">{notes || 'No notes recorded'}</p>
          ) : (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="How did you feel? Any issues? Wins to celebrate?"
              rows={3}
              className="w-full px-4 py-3 bg-surface-800 border border-surface-700 rounded-lg text-surface-200 placeholder:text-surface-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
          )}
        </Card>
      )}

      {/* Submit - only shown when not in read-only mode */}
      {!readOnly && (
        <Button onClick={handleSubmit} size="lg" className="w-full">
          Save & Finish
        </Button>
      )}
    </div>
  );
}

