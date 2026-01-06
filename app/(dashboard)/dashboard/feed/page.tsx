'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { ActivityCard } from '@/components/social/feed';
import { Avatar } from '@/components/social/profile';
import { SharedWorkoutCard } from '@/components/social/sharing/SharedWorkoutCard';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { useReactions } from '@/hooks/useReactions';
import { useSharedWorkouts } from '@/hooks/useSharedWorkouts';
import { copySharedWorkout } from '@/lib/workout-sharing';
import { useUserStore } from '@/stores';
import { createClient } from '@/lib/supabase/client';
import { cn, formatWeight } from '@/lib/utils';
import { formatSocialCount, getProfileUrl } from '@/lib/social';
import type { ReactionType, LeaderboardType, ShareType, Difficulty, SharedWorkoutWithProfile } from '@/types/social';
import type { UserProfile, ProfileStats } from '@/types/social';
import { LeaderboardTable, UserRankCard } from '@/components/social/leaderboards';
import { useLeaderboard } from '@/hooks/useLeaderboard';

type TabType = 'following' | 'discover' | 'discover_workouts' | 'leaderboards' | 'profile';

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

const LEADERBOARD_TABS: Array<{
  id: LeaderboardType;
  label: string;
  description: string;
}> = [
  {
    id: 'total_volume_week',
    label: 'Weekly Volume',
    description: 'Total weight lifted this week',
  },
  {
    id: 'workouts_completed_week',
    label: 'Weekly Workouts',
    description: 'Workouts completed this week',
  },
  {
    id: 'total_volume_month',
    label: 'Monthly Volume',
    description: 'Total weight lifted this month',
  },
  {
    id: 'workouts_completed_month',
    label: 'Monthly Workouts',
    description: 'Workouts completed this month',
  },
];

export default function FeedPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('following');
  const units = useUserStore((state) => state.user?.preferences.units ?? 'kg');
  const userId = useUserStore((state) => state.user?.id);

  // Feed state
  const feedType = activeTab === 'profile' || activeTab === 'leaderboards' || activeTab === 'discover_workouts' ? 'following' : activeTab;
  const {
    activities,
    isLoading: feedLoading,
    error: feedError,
    hasMore,
    loadMore,
    refresh,
    updateActivityReaction,
  } = useActivityFeed({ feedType });

  const { addReaction, removeReaction } = useReactions();

  // Discover Workouts state
  const [searchQuery, setSearchQuery] = useState('');
  const [shareType, setShareType] = useState<ShareType | 'all'>('all');
  const [difficulty, setDifficulty] = useState<Difficulty | 'all'>('all');
  const [selectedMuscles, setSelectedMuscles] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [showFilters, setShowFilters] = useState(false);
  const [copyModalWorkout, setCopyModalWorkout] = useState<SharedWorkoutWithProfile | null>(null);

  const {
    workouts,
    isLoading: workoutsLoading,
    error: workoutsError,
    hasMore: hasMoreWorkouts,
    loadMore: loadMoreWorkouts,
    refresh: refreshWorkouts,
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

  const handleCopyWorkout = useCallback((workout: SharedWorkoutWithProfile) => {
    setCopyModalWorkout(workout);
  }, []);

  // Profile state
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [needsProfile, setNeedsProfile] = useState(false);

  // Leaderboard state
  const [selectedLeaderboardType, setSelectedLeaderboardType] = useState<LeaderboardType>('total_volume_week');
  const {
    entries: leaderboardEntries,
    userRank,
    isLoading: leaderboardLoading,
    error: leaderboardError,
    refresh: refreshLeaderboard,
    loadMore: loadMoreLeaderboard,
    hasMore: hasMoreLeaderboard,
  } = useLeaderboard({ type: selectedLeaderboardType });

  useEffect(() => {
    const fetchProfile = async () => {
      const supabase = createClient();

      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        router.push('/login');
        return;
      }

      // Fetch user profile
      const { data: profileData, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', authUser.id)
        .single();

      if (error || !profileData) {
        setNeedsProfile(true);
        setProfileLoading(false);
        return;
      }

      setProfile(profileData);

      // Fetch additional stats
      const { data: workoutStats } = await supabase
        .from('workout_sessions')
        .select('id, completed_at')
        .eq('user_id', authUser.id)
        .eq('state', 'completed');

      const { data: setLogs } = await supabase
        .from('set_logs')
        .select('weight_kg, reps, exercise_blocks!inner(exercise_id, workout_sessions!inner(user_id))')
        .eq('exercise_blocks.workout_sessions.user_id', authUser.id)
        .eq('is_warmup', false) as { data: Array<{ weight_kg: number | null; reps: number | null }> | null };

      // Calculate stats
      const totalSets = setLogs?.length ?? 0;
      const totalVolume = setLogs?.reduce((sum, log) =>
        sum + ((log.weight_kg ?? 0) * (log.reps ?? 0)), 0) ?? 0;

      setStats({
        total_workouts: workoutStats?.length ?? 0,
        total_volume_kg: totalVolume,
        total_sets: totalSets,
        current_streak: 0,
        longest_streak: 0,
        favorite_exercise: null,
        strongest_lift: null,
      });

      setProfileLoading(false);
    };

    fetchProfile();
  }, [router]);

  const handleReact = useCallback(async (activityId: string, reactionType: string) => {
    if (!userId) return;

    const typedReaction = reactionType as ReactionType;

    // Optimistic update
    updateActivityReaction(activityId, {
      id: '',
      activity_id: activityId,
      user_id: userId,
      reaction_type: typedReaction,
      created_at: new Date().toISOString(),
    });

    const result = await addReaction(activityId, typedReaction);
    if (!result.success) {
      updateActivityReaction(activityId, undefined);
    }
  }, [userId, addReaction, updateActivityReaction]);

  const handleUnreact = useCallback(async (activityId: string) => {
    const activity = activities.find(a => a.id === activityId);
    const previousReaction = activity?.user_reaction;

    updateActivityReaction(activityId, undefined);

    const result = await removeReaction(activityId);
    if (!result.success && previousReaction) {
      updateActivityReaction(activityId, previousReaction);
    }
  }, [activities, removeReaction, updateActivityReaction]);

  const handleComment = useCallback((activityId: string) => {
    const element = document.getElementById(`activity-${activityId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  const handleCommentAdded = useCallback(() => {
    refresh();
  }, [refresh]);

  const isLoading = activeTab === 'profile'
    ? profileLoading
    : activeTab === 'leaderboards'
      ? leaderboardLoading
      : activeTab === 'discover_workouts'
        ? workoutsLoading
        : feedLoading;

  const renderProfileContent = () => {
    if (profileLoading) {
      return (
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500" />
        </div>
      );
    }

    if (needsProfile) {
      return (
        <div className="max-w-lg mx-auto py-8">
          <Card>
            <CardHeader>
              <CardTitle>Create Your Profile</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-surface-400 mb-6">
                Set up your profile to connect with other lifters, share your workouts, and appear on leaderboards.
              </p>
              <Link href="/dashboard/profile/setup">
                <Button variant="primary" className="w-full">
                  Create Profile
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (!profile) {
      return null;
    }

    const displayName = profile.display_name || profile.username;

    return (
      <div className="space-y-6 py-6">
        {/* Profile Header */}
        <Card padding="lg">
          <div className="flex items-start gap-4">
            <Avatar
              src={profile.avatar_url}
              name={displayName}
              size="xl"
            />

            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-surface-100 truncate">
                {displayName}
              </h1>
              <p className="text-surface-400">@{profile.username}</p>

              {profile.bio && (
                <p className="mt-3 text-surface-300">{profile.bio}</p>
              )}

              <div className="flex flex-wrap gap-2 mt-3 text-sm text-surface-400">
                {profile.training_experience && (
                  <span className="capitalize">{profile.training_experience}</span>
                )}
                {profile.gym_name && (
                  <>
                    {profile.training_experience && <span>•</span>}
                    <span>{profile.gym_name}</span>
                  </>
                )}
              </div>
            </div>

            <Link href="/dashboard/profile/edit">
              <Button variant="outline" size="sm">
                Edit Profile
              </Button>
            </Link>
          </div>

          {/* Stats */}
          <div className="flex items-center justify-around mt-6 pt-6 border-t border-surface-800">
            <div className="text-center">
              <p className="text-2xl font-bold text-surface-100">
                {formatSocialCount(profile.workout_count)}
              </p>
              <p className="text-sm text-surface-400">Workouts</p>
            </div>

            <div className="w-px h-10 bg-surface-800" />

            <Link
              href={`${getProfileUrl(profile.username)}/followers`}
              className="text-center hover:opacity-80 transition-opacity"
            >
              <p className="text-2xl font-bold text-surface-100">
                {formatSocialCount(profile.follower_count)}
              </p>
              <p className="text-sm text-surface-400">Followers</p>
            </Link>

            <div className="w-px h-10 bg-surface-800" />

            <Link
              href={`${getProfileUrl(profile.username)}/following`}
              className="text-center hover:opacity-80 transition-opacity"
            >
              <p className="text-2xl font-bold text-surface-100">
                {formatSocialCount(profile.following_count)}
              </p>
              <p className="text-sm text-surface-400">Following</p>
            </Link>
          </div>
        </Card>

        {/* Badges */}
        {profile.badges.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Badges</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                {profile.badges.map((badge) => (
                  <div
                    key={badge.id}
                    className="flex items-center gap-2 px-3 py-2 bg-surface-800 rounded-lg"
                    title={badge.description}
                  >
                    <span className="text-xl">{badge.icon}</span>
                    <div>
                      <p className="text-sm font-medium text-surface-100">
                        {badge.name}
                      </p>
                      <p className="text-xs text-surface-400">
                        {badge.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Training Stats */}
        {stats && (
          <Card>
            <CardHeader>
              <CardTitle>Training Stats</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-surface-800 rounded-lg">
                  <p className="text-2xl font-bold text-surface-100">
                    {stats.total_workouts}
                  </p>
                  <p className="text-sm text-surface-400">Total Workouts</p>
                </div>

                <div className="p-4 bg-surface-800 rounded-lg">
                  <p className="text-2xl font-bold text-surface-100">
                    {stats.total_sets.toLocaleString()}
                  </p>
                  <p className="text-sm text-surface-400">Total Sets</p>
                </div>

                <div className="p-4 bg-surface-800 rounded-lg">
                  <p className="text-2xl font-bold text-surface-100">
                    {formatWeight(stats.total_volume_kg, units, 0)}
                  </p>
                  <p className="text-sm text-surface-400">Total Volume</p>
                </div>

                <div className="p-4 bg-surface-800 rounded-lg">
                  <p className="text-2xl font-bold text-surface-100">
                    {stats.current_streak}
                  </p>
                  <p className="text-sm text-surface-400">Day Streak</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Privacy Settings Quick Link */}
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <p className="font-medium text-surface-100">Privacy Settings</p>
              <p className="text-sm text-surface-400">
                Profile is {profile.profile_visibility}
              </p>
            </div>
            <Link href="/dashboard/profile/edit#privacy">
              <Button variant="ghost" size="sm">
                Manage
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Share Profile */}
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <p className="font-medium text-surface-100">Share Profile</p>
              <p className="text-sm text-surface-400">
                hypertrack.app{getProfileUrl(profile.username)}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(
                  `${window.location.origin}${getProfileUrl(profile.username)}`
                );
              }}
            >
              Copy Link
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderLeaderboardContent = () => {
    const selectedTab = LEADERBOARD_TABS.find(t => t.id === selectedLeaderboardType);

    return (
      <div className="space-y-6 py-6">
        {/* Leaderboard type selector */}
        <div className="flex gap-2 overflow-x-auto pb-2 -mb-2 scrollbar-hide">
          {LEADERBOARD_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedLeaderboardType(tab.id)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors',
                selectedLeaderboardType === tab.id
                  ? 'bg-accent-600 text-white'
                  : 'bg-surface-800 text-surface-400 hover:text-surface-200'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Description */}
        {selectedTab && (
          <p className="text-surface-400 text-sm">{selectedTab.description}</p>
        )}

        {/* User's rank card */}
        <UserRankCard userRank={userRank} type={selectedLeaderboardType} units={units} />

        {/* Error state */}
        {leaderboardError && (
          <Card>
            <CardContent className="text-center py-8">
              <p className="text-error-400 mb-4">{leaderboardError}</p>
              <Button onClick={refreshLeaderboard}>Try Again</Button>
            </CardContent>
          </Card>
        )}

        {/* Leaderboard */}
        {!leaderboardError && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="text-2xl">🏆</span>
                Top Lifters
              </CardTitle>
            </CardHeader>
            <CardContent>
              <LeaderboardTable
                entries={leaderboardEntries}
                type={selectedLeaderboardType}
                units={units}
                currentUserId={userId}
                isLoading={leaderboardLoading}
                hasMore={hasMoreLeaderboard}
                onLoadMore={loadMoreLeaderboard}
              />
            </CardContent>
          </Card>
        )}

        {/* Info card */}
        <Card className="bg-surface-800/50">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-surface-400 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div className="text-sm text-surface-400">
                <p className="font-medium text-surface-300 mb-1">How rankings work</p>
                <p>
                  Leaderboards update throughout the week as you complete workouts.
                  Only users who have opted in to leaderboards in their privacy settings are shown.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderDiscoverWorkoutsContent = () => {
    return (
      <div className="space-y-6 py-6">
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
        <div className="flex gap-2">
          {(['recent', 'popular', 'saves'] as SortOption[]).map((option) => (
            <button
              key={option}
              onClick={() => setSortBy(option)}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-medium transition-colors capitalize',
                sortBy === option
                  ? 'bg-accent-600 text-white'
                  : 'bg-surface-800 text-surface-400 hover:text-surface-200'
              )}
            >
              {option === 'saves' ? 'Most Saved' : option === 'popular' ? 'Most Viewed' : 'Recent'}
            </button>
          ))}
        </div>

        {/* Expanded filters */}
        {showFilters && (
          <div className="p-4 bg-surface-900 rounded-lg border border-surface-800 space-y-4">
            {/* Type filter */}
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-2">Type</label>
              <div className="flex flex-wrap gap-2">
                {(['all', 'single_workout', 'template', 'program', 'crash_the_economy'] as const).map((type) => (
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
                    {type === 'all' ? 'All Types' : type === 'crash_the_economy' ? 'Crash The Economy' : type.replace('_', ' ')}
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

        {workoutsError && (
          <div className="text-center py-8">
            <p className="text-error-400 mb-4">{workoutsError}</p>
            <Button onClick={refreshWorkouts}>Try Again</Button>
          </div>
        )}

        {!workoutsError && workouts.length === 0 && !workoutsLoading && (
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
              onCopy={handleCopyWorkout}
            />
          ))}
        </div>

        {/* Loading state */}
        {workoutsLoading && (
          <div className="flex justify-center py-8">
            <div className="animate-spin h-8 w-8 border-2 border-surface-500 border-t-primary-500 rounded-full" />
          </div>
        )}

        {/* Load more */}
        {!workoutsLoading && hasMoreWorkouts && workouts.length > 0 && (
          <div className="flex justify-center py-8">
            <Button variant="outline" onClick={loadMoreWorkouts}>
              Load More
            </Button>
          </div>
        )}

        {/* End of feed */}
        {!workoutsLoading && !hasMoreWorkouts && workouts.length > 0 && (
          <p className="text-center text-surface-500 py-8">
            That&apos;s all the workouts!
          </p>
        )}
      </div>
    );
  };

  const renderFeedContent = () => {
    const error = feedError;

    return (
      <>
        {error && (
          <div className="text-center py-8">
            <p className="text-error-400 mb-4">{error}</p>
            <Button onClick={refresh}>Try Again</Button>
          </div>
        )}

        {!error && activities.length === 0 && !feedLoading && (
          <div className="text-center py-16">
            <p className="text-5xl mb-4">
              {activeTab === 'following' ? '👥' : '🌎'}
            </p>
            <h2 className="text-xl font-semibold text-surface-100 mb-2">
              {activeTab === 'following'
                ? 'No activities yet'
                : 'Nothing to discover'}
            </h2>
            <p className="text-surface-400 max-w-sm mx-auto">
              {activeTab === 'following'
                ? 'Follow other lifters to see their workouts and achievements here.'
                : 'Be the first to share your workout with the community!'}
            </p>
            {activeTab === 'following' && (
              <Button
                variant="outline"
                className="mt-6"
                onClick={() => setActiveTab('discover')}
              >
                Discover Lifters
              </Button>
            )}
          </div>
        )}

        {/* Activity list */}
        <div className="space-y-4 py-6">
          {activities.map((activity) => (
            <div key={activity.id} id={`activity-${activity.id}`}>
              <ActivityCard
                activity={activity}
                currentUserId={userId}
                units={units}
                onReact={handleReact}
                onUnreact={handleUnreact}
                onComment={handleComment}
                onCommentAdded={handleCommentAdded}
              />
            </div>
          ))}
        </div>

        {/* Loading state */}
        {feedLoading && (
          <div className="flex justify-center py-8">
            <div className="animate-spin h-8 w-8 border-2 border-surface-500 border-t-primary-500 rounded-full" />
          </div>
        )}

        {/* Load more */}
        {!feedLoading && hasMore && activities.length > 0 && (
          <div className="flex justify-center py-8">
            <Button
              variant="outline"
              onClick={loadMore}
            >
              Load More
            </Button>
          </div>
        )}

        {/* End of feed */}
        {!feedLoading && !hasMore && activities.length > 0 && (
          <p className="text-center text-surface-500 py-8">
            You&apos;re all caught up!
          </p>
        )}
      </>
    );
  };

  return (
    <div className="min-h-screen bg-surface-950">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-surface-950/95 backdrop-blur-sm border-b border-surface-800">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-surface-100">
              {activeTab === 'profile'
                ? 'Profile'
                : activeTab === 'leaderboards'
                  ? 'Leaderboards'
                  : activeTab === 'discover_workouts'
                    ? 'Discover Workouts'
                    : 'Activity Feed'}
            </h1>
            {activeTab !== 'profile' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={activeTab === 'leaderboards' ? refreshLeaderboard : activeTab === 'discover_workouts' ? refreshWorkouts : refresh}
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
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-2 overflow-x-auto pb-2 -mb-2 scrollbar-hide">
            <button
              onClick={() => setActiveTab('following')}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap',
                activeTab === 'following'
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-800 text-surface-400 hover:text-surface-200'
              )}
            >
              Following
            </button>
            <button
              onClick={() => setActiveTab('discover')}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap',
                activeTab === 'discover'
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-800 text-surface-400 hover:text-surface-200'
              )}
            >
              Discover
            </button>
            <button
              onClick={() => setActiveTab('discover_workouts')}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap',
                activeTab === 'discover_workouts'
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-800 text-surface-400 hover:text-surface-200'
              )}
            >
              Workouts
            </button>
            <button
              onClick={() => setActiveTab('leaderboards')}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap',
                activeTab === 'leaderboards'
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-800 text-surface-400 hover:text-surface-200'
              )}
            >
              Leaderboards
            </button>
            <button
              onClick={() => setActiveTab('profile')}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap',
                activeTab === 'profile'
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-800 text-surface-400 hover:text-surface-200'
              )}
            >
              Profile
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4">
        {activeTab === 'profile'
          ? renderProfileContent()
          : activeTab === 'leaderboards'
            ? renderLeaderboardContent()
            : activeTab === 'discover_workouts'
              ? renderDiscoverWorkoutsContent()
              : renderFeedContent()}
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
