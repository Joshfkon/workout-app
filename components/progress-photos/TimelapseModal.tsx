'use client';

/**
 * Timelapse playback through all progress photos in chronological order,
 * with play/pause and a scrubber. Frames are the already-signed photo URLs;
 * everything runs client-side.
 */

import { useEffect, useMemo, useState } from 'react';
import { Modal, Button } from '@/components/ui';
import { kgToLbs } from '@/lib/utils';
import type { ProgressPhoto } from '@/types/schema';

const FRAME_MS = 700;

interface TimelapseModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Sorted newest-first, as the page already holds them. */
  photos: ProgressPhoto[];
  photoUrls: Record<string, string>;
  units: 'kg' | 'lb';
}

function formatDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function TimelapseModal({ isOpen, onClose, photos, photoUrls, units }: TimelapseModalProps) {
  const frames = useMemo(
    () => [...photos].reverse().filter((p) => photoUrls[p.id]),
    [photos, photoUrls]
  );
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Restart from the beginning each time the modal opens, but start paused
  // to give context (user can see first photo date/stats before auto-advance)
  useEffect(() => {
    if (isOpen) {
      setIndex(0);
      setIsPlaying(false); // Start paused for user to review first
    } else {
      setIsPlaying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isPlaying || frames.length < 2) return;
    const timer = setInterval(() => {
      setIndex((current) => {
        if (current >= frames.length - 1) {
          setIsPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, [isPlaying, frames.length]);

  const current = frames[Math.min(index, frames.length - 1)];
  if (!current) return null;

  const displayWeight = (kg: number) =>
    units === 'lb' ? `${kgToLbs(kg).toFixed(1)} lbs` : `${kg.toFixed(1)} kg`;

  const firstDate = frames[0] ? formatDate(frames[0].photoDate) : '';
  const lastDate = frames[frames.length - 1]
    ? formatDate(frames[frames.length - 1].photoDate)
    : '';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Progress timelapse" size="lg">
      <div className="space-y-3">
        {/* Info banner with date range and photo count */}
        {frames.length > 0 && (
          <div className="rounded-lg bg-fill border border-sep px-3 py-2">
            <p className="text-caption text-ink-2 text-center">
              <span className="font-medium text-ink">{frames.length} photos</span>
              {firstDate && lastDate && firstDate !== lastDate && (
                <span> • {firstDate} to {lastDate}</span>
              )}
            </p>
          </div>
        )}
        <div className="relative aspect-[3/4] max-h-[60vh] mx-auto rounded-lg overflow-hidden bg-card ring-1 ring-sep">
          {/* Stack all frames; only the active one is visible. Keeps every
              image decoded so playback never flashes. */}
          {frames.map((photo, i) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={photo.id}
              src={photoUrls[photo.id]}
              alt={`Progress photo from ${formatDate(photo.photoDate)}`}
              className="absolute inset-0 w-full h-full object-cover"
              style={{ opacity: i === index ? 1 : 0 }}
            />
          ))}
          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-8">
            <p className="text-body font-medium text-white">
              {formatDate(current.photoDate)}
              {current.weightKg != null && ` · ${displayWeight(current.weightKg)}`}
              {current.bodyFatPercent != null && ` · ${current.bodyFatPercent}% BF`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (!isPlaying && index >= frames.length - 1) setIndex(0);
              setIsPlaying(!isPlaying);
            }}
            disabled={frames.length < 2}
          >
            {isPlaying ? 'Pause' : 'Play'}
          </Button>
          <input
            type="range"
            min={0}
            max={Math.max(0, frames.length - 1)}
            value={index}
            onChange={(e) => {
              setIsPlaying(false);
              setIndex(Number(e.target.value));
            }}
            className="flex-1 accent-action"
            aria-label="Scrub through photos"
          />
          <span className="text-caption text-ink-3 tabular-nums">
            {index + 1}/{frames.length}
          </span>
        </div>
      </div>
    </Modal>
  );
}
