'use client';

import { Button, Card, Badge } from '@/components/ui';
import type { Exercise } from '@/services/exerciseService';
import Link from 'next/link';

interface ExerciseDetailsModalProps {
  exercise: Exercise | null;
  isOpen: boolean;
  onClose: () => void;
  unit?: 'kg' | 'lb';
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
                {exercise.hypertrophyScore?.tier && (
                  <span className={`px-2 py-1 rounded text-xs font-bold ${getTierBadgeClasses(exercise.hypertrophyScore.tier)}`}>
                    Tier {exercise.hypertrophyScore.tier}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-sm text-surface-400">
                <span className="capitalize">{exercise.primaryMuscle}</span>
                {exercise.secondaryMuscles && exercise.secondaryMuscles.length > 0 && (
                  <>
                    <span>•</span>
                    <span>+{exercise.secondaryMuscles.length} secondary</span>
                  </>
                )}
                <span>•</span>
                <span className="capitalize">{exercise.mechanic}</span>
                {exercise.equipmentRequired && exercise.equipmentRequired.length > 0 && (
                  <>
                    <span>•</span>
                    <span className="capitalize">{exercise.equipmentRequired[0]}</span>
                  </>
                )}
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
          {exercise.hypertrophyScore && (
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
                          level <= (exercise.hypertrophyScore?.stretchUnderLoad || 0)
                            ? 'bg-primary-500'
                            : 'bg-surface-700'
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-surface-500 mt-1">
                    {exercise.hypertrophyScore.stretchUnderLoad}/5
                  </p>
                </div>
                <div>
                  <p className="text-xs text-surface-400 mb-1">Resistance</p>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((level) => (
                      <div
                        key={level}
                        className={`flex-1 h-2 rounded ${
                          level <= (exercise.hypertrophyScore?.resistanceProfile || 0)
                            ? 'bg-primary-500'
                            : 'bg-surface-700'
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-surface-500 mt-1">
                    {exercise.hypertrophyScore.resistanceProfile}/5
                  </p>
                </div>
                <div>
                  <p className="text-xs text-surface-400 mb-1">Progression</p>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((level) => (
                      <div
                        key={level}
                        className={`flex-1 h-2 rounded ${
                          level <= (exercise.hypertrophyScore?.progressionEase || 0)
                            ? 'bg-primary-500'
                            : 'bg-surface-700'
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-surface-500 mt-1">
                    {exercise.hypertrophyScore.progressionEase}/5
                  </p>
                </div>
              </div>
              <p className="text-xs text-surface-600 mt-3">
                Based on Jeff Nippard&apos;s evidence-based exercise rankings
              </p>
            </div>
          )}

          {/* Exercise Details Grid */}
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Secondary Muscles */}
            {exercise.secondaryMuscles && exercise.secondaryMuscles.length > 0 && (
              <div>
                <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                  Secondary Muscles
                </p>
                <div className="flex flex-wrap gap-1">
                  {exercise.secondaryMuscles.map((muscle, idx) => (
                    <Badge key={idx} variant="default" size="sm">
                      {muscle}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Equipment */}
            {exercise.equipmentRequired && exercise.equipmentRequired.length > 0 && (
              <div>
                <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                  Equipment
                </p>
                <div className="flex flex-wrap gap-1">
                  {exercise.equipmentRequired.map((eq, idx) => (
                    <Badge key={idx} variant="default" size="sm">
                      {eq}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Movement Pattern */}
            {exercise.movementPattern && (
              <div>
                <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                  Movement Pattern
                </p>
                <Badge variant="default" size="sm">
                  {exercise.movementPattern.replace(/_/g, ' ')}
                </Badge>
              </div>
            )}

            {/* Default Rep Range */}
            {exercise.defaultRepRange && (
              <div>
                <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                  Default Rep Range
                </p>
                <p className="text-sm text-surface-200">
                  {exercise.defaultRepRange[0]}-{exercise.defaultRepRange[1]} reps
                </p>
              </div>
            )}
          </div>

          {/* Form Cues */}
          {exercise.formCues && exercise.formCues.length > 0 && (
            <div>
              <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                Form Cues
              </p>
              <ul className="space-y-2">
                {exercise.formCues.map((cue, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-surface-300">
                    <span className="text-primary-400 mt-0.5">•</span>
                    <span>{cue}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Common Mistakes */}
          {exercise.commonMistakes && exercise.commonMistakes.length > 0 && (
            <div>
              <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                Common Mistakes
              </p>
              <ul className="space-y-2">
                {exercise.commonMistakes.map((mistake, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-danger-400/80">
                    <span className="mt-0.5">✗</span>
                    <span>{mistake}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Setup Note */}
          {exercise.setupNote && (
            <div>
              <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                Setup Instructions
              </p>
              <p className="text-sm text-surface-300">{exercise.setupNote}</p>
            </div>
          )}

          {/* Notes */}
          {exercise.notes && (
            <div>
              <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                Notes
              </p>
              <p className="text-sm text-surface-300">{exercise.notes}</p>
            </div>
          )}

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

