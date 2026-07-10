'use client';

import { useState, type ReactNode } from 'react';
import { getYouTubeThumbnailUrl, getYouTubeEmbedUrl } from '@/lib/youtube';

/**
 * Facade-first YouTube embed for curated exercise demos.
 *
 * 1. On render, shows ONLY the thumbnail (`i.ytimg.com/.../hqdefault.jpg`) with
 *    a centered play button — no YouTube iframe is loaded, keeping the detail
 *    sheet fast.
 * 2. On tap, swaps in a privacy-enhanced `youtube-nocookie.com` iframe with
 *    `autoplay=1&playsinline=1` (user-initiated, so WKWebView plays inline).
 * 3. If the thumbnail 404s or the iframe errors (deleted video / embedding
 *    disabled), renders `fallback` (the MuscleWiki demo) instead.
 */
interface YouTubeEmbedProps {
  videoId: string;
  title?: string;
  /** Rendered when the thumbnail or embed fails (e.g. the MuscleWiki demo). */
  fallback?: ReactNode;
}

export function YouTubeEmbed({ videoId, title = 'Exercise video', fallback = null }: YouTubeEmbedProps) {
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  // Thumbnail 404 or embed error → fall back to the MuscleWiki demo.
  if (failed) return <>{fallback}</>;

  return (
    <div className="space-y-1">
      <div className="relative rounded-lg overflow-hidden bg-surface-900 border border-surface-700 aspect-video">
        {playing ? (
          <iframe
            src={getYouTubeEmbedUrl(videoId)}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            className="absolute inset-0 w-full h-full"
            onError={() => setFailed(true)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group absolute inset-0 w-full h-full"
            aria-label={`Play ${title}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getYouTubeThumbnailUrl(videoId)}
              alt={title}
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
              onError={() => setFailed(true)}
            />
            {/* Centered play button overlay */}
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex items-center justify-center w-16 h-16 rounded-full bg-black/60 group-hover:bg-black/75 transition-colors">
                <svg className="w-7 h-7 translate-x-0.5 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </span>
          </button>
        )}
        <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/60 rounded text-xs text-surface-300 pointer-events-none">
          YouTube
        </div>
      </div>
    </div>
  );
}
