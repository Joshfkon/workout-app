'use client';

import React, { useState } from 'react';
import { Card, Button, Badge } from '@/components/ui';
import type { Exercise } from '@/services/exerciseService';
import type { SafetyLevel, SafetyReason, ExerciseSafetyResult } from '@/lib/training/exercise-safety';

interface ExerciseSafetyWarningProps {
  exercise: Exercise;
  safetyResult: ExerciseSafetyResult;
  onSelectAlternative: (alternative: Exercise) => void;
  onDismiss?: () => void;
  onProceedAnyway?: () => void;
  showAlternatives?: boolean;
  compact?: boolean;
}

/**
 * Display safety warnings for exercises based on user's active injuries
 */
export function ExerciseSafetyWarning({
  exercise,
  safetyResult,
  onSelectAlternative,
  onDismiss,
  onProceedAnyway,
  showAlternatives = true,
  compact = false,
}: ExerciseSafetyWarningProps) {
  const [showAllReasons, setShowAllReasons] = useState(false);

  if (safetyResult.level === 'safe') {
    return null;
  }

  const isAvoid = safetyResult.level === 'avoid';

  // Limit reasons shown by default
  const displayReasons = showAllReasons
    ? safetyResult.reasons
    : safetyResult.reasons.slice(0, 3);
  const hasMoreReasons = safetyResult.reasons.length > 3;

  if (compact) {
    return (
      <CompactWarning
        level={safetyResult.level}
        exercise={exercise}
        reasons={safetyResult.reasons}
        onProceedAnyway={onProceedAnyway}
      />
    );
  }

  return (
    <Card className={`p-4 ${isAvoid ? 'bg-red-500/10 border-red-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className={`text-2xl ${isAvoid ? 'text-red-500' : 'text-amber-500'}`}>
          {isAvoid ? '⛔' : '⚠️'}
        </div>
        <div className="flex-1">
          <h3 className={`font-semibold ${isAvoid ? 'text-red-400' : 'text-amber-400'}`}>
            {isAvoid ? 'Not Recommended' : 'Use Caution'}: {exercise.name}
          </h3>
          <p className="text-sm text-surface-400 mt-1">
            {isAvoid
              ? 'This exercise may aggravate your injury.'
              : 'This exercise may require modifications.'}
          </p>
        </div>
      </div>

      {/* Reasons */}
      <div className="mt-4 space-y-2">
        <p className="text-sm font-medium text-surface-300">
          This exercise stresses your injured area due to:
        </p>
        <ul className="space-y-1">
          {displayReasons.map((reason, idx) => (
            <li key={idx} className="flex items-start gap-2 text-sm">
              <span className={getSeverityDot(reason.severity)} />
              <span className="text-surface-300">{reason.description}</span>
            </li>
          ))}
        </ul>
        {hasMoreReasons && !showAllReasons && (
          <button
            onClick={() => setShowAllReasons(true)}
            className="text-sm text-primary-400 hover:text-primary-300"
          >
            + {safetyResult.reasons.length - 3} more reasons
          </button>
        )}
      </div>

      {/* Caution Recommendations */}
      {safetyResult.level === 'caution' && safetyResult.cautionRecommendations && (
        <div className="mt-4 p-3 bg-surface-700/50 rounded-lg">
          <p className="text-sm font-medium text-surface-300 mb-2">Recommendations:</p>
          <ul className="space-y-1">
            {safetyResult.cautionRecommendations.map((rec, idx) => (
              <li key={idx} className="text-sm text-surface-400 flex items-start gap-2">
                <span className="text-amber-400">•</span>
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Alternatives */}
      {showAlternatives && safetyResult.alternatives.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-medium text-surface-300 mb-2">
            Safer alternatives for {exercise.primaryMuscle}:
          </p>
          <div className="space-y-2">
            {safetyResult.alternatives.slice(0, 3).map((alt) => (
              <button
                key={alt.id}
                onClick={() => onSelectAlternative(alt)}
                className="w-full flex items-center justify-between p-3 bg-surface-700/50 hover:bg-surface-600/50 rounded-lg transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-emerald-400">✓</span>
                  <div className="text-left">
                    <span className="text-surface-200">{alt.name}</span>
                    <div className="text-xs text-surface-400">
                      {alt.equipment} • {formatSpinalLoading(alt.spinalLoading)}
                    </div>
                  </div>
                </div>
                <Badge variant={getTierVariant(alt.hypertrophyScore.tier)} size="sm">
                  {alt.hypertrophyScore.tier}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex gap-2">
        {isAvoid ? (
          <>
            <Button
              variant="primary"
              size="sm"
              className="flex-1"
              onClick={() => safetyResult.alternatives[0] && onSelectAlternative(safetyResult.alternatives[0])}
              disabled={safetyResult.alternatives.length === 0}
            >
              Choose Alternative
            </Button>
            {onProceedAnyway && (
              <Button
                variant="secondary"
                size="sm"
                className="text-red-400"
                onClick={onProceedAnyway}
              >
                Do It Anyway
              </Button>
            )}
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={onDismiss}
            >
              Continue with Caution
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => safetyResult.alternatives[0] && onSelectAlternative(safetyResult.alternatives[0])}
              disabled={safetyResult.alternatives.length === 0}
            >
              See Alternatives
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

/**
 * Compact inline warning for use in exercise cards
 */
function CompactWarning({
  level,
  exercise,
  reasons,
  onProceedAnyway,
}: {
  level: SafetyLevel;
  exercise: Exercise;
  reasons: SafetyReason[];
  onProceedAnyway?: () => void;
}) {
  const isAvoid = level === 'avoid';
  const topReason = reasons.find((r) => r.severity === 'high') || reasons[0];

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
        isAvoid
          ? 'bg-red-500/10 text-red-400 border border-red-500/20'
          : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
      }`}
    >
      <span>{isAvoid ? '⛔' : '⚠️'}</span>
      <span className="flex-1 truncate">{topReason?.description || 'May affect injury'}</span>
    </div>
  );
}

/**
 * Workout scan summary modal
 */
interface WorkoutScanModalProps {
  avoidExercises: { exercise: Exercise; reasons: SafetyReason[] }[];
  cautionExercises: { exercise: Exercise; reasons: SafetyReason[] }[];
  onSwapAll: () => void;
  onReviewIndividually: () => void;
  onDismiss: () => void;
}

export function WorkoutScanModal({
  avoidExercises,
  cautionExercises,
  onSwapAll,
  onReviewIndividually,
  onDismiss,
}: WorkoutScanModalProps) {
  const totalIssues = avoidExercises.length + cautionExercises.length;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md p-6 bg-surface-800">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">
            {avoidExercises.length > 0 ? '⚠️' : '💡'}
          </div>
          <h2 className="text-xl font-bold text-surface-100">
            {avoidExercises.length > 0
              ? 'Some Exercises May Aggravate Your Injury'
              : 'Workout Review'}
          </h2>
          <p className="text-surface-400 mt-2">
            Found {totalIssues} exercise{totalIssues !== 1 ? 's' : ''} that may need attention
          </p>
        </div>

        {/* Issue Summary */}
        <div className="space-y-3 mb-6">
          {avoidExercises.length > 0 && (
            <div className="flex items-center gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <span className="text-red-400">⛔</span>
              <div className="flex-1">
                <span className="font-medium text-red-400">
                  {avoidExercises.length} Not Recommended
                </span>
                <div className="text-sm text-surface-400">
                  {avoidExercises.map((e) => e.exercise.name).join(', ')}
                </div>
              </div>
            </div>
          )}

          {cautionExercises.length > 0 && (
            <div className="flex items-center gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <span className="text-amber-400">⚠️</span>
              <div className="flex-1">
                <span className="font-medium text-amber-400">
                  {cautionExercises.length} Use Caution
                </span>
                <div className="text-sm text-surface-400">
                  {cautionExercises.map((e) => e.exercise.name).join(', ')}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="space-y-2">
          {avoidExercises.length > 0 && (
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={onSwapAll}
            >
              Replace All with Safe Alternatives
            </Button>
          )}
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={onReviewIndividually}
          >
            Review Individually
          </Button>
          <Button
            variant="ghost"
            size="lg"
            className="w-full text-surface-400"
            onClick={onDismiss}
          >
            Proceed Without Changes
          </Button>
        </div>
      </Card>
    </div>
  );
}

// Utility functions
function getSeverityDot(severity: 'high' | 'medium' | 'low'): string {
  switch (severity) {
    case 'high':
      return 'w-2 h-2 rounded-full bg-red-500 mt-1.5 flex-shrink-0';
    case 'medium':
      return 'w-2 h-2 rounded-full bg-amber-500 mt-1.5 flex-shrink-0';
    case 'low':
      return 'w-2 h-2 rounded-full bg-surface-500 mt-1.5 flex-shrink-0';
  }
}

function getTierVariant(tier: string): 'default' | 'success' | 'warning' | 'danger' | 'info' {
  switch (tier) {
    case 'S':
    case 'A':
      return 'success';
    case 'B':
      return 'info';
    case 'C':
      return 'default';
    case 'D':
    case 'F':
      return 'warning';
    default:
      return 'default';
  }
}

function formatSpinalLoading(loading: string): string {
  switch (loading) {
    case 'none':
      return 'No spinal load';
    case 'low':
      return 'Low spinal load';
    case 'moderate':
      return 'Moderate spinal load';
    case 'high':
      return 'High spinal load';
    default:
      return loading;
  }
}

export default ExerciseSafetyWarning;
