'use client';

import { useState, useCallback, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createUntypedClient } from '@/lib/supabase/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { usePWA } from '@/hooks/usePWA';
import {
  validateUsername,
  generateUsernameSuggestions,
  normalizeUsername,
  isAnonymousUsername,
} from '@/lib/social';
import { debounce } from '@/lib/utils';
import type { TrainingExperience } from '@/types/social';

function ProfileSetupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');
  const { shouldShowInOnboarding } = usePWA();

  const [isLoading, setIsLoading] = useState(true);
  const [currentUsername, setCurrentUsername] = useState('');
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

  // Load existing profile data
  useEffect(() => {
    const loadProfile = async () => {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login');
        return;
      }

      // Fetch existing profile
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (profile) {
        setCurrentUsername(profile.username);
        setUsername(profile.username);
        setDisplayName(profile.display_name || '');
        setBio(profile.bio || '');
        setTrainingExperience(profile.training_experience || '');
        setGymName(profile.gym_name || '');

        // If they have an anonymous username, mark as available
        if (isAnonymousUsername(profile.username)) {
          setUsernameAvailable(true);
        }
      }

      // Generate username suggestions from user info
      const initialSuggestions = generateUsernameSuggestions(
        user.email || undefined,
        user.user_metadata?.full_name || undefined
      );
      setSuggestions(initialSuggestions);

      // Pre-fill display name if available and not set
      if (!profile?.display_name && user.user_metadata?.full_name) {
        setDisplayName(user.user_metadata.full_name);
      }

      setIsLoading(false);
    };

    loadProfile();
  }, [router]);

  // Check username availability (debounced)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const checkUsernameAvailability = useCallback(
    debounce(async (usernameToCheck: string, existingUsername: string) => {
      if (!usernameToCheck || usernameToCheck.length < 3) {
        setUsernameAvailable(null);
        setCheckingUsername(false);
        return;
      }

      // If username hasn't changed, it's available
      if (normalizeUsername(usernameToCheck) === normalizeUsername(existingUsername)) {
        setUsernameAvailable(true);
        setUsernameError(null);
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
      const supabase = createUntypedClient();

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
      checkUsernameAvailability(cleaned, currentUsername);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setUsername(suggestion);
    setUsernameError(null);
    checkUsernameAvailability(suggestion, currentUsername);
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

    const supabase = createUntypedClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      router.push('/login');
      return;
    }

    // Update profile
    const { error } = await supabase
      .from('user_profiles')
      .update({
        username: normalizeUsername(username),
        display_name: displayName.trim() || null,
        bio: bio.trim() || null,
        training_experience: trainingExperience || null,
        gym_name: gymName.trim() || null,
      })
      .eq('user_id', user.id);

    if (error) {
      if (error.code === '23505') {
        setUsernameError('Username is already taken');
      } else {
        setUsernameError('Failed to update profile. Please try again.');
      }
      setSaving(false);
      return;
    }

    // Navigate to next step
    if (shouldShowInOnboarding()) {
      router.push(`/onboarding/install?session=${sessionId}`);
    } else {
      router.push('/dashboard');
    }
  };

  const handleSkip = async () => {
    // Navigate without updating profile
    if (shouldShowInOnboarding()) {
      router.push(`/onboarding/install?session=${sessionId}`);
    } else {
      router.push('/dashboard');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const hasAnonymousUsername = isAnonymousUsername(currentUsername);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Progress indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {[1, 2, 3, 4, 5].map((step) => (
          <div key={step} className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step <= 4
                ? 'bg-primary-500 text-white'
                : step === 5
                  ? 'bg-primary-500 text-white'
                  : 'bg-surface-800 text-surface-500'
            }`}>
              {step < 5 ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                step
              )}
            </div>
            {step < 5 && (
              <div className={`w-12 h-0.5 ${step < 5 ? 'bg-primary-500' : 'bg-surface-800'}`} />
            )}
          </div>
        ))}
      </div>

      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-surface-100 mb-2">Set Up Your Profile</h1>
        <p className="text-surface-400">
          Customize your profile to connect with other lifters
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile Details</CardTitle>
          <p className="text-surface-400 text-sm mt-1">
            {hasAnonymousUsername
              ? "We've created a temporary username for you. Personalize it below!"
              : "Update your profile information"}
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
                leftIcon={<span className="text-surface-500">@</span>}
                rightIcon={
                  checkingUsername ? (
                    <div className="animate-spin h-4 w-4 border-2 border-surface-500 border-t-primary-500 rounded-full" />
                  ) : usernameAvailable === true ? (
                    <span className="text-success-500">&#10003;</span>
                  ) : usernameAvailable === false ? (
                    <span className="text-danger-500">&#10007;</span>
                  ) : null
                }
                hint="3-30 characters, letters, numbers, and underscores only"
              />

              {/* Suggestions - show if they have an anonymous username or no username entered */}
              {suggestions.length > 0 && (hasAnonymousUsername || !username) && (
                <div className="mt-3">
                  <p className="text-xs text-surface-400 mb-2">Suggestions:</p>
                  <div className="flex flex-wrap gap-2">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => handleSuggestionClick(suggestion)}
                        className="px-3 py-1 text-sm bg-surface-800 hover:bg-surface-700 text-surface-300 rounded-full transition-colors"
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
              label="Display Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your Name"
              hint="Optional - shown on your profile"
            />

            {/* Bio */}
            <div>
              <label className="block text-sm font-medium text-surface-200 mb-1.5">
                Bio
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, 500))}
                placeholder="Tell others about yourself..."
                rows={3}
                className="w-full rounded-lg bg-surface-800 border border-surface-700 px-4 py-2.5
                  text-surface-100 placeholder:text-surface-500
                  focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
                  transition-all duration-200 resize-none"
              />
              <p className="mt-1 text-xs text-surface-500 text-right">
                {bio.length}/500
              </p>
            </div>

            {/* Training Experience */}
            <Select
              label="Training Experience"
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

            {/* Actions */}
            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={handleSkip}
              >
                Skip for Now
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="flex-1"
                disabled={!username || !usernameAvailable || saving}
                isLoading={saving}
              >
                Save & Continue
              </Button>
            </div>

            <p className="text-xs text-surface-500 text-center">
              You can update these settings anytime in your profile
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ProfileSetupPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <ProfileSetupContent />
    </Suspense>
  );
}
