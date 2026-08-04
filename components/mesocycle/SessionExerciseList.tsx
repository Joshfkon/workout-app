'use client';

/**
 * Read-only exercise list for one planned session — the shared body of every
 * "what's in this workout?" surface: the Train tab's preview sheet, the
 * Mesocycle page's today card, and each session on /dashboard/mesocycle/plan.
 *
 * Purely presentational: it renders the normalized `ExtractedExercise` rows
 * that `services/mesocycleHelpers` produces from program_data (with the user's
 * exercise overrides already applied by the caller). Set counts and rep ranges
 * are the PLANNED targets — weights are estimated at start time, so none are
 * shown here.
 */

import type { ExtractedExercise } from '@/services/mesocycleHelpers';

/** "2:00" / "90s" rest label. */
export function formatRest(seconds: number): string {
  if (!seconds || seconds <= 0) return '';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}:00` : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

interface SessionExerciseListProps {
  exercises: ExtractedExercise[];
  /** Show the per-exercise load guidance / notes line when present. */
  showNotes?: boolean;
  className?: string;
}

export function SessionExerciseList({
  exercises,
  showNotes = false,
  className = '',
}: SessionExerciseListProps) {
  if (exercises.length === 0) return null;

  return (
    <ol
      className={`rounded-xl border border-surface-800 bg-surface-950/40 overflow-hidden ${className}`}
    >
      {exercises.map((exercise, index) => {
        const rest = formatRest(exercise.restSeconds);
        const note = showNotes ? exercise.notes || exercise.loadGuidance : null;
        return (
          <li
            key={`${exercise.exerciseId ?? exercise.exerciseName}-${index}`}
            className="flex items-start gap-3 px-3 py-2.5 border-b border-surface-800/50 last:border-b-0"
          >
            <span className="mt-0.5 w-5 flex-shrink-0 text-[11px] tabular-nums text-surface-600">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] text-surface-200">{exercise.exerciseName}</span>
              <span className="block text-[11px] text-surface-500 mt-0.5">
                {[
                  `${exercise.sets} ${exercise.sets === 1 ? 'set' : 'sets'} × ${exercise.repRange.min}–${exercise.repRange.max}`,
                  `${exercise.targetRir} RIR`,
                  rest ? `${rest} rest` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {note && (
                <span className="block text-[11px] text-surface-600 mt-0.5 italic">{note}</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
