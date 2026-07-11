'use client';

import { useMemo, useState } from 'react';
import { MuscleReadinessContent } from './MuscleReadinessSheet';
import { useMuscleReadiness } from '@/hooks/useMuscleReadiness';
import { resolvePrimaryMuscleCredits } from '@/services/volumeTracker';
import { COARSE_CHILDREN, type CoarseMuscle } from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import type { StandardMuscleGroup } from '@/types/schema';
import type { AvailableExercise } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/types';

/**
 * EmptyWorkoutReadiness — the inline readiness placement shown on the active
 * workout screen while it has ZERO exercises. It renders the same read-only
 * "good targets + per-muscle rows" body as the Muscle Readiness sheet (all
 * coarse groups, 6-row cap with a "+N more" expander), off the SAME data path
 * (`useMuscleReadiness`), plus the empty
 * state's Quick Add chips re-ordered by readiness score (recovered + behind on
 * volume first) instead of raw frequency.
 *
 * Lazy-mounted from the workout page so the hook + readiness assembly stay out
 * of the workout screen's initial bundle — it only loads once the user is on an
 * empty workout. Once the first exercise is added the page unmounts this and
 * falls back to the icon-only entry point in the header (the sheet).
 */

interface EmptyWorkoutReadinessProps {
  /** Frequency-ranked quick-add chips from the page (re-ordered here). */
  quickAddExercises: AvailableExercise[];
  onAddExercise: (exercise: AvailableExercise) => void;
  disabled?: boolean;
}

export function EmptyWorkoutReadiness({
  quickAddExercises,
  onAddExercise,
  disabled = false,
}: EmptyWorkoutReadinessProps) {
  // Stamp the clock once so every muscle is evaluated against the same instant.
  const [now] = useState(() => new Date());

  // Empty workout: no live blocks/sets yet, so readiness is purely history-based.
  const { rows, targets, isLoading } = useMuscleReadiness({
    liveBlocks: [],
    liveSets: [],
    now,
    enabled: true,
  });

  // Per-standard-muscle actionability score for chip re-ordering. Rows are now
  // coarse, so spread each coarse row's score across its standard children;
  // a lagging fine child (bigger gap) can raise its own muscle's score.
  const scoreByMuscle = useMemo(() => {
    const map = {} as Record<StandardMuscleGroup, number>;
    for (const row of rows) {
      for (const child of COARSE_CHILDREN[row.muscle as CoarseMuscle] ?? []) {
        map[child] = Math.max(map[child] ?? 0, row.score);
      }
      for (const child of row.children) {
        map[child.muscle] = Math.max(map[child.muscle] ?? 0, child.volumeGap);
      }
    }
    return map;
  }, [rows]);

  // Re-order the same chips by readiness score (recovered + behind on volume
  // first), falling back to the incoming frequency order on ties. An exercise's
  // score is the best score among the standard muscles its primary maps to.
  const sortedChips = useMemo(() => {
    if (quickAddExercises.length === 0) return quickAddExercises;
    const scoreFor = (ex: AvailableExercise): number => {
      const credits = resolvePrimaryMuscleCredits(ex.primary_muscle ?? '');
      if (credits.length === 0) return 0;
      return Math.max(...credits.map((c) => scoreByMuscle[c.muscle] ?? 0));
    };
    return quickAddExercises
      .map((exercise, index) => ({ exercise, index, score: scoreFor(exercise) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((entry) => entry.exercise);
  }, [quickAddExercises, scoreByMuscle]);

  return (
    <>
      {/* Inline readiness: same read-only body as the sheet (all coarse groups,
          6-row cap + "+N more" expander), rendered directly on the empty
          workout (no icon tap needed). */}
      <div className="mt-8" data-testid="readiness-inline">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-surface-500 mb-3">
          Today&apos;s readiness
        </p>
        <MuscleReadinessContent
          rows={rows}
          targets={targets}
          isLoading={isLoading}
          collapsible
          loadingTestId="readiness-inline-loading"
        />
      </div>

      {/* Quick add: the user's frequent exercises, re-ordered by readiness. */}
      {sortedChips.length > 0 && (
        <div className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-surface-500 mb-3">
            Quick add · Ranked by readiness
          </p>
          <div className="flex flex-wrap gap-2.5">
            {sortedChips.map((exercise) => (
              <button
                key={exercise.id}
                onClick={() => onAddExercise(exercise)}
                disabled={disabled}
                className="px-4 py-2.5 rounded-full border border-surface-700 bg-surface-900 text-surface-200 font-medium hover:border-surface-500 hover:text-surface-100 disabled:opacity-50 transition-colors"
              >
                + {exercise.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default EmptyWorkoutReadiness;
