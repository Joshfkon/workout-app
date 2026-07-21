'use client';

/**
 * WorkoutVolumeStrip.tsx
 *
 * The compact "where am I on volume?" strip under the workout header. Each
 * card shows a muscle's rolling-7-day set total (history + sets logged so far
 * today) positioned in its MEV–MRV band, with a zone-colored mini bar, a
 * readiness status dot next to the name (green ready / amber part-recovered /
 * red just-trained) and a "Ready" / "~Nh" recovery ETA in the band row.
 *
 * By default only the muscles THIS session trains render; a trailing
 * "Show all (+N)" card appends the remaining groups (session muscles stay
 * first). The whole card row is also collapsible via the header chevron.
 * Both choices persist across sessions. Tapping any muscle chip opens the
 * full "What to train" sheet for the per-muscle breakdown + recovery.
 *
 * Purely presentational — all data comes from useWorkoutMuscleVolume, which
 * shares the readiness sheet's cached history query and volume model so the
 * numbers here can never disagree with the sheet.
 */

import { useState } from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import {
  groupZoneBandLabel,
  rowBarClass,
  rowTextClass,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import {
  READINESS_AMBER_THRESHOLD,
  READINESS_READY_THRESHOLD,
} from '@/app/(dashboard)/dashboard/workout/[id]/_lib/readiness';
import type { WorkoutMuscleVolumeRow } from '@/hooks/useWorkoutMuscleVolume';
import { formatEffectiveVolume } from '@/services/effectiveVolume';

interface WorkoutVolumeStripProps {
  rows: WorkoutMuscleVolumeRow[];
  /** Cold-start: history still resolving, so weekly totals aren't final yet. */
  isLoading: boolean;
  /** Opens the full volume + recovery sheet ("What to train"). */
  onOpenDetail: () => void;
}

/** Persisted collapse preference (a lasting UI choice, not per-day state). */
const COLLAPSED_STORAGE_KEY = 'workout-volume-strip-collapsed';
/** Persisted "show all muscle groups" preference. */
const SHOW_ALL_STORAGE_KEY = 'workout-volume-strip-show-all';

function readFlag(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // Storage unavailable — the toggle still works for this mount.
  }
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
  const [collapsed, setCollapsed] = useState(() => readFlag(COLLAPSED_STORAGE_KEY));
  const [showAll, setShowAll] = useState(() => readFlag(SHOW_ALL_STORAGE_KEY));

  if (rows.length === 0) return null;

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      writeFlag(COLLAPSED_STORAGE_KEY, !prev);
      return !prev;
    });
  };
  const toggleShowAll = () => {
    setShowAll((prev) => {
      writeFlag(SHOW_ALL_STORAGE_KEY, !prev);
      return !prev;
    });
  };

  // Session muscles first (their frozen order preserved), the rest behind the
  // expander — appended in the same frozen order so expanding never reshuffles
  // the cards already on screen. A session with no tagged muscles (edge case)
  // just shows everything.
  const sessionRows = rows.filter((r) => r.trainedThisSession);
  const restRows = rows.filter((r) => !r.trainedThisSession);
  const showEverything = showAll || sessionRows.length === 0;
  const visibleRows = showEverything ? [...sessionRows, ...restRows] : sessionRows;
  const expanderVisible = sessionRows.length > 0 && restRows.length > 0;

  return (
    <div className="-mt-1" data-testid="workout-volume-strip">
      <div className="flex items-center justify-between px-0.5 mb-1.5">
        <button
          onClick={toggleCollapsed}
          className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-surface-500 hover:text-surface-300"
          data-testid="workout-volume-strip-toggle"
          aria-expanded={!collapsed}
          aria-controls="workout-volume-strip-cards"
        >
          Weekly sets · MEV–MRV
          <IconChevronDown
            size={14}
            className={`transition-transform ${collapsed ? '-rotate-90' : ''}`}
            aria-hidden
          />
        </button>
        <button
          onClick={onOpenDetail}
          className="text-[11px] font-medium text-primary-400 hover:text-primary-300"
          data-testid="workout-volume-strip-details"
        >
          Details
        </button>
      </div>

      {!collapsed && (
        <div
          id="workout-volume-strip-cards"
          className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x"
        >
          {visibleRows.map((row) => (
            <button
              key={row.key}
              onClick={onOpenDetail}
              className="flex-shrink-0 snap-start w-[104px] text-left rounded-lg border border-surface-800 bg-surface-900/60 px-2.5 py-2 hover:border-surface-700 transition-colors"
              data-testid={`workout-volume-chip-${row.muscle}`}
              aria-label={`${row.displayName}: ${formatEffectiveVolume(row.effectiveSets)} effective of ${row.sets} weekly sets, ${groupZoneBandLabel(row.band)}, ${
                row.readyInHours <= 0 ? 'ready' : `ready in ${readyInLabel(row.readyInHours)}`
              }`}
            >
              {/* Name gets the full card width — the set count lives on its own
                  line below so wide values ("16.6 eff") can never crush the
                  name down to its first letter. */}
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className={`h-[9px] w-[9px] flex-shrink-0 rounded-full ${
                    isLoading ? 'bg-surface-700' : readinessDotClass(row.readiness)
                  }`}
                  data-testid={`workout-volume-readiness-dot-${row.muscle}`}
                  aria-hidden
                />
                <span className="text-xs font-medium text-surface-200 truncate">{row.displayName}</span>
              </div>
              <div className="mt-0.5">
                {isLoading ? (
                  <span className="inline-block h-4 w-8 rounded bg-surface-700 animate-pulse" aria-hidden />
                ) : (
                  <>
                    <span
                      className={`text-sm font-semibold tabular-nums ${rowTextClass(row)}`}
                      data-testid={`workout-volume-sets-${row.muscle}`}
                    >
                      {/* Effective (RIR-weighted) primary; the raw count rides
                          below with its unit — never "16.6/17", which reads as
                          current/target. */}
                      {formatEffectiveVolume(row.effectiveSets)}
                      <span className="text-[10px] font-normal text-surface-500"> eff</span>
                    </span>
                    <span className="block text-[10px] tabular-nums text-surface-500">
                      of {row.sets} sets
                    </span>
                  </>
                )}
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-surface-800 overflow-hidden">
                {!isLoading && (
                  <div
                    className={`h-full rounded-full ${rowBarClass(row)}`}
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
          {expanderVisible && (
            <button
              onClick={toggleShowAll}
              className="flex-shrink-0 snap-start w-[104px] rounded-lg border border-dashed border-surface-700 px-2.5 py-2 text-[11px] font-medium text-surface-400 hover:border-surface-600 hover:text-surface-300 transition-colors"
              data-testid="workout-volume-strip-show-all"
              aria-expanded={showAll}
            >
              {showAll ? 'Show less' : `Show all (+${restRows.length})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default WorkoutVolumeStrip;
