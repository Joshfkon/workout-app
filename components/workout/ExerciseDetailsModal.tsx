'use client';

import { useState, useEffect } from 'react';
import { Button, Card, Badge } from '@/components/ui';
import type { Exercise } from '@/types/schema';
import { createUntypedClient } from '@/lib/supabase/client';
import { formatWeight, convertWeight } from '@/lib/utils';
import { completeSingleExercise } from '@/lib/actions/exercise-completion';
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
import Link from 'next/link';

interface ExerciseDetailsModalProps {
  exercise: Exercise | null;
  isOpen: boolean;
  onClose: () => void;
  unit?: 'kg' | 'lb';
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

interface ExerciseHistoryData {
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
  return weight * (36 / (37 - reps));
}

// Helper to get property value from either camelCase or snake_case
function getExerciseProp(exercise: Exercise, camelKey: string, snakeKey: string): any {
  const camelValue = (exercise as any)[camelKey];
  const snakeValue = (exercise as any)[snakeKey];
  const result = camelValue ?? snakeValue;
  
  // Debug for video fields
  if ((camelKey === 'demoGifUrl' || camelKey === 'youtubeVideoId') && exercise) {
    console.log(`[getExerciseProp] ${camelKey}/${snakeKey}:`, {
      camelValue,
      snakeValue,
      result,
      exerciseKeys: Object.keys(exercise),
    });
  }
  
  return result;
}

function getTierBadgeClasses(tier: string): string {
  switch (tier) {
    case 'S':
      return 'bg-gradient-to-r from-amber-500 to-yellow-400 text-black';
    case 'A':
      return 'bg-emerald-500/30 text-emerald-400';
    case 'B':
      return 'bg-blue-500/30 text-blue-400';
    case 'C':
      return 'bg-surface-600 text-surface-400';
    default:
      return 'bg-surface-700 text-surface-500';
  }
}

export function ExerciseDetailsModal({ exercise, isOpen, onClose, unit = 'kg' }: ExerciseDetailsModalProps) {
  const [history, setHistory] = useState<ExerciseHistoryData | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [activeChart, setActiveChart] = useState<'e1rm' | 'volume' | 'best'>('e1rm');
  const [isCompletingWithAI, setIsCompletingWithAI] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [completionSuccess, setCompletionSuccess] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  
  // Edit form state
  const [editData, setEditData] = useState<{
    isBodyweight: boolean;
    bodyweightType: 'pure' | 'weighted_possible' | 'assisted_possible' | 'both' | null;
    assistanceType: 'machine' | 'band' | 'partner' | null;
    equipment: string;
    equipmentRequired: string[];
    movementPattern: string;
    primaryMuscle: string;
    secondaryMuscles: string[];
    hypertrophyTier?: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
    defaultRepRangeMin?: number;
    defaultRepRangeMax?: number;
    defaultRir?: number;
    setupNote?: string;
  } | null>(null);
  const [showAdvancedFields, setShowAdvancedFields] = useState(false);
  const [equipmentTypes, setEquipmentTypes] = useState<Array<{ id: string; name: string }>>([]);

  // Load equipment types on mount
  useEffect(() => {
    const loadEquipmentTypes = async () => {
      const supabase = createUntypedClient();
      const { data } = await supabase
        .from('equipment_types')
        .select('id, name')
        .order('name');
      
      if (data) {
        setEquipmentTypes(data);
      }
    };
    loadEquipmentTypes();
  }, []);

  // Fetch exercise history when modal opens
  useEffect(() => {
    if (!isOpen || !exercise?.id) {
      setHistory(null);
      return;
    }

    async function fetchHistory() {
      if (!exercise?.id) return;
      
      setIsLoadingHistory(true);
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Fetch exercise blocks for this exercise
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
          .eq('exercise_id', exercise.id)
          .eq('workout_sessions.user_id', user.id)
          .eq('workout_sessions.state', 'completed')
          .order('workout_sessions(completed_at)', { ascending: false })
          .limit(50);

        if (!historyBlocks || historyBlocks.length === 0) {
          setHistory(null);
          return;
        }

        let bestE1RM = 0;
        let personalRecord: ExerciseHistoryData['personalRecord'] = null;
        const sessionMap = new Map<string, SessionData>();

        // Process history blocks to create chart data
        historyBlocks.forEach((block: any) => {
          const session = block.workout_sessions;
          if (!session?.completed_at) return;

          const sessionId = session.id;
          const date = session.completed_at;
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
        const lastBlock = historyBlocks[0];
        const lastSets = ((lastBlock.set_logs as any[]) || [])
          .filter((s: any) => !s.is_warmup)
          .map((s: any) => ({
            weightKg: s.weight_kg,
            reps: s.reps,
            rpe: s.rpe,
          }));

        setHistory({
          lastWorkoutDate: chartData[chartData.length - 1]?.date || '',
          lastWorkoutSets: lastSets,
          estimatedE1RM: chartData[chartData.length - 1]?.e1rm || 0,
          personalRecord,
          totalSessions: chartData.length,
          chartData,
        });
      } catch (err) {
        console.error('Failed to fetch exercise history:', err);
        setHistory(null);
      } finally {
        setIsLoadingHistory(false);
      }
    }

    if (exercise?.id) {
      fetchHistory();
    }
  }, [isOpen, exercise?.id]);

  // Check if exercise has missing fields
  const hasMissingFields = () => {
    if (!exercise) return false;
    const hasFormCues = getExerciseProp(exercise, 'formCues', 'form_cues') && 
      Array.isArray(getExerciseProp(exercise, 'formCues', 'form_cues')) && 
      getExerciseProp(exercise, 'formCues', 'form_cues').length > 0;
    const hasHypertrophyScore = getExerciseProp(exercise, 'hypertrophyScore', 'hypertrophy_score')?.tier;
    const hasStabilizers = getExerciseProp(exercise, 'stabilizers', 'stabilizers') && 
      Array.isArray(getExerciseProp(exercise, 'stabilizers', 'stabilizers')) && 
      getExerciseProp(exercise, 'stabilizers', 'stabilizers').length > 0;
    const hasSpinalLoading = getExerciseProp(exercise, 'spinalLoading', 'spinal_loading');
    const hasContraindications = getExerciseProp(exercise, 'contraindications', 'contraindications') && 
      Array.isArray(getExerciseProp(exercise, 'contraindications', 'contraindications')) && 
      getExerciseProp(exercise, 'contraindications', 'contraindications').length > 0;
    
    return !hasFormCues || !hasHypertrophyScore || !hasStabilizers || !hasSpinalLoading || !hasContraindications;
  };

  const handleCompleteWithAI = async () => {
    if (!exercise?.id) return;
    
    setIsCompletingWithAI(true);
    setCompletionError(null);
    setCompletionSuccess(false);
    
    try {
      const result = await completeSingleExercise(exercise.id);
      
      if (result.success && result.updated) {
        setCompletionSuccess(true);
        // Refresh the page or reload exercise data
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else if (result.limitReached) {
        setCompletionError(result.error || 'AI limit reached. Please try again tomorrow.');
      } else {
        setCompletionError(result.error || 'Failed to complete exercise with AI');
      }
    } catch (err: any) {
      setCompletionError(err?.message || 'An error occurred');
    } finally {
      setIsCompletingWithAI(false);
    }
  };

  // Initialize edit data when entering edit mode
  useEffect(() => {
    if (isEditing && exercise) {
      const equipment = getExerciseProp(exercise, 'equipment', 'equipment') || 'barbell';
      const equipmentRequired = getExerciseProp(exercise, 'equipmentRequired', 'equipment_required') || [];
      const movementPattern = getExerciseProp(exercise, 'movementPattern', 'movement_pattern') || 'compound';
      const primaryMuscle = getExerciseProp(exercise, 'primaryMuscle', 'primary_muscle') || 'chest';
      const secondaryMuscles = getExerciseProp(exercise, 'secondaryMuscles', 'secondary_muscles') || [];
      const isBodyweight = getExerciseProp(exercise, 'isBodyweight', 'is_bodyweight') || false;
      const bodyweightType = getExerciseProp(exercise, 'bodyweightType', 'bodyweight_type') || null;
      const assistanceType = getExerciseProp(exercise, 'assistanceType', 'assistance_type') || null;
      
      const hypertrophyTier = getExerciseProp(exercise, 'hypertrophyTier', 'hypertrophy_tier');
      const defaultRepRange = getExerciseProp(exercise, 'defaultRepRange', 'default_rep_range') || [];
      const defaultRir = getExerciseProp(exercise, 'defaultRir', 'default_rir');
      const setupNote = getExerciseProp(exercise, 'setupNote', 'setup_note');
      
      setEditData({
        isBodyweight,
        bodyweightType,
        assistanceType,
        equipment,
        equipmentRequired: Array.isArray(equipmentRequired) ? equipmentRequired : [],
        movementPattern,
        primaryMuscle,
        secondaryMuscles: Array.isArray(secondaryMuscles) ? secondaryMuscles : [],
        hypertrophyTier,
        defaultRepRangeMin: Array.isArray(defaultRepRange) && defaultRepRange.length > 0 ? defaultRepRange[0] : undefined,
        defaultRepRangeMax: Array.isArray(defaultRepRange) && defaultRepRange.length > 1 ? defaultRepRange[1] : undefined,
        defaultRir,
        setupNote,
      });
      setShowAdvancedFields(false);
    }
  }, [isEditing, exercise]);
  
  const handleSaveEdit = async () => {
    if (!exercise?.id || !editData) return;
    
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setSaveError('You must be logged in to edit exercises');
        return;
      }
      
      // Build update payload
      const updatePayload: any = {
        is_bodyweight: editData.isBodyweight,
        bodyweight_type: editData.bodyweightType,
        assistance_type: editData.assistanceType,
        equipment: editData.equipment,
        equipment_required: editData.equipmentRequired.length > 0 ? editData.equipmentRequired : [],
        movement_pattern: editData.movementPattern,
        primary_muscle: editData.primaryMuscle,
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
        .eq('id', exercise.id);
      
      if (error) {
        console.error('Failed to update exercise:', error);
        setSaveError(error.message || 'Failed to update exercise');
        return;
      }
      
      setSaveSuccess(true);
      setTimeout(() => {
        setIsEditing(false);
        setSaveSuccess(false);
        window.location.reload(); // Refresh to show updated data
      }, 1500);
    } catch (err: any) {
      console.error('Error updating exercise:', err);
      setSaveError(err?.message || 'An error occurred');
    } finally {
      setIsSaving(false);
    }
  };
  
  if (!isOpen || !exercise) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <Card 
        variant="elevated" 
        className="max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-2xl font-bold text-surface-100">
                  {exercise.name}
                </h2>
                {getExerciseProp(exercise, 'hypertrophyScore', 'hypertrophy_score')?.tier && (
                  <span className={`px-2 py-1 rounded text-xs font-bold ${getTierBadgeClasses(getExerciseProp(exercise, 'hypertrophyScore', 'hypertrophy_score').tier)}`}>
                    Tier {getExerciseProp(exercise, 'hypertrophyScore', 'hypertrophy_score').tier}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-sm text-surface-400">
                <span className="capitalize">{getExerciseProp(exercise, 'primaryMuscle', 'primary_muscle')}</span>
                {(() => {
                  const secondary = getExerciseProp(exercise, 'secondaryMuscles', 'secondary_muscles');
                  return secondary && secondary.length > 0 && (
                    <>
                      <span>•</span>
                      <span>+{secondary.length} secondary</span>
                    </>
                  );
                })()}
                <span>•</span>
                <span className="capitalize">{exercise.mechanic}</span>
                {(() => {
                  const equipment = getExerciseProp(exercise, 'equipmentRequired', 'equipment_required');
                  return equipment && equipment.length > 0 && (
                    <>
                      <span>•</span>
                      <span className="capitalize">{equipment[0]}</span>
                    </>
                  );
                })()}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!isEditing ? (
                <button
                  onClick={() => setIsEditing(true)}
                  className="px-3 py-1.5 text-sm bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveEdit}
                    disabled={isSaving}
                    className="px-3 py-1.5 text-sm bg-success-500 hover:bg-success-600 text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    {isSaving ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                        Saving...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Save
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setIsEditing(false);
                      setSaveError(null);
                      setSaveSuccess(false);
                    }}
                    className="px-3 py-1.5 text-sm bg-surface-700 hover:bg-surface-600 text-surface-200 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
              <button
                onClick={onClose}
                className="p-2 text-surface-400 hover:text-surface-200 hover:bg-surface-800 rounded-lg transition-colors"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Video Demonstration Section */}
          {!isEditing && (() => {
            const demoGifUrl = getExerciseProp(exercise, 'demoGifUrl', 'demo_gif_url');
            const youtubeVideoId = getExerciseProp(exercise, 'youtubeVideoId', 'youtube_video_id');

            if (!demoGifUrl && !youtubeVideoId) {
              // Show debug info in development
              if (process.env.NODE_ENV === 'development' && exercise) {
                console.log('[ExerciseDetailsModal] No video fields found for exercise:', {
                  exerciseName: exercise.name,
                  exerciseId: exercise.id,
                  allKeys: Object.keys(exercise),
                  demoGifUrl_camel: (exercise as any).demoGifUrl,
                  demoGifUrl_snake: (exercise as any).demo_gif_url,
                  youtubeVideoId_camel: (exercise as any).youtubeVideoId,
                  youtubeVideoId_snake: (exercise as any).youtube_video_id,
                });
              }
              return null;
            }

            const isVideo = demoGifUrl && (demoGifUrl.endsWith('.mp4') || demoGifUrl.endsWith('.webm') || demoGifUrl.endsWith('.mov'));
            const isImage = demoGifUrl && !isVideo;

            return (
              <div className="space-y-3">
                <p className="text-xs font-medium text-surface-400 uppercase tracking-wider">
                  Exercise Demo
                </p>

                {/* MP4 Video Demo */}
                {isVideo && (
                  <div className="relative rounded-lg overflow-hidden bg-surface-900 border border-surface-700">
                    <video
                      src={demoGifUrl}
                      className="w-full h-auto max-h-64 object-contain"
                      controls
                      loop
                      muted
                      playsInline
                      onError={(e) => {
                        console.error('[ExerciseDetailsModal] Failed to load video:', demoGifUrl, e);
                        (e.target as HTMLVideoElement).style.display = 'none';
                      }}
                    >
                      Your browser does not support the video tag.
                    </video>
                    <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/60 rounded text-xs text-surface-300">
                      MuscleWiki
                    </div>
                  </div>
                )}

                {/* Image/GIF Demo */}
                {isImage && (
                  <div className="relative rounded-lg overflow-hidden bg-surface-900 border border-surface-700">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={demoGifUrl.startsWith('http') ? demoGifUrl : demoGifUrl}
                      alt={`${exercise.name} demonstration`}
                      className="w-full h-auto max-h-64 object-contain"
                      loading="lazy"
                      onError={(e) => {
                        console.error('[ExerciseDetailsModal] Failed to load image:', demoGifUrl, e);
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/60 rounded text-xs text-surface-300">
                      MuscleWiki
                    </div>
                  </div>
                )}

                {/* YouTube Embed */}
                {youtubeVideoId && (
                  <div className="relative rounded-lg overflow-hidden bg-surface-900 border border-surface-700 aspect-video">
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

          {/* Edit Form or View Mode */}
          {isEditing && editData ? (
            <div className="space-y-4 p-4 bg-surface-800/50 rounded-lg border border-surface-700">
              <h3 className="text-lg font-semibold text-surface-100 mb-4">Edit Exercise</h3>
              
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
                <label className="block text-xs font-medium text-surface-400 mb-1">Equipment</label>
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
                <label className="block text-xs font-medium text-surface-400 mb-1">Movement Pattern</label>
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
              
              {/* Primary Muscle */}
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1">Primary Muscle</label>
                <select
                  value={editData.primaryMuscle}
                  onChange={(e) => setEditData({ ...editData, primaryMuscle: e.target.value })}
                  className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 text-sm"
                >
                  <option value="chest">Chest</option>
                  <option value="back">Back</option>
                  <option value="shoulders">Shoulders</option>
                  <option value="biceps">Biceps</option>
                  <option value="triceps">Triceps</option>
                  <option value="quads">Quads</option>
                  <option value="hamstrings">Hamstrings</option>
                  <option value="glutes">Glutes</option>
                  <option value="calves">Calves</option>
                  <option value="abs">Abs</option>
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
                                setEditData({ ...editData, equipmentRequired: [...editData.equipmentRequired, eq.name.toLowerCase()] });
                              } else {
                                setEditData({ ...editData, equipmentRequired: editData.equipmentRequired.filter(e => e !== eq.name.toLowerCase()) });
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
                      {['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs', 'traps', 'forearms'].filter(m => m !== editData.primaryMuscle).map((muscle) => (
                        <label
                          key={muscle}
                          className="flex items-center gap-2 p-1.5 rounded hover:bg-surface-700/50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={editData.secondaryMuscles.includes(muscle)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setEditData({ ...editData, secondaryMuscles: [...editData.secondaryMuscles, muscle] });
                              } else {
                                setEditData({ ...editData, secondaryMuscles: editData.secondaryMuscles.filter(m => m !== muscle) });
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
                    <label className="block text-xs font-medium text-surface-400 mb-1">Hypertrophy Tier</label>
                    <select
                      value={editData.hypertrophyTier || ''}
                      onChange={(e) => setEditData({ ...editData, hypertrophyTier: e.target.value as any || undefined })}
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
                      <label className="block text-xs font-medium text-surface-400 mb-1">Default Rep Range (Min)</label>
                      <input
                        type="number"
                        value={editData.defaultRepRangeMin?.toString() || ''}
                        onChange={(e) => setEditData({ 
                          ...editData, 
                          defaultRepRangeMin: e.target.value ? parseInt(e.target.value) : undefined 
                        })}
                        placeholder="8"
                        className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-surface-400 mb-1">Default Rep Range (Max)</label>
                      <input
                        type="number"
                        value={editData.defaultRepRangeMax?.toString() || ''}
                        onChange={(e) => setEditData({ 
                          ...editData, 
                          defaultRepRangeMax: e.target.value ? parseInt(e.target.value) : undefined 
                        })}
                        placeholder="12"
                        className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 text-sm"
                      />
                    </div>
                  </div>

                  {/* Default RIR */}
                  <div>
                    <label className="block text-xs font-medium text-surface-400 mb-1">Default RIR (Reps In Reserve)</label>
                    <input
                      type="number"
                      value={editData.defaultRir?.toString() || ''}
                      onChange={(e) => setEditData({ 
                        ...editData, 
                        defaultRir: e.target.value ? parseInt(e.target.value) : undefined 
                      })}
                      placeholder="2"
                      className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 text-sm"
                    />
                  </div>

                  {/* Setup Note */}
                  <div>
                    <label className="block text-xs font-medium text-surface-400 mb-1">Setup Note</label>
                    <textarea
                      value={editData.setupNote || ''}
                      onChange={(e) => setEditData({ ...editData, setupNote: e.target.value })}
                      placeholder="Instructions for setting up the exercise..."
                      className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                      rows={2}
                    />
                  </div>
                </div>
              )}
              
              {/* Error/Success Messages */}
              {saveError && (
                <div className="p-3 bg-danger-900/30 border border-danger-700 rounded-lg">
                  <p className="text-sm text-danger-400">{saveError}</p>
                </div>
              )}
              {saveSuccess && (
                <div className="p-3 bg-success-900/30 border border-success-700 rounded-lg">
                  <p className="text-sm text-success-400">Exercise updated successfully! Refreshing...</p>
                </div>
              )}
            </div>
          ) : (
            <>
          {/* Hypertrophy Effectiveness */}
          {(() => {
            const hypertrophyScore = getExerciseProp(exercise, 'hypertrophyScore', 'hypertrophy_score');
            if (!hypertrophyScore) return null;
            
            const stretch = hypertrophyScore.stretchUnderLoad ?? hypertrophyScore.stretch_under_load ?? 0;
            const resistance = hypertrophyScore.resistanceProfile ?? hypertrophyScore.resistance_profile ?? 0;
            const progression = hypertrophyScore.progressionEase ?? hypertrophyScore.progression_ease ?? 0;
            
            return (
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <p className="text-sm font-medium text-surface-200 mb-3">
                  Hypertrophy Effectiveness
                </p>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-surface-400 mb-1">Stretch</p>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((level) => (
                        <div
                          key={level}
                          className={`flex-1 h-2 rounded ${
                            level <= stretch
                              ? 'bg-primary-500'
                              : 'bg-surface-700'
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-surface-500 mt-1">
                      {stretch}/5
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-surface-400 mb-1">Resistance</p>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((level) => (
                        <div
                          key={level}
                          className={`flex-1 h-2 rounded ${
                            level <= resistance
                              ? 'bg-primary-500'
                              : 'bg-surface-700'
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-surface-500 mt-1">
                      {resistance}/5
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-surface-400 mb-1">Progression</p>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((level) => (
                        <div
                          key={level}
                          className={`flex-1 h-2 rounded ${
                            level <= progression
                              ? 'bg-primary-500'
                              : 'bg-surface-700'
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-surface-500 mt-1">
                      {progression}/5
                    </p>
                  </div>
                </div>
                <p className="text-xs text-surface-600 mt-3">
                  Based on Jeff Nippard&apos;s evidence-based exercise rankings
                </p>
              </div>
            );
          })()}

          {/* Exercise Details Grid */}
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Secondary Muscles */}
            {(() => {
              const secondary = getExerciseProp(exercise, 'secondaryMuscles', 'secondary_muscles');
              return secondary && secondary.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                    Secondary Muscles
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {secondary.map((muscle: string, idx: number) => (
                      <Badge key={idx} variant="default" size="sm">
                        {muscle}
                      </Badge>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Equipment */}
            {(() => {
              const equipment = getExerciseProp(exercise, 'equipmentRequired', 'equipment_required');
              return equipment && equipment.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                    Equipment
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {equipment.map((eq: string, idx: number) => (
                      <Badge key={idx} variant="default" size="sm">
                        {eq}
                      </Badge>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Movement Pattern */}
            {(() => {
              const pattern = getExerciseProp(exercise, 'movementPattern', 'movement_pattern');
              return pattern && (
                <div>
                  <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                    Movement Pattern
                  </p>
                  <Badge variant="default" size="sm">
                    {String(pattern).replace(/_/g, ' ')}
                  </Badge>
                </div>
              );
            })()}

            {/* Default Rep Range */}
            {(() => {
              const repRange = getExerciseProp(exercise, 'defaultRepRange', 'default_rep_range');
              return repRange && Array.isArray(repRange) && repRange.length >= 2 && (
                <div>
                  <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                    Default Rep Range
                  </p>
                  <p className="text-sm text-surface-200">
                    {repRange[0]}-{repRange[1]} reps
                  </p>
                </div>
              );
            })()}
          </div>

          {/* Form Cues */}
          {(() => {
            const formCues = getExerciseProp(exercise, 'formCues', 'form_cues');
            return formCues && Array.isArray(formCues) && formCues.length > 0 && (
              <div>
                <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                  Form Cues
                </p>
                <ul className="space-y-2">
                  {formCues.map((cue: string, idx: number) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-surface-300">
                      <span className="text-primary-400 mt-0.5">•</span>
                      <span>{cue}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}

          {/* Common Mistakes */}
          {(() => {
            const mistakes = getExerciseProp(exercise, 'commonMistakes', 'common_mistakes');
            return mistakes && Array.isArray(mistakes) && mistakes.length > 0 && (
              <div>
                <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                  Common Mistakes
                </p>
                <ul className="space-y-2">
                  {mistakes.map((mistake: string, idx: number) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-danger-400/80">
                      <span className="mt-0.5">✗</span>
                      <span>{mistake}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}

          {/* Setup Note */}
          {(() => {
            const setupNote = getExerciseProp(exercise, 'setupNote', 'setup_note');
            return setupNote && (
              <div>
                <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                  Setup Instructions
                </p>
                <p className="text-sm text-surface-300">{setupNote}</p>
              </div>
            );
          })()}

          {/* Notes */}
          {(() => {
            const notes = getExerciseProp(exercise, 'notes', 'notes');
            return notes && (
              <div>
                <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                  Notes
                </p>
                <p className="text-sm text-surface-300">{notes}</p>
              </div>
            );
          })()}

          {/* Exercise History */}
          <div className="pt-4 border-t border-surface-800">
            <h3 className="text-sm font-medium text-surface-200 mb-4">Your History</h3>
            
            {isLoadingHistory ? (
              <div className="text-sm text-surface-400">Loading history...</div>
            ) : history && history.totalSessions > 0 ? (
              <div className="space-y-4">
                {/* Stats Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-surface-800/50 rounded-lg p-3 text-center">
                    <p className="text-xs text-surface-500 uppercase">Est 1RM</p>
                    <p className="text-lg font-bold text-primary-400">
                      {formatWeight(convertWeight(history.estimatedE1RM, 'kg', unit), unit)} {unit}
                    </p>
                  </div>
                  {history.personalRecord && (
                    <div className="bg-surface-800/50 rounded-lg p-3 text-center">
                      <p className="text-xs text-surface-500 uppercase">PR</p>
                      <p className="text-lg font-bold text-success-400">
                        {formatWeight(convertWeight(history.personalRecord.weightKg, 'kg', unit), unit)} × {history.personalRecord.reps}
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

                {/* Charts */}
                {history.chartData && history.chartData.length >= 2 && (
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

                    {/* Chart Data */}
                    {(() => {
                      const chartData = history.chartData.map(session => ({
                        date: session.displayDate,
                        e1rm: Math.round(convertWeight(session.e1rm, 'kg', unit)),
                        volume: Math.round(convertWeight(session.volume, 'kg', unit)),
                        bestWeight: Math.round(convertWeight(session.bestWeight, 'kg', unit)),
                        bestReps: session.bestReps,
                      }));

                      return (
                        <>
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
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Not enough data for charts */}
                {history.chartData && history.chartData.length < 2 && (
                  <div className="bg-surface-800/30 rounded-lg p-4 text-center">
                    <p className="text-surface-500 text-sm">
                      Complete at least 2 workouts with this exercise to see progress charts
                    </p>
                  </div>
                )}

                {/* Last Workout Sets */}
                {history.lastWorkoutSets && history.lastWorkoutSets.length > 0 && (
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
                          {formatWeight(convertWeight(set.weightKg, 'kg', unit), unit)} × {set.reps}
                          {set.rpe && <span className="text-surface-500 ml-1">@{set.rpe}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-6">
                <svg className="w-12 h-12 mx-auto text-surface-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <p className="text-surface-400 text-sm">No workout history for this exercise yet</p>
                <p className="text-surface-600 text-xs mt-1">Add it to a workout to start tracking progress!</p>
              </div>
            )}
          </div>

          {/* Complete with AI Button */}
          {hasMissingFields() && (
            <div className="pt-4 border-t border-surface-800">
              {completionSuccess ? (
                <div className="p-3 bg-success-900/30 border border-success-700 rounded-lg">
                  <p className="text-sm text-success-400 flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Exercise completed successfully! Refreshing...
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Button
                    variant="primary"
                    onClick={handleCompleteWithAI}
                    disabled={isCompletingWithAI}
                    className="w-full"
                  >
                    {isCompletingWithAI ? (
                      <>
                        <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Completing with AI...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                        Complete Fields with AI
                      </>
                    )}
                  </Button>
                  {completionError && (
                    <div className="p-3 bg-danger-900/30 border border-danger-700 rounded-lg">
                      <p className="text-sm text-danger-400">{completionError}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
            </>
          )}
          
          {/* Action Buttons */}
          {!isEditing && (
          <div className="flex gap-3 pt-4 border-t border-surface-800">
            {/* Show YouTube search link - always available for finding more videos */}
            <a
              href={`https://www.youtube.com/results?search_query=${encodeURIComponent(exercise.name + ' exercise form')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-surface-800 hover:bg-surface-700 rounded-lg text-sm text-surface-300 transition-colors"
            >
              <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="currentColor">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
              {getExerciseProp(exercise, 'youtubeVideoId', 'youtube_video_id') ? 'More Videos' : 'Find Videos'}
            </a>
            <Button variant="outline" onClick={onClose} className="flex-1">
              Close
            </Button>
          </div>
          )}
        </div>
      </Card>
    </div>
  );
}

