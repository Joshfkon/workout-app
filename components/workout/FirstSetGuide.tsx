'use client';

import { useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { useGuidedTour } from '@/hooks/useEducationPreferences';

/**
 * The three guide steps, from what the card already shows. Pure so the copy
 * is testable without the education store.
 */
export function firstSetGuideSteps(input: {
  /** The strip's own "why" line for this set (where the weight came from). */
  source: string | null;
  /** The strip's "Hit 140 lbs × 10 next time → 145 lbs" line, when the engine gives one. */
  nextTime: string | null;
  topReps: number;
}): { title: string; body: string }[] {
  return [
    {
      title: 'Where this weight came from',
      body: input.source
        ? `${input.source}. It’s a starting point — change it if it feels wrong.`
        : 'It’s an estimate from your profile, a starting point — change it if it feels wrong.',
    },
    {
      title: 'What “reps left” means',
      body: 'After each set, tap how many more reps you could have done. That’s how the app knows whether the weight was right, and it sets your next weight from it.',
    },
    {
      title: 'What happens next time',
      body: input.nextTime
        ? `Reach the top of your range (${input.topReps} reps) and the weight goes up: ${input.nextTime}.`
        : `Reach the top of your range (${input.topReps} reps) with reps to spare and the weight goes up next time.`,
    },
  ];
}

/**
 * A short, skippable walkthrough over the first set a user ever logs. Shown
 * once per user: completion (Got it / Skip) is a completed tour in the
 * education store, keyed by the user's id (`tourId`).
 */
export function FirstSetGuide({
  tourId,
  source,
  nextTime,
  topReps,
}: {
  tourId: string;
  source: string | null;
  nextTime: string | null;
  topReps: number;
}) {
  const { shouldShow, complete } = useGuidedTour(tourId);
  const [step, setStep] = useState(0);
  if (!shouldShow) return null;
  const steps = firstSetGuideSteps({ source, nextTime, topReps });
  const current = steps[step];
  const last = step === steps.length - 1;

  return (
    <div
      className="rounded-lg border border-action/30 bg-card px-3 py-2.5"
      role="region"
      aria-label="First set guide"
      data-testid="first-set-guide"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-caption font-semibold text-action">
            First set · {step + 1} of {steps.length}
          </p>
          <p className="mt-0.5 text-subhead font-semibold text-ink">{current.title}</p>
          <p className="mt-0.5 text-subhead text-ink-2" data-testid="first-set-guide-body">
            {current.body}
          </p>
        </div>
        <button
          type="button"
          onClick={complete}
          aria-label="Skip guide"
          className="-m-2 flex h-11 w-11 flex-shrink-0 items-center justify-center text-ink-3"
        >
          <IconX size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={complete}
          className="min-h-[44px] px-3 text-subhead font-medium text-ink-2"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={() => (last ? complete() : setStep(step + 1))}
          className="min-h-[44px] rounded-button bg-action px-4 text-subhead font-semibold text-on-action"
          data-testid="first-set-guide-next"
        >
          {last ? 'Got it' : 'Next'}
        </button>
      </div>
    </div>
  );
}
