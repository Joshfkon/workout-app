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
 * The bar also carries the WEEK PROJECTION: today's remaining planned sets
 * render as a hatched, lighter segment on top of the week-to-date fill, and a
 * "+N → M" microline shows where the week lands if the plan is finished.
 * Warning states: amber when the PROJECTED total overshoots MRV, red when a
 * projected deficit is locked in (below the band minimum even with today's
 * plan, and recovery says no more quality sets fit this week — see
 * services/plannedVolumeProjection). Both recompute live as sets are logged
 * or exercises skipped, so a skip shows its volume consequence immediately.
 *
 * By default only the muscles THIS session trains render; a trailing
 * "Show all (+N)" card appends the remaining groups (session muscles stay
 * first). The whole card row is also collapsible via the header chevron.
 * Both choices persist across sessions. Tapping a muscle chip expands an
 * inline panel with the numbers (completed, planned, projected vs band,
 * recovery); the header "Details" button and the panel's "Full breakdown"
 * link open the full "What to train" sheet.
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

/** Fill fraction of the MRV scale — full bar at the band's high end. This bar
 *  has no MRV tick (unlike BarTrack), so headroom past MRV would just read as
 *  "not done" at the target; overrun past MRV is signaled by color instead. */
function barFillPct(sets: number, mrv: number): number {
  if (mrv <= 0) return 0;
  return Math.min(100, Math.max(0, (sets / mrv) * 100));
}

/** Status-dot colour for a readiness score (green / amber / red). */
function readinessDotClass(readiness: number): string {
  if (readiness >= READINESS_READY_THRESHOLD) return 'bg-success-500';
  if (readiness >= READINESS_AMBER_THRESHOLD) return 'bg-warning-500';
  return 'bg-danger-500';
}

/** The two projection warning states (spec'd colors): red for a locked-in
 *  deficit, amber for a projected MRV overshoot. Null = no warning. */
function projectionWarning(row: WorkoutMuscleVolumeRow): 'locked' | 'over' | null {
  if (row.deficitLockedIn) return 'locked';
  if (row.projectedZone === 'over_mrv') return 'over';
  return null;
}

/** Card border tint for a projection warning. */
function chipBorderClass(row: WorkoutMuscleVolumeRow): string {
  const warning = projectionWarning(row);
  if (warning === 'locked') return 'border-danger-500/50';
  if (warning === 'over') return 'border-warning-500/50';
  return 'border-surface-800';
}

/** Fill for the hatched planned segment (lighter than the week-to-date fill;
 *  tinted by the projection warning). */
function plannedSegmentClass(row: WorkoutMuscleVolumeRow): string {
  const warning = projectionWarning(row);
  if (warning === 'locked') return 'bg-danger-500/50';
  if (warning === 'over') return 'bg-warning-500/60';
  return 'bg-surface-400/50';
}

/** Text colour for the "+N → M" projection microline. */
function projectionTextClass(row: WorkoutMuscleVolumeRow): string {
  const warning = projectionWarning(row);
  if (warning === 'locked') return 'text-danger-400';
  if (warning === 'over') return 'text-warning-400';
  return 'text-surface-400';
}

/** Diagonal hatch so the planned segment reads "not done yet" at a glance. */
const PLANNED_HATCH_STYLE = {
  backgroundImage:
    'repeating-linear-gradient(135deg, rgba(255,255,255,0.28) 0 2px, transparent 2px 4px)',
} as const;

/** Human label for where the projected total lands in the band. */
function projectionLabel(row: WorkoutMuscleVolumeRow): string {
  if (row.deficitLockedIn) return 'Deficit locked in';
  if (row.projectedZone === 'over_mrv') return 'Projected over max';
  if (row.projectedZone === 'below_mev') return 'Projected under min';
  return 'Projected in range';
}

/** "~{N}h" hours label for the not-ready microcopy (never "~0h"). */
function readyInLabel(readyInHours: number): string {
  return `~${Math.max(1, Math.ceil(readyInHours))}h`;
}

export function WorkoutVolumeStrip({ rows, isLoading, onOpenDetail }: WorkoutVolumeStripProps) {
  const [collapsed, setCollapsed] = useState(() => readFlag(COLLAPSED_STORAGE_KEY));
  const [showAll, setShowAll] = useState(() => readFlag(SHOW_ALL_STORAGE_KEY));
  // Which muscle's numbers panel is open (per-mount UI state, not persisted).
  const [expandedMuscle, setExpandedMuscle] = useState<string | null>(null);

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

  // The numbers panel follows chip visibility: hiding a chip (Show less)
  // closes its panel rather than leaving an orphaned detail on screen.
  const expandedRow = visibleRows.find((r) => r.muscle === expandedMuscle) ?? null;

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
        <>
        <div
          id="workout-volume-strip-cards"
          className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x"
        >
          {visibleRows.map((row) => (
            <button
              key={row.key}
              onClick={() =>
                setExpandedMuscle((cur) => (cur === row.muscle ? null : row.muscle))
              }
              className={`flex-shrink-0 snap-start w-[104px] text-left rounded-lg border ${chipBorderClass(row)} bg-surface-900/60 px-2.5 py-2 hover:border-surface-700 transition-colors`}
              data-testid={`workout-volume-chip-${row.muscle}`}
              aria-expanded={expandedRow?.muscle === row.muscle}
              aria-label={`${row.displayName}: ${formatEffectiveVolume(row.effectiveSets)} effective of ${row.sets} weekly sets${
                row.unratedSets > 0 ? `, ${formatEffectiveVolume(row.unratedSets)} unrated` : ''
              }${
                row.plannedSets > 0
                  ? `, ${row.plannedSets} planned today, projected ${row.projectedSets}`
                  : ''
              }, ${groupZoneBandLabel(row.band)}, ${
                row.readyInHours <= 0 ? 'ready' : `ready in ${readyInLabel(row.readyInHours)}`
              }${row.deficitLockedIn ? ', deficit locked in' : ''}`}
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
                      {/* Unrated sets are EXCLUDED from the effective number
                          (services/effectiveVolume) — surfacing the count here
                          is the other half of that rule: never an effective
                          value silently computed over a subset. */}
                      {row.unratedSets > 0 && (
                        <span className="text-warning-400"> · {formatEffectiveVolume(row.unratedSets)} unrated</span>
                      )}
                    </span>
                  </>
                )}
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-surface-800 overflow-hidden flex">
                {!isLoading && (
                  <>
                    <div
                      className={`h-full ${rowBarClass(row)}`}
                      style={{ width: `${barFillPct(row.sets, row.band.mrv)}%` }}
                      data-testid={`workout-volume-bar-${row.muscle}`}
                    />
                    {row.plannedSets > 0 && (
                      <div
                        className={`h-full ${plannedSegmentClass(row)}`}
                        style={{
                          // Today's still-planned contribution: the slice of the
                          // MRV scale between week-to-date and projected.
                          width: `${
                            barFillPct(row.projectedSets, row.band.mrv) -
                            barFillPct(row.sets, row.band.mrv)
                          }%`,
                          ...PLANNED_HATCH_STYLE,
                        }}
                        data-testid={`workout-volume-planned-bar-${row.muscle}`}
                        aria-hidden
                      />
                    )}
                  </>
                )}
              </div>
              {!isLoading && row.plannedSets > 0 && (
                <p
                  className={`mt-0.5 text-[10px] tabular-nums ${projectionTextClass(row)}`}
                  data-testid={`workout-volume-projection-${row.muscle}`}
                >
                  +{row.plannedSets} today → {row.projectedSets}
                </p>
              )}
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

        {/* Tap-to-see-the-numbers panel: completed, planned, projected vs the
            band, recovery — the same values the chip encodes visually. */}
        {expandedRow && (
          <div
            className="mt-1 rounded-lg border border-surface-800 bg-surface-900/60 px-3 py-2.5"
            data-testid={`workout-volume-detail-${expandedRow.muscle}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-surface-200">
                {expandedRow.displayName}
              </span>
              <span
                className={`text-[11px] font-medium ${projectionTextClass(expandedRow)}`}
                data-testid={`workout-volume-detail-status-${expandedRow.muscle}`}
              >
                {projectionLabel(expandedRow)}
              </span>
            </div>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
              <dt className="text-surface-500">Completed this week</dt>
              <dd className="text-right text-surface-200">
                {expandedRow.sets} sets · {formatEffectiveVolume(expandedRow.effectiveSets)} eff
              </dd>
              <dt className="text-surface-500">Still planned today</dt>
              <dd className="text-right text-surface-200">
                {expandedRow.plannedSets > 0 ? `+${expandedRow.plannedSets} sets` : '—'}
              </dd>
              <dt className="text-surface-500">Projected week</dt>
              <dd className={`text-right ${projectionTextClass(expandedRow)}`}>
                {expandedRow.projectedSets} of {expandedRow.band.mev}–{expandedRow.band.mrv}
              </dd>
              <dt className="text-surface-500">Recovery</dt>
              <dd className="text-right text-surface-200">
                {expandedRow.readyInHours <= 0
                  ? 'Ready'
                  : `Ready in ${readyInLabel(expandedRow.readyInHours)}`}
              </dd>
            </dl>
            {expandedRow.deficitLockedIn && (
              <p className="mt-1.5 text-[11px] text-danger-400">
                Recovery won’t allow more quality sets before this week’s window
                closes — the deficit is locked in.
              </p>
            )}
            <button
              onClick={onOpenDetail}
              className="mt-1.5 text-[11px] font-medium text-primary-400 hover:text-primary-300"
              data-testid={`workout-volume-detail-full-${expandedRow.muscle}`}
            >
              Full breakdown →
            </button>
          </div>
        )}
        </>
      )}
    </div>
  );
}

export default WorkoutVolumeStrip;
