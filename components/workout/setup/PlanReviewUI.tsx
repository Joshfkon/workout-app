'use client';

import type { ReviewSuggestion } from '@/services/workoutSetup/aiReview';
import type { SetupExercise } from '@/services/workoutSetup/types';
import type { ReviewStatus } from './usePlanReview';

export function ReviewButton({
  status,
  onReview,
  disabled,
}: {
  status: ReviewStatus;
  onReview: () => void;
  disabled?: boolean;
}) {
  const label =
    status === 'loading'
      ? 'Reviewing…'
      : status === 'unavailable'
        ? 'Review unavailable, try again.'
        : 'Review';
  return (
    <button
      type="button"
      onClick={onReview}
      disabled={disabled || status === 'loading'}
      className={`rounded-2xl border border-surface-700 bg-surface-900 px-4 py-3.5 text-sm font-medium transition-colors hover:bg-surface-800 disabled:opacity-60 ${
        status === 'unavailable' ? 'max-w-[45%] text-warning-400' : 'text-surface-200'
      }`}
      data-testid="setup-review"
    >
      {label}
    </button>
  );
}

export function ReviewBanner({
  summary,
  pendingCount,
  totalCount,
  onAcceptAll,
  onDismissAll,
}: {
  summary: string;
  pendingCount: number;
  totalCount: number;
  onAcceptAll: () => void;
  onDismissAll: () => void;
}) {
  if (totalCount === 0) {
    return (
      <div className="rounded-lg bg-success-500/10 px-3 py-2.5 text-sm text-success-400" data-testid="setup-review-banner">
        ✓ Looks good.{summary ? ` ${summary}` : ''}
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-surface-800/70 px-3 py-2.5" data-testid="setup-review-banner">
      {summary && <p className="text-sm text-surface-200">{summary}</p>}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-xs text-surface-400">
          {pendingCount > 0 ? `${pendingCount} suggestion${pendingCount === 1 ? '' : 's'}` : 'All suggestions handled'}
        </span>
        {pendingCount > 0 && (
          <span className="flex gap-1">
            <button
              type="button"
              onClick={onDismissAll}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-surface-400 hover:bg-surface-700"
              data-testid="setup-review-dismiss-all"
            >
              Dismiss all
            </button>
            <button
              type="button"
              onClick={onAcceptAll}
              className="rounded-lg bg-primary-500/20 px-2.5 py-1.5 text-xs font-medium text-primary-300 hover:bg-primary-500/30"
              data-testid="setup-review-accept-all"
            >
              Accept all
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

function describe(s: ReviewSuggestion, exercisesById: ReadonlyMap<string, SetupExercise>): string {
  switch (s.type) {
    case 'swap':
      return `Swap for ${exercisesById.get(s.replacementExerciseId ?? '')?.name ?? 'an alternative'}`;
    case 'reorder':
      return `Move to #${s.newOrder}`;
    case 'remove':
      return 'Remove';
    case 'adjust_sets':
      return `${s.newSets} sets`;
    case 'flag':
      return 'Heads up';
  }
}

export function SuggestionCard({
  suggestion,
  exercisesById,
  onAccept,
  onDismiss,
}: {
  suggestion: ReviewSuggestion;
  exercisesById: ReadonlyMap<string, SetupExercise>;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const warn = suggestion.severity === 'warn';
  return (
    <div
      className={`mt-2 rounded-lg border px-2.5 py-2 ${warn ? 'border-warning-500/40 bg-warning-500/10' : 'border-primary-500/30 bg-primary-500/10'}`}
      data-testid={`setup-suggestion-${suggestion.id}`}
    >
      <p className="text-xs text-surface-200">
        <span className={`font-semibold ${warn ? 'text-warning-400' : 'text-primary-300'}`}>
          {describe(suggestion, exercisesById)}
        </span>
        <span className="text-surface-400"> — {suggestion.reason}</span>
      </p>
      <div className="mt-1.5 flex justify-end gap-1">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md px-2.5 py-1.5 text-xs font-medium text-surface-400 hover:bg-surface-800"
          data-testid={`setup-suggestion-dismiss-${suggestion.id}`}
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={onAccept}
          className="rounded-md bg-surface-800 px-2.5 py-1.5 text-xs font-medium text-surface-100 hover:bg-surface-700"
          data-testid={`setup-suggestion-accept-${suggestion.id}`}
        >
          {suggestion.type === 'flag' ? 'Got it' : 'Accept'}
        </button>
      </div>
    </div>
  );
}
