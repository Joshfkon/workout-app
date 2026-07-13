'use client';

import { useCallback, useMemo, useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { useMuscleReadiness } from '@/hooks/useMuscleReadiness';
import {
  formatReadyEta,
  type ReadinessRow,
  type ReadinessChild,
  type ReadinessTarget,
  type NextReadyTarget,
} from '@/app/(dashboard)/dashboard/workout/[id]/_lib/readiness';
import { zoneBarClass, zoneTextClass, zoneBandLabel, STANDARD_TO_COARSE, type CoarseMuscle } from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import { useExpandedVolumeRows } from '@/hooks/useExpandedVolumeRows';
import { MuscleMap } from '@/components/muscleMap/MuscleMap';
import { readinessRowsToMapData } from '@/lib/muscleMap/adapters';
import type { MuscleId } from '@/lib/muscleMap/taxonomy';
import type { BodyView } from '@/lib/muscleMap/paths';
import type { MuscleRecoveryResult } from '@/services/muscleRecovery';
import type { SetLog, StandardMuscleGroup } from '@/types/schema';
import type { ExerciseBlockWithExercise } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/types';

/** Default number of coarse rows shown before the "+N more" expander. */
const DEFAULT_ROW_CAP = 6;

/**
 * Expander state is remembered per browser session so a user who expands the
 * full list once doesn't have to re-expand it every time the sheet re-mounts
 * (it's lazy-mounted on each open) or the empty-workout inline placement
 * re-renders. Both surfaces share the key so "show me everything" carries over.
 */
const SHOW_ALL_STORAGE_KEY = 'hypertrack:readiness-show-all';

function readShowAll(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function persistShowAll(key: string, value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* sessionStorage unavailable (private mode / SSR) — degrade to in-memory. */
  }
}

/**
 * MuscleReadinessSheet — the in-workout "which muscles should I hit today?"
 * overlay. Lazy-mounted (the page renders it only once opened), READ-ONLY over
 * workout history and the live session: it never touches the workout store.
 *
 * Each coarse row pairs weekly volume (sets vs the shared MEV–MRV band, with a
 * zone-colored bar) with a recovery badge, sorted so the best targets (behind
 * on volume AND recovered) float to the top; lagging fine muscles surface as
 * indented children.
 */

interface MuscleReadinessSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Non-skipped blocks of the live session (read-only). */
  liveBlocks: ExerciseBlockWithExercise[];
  /** Sets logged so far in the live session (read-only). */
  liveSets: SetLog[];
  /**
   * Muscles reported "still sore" today — rendered Fatigued for the rest of
   * the session regardless of the time model.
   */
  sorenessOverrides?: ReadonlySet<StandardMuscleGroup>;
}

const RECOVERY_BADGE: Record<MuscleRecoveryResult['status'], { label: string; className: string }> = {
  fresh: { label: 'Fresh', className: 'bg-success-500/15 text-success-400' },
  recovering: { label: 'Recovering', className: 'bg-warning-500/15 text-warning-400' },
  fatigued: { label: 'Fatigued', className: 'bg-surface-700 text-surface-400' },
};

/** Shown for a muscle with no training in the window — no recovery estimate. */
const NO_DATA_BADGE = { label: 'No recent data', className: 'bg-surface-800 text-surface-500' };

/** "ready in ~Xh" — coarse, human-readable time until Fresh. */
function formatReadyIn(hours: number): string {
  if (hours <= 0) return '';
  if (hours < 1) return 'ready in <1h';
  if (hours < 24) return `ready in ~${Math.round(hours)}h`;
  const days = Math.round(hours / 24);
  return `ready in ~${days}d`;
}

/** Fill fraction within the band scale (MRV at ~83%, headroom for overrun). */
function barFillPct(sets: number, mrv: number): number {
  const maxDisplay = mrv * 1.2;
  return Math.min(100, Math.max(0, (sets / maxDisplay) * 100));
}

/**
 * Compact recovery body map for the sheet: one view at a time (sheet height),
 * front/back toggle, painted from the SAME rows the badges below render (via
 * readinessRowsToMapData — coarse status per group, rendered fine children
 * override). Tapping a muscle scrolls to its row.
 */
function ReadinessMap({ rows, onRevealAll }: { rows: ReadinessRow[]; onRevealAll?: () => void }) {
  const [view, setView] = useState<BodyView>('front');
  const mapData = useMemo(() => readinessRowsToMapData(rows), [rows]);
  const renderedChildMuscles = useMemo(
    () => new Set(rows.flatMap((row) => row.children.map((c) => c.muscle))),
    [rows]
  );
  const scrollToRow = useCallback(
    (muscle: MuscleId) => {
      const target = renderedChildMuscles.has(muscle) ? muscle : STANDARD_TO_COARSE[muscle];
      const selector = `[data-testid="readiness-row-${target}"]`;
      const el = document.querySelector(selector);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      // Row hidden behind the "+N more" cap — reveal, then scroll next frame.
      onRevealAll?.();
      requestAnimationFrame(() => {
        document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    },
    [renderedChildMuscles, onRevealAll]
  );

  return (
    <div className="mb-2" data-testid="readiness-map">
      <div className="flex justify-center gap-1 mb-1.5">
        {(['front', 'back'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
              view === v
                ? 'bg-surface-700 text-surface-100'
                : 'text-surface-500 hover:text-surface-300'
            }`}
            data-testid={`readiness-map-view-${v}`}
            aria-pressed={view === v}
          >
            {v === 'front' ? 'Front' : 'Back'}
          </button>
        ))}
      </div>
      <MuscleMap
        data={mapData}
        mode="recovery"
        view={view}
        onMuscleTap={scrollToRow}
        className="h-44"
        data-testid="readiness-muscle-map"
      />
    </div>
  );
}

function RecoveryBadge({ recovery, muscle }: { recovery: MuscleRecoveryResult; muscle: string }) {
  // Never trained in the window → no recovery estimate, just a neutral "no
  // recent data" chip (the volume bar still shows the 0-set target).
  const noData = recovery.lastTrainedAt === null;
  const badge = noData ? NO_DATA_BADGE : RECOVERY_BADGE[recovery.status];
  const readyIn = noData || recovery.status === 'fresh' ? '' : formatReadyIn(recovery.hoursUntilReady);
  return (
    <div className="flex flex-col items-end gap-0.5 flex-shrink-0 w-[92px]">
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium text-right ${badge.className}`} data-testid={`readiness-badge-${muscle}`}>
        {badge.label}
      </span>
      {readyIn && <span className="text-[10px] text-surface-500">{readyIn}</span>}
    </div>
  );
}

function ChildRowView({ child }: { child: ReadinessChild }) {
  return (
    <div className="flex items-center gap-3 py-1.5 pl-4" data-testid={`readiness-row-${child.muscle}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-surface-400 truncate">{child.displayName}</span>
          <span className="text-[10px] tabular-nums text-surface-500 flex-shrink-0">
            <span className={zoneTextClass(child.zone, child.sets)} data-testid={`readiness-sets-${child.muscle}`}>{child.sets}</span>
            <span className="text-surface-600"> · {zoneBandLabel(child.band)}</span>
          </span>
        </div>
        <div className="mt-1 h-1 rounded-full bg-surface-800 overflow-hidden">
          <div className={`h-full rounded-full ${zoneBarClass(child.zone, child.sets)}`} style={{ width: `${barFillPct(child.sets, child.band.mrv)}%` }} />
        </div>
      </div>
      <RecoveryBadge recovery={child.recovery} muscle={child.muscle} />
    </div>
  );
}

function ReadinessRowView({
  row,
  expanded,
  onToggle,
}: {
  row: ReadinessRow;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  // Chevron whenever the group CAN expand (≥1 reachable fine child) — same
  // rule as the volume page's bars, driven by the same persisted state.
  const canToggle = row.expandable && Boolean(onToggle);
  return (
    <div data-testid={`readiness-row-${row.muscle}`}>
      <div className="flex items-center gap-3 py-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            {canToggle ? (
              <button
                onClick={onToggle}
                className="flex items-center gap-1 min-w-0 text-left"
                aria-expanded={expanded}
                data-testid={`readiness-row-toggle-${row.muscle}`}
              >
                <svg
                  className={`w-3 h-3 flex-shrink-0 text-surface-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-sm text-surface-100 truncate">{row.displayName}</span>
              </button>
            ) : (
              <span className="text-sm text-surface-100 truncate">{row.displayName}</span>
            )}
            <span className="text-[11px] tabular-nums flex-shrink-0">
              <span className={zoneTextClass(row.zone, row.sets)} data-testid={`readiness-sets-${row.muscle}`}>{row.sets}</span>
              <span className="text-surface-600"> · {zoneBandLabel(row.band)}</span>
            </span>
          </div>
          <div className="mt-1.5 h-1 rounded-full bg-surface-800 overflow-hidden">
            <div className={`h-full rounded-full ${zoneBarClass(row.zone, row.sets)}`} style={{ width: `${barFillPct(row.sets, row.band.mrv)}%` }} />
          </div>
        </div>
        <RecoveryBadge recovery={row.recovery} muscle={row.muscle} />
      </div>
      {/* Lagging fine children surface under their parent. */}
      {row.children.length > 0 && (
        <div className="border-l border-surface-800/80 ml-1 mb-1">
          {row.children.map((child) => (
            <ChildRowView key={child.muscle} child={child} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * MuscleReadinessContent — the read-only "good targets + per-muscle rows" body
 * shared by the bottom sheet and the empty-workout inline placement. Purely
 * presentational: it takes already-assembled coarse rows/targets (from
 * `useMuscleReadiness`) so both surfaces render identical UI off the same data
 * path.
 *
 * `collapsible` shows a 6-row cap with a "+N more" / "Show less" toggle so
 * fatigued muscles that sink to the bottom stay reachable; the toggle state is
 * remembered per session (see SHOW_ALL_STORAGE_KEY).
 */
export function MuscleReadinessContent({
  rows,
  targets,
  nextUp = null,
  isLoading,
  collapsible = false,
  loadingTestId = 'readiness-sheet-loading',
  showFootnote = true,
  persistKey = SHOW_ALL_STORAGE_KEY,
  expandedRows,
  onToggleRow,
}: {
  rows: ReadinessRow[];
  targets: ReadinessTarget[];
  nextUp?: NextReadyTarget | null;
  isLoading: boolean;
  collapsible?: boolean;
  loadingTestId?: string;
  showFootnote?: boolean;
  persistKey?: string;
  /** Coarse groups the user expanded (shared persisted state) — enables the chevron. */
  expandedRows?: Set<CoarseMuscle>;
  onToggleRow?: (muscle: CoarseMuscle) => void;
}) {
  const [showAll, setShowAllState] = useState(() => readShowAll(persistKey));
  const setShowAll = (value: boolean) => {
    setShowAllState(value);
    persistShowAll(persistKey, value);
  };

  const visibleRows = collapsible && !showAll ? rows.slice(0, DEFAULT_ROW_CAP) : rows;
  const hiddenCount = rows.length - visibleRows.length;

  return (
    <>
      {/* Top strip: the answer at a glance (fine children surface here). This is
          derived from the SAME rows the badges below show, so a muscle can never
          appear here as ready-now while its row reads Recovering. */}
      <div className="mb-2 rounded-lg bg-surface-800/60 px-3 py-2.5">
        <p className="text-[11px] uppercase tracking-wide text-surface-500">Good targets today</p>
        <p className="text-sm text-surface-100 mt-0.5" data-testid="readiness-targets">
          {targets.length > 0 ? (
            targets.map((t, i) => (
              <span key={`${t.muscle}-${t.isChild ? 'c' : 'r'}`}>
                {i > 0 && <span className="text-surface-500">, </span>}
                {t.tier === 'soon' ? (
                  // Ready-soon pick: muted + parenthetical ETA, visibly distinct
                  // from fully-Fresh picks (a legitimate target for a session
                  // planned a little ahead, not a ready-now recommendation).
                  <span className="text-surface-400">
                    {t.displayName}{' '}
                    <span className="text-surface-500">(ready {formatReadyEta(t.readyInHours)})</span>
                  </span>
                ) : (
                  t.displayName
                )}
              </span>
            ))
          ) : nextUp ? (
            `Nothing urgent — lagging muscles are still recovering. Next up: ${nextUp.displayName} in ${formatReadyEta(nextUp.hoursUntilReady)}.`
          ) : (
            "You're on top of volume — nothing behind and recovered right now."
          )}
        </p>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-surface-500" data-testid={loadingTestId}>
          Loading readiness…
        </div>
      ) : (
        <>
          {rows.length > 0 && <ReadinessMap rows={rows} onRevealAll={() => setShowAll(true)} />}
          <div className="divide-y divide-surface-800/70">
            {visibleRows.map((row) => (
              <ReadinessRowView
                key={row.muscle}
                row={row}
                expanded={expandedRows?.has(row.muscle)}
                onToggle={onToggleRow ? () => onToggleRow(row.muscle) : undefined}
              />
            ))}
          </div>
          {collapsible && hiddenCount > 0 && (
            <button
              onClick={() => setShowAll(true)}
              className="mt-2 w-full py-2 text-xs font-medium text-primary-400 hover:text-primary-300"
              data-testid="readiness-show-more"
            >
              +{hiddenCount} more
            </button>
          )}
          {collapsible && showAll && rows.length > DEFAULT_ROW_CAP && (
            <button
              onClick={() => setShowAll(false)}
              className="mt-2 w-full py-2 text-xs font-medium text-surface-500 hover:text-surface-300"
              data-testid="readiness-show-less"
            >
              Show less
            </button>
          )}
        </>
      )}

      {showFootnote && (
        <p className="mt-3 text-[11px] leading-relaxed text-surface-600">
          Sorted by what to train now: recovered muscles behind on weekly volume
          come first; fatigued muscles sink to the bottom. Recovery is a simple
          planning estimate, not a medical readout.
        </p>
      )}
    </>
  );
}

export function MuscleReadinessSheet({
  isOpen,
  onClose,
  liveBlocks,
  liveSets,
  sorenessOverrides,
}: MuscleReadinessSheetProps) {
  // Stamp the clock once when the sheet mounts so every muscle is evaluated
  // against the same instant (and re-stamped on each fresh open).
  const [now] = useState(() => new Date());

  // Shared, per-user persisted expansion — the same state the volume page uses.
  const { expandedRows, toggleRow } = useExpandedVolumeRows();

  const { rows, targets, nextUp, isLoading } = useMuscleReadiness({
    liveBlocks,
    liveSets,
    now,
    enabled: isOpen,
    sorenessOverrides,
    expandedParents: expandedRows,
  });

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Muscle readiness">
      <div data-testid="readiness-sheet">
        <MuscleReadinessContent
          rows={rows}
          targets={targets}
          nextUp={nextUp}
          isLoading={isLoading}
          collapsible
          expandedRows={expandedRows}
          onToggleRow={toggleRow}
        />
      </div>
    </BottomSheet>
  );
}

export default MuscleReadinessSheet;
