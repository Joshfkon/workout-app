'use client';

import { useCallback, useMemo, useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { useMuscleReadiness } from '@/hooks/useMuscleReadiness';
import { useWearableRecovery } from '@/hooks/useWearableRecovery';
import {
  formatReadyEta,
  type ReadinessRow,
  type ReadinessChild,
  type ReadinessTarget,
  type NextReadyTarget,
} from '@/app/(dashboard)/dashboard/workout/[id]/_lib/readiness';
import {
  zoneBarClass,
  zoneTextClass,
  zoneBandLabel,
  rowBarClass,
  rowTextClass,
  groupZoneBandLabel,
  STANDARD_TO_COARSE,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import {
  MuscleGroupList,
  useMuscleRowExpansion,
  withVisibleChildren,
} from '@/components/muscle/MuscleGroupList';
import { ContributingSets, SourcesDisclosure } from '@/components/muscle/ContributingSets';
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

/**
 * Map paint mode (recovery vs volume) shares the same per-session persistence
 * (and both surfaces share the key) so the choice survives the sheet's lazy
 * re-mounts within a session.
 */
const MAP_MODE_STORAGE_KEY = 'hypertrack:readiness-map-mode';

/** What the sheet's body map paints: recovery status or weekly-volume zones. */
type ReadinessMapMode = 'recovery' | 'volume';

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

function readMapMode(): ReadinessMapMode {
  if (typeof window === 'undefined') return 'recovery';
  try {
    return window.sessionStorage.getItem(MAP_MODE_STORAGE_KEY) === 'volume' ? 'volume' : 'recovery';
  } catch {
    return 'recovery';
  }
}

function persistMapMode(mode: ReadinessMapMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(MAP_MODE_STORAGE_KEY, mode);
  } catch {
    /* sessionStorage unavailable — degrade to in-memory. */
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

/** Fill fraction of the MRV scale — full bar at the band's high end. These
 *  bars have no MRV tick (unlike BarTrack), so headroom past MRV would just
 *  read as "not done" at the target; overrun is signaled by color instead. */
function barFillPct(sets: number, mrv: number): number {
  if (mrv <= 0) return 0;
  return Math.min(100, Math.max(0, (sets / mrv) * 100));
}

/**
 * Compact body map for the sheet: one view at a time (sheet height),
 * front/back toggle, plus a Recovery/Volume paint toggle — recovery status by
 * default, weekly-volume zones (same colors as the bars below) on demand.
 * Both paints come from the SAME rows the badges/bars below render (via
 * readinessRowsToMapData — coarse values per group, rendered fine children
 * override). Tapping a muscle scrolls to its row.
 */
function ReadinessMap({ rows, onRevealAll }: { rows: ReadinessRow[]; onRevealAll?: () => void }) {
  const [view, setView] = useState<BodyView>('front');
  const [mode, setModeState] = useState<ReadinessMapMode>(() => readMapMode());
  const setMode = (value: ReadinessMapMode) => {
    setModeState(value);
    persistMapMode(value);
  };
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
      <div className="flex items-center justify-between mb-1.5">
        {/* Paint toggle: recovery status (default) vs weekly-volume zones. */}
        <div className="flex gap-1">
          {(['recovery', 'volume'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                mode === m
                  ? 'bg-surface-700 text-surface-100'
                  : 'text-surface-500 hover:text-surface-300'
              }`}
              data-testid={`readiness-map-mode-${m}`}
              aria-pressed={mode === m}
            >
              {m === 'recovery' ? 'Recovery' : 'Volume'}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
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
      </div>
      <MuscleMap
        data={mapData}
        mode={mode}
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

/** Fine-child content for the shared MuscleGroupList (chrome lives there).
 *  Tapping the child row toggles its own contributing-sets breakdown. */
function ReadinessChildContent({ child }: { child: ReadinessChild }) {
  return (
    <SourcesDisclosure
      exercises={child.exercises}
      muscle={child.muscle}
      displayName={child.displayName}
      testIdPrefix="readiness-sources"
    >
      <div className="flex items-center gap-3 py-1.5">
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
    </SourcesDisclosure>
  );
}

/** Coarse-row content for the shared MuscleGroupList (chrome lives there). */
function ReadinessRowContent({ row }: { row: ReadinessRow }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-surface-100 truncate">{row.displayName}</span>
          <span className="text-[11px] tabular-nums flex-shrink-0">
            {/* Row-aware color: an in-zone parent with a lagging fine child
                reads warning, never green. Coarse bands are group landmarks. */}
            <span className={rowTextClass(row)} data-testid={`readiness-sets-${row.muscle}`}>{row.sets}</span>
            <span className="text-surface-600"> · {groupZoneBandLabel(row.band)}</span>
          </span>
        </div>
        <div className="mt-1.5 h-1 rounded-full bg-surface-800 overflow-hidden">
          <div className={`h-full rounded-full ${rowBarClass(row)}`} style={{ width: `${barFillPct(row.sets, row.band.mrv)}%` }} />
        </div>
      </div>
      <RecoveryBadge recovery={row.recovery} muscle={row.muscle} />
    </div>
  );
}

/** Pinned = reachable AND lagging children stay visible while collapsed;
 *  unreachable context rows only show on an explicit expand. */
const pinLaggingChild = (child: ReadinessChild) => child.belowMev && child.reachable;

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
  wearableNotice = null,
}: {
  rows: ReadinessRow[];
  targets: ReadinessTarget[];
  nextUp?: NextReadyTarget | null;
  isLoading: boolean;
  collapsible?: boolean;
  loadingTestId?: string;
  showFootnote?: boolean;
  persistKey?: string;
  /**
   * Quiet one-liner when the wearable HRV/RHR modifier is stretching
   * recovery windows (e.g. "Recovery slowed — HRV below your baseline.").
   * Null when neutral or without data — then nothing renders.
   */
  wearableNotice?: string | null;
}) {
  const [showAll, setShowAllState] = useState(() => readShowAll(persistKey));
  const setShowAll = (value: boolean) => {
    setShowAllState(value);
    persistShowAll(persistKey, value);
  };

  const visibleRows = collapsible && !showAll ? rows.slice(0, DEFAULT_ROW_CAP) : rows;
  const hiddenCount = rows.length - visibleRows.length;

  // Shared hierarchy expansion (persisted per user; the sheet and the
  // empty-workout inline placement share the 'readiness' surface, like the
  // show-all expander). Divergent parents (autoExpand) self-reveal.
  const expansion = useMuscleRowExpansion('readiness', rows);
  // The map paints from the same rows the list shows: fine-child overrides
  // only for children actually visible (pinned-lagging or expanded).
  const mapRows = useMemo(
    () => withVisibleChildren(rows, expansion.expanded, pinLaggingChild, expansion.collapsed),
    [rows, expansion.expanded, expansion.collapsed]
  );

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
          {rows.length > 0 && <ReadinessMap rows={mapRows} onRevealAll={() => setShowAll(true)} />}
          <div className="divide-y divide-surface-800/70">
            <MuscleGroupList
              rows={visibleRows}
              expansion={expansion}
              renderRow={(row) => <ReadinessRowContent row={row} />}
              renderChild={(child) => <ReadinessChildContent child={child} />}
              pinChild={pinLaggingChild}
              // Expanding a row also reveals WHERE its weekly count came from —
              // and gives chevronless single-muscle groups (Biceps, Quads, …)
              // something to expand to.
              renderRowDetail={(row) =>
                row.exercises.length > 0 ? (
                  // Group-scope panel: MuscleGroupList renders it at ROW level
                  // (outside the child indent), and the scope label names the
                  // group, so it can't read as a sub-muscle's breakdown.
                  // groupScope adds the footnote for why the group total is
                  // below the sum of the sub-muscle rows.
                  <ContributingSets
                    exercises={row.exercises}
                    muscle={row.muscle}
                    testIdPrefix="readiness-sources"
                    scopeLabel={row.children.length > 0 ? `${row.displayName} · whole group` : row.displayName}
                    groupScope={row.children.length > 0}
                  />
                ) : null
              }
              testIdPrefix="readiness-row"
              childrenClassName="border-l border-surface-800/80 ml-5 mb-1 pl-2"
            />
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

      {wearableNotice && !isLoading && (
        <p
          className="mt-3 text-[11px] leading-relaxed text-surface-500"
          data-testid="readiness-wearable-notice"
        >
          {wearableNotice}
        </p>
      )}

      {showFootnote && (
        <p className="mt-3 text-[11px] leading-relaxed text-surface-600">
          Sorted by what to train now: recovered muscles behind on weekly volume
          come first; fatigued muscles sink to the bottom. Set counts include
          today&rsquo;s workout as you log it; recovery updates once you finish
          the session. Recovery is a simple planning estimate, not a medical
          readout.
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

  const { rows, targets, nextUp, isLoading } = useMuscleReadiness({
    liveBlocks,
    liveSets,
    now,
    enabled: isOpen,
    sorenessOverrides,
  });
  const { state: wearableRecovery } = useWearableRecovery();

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Muscle readiness">
      <div data-testid="readiness-sheet">
        <MuscleReadinessContent
          rows={rows}
          targets={targets}
          nextUp={nextUp}
          isLoading={isLoading}
          collapsible
          wearableNotice={wearableRecovery.reason}
        />
      </div>
    </BottomSheet>
  );
}

export default MuscleReadinessSheet;
