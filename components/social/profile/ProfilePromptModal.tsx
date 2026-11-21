'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import { IconUser } from '@tabler/icons-react';
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
      // Cast: user_profiles is missing from the generated types.
      const { error } = await supabase.from('user_profiles').insert({
        user_id: user.id,
        username: normalizeUsername(username),
        display_name: displayName.trim() || null,
        profile_visibility: 'public',
        show_workouts: true,
        show_stats: true,
      } as never);

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
      const { error } = await supabase
        .from('user_profiles')
        // @ts-expect-error - user_profiles table not in generated types yet
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


  return (
    <Sheet
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={needsProfile ? 'Create your profile' : 'Personalize your profile'}
      size="md"
      data-testid="profile-prompt-sheet"
    >
        <div>
          {/* Header */}
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-action-tint flex items-center justify-center">
              <IconUser className="w-8 h-8 text-action" stroke={1.75} aria-hidden="true" />
            </div>
            <h2 className="text-title text-ink">
              {needsProfile ? 'Create your profile' : 'Personalize your profile'}
            </h2>
            <p className="text-subhead text-ink-2 mt-2">
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
              />

              {/* Suggestions */}
              {suggestions.length > 0 && (hasAnonymousUsername || needsProfile || !username) && (
                <div className="mt-2">
                  <p className="text-caption text-ink-3 mb-1.5">Suggestions</p>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions.slice(0, 3).map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => handleSuggestionClick(suggestion)}
                        className="px-2.5 py-1 text-caption bg-fill hover:bg-sep text-ink-2 rounded-full transition-colors"
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
              placeholder="Your name (optional)"
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
              {needsProfile ? 'Create profile' : 'Save changes'}
            </Button>

            <div className="flex gap-3">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={onClose}
              >
                {hasAnonymousUsername ? 'Keep anonymous' : 'Maybe later'}
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                onClick={handleGoToFullSetup}
              >
                Full setup
              </Button>
            </div>
          </div>

          {hasAnonymousUsername && (
            <p className="text-caption text-ink-3 text-center mt-4">
              You can share workouts anonymously with your current username.
            </p>
          )}
        </div>
    </Sheet>
  );
}
