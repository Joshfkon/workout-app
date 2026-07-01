'use client';

/**
 * WorkoutHeader.tsx
 *
 * The sticky page header for an in-progress workout: title, sets-completed
 * counter, workout timer (pause/play), time-remaining estimate, collapse-all
 * toggle, the quiet Tools menu (Hurt / Readiness / Plate calculator), and the
 * Cancel / Add / Finish actions.
 *
 * Extracted verbatim from `page.tsx` (Phase 0.2 decomposition) — purely
 * presentational; all state stays in the page.
 */

import { Button } from '@/components/ui';

interface WorkoutTimerView {
  isPaused: boolean;
  formattedTime: string;
  toggle: () => void;
}

interface WorkoutEstimateView {
  totalMinutes: number;
  completedSets: number;
  formattedTotal: string;
  formattedRemaining: string;
}

export interface WorkoutHeaderProps {
  totalCompletedSets: number;
  totalPlannedSets: number;
  /** session.startedAt — timer button renders only when the session has started */
  startedAt: string | null;
  workoutTimer: WorkoutTimerView;
  workoutEstimate: WorkoutEstimateView;
  allCollapsed: boolean;
  onToggleAllCollapsed: () => void;
  showToolsMenu: boolean;
  onToggleToolsMenu: () => void;
  onCloseToolsMenu: () => void;
  injuryCount: number;
  onOpenInjuryModal: () => void;
  onOpenReadinessModal: () => void;
  onOpenPlateCalculator: () => void;
  onCancelWorkout: () => void;
  onAddExercise: () => void;
  onFinishWorkout: () => void;
}

export function WorkoutHeader({
  totalCompletedSets,
  totalPlannedSets,
  startedAt,
  workoutTimer,
  workoutEstimate,
  allCollapsed,
  onToggleAllCollapsed,
  showToolsMenu,
  onToggleToolsMenu,
  onCloseToolsMenu,
  injuryCount,
  onOpenInjuryModal,
  onOpenReadinessModal,
  onOpenPlateCalculator,
  onCancelWorkout,
  onAddExercise,
  onFinishWorkout,
}: WorkoutHeaderProps) {
  return (
    <div className="sticky top-0 z-10 bg-surface-950/95 backdrop-blur py-4 -mx-4 px-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Workout</h1>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <p className="text-surface-400">
              {totalCompletedSets} of {totalPlannedSets} sets completed
            </p>
            {/* Workout timer display with pause/play */}
            {startedAt && (
              <button
                onClick={workoutTimer.toggle}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md text-sm font-mono transition-colors ${
                  workoutTimer.isPaused
                    ? 'bg-warning-500/20 text-warning-400 hover:bg-warning-500/30'
                    : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
                }`}
                title={workoutTimer.isPaused ? 'Resume timer' : 'Pause timer'}
              >
                {workoutTimer.isPaused ? (
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                  </svg>
                )}
                <span>{workoutTimer.formattedTime}</span>
              </button>
            )}
            {/* Estimated time remaining */}
            {workoutEstimate.totalMinutes > 0 && (
              <span
                className="text-sm text-surface-500"
                title={`Total estimated: ${workoutEstimate.formattedTotal}`}
              >
                {workoutEstimate.completedSets > 0
                  ? workoutEstimate.formattedRemaining
                  : workoutEstimate.formattedTotal}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto sm:justify-end">
          <button
            onClick={onToggleAllCollapsed}
            className={`px-3 py-2 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium ${
              allCollapsed
                ? 'bg-primary-500/20 hover:bg-primary-500/30 text-primary-400'
                : 'bg-surface-800 hover:bg-surface-700 text-surface-400'
            }`}
            title={allCollapsed ? 'Expand all exercises' : 'Collapse all exercises'}
          >
            {allCollapsed ? (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                <span className="hidden sm:inline">Expand</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
                <span className="hidden sm:inline">Collapse</span>
              </>
            )}
          </button>
          {/* Secondary tools tucked into one quiet menu (Hurt / Readiness / Plates) */}
          <div className="relative">
            <button
              onClick={onToggleToolsMenu}
              className={`px-3 py-2 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium ${
                injuryCount > 0
                  ? 'bg-warning-500/20 hover:bg-warning-500/30 text-warning-400'
                  : 'bg-surface-800 hover:bg-surface-700 text-surface-400'
              }`}
              title="More tools"
              aria-haspopup="menu"
              aria-expanded={showToolsMenu}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 8a2 2 0 100-4 2 2 0 000 4zm0 6a2 2 0 100-4 2 2 0 000 4zm0 6a2 2 0 100-4 2 2 0 000 4z" />
              </svg>
              <span className="hidden sm:inline">{injuryCount > 0 ? 'Injured' : 'Tools'}</span>
            </button>
            {showToolsMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={onCloseToolsMenu} />
                <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-surface-800 border border-surface-700 rounded-lg shadow-xl py-1" role="menu">
                  <button
                    onClick={() => { onOpenInjuryModal(); onCloseToolsMenu(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-surface-200 hover:bg-surface-700 transition-colors text-left"
                    role="menuitem"
                  >
                    <span>🤕</span>
                    {injuryCount > 0 ? 'Injuries' : 'Hurt?'}
                  </button>
                  <button
                    onClick={() => { onOpenReadinessModal(); onCloseToolsMenu(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-surface-200 hover:bg-surface-700 transition-colors text-left"
                    role="menuitem"
                  >
                    <span>🔋</span>
                    Readiness
                  </button>
                  <button
                    onClick={() => { onOpenPlateCalculator(); onCloseToolsMenu(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-surface-200 hover:bg-surface-700 transition-colors text-left"
                    role="menuitem"
                  >
                    <svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    Plate calculator
                  </button>
                </div>
              </>
            )}
          </div>
          <Button
            variant="ghost"
            onClick={onCancelWorkout}
            className="text-surface-400 hover:text-danger-400 flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button variant="ghost" onClick={onAddExercise} className="flex-1 sm:flex-none">
            <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add
          </Button>
          <Button variant="outline" onClick={onFinishWorkout} className="flex-1 sm:flex-none">
            Finish
          </Button>
        </div>
      </div>
    </div>
  );
}
