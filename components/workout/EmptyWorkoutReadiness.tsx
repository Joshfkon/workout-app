'use client';

import { useMemo, useState } from 'react';
import { IconPlus } from '@tabler/icons-react';
import { Chip, ListGroup, ListRow } from '@/components/ui';
import { MuscleReadinessContent } from './MuscleReadinessSheet';
import { useMuscleReadiness } from '@/hooks/useMuscleReadiness';
import { useWearableRecovery } from '@/hooks/useWearableRecovery';
import { resolvePrimaryMuscleCredits } from '@/services/volumeTracker';
import { COARSE_CHILDREN, type CoarseMuscle } from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import { READINESS_FACTOR } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/readiness';
import type { StandardMuscleGroup } from '@/types/schema';
import type { AvailableExercise } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/types';

/**
 * EmptyWorkoutReadiness — the inline readiness placement shown on the active
 * workout screen while it has ZERO exercises. It renders the same read-only
 * "good targets + per-muscle rows" body as the Muscle Readiness sheet (all
 * coarse groups, all listed), off the SAME data path
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
  /**
   * Open the weekly volume + recovery body on mount. The empty workout page
   * opens it (it's the main content until an exercise is added); the plan
   * builder keeps it collapsed under its target picker.
   */
  defaultExpanded?: boolean;
  /** Toggle label. */
  title?: string;
  /**
   * Design-system layout for the empty workout page: "Fresh today" chips,
   * then two rows (Muscle readiness · Sets this week) that open the full
   * readiness sheet via this callback, instead of the inline body. Omit to
   * keep the inline, collapsible body (the plan builder uses that).
   */
  onOpenDetail?: () => void;
}

/** "8 fresh · 4 recovering · 2 no data" style counts from the readiness rows. */
export function summarizeReadiness(rows: ReadonlyArray<{ readiness: string; volumeGap: number }>) {
  let fresh = 0;
  let recovering = 0;
  let unknown = 0;
  let behind = 0;
  for (const row of rows) {
    if (row.readiness === 'fresh') fresh += 1;
    else if (row.readiness === 'unknown') unknown += 1;
    else recovering += 1; // recovering or fatigued
    if (row.volumeGap > 0) behind += 1;
  }
  return { fresh, recovering, unknown, behind };
}

export function EmptyWorkoutReadiness({
  quickAddExercises,
  onAddExercise,
  disabled = false,
  defaultExpanded = false,
  title = "Today's readiness",
  onOpenDetail,
}: EmptyWorkoutReadinessProps) {
  // Stamp the clock once so every muscle is evaluated against the same instant.
  const [now] = useState(() => new Date());
  const [showReadiness, setShowReadiness] = useState(defaultExpanded);

  // Empty workout: no live blocks/sets yet, so readiness is purely history-based.
  // Hierarchy expansion lives inside MuscleReadinessContent (shared
  // MuscleGroupList state, persisted per user for the readiness surface).
  const { rows, targets, nextUp, dailyGroupSets, previewAt, isLoading } = useMuscleReadiness({
    liveBlocks: [],
    liveSets: [],
    now,
    enabled: true,
  });
  const { state: wearableRecovery } = useWearableRecovery();

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
        // Same factor as the row score, so an unknown (no-evidence) or
        // fatigued head never lifts its chip on volume gap alone.
        const childScore = child.volumeGap * READINESS_FACTOR[child.readiness];
        map[child.muscle] = Math.max(map[child.muscle] ?? 0, childScore);
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

  if (onOpenDetail) {
    const s = summarizeReadiness(rows);
    const dot = (cls: string) => <span className={`h-2 w-2 flex-shrink-0 rounded-full ${cls}`} aria-hidden="true" />;
    return (
      <div className="mt-6 space-y-6" data-testid="readiness-rows">
        {sortedChips.length > 0 && (
          <section aria-labelledby="fresh-today">
            <div className="mx-1 mb-2 flex items-baseline justify-between">
              <h2 id="fresh-today" className="text-headline text-ink">Fresh today</h2>
              <span className="text-subhead text-ink-2">Ranked by recovery</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {sortedChips.map((exercise) => (
                <Chip
                  key={exercise.id}
                  onClick={() => onAddExercise(exercise)}
                  disabled={disabled}
                  icon={<IconPlus size={16} />}
                >
                  {exercise.name}
                </Chip>
              ))}
            </div>
          </section>
        )}
        <ListGroup>
          <ListRow
            title="Muscle readiness"
            subtitle={
              isLoading ? (
                'Checking recovery…'
              ) : (
                <span className="flex flex-wrap gap-x-3">
                  <span className="inline-flex items-center gap-1.5">{dot('bg-status-ok')}{s.fresh} fresh</span>
                  <span className="inline-flex items-center gap-1.5">{dot('bg-status-warn')}{s.recovering} recovering</span>
                  {s.unknown > 0 && (
                    <span className="inline-flex items-center gap-1.5">{dot('bg-ink-3')}{s.unknown} no data</span>
                  )}
                </span>
              )
            }
            onClick={onOpenDetail}
          />
          <ListRow
            title="Sets this week"
            subtitle={
              isLoading
                ? 'Counting sets…'
                : s.behind > 0
                  ? `${s.behind} muscle${s.behind === 1 ? '' : 's'} under the weekly minimum`
                  : 'Every muscle at its weekly minimum'
            }
            onClick={onOpenDetail}
          />
        </ListGroup>
      </div>
    );
  }

  return (
    <>
      {/* Inline readiness (weekly volume per muscle + recovery). Collapsible;
          open on mount only when the caller asks (defaultExpanded). */}
      <div className="mt-8" data-testid="readiness-inline">
        <button
          type="button"
          onClick={() => setShowReadiness(!showReadiness)}
          aria-expanded={showReadiness}
          data-testid="readiness-inline-toggle"
          className="flex items-center gap-2 text-caption font-semibold text-ink-3 hover:text-ink-2 transition-colors mb-3"
        >
          <svg
            className={`w-3.5 h-3.5 transition-transform ${showReadiness ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          {title}
        </button>
        {showReadiness && (
          <MuscleReadinessContent
            rows={rows}
            targets={targets}
            nextUp={nextUp}
            dailyGroupSets={dailyGroupSets}
            previewAt={previewAt}
            isLoading={isLoading}
            loadingTestId="readiness-inline-loading"
            wearableNotice={wearableRecovery.reason}
          />
        )}
      </div>

      {/* Quick add: the user's frequent exercises, re-ordered by readiness. */}
      {sortedChips.length > 0 && (
        <div className="mt-8">
          <p className="text-caption font-semibold text-ink-3 mb-3">
            Quick add · Ranked by readiness
          </p>
          <div className="flex flex-wrap gap-2.5">
            {sortedChips.map((exercise) => (
              <button
                key={exercise.id}
                onClick={() => onAddExercise(exercise)}
                disabled={disabled}
                className="px-4 py-2.5 rounded-full bg-card text-ink font-medium hover:border-ink-3 hover:text-ink disabled:opacity-50 transition-colors shadow-card"
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
