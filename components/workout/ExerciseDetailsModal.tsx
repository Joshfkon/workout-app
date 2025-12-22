'use client';

import { useState, useEffect } from 'react';
import { Button, Card, Badge } from '@/components/ui';
import type { Exercise } from '@/types/schema';
import { createUntypedClient } from '@/lib/supabase/client';
import { formatWeight, convertWeight } from '@/lib/utils';
import Link from 'next/link';

interface ExerciseDetailsModalProps {
  exercise: Exercise | null;
  isOpen: boolean;
  onClose: () => void;
  unit?: 'kg' | 'lb';
}

interface ExerciseHistoryData {
  lastWorkoutDate: string;
  lastWorkoutSets: { weightKg: number; reps: number; rpe?: number }[];
  estimatedE1RM: number;
  personalRecord: { weightKg: number; reps: number; e1rm: number; date: string } | null;
  totalSessions: number;
}

// Calculate E1RM using Brzycki formula
function calculateE1RM(weight: number, reps: number): number {
  if (reps === 1) return weight;
  return weight * (36 / (37 - reps));
}

// Helper to get property value from either camelCase or snake_case
function getExerciseProp(exercise: Exercise, camelKey: string, snakeKey: string): any {
  return (exercise as any)[camelKey] ?? (exercise as any)[snakeKey];
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
        let totalSessions = 0;
        const seenSessions = new Set<string>();

        // Get last workout data
        const lastBlock = historyBlocks[0];
        const lastSession = lastBlock.workout_sessions as any;
        const lastSets = ((lastBlock.set_logs as any[]) || [])
          .filter((s: any) => !s.is_warmup)
          .map((s: any) => ({
            weightKg: s.weight_kg,
            reps: s.reps,
            rpe: s.rpe,
          }));

        // Calculate best E1RM and PR
        historyBlocks.forEach((block: any) => {
          const session = block.workout_sessions;
          if (session && !seenSessions.has(session.id)) {
            seenSessions.add(session.id);
            totalSessions++;
          }

          const sets = (block.set_logs || []).filter((s: any) => !s.is_warmup);
          sets.forEach((set: any) => {
            const e1rm = calculateE1RM(set.weight_kg, set.reps);
            if (e1rm > bestE1RM) {
              bestE1RM = e1rm;
              personalRecord = {
                weightKg: set.weight_kg,
                reps: set.reps,
                e1rm,
                date: session?.completed_at || set.logged_at,
              };
            }
          });
        });

        setHistory({
          lastWorkoutDate: lastSession?.completed_at || '',
          lastWorkoutSets: lastSets,
          estimatedE1RM: bestE1RM,
          personalRecord,
          totalSessions,
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
            <button
              onClick={onClose}
              className="p-2 text-surface-400 hover:text-surface-200 hover:bg-surface-800 rounded-lg transition-colors"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

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

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4 border-t border-surface-800">
            <a
              href={`https://www.youtube.com/results?search_query=${encodeURIComponent(exercise.name + ' exercise form')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-surface-800 hover:bg-surface-700 rounded-lg text-sm text-surface-300 transition-colors"
            >
              <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="currentColor">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
              Watch Form Video
            </a>
            <Button variant="outline" onClick={onClose} className="flex-1">
              Close
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

