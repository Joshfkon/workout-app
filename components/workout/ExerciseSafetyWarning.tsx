'use client';

import { IconAlertTriangle, IconBan, IconBulb } from '@tabler/icons-react';
import React, { useState } from 'react';
import { Card, Button, Badge } from '@/components/ui';
import { formatMuscleName } from '@/lib/utils';
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
    <Card className={`p-4 ${isAvoid ? 'bg-status-bad-tint border-status-bad/30' : 'bg-status-warn-tint border-status-warn/30'}`}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${isAvoid ? 'text-status-bad' : 'text-status-warn'}`}>
          {isAvoid
            ? <IconBan className="h-6 w-6" stroke={1.75} aria-hidden="true" />
            : <IconAlertTriangle className="h-6 w-6" stroke={1.75} aria-hidden="true" />}
        </div>
        <div className="flex-1">
          <h3 className={`font-semibold ${isAvoid ? 'text-status-bad' : 'text-status-warn'}`}>
            {isAvoid ? 'Not recommended' : 'Use caution'}: {exercise.name}
          </h3>
          <p className="text-subhead text-ink-2 mt-1">
            {isAvoid
              ? 'This exercise may aggravate your injury.'
              : 'This exercise may require modifications.'}
          </p>
        </div>
      </div>

      {/* Reasons */}
      <div className="mt-4 space-y-2">
        <p className="text-subhead font-medium text-ink-2">
          This exercise stresses your injured area due to:
        </p>
        <ul className="space-y-1">
          {displayReasons.map((reason, idx) => (
            <li key={idx} className="flex items-start gap-2 text-subhead">
              <span className={getSeverityDot(reason.severity)} />
              <span className="text-ink-2">{reason.description}</span>
            </li>
          ))}
        </ul>
        {hasMoreReasons && !showAllReasons && (
          <button
            onClick={() => setShowAllReasons(true)}
            className="text-subhead text-action"
          >
            + {safetyResult.reasons.length - 3} more reasons
          </button>
        )}
      </div>

      {/* Caution Recommendations */}
      {safetyResult.level === 'caution' && safetyResult.cautionRecommendations && (
        <div className="mt-4 p-3 bg-sep/50 rounded-lg">
          <p className="text-subhead font-medium text-ink-2 mb-2">Recommendations:</p>
          <ul className="space-y-1">
            {safetyResult.cautionRecommendations.map((rec, idx) => (
              <li key={idx} className="text-subhead text-ink-2 flex items-start gap-2">
                <span className="text-status-warn">•</span>
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Alternatives */}
      {showAlternatives && safetyResult.alternatives.length > 0 && (
        <div className="mt-4">
          <p className="text-subhead font-medium text-ink-2 mb-2">
            Safer alternatives for {formatMuscleName(exercise.primaryMuscle)}:
          </p>
          <div className="space-y-2">
            {safetyResult.alternatives.slice(0, 3).map((alt) => (
              <button
                key={alt.id}
                onClick={() => onSelectAlternative(alt)}
                className="w-full flex items-center justify-between p-3 bg-sep/50 hover:bg-sep/50 rounded-lg transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-status-ok">✓</span>
                  <div className="text-left">
                    <span className="text-ink">{alt.name}</span>
                    <div className="text-caption text-ink-2">
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
              Choose alternative
            </Button>
            {onProceedAnyway && (
              <Button
                variant="secondary"
                size="sm"
                className="text-status-bad"
                onClick={onProceedAnyway}
              >
                Do it anyway
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
              See alternatives
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
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-subhead ${
        isAvoid
          ? 'bg-status-bad-tint text-status-bad border border-status-bad/20'
          : 'bg-status-warn-tint text-status-warn border border-status-warn/20'
      }`}
    >
      {isAvoid ? <IconBan className="h-4 w-4 flex-shrink-0" stroke={1.75} aria-hidden="true" /> : <IconAlertTriangle className="h-4 w-4 flex-shrink-0" stroke={1.75} aria-hidden="true" />}
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
      <Card className="w-full max-w-md p-6 bg-fill">
        <div className="text-center mb-6">
          <div className="mb-3 flex justify-center">
            {avoidExercises.length > 0
              ? <IconAlertTriangle className="h-10 w-10 text-status-warn" stroke={1.75} aria-hidden="true" />
              : <IconBulb className="h-10 w-10 text-action" stroke={1.75} aria-hidden="true" />}
          </div>
          <h2 className="text-headline font-bold text-ink">
            {avoidExercises.length > 0
              ? 'Some exercises may aggravate your injury'
              : 'Workout review'}
          </h2>
          <p className="text-ink-2 mt-2">
            Found {totalIssues} exercise{totalIssues !== 1 ? 's' : ''} that may need attention
          </p>
        </div>

        {/* Issue Summary */}
        <div className="space-y-3 mb-6">
          {avoidExercises.length > 0 && (
            <div className="flex items-center gap-3 p-3 bg-status-bad-tint rounded-lg">
              <IconBan className="h-5 w-5 flex-shrink-0 text-status-bad" stroke={1.75} aria-hidden="true" />
              <div className="flex-1">
                <span className="font-medium text-status-bad">
                  {avoidExercises.length} not recommended
                </span>
                <div className="text-subhead text-ink-2">
                  {avoidExercises.map((e) => e.exercise.name).join(', ')}
                </div>
              </div>
            </div>
          )}

          {cautionExercises.length > 0 && (
            <div className="flex items-center gap-3 p-3 bg-status-warn-tint rounded-lg">
              <IconAlertTriangle className="h-5 w-5 flex-shrink-0 text-status-warn" stroke={1.75} aria-hidden="true" />
              <div className="flex-1">
                <span className="font-medium text-status-warn">
                  {cautionExercises.length} use caution
                </span>
                <div className="text-subhead text-ink-2">
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
              Replace all with safe alternatives
            </Button>
          )}
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={onReviewIndividually}
          >
            Review individually
          </Button>
          <Button
            variant="ghost"
            size="lg"
            className="w-full text-ink-2"
            onClick={onDismiss}
          >
            Proceed without changes
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
      return 'w-2 h-2 rounded-full bg-status-bad mt-1.5 flex-shrink-0';
    case 'medium':
      return 'w-2 h-2 rounded-full bg-status-warn mt-1.5 flex-shrink-0';
    case 'low':
      return 'w-2 h-2 rounded-full bg-ink-3 mt-1.5 flex-shrink-0';
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
