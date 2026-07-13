'use client';

/**
 * WorkoutHeader.tsx
 *
 * Slim sticky header for an in-progress workout (Phase 2.3, per mockup):
 * - top row: workout name + "exercise {n} of {total}", a tappable timer
 *   pill, a compact Finish button, and an overflow menu holding the
 *   secondary actions (Add exercise, collapse-all, injuries, readiness,
 *   plates, Cancel).
 * - progress row: full-width per-exercise progress that can never collide
 *   with the timer/count text (own row). ≤8 exercises render as individual
 *   segments; >8 collapse to a single continuous fill bar (completed/total),
 *   because a dozen tiny dashes aren't readable progress.
 *
 * Purely presentational; all state stays in the page. The timer pill toggles
 * pause/resume through the existing `workoutTimer.toggle` — no new
 * session-state logic here.
 */

import {
  IconActivity,
  IconBandage,
  IconBarbell,
  IconChevronLeft,
  IconChevronsDown,
  IconChevronsUp,
  IconClock,
  IconDotsVertical,
  IconGauge,
  IconMoon,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconX,
} from '@tabler/icons-react';

interface WorkoutTimerView {
  isPaused: boolean;
  formattedTime: string;
  toggle: () => void;
}

export type ExerciseSegmentStatus = 'completed' | 'active' | 'pending';

export interface WorkoutHeaderProps {
  /** Workout display name (e.g. "Push", "Upper Body"). */
  workoutName: string;
  /** 1-based position of the active exercise among non-skipped exercises. */
  exerciseNumber: number;
  /** Total non-skipped exercises. */
  exerciseTotal: number;
  /** One entry per non-skipped exercise, in workout order. */
  segments: ExerciseSegmentStatus[];
  /** session.startedAt — elapsed time renders only when the session has started */
  startedAt: string | null;
  /**
   * Whether the workout timer has its anchor (the first set has been logged).
   * Until then the pill is a muted, non-interactive "starts with first set"
   * hint — there is no elapsed time to show or pause.
   */
  timerStarted: boolean;
  workoutTimer: WorkoutTimerView;
  allCollapsed: boolean;
  onToggleAllCollapsed: () => void;
  showToolsMenu: boolean;
  onToggleToolsMenu: () => void;
  onCloseToolsMenu: () => void;
  injuryCount: number;
  onOpenInjuryModal: () => void;
  onOpenReadinessModal: () => void;
  /** Opens the "which muscles should I hit today?" volume + recovery sheet. */
  onOpenMuscleReadiness: () => void;
  onOpenPlateCalculator: () => void;
  /** Whether this session is currently flagged as a deload (light) session. */
  isDeload: boolean;
  /** Toggle the deload flag for this session (held light, excluded from PRs/trends). */
  onToggleDeload: () => void;
  onCancelWorkout: () => void;
  onAddExercise: () => void;
  onFinishWorkout: () => void;
  /**
   * Minimize the workout (P0-3): navigate back to the Train tab WITHOUT
   * touching session state — the session stays in_progress and the
   * ResumeWorkoutBanner offers the way back from every other tab.
   */
  onMinimize: () => void;
}

const SEGMENT_CLASS: Record<ExerciseSegmentStatus, string> = {
  completed: 'bg-success-500',
  active: 'bg-primary-500',
  pending: 'bg-surface-800',
};

// Above this many exercises, individual dashes stop reading as progress —
// switch to a single continuous fill bar (completed / total).
const MAX_SEGMENTED_EXERCISES = 8;

export function WorkoutHeader({
  workoutName,
  exerciseNumber,
  exerciseTotal,
  segments,
  startedAt,
  timerStarted,
  workoutTimer,
  allCollapsed,
  onToggleAllCollapsed,
  showToolsMenu,
  onToggleToolsMenu,
  onCloseToolsMenu,
  injuryCount,
  onOpenInjuryModal,
  onOpenReadinessModal,
  onOpenMuscleReadiness,
  onOpenPlateCalculator,
  isDeload,
  onToggleDeload,
  onCancelWorkout,
  onAddExercise,
  onFinishWorkout,
  onMinimize,
}: WorkoutHeaderProps) {
  const menuItemClass =
    'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-surface-200 hover:bg-surface-700 transition-colors text-left';

  const useSegments = exerciseTotal <= MAX_SEGMENTED_EXERCISES;
  const completedCount = segments.filter((s) => s === 'completed').length;
  const fillPct =
    exerciseTotal > 0
      ? Math.min(100, Math.round((completedCount / exerciseTotal) * 100))
      : 0;

  return (
    // z-30: must sit above ExerciseCard's sticky header (z-10) and its menus (z-20) so the overflow menu isn't clipped
    <div className="sticky top-0 z-30 bg-surface-950/95 backdrop-blur py-3 -mx-4 px-4">
      {/* Top row: back · name + count · timer pill · Finish · menu */}
      <div className="flex items-center gap-2.5">
        {/* Minimize (back) — leaves the session running and returns to Train */}
        <button
          onClick={onMinimize}
          aria-label="Minimize workout"
          title="Minimize workout"
          className="w-11 h-11 -ml-2 flex-shrink-0 flex items-center justify-center rounded-lg text-surface-400 hover:bg-surface-800 hover:text-surface-200 transition-colors"
        >
          <IconChevronLeft size={22} stroke={2.25} />
        </button>

        {/* Left: name + position meta */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-surface-100 truncate">{workoutName}</p>
          <p className="text-[11px] text-surface-500 truncate">
            exercise {exerciseNumber} of {exerciseTotal}
          </p>
        </div>

        {/* Timer pill — before the first set logs there is no elapsed time,
            so render a muted non-interactive hint instead of "⏸ 0:00" (no
            pause affordance for a timer that isn't running). Once set 1 lands
            it becomes the tappable pause/resume pill, ≥44pt hit area; paused
            state is unmistakable: amber fill, ▶ icon, "Paused · m:ss". */}
        {startedAt && !timerStarted && (
          <div
            data-testid="workout-timer-pill-idle"
            className="inline-flex items-center gap-1.5 flex-shrink-0 min-h-[44px] px-3 rounded-full border border-surface-800 bg-surface-900/60 text-xs font-medium text-surface-500"
            title="Timer starts with your first set"
          >
            <IconClock size={16} stroke={2} />
            <span>starts with first set</span>
          </div>
        )}
        {startedAt && timerStarted && (
          <button
            onClick={workoutTimer.toggle}
            data-testid="workout-timer-pill"
            data-paused={workoutTimer.isPaused ? 'true' : 'false'}
            aria-pressed={workoutTimer.isPaused}
            className={`inline-flex items-center gap-1.5 flex-shrink-0 min-h-[44px] px-3 rounded-full border text-sm font-medium tabular-nums transition-colors ${
              workoutTimer.isPaused
                ? 'bg-warning-500/20 border-warning-500/50 text-warning-400 hover:bg-warning-500/30'
                : 'bg-surface-800/70 border-surface-700 text-surface-200 hover:bg-surface-700 hover:border-surface-600'
            }`}
            title={workoutTimer.isPaused ? 'Resume timer' : 'Pause timer'}
            aria-label={
              workoutTimer.isPaused
                ? `Paused at ${workoutTimer.formattedTime}. Resume timer.`
                : `Elapsed ${workoutTimer.formattedTime}. Pause timer.`
            }
          >
            {workoutTimer.isPaused ? (
              <IconPlayerPlay size={16} stroke={2.25} />
            ) : (
              <IconPlayerPause size={16} stroke={2.25} />
            )}
            <span>
              {workoutTimer.isPaused
                ? `Paused · ${workoutTimer.formattedTime}`
                : workoutTimer.formattedTime}
            </span>
          </button>
        )}

        {/* Right: Finish + overflow menu */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <button
            onClick={onFinishWorkout}
            className="px-4 min-h-[44px] rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-400 active:bg-primary-600 transition-colors"
          >
            Finish
          </button>
          <div className="relative">
            <button
              onClick={onToggleToolsMenu}
              className={`w-11 h-11 flex items-center justify-center rounded-lg transition-colors ${
                injuryCount > 0
                  ? 'bg-warning-500/20 text-warning-400 hover:bg-warning-500/30'
                  : 'text-surface-400 hover:bg-surface-800 hover:text-surface-200'
              }`}
              title="More actions"
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={showToolsMenu}
            >
              <IconDotsVertical size={20} stroke={2} />
            </button>
            {showToolsMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={onCloseToolsMenu} />
                <div
                  className="absolute right-0 top-full mt-1 z-20 w-48 bg-surface-800 border border-surface-700 rounded-lg shadow-xl py-1"
                  role="menu"
                >
                  <button
                    onClick={() => { onAddExercise(); onCloseToolsMenu(); }}
                    className={menuItemClass}
                    role="menuitem"
                  >
                    <IconPlus size={16} className="text-surface-400" />
                    Add exercise
                  </button>
                  <button
                    onClick={() => { onToggleAllCollapsed(); onCloseToolsMenu(); }}
                    className={menuItemClass}
                    role="menuitem"
                  >
                    {allCollapsed ? (
                      <IconChevronsDown size={16} className="text-surface-400" />
                    ) : (
                      <IconChevronsUp size={16} className="text-surface-400" />
                    )}
                    {allCollapsed ? 'Expand all' : 'Collapse all'}
                  </button>
                  <button
                    onClick={() => { onOpenInjuryModal(); onCloseToolsMenu(); }}
                    className={menuItemClass}
                    role="menuitem"
                  >
                    <IconBandage
                      size={16}
                      className={injuryCount > 0 ? 'text-warning-400' : 'text-surface-400'}
                    />
                    {injuryCount > 0 ? `Injuries (${injuryCount})` : 'Hurt?'}
                  </button>
                  <button
                    onClick={() => { onOpenReadinessModal(); onCloseToolsMenu(); }}
                    className={menuItemClass}
                    role="menuitem"
                  >
                    <IconActivity size={16} className="text-surface-400" />
                    Readiness
                  </button>
                  <button
                    onClick={() => { onOpenMuscleReadiness(); onCloseToolsMenu(); }}
                    className={menuItemClass}
                    role="menuitem"
                    data-testid="readiness-sheet-trigger"
                  >
                    <IconGauge size={16} className="text-surface-400" />
                    What to train
                  </button>
                  <button
                    onClick={() => { onOpenPlateCalculator(); onCloseToolsMenu(); }}
                    className={menuItemClass}
                    role="menuitem"
                  >
                    <IconBarbell size={16} className="text-surface-400" />
                    Plate calculator
                  </button>
                  <button
                    onClick={() => { onToggleDeload(); onCloseToolsMenu(); }}
                    className={menuItemClass}
                    role="menuitemcheckbox"
                    aria-checked={isDeload}
                  >
                    <IconMoon
                      size={16}
                      className={isDeload ? 'text-primary-400' : 'text-surface-400'}
                    />
                    {isDeload ? 'Deload session ✓' : 'Mark as deload'}
                  </button>
                  <div className="my-1 border-t border-surface-700" />
                  <button
                    onClick={() => { onCancelWorkout(); onCloseToolsMenu(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-danger-400 hover:bg-surface-700 transition-colors text-left"
                    role="menuitem"
                  >
                    <IconX size={16} />
                    Cancel workout
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Progress row — its own row so per-exercise progress can never collide
          with the timer/count text above. ≤8 exercises: individual segments;
          >8: a single continuous fill bar (completed / total). */}
      {exerciseTotal > 0 && (
        useSegments ? (
          <div
            data-testid="workout-progress-segments"
            className="flex items-center gap-1 mt-2"
            role="img"
            aria-label={`Progress: ${completedCount} of ${exerciseTotal} exercises complete`}
          >
            {segments.map((status, i) => (
              <span
                key={i}
                className={`flex-1 h-1.5 rounded-full ${SEGMENT_CLASS[status]}`}
              />
            ))}
          </div>
        ) : (
          <div
            data-testid="workout-progress-bar"
            className="mt-2 h-1.5 rounded-full bg-surface-800 overflow-hidden"
            role="img"
            aria-label={`Progress: ${completedCount} of ${exerciseTotal} exercises complete`}
          >
            <div
              data-testid="workout-progress-bar-fill"
              className="h-full rounded-full bg-success-500 transition-[width] duration-300"
              style={{ width: `${fillPct}%` }}
            />
          </div>
        )
      )}
    </div>
  );
}
