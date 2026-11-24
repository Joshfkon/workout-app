'use client';

import { IconCheck } from '@tabler/icons-react';

/**
 * The one step indicator for setup: numbered dots plus "Step 3 of 5: Goal"
 * in words, so where you are (and how much is left) reads without counting
 * dots. Every onboarding screen renders it with its own step, so it always
 * moves forward (UX panel round 20: the dots sat on 2 for four screens).
 */

export type OnboardingStepKey = 'body' | 'goal' | 'training' | 'strength';

const STEP_LABELS: Record<OnboardingStepKey, string> = {
  // Units and text size share this screen (UX panel round 22: "Setup is too
  // long, many screens"; units had a screen of its own).
  body: 'Units and your body',
  goal: 'Goal',
  training: 'How you train',
  strength: 'Strength test (optional)',
};

/** Food-only users finish at the goal step. Pure (exported for tests). */
export function onboardingStepKeys(foodFocus: boolean): OnboardingStepKey[] {
  return foodFocus ? ['body', 'goal'] : ['body', 'goal', 'training', 'strength'];
}

export function OnboardingSteps({
  current,
  foodFocus = false,
  allDone = false,
  showLaterNote = false,
}: {
  current: OnboardingStepKey;
  foodFocus?: boolean;
  /** Setup finished (the strength profile screen): every dot checked. */
  allDone?: boolean;
  /** "Skipped something? It can be filled in later." under the dots. */
  showLaterNote?: boolean;
}) {
  const keys = onboardingStepKeys(foodFocus);
  const index = Math.max(0, keys.indexOf(current));
  return (
    <div className="mb-8 space-y-2" data-testid="onboarding-steps">
      <ol className="flex items-center justify-center" aria-hidden="true">
        {keys.map((key, i) => {
          const done = allDone || i < index;
          const active = !allDone && i === index;
          return (
            <li key={key} className="flex items-center">
              <span
                className={`w-8 h-8 rounded-full flex items-center justify-center text-subhead font-medium ${
                  done || active ? 'bg-action text-on-action' : 'bg-fill text-ink-3'
                } ${active ? 'ring-2 ring-action/40 ring-offset-2 ring-offset-canvas' : ''}`}
              >
                {done ? <IconCheck size={16} stroke={3} /> : i + 1}
              </span>
              {i < keys.length - 1 && (
                <span className={`w-6 sm:w-10 h-0.5 ${i < index || allDone ? 'bg-action' : 'bg-fill'}`} />
              )}
            </li>
          );
        })}
      </ol>
      <p className="text-center text-body font-medium text-ink-2" data-testid="onboarding-step-label">
        {allDone
          ? 'Setup complete'
          : `Step ${index + 1} of ${keys.length}: ${STEP_LABELS[keys[index]]}`}
      </p>
      {showLaterNote && (
        <p className="text-center text-subhead text-ink-2" data-testid="onboarding-later-note">
          Anything optional you skip can be filled in later: profile and goal in Settings, food
          targets in Eat, strength tests in Progress.
        </p>
      )}
    </div>
  );
}
