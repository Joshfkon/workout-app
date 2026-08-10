'use client';

import { useState, type ReactNode } from 'react';
import type { ExerciseVolume } from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import { formatEffectiveVolume } from '@/services/effectiveVolume';

/**
 * ContributingSets — the drill-down behind a muscle's weekly volume number:
 * which exercises fed the count, in BOTH header metrics — effective
 * (RIR-weighted) volume leading, credited raw sets alongside — so the list
 * always reconciles against the "X eff · Y sets" header it sits under
 * (biggest first, shared credit explained by the footnote). Shared by every
 * surface that renders the coarse-row volume model (the in-workout readiness
 * sheet and the volume page bars).
 */

/** "4 sets" / "1.5 sets" — credited counts keep their fraction (½ credits). */
export function formatCreditedSets(sets: number): string {
  const rounded = Math.round(sets * 10) / 10;
  return `${rounded} ${rounded === 1 ? 'set' : 'sets'}`;
}

/**
 * "4 sets → 1.3 credited" — performed working sets first, the fractional
 * credit this row actually received second, so the panel shows the input of
 * the fractional math, not just its output. Collapses to plain "4 sets" when
 * credit equals the performed count (full-credit direct work — an arrow to
 * the same number is noise). Falls back to credited-only when the performed
 * count is unavailable (performedSets 0 with positive credit: pre-migration
 * cached shapes).
 */
export function formatPerformedToCredited(
  performedSets: number | undefined,
  credited: number
): string {
  const roundedCredit = Math.round(credited * 10) / 10;
  if (
    performedSets === undefined ||
    !Number.isFinite(performedSets) ||
    performedSets <= 0 ||
    Math.abs(performedSets - roundedCredit) < 0.05
  ) {
    return formatCreditedSets(credited);
  }
  return `${performedSets} ${performedSets === 1 ? 'set' : 'sets'} → ${roundedCredit} credited`;
}

export function ContributingSets({
  exercises,
  muscle,
  testIdPrefix,
  scopeLabel,
  groupScope = false,
}: {
  exercises: ExerciseVolume[];
  muscle: string;
  /** Panels get `${testIdPrefix}-${muscle}` (e.g. readiness-sources-chest). */
  testIdPrefix: string;
  /**
   * Which muscle scope this panel counts for ("Rear Delts", "Shoulders ·
   * whole group"). Rendered in the header so a group-scope panel can't be
   * misread as a single sub-muscle's breakdown.
   */
  scopeLabel?: string;
  /**
   * True when this panel counts for a COARSE group that has sub-muscle rows.
   * Adds the footnote explaining why the group total is smaller than the sum
   * of those rows — see the note where it's rendered below.
   */
  groupScope?: boolean;
}) {
  const isFractional = (v: number) => !Number.isInteger(Math.round(v * 10) / 10);
  const hasFractional = exercises.some((ex) => isFractional(ex.sets));
  const hasDownWeighted = exercises.some(
    (ex) => Math.round(ex.effective * 10) !== Math.round(ex.sets * 10)
  );
  return (
    <div className="rounded-lg bg-surface-800/40 px-2.5 py-2" data-testid={`${testIdPrefix}-${muscle}`}>
      <p className="text-[10px] uppercase tracking-wide text-surface-500 mb-1">
        {scopeLabel ? `${scopeLabel} · ` : ''}Counted sets · last 7 days · effective (RIR-weighted)
      </p>
      <ul className="space-y-0.5">
        {exercises.map((ex) => (
          <li key={ex.id} className="flex items-baseline justify-between gap-2 text-xs">
            {/* Only the NAME truncates. The badge is a fixed-width chip: with
                `truncate` on the shared parent it was the tail of the line and
                clipped to "SECOND…" whenever the name was long, turning the
                one word that explains the halved credit into noise. */}
            <span className="flex items-baseline gap-1.5 min-w-0">
              <span className="text-surface-300 truncate">{ex.name}</span>
              {/* Indirect-only credit (no primary-tag share): this exercise is
                  here purely via a secondary-muscle tag — say so inline. */}
              {ex.direct === 0 && (
                <span
                  className="flex-shrink-0 rounded bg-surface-700/60 px-1 py-px text-[9px] uppercase tracking-wide text-surface-400"
                  data-testid={`${testIdPrefix}-secondary-${ex.id}`}
                >
                  secondary
                </span>
              )}
            </span>
            <span className="tabular-nums flex-shrink-0">
              <span className="text-surface-300">{formatEffectiveVolume(ex.effective)} eff</span>
              <span className="text-surface-500">
                {' '}
                · {formatPerformedToCredited(ex.performedSets, ex.sets)}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {/* The group total is NOT the sum of the sub-muscle rows above it, and
          that gap is intentional dedup, not a rounding bug: buildVolumeRows
          caps each exercise's GROUP credit at 1.0 per performed set, so a row
          tagged primary-to-one-head and secondary-to-another-head of the same
          group counts once here — while each sub-muscle row keeps its own
          uncapped per-head credit, which is what per-head programming needs.
          Say so, rather than leaving the user to reconcile two numbers that
          were never meant to add up. */}
      {groupScope && (
        <p
          className="mt-1 text-[10px] leading-relaxed text-surface-600"
          data-testid={`${testIdPrefix}-group-dedup-note-${muscle}`}
        >
          A set counts once for the group even when it works more than one of
          the muscles below, so this total is lower than the sub-muscle totals
          added up.
        </p>
      )}
      {(hasFractional || hasDownWeighted) && (
        <p className="mt-1 text-[10px] leading-relaxed text-surface-600">
          {hasFractional && (
            <>
              Partial counts are shared credit — ½ per set for secondary-muscle
              work (tagged &ldquo;secondary&rdquo;), split across heads for
              multi-head groups.{' '}
            </>
          )}
          {hasDownWeighted && (
            <>Effective volume weights each set by its reported RIR, so easy sets count less.</>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * SourcesDisclosure — wraps a fine-child row's content in a tap target that
 * toggles its own ContributingSets panel. Coarse rows don't need this: their
 * panel rides the shared expansion gesture via MuscleGroupList's
 * renderRowDetail. A child with nothing to show renders untouched.
 */
export function SourcesDisclosure({
  exercises,
  muscle,
  displayName,
  testIdPrefix,
  children,
}: {
  exercises: ExerciseVolume[];
  muscle: string;
  displayName: string;
  /** Toggle gets `${testIdPrefix}-toggle-${muscle}`, panel `${testIdPrefix}-${muscle}`. */
  testIdPrefix: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (exercises.length === 0) return <>{children}</>;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${open ? 'Hide' : 'Show'} sets counted for ${displayName}`}
        className="w-full text-left"
        data-testid={`${testIdPrefix}-toggle-${muscle}`}
      >
        {children}
      </button>
      {open && (
        <ContributingSets
          exercises={exercises}
          muscle={muscle}
          testIdPrefix={testIdPrefix}
          scopeLabel={displayName}
        />
      )}
    </div>
  );
}
