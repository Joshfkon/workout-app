'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/social/profile/Avatar';
import { SaveWorkoutButton } from '@/components/social/sharing/SaveWorkoutButton';
import { copySharedWorkout } from '@/lib/workout-sharing';
import { formatDistanceToNow, formatWeight } from '@/lib/utils';
import { useUserStore } from '@/stores';
import { cn } from '@/lib/utils';
import type { SharedWorkoutWithProfile, Difficulty } from '@/types/social';

const difficultyColors: Record<Difficulty, string> = {
  beginner: 'bg-success-500/20 text-success-400 border-success-500/30',
  intermediate: 'bg-warning-500/20 text-warning-400 border-warning-500/30',
  advanced: 'bg-error-500/20 text-error-400 border-error-500/30',
};

export default function SharedWorkoutDetailPage() {
  const params = useParams();
  const router = useRouter();
  const workoutId = params.id as string;
  const units = useUserStore((state) => state.user?.preferences.units ?? 'kg');

  const [workout, setWorkout] = useState<SharedWorkoutWithProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCopying, setIsCopying] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [showShareToast, setShowShareToast] = useState(false);

  useEffect(() => {
    async function fetchWorkout() {
      setIsLoading(true);
      setError(null);

      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        // Fetch workout with user profile
        const { data, error: fetchError } = await supabase
          .from('shared_workouts')
          .select(`
            *,
            user_profiles!inner (
              id,
              user_id,
              username,
              display_name,
              avatar_url,
              training_experience,
              bio
            )
          `)
          .eq('id', workoutId)
          .eq('is_public', true)
          .single();

        if (fetchError) {
          if (fetchError.code === 'PGRST116') {
            setError('Workout not found');
          } else {
            throw fetchError;
          }
          return;
        }

        // Increment view count
        await supabase.rpc('increment_shared_workout_views' as never, { workout_id: workoutId } as never);

        // Check if saved by current user
        let isSaved = false;
        if (user) {
          const { data: savedData } = await supabase
            .from('saved_workouts')
            .select('id')
            .eq('user_id', user.id)
            .eq('shared_workout_id', workoutId)
            .single();
          isSaved = !!savedData;
        }

        // Transform data
        const workoutData = data as {
          id: string;
          user_id: string;
          source_workout_id: string | null;
          source_mesocycle_id: string | null;
          title: string;
          description: string | null;
          workout_data: SharedWorkoutWithProfile['workout_data'];
          share_type: SharedWorkoutWithProfile['share_type'];
          difficulty: SharedWorkoutWithProfile['difficulty'];
          duration_weeks: number | null;
          target_muscle_groups: string[];
          save_count: number;
          copy_count: number;
          view_count: number;
          is_public: boolean;
          created_at: string;
          updated_at: string;
          user_profiles: {
            id: string;
            user_id: string;
            username: string;
            display_name: string | null;
            avatar_url: string | null;
            training_experience: string | null;
            bio: string | null;
          };
        };

        setWorkout({
          id: workoutData.id,
          user_id: workoutData.user_id,
          source_workout_id: workoutData.source_workout_id,
          source_mesocycle_id: workoutData.source_mesocycle_id,
          title: workoutData.title,
          description: workoutData.description,
          workout_data: workoutData.workout_data,
          share_type: workoutData.share_type,
          difficulty: workoutData.difficulty,
          duration_weeks: workoutData.duration_weeks,
          target_muscle_groups: workoutData.target_muscle_groups,
          save_count: workoutData.save_count,
          copy_count: workoutData.copy_count,
          view_count: workoutData.view_count,
          is_public: workoutData.is_public,
          created_at: workoutData.created_at,
          updated_at: workoutData.updated_at,
          user_profile: {
            id: workoutData.user_profiles.id,
            user_id: workoutData.user_profiles.user_id,
            username: workoutData.user_profiles.username,
            display_name: workoutData.user_profiles.display_name,
            avatar_url: workoutData.user_profiles.avatar_url,
            bio: workoutData.user_profiles.bio,
            profile_visibility: 'public' as const,
            show_workouts: true,
            show_stats: true,
            show_progress_photos: false,
            follower_count: 0,
            following_count: 0,
            workout_count: 0,
            total_volume_kg: 0,
            training_experience: workoutData.user_profiles.training_experience as SharedWorkoutWithProfile['user_profile']['training_experience'],
            primary_goal: null,
            gym_name: null,
            badges: [],
            featured_achievement: null,
            created_at: '',
            updated_at: '',
          },
          is_saved: isSaved,
        });

        // Generate share link
        setShareLink(`${window.location.origin}/dashboard/discover/${workoutId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load workout');
      } finally {
        setIsLoading(false);
      }
    }

    if (workoutId) {
      fetchWorkout();
    }
  }, [workoutId]);

  const handleSave = useCallback(async (id: string) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Must be logged in' };
    }

    const { error: saveError } = await supabase
      .from('saved_workouts' as never)
      .insert({ user_id: user.id, shared_workout_id: id } as never);

    if (saveError) {
      return { success: false, error: saveError.message };
    }

    setWorkout(prev => prev ? { ...prev, is_saved: true, save_count: prev.save_count + 1 } : null);
    return { success: true };
  }, []);

  const handleUnsave = useCallback(async (id: string) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Must be logged in' };
    }

    const { error: deleteError } = await supabase
      .from('saved_workouts' as never)
      .delete()
      .eq('user_id', user.id)
      .eq('shared_workout_id', id);

    if (deleteError) {
      return { success: false, error: deleteError.message };
    }

    setWorkout(prev => prev ? { ...prev, is_saved: false, save_count: Math.max(0, prev.save_count - 1) } : null);
    return { success: true };
  }, []);

  const handleCopy = async () => {
    if (!workout) return;

    setIsCopying(true);

    const supabase = createClient();
    const result = await copySharedWorkout(workout.id, supabase);

    if (result.success) {
      setWorkout(prev => prev ? { ...prev, copy_count: prev.copy_count + 1 } : null);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 3000);
    } else {
      setError(result.error || 'Failed to copy workout');
    }

    setIsCopying(false);
  };

  const handleShare = async () => {
    if (!shareLink) return;

    try {
      if (navigator.share) {
        await navigator.share({
          title: workout?.title,
          text: `Check out this workout: ${workout?.title}`,
          url: shareLink,
        });
      } else {
        await navigator.clipboard.writeText(shareLink);
        setShowShareToast(true);
        setTimeout(() => setShowShareToast(false), 2000);
      }
    } catch (err) {
      // User cancelled share or error
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-surface-500 border-t-primary-500 rounded-full" />
      </div>
    );
  }

  if (error || !workout) {
    return (
      <div className="min-h-screen bg-surface-950 flex flex-col items-center justify-center px-4">
        <p className="text-5xl mb-4">🔍</p>
        <h1 className="text-xl font-semibold text-surface-100 mb-2">
          {error || 'Workout not found'}
        </h1>
        <p className="text-surface-400 text-center mb-6">
          This workout may have been removed or made private.
        </p>
        <Button variant="outline" onClick={() => router.push('/dashboard/discover')}>
          Browse Workouts
        </Button>
      </div>
    );
  }

  const exercises = workout.workout_data?.exercises || [];
  const totalSets = workout.workout_data?.total_sets || 0;
  const duration = workout.workout_data?.estimated_duration_minutes || 0;

  return (
    <div className="min-h-screen bg-surface-950">
      {/* Header */}
      <header className="bg-surface-900 border-b border-surface-800">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-surface-400 hover:text-surface-200 mb-4"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>

          {/* Author info */}
          <div className="flex items-center gap-3 mb-4">
            <Link href={`/dashboard/profile/${workout.user_profile.username}`}>
              <Avatar
                src={workout.user_profile.avatar_url}
                name={workout.user_profile.display_name || workout.user_profile.username}
                size="md"
              />
            </Link>
            <div>
              <Link
                href={`/dashboard/profile/${workout.user_profile.username}`}
                className="font-medium text-surface-100 hover:text-primary-400"
              >
                {workout.user_profile.display_name || workout.user_profile.username}
              </Link>
              <p className="text-sm text-surface-500">
                @{workout.user_profile.username} &middot; {formatDistanceToNow(workout.created_at)}
              </p>
            </div>
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-surface-100 mb-2">
            {workout.title}
          </h1>

          {/* Tags */}
          <div className="flex flex-wrap gap-2 mb-4">
            <span className="px-3 py-1 rounded-full text-sm font-medium bg-surface-800 text-surface-300 capitalize">
              {workout.share_type.replace('_', ' ')}
            </span>
            {workout.difficulty && (
              <span
                className={cn(
                  'px-3 py-1 rounded-full text-sm font-medium capitalize border',
                  difficultyColors[workout.difficulty]
                )}
              >
                {workout.difficulty}
              </span>
            )}
          </div>

          {/* Description */}
          {workout.description && (
            <p className="text-surface-300 mb-4">{workout.description}</p>
          )}

          {/* Stats */}
          <div className="flex items-center gap-6 text-sm text-surface-400 mb-6">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span>{exercises.length} exercises</span>
            </div>
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <span>{totalSets} sets</span>
            </div>
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>~{duration} min</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary"
              onClick={handleCopy}
              disabled={isCopying || copySuccess}
            >
              {copySuccess ? (
                <>
                  <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied!
                </>
              ) : isCopying ? (
                'Copying...'
              ) : (
                <>
                  <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy Workout
                </>
              )}
            </Button>
            <SaveWorkoutButton
              workoutId={workout.id}
              isSaved={workout.is_saved}
              onSave={handleSave}
              onUnsave={handleUnsave}
              size="md"
            />
            <Button variant="outline" onClick={handleShare}>
              <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Share
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 py-6">
        {/* Muscle groups */}
        {workout.target_muscle_groups && workout.target_muscle_groups.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-medium text-surface-400 mb-2">Target Muscles</h2>
            <div className="flex flex-wrap gap-2">
              {workout.target_muscle_groups.map((muscle) => (
                <span
                  key={muscle}
                  className="px-3 py-1 rounded-full text-sm bg-primary-500/10 text-primary-400 capitalize"
                >
                  {muscle}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Exercises */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-surface-100">Exercises</h2>
          {exercises.map((exercise, index) => (
            <Card key={index} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 flex items-center justify-center rounded-full bg-primary-500/20 text-primary-400 text-xs font-medium">
                      {index + 1}
                    </span>
                    <h3 className="font-medium text-surface-100">{exercise.exercise_name}</h3>
                  </div>
                  {exercise.notes && (
                    <p className="mt-1 text-sm text-surface-400 ml-8">{exercise.notes}</p>
                  )}
                </div>
                <div className="text-right text-sm">
                  <p className="text-surface-200">
                    {exercise.sets} sets x {exercise.rep_range[0]}-{exercise.rep_range[1]} reps
                  </p>
                  <p className="text-surface-500">RIR {exercise.target_rir}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Social stats */}
        <div className="mt-8 pt-6 border-t border-surface-800">
          <div className="flex items-center gap-6 text-sm text-surface-400">
            <span>{workout.view_count} views</span>
            <span>{workout.save_count} saves</span>
            <span>{workout.copy_count} copies</span>
          </div>
        </div>
      </main>

      {/* Share toast */}
      {showShareToast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-surface-800 text-surface-100 rounded-lg shadow-lg">
          Link copied to clipboard!
        </div>
      )}
    </div>
  );
}
