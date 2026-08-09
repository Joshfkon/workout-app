'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useUserStore } from '@/stores';

/**
 * MuscleGroupList — THE coarse-row-with-expandable-fine-children list.
 *
 * The volume page bars, the analytics Muscle Recovery card and the in-workout
 * Muscle Readiness sheet all render their muscle hierarchy through this one
 * component (guarded by an import-assertion test), so the pattern — chevron
 * parents, indented fine children, per-user-per-surface persisted expansion,
 * divergence auto-expand — can never drift between surfaces again.
 *
 * Split of responsibilities:
 *  - The DATA layer (buildVolumeRows / buildReadinessRows) supplies every
 *    coarse row with ALL its reachable fine children and, for recovery
 *    surfaces, an `autoExpand` divergence flag.
 *  - THIS component decides visibility: a child renders when its parent is
 *    expanded or the surface pins it (e.g. below-MEV children on volume
 *    surfaces), and a parent defaults to expanded when the data flags
 *    divergence — an explicit user choice always wins over the default,
 *    including over pins: explicitly collapsing a parent hides its pinned
 *    children too.
 *  - Each surface supplies its own row/child CONTENT renderers (bars, badges,
 *    timers) and its own row ordering; the hierarchy chrome is shared.
 */

/** Minimum shape of a fine child row. */
export interface MuscleListChild {
  /** Standard muscle id — used for keys and `${prefix}-${muscle}` testids. */
  muscle: string;
}

/** Minimum shape of a coarse row. */
export interface MuscleListRow<C extends MuscleListChild = MuscleListChild> {
  /** Coarse muscle id — the persistence + testid key. */
  muscle: string;
  displayName: string;
  children: C[];
  /** Default this parent to expanded (status divergence) until the user overrides. */
  autoExpand?: boolean;
}

export interface MuscleRowExpansion {
  /** Effective expanded coarse ids (explicit user choice, else autoExpand). */
  expanded: ReadonlySet<string>;
  /**
   * Coarse ids the user EXPLICITLY collapsed. Pinned children (e.g. lagging
   * fine muscles) stay visible under an untouched parent, but an explicit
   * collapse hides them too — the user's choice wins over the pin default.
   */
  collapsed: ReadonlySet<string>;
  /** Flip a parent; the resulting explicit choice is persisted per user per surface. */
  toggle: (muscle: string) => void;
}

const STORAGE_PREFIX = 'hypertrack:muscle-rows-expanded';

function storageKeyFor(surface: string, userId: string | null | undefined): string {
  return `${STORAGE_PREFIX}:${surface}:${userId || 'anon'}`;
}

function readChoices(key: string): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, boolean> = {};
    for (const [muscle, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') out[muscle] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function persistChoices(key: string, choices: Record<string, boolean>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(choices));
  } catch {
    /* localStorage unavailable (private mode / SSR) — degrade to in-memory. */
  }
}

/**
 * Per-user, per-surface expansion state for the hierarchy list, persisted in
 * localStorage so it survives app restarts. Only EXPLICIT user choices are
 * stored; rows the user never touched follow their `autoExpand` flag, so a
 * newly-divergent parent still self-reveals on a device with old state.
 */
export function useMuscleRowExpansion(
  surface: string,
  rows: readonly { muscle: string; autoExpand?: boolean }[]
): MuscleRowExpansion {
  const { user } = useUserStore();
  const storageKey = storageKeyFor(surface, user?.id);

  const [choices, setChoices] = useState<Record<string, boolean>>(() => readChoices(storageKey));
  // The persisted user id hydrates async — re-read when the key settles.
  useEffect(() => {
    setChoices(readChoices(storageKey));
  }, [storageKey]);

  const autoByMuscle = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const row of rows) map.set(row.muscle, row.autoExpand === true);
    return map;
  }, [rows]);

  const expanded = useMemo(() => {
    const set = new Set<string>();
    autoByMuscle.forEach((auto, muscle) => {
      if (choices[muscle] ?? auto) set.add(muscle);
    });
    return set;
  }, [autoByMuscle, choices]);

  const collapsed = useMemo(() => {
    const set = new Set<string>();
    for (const [muscle, value] of Object.entries(choices)) {
      if (value === false) set.add(muscle);
    }
    return set;
  }, [choices]);

  const toggle = (muscle: string) => {
    setChoices((prev) => {
      const effective = prev[muscle] ?? autoByMuscle.get(muscle) ?? false;
      const next = { ...prev, [muscle]: !effective };
      persistChoices(storageKey, next);
      return next;
    });
  };

  return { expanded, collapsed, toggle };
}

/**
 * Rows with `children` narrowed to the ones actually VISIBLE (expanded or
 * pinned) — feed the muscle-map adapters and scroll-target sets from this so
 * the map's fine-child overrides always match the child rows on screen.
 * Pass `collapsed` (explicit user collapses) so a pinned child under an
 * explicitly-collapsed parent is hidden here too, matching the rendered list.
 */
export function withVisibleChildren<R extends MuscleListRow>(
  rows: readonly R[],
  expanded: ReadonlySet<string>,
  pinChild?: (child: R['children'][number], row: R) => boolean,
  collapsed?: ReadonlySet<string>
): R[] {
  return rows.map((row) => ({
    ...row,
    children: row.children.filter(
      (child) =>
        expanded.has(row.muscle) ||
        (!collapsed?.has(row.muscle) && pinChild?.(child, row) === true)
    ),
  }));
}

export interface MuscleGroupListProps<R extends MuscleListRow> {
  rows: readonly R[];
  /** From useMuscleRowExpansion — shared with map adapters via withVisibleChildren. */
  expansion: MuscleRowExpansion;
  /** Row content (name/bar/badge line(s)) — the chevron + children are added here. */
  renderRow: (row: R, expanded: boolean) => ReactNode;
  renderChild: (child: R['children'][number], row: R) => ReactNode;
  /** Children visible even while the parent is collapsed (e.g. lagging fine muscles). */
  pinChild?: (child: R['children'][number], row: R) => boolean;
  /**
   * Extra per-row content revealed by the SAME expansion gesture as the fine
   * children, rendered after them but at ROW level — deliberately OUTSIDE the
   * indented children block, because this content is scoped to the whole group
   * and indenting it under the last child misrepresents whose data it is.
   * A row for which this returns non-null is expandable even with zero
   * children — that's how a single-muscle group (Biceps, Quads, Erectors, …)
   * gets a chevron and something to show behind it (e.g. the readiness sheet's
   * contributing-sets breakdown).
   */
  renderRowDetail?: (row: R) => ReactNode;
  /** testid prefix: rows get `${prefix}-${muscle}` (children too, by child muscle id). */
  testIdPrefix: string;
  /** Per-surface row container styling (borders / vertical rhythm). */
  rowClassName?: string;
  /** Per-surface indent container styling for the children block. */
  childrenClassName?: string;
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`w-3.5 h-3.5 flex-shrink-0 text-surface-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function MuscleGroupList<R extends MuscleListRow>({
  rows,
  expansion,
  renderRow,
  renderChild,
  pinChild,
  renderRowDetail,
  testIdPrefix,
  rowClassName,
  childrenClassName,
}: MuscleGroupListProps<R>) {
  return (
    <>
      {rows.map((row) => {
        const hasChildren = row.children.length > 0;
        const detail = renderRowDetail?.(row) ?? null;
        const expandable = hasChildren || detail !== null;
        const expanded = expandable && expansion.expanded.has(row.muscle);
        // Pins keep lagging children visible under an untouched parent, but an
        // explicit user collapse hides everything — the choice wins over the pin.
        const pinsSuppressed = expansion.collapsed.has(row.muscle);
        const visibleChildren = hasChildren
          ? row.children.filter(
              (child) => expanded || (!pinsSuppressed && pinChild?.(child, row) === true)
            )
          : [];

        return (
          <div key={row.muscle} className={rowClassName} data-testid={`${testIdPrefix}-${row.muscle}`}>
            {expandable ? (
              <button
                type="button"
                onClick={() => expansion.toggle(row.muscle)}
                aria-expanded={expanded}
                aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.displayName}`}
                className="w-full text-left flex items-start gap-1.5"
                data-testid={`${testIdPrefix}-toggle-${row.muscle}`}
              >
                {/* mt aligns the chevron with the first text line of the row content. */}
                <span className="mt-1">
                  <Chevron expanded={expanded} />
                </span>
                <span className="flex-1 min-w-0 block">{renderRow(row, expanded)}</span>
              </button>
            ) : (
              <div className="flex items-start gap-1.5">
                {/* Spacer keeps single-muscle groups aligned with expandable ones. */}
                <span className="mt-1 w-3.5 flex-shrink-0" aria-hidden="true" />
                <span className="flex-1 min-w-0 block">{renderRow(row, false)}</span>
              </div>
            )}

            {visibleChildren.length > 0 && (
              <div className={childrenClassName ?? 'mt-2 space-y-2 pl-4 ml-5 border-l border-surface-800/80'}>
                {visibleChildren.map((child) => (
                  <div key={child.muscle} data-testid={`${testIdPrefix}-${child.muscle}`}>
                    {renderChild(child, row)}
                  </div>
                ))}
              </div>
            )}

            {/* Row detail (e.g. the GROUP-scope contributing-sets panel) renders
                OUTSIDE the indented children block, at row level. It used to sit
                inside it, after the last child — which made a whole-group panel
                render indented beneath, and read as, that child's breakdown
                (Back's panel appearing under Upper Back, showing lat pulldowns
                at full credit and rear-delt secondary credit). The panel was
                always bound to the row, never to the child; only its placement
                said otherwise. Keep this outside the indent. */}
            {expanded && detail !== null && (
              <div className="mt-2" data-testid={`${testIdPrefix}-detail-${row.muscle}`}>
                {detail}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
