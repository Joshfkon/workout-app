/**
 * Which goal onboarding's goal step starts on. Pure.
 *
 * The product owner keeps a preselection (Continue works in one tap), so the
 * job here is to preselect the RIGHT one when there is any earlier answer,
 * and otherwise fall back to Maintain with the step saying so:
 * 1. a goal this step saved before (re-entering onboarding);
 * 2. the direction of food targets already set up in Eat (macro_settings.goal);
 * 3. else Maintain ('default').
 */
import type { TrainingGoal } from '@/lib/onboarding/onboardingProgress';

export type GoalPreselection = 'default' | 'saved' | 'nutrition';

export function earlierGoalAnswer(
  savedGoal: TrainingGoal | null,
  macroSettingsGoal: string | null
): { goal: TrainingGoal; source: Exclude<GoalPreselection, 'default'> } | null {
  if (savedGoal) return { goal: savedGoal, source: 'saved' };
  if (macroSettingsGoal) {
    if (macroSettingsGoal.endsWith('_cut')) return { goal: 'cut', source: 'nutrition' };
    if (macroSettingsGoal.endsWith('_bulk')) return { goal: 'bulk', source: 'nutrition' };
    if (macroSettingsGoal === 'maintain') return { goal: 'maintenance', source: 'nutrition' };
  }
  return null;
}

/** The line above the goal options while the preselection stands. */
export function preselectionNote(source: GoalPreselection, foodFocus: boolean): string {
  if (source === 'saved') return 'Picked from the goal you saved earlier. Tap another if it has changed.';
  if (source === 'nutrition') {
    return 'Picked from the food targets you already set up. Tap another if it has changed.';
  }
  return foodFocus
    ? 'Maintain is picked to start. Want to lose or gain weight? Tap that one instead.'
    : 'Maintain is picked to start. Cutting or bulking? Tap Lose fat or Build muscle instead.';
}
