/**
 * YouTube helpers for the curated exercise-demo embeds.
 *
 * We store only the 11-character video ID on the exercise
 * (`Exercise.youtubeVideoId`). These helpers parse an ID out of whatever the
 * user pastes into the Edit form (full URL, youtu.be short link, embed URL,
 * Shorts URL, or a bare ID with stray timestamp/params) and build the
 * thumbnail / privacy-enhanced embed URLs used by the facade component.
 */

// A YouTube video ID is exactly 11 chars from [A-Za-z0-9_-].
const YOUTUBE_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const PATH_ID_KEYS = ['embed', 'shorts', 'v', 'live'];

/**
 * Extract a YouTube video ID from a full URL, short link, or bare ID.
 * Returns null when nothing that looks like a valid ID can be found.
 *
 * Handles:
 *   - https://www.youtube.com/watch?v=XXXXXXXXXXX&t=30
 *   - https://youtu.be/XXXXXXXXXXX?t=30
 *   - https://www.youtube.com/embed/XXXXXXXXXXX
 *   - https://www.youtube.com/shorts/XXXXXXXXXXX
 *   - https://www.youtube-nocookie.com/embed/XXXXXXXXXXX
 *   - XXXXXXXXXXX (already a bare ID)
 */
export function parseYouTubeVideoId(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Already a bare video ID.
  if (YOUTUBE_ID_REGEX.test(trimmed)) return trimmed;

  let url: URL;
  try {
    // Tolerate URLs pasted without a scheme (e.g. "youtu.be/XXXX").
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();

  // youtu.be/<id>
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id && YOUTUBE_ID_REGEX.test(id) ? id : null;
  }

  // youtube.com / youtube-nocookie.com / m.youtube.com and subdomains.
  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host.endsWith('.youtube.com')) {
    // watch?v=<id>
    const vParam = url.searchParams.get('v');
    if (vParam && YOUTUBE_ID_REGEX.test(vParam)) return vParam;

    // /embed/<id>, /shorts/<id>, /v/<id>, /live/<id>
    const segments = url.pathname.split('/').filter(Boolean);
    const idx = segments.findIndex((s) => PATH_ID_KEYS.includes(s.toLowerCase()));
    if (idx !== -1) {
      const candidate = segments[idx + 1];
      if (candidate && YOUTUBE_ID_REGEX.test(candidate)) return candidate;
    }
  }

  return null;
}

/** Thumbnail (facade) URL for a video ID. 404s for deleted/invalid videos. */
export function getYouTubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/** Privacy-enhanced, inline-autoplay embed URL loaded once the facade is tapped. */
export function getYouTubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1`;
}
