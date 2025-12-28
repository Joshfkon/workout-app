'use client';

import { useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { SharedWorkoutCard } from '@/components/social/sharing/SharedWorkoutCard';
import { useSharedWorkouts } from '@/hooks/useSharedWorkouts';
import { copySharedWorkout } from '@/lib/workout-sharing';
import { cn } from '@/lib/utils';
import type { ShareType, Difficulty, SharedWorkoutWithProfile } from '@/types/social';

type SortOption = 'recent' | 'popular' | 'saves';

const MUSCLE_GROUPS = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'abs',
];

export default function DiscoverPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [shareType, setShareType] = useState<ShareType | 'all'>('all');
  const [difficulty, setDifficulty] = useState<Difficulty | 'all'>('all');
  const [selectedMuscles, setSelectedMuscles] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [showFilters, setShowFilters] = useState(false);
  const [copyModalWorkout, setCopyModalWorkout] = useState<SharedWorkoutWithProfile | null>(null);

  const {
    workouts,
    isLoading,
    error,
    hasMore,
    loadMore,
    refresh,
    saveWorkout,
    unsaveWorkout,
  } = useSharedWorkouts({
    shareType,
    difficulty,
    muscleGroups: selectedMuscles,
    searchQuery,
    sortBy,
  });

  const toggleMuscle = useCallback((muscle: string) => {
    setSelectedMuscles(prev =>
      prev.includes(muscle)
        ? prev.filter(m => m !== muscle)
        : [...prev, muscle]
    );
  }, []);

  const clearFilters = useCallback(() => {
    setShareType('all');
    setDifficulty('all');
    setSelectedMuscles([]);
    setSearchQuery('');
  }, []);

  const hasActiveFilters = shareType !== 'all' || difficulty !== 'all' || selectedMuscles.length > 0 || searchQuery.trim();

  const handleCopy = useCallback((workout: SharedWorkoutWithProfile) => {
    setCopyModalWorkout(workout);
  }, []);

  return (
    <div className="min-h-screen bg-surface-950">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-surface-950/95 backdrop-blur-sm border-b border-surface-800">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-surface-100">Discover Workouts</h1>
            <Button
              variant="ghost"
              size="sm"
              onClick={refresh}
              disabled={isLoading}
            >
              <svg
                className={cn('w-5 h-5', isLoading && 'animate-spin')}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </Button>
          </div>

          {/* Search bar */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search workouts..."
                className="w-full pl-10 pr-4 py-2.5 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                'px-4 py-2.5 rounded-lg border transition-colors flex items-center gap-2',
                showFilters
                  ? 'bg-primary-500/10 border-primary-500 text-primary-400'
                  : 'bg-surface-900 border-surface-700 text-surface-400 hover:border-surface-600'
              )}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filters
              {hasActiveFilters && (
                <span className="w-2 h-2 rounded-full bg-primary-500" />
              )}
            </button>
          </div>

          {/* Sort tabs */}
          <div className="flex gap-2 mt-4">
            {(['recent', 'popular', 'saves'] as SortOption[]).map((option) => (
              <button
                key={option}
                onClick={() => setSortBy(option)}
                className={cn(
                  'px-4 py-2 rounded-full text-sm font-medium transition-colors capitalize',
                  sortBy === option
                    ? 'bg-primary-600 text-white'
                    : 'bg-surface-800 text-surface-400 hover:text-surface-200'
                )}
              >
                {option === 'saves' ? 'Most Saved' : option === 'popular' ? 'Most Viewed' : 'Recent'}
              </button>
            ))}
          </div>

          {/* Expanded filters */}
          {showFilters && (
            <div className="mt-4 p-4 bg-surface-900 rounded-lg border border-surface-800 space-y-4">
              {/* Type filter */}
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-2">Type</label>
                <div className="flex flex-wrap gap-2">
                  {(['all', 'single_workout', 'template', 'program'] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => setShareType(type)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-sm transition-colors capitalize',
                        shareType === type
                          ? 'bg-primary-500 text-white'
                          : 'bg-surface-800 text-surface-400 hover:text-surface-200'
                      )}
                    >
                      {type === 'all' ? 'All Types' : type.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Difficulty filter */}
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-2">Difficulty</label>
                <div className="flex flex-wrap gap-2">
                  {(['all', 'beginner', 'intermediate', 'advanced'] as const).map((diff) => (
                    <button
                      key={diff}
                      onClick={() => setDifficulty(diff)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-sm transition-colors capitalize',
                        difficulty === diff
                          ? 'bg-primary-500 text-white'
                          : 'bg-surface-800 text-surface-400 hover:text-surface-200'
                      )}
                    >
                      {diff === 'all' ? 'All Levels' : diff}
                    </button>
                  ))}
                </div>
              </div>

              {/* Muscle groups filter */}
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-2">Muscle Groups</label>
                <div className="flex flex-wrap gap-2">
                  {MUSCLE_GROUPS.map((muscle) => (
                    <button
                      key={muscle}
                      onClick={() => toggleMuscle(muscle)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-sm transition-colors capitalize',
                        selectedMuscles.includes(muscle)
                          ? 'bg-primary-500 text-white'
                          : 'bg-surface-800 text-surface-400 hover:text-surface-200'
                      )}
                    >
                      {muscle}
                    </button>
                  ))}
                </div>
              </div>

              {/* Clear filters */}
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="text-sm text-primary-400 hover:text-primary-300 transition-colors"
                >
                  Clear all filters
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-6">
        {error && (
          <div className="text-center py-8">
            <p className="text-error-400 mb-4">{error}</p>
            <Button onClick={refresh}>Try Again</Button>
          </div>
        )}

        {!error && workouts.length === 0 && !isLoading && (
          <div className="text-center py-16">
            <p className="text-5xl mb-4">🏋️</p>
            <h2 className="text-xl font-semibold text-surface-100 mb-2">
              No workouts found
            </h2>
            <p className="text-surface-400 max-w-sm mx-auto">
              {hasActiveFilters
                ? 'Try adjusting your filters to find more workouts.'
                : 'Be the first to share a workout with the community!'}
            </p>
            {hasActiveFilters && (
              <Button
                variant="outline"
                className="mt-6"
                onClick={clearFilters}
              >
                Clear Filters
              </Button>
            )}
          </div>
        )}

        {/* Workout grid */}
        <div className="space-y-4">
          {workouts.map((workout) => (
            <SharedWorkoutCard
              key={workout.id}
              workout={workout}
              onSave={saveWorkout}
              onUnsave={unsaveWorkout}
              onCopy={handleCopy}
            />
          ))}
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex justify-center py-8">
            <div className="animate-spin h-8 w-8 border-2 border-surface-500 border-t-primary-500 rounded-full" />
          </div>
        )}

        {/* Load more */}
        {!isLoading && hasMore && workouts.length > 0 && (
          <div className="flex justify-center py-8">
            <Button variant="outline" onClick={loadMore}>
              Load More
            </Button>
          </div>
        )}

        {/* End of feed */}
        {!isLoading && !hasMore && workouts.length > 0 && (
          <p className="text-center text-surface-500 py-8">
            That&apos;s all the workouts!
          </p>
        )}
      </main>

      {/* Copy Modal */}
      {copyModalWorkout && (
        <CopyWorkoutModal
          workout={copyModalWorkout}
          onClose={() => setCopyModalWorkout(null)}
        />
      )}
    </div>
  );
}

// Copy modal for copying shared workouts
function CopyWorkoutModal({
  workout,
  onClose,
}: {
  workout: SharedWorkoutWithProfile;
  onClose: () => void;
}) {
  const [isCopying, setIsCopying] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCopy = async () => {
    setIsCopying(true);
    setError(null);

    const supabase = createClient();
    const result = await copySharedWorkout(workout.id, supabase);

    if (result.success) {
      setSuccess(true);
      setTimeout(onClose, 1500);
    } else {
      setError(result.error || 'Failed to copy workout');
      setIsCopying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md bg-surface-900 rounded-xl border border-surface-800 overflow-hidden">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-surface-100 mb-2">
            Copy Workout
          </h2>
          <p className="text-sm text-surface-400 mb-4">
            This will add &quot;{workout.title}&quot; to your workout templates.
          </p>

          {/* Exercise preview */}
          <div className="bg-surface-800/50 rounded-lg p-3 mb-4 max-h-48 overflow-y-auto">
            <p className="text-xs font-medium text-surface-400 mb-2">Exercises included:</p>
            <div className="space-y-1">
              {workout.workout_data?.exercises?.map((exercise, index) => (
                <div key={index} className="flex justify-between text-sm">
                  <span className="text-surface-200">{exercise.exercise_name}</span>
                  <span className="text-surface-400">
                    {exercise.sets} x {exercise.rep_range[0]}-{exercise.rep_range[1]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-error-900/20 border border-error-500 rounded-lg">
              <p className="text-sm text-error-400">{error}</p>
            </div>
          )}

          {success ? (
            <div className="flex items-center justify-center gap-2 py-4 text-success-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>Workout copied successfully!</span>
            </div>
          ) : (
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={onClose}
                disabled={isCopying}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleCopy}
                disabled={isCopying}
                className="flex-1"
              >
                {isCopying ? 'Copying...' : 'Copy to My Workouts'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
