'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/social/profile';
import type { UserProfile, ProfileVisibility, TrainingExperience } from '@/types/social';

export default function ProfileEditPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Form state
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [profileVisibility, setProfileVisibility] = useState<ProfileVisibility>('public');
  const [showWorkouts, setShowWorkouts] = useState(true);
  const [showStats, setShowStats] = useState(true);
  const [trainingExperience, setTrainingExperience] = useState<TrainingExperience | ''>('');
  const [gymName, setGymName] = useState('');

  useEffect(() => {
    const fetchProfile = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login');
        return;
      }

      const { data: profile, error: fetchError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (fetchError || !profile) {
        setError('Failed to load profile');
        setLoading(false);
        return;
      }

      setDisplayName(profile.display_name || '');
      setBio(profile.bio || '');
      setProfileVisibility(profile.profile_visibility || 'public');
      setShowWorkouts(profile.show_workouts ?? true);
      setShowStats(profile.show_stats ?? true);
      setTrainingExperience(profile.training_experience || '');
      setGymName(profile.gym_name || '');
      setLoading(false);
    };

    fetchProfile();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('Not logged in');
      }

      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({
          display_name: displayName.trim() || null,
          bio: bio.trim() || null,
          profile_visibility: profileVisibility,
          show_workouts: showWorkouts,
          show_stats: showStats,
          training_experience: trainingExperience || null,
          gym_name: gymName.trim() || null,
        })
        .eq('user_id', user.id);

      if (updateError) throw updateError;

      setSuccess(true);
      setTimeout(() => {
        router.push('/dashboard/profile');
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Edit Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Display Name */}
            <div>
              <label className="block text-sm font-medium text-surface-200 mb-2">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Your name"
                maxLength={50}
              />
            </div>

            {/* Bio */}
            <div>
              <label className="block text-sm font-medium text-surface-200 mb-2">
                Bio
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                rows={4}
                placeholder="Tell us about yourself..."
                maxLength={500}
              />
              <p className="text-xs text-surface-400 mt-1">{bio.length}/500</p>
            </div>

            {/* Privacy Settings */}
            <div className="border-t border-surface-800 pt-6">
              <h3 className="text-lg font-semibold text-surface-100 mb-4">Privacy Settings</h3>

              {/* Profile Visibility */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-surface-200 mb-2">
                  Profile Visibility
                </label>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 p-3 bg-surface-800 rounded-lg cursor-pointer hover:bg-surface-700 transition-colors">
                    <input
                      type="radio"
                      name="visibility"
                      value="public"
                      checked={profileVisibility === 'public'}
                      onChange={(e) => setProfileVisibility(e.target.value as ProfileVisibility)}
                      className="w-4 h-4 text-primary-500"
                    />
                    <div>
                      <p className="text-surface-100 font-medium">Public</p>
                      <p className="text-xs text-surface-400">Anyone can view your profile and workouts</p>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 p-3 bg-surface-800 rounded-lg cursor-pointer hover:bg-surface-700 transition-colors">
                    <input
                      type="radio"
                      name="visibility"
                      value="followers_only"
                      checked={profileVisibility === 'followers_only'}
                      onChange={(e) => setProfileVisibility(e.target.value as ProfileVisibility)}
                      className="w-4 h-4 text-primary-500"
                    />
                    <div>
                      <p className="text-surface-100 font-medium">Followers Only</p>
                      <p className="text-xs text-surface-400">Only people you follow can view your profile</p>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 p-3 bg-surface-800 rounded-lg cursor-pointer hover:bg-surface-700 transition-colors">
                    <input
                      type="radio"
                      name="visibility"
                      value="private"
                      checked={profileVisibility === 'private'}
                      onChange={(e) => setProfileVisibility(e.target.value as ProfileVisibility)}
                      className="w-4 h-4 text-primary-500"
                    />
                    <div>
                      <p className="text-surface-100 font-medium">Private</p>
                      <p className="text-xs text-surface-400">Only you can view your profile</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Show Workouts */}
              <div className="mb-4">
                <label className="flex items-center gap-3 p-3 bg-surface-800 rounded-lg cursor-pointer hover:bg-surface-700 transition-colors">
                  <input
                    type="checkbox"
                    checked={showWorkouts}
                    onChange={(e) => setShowWorkouts(e.target.checked)}
                    className="w-4 h-4 text-primary-500 bg-surface-900 border-surface-700 rounded focus:ring-primary-500"
                  />
                  <div>
                    <p className="text-surface-100 font-medium">Show Workouts</p>
                    <p className="text-xs text-surface-400">Allow others to see your completed workouts</p>
                  </div>
                </label>
              </div>

              {/* Show Stats */}
              <div>
                <label className="flex items-center gap-3 p-3 bg-surface-800 rounded-lg cursor-pointer hover:bg-surface-700 transition-colors">
                  <input
                    type="checkbox"
                    checked={showStats}
                    onChange={(e) => setShowStats(e.target.checked)}
                    className="w-4 h-4 text-primary-500 bg-surface-900 border-surface-700 rounded focus:ring-primary-500"
                  />
                  <div>
                    <p className="text-surface-100 font-medium">Show Stats</p>
                    <p className="text-xs text-surface-400">Allow others to see your training statistics</p>
                  </div>
                </label>
              </div>
            </div>

            {/* Training Info */}
            <div className="border-t border-surface-800 pt-6">
              <h3 className="text-lg font-semibold text-surface-100 mb-4">Training Info</h3>

              {/* Training Experience */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-surface-200 mb-2">
                  Training Experience
                </label>
                <select
                  value={trainingExperience}
                  onChange={(e) => setTrainingExperience(e.target.value as TrainingExperience | '')}
                  className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Select experience level</option>
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                  <option value="elite">Elite</option>
                </select>
              </div>

              {/* Gym Name */}
              <div>
                <label className="block text-sm font-medium text-surface-200 mb-2">
                  Gym Name
                </label>
                <input
                  type="text"
                  value={gymName}
                  onChange={(e) => setGymName(e.target.value)}
                  className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Your gym name"
                  maxLength={100}
                />
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-error-900/20 border border-error-500 rounded-lg p-3">
                <p className="text-sm text-error-400">{error}</p>
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div className="bg-success-900/20 border border-success-500 rounded-lg p-3">
                <p className="text-sm text-success-400">Profile updated successfully!</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/dashboard/profile')}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

