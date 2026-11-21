'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  validateUsername,
  generateUsernameSuggestions,
  normalizeUsername,
} from '@/lib/social';
import { debounce } from '@/lib/utils';
import type { TrainingExperience } from '@/types/social';
import type { Database } from '@/types/database';

export default function ProfileSetupPage() {
  useDocumentTitle('Profile Setup');
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [trainingExperience, setTrainingExperience] = useState<TrainingExperience | ''>('');
  const [gymName, setGymName] = useState('');

  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Load user email for suggestions
  useEffect(() => {
    const loadUser = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login');
        return;
      }

      // Check if user already has a profile
      const { data: existingProfile } = await supabase
        .from('user_profiles')
        .select('username')
        .eq('user_id', user.id)
        .single();

      if (existingProfile) {
        router.push('/dashboard/profile');
        return;
      }

      setUserEmail(user.email || null);

      // Generate initial suggestions
      const initialSuggestions = generateUsernameSuggestions(
        user.email || undefined,
        user.user_metadata?.full_name || undefined
      );
      setSuggestions(initialSuggestions);

      // Pre-fill display name if available
      if (user.user_metadata?.full_name) {
        setDisplayName(user.user_metadata.full_name);
      }
    };

    loadUser();
  }, [router]);

  // Check username availability (debounced)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const checkUsernameAvailability = useCallback(
    debounce(async (usernameToCheck: string) => {
      if (!usernameToCheck || usernameToCheck.length < 3) {
        setUsernameAvailable(null);
        setCheckingUsername(false);
        return;
      }

      const validation = validateUsername(usernameToCheck);
      if (!validation.isValid) {
        setUsernameError(validation.error || 'Invalid username');
        setUsernameAvailable(false);
        setCheckingUsername(false);
        return;
      }

      setCheckingUsername(true);
      const supabase = createClient();

      const { data } = await supabase
        .from('user_profiles')
        .select('id')
        .ilike('username', usernameToCheck)
        .single();

      setUsernameAvailable(!data);
      setUsernameError(data ? 'Username is already taken' : null);
      setCheckingUsername(false);
    }, 500),
    []
  );

  const handleUsernameChange = (value: string) => {
    // Remove spaces and special characters as they type
    const cleaned = value.toLowerCase().replace(/[^a-z0-9_]/g, '');
    setUsername(cleaned);
    setUsernameError(null);
    setUsernameAvailable(null);

    if (cleaned.length >= 3) {
      setCheckingUsername(true);
      checkUsernameAvailability(cleaned);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setUsername(suggestion);
    setUsernameError(null);
    checkUsernameAvailability(suggestion);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Final validation
    const validation = validateUsername(username);
    if (!validation.isValid) {
      setUsernameError(validation.error || 'Invalid username');
      return;
    }

    if (!usernameAvailable) {
      setUsernameError('Please choose an available username');
      return;
    }

    setSaving(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      router.push('/login');
      return;
    }

    // Payload typed against the generated table type; `as never` works around
    // the @supabase/ssr / @supabase/supabase-js generic skew that collapses
    // write builders to `never` (not a missing-type workaround).
    const insert: Database['public']['Tables']['user_profiles']['Insert'] = {
      user_id: user.id,
      username: normalizeUsername(username),
      display_name: displayName.trim() || null,
      bio: bio.trim() || null,
      training_experience: trainingExperience || null,
      gym_name: gymName.trim() || null,
      profile_visibility: 'public',
      show_workouts: true,
      show_stats: true,
    };
    const { error } = await supabase.from('user_profiles').insert(insert as never);

    if (error) {
      if (error.code === '23505') {
        setUsernameError('Username is already taken');
      } else {
        setUsernameError('Failed to create profile. Please try again.');
      }
      setSaving(false);
      return;
    }

    router.push('/dashboard/profile');
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>Create your profile</CardTitle>
          <p className="text-ink-2 text-subhead mt-1">
            Set up your profile to connect with other lifters
          </p>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Username */}
            <div>
              <Input
                label="Username"
                value={username}
                onChange={(e) => handleUsernameChange(e.target.value)}
                placeholder="your_username"
                error={usernameError || undefined}
                leftIcon={<span className="text-ink-3">@</span>}
                rightIcon={
                  checkingUsername ? (
                    <div className="animate-spin h-4 w-4 border-2 border-ink-3 border-t-action rounded-full" />
                  ) : usernameAvailable === true ? (
                    <span className="text-status-ok">✓</span>
                  ) : usernameAvailable === false ? (
                    <span className="text-status-bad">✗</span>
                  ) : null
                }
                hint="3-30 characters, letters, numbers, and underscores only"
              />

              {/* Suggestions */}
              {suggestions.length > 0 && !username && (
                <div className="mt-3">
                  <p className="text-caption text-ink-2 mb-2">Suggestions:</p>
                  <div className="flex flex-wrap gap-2">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => handleSuggestionClick(suggestion)}
                        className="px-3 py-1 text-subhead bg-fill hover:bg-sep text-ink-2 rounded-full transition-colors"
                      >
                        @{suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Display Name */}
            <Input
              label="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              hint="Optional - shown on your profile"
            />

            {/* Bio */}
            <div>
              <label className="block text-subhead font-medium text-ink mb-1.5">
                Bio
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, 500))}
                placeholder="Tell others about yourself..."
                rows={3}
                className="w-full rounded-lg bg-fill border border-sep px-4 py-2.5
                  text-ink placeholder:text-ink-3
                  focus:outline-none focus:ring-2 focus:ring-action focus:border-transparent
                  transition-all duration-200 resize-none"
              />
              <p className="mt-1 text-caption text-ink-3 text-right">
                {bio.length}/500
              </p>
            </div>

            {/* Training Experience */}
            <Select
              label="Training experience"
              value={trainingExperience}
              onChange={(e) => setTrainingExperience(e.target.value as TrainingExperience | '')}
              placeholder="Select your experience level"
              options={[
                { value: 'beginner', label: 'Beginner (0-1 years)' },
                { value: 'intermediate', label: 'Intermediate (1-3 years)' },
                { value: 'advanced', label: 'Advanced (3-5 years)' },
                { value: 'elite', label: 'Elite (5+ years)' },
              ]}
            />

            {/* Gym Name */}
            <Input
              label="Gym"
              value={gymName}
              onChange={(e) => setGymName(e.target.value)}
              placeholder="Your gym name"
              hint="Optional - helps you connect with gym buddies"
            />

            {/* Submit */}
            <div className="pt-4">
              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={!username || !usernameAvailable || saving}
                isLoading={saving}
              >
                Create profile
              </Button>
            </div>

            <p className="text-caption text-ink-3 text-center">
              You can change these settings later in your profile settings
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
