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
import { buildShareCard, shareOrDownloadCard } from '@/lib/images/shareCard';
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

function formatWeightIn(units: 'kg' | 'lb', kg: number): string {
  return units === 'lb' ? `${kgToLbs(kg).toFixed(1)} lbs` : `${kg.toFixed(1)} kg`;
}

function buildDeltaCaption(
  before: ProgressPhoto,
  after: ProgressPhoto,
  units: 'kg' | 'lb'
): string {
  const parts: string[] = [];
  parts.push(`${Math.abs(daysBetween(before.photoDate, after.photoDate))} days apart`);
  if (before.weightKg != null && after.weightKg != null) {
    const deltaKg = after.weightKg - before.weightKg;
    parts.push(`${deltaKg >= 0 ? '+' : '−'}${formatWeightIn(units, Math.abs(deltaKg))}`);
  }
  if (before.bodyFatPercent != null && after.bodyFatPercent != null) {
    const deltaBf = after.bodyFatPercent - before.bodyFatPercent;
    parts.push(`${deltaBf >= 0 ? '+' : '−'}${Math.abs(deltaBf).toFixed(1)}% BF`);
  }
  return parts.join(' · ');
}

/** Resolve the selected pair, defaulting to oldest vs newest. */
function resolvePair(
  chronological: ProgressPhoto[],
  beforeId: string | undefined,
  afterId: string | undefined
): { before: ProgressPhoto | null; after: ProgressPhoto | null } {
  const before =
    chronological.find((p) => p.id === beforeId) ?? chronological[0] ?? null;
  const after =
    chronological.find((p) => p.id === afterId) ??
    chronological[chronological.length - 1] ??
    null;
  return { before, after };
}

function PhotoPane({
  url,
  alt,
  caption,
}: {
  url: string | undefined;
  alt: string;
  caption: string | null;
}) {
  return (
    <div className="space-y-1">
      <div className="aspect-[3/4] rounded-lg overflow-hidden bg-surface-900 ring-1 ring-surface-700">
        {url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={url} alt={alt} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-surface-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
      {caption && <p className="text-xs text-center text-surface-400">{caption}</p>}
    </div>
  );
}

function WipeView({
  beforeUrl,
  afterUrl,
}: {
  beforeUrl: string | undefined;
  afterUrl: string | undefined;
}) {
  const [wipePercent, setWipePercent] = useState(50);
  return (
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
  );
}

function OverlayView({
  beforeUrl,
  afterUrl,
}: {
  beforeUrl: string | undefined;
  afterUrl: string | undefined;
}) {
  const [opacity, setOpacity] = useState(50);
  const [scale, setScale] = useState(100);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset({ x: drag.baseX + (e.clientX - drag.startX), y: drag.baseY + (e.clientY - drag.startY) });
  };
  const handlePointerUp = () => {
    dragRef.current = null;
  };

  return (
    <div className="space-y-2">
      <div
        className="relative aspect-[3/4] max-h-[55vh] mx-auto rounded-lg overflow-hidden bg-surface-900 ring-1 ring-surface-700 select-none touch-none cursor-move"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
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
              opacity: opacity / 100,
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale / 100})`,
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
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
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
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
            className="flex-1 accent-primary-500"
            aria-label="After photo scale"
          />
        </label>
        <div className="flex items-center justify-between">
          <p className="text-xs text-surface-500">Drag the image to line up the two poses.</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setScale(100);
              setOffset({ x: 0, y: 0 });
            }}
          >
            Reset
          </Button>
        </div>
      </div>
    </div>
  );
}

function PhotoSelect({
  label,
  value,
  photos,
  units,
  onChange,
}: {
  label: string;
  value: string;
  photos: ProgressPhoto[];
  units: 'kg' | 'lb';
  onChange: (id: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-surface-400">{label}</span>
      <select
        className="mt-1 w-full rounded-lg bg-surface-800 border border-surface-600 text-surface-100 text-sm px-3 py-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {photos.map((p) => (
          <option key={p.id} value={p.id}>
            {formatDate(p.photoDate)}
            {p.weightKg != null ? ` · ${formatWeightIn(units, p.weightKg)}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
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
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const { before, after } = resolvePair(
    chronological,
    beforeId ?? initialBeforeId,
    afterId ?? initialAfterId
  );

  const beforeUrl = before ? photoUrls[before.id] : undefined;
  const afterUrl = after ? photoUrls[after.id] : undefined;

  const deltaCaption =
    before && after ? buildDeltaCaption(before, after, units) : null;

  const handleShare = async () => {
    if (!before || !after || !beforeUrl || !afterUrl) return;
    setIsSharing(true);
    setShareError(null);
    try {
      const blob = await buildShareCard({
        beforeUrl,
        afterUrl,
        beforeLabel: formatDate(before.photoDate),
        afterLabel: formatDate(after.photoDate),
        caption: deltaCaption ?? 'Progress',
      });
      if (!blob) throw new Error('Could not build the image');
      await shareOrDownloadCard(blob, 'hypertrack-progress.jpg');
    } catch (err) {
      console.error('Share card failed:', err);
      setShareError("Couldn't create the share image — try again.");
    } finally {
      setIsSharing(false);
    }
  };

  if (chronological.length < 2) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Compare Photos" size="lg">
      <div className="space-y-4">
        {/* Photo pickers */}
        <div className="grid grid-cols-2 gap-3">
          <PhotoSelect
            label="Before"
            value={before?.id ?? ''}
            photos={chronological}
            units={units}
            onChange={setBeforeId}
          />
          <PhotoSelect
            label="After"
            value={after?.id ?? ''}
            photos={chronological}
            units={units}
            onChange={setAfterId}
          />
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
            <PhotoPane
              url={beforeUrl}
              alt="Before"
              caption={before ? formatDate(before.photoDate) : null}
            />
            <PhotoPane
              url={afterUrl}
              alt="After"
              caption={after ? formatDate(after.photoDate) : null}
            />
          </div>
        )}
        {mode === 'wipe' && <WipeView beforeUrl={beforeUrl} afterUrl={afterUrl} />}
        {mode === 'overlay' && <OverlayView beforeUrl={beforeUrl} afterUrl={afterUrl} />}

        {deltaCaption && (
          <p className="text-sm text-center text-surface-300 font-medium">{deltaCaption}</p>
        )}

        <Button
          variant="secondary"
          className="w-full"
          disabled={isSharing || !beforeUrl || !afterUrl}
          onClick={handleShare}
        >
          {isSharing ? 'Creating…' : 'Share Before / After'}
        </Button>
        {shareError && <p className="text-xs text-center text-red-400">{shareError}</p>}
      </div>
    </Modal>
  );
}
