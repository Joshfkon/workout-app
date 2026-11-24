'use client';

import { IconCheck, IconLoader2 } from '@tabler/icons-react';
import { cn } from '@/lib/utils';

/**
 * The steps every "Start workout" tap walks through, in order. Each start
 * path reports the ones it has (an empty workout skips "building"), so the
 * lifter sees WHICH step is running instead of a bare "Starting…" — the UX
 * panel (round 19, 6 of 6) read the old single label as a stall and wasn't
 * sure the tap had worked.
 */
export type WorkoutStartStage = 'preparing' | 'building' | 'saving' | 'opening';

export const WORKOUT_START_STEPS: ReadonlyArray<{ stage: WorkoutStartStage; label: string }> = [
  { stage: 'preparing', label: 'Checking today’s plan' },
  { stage: 'building', label: 'Picking weights from your history' },
  { stage: 'saving', label: 'Saving your exercises' },
  { stage: 'opening', label: 'Opening the workout screen' },
];

function stepIndex(stage: WorkoutStartStage): number {
  return Math.max(0, WORKOUT_START_STEPS.findIndex((s) => s.stage === stage));
}

/** Short button copy for a stage: "Picking weights… (2 of 4)". Pure. */
export function workoutStartLabel(stage: WorkoutStartStage): string {
  const i = stepIndex(stage);
  const short: Record<WorkoutStartStage, string> = {
    preparing: 'Checking your plan…',
    building: 'Picking weights…',
    saving: 'Saving exercises…',
    opening: 'Opening workout…',
  };
  return `${short[stage]} (${i + 1} of ${WORKOUT_START_STEPS.length})`;
}

/**
 * Bar fill for a stage, 0–100. A stage counts as half done while it runs, so
 * the bar moves the instant the tap lands and never sits at 0 or reaches 100
 * before the workout screen is actually there. Pure.
 */
export function workoutStartPercent(stage: WorkoutStartStage): number {
  return Math.round(((stepIndex(stage) + 0.5) / WORKOUT_START_STEPS.length) * 100);
}

interface WorkoutStartProgressProps {
  stage: WorkoutStartStage;
  /** Hide the step checklist and show only the bar + current step. */
  compact?: boolean;
  className?: string;
}

/**
 * Progress for a workout start: a bar plus the step list with the current
 * step spinning and finished ones ticked. Announced politely (role=status),
 * so a screen reader hears each step too.
 */
export function WorkoutStartProgress({ stage, compact = false, className }: WorkoutStartProgressProps) {
  const current = stepIndex(stage);
  const pct = workoutStartPercent(stage);
  return (
    <div className={cn('w-full', className)} data-testid="workout-start-progress" data-stage={stage}>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-fill"
        role="progressbar"
        aria-label="Starting your workout"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="h-full rounded-full bg-action transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
      </div>
      {compact ? (
        <p role="status" className="mt-1.5 text-caption text-ink-2">
          Step {current + 1} of {WORKOUT_START_STEPS.length}: {WORKOUT_START_STEPS[current].label}…
        </p>
      ) : (
        <ol role="status" className="mt-2 space-y-1" aria-live="polite">
          {WORKOUT_START_STEPS.map((step, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li
                key={step.stage}
                className={cn(
                  'flex items-center gap-2 text-caption',
                  active ? 'font-medium text-ink' : done ? 'text-ink-2' : 'text-ink-3'
                )}
              >
                {done ? (
                  <IconCheck size={14} className="text-status-ok" aria-hidden="true" />
                ) : active ? (
                  <IconLoader2 size={14} className="animate-spin text-action" aria-hidden="true" />
                ) : (
                  <span className="inline-block h-3.5 w-3.5 rounded-full border border-sep" aria-hidden="true" />
                )}
                <span>
                  {step.label}
                  {active ? '…' : ''}
                  {done ? <span className="sr-only"> (done)</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/**
 * Start loading the workout screen as soon as the session id exists, so the
 * push at the end of a start lands on a route that is already on its way.
 * Optimisation only: a failed prefetch changes nothing.
 */
export function prefetchWorkoutRoute(router: { prefetch: (href: string) => void }, sessionId: string): void {
  try {
    router.prefetch(`/dashboard/workout/${sessionId}`);
  } catch {
    // Prefetch is an optimisation only.
  }
}
