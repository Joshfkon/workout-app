'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { serializeWorkoutForSharing, extractMuscleGroups } from '@/lib/workout-sharing';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <CardTitle>Share Workout</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {isSerializing ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500" />
              </div>
            ) : (
              <>
                {/* Title */}
                <div>
                  <label className="block text-sm font-medium text-surface-200 mb-2">
                    Title *
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="My Awesome Workout"
                    required
                    maxLength={100}
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-surface-200 mb-2">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                    rows={3}
                    placeholder="Describe your workout..."
                    maxLength={500}
                  />
                </div>

                {/* Share Type */}
                <div>
                  <label className="block text-sm font-medium text-surface-200 mb-2">
                    Share Type
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    {(['single_workout', 'template', 'crash_the_economy'] as ShareType[]).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setShareType(type)}
                        className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${
                          shareType === type
                            ? 'bg-primary-500 border-primary-500 text-white'
                            : 'bg-surface-900 border-surface-700 text-surface-200 hover:border-surface-600'
                        }`}
                      >
                        {type === 'single_workout' ? 'Single Workout' : type === 'template' ? 'Template' : 'Crash The Economy'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Difficulty */}
                <div>
                  <label className="block text-sm font-medium text-surface-200 mb-2">
                    Difficulty (optional)
                  </label>
                  <div className="flex gap-2">
                    {(['beginner', 'intermediate', 'advanced'] as Difficulty[]).map((diff) => (
                      <button
                        key={diff}
                        type="button"
                        onClick={() => setDifficulty(difficulty === diff ? '' : diff)}
                        className={`flex-1 px-4 py-2 rounded-lg border transition-colors capitalize ${
                          difficulty === diff
                            ? 'bg-primary-500 border-primary-500 text-white'
                            : 'bg-surface-900 border-surface-700 text-surface-200 hover:border-surface-600'
                        }`}
                      >
                        {diff}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Privacy */}
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="isPublic"
                    checked={isPublic}
                    onChange={(e) => setIsPublic(e.target.checked)}
                    className="w-4 h-4 text-primary-500 bg-surface-900 border-surface-700 rounded focus:ring-primary-500"
                  />
                  <label htmlFor="isPublic" className="text-sm text-surface-200">
                    Make this workout public (visible in Discover feed)
                  </label>
                </div>

                {/* Workout Preview */}
                {workoutData && (
                  <div className="bg-surface-800 rounded-lg p-4">
                    <p className="text-sm font-medium text-surface-200 mb-2">Workout Preview</p>
                    <div className="space-y-2 text-sm text-surface-300">
                      <p>
                        <span className="text-surface-400">Exercises:</span> {workoutData.exercises.length}
                      </p>
                      <p>
                        <span className="text-surface-400">Total Sets:</span> {workoutData.total_sets}
                      </p>
                      <p>
                        <span className="text-surface-400">Est. Duration:</span> {workoutData.estimated_duration_minutes} min
                      </p>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="bg-error-900/20 border border-error-500 rounded-lg p-3">
                    <p className="text-sm text-error-400">{error}</p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onClose}
                    disabled={isLoading}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={isLoading || !title.trim()}
                  >
                    {isLoading ? 'Sharing...' : 'Share Workout'}
                  </Button>
                </div>
              </>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

