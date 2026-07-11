'use client';

/**
 * WorkoutHeader.tsx
 *
 * Slim sticky header for an in-progress workout (Phase 2.3, per mockup):
 * - left: workout name over "{elapsed} · exercise {n} of {total}"
 * - right: per-exercise progress segments (completed / active / pending),
 *   compact Finish button, and an overflow menu holding the secondary
 *   actions (Add exercise, collapse-all, injuries, readiness, plates, Cancel).
 *
 * Purely presentational; all state stays in the page.
 */

import {
  IconActivity,
  IconBandage,
  IconBarbell,
  IconChevronLeft,
  IconChevronsDown,
  IconChevronsUp,
  IconDotsVertical,
  IconGauge,
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

export function WorkoutHeader({
  workoutName,
  exerciseNumber,
  exerciseTotal,
  segments,
  startedAt,
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
  onCancelWorkout,
  onAddExercise,
  onFinishWorkout,
  onMinimize,
}: WorkoutHeaderProps) {
  const menuItemClass =
    'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-surface-200 hover:bg-surface-700 transition-colors text-left';

  return (
    // z-30: must sit above ExerciseCard's sticky header (z-10) and its menus (z-20) so the overflow menu isn't clipped
    <div className="sticky top-0 z-30 bg-surface-950/95 backdrop-blur py-3 -mx-4 px-4">
      <div className="flex items-center gap-3">
        {/* Minimize (back) — leaves the session running and returns to Train */}
        <button
          onClick={onMinimize}
          aria-label="Minimize workout"
          title="Minimize workout"
          className="w-11 h-11 -ml-2 flex-shrink-0 flex items-center justify-center rounded-lg text-surface-400 hover:bg-surface-800 hover:text-surface-200 transition-colors"
        >
          <IconChevronLeft size={22} stroke={2.25} />
        </button>

        {/* Left: name + elapsed / position meta */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-surface-100 truncate">{workoutName}</p>
          <div className="flex items-center gap-1 text-[11px] text-surface-500">
            {startedAt && (
              <>
                <button
                  onClick={workoutTimer.toggle}
                  className={`inline-flex items-center gap-1 tabular-nums transition-colors ${
                    workoutTimer.isPaused
                      ? 'text-warning-400 hover:text-warning-300'
                      : 'hover:text-surface-300'
                  }`}
                  title={workoutTimer.isPaused ? 'Resume timer' : 'Pause timer'}
                >
                  {workoutTimer.isPaused ? (
                    <IconPlayerPlay size={11} stroke={2} />
                  ) : (
                    <IconPlayerPause size={11} stroke={2} />
                  )}
                  {workoutTimer.formattedTime}
                </button>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span>
              exercise {exerciseNumber} of {exerciseTotal}
            </span>
          </div>
        </div>

        {/* Right: progress segments + Finish + overflow menu */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="hidden min-[360px]:flex items-center gap-1" aria-hidden="true">
            {segments.map((status, i) => (
              <span
                key={i}
                className={`w-3.5 h-1 rounded-full ${SEGMENT_CLASS[status]}`}
              />
            ))}
          </div>
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
    </div>
  );
}
