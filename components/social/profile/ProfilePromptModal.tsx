'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  validateUsername,
  generateUsernameSuggestions,
  normalizeUsername,
  isAnonymousUsername,
} from '@/lib/social';
import { debounce } from '@/lib/utils';

interface ProfilePromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUsername?: string;
  userEmail?: string;
  userName?: string;
}

export function ProfilePromptModal({
  isOpen,
  onClose,
  currentUsername,
  userEmail,
  userName,
}: ProfilePromptModalProps) {
  const router = useRouter();
  const [username, setUsername] = useState(currentUsername || '');
  const [displayName, setDisplayName] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const hasAnonymousUsername = currentUsername && isAnonymousUsername(currentUsername);
  const needsProfile = !currentUsername;

  useEffect(() => {
    if (isOpen) {
      // Generate suggestions
      const initialSuggestions = generateUsernameSuggestions(userEmail, userName);
      setSuggestions(initialSuggestions);

      // Pre-fill display name
      if (userName) {
        setDisplayName(userName);
      }

      // If they have a current username, set it
      if (currentUsername) {
        setUsername(currentUsername);
        if (isAnonymousUsername(currentUsername)) {
          setUsernameAvailable(true);
        }
      }
    }
  }, [isOpen, userEmail, userName, currentUsername]);

  // Check username availability (debounced)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const checkUsernameAvailability = useCallback(
    debounce(async (usernameToCheck: string, existingUsername?: string) => {
      if (!usernameToCheck || usernameToCheck.length < 3) {
        setUsernameAvailable(null);
        setCheckingUsername(false);
        return;
      }

      // If username hasn't changed, it's available
      if (existingUsername && normalizeUsername(usernameToCheck) === normalizeUsername(existingUsername)) {
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

  const handleSubmit = async () => {
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

    if (needsProfile) {
      // Create new profile
      // @ts-expect-error - user_profiles table not in generated types yet
      const { error } = await supabase.from('user_profiles').insert({
        user_id: user.id,
        username: normalizeUsername(username),
        display_name: displayName.trim() || null,
        profile_visibility: 'public',
        show_workouts: true,
        show_stats: true,
      });

      if (error) {
        if (error.code === '23505') {
          setUsernameError('Username is already taken');
        } else {
          setUsernameError('Failed to create profile. Please try again.');
        }
        setSaving(false);
        return;
      }
    } else {
      // Update existing profile
      // @ts-expect-error - user_profiles table not in generated types yet
      const { error } = await supabase
        .from('user_profiles')
        .update({
          username: normalizeUsername(username),
          display_name: displayName.trim() || null,
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
    }

    setSaving(false);
    onClose();
    // Refresh the page to show updated profile
    router.refresh();
  };

  const handleGoToFullSetup = () => {
    onClose();
    router.push('/dashboard/profile/setup');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md bg-surface-900 rounded-xl border border-surface-800 overflow-hidden animate-fade-in">
        <div className="p-6">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary-500/20 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-primary-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-surface-100">
              {needsProfile ? 'Create Your Profile' : 'Personalize Your Profile'}
            </h2>
            <p className="text-sm text-surface-400 mt-2">
              {needsProfile
                ? 'Set up your profile to share workouts and connect with other lifters.'
                : 'Update your username to make it easier for friends to find you.'}
            </p>
          </div>

          {/* Quick form */}
          <div className="space-y-4">
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
              />

              {/* Suggestions */}
              {suggestions.length > 0 && (hasAnonymousUsername || needsProfile || !username) && (
                <div className="mt-2">
                  <p className="text-xs text-surface-500 mb-1.5">Suggestions:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions.slice(0, 3).map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => handleSuggestionClick(suggestion)}
                        className="px-2.5 py-1 text-xs bg-surface-800 hover:bg-surface-700 text-surface-300 rounded-full transition-colors"
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
              placeholder="Your Name (optional)"
            />
          </div>

          {/* Actions */}
          <div className="mt-6 space-y-3">
            <Button
              variant="primary"
              className="w-full"
              onClick={handleSubmit}
              disabled={!username || !usernameAvailable || saving}
              isLoading={saving}
            >
              {needsProfile ? 'Create Profile' : 'Save Changes'}
            </Button>

            <div className="flex gap-3">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={onClose}
              >
                {hasAnonymousUsername ? 'Keep Anonymous' : 'Maybe Later'}
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleGoToFullSetup}
              >
                Full Setup
              </Button>
            </div>
          </div>

          {hasAnonymousUsername && (
            <p className="text-xs text-surface-500 text-center mt-4">
              You can share workouts anonymously with your current username
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
