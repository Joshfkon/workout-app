'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { SharedWorkoutCard } from '@/components/social/sharing';
import { useSharedWorkouts } from '@/hooks/useSharedWorkouts';
import { useUserStore } from '@/stores';
import { cn } from '@/lib/utils';
import type { ShareType, Difficulty } from '@/types/social';

const MUSCLE_GROUPS = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core',
];

const SHARE_TYPES: { value: ShareType | ''; label: string }[] = [
  { value: '', label: 'All Types' },
  { value: 'single_workout', label: 'Workouts' },
  { value: 'template', label: 'Templates' },
  { value: 'program', label: 'Programs' },
];

const DIFFICULTY_OPTIONS: { value: Difficulty | ''; label: string }[] = [
  { value: '', label: 'All Levels' },
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

type TabType = 'browse' | 'saved';

export default function SharedWorkoutsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('browse');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<ShareType | ''>('');
  const [difficultyFilter, setDifficultyFilter] = useState<Difficulty | ''>('');
  const [selectedMuscleGroups, setSelectedMuscleGroups] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const userId = useUserStore((state) => state.user?.id);

  const {
    workouts,
    isLoading,
    error,
    hasMore,
    loadMore,
    refresh,
    updateSavedStatus,
  } = useSharedWorkouts({
    type: typeFilter || undefined,
    difficulty: difficultyFilter || undefined,
    muscleGroups: selectedMuscleGroups.length > 0 ? selectedMuscleGroups : undefined,
    searchQuery: searchQuery || undefined,
    savedOnly: activeTab === 'saved',
  });

  const toggleMuscleGroup = useCallback((group: string) => {
    setSelectedMuscleGroups(prev =>
      prev.includes(group)
        ? prev.filter(g => g !== group)
        : [...prev, group]
    );
  }, []);

  const clearFilters = useCallback(() => {
    setTypeFilter('');
    setDifficultyFilter('');
    setSelectedMuscleGroups([]);
    setSearchQuery('');
  }, []);

  const hasActiveFilters = typeFilter || difficultyFilter || selectedMuscleGroups.length > 0 || searchQuery;

  return (
    <div className="min-h-screen bg-surface-950">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-surface-950/95 backdrop-blur-sm border-b border-surface-800">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-surface-100">Workout Library</h1>
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

          {/* Tabs */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setActiveTab('browse')}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-medium transition-colors',
                activeTab === 'browse'
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-800 text-surface-400 hover:text-surface-200'
              )}
            >
              Browse
            </button>
            <button
              onClick={() => setActiveTab('saved')}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-medium transition-colors',
                activeTab === 'saved'
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-800 text-surface-400 hover:text-surface-200'
              )}
            >
              Saved
            </button>
          </div>

          {/* Search and Filters */}
          {activeTab === 'browse' && (
            <div className="space-y-3">
              {/* Search */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search workouts..."
                    className="w-full"
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={() => setShowFilters(!showFilters)}
                  className={cn(showFilters && 'bg-surface-800')}
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                  </svg>
                </Button>
              </div>

              {/* Filter Panel */}
              {showFilters && (
                <div className="p-4 bg-surface-800 rounded-lg space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-surface-300 mb-1.5">
                        Type
                      </label>
                      <Select
                        value={typeFilter}
                        onChange={(e) => setTypeFilter(e.target.value as ShareType | '')}
                        options={SHARE_TYPES.map(t => ({ value: t.value, label: t.label }))}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-surface-300 mb-1.5">
                        Difficulty
                      </label>
                      <Select
                        value={difficultyFilter}
                        onChange={(e) => setDifficultyFilter(e.target.value as Difficulty | '')}
                        options={DIFFICULTY_OPTIONS.map(d => ({ value: d.value, label: d.label }))}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Muscle Groups
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {MUSCLE_GROUPS.map((group) => (
                        <button
                          key={group}
                          onClick={() => toggleMuscleGroup(group)}
                          className={cn(
                            'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                            selectedMuscleGroups.includes(group)
                              ? 'bg-primary-600 text-white'
                              : 'bg-surface-700 text-surface-400 hover:text-surface-200'
                          )}
                        >
                          {group}
                        </button>
                      ))}
                    </div>
                  </div>

                  {hasActiveFilters && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearFilters}
                      className="text-surface-400"
                    >
                      Clear all filters
                    </Button>
                  )}
                </div>
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
            <p className="text-5xl mb-4">
              {activeTab === 'saved' ? '📚' : '🏋️'}
            </p>
            <h2 className="text-xl font-semibold text-surface-100 mb-2">
              {activeTab === 'saved'
                ? 'No saved workouts'
                : 'No workouts found'}
            </h2>
            <p className="text-surface-400 max-w-sm mx-auto">
              {activeTab === 'saved'
                ? 'Save workouts from the browse tab to access them here.'
                : hasActiveFilters
                  ? 'Try adjusting your filters to find more workouts.'
                  : 'Be the first to share a workout with the community!'}
            </p>
            {activeTab === 'saved' && (
              <Button
                variant="outline"
                className="mt-6"
                onClick={() => setActiveTab('browse')}
              >
                Browse Workouts
              </Button>
            )}
          </div>
        )}

        {/* Workout Grid */}
        <div className="grid gap-4 md:grid-cols-2">
          {workouts.map((workout) => (
            <SharedWorkoutCard
              key={workout.id}
              workout={workout}
              currentUserId={userId}
              onSave={updateSavedStatus}
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

        {/* End of list */}
        {!isLoading && !hasMore && workouts.length > 0 && (
          <p className="text-center text-surface-500 py-8">
            That&apos;s all the workouts!
          </p>
        )}
      </main>
    </div>
  );
}
