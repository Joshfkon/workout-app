'use client';

import { useState, useCallback, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createUntypedClient } from '@/lib/supabase/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { updateOnboardingStep } from '@/lib/onboarding/onboardingProgress';
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

    // Track progress
    await updateOnboardingStep(supabase, user.id, 'profile');

    // Navigate to next step (Enhanced Athlete Mode, right after
    // training experience)
    router.push(`/onboarding/enhanced?session=${sessionId}`);
  };

  const handleSkip = async () => {
    // Track progress even when skipping
    const supabase = createUntypedClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await updateOnboardingStep(supabase, user.id, 'profile');
    }
    
    // Navigate without updating profile
    router.push(`/onboarding/enhanced?session=${sessionId}`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-action border-t-transparent rounded-full animate-spin" />
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
                ? 'bg-action text-on-action'
                : step === 5
                  ? 'bg-action text-on-action'
                  : 'bg-fill text-ink-3'
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
              <div className={`w-12 h-0.5 ${step < 5 ? 'bg-action' : 'bg-fill'}`} />
            )}
          </div>
        ))}
      </div>

      <div className="text-center mb-8">
        <h1 className="text-large-title font-bold text-ink mb-2">Set up your profile</h1>
        <p className="text-ink-2">
          Customize your profile to connect with other lifters
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile details</CardTitle>
          <p className="text-ink-2 text-body mt-1">
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
                leftIcon={<span className="text-ink-3">@</span>}
                rightIcon={
                  checkingUsername ? (
                    <div className="animate-spin h-4 w-4 border-2 border-ink-3 border-t-action rounded-full" />
                  ) : usernameAvailable === true ? (
                    <span className="text-status-ok">&#10003;</span>
                  ) : usernameAvailable === false ? (
                    <span className="text-status-bad">&#10007;</span>
                  ) : null
                }
                hint="3-30 characters, letters, numbers, and underscores only"
              />

              {/* Suggestions - show if they have an anonymous username or no username entered */}
              {suggestions.length > 0 && (hasAnonymousUsername || !username) && (
                <div className="mt-3">
                  <p className="text-caption text-ink-2 mb-2">Suggestions:</p>
                  <div className="flex flex-wrap gap-2">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => handleSuggestionClick(suggestion)}
                        className="px-3 py-1 text-body bg-fill hover:bg-sep text-ink-2 rounded-full transition-colors"
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
              <label className="block text-body font-medium text-ink mb-1.5">
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

            {/* Actions */}
            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={handleSkip}
              >
                Skip for now
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="flex-1"
                disabled={!username || !usernameAvailable || saving}
                isLoading={saving}
              >
                Save & continue
              </Button>
            </div>

            <p className="text-caption text-ink-3 text-center">
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
        <div className="w-8 h-8 border-4 border-action border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <ProfileSetupContent />
    </Suspense>
  );
}
