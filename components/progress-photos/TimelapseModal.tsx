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

  // Restart from the beginning each time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setIndex(0);
      setIsPlaying(frames.length > 1);
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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Timelapse" size="lg">
      <div className="space-y-3">
        <div className="relative aspect-[3/4] max-h-[60vh] mx-auto rounded-lg overflow-hidden bg-surface-900 ring-1 ring-surface-700">
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
            <p className="text-sm font-medium text-white">
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
            className="flex-1 accent-primary-500"
            aria-label="Scrub through photos"
          />
          <span className="text-xs text-surface-500 tabular-nums">
            {index + 1}/{frames.length}
          </span>
        </div>
      </div>
    </Modal>
  );
}
