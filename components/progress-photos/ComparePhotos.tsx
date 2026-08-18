'use client';

/**
 * Progress-photo comparison viewer: side-by-side, wipe slider, and
 * onion-skin overlay modes for any two photos. The overlay mode includes
 * manual alignment (drag + scale) since older photos were shot without the
 * ghost-overlay capture aid and rarely line up perfectly.
 */

import { useMemo, useRef, useState } from 'react';
import { Modal, Button } from '@/components/ui';
import { kgToLbs } from '@/lib/utils';
import type { ProgressPhoto } from '@/types/schema';

type CompareMode = 'side' | 'wipe' | 'overlay';

interface ComparePhotosProps {
  isOpen: boolean;
  onClose: () => void;
  /** Sorted newest-first, as the page already holds them. */
  photos: ProgressPhoto[];
  /** photo id -> signed URL */
  photoUrls: Record<string, string>;
  units: 'kg' | 'lb';
  /** Preselected pair (e.g. from tapping two photos); falls back to oldest vs newest. */
  initialBeforeId?: string;
  initialAfterId?: string;
}

function formatDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime();
  return Math.round(ms / 86_400_000);
}

export function ComparePhotos({
  isOpen,
  onClose,
  photos,
  photoUrls,
  units,
  initialBeforeId,
  initialAfterId,
}: ComparePhotosProps) {
  // photos is newest-first; chronological reads better in the pickers.
  const chronological = useMemo(() => [...photos].reverse(), [photos]);

  const [beforeId, setBeforeId] = useState<string | null>(null);
  const [afterId, setAfterId] = useState<string | null>(null);
  const [mode, setMode] = useState<CompareMode>('side');
  const [wipePercent, setWipePercent] = useState(50);
  const [overlayOpacity, setOverlayOpacity] = useState(50);
  const [overlayScale, setOverlayScale] = useState(100);
  const [overlayOffset, setOverlayOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null
  );

  const before =
    chronological.find((p) => p.id === (beforeId ?? initialBeforeId)) ?? chronological[0] ?? null;
  const after =
    chronological.find((p) => p.id === (afterId ?? initialAfterId)) ??
    chronological[chronological.length - 1] ??
    null;

  const beforeUrl = before ? photoUrls[before.id] : undefined;
  const afterUrl = after ? photoUrls[after.id] : undefined;

  const displayWeight = (kg: number) =>
    units === 'lb' ? `${kgToLbs(kg).toFixed(1)} lbs` : `${kg.toFixed(1)} kg`;

  const deltaCaption = useMemo(() => {
    if (!before || !after) return null;
    const parts: string[] = [];
    const days = daysBetween(before.photoDate, after.photoDate);
    parts.push(`${Math.abs(days)} days apart`);
    if (before.weightKg != null && after.weightKg != null) {
      const deltaKg = after.weightKg - before.weightKg;
      const display =
        units === 'lb' ? `${Math.abs(kgToLbs(deltaKg)).toFixed(1)} lbs` : `${Math.abs(deltaKg).toFixed(1)} kg`;
      parts.push(`${deltaKg >= 0 ? '+' : '−'}${display}`);
    }
    if (before.bodyFatPercent != null && after.bodyFatPercent != null) {
      const deltaBf = after.bodyFatPercent - before.bodyFatPercent;
      parts.push(`${deltaBf >= 0 ? '+' : '−'}${Math.abs(deltaBf).toFixed(1)}% BF`);
    }
    return parts.join(' · ');
  }, [before, after, units]);

  const resetAlignment = () => {
    setOverlayScale(100);
    setOverlayOffset({ x: 0, y: 0 });
  };

  const handleOverlayPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== 'overlay') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: overlayOffset.x,
      baseY: overlayOffset.y,
    };
  };

  const handleOverlayPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setOverlayOffset({
      x: drag.baseX + (e.clientX - drag.startX),
      y: drag.baseY + (e.clientY - drag.startY),
    });
  };

  const handleOverlayPointerUp = () => {
    dragRef.current = null;
  };

  const photoLabel = (p: ProgressPhoto) => {
    const bits = [formatDate(p.photoDate)];
    if (p.weightKg != null) bits.push(displayWeight(p.weightKg));
    return bits.join(' · ');
  };

  if (chronological.length < 2) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Compare Photos" size="lg">
      <div className="space-y-4">
        {/* Photo pickers */}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-surface-400">Before</span>
            <select
              className="mt-1 w-full rounded-lg bg-surface-800 border border-surface-600 text-surface-100 text-sm px-3 py-2"
              value={before?.id ?? ''}
              onChange={(e) => setBeforeId(e.target.value)}
            >
              {chronological.map((p) => (
                <option key={p.id} value={p.id}>
                  {photoLabel(p)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-surface-400">After</span>
            <select
              className="mt-1 w-full rounded-lg bg-surface-800 border border-surface-600 text-surface-100 text-sm px-3 py-2"
              value={after?.id ?? ''}
              onChange={(e) => setAfterId(e.target.value)}
            >
              {chronological.map((p) => (
                <option key={p.id} value={p.id}>
                  {photoLabel(p)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 rounded-lg bg-surface-800 p-1" role="tablist">
          {(
            [
              ['side', 'Side by side'],
              ['wipe', 'Slider'],
              ['overlay', 'Overlay'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
                mode === value
                  ? 'bg-surface-600 text-surface-100'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Viewer */}
        {mode === 'side' && (
          <div className="grid grid-cols-2 gap-2">
            {[
              { photo: before, url: beforeUrl },
              { photo: after, url: afterUrl },
            ].map(({ photo, url }, i) => (
              <div key={i} className="space-y-1">
                <div className="aspect-[3/4] rounded-lg overflow-hidden bg-surface-900 ring-1 ring-surface-700">
                  {url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={url}
                      alt={photo ? `Progress photo from ${formatDate(photo.photoDate)}` : ''}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="w-6 h-6 border-2 border-surface-600 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
                {photo && (
                  <p className="text-xs text-center text-surface-400">
                    {formatDate(photo.photoDate)}
                    {photo.weightKg != null && ` · ${displayWeight(photo.weightKg)}`}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {mode === 'wipe' && (
          <div className="space-y-2">
            <div className="relative aspect-[3/4] max-h-[55vh] mx-auto rounded-lg overflow-hidden bg-surface-900 ring-1 ring-surface-700 select-none">
              {afterUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={afterUrl}
                  alt="After"
                  className="absolute inset-0 w-full h-full object-cover"
                  draggable={false}
                />
              )}
              {beforeUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={beforeUrl}
                  alt="Before"
                  className="absolute inset-0 w-full h-full object-cover"
                  draggable={false}
                  style={{ clipPath: `inset(0 ${100 - wipePercent}% 0 0)` }}
                />
              )}
              {/* Divider line */}
              <div
                className="absolute inset-y-0 w-0.5 bg-white/80 shadow pointer-events-none"
                style={{ left: `${wipePercent}%` }}
              />
              <span className="absolute top-2 left-2 text-[10px] font-medium uppercase tracking-wide bg-black/60 text-white px-1.5 py-0.5 rounded">
                Before
              </span>
              <span className="absolute top-2 right-2 text-[10px] font-medium uppercase tracking-wide bg-black/60 text-white px-1.5 py-0.5 rounded">
                After
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={wipePercent}
              onChange={(e) => setWipePercent(Number(e.target.value))}
              className="w-full accent-primary-500"
              aria-label="Reveal before photo"
            />
          </div>
        )}

        {mode === 'overlay' && (
          <div className="space-y-2">
            <div
              className="relative aspect-[3/4] max-h-[55vh] mx-auto rounded-lg overflow-hidden bg-surface-900 ring-1 ring-surface-700 select-none touch-none cursor-move"
              onPointerDown={handleOverlayPointerDown}
              onPointerMove={handleOverlayPointerMove}
              onPointerUp={handleOverlayPointerUp}
              onPointerCancel={handleOverlayPointerUp}
            >
              {beforeUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={beforeUrl}
                  alt="Before"
                  className="absolute inset-0 w-full h-full object-cover"
                  draggable={false}
                />
              )}
              {afterUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={afterUrl}
                  alt="After"
                  className="absolute inset-0 w-full h-full object-cover"
                  draggable={false}
                  style={{
                    opacity: overlayOpacity / 100,
                    transform: `translate(${overlayOffset.x}px, ${overlayOffset.y}px) scale(${overlayScale / 100})`,
                  }}
                />
              )}
            </div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs text-surface-400">
                <span className="w-14">Opacity</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={overlayOpacity}
                  onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                  className="flex-1 accent-primary-500"
                  aria-label="After photo opacity"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-surface-400">
                <span className="w-14">Scale</span>
                <input
                  type="range"
                  min={70}
                  max={140}
                  value={overlayScale}
                  onChange={(e) => setOverlayScale(Number(e.target.value))}
                  className="flex-1 accent-primary-500"
                  aria-label="After photo scale"
                />
              </label>
              <div className="flex items-center justify-between">
                <p className="text-xs text-surface-500">Drag the image to line up the two poses.</p>
                <Button variant="secondary" size="sm" onClick={resetAlignment}>
                  Reset
                </Button>
              </div>
            </div>
          </div>
        )}

        {deltaCaption && (
          <p className="text-sm text-center text-surface-300 font-medium">{deltaCaption}</p>
        )}
      </div>
    </Modal>
  );
}
