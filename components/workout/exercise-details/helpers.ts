import type { Exercise } from '@/types/schema';

/**
 * Get a property value from either camelCase or snake_case — exercise rows
 * arrive in both shapes depending on the query path.
 */
export function getExerciseProp(exercise: Exercise, camelKey: string, snakeKey: string): any {
  const camelValue = (exercise as any)[camelKey];
  const snakeValue = (exercise as any)[snakeKey];
  let result = camelValue ?? snakeValue;

  // Video/image URL fields must be strings; nested query shapes occasionally
  // hand back an object here.
  if (
    (camelKey === 'demoGifUrl' || camelKey === 'youtubeVideoId' ||
      snakeKey === 'demo_gif_url' || snakeKey === 'youtube_video_id') &&
    result && typeof result === 'object' && !Array.isArray(result)
  ) {
    const nested = result as any;
    if (typeof nested.demo_gif_url === 'string') {
      result = nested.demo_gif_url;
    } else if (typeof nested.demoGifUrl === 'string') {
      result = nested.demoGifUrl;
    } else if (typeof nested.youtube_video_id === 'string') {
      result = nested.youtube_video_id;
    } else if (typeof nested.youtubeVideoId === 'string') {
      result = nested.youtubeVideoId;
    } else {
      console.warn(`[getExerciseProp] Expected string but got object for ${camelKey}/${snakeKey}:`, result);
      result = null;
    }
  }

  return result;
}

export function getTierBadgeClasses(tier: string): string {
  switch (tier) {
    case 'S':
      return 'bg-gradient-to-r from-amber-500 to-yellow-400 text-black';
    case 'A':
      return 'bg-emerald-500/30 text-emerald-400';
    case 'B':
      return 'bg-blue-500/30 text-blue-400';
    case 'C':
      return 'bg-surface-600 text-surface-400';
    default:
      return 'bg-surface-700 text-surface-500';
  }
}

/** "Jun 12, 2026" style label for session/record dates. */
export function formatDetailDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
