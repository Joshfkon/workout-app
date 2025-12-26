/**
 * Social Features Utilities
 *
 * Utilities for user profiles, usernames, and social interactions.
 */

// Reserved usernames that cannot be used (must match database)
const RESERVED_USERNAMES = new Set([
  'admin',
  'hypertrack',
  'support',
  'help',
  'api',
  'www',
  'app',
  'dashboard',
  'profile',
  'settings',
  'workout',
  'workouts',
  'exercise',
  'exercises',
  'feed',
  'leaderboard',
  'leaderboards',
  'notifications',
  'messages',
  'search',
  'explore',
  'null',
  'undefined',
  'anonymous',
]);

export interface UsernameValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validate a username for profile creation
 *
 * Rules:
 * - 3-30 characters
 * - Alphanumeric and underscores only
 * - Must start with a letter
 * - Cannot end with underscore
 * - No consecutive underscores
 * - Not a reserved username
 * - Case-insensitive uniqueness (handled at DB level)
 */
export function validateUsername(username: string): UsernameValidationResult {
  const trimmed = username.trim();

  // Length check
  if (trimmed.length < 3) {
    return { isValid: false, error: 'Username must be at least 3 characters' };
  }
  if (trimmed.length > 30) {
    return { isValid: false, error: 'Username must be 30 characters or less' };
  }

  // Character check (alphanumeric and underscores)
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return { isValid: false, error: 'Username can only contain letters, numbers, and underscores' };
  }

  // Must start with a letter
  if (!/^[a-zA-Z]/.test(trimmed)) {
    return { isValid: false, error: 'Username must start with a letter' };
  }

  // Cannot end with underscore
  if (trimmed.endsWith('_')) {
    return { isValid: false, error: 'Username cannot end with an underscore' };
  }

  // No consecutive underscores
  if (/__/.test(trimmed)) {
    return { isValid: false, error: 'Username cannot have consecutive underscores' };
  }

  // Reserved username check
  if (RESERVED_USERNAMES.has(trimmed.toLowerCase())) {
    return { isValid: false, error: 'This username is not available' };
  }

  return { isValid: true };
}

/**
 * Normalize username for comparison (lowercase)
 */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/**
 * Generate username suggestions from email or name
 */
export function generateUsernameSuggestions(
  email?: string,
  displayName?: string
): string[] {
  const suggestions: string[] = [];
  const usedBase = new Set<string>();

  const addSuggestion = (base: string) => {
    // Clean the base string
    const cleaned = base
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 20);

    if (cleaned.length >= 3 && !usedBase.has(cleaned)) {
      usedBase.add(cleaned);
      suggestions.push(cleaned);

      // Add variations with numbers
      const randomNum = Math.floor(Math.random() * 99) + 1;
      suggestions.push(`${cleaned}${randomNum}`);
      suggestions.push(`${cleaned}_fit`);
    }
  };

  // From display name
  if (displayName) {
    const parts = displayName.split(/\s+/);
    if (parts.length >= 1) {
      addSuggestion(parts[0]);
    }
    if (parts.length >= 2) {
      addSuggestion(`${parts[0]}${parts[1][0]}`);
      addSuggestion(`${parts[0]}_${parts[1]}`);
    }
  }

  // From email
  if (email) {
    const emailUsername = email.split('@')[0];
    addSuggestion(emailUsername);
  }

  // Filter out reserved and return unique
  return suggestions
    .filter((s) => validateUsername(s).isValid)
    .slice(0, 5);
}

/**
 * Format follower/following count for display
 * e.g., 1234 -> "1.2K", 1234567 -> "1.2M"
 */
export function formatSocialCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return count.toString();
}

/**
 * Get initials from display name or username
 */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/**
 * Format relative time for activity feed
 * e.g., "2 hours ago", "3 days ago"
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffSeconds < 60) {
    return 'just now';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  if (diffWeeks < 4) {
    return `${diffWeeks}w ago`;
  }
  if (diffMonths < 12) {
    return `${diffMonths}mo ago`;
  }

  // For older dates, show the actual date
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

/**
 * Get color for reaction type
 */
export function getReactionColor(type: 'like' | 'fire' | 'muscle' | 'clap'): string {
  switch (type) {
    case 'like':
      return 'text-red-500';
    case 'fire':
      return 'text-orange-500';
    case 'muscle':
      return 'text-blue-500';
    case 'clap':
      return 'text-yellow-500';
    default:
      return 'text-gray-500';
  }
}

/**
 * Get emoji for reaction type
 */
export function getReactionEmoji(type: 'like' | 'fire' | 'muscle' | 'clap'): string {
  switch (type) {
    case 'like':
      return '❤️';
    case 'fire':
      return '🔥';
    case 'muscle':
      return '💪';
    case 'clap':
      return '👏';
    default:
      return '👍';
  }
}

/**
 * Generate a profile URL path
 */
export function getProfileUrl(username: string): string {
  return `/profile/${encodeURIComponent(username)}`;
}

/**
 * Generate a shareable profile link
 */
export function getProfileShareUrl(username: string, baseUrl?: string): string {
  const base = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/profile/${encodeURIComponent(username)}`;
}
