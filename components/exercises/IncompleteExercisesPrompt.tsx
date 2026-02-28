'use client';

/**
 * Incomplete Exercises Prompt
 *
 * Shows a prompt when user has custom exercises with missing metadata.
 * Allows batch completion using AI.
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { getIncompleteExercises } from '@/lib/actions/exercise-completion';

interface IncompleteExercise {
  id: string;
  name: string;
  missingFields: string[];
}

interface IncompleteExercisesPromptProps {
  onCompleteAll?: () => void;
  onCompleteOne?: (exerciseId: string) => void;
  onDismiss?: () => void;
}

export function IncompleteExercisesPrompt({
  onCompleteAll,
  onCompleteOne,
  onDismiss,
}: IncompleteExercisesPromptProps) {
  const [exercises, setExercises] = useState<IncompleteExercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const incomplete = await getIncompleteExercises();
        setExercises(incomplete);
      } catch (error) {
        console.error('[IncompleteExercisesPrompt] Failed to load incomplete exercises:', error);
        setExercises([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  if (loading || dismissed || exercises.length === 0) {
    return null;
  }

  return (
    <Card className="bg-warning-900/20 border-warning-700">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <svg
              className="w-6 h-6 text-warning-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>

          <div className="flex-1">
            <h3 className="font-medium text-warning-300">
              Incomplete Custom Exercises
            </h3>
            <p className="text-sm text-surface-400 mt-1">
              You have {exercises.length} custom exercise
              {exercises.length === 1 ? '' : 's'} with incomplete data. This may
              affect injury detection and exercise suggestions.
            </p>

            {/* List exercises */}
            <div className="mt-3 space-y-2">
              {exercises.slice(0, 3).map((exercise) => (
                <div
                  key={exercise.id}
                  className="flex items-center justify-between py-2 border-b border-surface-700/50 last:border-0"
                >
                  <div>
                    <p className="text-sm text-surface-200">{exercise.name}</p>
                    <p className="text-xs text-surface-500">
                      Missing: {exercise.missingFields.slice(0, 2).join(', ')}
                      {exercise.missingFields.length > 2 &&
                        ` +${exercise.missingFields.length - 2} more`}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onCompleteOne?.(exercise.id)}
                  >
                    Complete
                  </Button>
                </div>
              ))}
              {exercises.length > 3 && (
                <p className="text-xs text-surface-500 text-center pt-2">
                  +{exercises.length - 3} more exercises
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 mt-4">
              <Button
                variant="primary"
                size="sm"
                onClick={onCompleteAll}
                className="flex-1"
              >
                Complete All with AI
              </Button>
              <Button variant="ghost" size="sm" onClick={handleDismiss}>
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
