'use client';

import { useState, type ReactNode } from 'react';
import type { ExerciseVolume } from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';

/**
 * ContributingSets — the drill-down behind a muscle's weekly volume number:
 * which exercises fed the count and how many credited sets each contributed
 * (biggest first, ½-credit secondary work explained by the footnote). Shared
 * by every surface that renders the coarse-row volume model (the in-workout
 * readiness sheet and the volume page bars).
 */

/** "4 sets" / "1.5 sets" — credited counts keep their fraction (½ credits). */
export function formatCreditedSets(sets: number): string {
  const rounded = Math.round(sets * 10) / 10;
  return `${rounded} ${rounded === 1 ? 'set' : 'sets'}`;
}

export function ContributingSets({
  exercises,
  muscle,
  testIdPrefix,
}: {
  exercises: ExerciseVolume[];
  muscle: string;
  /** Panels get `${testIdPrefix}-${muscle}` (e.g. readiness-sources-chest). */
  testIdPrefix: string;
}) {
  const hasFractional = exercises.some((ex) => !Number.isInteger(Math.round(ex.sets * 10) / 10));
  return (
    <div className="rounded-lg bg-surface-800/40 px-2.5 py-2" data-testid={`${testIdPrefix}-${muscle}`}>
      <p className="text-[10px] uppercase tracking-wide text-surface-500 mb-1">Counted sets · last 7 days</p>
      <ul className="space-y-0.5">
        {exercises.map((ex) => (
          <li key={ex.id} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-surface-300 truncate">{ex.name}</span>
            <span className="tabular-nums text-surface-400 flex-shrink-0">{formatCreditedSets(ex.sets)}</span>
          </li>
        ))}
      </ul>
      {hasFractional && (
        <p className="mt-1 text-[10px] leading-relaxed text-surface-600">
          Partial counts are shared credit — ½ per set for secondary-muscle work,
          split across heads for multi-head groups.
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
      {open && <ContributingSets exercises={exercises} muscle={muscle} testIdPrefix={testIdPrefix} />}
    </div>
  );
}
