'use client';

/**
 * Alignment primitives + Overlay mode for the progress-photo compare viewer.
 * Alignment is frame-relative (see PhotoAlign in lib/images/shareCard) so the
 * same transform renders identically in every compare mode and the share card.
 */

import { useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { IDENTITY_ALIGN, type PhotoAlign } from '@/lib/images/shareCard';

export type AlignTarget = 'before' | 'after';

export function clampAlign(a: PhotoAlign): PhotoAlign {
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

export function AlignedImage({
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

export function PhotoPane({
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

export function WipeView({
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

export function OverlayView({
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
