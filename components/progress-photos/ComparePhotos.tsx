'use client';

/**
 * Progress-photo comparison viewer: side-by-side, wipe slider, and
 * onion-skin overlay modes for any two photos.
 *
 * Photos taken at different distances/framings rarely line up, so each photo
 * carries its own alignment (pan + zoom), edited in the Overlay mode by
 * dragging / pinching / the zoom slider. Alignment is stored as fractions of
 * the frame, so the SAME alignment applies identically in every mode and in
 * the exported share card.
 */

import { useMemo, useRef, useState } from 'react';
import { Modal, Button } from '@/components/ui';
import { kgToLbs } from '@/lib/utils';
import {
  buildShareCard,
  shareOrDownloadCard,
  IDENTITY_ALIGN,
  type PhotoAlign,
} from '@/lib/images/shareCard';
import type { ProgressPhoto } from '@/types/schema';

type CompareMode = 'side' | 'wipe' | 'overlay';
type AlignTarget = 'before' | 'after';

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

function clampAlign(a: PhotoAlign): PhotoAlign {
  return {
    scale: Math.min(2.5, Math.max(0.5, a.scale)),
    dx: Math.min(0.5, Math.max(-0.5, a.dx)),
    dy: Math.min(0.5, Math.max(-0.5, a.dy)),
  };
}

/**
 * CSS twin of the share-card canvas transform: translate is a fraction of the
 * frame, scale is about the frame center.
 */
function alignTransform(a: PhotoAlign): string {
  return `translate(${a.dx * 100}%, ${a.dy * 100}%) scale(${a.scale})`;
}

function AlignedImage({
  url,
  alt,
  align,
  style,
}: {
  url: string;
  alt: string;
  align: PhotoAlign;
  style?: React.CSSProperties;
}) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={url}
      alt={alt}
      draggable={false}
      className="absolute inset-0 w-full h-full object-cover"
      style={{ transform: alignTransform(align), ...style }}
    />
  );
}

function PhotoPane({
  url,
  alt,
  align,
  caption,
}: {
  url: string | undefined;
  alt: string;
  align: PhotoAlign;
  caption: string | null;
}) {
  return (
    <div className="space-y-1">
      <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-surface-900 ring-1 ring-surface-700">
        {url ? (
          <AlignedImage url={url} alt={alt} align={align} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
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
  beforeAlign,
  afterAlign,
}: {
  beforeUrl: string | undefined;
  afterUrl: string | undefined;
  beforeAlign: PhotoAlign;
  afterAlign: PhotoAlign;
}) {
  const [wipePercent, setWipePercent] = useState(50);
  return (
    <div className="space-y-2">
      <div className="relative aspect-[3/4] max-h-[55vh] mx-auto rounded-lg overflow-hidden bg-surface-900 ring-1 ring-surface-700 select-none">
        {afterUrl && <AlignedImage url={afterUrl} alt="After" align={afterAlign} />}
        {/* The clip lives on a wrapper so it doesn't move with the transform. */}
        {beforeUrl && (
          <div
            className="absolute inset-0 overflow-hidden"
            style={{ clipPath: `inset(0 ${100 - wipePercent}% 0 0)` }}
          >
            <AlignedImage url={beforeUrl} alt="Before" align={beforeAlign} />
          </div>
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
      <p className="text-xs text-center text-surface-500">
        Photos not lined up? Use Overlay to align them — it applies here too.
      </p>
    </div>
  );
}

interface GestureState {
  pointers: Map<number, { x: number; y: number }>;
  baseAlign: PhotoAlign;
  startCenter: { x: number; y: number };
  startDist: number;
}

function OverlayView({
  beforeUrl,
  afterUrl,
  beforeAlign,
  afterAlign,
  onChangeAlign,
  onResetAligns,
}: {
  beforeUrl: string | undefined;
  afterUrl: string | undefined;
  beforeAlign: PhotoAlign;
  afterAlign: PhotoAlign;
  onChangeAlign: (target: AlignTarget, align: PhotoAlign) => void;
  onResetAligns: () => void;
}) {
  const [opacity, setOpacity] = useState(50);
  const [target, setTarget] = useState<AlignTarget>('after');
  const containerRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<GestureState | null>(null);

  const targetAlign = target === 'before' ? beforeAlign : afterAlign;

  const gestureGeometry = (pointers: Map<number, { x: number; y: number }>) => {
    const pts = Array.from(pointers.values());
    const center = {
      x: pts.reduce((sum, p) => sum + p.x, 0) / pts.length,
      y: pts.reduce((sum, p) => sum + p.y, 0) / pts.length,
    };
    const dist =
      pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    return { center, dist };
  };

  const rebaseline = (pointers: Map<number, { x: number; y: number }>) => {
    const { center, dist } = gestureGeometry(pointers);
    gestureRef.current = {
      pointers,
      baseAlign: target === 'before' ? beforeAlign : afterAlign,
      startCenter: center,
      startDist: dist,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const pointers = gestureRef.current?.pointers ?? new Map();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    rebaseline(pointers);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!gesture || !rect || !gesture.pointers.has(e.pointerId)) return;
    gesture.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const { center, dist } = gestureGeometry(gesture.pointers);
    // Pan by the drag as a fraction of the frame; pinch scales around it.
    const next: PhotoAlign = {
      dx: gesture.baseAlign.dx + (center.x - gesture.startCenter.x) / rect.width,
      dy: gesture.baseAlign.dy + (center.y - gesture.startCenter.y) / rect.height,
      scale:
        gesture.startDist > 0 && dist > 0
          ? gesture.baseAlign.scale * (dist / gesture.startDist)
          : gesture.baseAlign.scale,
    };
    onChangeAlign(target, clampAlign(next));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const pointers = gestureRef.current?.pointers;
    if (!pointers) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) gestureRef.current = null;
    else rebaseline(pointers);
  };

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="relative aspect-[3/4] max-h-[55vh] mx-auto rounded-lg overflow-hidden bg-surface-900 ring-1 ring-surface-700 select-none touch-none cursor-move"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {beforeUrl && <AlignedImage url={beforeUrl} alt="Before" align={beforeAlign} />}
        {afterUrl && (
          <AlignedImage
            url={afterUrl}
            alt="After"
            align={afterAlign}
            style={{ opacity: opacity / 100 }}
          />
        )}
      </div>

      {/* Which photo the drag/pinch/zoom adjusts */}
      <div className="flex gap-1 rounded-lg bg-surface-800 p-1">
        {(['before', 'after'] as const).map((value) => (
          <button
            key={value}
            onClick={() => setTarget(value)}
            className={`flex-1 rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
              target === value
                ? 'bg-surface-600 text-surface-100'
                : 'text-surface-400 hover:text-surface-200'
            }`}
          >
            Adjust {value}
          </button>
        ))}
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
          <span className="w-14">Zoom</span>
          <input
            type="range"
            min={50}
            max={250}
            value={Math.round(targetAlign.scale * 100)}
            onChange={(e) =>
              onChangeAlign(target, clampAlign({ ...targetAlign, scale: Number(e.target.value) / 100 }))
            }
            className="flex-1 accent-primary-500"
            aria-label={`${target} photo zoom`}
          />
        </label>
        <div className="flex items-center justify-between">
          <p className="text-xs text-surface-500">
            Drag to move · pinch or zoom to resize. Applies to every view.
          </p>
          <Button variant="secondary" size="sm" onClick={onResetAligns}>
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
  const [beforeAlign, setBeforeAlign] = useState<PhotoAlign>(IDENTITY_ALIGN);
  const [afterAlign, setAfterAlign] = useState<PhotoAlign>(IDENTITY_ALIGN);
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

  const selectBefore = (id: string) => {
    setBeforeId(id);
    setBeforeAlign(IDENTITY_ALIGN);
  };
  const selectAfter = (id: string) => {
    setAfterId(id);
    setAfterAlign(IDENTITY_ALIGN);
  };
  const changeAlign = (target: AlignTarget, align: PhotoAlign) => {
    if (target === 'before') setBeforeAlign(align);
    else setAfterAlign(align);
  };
  const resetAligns = () => {
    setBeforeAlign(IDENTITY_ALIGN);
    setAfterAlign(IDENTITY_ALIGN);
  };

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
        beforeAlign,
        afterAlign,
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
            onChange={selectBefore}
          />
          <PhotoSelect
            label="After"
            value={after?.id ?? ''}
            photos={chronological}
            units={units}
            onChange={selectAfter}
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
              align={beforeAlign}
              caption={before ? formatDate(before.photoDate) : null}
            />
            <PhotoPane
              url={afterUrl}
              alt="After"
              align={afterAlign}
              caption={after ? formatDate(after.photoDate) : null}
            />
          </div>
        )}
        {mode === 'wipe' && (
          <WipeView
            beforeUrl={beforeUrl}
            afterUrl={afterUrl}
            beforeAlign={beforeAlign}
            afterAlign={afterAlign}
          />
        )}
        {mode === 'overlay' && (
          <OverlayView
            beforeUrl={beforeUrl}
            afterUrl={afterUrl}
            beforeAlign={beforeAlign}
            afterAlign={afterAlign}
            onChangeAlign={changeAlign}
            onResetAligns={resetAligns}
          />
        )}

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
