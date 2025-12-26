'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { ShareType, Difficulty, SharedWorkoutContent } from '@/types/social';

const MUSCLE_GROUPS = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core',
];

const SHARE_TYPES: { value: ShareType; label: string }[] = [
  { value: 'single_workout', label: 'Single Workout' },
  { value: 'template', label: 'Workout Template' },
  { value: 'program', label: 'Full Program' },
];

const DIFFICULTY_OPTIONS: { value: Difficulty; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

export interface ShareWorkoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  workoutData: SharedWorkoutContent;
  sourceWorkoutId?: string;
  sourceMesocycleId?: string;
  defaultTitle?: string;
  onSuccess?: (sharedWorkoutId: string) => void;
}

export function ShareWorkoutModal({
  isOpen,
  onClose,
  workoutData,
  sourceWorkoutId,
  sourceMesocycleId,
  defaultTitle = '',
  onSuccess,
}: ShareWorkoutModalProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState('');
  const [shareType, setShareType] = useState<ShareType>('single_workout');
  const [difficulty, setDifficulty] = useState<Difficulty | ''>('');
  const [selectedMuscleGroups, setSelectedMuscleGroups] = useState<string[]>([]);
  const [isPublic, setIsPublic] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleMuscleGroup = useCallback((group: string) => {
    setSelectedMuscleGroups(prev =>
      prev.includes(group)
        ? prev.filter(g => g !== group)
        : [...prev, group]
    );
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (title.length < 3) {
      setError('Title must be at least 3 characters');
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('Must be logged in to share workouts');
      }

      const { data, error: insertError } = await (supabase
        .from('shared_workouts' as never) as ReturnType<typeof supabase.from>)
        .insert({
          user_id: user.id,
          source_workout_id: sourceWorkoutId || null,
          source_mesocycle_id: sourceMesocycleId || null,
          title,
          description: description || null,
          workout_data: workoutData,
          share_type: shareType,
          difficulty: difficulty || null,
          target_muscle_groups: selectedMuscleGroups,
          is_public: isPublic,
        } as never)
        .select('id')
        .single();

      if (insertError) throw insertError;

      onSuccess?.((data as { id: string }).id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to share workout');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Share Workout">
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="p-3 rounded-lg bg-error-500/10 border border-error-500/20 text-error-400 text-sm">
            {error}
          </div>
        )}

        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-surface-200 mb-1.5">
            Title *
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Push Day - Chest Focus"
            maxLength={100}
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-surface-200 mb-1.5">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe your workout, its goals, and any tips..."
            className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            rows={3}
            maxLength={2000}
          />
        </div>

        {/* Type and Difficulty */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-surface-200 mb-1.5">
              Type
            </label>
            <Select
              value={shareType}
              onChange={(e) => setShareType(e.target.value as ShareType)}
              options={SHARE_TYPES.map(t => ({ value: t.value, label: t.label }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-200 mb-1.5">
              Difficulty
            </label>
            <Select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Difficulty | '')}
              options={[
                { value: '', label: 'Select difficulty' },
                ...DIFFICULTY_OPTIONS.map(d => ({ value: d.value, label: d.label })),
              ]}
            />
          </div>
        </div>

        {/* Muscle Groups */}
        <div>
          <label className="block text-sm font-medium text-surface-200 mb-2">
            Target Muscle Groups
          </label>
          <div className="flex flex-wrap gap-2">
            {MUSCLE_GROUPS.map((group) => (
              <button
                key={group}
                type="button"
                onClick={() => toggleMuscleGroup(group)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                  selectedMuscleGroups.includes(group)
                    ? 'bg-primary-600 text-white'
                    : 'bg-surface-800 text-surface-400 hover:text-surface-200'
                )}
              >
                {group}
              </button>
            ))}
          </div>
        </div>

        {/* Visibility */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsPublic(!isPublic)}
            className={cn(
              'relative w-11 h-6 rounded-full transition-colors',
              isPublic ? 'bg-primary-600' : 'bg-surface-700'
            )}
          >
            <span
              className={cn(
                'absolute top-1 w-4 h-4 bg-white rounded-full transition-transform',
                isPublic ? 'translate-x-6' : 'translate-x-1'
              )}
            />
          </button>
          <span className="text-sm text-surface-300">
            {isPublic ? 'Public - Anyone can view and copy' : 'Private - Only you can see'}
          </span>
        </div>

        {/* Workout Preview */}
        <div className="p-4 bg-surface-800 rounded-lg">
          <h4 className="text-sm font-medium text-surface-300 mb-2">Workout Preview</h4>
          <div className="text-sm text-surface-400 space-y-1">
            <p>{workoutData.exercises.length} exercises</p>
            <p>{workoutData.total_sets} total sets</p>
            <p>~{workoutData.estimated_duration_minutes} minutes</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting || title.length < 3}
            className="flex-1"
          >
            {isSubmitting ? 'Sharing...' : 'Share Workout'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
