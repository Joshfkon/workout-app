'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { SharedWorkoutCard } from '@/components/social/sharing/SharedWorkoutCard';
import { CopyWorkoutSheet } from '@/components/social/sharing/CopyWorkoutSheet';
import { ModerationNotice } from '@/components/social/moderation';
import { useSharedWorkouts } from '@/hooks/useSharedWorkouts';
import { cn } from '@/lib/utils';
import type { ShareType, Difficulty, SharedWorkoutWithProfile } from '@/types/social';
import { IconBarbell } from '@tabler/icons-react';

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
  'erectors',
];

export default function DiscoverPage() {
  useDocumentTitle('Discover');
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
    <div className="min-h-screen bg-canvas">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-canvas/95 backdrop-blur-sm border-b border-sep">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-large-title text-ink">Discover workouts</h1>
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
                className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-ink-3"
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
                className="w-full pl-10 pr-4 py-2.5 bg-card rounded-lg text-ink placeholder-ink-3 focus:outline-none focus:ring-2 focus:ring-action shadow-card"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                'px-4 py-2.5 rounded-lg border transition-colors flex items-center gap-2',
                showFilters
                  ? 'bg-action/10 border-action text-action'
                  : 'bg-card border-sep text-ink-2 hover:border-sep'
              )}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filters
              {hasActiveFilters && (
                <span className="w-2 h-2 rounded-full bg-action" />
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
                  'px-4 py-2 rounded-full text-subhead font-medium transition-colors capitalize',
                  sortBy === option
                    ? 'bg-action text-on-action'
                    : 'bg-fill text-ink-2 hover:text-ink'
                )}
              >
                {option === 'saves' ? 'Most saved' : option === 'popular' ? 'Most viewed' : 'Recent'}
              </button>
            ))}
          </div>

          {/* Expanded filters */}
          {showFilters && (
            <div className="mt-4 p-4 bg-card rounded-lg space-y-4 shadow-card">
              {/* Type filter */}
              <div>
                <label className="block text-subhead font-medium text-ink-2 mb-2">Type</label>
                <div className="flex flex-wrap gap-2">
                  {(['all', 'single_workout', 'template', 'program'] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => setShareType(type)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-subhead transition-colors capitalize',
                        shareType === type
                          ? 'bg-action text-on-action'
                          : 'bg-fill text-ink-2 hover:text-ink'
                      )}
                    >
                      {type === 'all' ? 'All types' : type.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Difficulty filter */}
              <div>
                <label className="block text-subhead font-medium text-ink-2 mb-2">Difficulty</label>
                <div className="flex flex-wrap gap-2">
                  {(['all', 'beginner', 'intermediate', 'advanced'] as const).map((diff) => (
                    <button
                      key={diff}
                      onClick={() => setDifficulty(diff)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-subhead transition-colors capitalize',
                        difficulty === diff
                          ? 'bg-action text-on-action'
                          : 'bg-fill text-ink-2 hover:text-ink'
                      )}
                    >
                      {diff === 'all' ? 'All levels' : diff}
                    </button>
                  ))}
                </div>
              </div>

              {/* Muscle groups filter */}
              <div>
                <label className="block text-subhead font-medium text-ink-2 mb-2">Muscle groups</label>
                <div className="flex flex-wrap gap-2">
                  {MUSCLE_GROUPS.map((muscle) => (
                    <button
                      key={muscle}
                      onClick={() => toggleMuscle(muscle)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-subhead transition-colors capitalize',
                        selectedMuscles.includes(muscle)
                          ? 'bg-action text-on-action'
                          : 'bg-fill text-ink-2 hover:text-ink'
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
                  className="text-subhead text-action transition-colors"
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
            <p className="text-status-bad mb-4">{error}</p>
            <Button onClick={refresh}>Try again</Button>
          </div>
        )}

        {!error && workouts.length === 0 && !isLoading && (
          <div className="text-center py-16">
            <IconBarbell className="mx-auto mb-4 h-10 w-10 text-ink-3" stroke={1.75} aria-hidden="true" />
            <h2 className="text-headline font-semibold text-ink mb-2">
              No workouts found
            </h2>
            <p className="text-ink-2 max-w-sm mx-auto">
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
                Clear filters
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
            <div className="animate-spin h-8 w-8 border-2 border-ink-3 border-t-action rounded-full" />
          </div>
        )}

        {/* Load more */}
        {!isLoading && hasMore && workouts.length > 0 && (
          <div className="flex justify-center py-8">
            <Button variant="outline" onClick={loadMore}>
              Load more
            </Button>
          </div>
        )}

        {/* End of feed */}
        {!isLoading && !hasMore && workouts.length > 0 && (
          <p className="text-center text-ink-3 py-8">
            That&apos;s all the workouts!
          </p>
        )}

        {workouts.length > 0 && <ModerationNotice className="pb-6" />}
      </main>

      <CopyWorkoutSheet workout={copyModalWorkout} onClose={() => setCopyModalWorkout(null)} />
    </div>
  );
}
