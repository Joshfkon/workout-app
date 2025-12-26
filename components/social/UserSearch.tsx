'use client';

import { useState, useCallback, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Input } from '@/components/ui/Input';
import { ProfileCard } from './profile/ProfileCard';
import { debounce } from '@/lib/utils';
import type { UserProfile } from '@/types/social';

interface UserSearchProps {
  onSelectUser?: (profile: UserProfile) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function UserSearch({
  onSelectUser,
  placeholder = 'Search users...',
  autoFocus = false,
}: UserSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserProfile[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const searchUsers = useCallback(
    debounce(async (searchQuery: string) => {
      if (!searchQuery || searchQuery.length < 2) {
        setResults([]);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      const supabase = createClient();

      // Search by username or display_name
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .or(`username.ilike.%${searchQuery}%,display_name.ilike.%${searchQuery}%`)
        .eq('profile_visibility', 'public')
        .limit(20);

      if (!error && data) {
        setResults(data);
      }

      setIsSearching(false);
      setHasSearched(true);
    }, 300),
    []
  );

  useEffect(() => {
    searchUsers(query);
  }, [query, searchUsers]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    if (!value) {
      setResults([]);
      setHasSearched(false);
    }
  };

  return (
    <div className="w-full">
      <Input
        value={query}
        onChange={handleInputChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
        leftIcon={
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        }
        rightIcon={
          isSearching ? (
            <div className="animate-spin h-4 w-4 border-2 border-surface-500 border-t-primary-500 rounded-full" />
          ) : query ? (
            <button
              onClick={() => {
                setQuery('');
                setResults([]);
                setHasSearched(false);
              }}
              className="text-surface-400 hover:text-surface-200"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : null
        }
      />

      {/* Results */}
      {results.length > 0 && (
        <div className="mt-4 space-y-3">
          {results.map((profile) => (
            <div
              key={profile.id}
              onClick={() => onSelectUser?.(profile)}
              className={onSelectUser ? 'cursor-pointer' : undefined}
            >
              <ProfileCard
                profile={profile}
                variant="compact"
              />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {hasSearched && results.length === 0 && query.length >= 2 && (
        <div className="mt-8 text-center text-surface-400">
          <p className="text-4xl mb-3">🔍</p>
          <p>No users found for &quot;{query}&quot;</p>
          <p className="text-sm mt-1">Try a different search term</p>
        </div>
      )}

      {/* Hint */}
      {!hasSearched && !query && (
        <div className="mt-8 text-center text-surface-400">
          <p className="text-4xl mb-3">👥</p>
          <p>Search for other lifters</p>
          <p className="text-sm mt-1">Find friends by username or name</p>
        </div>
      )}
    </div>
  );
}
