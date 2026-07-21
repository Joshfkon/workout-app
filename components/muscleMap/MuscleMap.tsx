'use client';

import { memo } from 'react';
import {
  FRONT_REGIONS,
  BACK_REGIONS,
  VIEWBOX,
  type BodyView,
  type MuscleRegion,
} from '@/lib/muscleMap/paths';
import { REGION_TO_MUSCLE, type MuscleId } from '@/lib/muscleMap/taxonomy';
import type { MuscleMapData, MuscleMapDatum } from '@/lib/muscleMap/adapters';
import { rowFillClass } from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import { STANDARD_MUSCLE_DISPLAY_NAMES } from '@/types/schema';
import type { RecoveryStatus } from '@/services/muscleRecovery';

/**
 * MuscleMap — the reusable SVG body map (front/back anatomical views with
 * per-muscle colorable regions, artwork vendored in lib/muscleMap/paths.ts).
 *
 * This is a VIEW: it computes no numbers. Every surface feeds it via the
 * lib/muscleMap/adapters helpers from the exact model that surface already
 * renders (volume rows, readiness rows, the exercise record), so a region can
 * never disagree with a bar/row on the same screen.
 *
 * Modes:
 * - volume:    shared zone semantics via zoneFillClass (gray untrained, amber
 *              below MEV, green across the MEV–MRV band, red past MRV).
 * - recovery:  fresh green / recovering amber / fatigued gray, matching the
 *              readiness badges.
 * - highlight: primary muscle in full primary color, secondaries dimmed to
 *              their `value` opacity, everything else neutral.
 *
 * Regions with no data (and decorative regions — head, hands, knees, …)
 * render in a neutral theme-aware base tone. The map is a secondary,
 * glanceable representation: the bars/rows/chips beside it remain the primary
 * accessible UI, but every mapped path still carries an aria-label.
 */

export type MuscleMapMode = 'volume' | 'recovery' | 'highlight';

export interface MuscleMapProps {
  data: MuscleMapData;
  mode: MuscleMapMode;
  /** 'both' renders front + back side by side, scaled to the container. */
  view?: BodyView | 'both';
  /**
   * Tap handler (fires with the logical muscle id, e.g. 'quads'). Keep the
   * reference stable (useCallback) — it participates in path memoization.
   */
  onMuscleTap?: (muscleId: MuscleId) => void;
  /** Sizing/layout classes for the container (set a height, e.g. 'h-56'). */
  className?: string;
  'data-testid'?: string;
}

/** Neutral base tone for unmapped/no-data regions (theme-aware token). */
const BASE_FILL = 'fill-surface-800';

/** Recovery-status fills — same families as the readiness badge colors. */
const RECOVERY_FILL: Record<RecoveryStatus, string> = {
  fresh: 'fill-success-500',
  recovering: 'fill-warning-500',
  fatigued: 'fill-surface-600',
};

const RECOVERY_ARIA: Record<RecoveryStatus, string> = {
  fresh: 'fresh',
  recovering: 'recovering',
  fatigued: 'fatigued',
};

interface RegionPresentation {
  fillClass: string;
  fillOpacity?: number;
  /** Status half of the aria-label; null renders the neutral "no data". */
  ariaStatus: string | null;
}

function presentRegion(mode: MuscleMapMode, datum: MuscleMapDatum | undefined): RegionPresentation {
  if (!datum) return { fillClass: BASE_FILL, ariaStatus: null };

  if (mode === 'volume') {
    const zone = datum.zone ?? 'below_mev';
    const ariaStatus =
      zone === 'over_mrv'
        ? 'over recoverable volume'
        : zone === 'in_zone'
          ? datum.lagging
            ? 'in the volume zone, but a subdivision is below target'
            : 'in the optimal volume zone'
          : datum.value <= 0
            ? 'untrained this week'
            : 'below volume target';
    // Row-aware fill: a coarse-sourced region with a lagging subdivision
    // paints warning, matching the demoted bar on the same screen.
    return {
      fillClass: rowFillClass({ zone, sets: datum.value, laggingChildren: datum.lagging }),
      ariaStatus,
    };
  }

  if (mode === 'recovery') {
    if (!datum.status) return { fillClass: BASE_FILL, ariaStatus: null };
    return { fillClass: RECOVERY_FILL[datum.status], ariaStatus: RECOVERY_ARIA[datum.status] };
  }

  // highlight
  const primary = datum.value >= 1;
  return {
    fillClass: 'fill-primary-500',
    fillOpacity: primary ? 1 : datum.value,
    ariaStatus: primary ? 'primary muscle' : 'secondary muscle',
  };
}

interface RegionPathProps {
  region: MuscleRegion;
  muscle: MuscleId | null;
  fillClass: string;
  fillOpacity?: number;
  ariaStatus: string | null;
  onTap?: (muscleId: MuscleId) => void;
}

const RegionPath = memo(function RegionPath({
  region,
  muscle,
  fillClass,
  fillOpacity,
  ariaStatus,
  onTap,
}: RegionPathProps) {
  const tappable = Boolean(onTap && muscle);
  const label = muscle
    ? `${STANDARD_MUSCLE_DISPLAY_NAMES[muscle]}: ${ariaStatus ?? 'no data'}`
    : undefined;

  return (
    <path
      d={region.path}
      data-region={region.id}
      data-muscle={muscle ?? undefined}
      className={`${fillClass} transition-[fill] duration-200${tappable ? ' cursor-pointer' : ''}`}
      fillOpacity={fillOpacity}
      // Tap-target padding: a transparent stroke widens the hit area of thin
      // regions (erectors, obliques strips) without changing the artwork —
      // SVG's default pointer-events (visiblePainted) counts a transparent
      // (non-none) stroke as painted.
      stroke="transparent"
      strokeWidth={tappable ? 1.6 : 0}
      role={muscle ? (tappable ? 'button' : 'img') : undefined}
      aria-label={label}
      aria-hidden={muscle ? undefined : true}
      tabIndex={tappable ? 0 : undefined}
      onClick={tappable && muscle ? () => onTap?.(muscle) : undefined}
      onKeyDown={
        tappable && muscle
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onTap?.(muscle);
              }
            }
          : undefined
      }
    />
  );
});

function BodyFigure({
  view,
  data,
  mode,
  onMuscleTap,
}: {
  view: BodyView;
  data: MuscleMapData;
  mode: MuscleMapMode;
  onMuscleTap?: (muscleId: MuscleId) => void;
}) {
  const regions = view === 'front' ? FRONT_REGIONS : BACK_REGIONS;
  return (
    <svg
      viewBox={VIEWBOX[view]}
      className="h-full w-auto max-w-full"
      data-testid={`muscle-map-${view}`}
      role="group"
      aria-label={view === 'front' ? 'Front view' : 'Back view'}
    >
      {regions.map((region) => {
        const muscle = REGION_TO_MUSCLE.get(region.id) ?? null;
        const { fillClass, fillOpacity, ariaStatus } = presentRegion(
          mode,
          muscle ? data[muscle] : undefined
        );
        return (
          <RegionPath
            key={region.id}
            region={region}
            muscle={muscle}
            fillClass={fillClass}
            fillOpacity={fillOpacity}
            ariaStatus={ariaStatus}
            onTap={muscle ? onMuscleTap : undefined}
          />
        );
      })}
    </svg>
  );
}

export function MuscleMap({
  data,
  mode,
  view = 'both',
  onMuscleTap,
  className,
  'data-testid': testId = 'muscle-map',
}: MuscleMapProps) {
  const views: BodyView[] = view === 'both' ? ['front', 'back'] : [view];
  return (
    <div
      className={`flex items-stretch justify-center gap-3 ${className ?? ''}`}
      data-testid={testId}
    >
      {views.map((v) => (
        <BodyFigure key={v} view={v} data={data} mode={mode} onMuscleTap={onMuscleTap} />
      ))}
    </div>
  );
}

export default MuscleMap;
