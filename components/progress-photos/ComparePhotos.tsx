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

import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Button } from '@/components/ui';
import { kgToLbs } from '@/lib/utils';
import {
  buildShareCard,
  shareOrDownloadCard,
  IDENTITY_ALIGN,
  type PhotoAlign,
} from '@/lib/images/shareCard';
import {
  OverlayView,
  PhotoPane,
  WipeView,
  type AlignTarget,
} from '@/components/progress-photos/CompareOverlay';
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

/** Reset a photo's alignment whenever the resolved photo id changes. */
function useResetAlignOnPhotoChange(
  photoId: string | null,
  setAlign: (align: PhotoAlign) => void
) {
  const prevIdRef = useRef(photoId);
  useEffect(() => {
    if (prevIdRef.current !== photoId) {
      prevIdRef.current = photoId;
      setAlign(IDENTITY_ALIGN);
    }
  }, [photoId, setAlign]);
}

/**
 * Selected pair + per-photo alignment. Alignment belongs to a specific photo,
 * and the resolved photo can change without a picker event (the fallback
 * resolves to newest/oldest, so adding a photo re-targets `after`) — so
 * alignment resets track the RESOLVED photo id.
 */
function useComparePair(
  chronological: ProgressPhoto[],
  initialBeforeId: string | undefined,
  initialAfterId: string | undefined
) {
  const [beforeId, setBeforeId] = useState<string | null>(null);
  const [afterId, setAfterId] = useState<string | null>(null);
  const [beforeAlign, setBeforeAlign] = useState<PhotoAlign>(IDENTITY_ALIGN);
  const [afterAlign, setAfterAlign] = useState<PhotoAlign>(IDENTITY_ALIGN);

  const { before, after } = resolvePair(
    chronological,
    beforeId ?? initialBeforeId,
    afterId ?? initialAfterId
  );
  useResetAlignOnPhotoChange(before?.id ?? null, setBeforeAlign);
  useResetAlignOnPhotoChange(after?.id ?? null, setAfterAlign);

  const changeAlign = (target: AlignTarget, align: PhotoAlign) => {
    if (target === 'before') setBeforeAlign(align);
    else setAfterAlign(align);
  };
  const resetAligns = () => {
    setBeforeAlign(IDENTITY_ALIGN);
    setAfterAlign(IDENTITY_ALIGN);
  };

  return {
    before,
    after,
    beforeValue: before?.id ?? '',
    afterValue: after?.id ?? '',
    setBeforeId,
    setAfterId,
    beforeAlign,
    afterAlign,
    changeAlign,
    resetAligns,
  };
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

  const [mode, setMode] = useState<CompareMode>('side');
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const {
    before,
    after,
    beforeValue,
    afterValue,
    setBeforeId,
    setAfterId,
    beforeAlign,
    afterAlign,
    changeAlign,
    resetAligns,
  } = useComparePair(chronological, initialBeforeId, initialAfterId);

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
            value={beforeValue}
            photos={chronological}
            units={units}
            onChange={setBeforeId}
          />
          <PhotoSelect
            label="After"
            value={afterValue}
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
