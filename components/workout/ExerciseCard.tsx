'use client';

import { useState, useEffect } from 'react';
import { Card, Badge, SetQualityBadge, Button } from '@/components/ui';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/Accordion';
import type { Exercise, ExerciseBlock, SetLog, ProgressionType, WeightUnit, SetQuality } from '@/types/schema';
import { formatWeight, formatWeightValue, inputWeightToKg } from '@/lib/utils';
import { calculateSetQuality } from '@/services/progressionEngine';

interface ExerciseHistory {
  lastWorkoutDate: string;
  lastWorkoutSets: { weightKg: number; reps: number; rpe?: number }[];
  estimatedE1RM: number;
  personalRecord: { weightKg: number; reps: number; e1rm: number; date: string } | null;
  totalSessions: number;
}

interface ExerciseCardProps {
  exercise: Exercise;
  block: ExerciseBlock;
  sets: SetLog[];
  onSetComplete?: (setData: { weightKg: number; reps: number; rpe: number; note?: string }) => void;
  onSetEdit?: (setId: string, data: { weightKg: number; reps: number; rpe: number }) => void;
  onSetDelete?: (setId: string) => void;
  onTargetSetsChange?: (newTargetSets: number) => void;  // Callback to add/remove planned sets
  isActive?: boolean;
  unit?: WeightUnit;
  recommendedWeight?: number;  // AI-suggested weight in kg
  previousSets?: { weightKg: number; reps: number }[];  // Previous workout's sets for this exercise
  exerciseHistory?: ExerciseHistory;  // Historical data for this exercise
}

export function ExerciseCard({
  exercise,
  block,
  sets,
  onSetComplete,
  onSetEdit,
  onSetDelete,
  onTargetSetsChange,
  isActive = false,
  unit = 'kg',
  recommendedWeight,
  previousSets = [],
  exerciseHistory,
}: ExerciseCardProps) {
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [editWeight, setEditWeight] = useState('');
  const [editReps, setEditReps] = useState('');
  const [editRpe, setEditRpe] = useState('');

  // State for pending set inputs (one per pending set)
  const [pendingInputs, setPendingInputs] = useState<{
    weight: string;
    reps: string;
    rpe: string;
  }[]>([]);

  const completedSets = sets.filter((s) => !s.isWarmup);
  const pendingSetsCount = Math.max(0, block.targetSets - completedSets.length);
  const progressPercent = Math.round((completedSets.length / block.targetSets) * 100);

  // Determine suggested weight
  const suggestedWeight = block.targetWeightKg > 0 
    ? block.targetWeightKg 
    : (recommendedWeight && recommendedWeight > 0 ? recommendedWeight : 0);

  // Format weight for display
  const displayWeight = (kg: number) => formatWeightValue(kg, unit);
  const weightLabel = unit === 'lb' ? 'lbs' : 'kg';

  // Initialize pending inputs when sets change
  useEffect(() => {
    const newPendingInputs: { weight: string; reps: string; rpe: string }[] = [];
    
    for (let i = 0; i < pendingSetsCount; i++) {
      const setIndex = completedSets.length + i;
      
      // Try to get previous workout's data for this set
      const prevSet = previousSets[setIndex];
      
      // Get the last completed set to use as reference
      const lastCompleted = completedSets[completedSets.length - 1];
      
      let defaultWeight: number;
      let defaultReps: number;
      
      if (prevSet) {
        // Use previous workout's data
        defaultWeight = prevSet.weightKg;
        defaultReps = prevSet.reps;
      } else if (lastCompleted) {
        // Use last completed set from current workout
        defaultWeight = lastCompleted.weightKg;
        defaultReps = lastCompleted.reps;
      } else {
        // Use suggested weight and middle of rep range
        defaultWeight = suggestedWeight;
        defaultReps = Math.round((block.targetRepRange[0] + block.targetRepRange[1]) / 2);
      }
      
      newPendingInputs.push({
        weight: defaultWeight > 0 ? String(displayWeight(defaultWeight)) : '',
        reps: String(defaultReps),
        rpe: String(10 - block.targetRir),
      });
    }
    
    setPendingInputs(newPendingInputs);
  }, [completedSets.length, pendingSetsCount, suggestedWeight, block.targetRepRange, block.targetRir]);

  const updatePendingInput = (index: number, field: 'weight' | 'reps' | 'rpe', value: string) => {
    setPendingInputs(prev => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = { ...updated[index], [field]: value };
      }
      return updated;
    });
  };

  const completePendingSet = (index: number) => {
    if (!onSetComplete) return;
    
    const input = pendingInputs[index];
    if (!input) return;
    
    const weightNum = parseFloat(input.weight);
    const repsNum = parseInt(input.reps);
    const rpeNum = parseFloat(input.rpe);
    
    if (isNaN(weightNum) || isNaN(repsNum) || isNaN(rpeNum)) {
      return;
    }
    
    // Convert from display unit to kg
    const weightKg = inputWeightToKg(weightNum, unit);
    
    onSetComplete({
      weightKg,
      reps: repsNum,
      rpe: rpeNum,
    });
  };

  const getQualityPreview = (input: { weight: string; reps: string; rpe: string }): { quality: SetQuality; reason: string } | null => {
    const repsNum = parseInt(input.reps);
    const rpeNum = parseFloat(input.rpe);
    
    if (isNaN(repsNum) || isNaN(rpeNum)) return null;
    
    return calculateSetQuality({
      rpe: rpeNum,
      targetRir: block.targetRir,
      reps: repsNum,
      targetRepRange: block.targetRepRange,
      isLastSet: false,
    });
  };

  const startEditing = (set: SetLog) => {
    setEditingSetId(set.id);
    setEditWeight(String(displayWeight(set.weightKg)));
    setEditReps(String(set.reps));
    setEditRpe(String(set.rpe));
  };

  const cancelEditing = () => {
    setEditingSetId(null);
    setEditWeight('');
    setEditReps('');
    setEditRpe('');
  };

  const saveEdit = () => {
    if (!editingSetId || !onSetEdit) return;
    const weightNum = parseFloat(editWeight);
    const repsNum = parseInt(editReps);
    const rpeNum = parseFloat(editRpe);
    
    if (!isNaN(weightNum) && !isNaN(repsNum) && !isNaN(rpeNum)) {
      const weightKg = inputWeightToKg(weightNum, unit);
      onSetEdit(editingSetId, { weightKg, reps: repsNum, rpe: rpeNum });
    }
    cancelEditing();
  };

  const getProgressionIcon = (type: ProgressionType | null) => {
    switch (type) {
      case 'load':
        return (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        );
      case 'reps':
        return (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        );
      case 'sets':
        return (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        );
      default:
        return null;
    }
  };

  const getQualityColor = (quality: SetQuality) => {
    switch (quality) {
      case 'junk': return 'text-surface-500';
      case 'effective': return 'text-primary-400';
      case 'stimulative': return 'text-success-400';
      case 'excessive': return 'text-danger-400';
    }
  };

  return (
    <Card
      variant={isActive ? 'elevated' : 'default'}
      padding="none"
      className={`overflow-hidden transition-all ${isActive ? 'ring-2 ring-primary-500/50' : ''}`}
    >
      {/* Header */}
      <div className="p-4 border-b border-surface-800">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-surface-100 truncate">
                {exercise.name}
              </h3>
              {block.progressionType && (
                <span className="flex items-center gap-1 text-primary-400">
                  {getProgressionIcon(block.progressionType)}
                </span>
              )}
            </div>
            <p className="text-sm text-surface-400 mt-0.5">
              {exercise.primaryMuscle} • {exercise.mechanic}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Set controls */}
            {onTargetSetsChange && isActive && (
              <div className="flex items-center gap-1 mr-2">
                <button
                  onClick={() => onTargetSetsChange(Math.max(1, block.targetSets - 1))}
                  disabled={block.targetSets <= completedSets.length || block.targetSets <= 1}
                  className="w-7 h-7 flex items-center justify-center rounded bg-surface-700 hover:bg-surface-600 text-surface-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Remove a set"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                  </svg>
                </button>
                <button
                  onClick={() => onTargetSetsChange(block.targetSets + 1)}
                  disabled={block.targetSets >= 10}
                  className="w-7 h-7 flex items-center justify-center rounded bg-surface-700 hover:bg-surface-600 text-surface-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Add a set"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>
            )}
            <Badge variant={progressPercent === 100 ? 'success' : 'default'}>
              {completedSets.length}/{block.targetSets}
            </Badge>
          </div>
        </div>

        {/* Targets */}
        <div className="flex flex-wrap gap-3 mt-3 text-sm">
          <div className="flex items-center gap-1.5">
            {suggestedWeight > 0 ? (
              <>
                <span className="text-primary-500">💡 Suggested:</span>
                <span className="font-medium text-primary-300">
                  {displayWeight(suggestedWeight)} {weightLabel}
                </span>
              </>
            ) : (
              <>
                <span className="text-surface-500">Weight:</span>
                <span className="font-medium text-surface-400 italic">
                  Enter your working weight
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-surface-500">Reps:</span>
            <span className="font-medium text-surface-200">
              {block.targetRepRange[0]}-{block.targetRepRange[1]}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-surface-500">RIR:</span>
            <span className="font-medium text-surface-200">
              {block.targetRir}
            </span>
          </div>
        </div>

        {/* Suggestion reason */}
        {block.suggestionReason && (
          <p className="mt-2 text-xs text-primary-400/80 italic">
            {block.suggestionReason}
          </p>
        )}

        {/* Exercise Stats & History */}
        {exerciseHistory && (
          <div className="mt-3 pt-3 border-t border-surface-800">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center justify-between w-full text-left"
            >
              <div className="flex items-center gap-4">
                {/* Estimated 1RM */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-surface-500">Est 1RM:</span>
                  <span className="text-sm font-bold text-primary-400">
                    {displayWeight(exerciseHistory.estimatedE1RM)} {weightLabel}
                  </span>
                </div>
                {/* PR indicator */}
                {exerciseHistory.personalRecord && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-surface-500">PR:</span>
                    <span className="text-sm font-medium text-success-400">
                      {displayWeight(exerciseHistory.personalRecord.weightKg)} × {exerciseHistory.personalRecord.reps}
                    </span>
                  </div>
                )}
                {/* Sessions count */}
                <span className="text-xs text-surface-500">
                  {exerciseHistory.totalSessions} sessions
                </span>
              </div>
              <svg 
                className={`w-4 h-4 text-surface-400 transition-transform ${showHistory ? 'rotate-180' : ''}`}
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Expanded history */}
            {showHistory && (
              <div className="mt-3 space-y-3">
                {/* Last workout */}
                {exerciseHistory.lastWorkoutSets.length > 0 && (
                  <div className="p-3 bg-surface-800/50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-surface-400 uppercase tracking-wider">
                        Last Workout
                      </span>
                      <span className="text-xs text-surface-500">
                        {new Date(exerciseHistory.lastWorkoutDate).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {exerciseHistory.lastWorkoutSets.map((set, idx) => (
                        <span 
                          key={idx}
                          className="px-2 py-1 bg-surface-700 rounded text-xs text-surface-300"
                        >
                          {displayWeight(set.weightKg)} × {set.reps}
                          {set.rpe && <span className="text-surface-500"> @{set.rpe}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Exercise resources */}
                <div className="flex gap-2">
                  <a
                    href={`https://www.youtube.com/results?search_query=${encodeURIComponent(exercise.name + ' exercise form')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-800 hover:bg-surface-700 rounded-lg text-xs text-surface-300 transition-colors"
                  >
                    <svg className="w-4 h-4 text-red-500" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                    </svg>
                    Watch Form
                  </a>
                  <a
                    href={`https://exrx.net/Lists/Directory`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-800 hover:bg-surface-700 rounded-lg text-xs text-surface-300 transition-colors"
                  >
                    <svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Exercise Info
                  </a>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Quick links when no history */}
        {!exerciseHistory && (
          <div className="mt-3 pt-3 border-t border-surface-800">
            <div className="flex gap-2">
              <a
                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(exercise.name + ' exercise form')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-800 hover:bg-surface-700 rounded-lg text-xs text-surface-300 transition-colors"
              >
                <svg className="w-4 h-4 text-red-500" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                </svg>
                Watch Form
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Sets table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-800/50">
            <tr>
              <th className="px-3 py-2 text-left text-surface-400 font-medium w-12">Set</th>
              <th className="px-2 py-2 text-center text-surface-400 font-medium">Weight</th>
              <th className="px-2 py-2 text-center text-surface-400 font-medium">Reps</th>
              <th className="px-2 py-2 text-center text-surface-400 font-medium">RPE</th>
              <th className="px-3 py-2 text-center text-surface-400 font-medium w-20">Quality</th>
              <th className="px-2 py-2 w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-800">
            {/* Completed sets */}
            {completedSets.map((set) => (
              editingSetId === set.id ? (
                <tr key={set.id} className="bg-primary-500/10">
                  <td className="px-3 py-2 text-surface-300 font-medium">{set.setNumber}</td>
                  <td className="px-1 py-1.5">
                    <input
                      type="number"
                      value={editWeight}
                      onChange={(e) => setEditWeight(e.target.value)}
                      step="0.5"
                      className="w-full px-2 py-1.5 bg-surface-900 border border-surface-600 rounded text-center font-mono text-surface-100 text-sm"
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <input
                      type="number"
                      value={editReps}
                      onChange={(e) => setEditReps(e.target.value)}
                      className="w-full px-2 py-1.5 bg-surface-900 border border-surface-600 rounded text-center font-mono text-surface-100 text-sm"
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <input
                      type="number"
                      value={editRpe}
                      onChange={(e) => setEditRpe(e.target.value)}
                      step="0.5"
                      className="w-full px-2 py-1.5 bg-surface-900 border border-surface-600 rounded text-center font-mono text-surface-100 text-sm"
                    />
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <SetQualityBadge quality={set.quality} />
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex gap-1 justify-center">
                      <button
                        onClick={saveEdit}
                        className="p-1.5 text-success-400 hover:bg-success-500/20 rounded"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </button>
                      <button
                        onClick={cancelEditing}
                        className="p-1.5 text-surface-400 hover:bg-surface-700 rounded"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr
                  key={set.id}
                  className="hover:bg-surface-800/30 group bg-success-500/5"
                >
                  <td className="px-3 py-2.5 text-surface-300 font-medium">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-success-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {set.setNumber}
                    </div>
                  </td>
                  <td 
                    className={`px-2 py-2.5 text-center font-mono text-surface-200 ${onSetEdit ? 'cursor-pointer hover:text-primary-400' : ''}`}
                    onClick={() => onSetEdit && startEditing(set)}
                  >
                    {displayWeight(set.weightKg)}
                  </td>
                  <td 
                    className={`px-2 py-2.5 text-center font-mono text-surface-200 ${onSetEdit ? 'cursor-pointer hover:text-primary-400' : ''}`}
                    onClick={() => onSetEdit && startEditing(set)}
                  >
                    {set.reps}
                  </td>
                  <td 
                    className={`px-2 py-2.5 text-center font-mono text-surface-200 ${onSetEdit ? 'cursor-pointer hover:text-primary-400' : ''}`}
                    onClick={() => onSetEdit && startEditing(set)}
                  >
                    {set.rpe}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <SetQualityBadge quality={set.quality} />
                  </td>
                  <td className="px-2 py-2.5">
                    {onSetDelete && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm('Delete this set?')) {
                            onSetDelete(set.id);
                          }
                        }}
                        className="p-1.5 text-surface-600 hover:text-danger-400 hover:bg-danger-500/10 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete set"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </td>
                </tr>
              )
            ))}
            
            {/* Pending sets - editable with pre-filled values */}
            {isActive && pendingInputs.map((input, index) => {
              const setNumber = completedSets.length + index + 1;
              const qualityPreview = getQualityPreview(input);
              
              return (
                <tr key={`pending-${index}`} className="bg-surface-800/30">
                  <td className="px-3 py-2 text-surface-400 font-medium">{setNumber}</td>
                  <td className="px-1 py-1.5">
                    <input
                      type="number"
                      value={input.weight}
                      onChange={(e) => updatePendingInput(index, 'weight', e.target.value)}
                      step="0.5"
                      min="0"
                      placeholder={suggestedWeight > 0 ? String(displayWeight(suggestedWeight)) : '—'}
                      className="w-full px-2 py-1.5 bg-surface-900 border border-surface-700 rounded text-center font-mono text-surface-100 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <input
                      type="number"
                      value={input.reps}
                      onChange={(e) => updatePendingInput(index, 'reps', e.target.value)}
                      min="0"
                      max="100"
                      className="w-full px-2 py-1.5 bg-surface-900 border border-surface-700 rounded text-center font-mono text-surface-100 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <input
                      type="number"
                      value={input.rpe}
                      onChange={(e) => updatePendingInput(index, 'rpe', e.target.value)}
                      step="0.5"
                      min="1"
                      max="10"
                      className="w-full px-2 py-1.5 bg-surface-900 border border-surface-700 rounded text-center font-mono text-surface-100 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {qualityPreview ? (
                      <span className={`text-xs font-medium ${getQualityColor(qualityPreview.quality)}`}>
                        {qualityPreview.quality}
                      </span>
                    ) : (
                      <span className="text-surface-600">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <button
                      onClick={() => completePendingSet(index)}
                      disabled={!input.weight || !input.reps || !input.rpe}
                      className="p-2 bg-primary-500 hover:bg-primary-600 disabled:bg-surface-700 disabled:text-surface-500 text-white rounded-lg transition-colors"
                      title="Complete set"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </button>
                  </td>
                </tr>
              );
            })}
            
            {/* Show placeholder rows when not active */}
            {!isActive && pendingSetsCount > 0 && Array.from({ length: pendingSetsCount }).map((_, i) => (
              <tr key={`inactive-${i}`} className="bg-surface-800/20">
                <td className="px-3 py-2.5 text-surface-500">{completedSets.length + i + 1}</td>
                <td className="px-2 py-2.5 text-center text-surface-600">—</td>
                <td className="px-2 py-2.5 text-center text-surface-600">—</td>
                <td className="px-2 py-2.5 text-center text-surface-600">—</td>
                <td className="px-3 py-2.5 text-center text-surface-600">—</td>
                <td className="px-2 py-2.5"></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Form cues accordion */}
      {exercise.formCues.length > 0 && (
        <div className="border-t border-surface-800">
          <Accordion>
            <AccordionItem id="form-cues">
              <div className="px-4">
                <AccordionTrigger id="form-cues">
                  <span className="text-sm text-surface-400">Form Cues & Tips</span>
                </AccordionTrigger>
                <AccordionContent id="form-cues">
                  <div className="space-y-3">
                    <div>
                      <h4 className="text-xs font-medium text-surface-300 uppercase tracking-wide mb-1">
                        Key Cues
                      </h4>
                      <ul className="space-y-1">
                        {exercise.formCues.map((cue, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-surface-400">
                            <span className="text-primary-400 mt-1">•</span>
                            {cue}
                          </li>
                        ))}
                      </ul>
                    </div>
                    {exercise.commonMistakes.length > 0 && (
                      <div>
                        <h4 className="text-xs font-medium text-surface-300 uppercase tracking-wide mb-1">
                          Common Mistakes
                        </h4>
                        <ul className="space-y-1">
                          {exercise.commonMistakes.map((mistake, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-danger-400/80">
                              <span className="mt-1">✗</span>
                              {mistake}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {exercise.setupNote && (
                      <div className="pt-2 border-t border-surface-800">
                        <p className="text-xs text-surface-500">
                          <span className="font-medium">Setup:</span> {exercise.setupNote}
                        </p>
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </div>
            </AccordionItem>
          </Accordion>
        </div>
      )}
    </Card>
  );
}
