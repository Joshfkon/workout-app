'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { serializeWorkoutForSharing, extractMuscleGroups } from '@/lib/workout-sharing';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import type { ShareType, Difficulty, SharedWorkoutContent } from '@/types/social';

interface ShareWorkoutModalProps {
  workoutSessionId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function ShareWorkoutModal({ workoutSessionId, isOpen, onClose, onSuccess }: ShareWorkoutModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [shareType, setShareType] = useState<ShareType>('single_workout');
  const [difficulty, setDifficulty] = useState<Difficulty | ''>('');
  const [isPublic, setIsPublic] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isSerializing, setIsSerializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workoutData, setWorkoutData] = useState<SharedWorkoutContent | null>(null);

  const loadWorkoutData = async () => {
    setIsSerializing(true);
    setError(null);

    try {
      const supabase = createClient();
      const data = await serializeWorkoutForSharing(workoutSessionId, supabase);
      
      if (!data) {
        setError('Failed to load workout data');
        return;
      }

      setWorkoutData(data);
      
      // Set default title
      if (!title) {
        const exerciseNames = data.exercises.map(e => e.exercise_name).join(', ');
        setTitle(`Workout: ${exerciseNames.substring(0, 50)}${exerciseNames.length > 50 ? '...' : ''}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workout');
    } finally {
      setIsSerializing(false);
    }
  };

  useEffect(() => {
    if (isOpen && workoutSessionId) {
      loadWorkoutData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, workoutSessionId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    if (!workoutData) {
      setError('Workout data not loaded');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('Must be logged in to share workouts');
      }

      const targetMuscleGroups = extractMuscleGroups(workoutData);

      const { error: insertError } = await supabase
        .from('shared_workouts' as never)
        .insert({
          user_id: user.id,
          source_workout_id: workoutSessionId,
          title: title.trim(),
          description: description.trim() || null,
          workout_data: workoutData,
          share_type: shareType,
          difficulty: difficulty || null,
          target_muscle_groups: targetMuscleGroups,
          is_public: isPublic,
        } as never);

      if (insertError) throw insertError;

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to share workout');
    } finally {
      setIsLoading(false);
    }
  };

  const choice = (selected: boolean) =>
    `flex-1 rounded-button px-4 py-2 text-subhead font-medium transition-colors ${
      selected ? 'bg-action text-on-action' : 'bg-fill text-ink'
    }`;

  return (
    <Sheet
      isOpen={isOpen}
      onClose={onClose}
      title="Share workout"
      size="lg"
      data-testid="share-workout-sheet"
      footer={
        isSerializing ? undefined : (
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={onClose} disabled={isLoading} className="flex-1">
              Cancel
            </Button>
            <Button
              type="submit"
              form="share-workout-form"
              variant="primary"
              disabled={isLoading || !title.trim()}
              className="flex-1"
            >
              {isLoading ? 'Sharing…' : 'Share workout'}
            </Button>
          </div>
        )
      }
    >
      {isSerializing ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-action" />
        </div>
      ) : (
        <form id="share-workout-form" onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="share-title" className="block text-subhead font-medium text-ink mb-2">
              Title
            </label>
            <input
              id="share-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-fill rounded-input text-body text-ink focus:outline-none focus:ring-2 focus:ring-action"
              placeholder="My awesome workout"
              required
              maxLength={100}
            />
          </div>

          <div>
            <label htmlFor="share-description" className="block text-subhead font-medium text-ink mb-2">
              Description
            </label>
            <textarea
              id="share-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 bg-fill rounded-input text-body text-ink focus:outline-none focus:ring-2 focus:ring-action resize-none"
              rows={3}
              placeholder="Describe your workout…"
              maxLength={500}
            />
          </div>

          <div>
            <p className="text-subhead font-medium text-ink mb-2">Share as</p>
            <div className="flex gap-2 flex-wrap">
              {(['single_workout', 'template'] as ShareType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setShareType(type)}
                  aria-pressed={shareType === type}
                  className={choice(shareType === type)}
                >
                  {type === 'single_workout' ? 'Single workout' : 'Template'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-subhead font-medium text-ink mb-2">Difficulty (optional)</p>
            <div className="flex gap-2">
              {(['beginner', 'intermediate', 'advanced'] as Difficulty[]).map((diff) => (
                <button
                  key={diff}
                  type="button"
                  onClick={() => setDifficulty(difficulty === diff ? '' : diff)}
                  aria-pressed={difficulty === diff}
                  className={`${choice(difficulty === diff)} capitalize`}
                >
                  {diff}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="isPublic"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="w-4 h-4 accent-[rgb(var(--ht-action))] rounded"
            />
            <label htmlFor="isPublic" className="text-subhead text-ink">
              Make this workout public (visible in Discover)
            </label>
          </div>

          {workoutData && (
            <div className="bg-fill rounded-card p-4">
              <p className="text-subhead font-medium text-ink mb-2">Preview</p>
              <dl className="space-y-1 text-subhead">
                <div className="flex justify-between">
                  <dt className="text-ink-2">Exercises</dt>
                  <dd className="text-ink tabular-nums">{workoutData.exercises.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-2">Total sets</dt>
                  <dd className="text-ink tabular-nums">{workoutData.total_sets}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-2">Est. duration</dt>
                  <dd className="text-ink tabular-nums">{workoutData.estimated_duration_minutes} min</dd>
                </div>
              </dl>
            </div>
          )}
        </form>
      )}

      {error && (
        <div className="mt-4 bg-status-bad-tint rounded-card p-3">
          <p className="text-subhead text-status-bad">{error}</p>
        </div>
      )}
    </Sheet>
  );
}
