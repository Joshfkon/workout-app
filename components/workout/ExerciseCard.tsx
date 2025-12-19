'use client';

import React, { useState, useEffect, useMemo, memo, useRef } from 'react';
import { Card, Badge, SetQualityBadge, Button } from '@/components/ui';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/Accordion';
import type { Exercise, ExerciseBlock, SetLog, ProgressionType, WeightUnit, SetQuality } from '@/types/schema';
import { formatWeight, formatWeightValue, inputWeightToKg, roundToPlateIncrement, formatDuration } from '@/lib/utils';
import { calculateSetQuality } from '@/services/progressionEngine';
import { findSimilarExercises, calculateSimilarityScore } from '@/services/exerciseSwapper';
import { Input } from '@/components/ui';
import { InlineRestTimerBar } from './InlineRestTimerBar';

const MUSCLE_GROUPS = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs'];

// Get color classes for hypertrophy tier badge (compact version for workouts)
function getTierBadgeClasses(tier: string): string {
  switch (tier) {
    case 'S': return 'bg-gradient-to-r from-amber-500 to-yellow-400 text-black';
    case 'A': return 'bg-emerald-500/30 text-emerald-400';
    case 'B': return 'bg-blue-500/30 text-blue-400';
    case 'C': return 'bg-surface-600 text-surface-400';
    case 'D': return 'bg-orange-500/30 text-orange-400';
    case 'F': return 'bg-red-500/30 text-red-400';
    default: return 'bg-surface-700 text-surface-500';
  }
}

interface ExerciseHistory {
  lastWorkoutDate: string;
  lastWorkoutSets: { weightKg: number; reps: number; rpe?: number }[];
  estimatedE1RM: number;
  personalRecord: { weightKg: number; reps: number; e1rm: number; date: string } | null;
  totalSessions: number;
}

interface WarmupSetData {
  setNumber: number;
  percentOfWorking: number;
  targetReps: number;
  purpose: string;
  restSeconds?: number;  // Rest time after this warmup set
}

import { 
  getInjuryRisk, 
  INJURY_LABELS,
  type InjuryArea,
  type InjuryRisk
} from '@/services/injuryAwareSwapper';

interface TemporaryInjury {
  area: string;
  severity: 1 | 2 | 3;
}

// Wrapper to use the intelligent injury swapper service
function getExerciseInjuryRiskFromService(
  exercise: { name: string; primaryMuscle: string },
  injuries: TemporaryInjury[]
): { isRisky: boolean; severity: number; reasons: string[]; risk: InjuryRisk } {
  if (injuries.length === 0) return { isRisky: false, severity: 0, reasons: [], risk: 'safe' };
  
  let worstRisk: InjuryRisk = 'safe';
  let maxSeverity = 0;
  const reasons: string[] = [];
  
  for (const injury of injuries) {
    const risk = getInjuryRisk(
      { 
        id: '', 
        name: exercise.name, 
        primaryMuscle: exercise.primaryMuscle,
        secondaryMuscles: [],
        mechanic: 'compound',
        defaultRepRange: [8, 12] as [number, number],
        defaultRir: 2,
        minWeightIncrementKg: 2.5,
        formCues: [],
        commonMistakes: [],
        setupNote: '',
        movementPattern: '',
        equipmentRequired: [],
      }, 
      injury.area as InjuryArea
    );
    
    if (risk === 'avoid') {
      worstRisk = 'avoid';
      maxSeverity = Math.max(maxSeverity, injury.severity);
      reasons.push(`May aggravate ${INJURY_LABELS[injury.area] || injury.area.replace('_', ' ')}`);
    } else if (risk === 'caution' && worstRisk !== 'avoid') {
      worstRisk = 'caution';
      maxSeverity = Math.max(maxSeverity, injury.severity);
      reasons.push(`Use caution (${INJURY_LABELS[injury.area] || injury.area.replace('_', ' ')})`);
    }
  }
  
  return {
    isRisky: worstRisk !== 'safe',
    severity: maxSeverity,
    reasons: Array.from(new Set(reasons)),
    risk: worstRisk
  };
}

type SetType = 'normal' | 'warmup' | 'dropset' | 'myorep' | 'rest_pause';

interface SetCompleteData {
  weightKg: number;
  reps: number;
  rpe: number;
  note?: string;
  setType?: SetType;
  parentSetId?: string;  // For dropsets: the ID of the parent set
}

interface ExerciseCardProps {
  exercise: Exercise;
  block: ExerciseBlock;
  sets: SetLog[];
  onSetComplete?: (setData: SetCompleteData) => void;
  onSetEdit?: (setId: string, data: { weightKg: number; reps: number; rpe: number }) => void;
  onSetDelete?: (setId: string) => void;
  onTargetSetsChange?: (newTargetSets: number) => void;  // Callback to add/remove planned sets
  onExerciseSwap?: (newExercise: Exercise) => void;  // Callback to swap exercise
  onExerciseDelete?: () => void;  // Callback to delete entire exercise from workout
  onWarmupComplete?: (restSeconds: number) => void;  // Callback when a warmup set is completed
  availableExercises?: Exercise[];  // All exercises for swap suggestions
  frequentExerciseIds?: Map<string, number>;  // Exercise usage counts for sorting
  isActive?: boolean;
  unit?: WeightUnit;
  recommendedWeight?: number;  // AI-suggested weight in kg
  previousSets?: { weightKg: number; reps: number }[];  // Previous workout's sets for this exercise
  exerciseHistory?: ExerciseHistory;  // Historical data for this exercise
  hideHeader?: boolean;  // Hide the exercise name header (for mobile when shown in parent)
  warmupSets?: WarmupSetData[];  // Warmup protocol for this exercise
  workingWeight?: number;  // Working weight in kg for warmup calculations
  showSwapOnMount?: boolean;  // Auto-show swap modal when mounted (for injury-related swaps)
  currentInjuries?: TemporaryInjury[];  // Current injuries to filter swap suggestions
  // Rest timer state for inline display
  showRestTimer?: boolean;
  timerSeconds?: number;
  timerInitialSeconds?: number;
  timerIsRunning?: boolean;
  timerIsFinished?: boolean;
  onShowTimerControls?: () => void;
}

// PERFORMANCE: Memoized component to prevent unnecessary re-renders
export const ExerciseCard = memo(function ExerciseCard({
  exercise,
  block,
  sets,
  onSetComplete,
  onSetEdit,
  onSetDelete,
  onTargetSetsChange,
  onExerciseSwap,
  onExerciseDelete,
  onWarmupComplete,
  availableExercises = [],
  frequentExerciseIds = new Map(),
  isActive = false,
  unit = 'kg',
  recommendedWeight,
  previousSets = [],
  exerciseHistory,
  hideHeader = false,
  warmupSets = [],
  workingWeight = 0,
  showSwapOnMount = false,
  currentInjuries = [],
  showRestTimer = false,
  timerSeconds = 0,
  timerInitialSeconds = 0,
  timerIsRunning = false,
  timerIsFinished = false,
  onShowTimerControls,
}: ExerciseCardProps) {
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [completedWarmups, setCompletedWarmups] = useState<Set<number>>(new Set());
  const [editingWarmupId, setEditingWarmupId] = useState<number | null>(null);
  const [customWarmupWeights, setCustomWarmupWeights] = useState<Map<number, number>>(new Map());
  const [warmupWeightInput, setWarmupWeightInput] = useState('');
  const [showRpeGuide, setShowRpeGuide] = useState(false);
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [swapTab, setSwapTab] = useState<'similar' | 'browse'>('similar');
  const [swapSearch, setSwapSearch] = useState('');
  const [isCompletingSet, setIsCompletingSet] = useState(false); // Prevent double-clicks
  const [dropsetMode, setDropsetMode] = useState<{ parentSetId: string; parentWeight: number } | null>(null);
  
  // Auto-show swap modal when showSwapOnMount is true
  useEffect(() => {
    if (showSwapOnMount) {
      setShowSwapModal(true);
    }
  }, [showSwapOnMount]);
  
  // Reset warmup completion state when this exercise becomes active
  // This ensures warmups are fresh when switching exercises out of order
  const prevIsActiveRef = useRef(isActive);
  useEffect(() => {
    // Only reset if we just became active (wasn't active before, now is)
    if (isActive && !prevIsActiveRef.current) {
      setCompletedWarmups(new Set());
    }
    prevIsActiveRef.current = isActive;
  }, [isActive]);
  
  const [swapMuscleFilter, setSwapMuscleFilter] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [editReps, setEditReps] = useState('');
  const [editRpe, setEditRpe] = useState('');
  
  // Swipe to delete state
  const [swipeState, setSwipeState] = useState<{
    setId: string | null;
    startX: number;
    currentX: number;
    isSwiping: boolean;
  }>({ setId: null, startX: 0, currentX: 0, isSwiping: false });

  // Calculate similar exercises for swap suggestions, filtering out injury-risky ones
  const similarExercises = useMemo(() => {
    if (availableExercises.length === 0) return [];
    
    const similar = findSimilarExercises(exercise, availableExercises)
      .slice(0, 15) // Get more to filter
      .map(ex => {
        const injuryRisk = getExerciseInjuryRiskFromService({ name: ex.name, primaryMuscle: ex.primaryMuscle }, currentInjuries);
        return {
          exercise: ex,
          score: calculateSimilarityScore(exercise, ex),
          injuryRisk
        };
      });
    
    // Sort: safe exercises first, then by similarity score
    return similar.sort((a, b) => {
      // Safe exercises come first
      if (!a.injuryRisk.isRisky && b.injuryRisk.isRisky) return -1;
      if (a.injuryRisk.isRisky && !b.injuryRisk.isRisky) return 1;
      // Then by severity (lower is better)
      if (a.injuryRisk.severity !== b.injuryRisk.severity) {
        return a.injuryRisk.severity - b.injuryRisk.severity;
      }
      // Then by similarity score
      return b.score - a.score;
    }).slice(0, 8);
  }, [exercise, availableExercises, currentInjuries]);
  
  // Count safe alternatives
  const safeAlternatives = similarExercises.filter(s => !s.injuryRisk.isRisky);
  const hasInjuries = currentInjuries.length > 0;

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

  // Track the last known completed sets count to detect changes
  const prevCompletedCountRef = useRef(completedSets.length);
  
  // Initialize pending inputs when component mounts or when we need a full reset
  // Only reinitialize when pendingSetsCount increases (sets were added) or on first mount
  useEffect(() => {
    const prevCount = prevCompletedCountRef.current;
    const currentCount = completedSets.length;
    prevCompletedCountRef.current = currentCount;
    
    // If a set was just completed (count increased), update all pending inputs
    // based on the just-completed set's performance
    if (currentCount > prevCount) {
      const targetRpe = 10 - block.targetRir;
      const lastCompleted = completedSets[completedSets.length - 1];
      
      // Calculate smart defaults based on the just-completed set
      let smartWeight: number;
      let smartReps: number;
      
      if (lastCompleted) {
        const lastRpe = lastCompleted.rpe;
        // If RPE was off target, adjust weight suggestion
        if (lastRpe && Math.abs(lastRpe - targetRpe) > 0.5) {
          smartWeight = getRpeAdjustedWeight(lastRpe, targetRpe, lastCompleted.weightKg);
        } else {
          smartWeight = lastCompleted.weightKg;
        }
        smartReps = lastCompleted.reps;
      } else {
        smartWeight = suggestedWeight;
        smartReps = Math.round((block.targetRepRange[0] + block.targetRepRange[1]) / 2);
      }
      
      // Create updated pending inputs - all based on the last completed set
      const updatedInputs: { weight: string; reps: string; rpe: string }[] = [];
      for (let i = 0; i < pendingSetsCount; i++) {
        updatedInputs.push({
          weight: smartWeight > 0 ? String(displayWeight(smartWeight)) : '',
          reps: String(smartReps),
          rpe: String(targetRpe),
        });
      }
      
      setPendingInputs(updatedInputs);
      return;
    }
    
    // Full initialization only if:
    // - pendingInputs is empty and we need inputs
    // - OR pendingSetsCount increased (new sets were added to the target)
    if (pendingSetsCount > 0 && (pendingInputs.length === 0 || pendingInputs.length < pendingSetsCount)) {
      const newPendingInputs: { weight: string; reps: string; rpe: string }[] = [];
      const targetRpe = 10 - block.targetRir;
      
      for (let i = 0; i < pendingSetsCount; i++) {
        // Keep existing input if available
        if (i < pendingInputs.length && pendingInputs[i]) {
          newPendingInputs.push(pendingInputs[i]);
          continue;
        }
        
        const setIndex = completedSets.length + i;
        const prevSet = previousSets[setIndex];
        const lastCompleted = completedSets[completedSets.length - 1];
        
        let defaultWeight: number;
        let defaultReps: number;
        
        if (lastCompleted) {
          const lastRpe = lastCompleted.rpe;
          if (lastRpe && Math.abs(lastRpe - targetRpe) > 0.5) {
            defaultWeight = getRpeAdjustedWeight(lastRpe, targetRpe, lastCompleted.weightKg);
          } else {
            defaultWeight = lastCompleted.weightKg;
          }
          defaultReps = lastCompleted.reps;
        } else if (prevSet) {
          defaultWeight = prevSet.weightKg;
          defaultReps = prevSet.reps;
        } else {
          defaultWeight = suggestedWeight;
          defaultReps = Math.round((block.targetRepRange[0] + block.targetRepRange[1]) / 2);
        }
        
        newPendingInputs.push({
          weight: defaultWeight > 0 ? String(displayWeight(defaultWeight)) : '',
          reps: String(defaultReps),
          rpe: String(targetRpe),
        });
      }
      
      setPendingInputs(newPendingInputs);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedSets.length, pendingSetsCount]);

  // Swipe to delete handlers
  const handleTouchStart = (setId: string, e: React.TouchEvent) => {
    setSwipeState({
      setId,
      startX: e.touches[0].clientX,
      currentX: e.touches[0].clientX,
      isSwiping: false,
    });
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!swipeState.setId) return;
    const diff = swipeState.startX - e.touches[0].clientX;
    // Only allow left swipe
    if (diff > 10) {
      setSwipeState(prev => ({
        ...prev,
        currentX: e.touches[0].clientX,
        isSwiping: true,
      }));
    }
  };

  const handleTouchEnd = (setId: string, isCompleted: boolean) => {
    if (!swipeState.isSwiping) {
      setSwipeState({ setId: null, startX: 0, currentX: 0, isSwiping: false });
      return;
    }
    
    const swipeDistance = swipeState.startX - swipeState.currentX;
    const threshold = 100; // pixels to trigger delete
    
    if (swipeDistance > threshold) {
      if (isCompleted && onSetDelete) {
        onSetDelete(setId);
      } else if (!isCompleted) {
        // Remove pending set by reducing target sets
        if (onTargetSetsChange && block.targetSets > completedSets.length) {
          onTargetSetsChange(block.targetSets - 1);
        }
      }
    }
    
    setSwipeState({ setId: null, startX: 0, currentX: 0, isSwiping: false });
  };

  const getSwipeTransform = (setId: string) => {
    if (swipeState.setId !== setId || !swipeState.isSwiping) return {};
    const diff = Math.min(120, Math.max(0, swipeState.startX - swipeState.currentX));
    return {
      transform: `translateX(-${diff}px)`,
      transition: 'none',
    };
  };

  // Calculate reps based on weight change using percentage of 1RM
  // Uses Epley formula: 1RM = weight × (1 + reps/30)
  const calculateRepsFromWeight = (newWeightKg: number, referenceWeightKg: number, referenceReps: number): number => {
    if (referenceWeightKg <= 0 || newWeightKg <= 0 || referenceReps <= 0) return referenceReps;
    
    // Estimate 1RM from reference
    const e1rm = referenceWeightKg * (1 + referenceReps / 30);
    
    // Calculate what reps we can do at new weight
    // reps = 30 × (1RM/weight - 1)
    const estimatedReps = Math.round(30 * (e1rm / newWeightKg - 1));
    
    // Clamp to reasonable range
    return Math.max(1, Math.min(30, estimatedReps));
  };

  // Get RPE adjustment for next set based on last set's RPE
  const getRpeAdjustedWeight = (lastRpe: number, targetRpe: number, lastWeightKg: number): number => {
    // If last RPE was higher than target, suggest slightly lower weight
    // If last RPE was lower than target, suggest slightly higher weight
    const rpeDiff = targetRpe - lastRpe;
    // Roughly 2.5-5% adjustment per RPE point
    const adjustmentPercent = rpeDiff * 0.025;
    return lastWeightKg * (1 + adjustmentPercent);
  };

  const updatePendingInput = (index: number, field: 'weight' | 'reps' | 'rpe', value: string) => {
    setPendingInputs(prev => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = { ...updated[index], [field]: value };
        
        // If weight changed, auto-adjust recommended reps
        if (field === 'weight' && value) {
          const newWeightDisplay = parseFloat(value);
          if (!isNaN(newWeightDisplay) && newWeightDisplay > 0) {
            const newWeightKg = inputWeightToKg(newWeightDisplay, unit);
            
            // Get reference data
            const lastCompleted = completedSets[completedSets.length - 1];
            const prevSet = previousSets[completedSets.length + index];
            
            let refWeight = 0;
            let refReps = 0;
            
            if (lastCompleted) {
              refWeight = lastCompleted.weightKg;
              refReps = lastCompleted.reps;
            } else if (prevSet) {
              refWeight = prevSet.weightKg;
              refReps = prevSet.reps;
            } else if (suggestedWeight > 0) {
              refWeight = suggestedWeight;
              refReps = Math.round((block.targetRepRange[0] + block.targetRepRange[1]) / 2);
            }
            
            if (refWeight > 0 && Math.abs(newWeightKg - refWeight) > 0.5) {
              // Weight changed significantly, recalculate reps
              const newReps = calculateRepsFromWeight(newWeightKg, refWeight, refReps);
              // Clamp to target rep range
              const clampedReps = Math.max(
                block.targetRepRange[0],
                Math.min(block.targetRepRange[1], newReps)
              );
              updated[index].reps = String(clampedReps);
            }
          }
        }
      }
      return updated;
    });
  };

  const completePendingSet = (index: number, asDropset = false) => {
    // Prevent double-clicks
    if (isCompletingSet || !onSetComplete) return;
    
    const input = pendingInputs[index];
    if (!input) return;
    
    const weightNum = parseFloat(input.weight);
    const repsNum = parseInt(input.reps);
    const rpeNum = parseFloat(input.rpe);
    
    if (isNaN(weightNum) || isNaN(repsNum) || isNaN(rpeNum)) {
      return;
    }
    
    // Lock to prevent double-clicks
    setIsCompletingSet(true);
    
    // Convert from display unit to kg
    const weightKg = inputWeightToKg(weightNum, unit);
    
    onSetComplete({
      weightKg,
      reps: repsNum,
      rpe: rpeNum,
      setType: asDropset && dropsetMode ? 'dropset' : 'normal',
      parentSetId: asDropset && dropsetMode ? dropsetMode.parentSetId : undefined,
    });
    
    // Clear dropset mode after completing
    if (asDropset) {
      setDropsetMode(null);
    }
    
    // Unlock after a short delay (the parent will update completedSets)
    setTimeout(() => setIsCompletingSet(false), 500);
  };
  
  // Start dropset mode with reduced weight
  const startDropset = (parentSet: SetLog) => {
    // Typical dropset reduces weight by 20-30%
    const reducedWeight = parentSet.weightKg * 0.75;
    setDropsetMode({
      parentSetId: parentSet.id,
      parentWeight: reducedWeight,
    });
  };
  
  // Cancel dropset mode
  const cancelDropset = () => {
    setDropsetMode(null);
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
    
    // Validate all fields have valid numbers
    if (isNaN(weightNum) || isNaN(repsNum) || isNaN(rpeNum)) {
      console.warn('Invalid edit values:', { editWeight, editReps, editRpe });
      cancelEditing();
      return;
    }
    
    // Validate reasonable ranges
    if (repsNum < 1 || rpeNum < 1 || rpeNum > 10 || weightNum < 0) {
      console.warn('Edit values out of range:', { weightNum, repsNum, rpeNum });
      cancelEditing();
      return;
    }
    
    const weightKg = inputWeightToKg(weightNum, unit);
    onSetEdit(editingSetId, { weightKg, reps: repsNum, rpe: rpeNum });
    cancelEditing();
  };

  // Handle Enter key to save edit
  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      cancelEditing();
    }
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
      {/* Header - compact when hideHeader is true */}
      <div className={`${hideHeader ? 'p-3' : 'p-4'} border-b border-surface-800`}>
        <div className="flex items-start justify-between gap-2">
          {/* Exercise name and info - hidden when hideHeader */}
          {!hideHeader && (
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-surface-100 truncate">
                  {exercise.name}
                </h3>
                {exercise.hypertrophyScore?.tier && (
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0 ${getTierBadgeClasses(exercise.hypertrophyScore.tier)}`}>
                    {exercise.hypertrophyScore.tier}
                  </span>
                )}
                {block.progressionType && (
                  <span className="flex items-center gap-1 text-primary-400">
                    {getProgressionIcon(block.progressionType)}
                  </span>
                )}
              </div>
              <p className="text-sm text-surface-400 mt-0.5">
                {exercise.primaryMuscle} • {exercise.mechanic}
                {exercise.equipmentRequired && exercise.equipmentRequired.length > 0 && (
                  <> • <span className="text-surface-500 capitalize">{exercise.equipmentRequired[0]}</span></>
                )}
              </p>
              {/* Show tier explanation for top-tier exercises */}
              {exercise.hypertrophyScore?.tier && ['S', 'A'].includes(exercise.hypertrophyScore.tier) && (
                <p className="text-xs text-emerald-500/70 mt-0.5 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  {exercise.hypertrophyScore.tier === 'S' 
                    ? 'Top-tier for muscle growth' 
                    : 'Highly effective choice'}
                </p>
              )}
            </div>
          )}
          <div className={`flex items-center gap-1 ${hideHeader ? 'flex-1 justify-between' : ''}`}>
            {/* Set controls */}
            {onTargetSetsChange && isActive && (
              <div className="flex items-center gap-1">
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
            {/* Swap exercise button */}
            {onExerciseSwap && isActive && similarExercises.length > 0 && (
              <button
                onClick={() => setShowSwapModal(true)}
                className="w-7 h-7 flex items-center justify-center rounded bg-surface-700 hover:bg-warning-500/20 text-surface-400 hover:text-warning-400 transition-colors"
                title="Swap exercise"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </button>
            )}
            {/* Delete exercise button */}
            {onExerciseDelete && isActive && (
              <button
                onClick={() => {
                  if (confirm(`Remove "${exercise.name}" from this workout?`)) {
                    onExerciseDelete();
                  }
                }}
                className="w-7 h-7 flex items-center justify-center rounded bg-surface-700 hover:bg-error-500/20 text-surface-400 hover:text-error-400 transition-colors"
                title="Remove exercise"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
            <Badge variant={progressPercent === 100 ? 'success' : 'default'}>
              {completedSets.length}/{block.targetSets}
            </Badge>
          </div>
        </div>

        {/* Targets - only show suggested weight, not empty state */}
        <div className="flex flex-wrap gap-3 mt-2 text-sm">
          {suggestedWeight > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-primary-500">💡 Suggested:</span>
              <span className="font-medium text-primary-300">
                {displayWeight(suggestedWeight)} {weightLabel}
              </span>
            </div>
          )}
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
              <th className="px-2 py-2 text-center text-surface-400 font-medium">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowRpeGuide(true);
                  }}
                  className="inline-flex items-center gap-1 hover:text-primary-400 transition-colors"
                >
                  RPE
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
              </th>
              <th className="px-3 py-2 text-center text-surface-400 font-medium w-20">Quality</th>
              <th className="px-2 py-2 w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-800">
            {/* Warmup sets - displayed inline before working sets */}
            {isActive && warmupSets.length > 0 && workingWeight > 0 && warmupSets.map((warmup) => {
              // Use custom weight if set, otherwise calculate from percentage
              const calculatedWeightKg = workingWeight * (warmup.percentOfWorking / 100);
              const hasCustomWeight = customWarmupWeights.has(warmup.setNumber);
              const warmupWeightKg = hasCustomWeight 
                ? customWarmupWeights.get(warmup.setNumber)! 
                : calculatedWeightKg;
              const roundedWeight = roundToPlateIncrement(warmupWeightKg, unit);
              const displayWarmupWeight = roundedWeight === 0 ? 'Empty' : formatWeightValue(roundedWeight, unit);
              const isWarmupCompleted = completedWarmups.has(warmup.setNumber);
              const isEditingThis = editingWarmupId === warmup.setNumber;
              
              return (
                <tr 
                  key={`warmup-${warmup.setNumber}`}
                  className={`${isWarmupCompleted ? 'bg-amber-500/5' : 'bg-amber-500/10'}`}
                >
                  <td className="px-3 py-2 text-amber-400 font-medium text-xs">
                    W{warmup.setNumber}
                  </td>
                  <td className="px-2 py-2 text-center">
                    {isEditingThis ? (
                      <input
                        type="number"
                        value={warmupWeightInput}
                        onChange={(e) => setWarmupWeightInput(e.target.value)}
                        onBlur={() => {
                          const newWeight = parseFloat(warmupWeightInput);
                          if (!isNaN(newWeight) && newWeight >= 0) {
                            // Convert to kg if needed
                            const weightInKg = unit === 'lb' ? newWeight / 2.20462 : newWeight;
                            setCustomWarmupWeights(prev => new Map(prev).set(warmup.setNumber, weightInKg));
                          }
                          setEditingWarmupId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const newWeight = parseFloat(warmupWeightInput);
                            if (!isNaN(newWeight) && newWeight >= 0) {
                              const weightInKg = unit === 'lb' ? newWeight / 2.20462 : newWeight;
                              setCustomWarmupWeights(prev => new Map(prev).set(warmup.setNumber, weightInKg));
                            }
                            setEditingWarmupId(null);
                          } else if (e.key === 'Escape') {
                            setEditingWarmupId(null);
                          }
                        }}
                        autoFocus
                        className="w-16 px-1 py-0.5 text-center font-mono text-sm bg-surface-900 border border-amber-500 rounded text-surface-100"
                      />
                    ) : (
                      <button
                        onClick={() => {
                          setEditingWarmupId(warmup.setNumber);
                          setWarmupWeightInput(roundedWeight.toString());
                        }}
                        className="font-mono text-surface-300 text-sm hover:text-amber-400 transition-colors"
                      >
                        {displayWarmupWeight}
                        {hasCustomWeight && <span className="text-amber-400 text-xs ml-1">*</span>}
                      </button>
                    )}
                  </td>
                  <td className="px-2 py-2 text-center font-mono text-surface-300 text-sm">
                    {warmup.targetReps}
                  </td>
                  <td className="px-2 py-2 text-center text-surface-500 text-xs">
                    —
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className="text-xs text-amber-400/70">{warmup.purpose}</span>
                  </td>
                  <td className="px-2 py-2">
                    <button
                      onClick={() => {
                        const wasCompleted = completedWarmups.has(warmup.setNumber);
                        
                        setCompletedWarmups(prev => {
                          const next = new Set(prev);
                          if (next.has(warmup.setNumber)) {
                            next.delete(warmup.setNumber);
                          } else {
                            next.add(warmup.setNumber);
                          }
                          return next;
                        });
                        
                        // Trigger rest timer when completing (not unchecking) a warmup
                        if (!wasCompleted && onWarmupComplete) {
                          // Use warmup rest time, default to 45s if not specified
                          const restTime = warmup.restSeconds || 45;
                          onWarmupComplete(restTime);
                        }
                      }}
                      className={`p-2 rounded-lg transition-colors ${
                        isWarmupCompleted 
                          ? 'bg-amber-500 text-white' 
                          : 'bg-surface-700 hover:bg-surface-600 text-surface-400'
                      }`}
                    >
                      {isWarmupCompleted ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                      )}
                    </button>
                  </td>
                </tr>
              );
            })}
            
            {/* Skip warmup button */}
            {isActive && warmupSets.length > 0 && workingWeight > 0 && completedWarmups.size < warmupSets.length && (
              <tr className="bg-surface-800/30">
                <td colSpan={6} className="px-3 py-1.5 text-center">
                  <button
                    onClick={() => setCompletedWarmups(new Set(warmupSets.map(w => w.setNumber)))}
                    className="text-xs text-surface-500 hover:text-surface-400 transition-colors"
                  >
                    Skip warmup (already warm)
                  </button>
                </td>
              </tr>
            )}
            
            {/* Completed working sets */}
            {completedSets.map((set, setIndex) => {
              const isDropset = (set as any).setType === 'dropset' || (set as any).set_type === 'dropset';
              const isLastCompletedSet = setIndex === completedSets.length - 1;
              
              return editingSetId === set.id ? (
                <tr key={set.id} className="bg-primary-500/10">
                  <td className="px-3 py-2 text-surface-300 font-medium">{set.setNumber}</td>
                  <td className="px-1 py-1.5">
                    <input
                      type="number"
                      value={editWeight}
                      onChange={(e) => setEditWeight(e.target.value)}
                      onFocus={(e) => e.target.select()}
                      onKeyDown={handleEditKeyDown}
                      step="0.5"
                      className="w-full px-2 py-1.5 bg-surface-900 border border-surface-600 rounded text-center font-mono text-surface-100 text-sm"
                      autoFocus
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <input
                      type="number"
                      value={editReps}
                      onChange={(e) => setEditReps(e.target.value)}
                      onFocus={(e) => e.target.select()}
                      onKeyDown={handleEditKeyDown}
                      className="w-full px-2 py-1.5 bg-surface-900 border border-surface-600 rounded text-center font-mono text-surface-100 text-sm"
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <input
                      type="number"
                      value={editRpe}
                      onChange={(e) => setEditRpe(e.target.value)}
                      onFocus={(e) => e.target.select()}
                      onKeyDown={handleEditKeyDown}
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
                <React.Fragment key={set.id}>
                  <tr
                    className={`hover:bg-surface-800/30 group relative overflow-hidden ${
                      isDropset ? 'bg-purple-500/10' : 'bg-success-500/5'
                    }`}
                    onTouchStart={(e) => handleTouchStart(set.id, e)}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={() => handleTouchEnd(set.id, true)}
                    style={getSwipeTransform(set.id)}
                  >
                    {/* Delete reveal background for swipe */}
                    {swipeState.setId === set.id && swipeState.isSwiping && (
                      <div 
                        className="absolute right-0 top-0 bottom-0 w-24 flex items-center justify-center bg-danger-500 text-white pointer-events-none"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </div>
                    )}
                    <td className="px-3 py-2.5 text-surface-300 font-medium">
                      <div className="flex items-center gap-1">
                        {isDropset && <span className="text-purple-400 text-xs">↓</span>}
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
                    {onSetDelete ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSetDelete(set.id);
                        }}
                        className="p-2 rounded-lg bg-success-500 active:bg-surface-600 transition-colors group/check"
                        title="Uncheck set"
                      >
                        <svg className="w-4 h-4 text-white group-active/check:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        <svg className="w-4 h-4 text-surface-400 hidden group-active/check:block" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    ) : (
                      <div className="p-2 rounded-lg bg-success-500">
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </td>
                </tr>
                
                {/* Add Dropset button - only show for last completed set when active */}
                {isActive && isLastCompletedSet && !dropsetMode && !isDropset && pendingInputs.length === 0 && (
                  <tr className="bg-surface-800/20">
                    <td colSpan={6} className="px-3 py-2">
                      <button
                        onClick={() => startDropset(set)}
                        className="w-full flex items-center justify-center gap-2 py-1.5 text-sm text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 rounded-lg transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                        Add Dropset (reduce weight, continue to failure)
                      </button>
                    </td>
                  </tr>
                )}
                </React.Fragment>
              );
            })}

            {/* Inline Rest Timer - appears after completing a set */}
            {isActive && showRestTimer && completedSets.length > 0 && (
              <InlineRestTimerBar
                seconds={timerSeconds}
                initialSeconds={timerInitialSeconds}
                isRunning={timerIsRunning}
                isFinished={timerIsFinished}
                onShowControls={onShowTimerControls}
              />
            )}

            {/* Dropset input row - appears when adding a dropset */}
            {isActive && dropsetMode && (
              <tr className="bg-purple-500/20 border-l-2 border-purple-500">
                <td className="px-3 py-2 text-purple-400 font-medium">
                  <div className="flex items-center gap-1">
                    <span className="text-xs">↓</span>
                    D
                  </div>
                </td>
                <td className="px-1 py-1.5">
                  <input
                    type="number"
                    defaultValue={displayWeight(dropsetMode.parentWeight).toString()}
                    id="dropset-weight-input"
                    step="0.5"
                    className="w-full px-2 py-1.5 bg-surface-900 border border-purple-500/50 rounded text-center font-mono text-surface-100 text-sm"
                    autoFocus
                  />
                </td>
                <td className="px-1 py-1.5">
                  <input
                    type="number"
                    defaultValue=""
                    id="dropset-reps-input"
                    placeholder="?"
                    className="w-full px-2 py-1.5 bg-surface-900 border border-purple-500/50 rounded text-center font-mono text-surface-100 text-sm placeholder-surface-500"
                  />
                </td>
                <td className="px-1 py-1.5">
                  <input
                    type="number"
                    defaultValue="10"
                    id="dropset-rpe-input"
                    step="0.5"
                    className="w-full px-2 py-1.5 bg-surface-900 border border-purple-500/50 rounded text-center font-mono text-surface-100 text-sm"
                  />
                </td>
                <td className="px-3 py-1.5 text-center">
                  <span className="text-xs text-purple-400 font-medium">DROPSET</span>
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex gap-1">
                    <button
                      onClick={() => {
                        const weightEl = document.getElementById('dropset-weight-input') as HTMLInputElement;
                        const repsEl = document.getElementById('dropset-reps-input') as HTMLInputElement;
                        const rpeEl = document.getElementById('dropset-rpe-input') as HTMLInputElement;
                        
                        const weight = parseFloat(weightEl?.value || '0');
                        const reps = parseInt(repsEl?.value || '0');
                        const rpe = parseFloat(rpeEl?.value || '10');
                        
                        if (weight > 0 && reps > 0 && onSetComplete) {
                          const weightKg = inputWeightToKg(weight, unit);
                          onSetComplete({
                            weightKg,
                            reps,
                            rpe,
                            setType: 'dropset',
                            parentSetId: dropsetMode.parentSetId,
                          });
                          setDropsetMode(null);
                        }
                      }}
                      className="p-2 rounded-lg bg-purple-500 hover:bg-purple-600 transition-colors"
                    >
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </button>
                    <button
                      onClick={cancelDropset}
                      className="p-2 rounded-lg bg-surface-700 hover:bg-surface-600 transition-colors"
                    >
                      <svg className="w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            )}
            
            {/* Pending sets - editable with pre-filled values */}
            {isActive && pendingInputs.map((input, index) => {
              const setNumber = completedSets.length + index + 1;
              const qualityPreview = getQualityPreview(input);
              const pendingId = `pending-set-${setNumber}`;

              return (
                <tr
                  key={pendingId}
                  className="bg-surface-800/30 relative overflow-hidden"
                  onTouchStart={(e) => handleTouchStart(pendingId, e)}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={() => handleTouchEnd(pendingId, false)}
                  style={getSwipeTransform(pendingId)}
                >
                  {/* Delete reveal background */}
                  {swipeState.setId === pendingId && swipeState.isSwiping && (
                    <div 
                      className="absolute right-0 top-0 bottom-0 w-24 flex items-center justify-center bg-danger-500/20 text-danger-400 pointer-events-none"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </div>
                  )}
                  <td className="px-3 py-2 text-surface-400 font-medium">{setNumber}</td>
                  <td className="px-1 py-1.5">
                    <input
                      type="number"
                      value={input.weight}
                      onChange={(e) => updatePendingInput(index, 'weight', e.target.value)}
                      onFocus={(e) => e.target.select()}
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
                      onFocus={(e) => e.target.select()}
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
                      onFocus={(e) => e.target.select()}
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
                      disabled={!input.weight || !input.reps || !input.rpe || isCompletingSet}
                      className="p-2 rounded-lg transition-all border-2 border-dashed border-surface-600 text-surface-500 hover:border-success-500 hover:border-solid hover:bg-success-500 hover:text-white disabled:opacity-30 disabled:hover:border-surface-600 disabled:hover:border-dashed disabled:hover:bg-transparent disabled:hover:text-surface-500"
                      title="Complete set"
                    >
                      {isCompletingSet ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  </td>
                </tr>
              );
            })}
            
            {/* Show placeholder rows when not active */}
            {!isActive && pendingSetsCount > 0 && Array.from({ length: pendingSetsCount }).map((_, i) => {
              const inactiveSetNumber = completedSets.length + i + 1;
              return (
              <tr key={`inactive-set-${inactiveSetNumber}`} className="bg-surface-800/20">
                <td className="px-3 py-2.5 text-surface-500">{inactiveSetNumber}</td>
                <td className="px-2 py-2.5 text-center text-surface-600">—</td>
                <td className="px-2 py-2.5 text-center text-surface-600">—</td>
                <td className="px-2 py-2.5 text-center text-surface-600">—</td>
                <td className="px-3 py-2.5 text-center text-surface-600">—</td>
                <td className="px-2 py-2.5"></td>
              </tr>
            );
            })}
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

      {/* Swap Exercise Modal */}
      {showSwapModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => setShowSwapModal(false)}>
          <div className="absolute inset-0 bg-black/70" />
          <div 
            className="relative w-full max-w-lg max-h-[85vh] bg-surface-900 rounded-t-2xl sm:rounded-xl shadow-2xl border border-surface-700 overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-surface-700">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Swap Exercise</h3>
                <button
                  onClick={() => setShowSwapModal(false)}
                  className="p-1 text-surface-400 hover:text-surface-200 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-sm text-surface-400 mt-1">
                Replace <span className="text-surface-200 font-medium">{exercise.name}</span>
              </p>
              
              {/* Tabs */}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setSwapTab('similar')}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    swapTab === 'similar'
                      ? 'bg-primary-500 text-white'
                      : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                  }`}
                >
                  Similar ({similarExercises.length})
                </button>
                <button
                  onClick={() => setSwapTab('browse')}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    swapTab === 'browse'
                      ? 'bg-primary-500 text-white'
                      : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                  }`}
                >
                  Browse All
                </button>
              </div>
            </div>
            
            {/* Search & Filter (only for Browse tab) */}
            {swapTab === 'browse' && (
              <div className="p-3 border-b border-surface-700 space-y-2">
                <Input
                  placeholder="Search exercises..."
                  value={swapSearch}
                  onChange={(e) => setSwapSearch(e.target.value)}
                />
                <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                  <button
                    onClick={() => setSwapMuscleFilter('')}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                      !swapMuscleFilter
                        ? 'bg-primary-500 text-white'
                        : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                    }`}
                  >
                    All
                  </button>
                  {MUSCLE_GROUPS.map((muscle) => (
                    <button
                      key={muscle}
                      onClick={() => setSwapMuscleFilter(muscle)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap capitalize transition-colors ${
                        swapMuscleFilter === muscle
                          ? 'bg-primary-500 text-white'
                          : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                      }`}
                    >
                      {muscle}
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            {/* Exercise List */}
            <div className="flex-1 overflow-y-auto p-2">
              {swapTab === 'similar' ? (
                // Similar exercises with match scores
                <>
                  {/* Injury warning banner */}
                  {hasInjuries && (
                    <div className={`mb-3 p-3 rounded-lg ${
                      safeAlternatives.length > 0 
                        ? 'bg-success-500/10 border border-success-500/20' 
                        : 'bg-warning-500/10 border border-warning-500/20'
                    }`}>
                      {safeAlternatives.length > 0 ? (
                        <p className="text-xs text-success-400">
                          ✓ <span className="font-medium">{safeAlternatives.length} safe alternative{safeAlternatives.length !== 1 ? 's' : ''}</span> found that won&apos;t aggravate your injury
                        </p>
                      ) : (
                        <p className="text-xs text-warning-400">
                          ⚠️ <span className="font-medium">No safe alternatives found</span> - all similar exercises may aggravate your injury. Consider skipping this exercise.
                        </p>
                      )}
                    </div>
                  )}
                
                  {similarExercises.map(({ exercise: alt, score, injuryRisk }) => (
                    <button
                      key={alt.id}
                      onClick={() => {
                        if (onExerciseSwap) {
                          onExerciseSwap(alt);
                          setShowSwapModal(false);
                        }
                      }}
                      className={`w-full p-3 text-left rounded-lg transition-colors flex items-center gap-3 ${
                        injuryRisk.isRisky 
                          ? 'hover:bg-danger-500/10 opacity-60' 
                          : 'hover:bg-surface-800'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`font-medium truncate ${injuryRisk.isRisky ? 'text-surface-400' : 'text-surface-100'}`}>
                            {alt.name}
                          </p>
                          {injuryRisk.isRisky && (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${
                              injuryRisk.severity === 3 
                                ? 'bg-danger-500/20 text-danger-400' 
                                : 'bg-warning-500/20 text-warning-400'
                            }`}>
                              ⚠️ {injuryRisk.severity === 3 ? 'Risky' : 'Caution'}
                            </span>
                          )}
                          {!injuryRisk.isRisky && hasInjuries && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-success-500/20 text-success-400 flex-shrink-0">
                              ✓ Safe
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-surface-500 capitalize">
                          {alt.primaryMuscle} • {alt.mechanic}
                        </p>
                        {injuryRisk.isRisky && injuryRisk.reasons.length > 0 && (
                          <p className="text-[10px] text-danger-400/70 mt-0.5">
                            {injuryRisk.reasons[0]}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div 
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            score >= 80 ? 'bg-success-500/20 text-success-400' :
                            score >= 60 ? 'bg-warning-500/20 text-warning-400' :
                            'bg-surface-700 text-surface-400'
                          }`}
                        >
                          {score}%
                        </div>
                        <svg className="w-4 h-4 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </button>
                  ))}
                  {similarExercises.length === 0 && (
                    <div className="p-8 text-center">
                      <p className="text-surface-500">No similar exercises found</p>
                      <button
                        onClick={() => setSwapTab('browse')}
                        className="mt-2 text-primary-400 text-sm hover:underline"
                      >
                        Browse all exercises →
                      </button>
                    </div>
                  )}
                </>
              ) : (
                // Browse all exercises with search/filter
                <>
                  {/* Injury warning in browse tab */}
                  {hasInjuries && (
                    <div className="mb-2 p-2 bg-warning-500/10 border border-warning-500/20 rounded-lg">
                      <p className="text-xs text-warning-400">
                        ⚠️ Exercises marked with warnings may aggravate your injury
                      </p>
                    </div>
                  )}
                  {availableExercises
                    .filter(ex => {
                      // Don't show the current exercise
                      if (ex.id === exercise.id) return false;
                      // Search filter
                      if (swapSearch && !ex.name.toLowerCase().includes(swapSearch.toLowerCase())) return false;
                      // Muscle filter
                      if (swapMuscleFilter && ex.primaryMuscle !== swapMuscleFilter) return false;
                      return true;
                    })
                    .sort((a, b) => {
                      // Sort by frequency (most used first)
                      const freqA = frequentExerciseIds.get(a.id) || 0;
                      const freqB = frequentExerciseIds.get(b.id) || 0;
                      if (freqA !== freqB) return freqB - freqA;
                      // Then alphabetically
                      return a.name.localeCompare(b.name);
                    })
                    .map((alt) => {
                      const altInjuryRisk = getExerciseInjuryRiskFromService({ name: alt.name, primaryMuscle: alt.primaryMuscle }, currentInjuries);
                      const usageCount = frequentExerciseIds.get(alt.id) || 0;
                      const isFrequent = usageCount >= 2;
                      
                      return (
                        <button
                          key={alt.id}
                          onClick={() => {
                            if (onExerciseSwap) {
                              onExerciseSwap(alt);
                              setShowSwapModal(false);
                            }
                          }}
                          className={`w-full p-3 text-left rounded-lg transition-colors flex items-center gap-3 ${
                            altInjuryRisk.isRisky 
                              ? 'hover:bg-danger-500/10 opacity-60' 
                              : 'hover:bg-surface-800'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className={`font-medium truncate ${altInjuryRisk.isRisky ? 'text-surface-400' : 'text-surface-100'}`}>
                                {alt.name}
                              </p>
                              {isFrequent && (
                                <span className="text-xs text-amber-400" title={`Used ${usageCount} times recently`}>
                                  ★
                                </span>
                              )}
                              {altInjuryRisk.isRisky && (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${
                                  altInjuryRisk.severity === 3 
                                    ? 'bg-danger-500/20 text-danger-400' 
                                    : 'bg-warning-500/20 text-warning-400'
                                }`}>
                                  ⚠️
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-surface-500 capitalize">
                              {alt.primaryMuscle} • {alt.mechanic}
                            </p>
                          </div>
                          <svg className="w-4 h-4 text-surface-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      );
                    })}
                  {availableExercises.filter(ex => {
                    if (ex.id === exercise.id) return false;
                    if (swapSearch && !ex.name.toLowerCase().includes(swapSearch.toLowerCase())) return false;
                    if (swapMuscleFilter && ex.primaryMuscle !== swapMuscleFilter) return false;
                    return true;
                  }).length === 0 && (
                    <p className="p-8 text-center text-surface-500">
                      {swapSearch || swapMuscleFilter ? 'No matching exercises found' : 'No exercises available'}
                    </p>
                  )}
                </>
              )}
            </div>
            
            {/* Footer with Skip option */}
            {hasInjuries && onExerciseDelete && (
              <div className="p-3 border-t border-surface-700 bg-surface-800/50">
                <button
                  onClick={() => {
                    if (onExerciseDelete) {
                      onExerciseDelete();
                      setShowSwapModal(false);
                    }
                  }}
                  className="w-full py-2.5 px-4 rounded-lg bg-surface-700 hover:bg-surface-600 text-surface-300 text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  Skip this exercise (due to injury)
                </button>
                <p className="text-[10px] text-surface-500 text-center mt-1.5">
                  This will remove the exercise from today&apos;s workout
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* RPE Guide Modal */}
      {showRpeGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowRpeGuide(false)}>
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-4 max-w-sm mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-surface-100">RPE Guide</h3>
              <button 
                onClick={() => setShowRpeGuide(false)}
                className="p-1 text-surface-400 hover:text-surface-200"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-sm text-surface-400 mb-4">Rate of Perceived Exertion - how hard was the set?</p>
            <div className="space-y-2">
              <div className="flex justify-between items-center p-2 bg-surface-800 rounded-lg">
                <span className="font-mono font-bold text-danger-400">RPE 10</span>
                <span className="text-sm text-surface-300">Max effort - 0 reps left</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-surface-800 rounded-lg">
                <span className="font-mono font-bold text-warning-400">RPE 9</span>
                <span className="text-sm text-surface-300">Very hard - 1 rep left</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-surface-800 rounded-lg">
                <span className="font-mono font-bold text-primary-400">RPE 8</span>
                <span className="text-sm text-surface-300">Hard - 2 reps left</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-surface-800 rounded-lg">
                <span className="font-mono font-bold text-success-400">RPE 7</span>
                <span className="text-sm text-surface-300">Moderate - 3 reps left</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-surface-800 rounded-lg">
                <span className="font-mono font-bold text-surface-400">RPE 6</span>
                <span className="text-sm text-surface-300">Easy - 4+ reps left</span>
              </div>
            </div>
            <p className="text-xs text-surface-500 mt-4 text-center">
              Target RPE 7-8 for most working sets
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function for performance
  // Only re-render if these specific props change
  return (
    prevProps.exercise.id === nextProps.exercise.id &&
    prevProps.block.id === nextProps.block.id &&
    prevProps.block.targetSets === nextProps.block.targetSets &&
    prevProps.block.targetWeightKg === nextProps.block.targetWeightKg &&
    prevProps.sets.length === nextProps.sets.length &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.unit === nextProps.unit &&
    prevProps.recommendedWeight === nextProps.recommendedWeight &&
    prevProps.warmupSets?.length === nextProps.warmupSets?.length &&
    prevProps.workingWeight === nextProps.workingWeight &&
    // Timer props - must check these so timer updates trigger re-render
    prevProps.showRestTimer === nextProps.showRestTimer &&
    prevProps.timerSeconds === nextProps.timerSeconds &&
    prevProps.timerInitialSeconds === nextProps.timerInitialSeconds &&
    prevProps.timerIsRunning === nextProps.timerIsRunning &&
    prevProps.timerIsFinished === nextProps.timerIsFinished &&
    prevProps.onShowTimerControls === nextProps.onShowTimerControls
  );
});
