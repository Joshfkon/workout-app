'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/social/profile';
import { formatSocialCount, getProfileUrl } from '@/lib/social';
import { formatWeight } from '@/lib/utils';
import { useUserStore } from '@/stores/userStore';
import type { UserProfile, ProfileStats } from '@/types/social';

export default function MyProfilePage() {
  const router = useRouter();
  const user = useUserStore((state) => state.user);
  const units = user?.preferences?.units ?? 'kg';

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsProfile, setNeedsProfile] = useState(false);

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
        // User needs to create a profile
        setNeedsProfile(true);
        setLoading(false);
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
        current_streak: 0, // TODO: Calculate
        longest_streak: 0, // TODO: Calculate
        favorite_exercise: null,
        strongest_lift: null,
      });

      setLoading(false);
    };

    fetchProfile();
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500" />
      </div>
    );
  }

  if (needsProfile) {
    return (
      <div className="max-w-lg mx-auto px-4 py-8">
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
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
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
}
