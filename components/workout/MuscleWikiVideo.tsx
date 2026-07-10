'use client';

/**
 * MuscleWiki demo renderer — the original inline video/GIF demo, extracted so
 * it can be reused as the fallback for {@link YouTubeEmbed} when a curated
 * YouTube video is missing or fails to load.
 *
 * `src` is the exercise's `demoGifUrl` (a local /exercise-demos/<slug>.gif|.mp4
 * path or a remote URL). Behaviour is unchanged from the previous inline
 * implementation in ExerciseDetailsModal.
 */
interface MuscleWikiVideoProps {
  src: string;
  name: string;
}

export function MuscleWikiVideo({ src, name }: MuscleWikiVideoProps) {
  const isVideo = src.endsWith('.mp4') || src.endsWith('.webm') || src.endsWith('.mov');

  return (
    <div className="relative rounded-lg overflow-hidden bg-surface-900 border border-surface-700">
      {isVideo ? (
        <video
          src={src}
          className="w-full h-auto max-h-64 object-contain"
          controls
          loop
          muted
          playsInline
          onError={(e) => {
            console.error('[MuscleWikiVideo] Failed to load video:', src, e);
            (e.target as HTMLVideoElement).style.display = 'none';
          }}
        >
          Your browser does not support the video tag.
        </video>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`${name} demonstration`}
          className="w-full h-auto max-h-64 object-contain"
          loading="lazy"
          onError={(e) => {
            console.error('[MuscleWikiVideo] Failed to load image:', src, e);
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/60 rounded text-xs text-surface-300">
        MuscleWiki
      </div>
    </div>
  );
}
