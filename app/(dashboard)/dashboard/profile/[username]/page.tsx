'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/social/profile';
import { formatSocialCount } from '@/lib/social';
import { formatWeight } from '@/lib/utils';
import { useUserStore } from '@/stores/userStore';
import type { UserProfile, FollowRelationship } from '@/types/social';

export default function UserProfilePage() {
  const params = useParams();
  const username = params.username as string;

  const user = useUserStore((state) => state.user);
  const units = user?.preferences?.units ?? 'kg';

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [followRelationship, setFollowRelationship] = useState<FollowRelationship>({
    is_following: false,
    is_followed_by: false,
    follow_status: 'none',
  });
  const [isOwnProfile, setIsOwnProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);
  const [notFoundError, setNotFoundError] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      const supabase = createClient();

      // Get current user
      const { data: { user: authUser } } = await supabase.auth.getUser();

      // Fetch profile by username
      const { data: profileData, error } = await supabase
        .from('user_profiles')
        .select('*')
        .ilike('username', username)
        .single<UserProfile>();

      if (error || !profileData) {
        setNotFoundError(true);
        setLoading(false);
        return;
      }

      setProfile(profileData as UserProfile);

      // Check if this is the current user's profile
      if (authUser && profileData.user_id === authUser.id) {
        setIsOwnProfile(true);
        setLoading(false);
        return;
      }

      // Check follow relationship if logged in
      if (authUser) {
        type FollowRow = { status: string };

        const { data: followData } = (await supabase
          .from('follows' as never)
          .select('status')
          .eq('follower_id', authUser.id)
          .eq('following_id', profileData.user_id)
          .single()) as { data: FollowRow | null };

        const { data: followedByData } = (await supabase
          .from('follows' as never)
          .select('status')
          .eq('follower_id', profileData.user_id)
          .eq('following_id', authUser.id)
          .eq('status', 'accepted')
          .single()) as { data: FollowRow | null };

        setFollowRelationship({
          is_following: followData?.status === 'accepted',
          is_followed_by: !!followedByData,
          follow_status: (followData?.status as FollowRelationship['follow_status']) ?? 'none',
        });
      }

      setLoading(false);
    };

    fetchProfile();
  }, [username]);

  const handleFollow = useCallback(async () => {
    if (!profile) return;

    setFollowLoading(true);
    const supabase = createClient();

    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) {
      // Redirect to login
      window.location.href = '/login';
      return;
    }

    // Determine if we need to send a request or direct follow
    const status = profile.profile_visibility === 'private' ? 'pending' : 'accepted';

    const { error } = await (supabase
      .from('follows' as never) as ReturnType<typeof supabase.from>)
      .insert({
        follower_id: authUser.id,
        following_id: profile.user_id,
        status,
        accepted_at: status === 'accepted' ? new Date().toISOString() : null,
      } as never);

    if (!error) {
      setFollowRelationship((prev) => ({
        ...prev,
        is_following: status === 'accepted',
        follow_status: status,
      }));

      // Update follower count optimistically
      if (status === 'accepted') {
        setProfile((prev) =>
          prev ? { ...prev, follower_count: prev.follower_count + 1 } : prev
        );
      }
    }

    setFollowLoading(false);
  }, [profile]);

  const handleUnfollow = useCallback(async () => {
    if (!profile) return;

    setFollowLoading(true);
    const supabase = createClient();

    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) return;

    const { error } = await (supabase
      .from('follows' as never) as ReturnType<typeof supabase.from>)
      .delete()
      .eq('follower_id', authUser.id)
      .eq('following_id', profile.user_id);

    if (!error) {
      setFollowRelationship({
        is_following: false,
        is_followed_by: followRelationship.is_followed_by,
        follow_status: 'none',
      });

      // Update follower count optimistically
      setProfile((prev) =>
        prev ? { ...prev, follower_count: Math.max(0, prev.follower_count - 1) } : prev
      );
    }

    setFollowLoading(false);
  }, [profile, followRelationship.is_followed_by]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500" />
      </div>
    );
  }

  if (notFoundError || !profile) {
    return (
      <div className="max-w-lg mx-auto px-4 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-6xl mb-4">👤</p>
            <h2 className="text-xl font-semibold text-surface-100 mb-2">
              User Not Found
            </h2>
            <p className="text-surface-400 mb-6">
              The user @{username} doesn&apos;t exist or their profile is private.
            </p>
            <Link href="/dashboard">
              <Button variant="primary">Go to Dashboard</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if profile is private and user is not following
  const isPrivateAndNotFollowing =
    profile.profile_visibility === 'private' &&
    !isOwnProfile &&
    !followRelationship.is_following;

  const displayName = profile.display_name || profile.username;

  const renderFollowButton = () => {
    if (isOwnProfile) {
      return (
        <Link href="/dashboard/profile/edit">
          <Button variant="outline" size="sm">
            Edit Profile
          </Button>
        </Link>
      );
    }

    if (followRelationship.is_following) {
      return (
        <Button
          variant="secondary"
          size="sm"
          onClick={handleUnfollow}
          isLoading={followLoading}
        >
          Following
        </Button>
      );
    }

    if (followRelationship.follow_status === 'pending') {
      return (
        <Button
          variant="secondary"
          size="sm"
          onClick={handleUnfollow}
          isLoading={followLoading}
        >
          Requested
        </Button>
      );
    }

    return (
      <Button
        variant="primary"
        size="sm"
        onClick={handleFollow}
        isLoading={followLoading}
      >
        Follow
      </Button>
    );
  };

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
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-surface-100 truncate">
                {displayName}
              </h1>
              {followRelationship.is_followed_by && !isOwnProfile && (
                <span className="px-2 py-0.5 text-xs bg-surface-800 text-surface-400 rounded">
                  Follows you
                </span>
              )}
            </div>
            <p className="text-surface-400">@{profile.username}</p>

            {!isPrivateAndNotFollowing && profile.bio && (
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

          {renderFollowButton()}
        </div>

        {/* Stats - hidden for private profiles */}
        {!isPrivateAndNotFollowing && (
          <div className="flex items-center justify-around mt-6 pt-6 border-t border-surface-800">
            <div className="text-center">
              <p className="text-2xl font-bold text-surface-100">
                {profile.show_stats ? formatSocialCount(profile.workout_count) : '-'}
              </p>
              <p className="text-sm text-surface-400">Workouts</p>
            </div>

            <div className="w-px h-10 bg-surface-800" />

            <div className="text-center">
              <p className="text-2xl font-bold text-surface-100">
                {formatSocialCount(profile.follower_count)}
              </p>
              <p className="text-sm text-surface-400">Followers</p>
            </div>

            <div className="w-px h-10 bg-surface-800" />

            <div className="text-center">
              <p className="text-2xl font-bold text-surface-100">
                {formatSocialCount(profile.following_count)}
              </p>
              <p className="text-sm text-surface-400">Following</p>
            </div>
          </div>
        )}
      </Card>

      {/* Private Profile Message */}
      {isPrivateAndNotFollowing && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-4xl mb-3">🔒</p>
            <h3 className="text-lg font-semibold text-surface-100 mb-2">
              This Account is Private
            </h3>
            <p className="text-surface-400">
              Follow this account to see their workouts and activity.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Badges */}
      {!isPrivateAndNotFollowing && profile.badges.length > 0 && (
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
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Training Stats */}
      {!isPrivateAndNotFollowing && profile.show_stats && (
        <Card>
          <CardHeader>
            <CardTitle>Training Stats</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-surface-800 rounded-lg">
                <p className="text-2xl font-bold text-surface-100">
                  {profile.workout_count}
                </p>
                <p className="text-sm text-surface-400">Total Workouts</p>
              </div>

              <div className="p-4 bg-surface-800 rounded-lg">
                <p className="text-2xl font-bold text-surface-100">
                  {formatWeight(profile.total_volume_kg, units, 0)}
                </p>
                <p className="text-sm text-surface-400">Total Volume</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Activity placeholder */}
      {!isPrivateAndNotFollowing && profile.show_workouts && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-center text-surface-400 py-8">
              Activity feed coming soon...
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
