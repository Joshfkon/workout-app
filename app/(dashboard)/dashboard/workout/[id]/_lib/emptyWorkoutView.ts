/**
 * Which body the workout page renders for a session.
 *
 * An empty session renders the normal active-workout page (header, timer,
 * tools menu, gym pill) with the empty-state panel where the exercise list
 * goes. The target-picker plan builder is opt-in ("Build a plan for me"): only
 * then does the page swap to the setup flow, and its "Build manually" returns
 * to the empty workout page. As soon as the session has a block, the exercise
 * list takes over whatever the setup mode was.
 */

export type EmptySetupMode = 'manual' | 'plan';

export type WorkoutBodyView = 'plan-setup' | 'empty' | 'exercises';

export function resolveWorkoutBodyView(blockCount: number, setupMode: EmptySetupMode): WorkoutBodyView {
  if (blockCount > 0) return 'exercises';
  return setupMode === 'plan' ? 'plan-setup' : 'empty';
}
