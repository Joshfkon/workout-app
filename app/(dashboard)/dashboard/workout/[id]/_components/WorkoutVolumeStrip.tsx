'use client';

/**
 * WorkoutVolumeStrip.tsx
 *
 * The compact "where am I on volume?" strip under the workout header. For every
 * coarse muscle this session trains it shows the rolling-7-day set total
 * (history + sets logged so far today) positioned in that muscle's MEV–MRV
 * band, with a zone-colored mini bar, a readiness status dot next to the name
 * (green ready / amber part-recovered / red just-trained) and a "Ready" /
 * "~Nh" recovery ETA in the band row. Tapping any chip opens the full
 * "What to train" sheet for the per-muscle breakdown + recovery.
 *
 * Purely presentational — all data comes from useWorkoutMuscleVolume, which
 * shares the readiness sheet's cached history query and volume model so the
 * numbers here can never disagree with the sheet.
 */

import {
  zoneBandLabel,
  zoneBarClass,
  zoneTextClass,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import {
  READINESS_AMBER_THRESHOLD,
  READINESS_READY_THRESHOLD,
} from '@/app/(dashboard)/dashboard/workout/[id]/_lib/readiness';
import type { WorkoutMuscleVolumeRow } from '@/hooks/useWorkoutMuscleVolume';

interface WorkoutVolumeStripProps {
  rows: WorkoutMuscleVolumeRow[];
  /** Cold-start: history still resolving, so weekly totals aren't final yet. */
  isLoading: boolean;
  /** Opens the full volume + recovery sheet ("What to train"). */
  onOpenDetail: () => void;
}

/** Fill fraction within the band scale (MRV sits at ~83%, headroom for overrun). */
function barFillPct(sets: number, mrv: number): number {
  const maxDisplay = mrv * 1.2;
  if (maxDisplay <= 0) return 0;
  return Math.min(100, Math.max(0, (sets / maxDisplay) * 100));
}

/** Status-dot colour for a readiness score (green / amber / red). */
function readinessDotClass(readiness: number): string {
  if (readiness >= READINESS_READY_THRESHOLD) return 'bg-success-500';
  if (readiness >= READINESS_AMBER_THRESHOLD) return 'bg-warning-500';
  return 'bg-danger-500';
}

/** "~{N}h" hours label for the not-ready microcopy (never "~0h"). */
function readyInLabel(readyInHours: number): string {
  return `~${Math.max(1, Math.ceil(readyInHours))}h`;
}

export function WorkoutVolumeStrip({ rows, isLoading, onOpenDetail }: WorkoutVolumeStripProps) {
  if (rows.length === 0) return null;

  return (
    <div className="-mt-1" data-testid="workout-volume-strip">
      <div className="flex items-center justify-between px-0.5 mb-1.5">
        <p className="text-[11px] uppercase tracking-wide text-surface-500">
          Weekly sets · MEV–MRV
        </p>
        <button
          onClick={onOpenDetail}
          className="text-[11px] font-medium text-primary-400 hover:text-primary-300"
          data-testid="workout-volume-strip-details"
        >
          Details
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
        {rows.map((row) => (
          <button
            key={row.key}
            onClick={onOpenDetail}
            className="flex-shrink-0 snap-start w-[104px] text-left rounded-lg border border-surface-800 bg-surface-900/60 px-2.5 py-2 hover:border-surface-700 transition-colors"
            data-testid={`workout-volume-chip-${row.muscle}`}
            aria-label={`${row.displayName}: ${row.sets} weekly sets, ${zoneBandLabel(row.band)}, ${
              row.readyInHours <= 0 ? 'ready' : `ready in ${readyInLabel(row.readyInHours)}`
            }`}
          >
            <div className="flex items-baseline justify-between gap-1">
              <span className="flex items-center gap-1.5 min-w-0">
                <span
                  className={`h-[9px] w-[9px] flex-shrink-0 rounded-full ${
                    isLoading ? 'bg-surface-700' : readinessDotClass(row.readiness)
                  }`}
                  data-testid={`workout-volume-readiness-dot-${row.muscle}`}
                  aria-hidden
                />
                <span className="text-xs font-medium text-surface-200 truncate">{row.displayName}</span>
              </span>
              {isLoading ? (
                <span className="inline-block h-3 w-4 rounded bg-surface-700 animate-pulse" aria-hidden />
              ) : (
                <span
                  className={`text-sm font-semibold tabular-nums ${zoneTextClass(row.zone, row.sets)}`}
                  data-testid={`workout-volume-sets-${row.muscle}`}
                >
                  {row.sets}
                </span>
              )}
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-surface-800 overflow-hidden">
              {!isLoading && (
                <div
                  className={`h-full rounded-full ${zoneBarClass(row.zone, row.sets)}`}
                  style={{ width: `${barFillPct(row.sets, row.band.mrv)}%` }}
                />
              )}
            </div>
            <p className="mt-1 flex items-baseline justify-between gap-1 text-[10px] tabular-nums">
              <span className="text-surface-500">
                {row.band.mev}–{row.band.mrv}
              </span>
              {!isLoading &&
                (row.readyInHours <= 0 ? (
                  <span
                    className="font-semibold text-success-400"
                    data-testid={`workout-volume-readiness-${row.muscle}`}
                  >
                    Ready
                  </span>
                ) : (
                  <span
                    className="text-surface-500"
                    data-testid={`workout-volume-readiness-${row.muscle}`}
                  >
                    {readyInLabel(row.readyInHours)}
                  </span>
                ))}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

export default WorkoutVolumeStrip;
