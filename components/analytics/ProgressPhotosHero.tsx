'use client';

/**
 * Progress Photos hero section for the Body tab on Analytics.
 * Shows latest photos in a horizontal strip with quick stats and CTAs
 * for Compare, Timelapse, and Add Photo. Makes photos feel like a
 * first-class part of Progress instead of a buried section.
 */

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, Button } from '@/components/ui';
import type { ProgressPhoto } from '@/types/schema';

interface ProgressPhotosHeroProps {
  /** Recent photos (already sorted newest-first) */
  photos: ProgressPhoto[];
  /** photo id -> signed URL */
  photoUrls: Record<string, string>;
  /** Display units */
  units: 'kg' | 'lb';
  weightUnit: string;
  /** Format weight for display */
  displayWeight: (kg: number) => string;
  /** Callbacks for CTAs */
  onCompare?: () => void;
  onTimelapse?: () => void;
  onAddPhoto?: () => void;
}

function formatDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function ProgressPhotosHero({
  photos,
  photoUrls,
  units,
  weightUnit,
  displayWeight,
  onCompare,
  onTimelapse,
  onAddPhoto,
}: ProgressPhotosHeroProps) {
  const recentPhotos = photos.slice(0, 4);
  const latest = photos[0];

  // Empty state with strong CTA
  if (photos.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Progress Photos</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-primary-500/10 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-primary-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-surface-200 mb-1">
              Start Tracking Your Visual Progress
            </h3>
            <p className="text-xs text-surface-400 mb-4 max-w-sm mx-auto">
              Photos are the most honest progress tracker. Take them in consistent lighting
              and poses to see changes the scale might miss.
            </p>
            <Button size="sm" onClick={onAddPhoto}>
              Take Your First Photo
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <CardTitle>Progress Photos</CardTitle>
            {latest && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-surface-400">
                <span>{formatDate(latest.photoDate)}</span>
                {latest.weightKg != null && (
                  <>
                    <span>•</span>
                    <span className="font-medium text-surface-300">
                      {displayWeight(latest.weightKg)}
                    </span>
                  </>
                )}
                {latest.bodyFatPercent != null && (
                  <>
                    <span>•</span>
                    <span className="font-medium text-surface-300">
                      {latest.bodyFatPercent}% BF
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
          <Link href="/dashboard/progress-photos">
            <Button variant="ghost" size="sm">
              View All →
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Photo strip */}
          <div className="grid grid-cols-4 gap-2">
            {recentPhotos.map((photo) => {
              const url = photoUrls[photo.id];
              return (
                <Link key={photo.id} href="/dashboard/progress-photos">
                  <div className="aspect-[3/4] rounded-lg overflow-hidden bg-surface-800 ring-1 ring-surface-700 hover:ring-primary-500 transition-shadow">
                    {url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={url}
                        alt={`Progress photo from ${formatDate(photo.photoDate)}`}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="w-5 h-5 border-2 border-surface-600 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onAddPhoto} className="flex-1 sm:flex-none">
              + Add Photo
            </Button>
            {photos.length >= 2 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={onCompare}
                className="flex-1 sm:flex-none"
              >
                Compare
              </Button>
            )}
            {photos.length >= 3 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={onTimelapse}
                className="flex-1 sm:flex-none"
              >
                Timelapse
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
