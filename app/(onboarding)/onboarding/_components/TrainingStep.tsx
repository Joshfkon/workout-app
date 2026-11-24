'use client';

import { IconCheck } from '@tabler/icons-react';
import { Button } from '@/components/ui';
import { ProTag } from '@/components/subscription/ProTag';
import type { Goal as NutritionGoal } from '@/lib/nutrition/macroCalculator';
import type { TrainingGoal } from '@/lib/onboarding/onboardingProgress';
import {
  SPLIT_OPTIONS,
  TRAINING_DAY_OPTIONS,
  formatRatePercent,
  rateAmountPerWeek,
  rateOptionsForGoal,
  type TrainingSetupAnswers,
} from '@/lib/onboarding/trainingSetup';
import type { WeightUnit } from '@/types/schema';

export interface TrainingStepProps {
  answers: TrainingSetupAnswers;
  onChange: (answers: TrainingSetupAnswers) => void;
  goal: TrainingGoal | null;
  /** The pace the starter targets use when no rate is picked (shown as picked). */
  defaultRate: NutritionGoal | null;
  /**
   * New food targets will be created, so a picked rate is used. False when
   * the user already has targets or calculator settings: those are kept and
   * the rate question is replaced by a pointer to Eat.
   */
  rateApplies: boolean;
  weightKg: number;
  units: WeightUnit;
  /** Daily targets with the current answers (null when they can't be worked out). */
  targets: { calories: number; protein: number } | null;
  /**
   * Daily targets Skip would create (no pace or days picked), for the line
   * that says what Skip uses. Null when none would be created.
   */
  skipTargets?: { calories: number; protein: number } | null;
  /** Which button is saving; null = idle. */
  busy: 'continue' | 'skip' | null;
  onBack: () => void;
  onSkip: () => void;
  onContinue: () => void;
}

const chip = (selected: boolean) =>
  `min-h-[44px] px-3 rounded-full border text-body font-medium transition-colors active:scale-[0.97] ${
    selected ? 'bg-action/10 border-action text-ink' : 'bg-card border-sep text-ink-2 hover:text-ink'
  }`;

/**
 * Optional, one screen, lifters only: how they train now and (bulk or cut)
 * how fast. Every answer is optional; Skip saves none of them. Storage:
 * lib/onboarding/trainingSetup.
 */
export function TrainingStep({
  answers,
  onChange,
  goal,
  defaultRate,
  rateApplies,
  weightKg,
  units,
  targets,
  skipTargets = null,
  busy,
  onBack,
  onSkip,
  onContinue,
}: TrainingStepProps) {
  const rates = rateOptionsForGoal(goal);
  const pickedRate = answers.rate ?? defaultRate;
  const isBusy = busy !== null;
  const skipLine = skipDefaultsLine({ goal, defaultRate, rateApplies, skipTargets });

  return (
    <div className="max-w-md mx-auto space-y-6 animate-fade-in" data-testid="onboarding-training-step">
      <div className="flex items-center justify-center gap-2 mb-8" aria-hidden="true">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-subhead font-medium ${
                s <= 2 ? 'bg-action text-on-action' : 'bg-fill text-ink-3'
              }`}
            >
              {s}
            </div>
            {s < 4 && <div className={`w-12 h-0.5 ${s < 2 ? 'bg-action' : 'bg-fill'}`} />}
          </div>
        ))}
      </div>

      <div className="text-center">
        <h1 className="text-large-title font-bold text-ink mb-2">How do you train now?</h1>
        <p className="text-ink-2">
          Optional. Answer what you know and skip the rest. It starts your first training plan
          from how you already train.
        </p>
        {/* Say what's paid where the plan is first offered, not after setup
            (UX panel round 19: an advanced lifter found the Pro label on
            "Build a program" only on Home). The free path is named first. */}
        <p className="mt-3 rounded-lg bg-fill px-3 py-2 text-left text-caption text-ink-2" data-testid="onboarding-pro-note">
          Logging workouts, your history and progress are free. Building a multi-week program
          (a training block) is a <ProTag feature="mesocycleBuilder" className="align-middle" /> feature
          you can try free for your first 14 days.
        </p>
      </div>

      <div role="radiogroup" aria-labelledby="training-days-label" className="space-y-2">
        <p id="training-days-label" className="text-headline font-semibold text-ink">
          Days a week you lift
        </p>
        <div className="flex flex-wrap gap-2">
          {TRAINING_DAY_OPTIONS.map((d) => {
            const selected = answers.daysPerWeek === d;
            return (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`training-days-${d}`}
                onClick={() => onChange({ ...answers, daysPerWeek: selected ? null : d })}
                className={`${chip(selected)} min-w-[44px]`}
              >
                {d}
              </button>
            );
          })}
        </div>
      </div>

      <div role="radiogroup" aria-labelledby="training-split-label" className="space-y-2">
        <p id="training-split-label" className="text-headline font-semibold text-ink">
          Your split right now
        </p>
        <div className="flex flex-wrap gap-2">
          {SPLIT_OPTIONS.map((o) => {
            const selected = answers.split === o.value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`training-split-${o.value}`}
                onClick={() => onChange({ ...answers, split: selected ? null : o.value })}
                className={chip(selected)}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      {rates.length > 0 && (
        <div className="space-y-2" data-testid="training-rate">
          <p id="training-rate-label" className="text-headline font-semibold text-ink">
            {goal === 'bulk' ? 'How fast to gain' : 'How fast to lose'}
          </p>
          {rateApplies ? (
            <>
              <div role="radiogroup" aria-labelledby="training-rate-label" className="space-y-2">
                {rates.map((r) => {
                  const selected = pickedRate === r.value;
                  const amount = rateAmountPerWeek(r.percentBW, weightKg, units);
                  return (
                    <button
                      key={r.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      data-testid={`training-rate-${r.value}`}
                      onClick={() => onChange({ ...answers, rate: r.value })}
                      className={`w-full text-left p-3 rounded-xl border-2 flex items-start gap-3 transition-colors active:scale-[0.99] ${
                        selected ? 'bg-action/10 border-action' : 'bg-card border-sep'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 w-5 h-5 flex-shrink-0 rounded-full border-2 flex items-center justify-center ${
                          selected ? 'border-action bg-action text-on-action' : 'border-sep'
                        }`}
                      >
                        {selected && <IconCheck size={13} stroke={3} />}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-semibold text-ink">{r.name}</span>
                        <span className="block text-body text-ink-2">
                          {formatRatePercent(r.percentBW)}
                          {amount ? ` (${amount})` : ''}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {targets && (
                <p className="text-subhead text-ink-2" data-testid="training-rate-targets">
                  Daily targets at this pace:{' '}
                  <span className="font-semibold text-ink tabular-nums">
                    {targets.calories.toLocaleString()} kcal · {Math.round(targets.protein)} g protein
                  </span>
                  . Change them any time in Eat.
                </p>
              )}
            </>
          ) : (
            <p className="text-body text-ink-2" data-testid="training-rate-kept">
              Your current food targets are kept. Change your pace any time in Eat.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-2">
        <Button variant="ghost" onClick={onBack} disabled={isBusy}>
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={onSkip}
            disabled={isBusy}
            isLoading={busy === 'skip'}
            aria-busy={busy === 'skip'}
            data-testid="training-skip"
            className="active:scale-[0.97]"
          >
            {busy === 'skip' ? 'Using defaults…' : 'Skip'}
          </Button>
          <Button
            size="lg"
            onClick={onContinue}
            disabled={isBusy}
            isLoading={busy === 'continue'}
            aria-busy={busy === 'continue'}
            data-testid="training-continue"
            className="active:scale-[0.97]"
          >
            {busy === 'continue' ? 'Saving…' : 'Continue'}
          </Button>
        </div>
      </div>
      {/* What Skip means, before and while it saves: the panel saw a bare
          "Skipping…" and was never told a moderate cut had been picked
          (round 19). */}
      <p
        role="status"
        aria-live="polite"
        className="text-subhead text-ink-2"
        data-testid="training-skip-defaults"
      >
        {busy === 'skip' ? `Skipped. ${skipLine} Opening the next step…` : skipLine}
      </p>
    </div>
  );
}

/**
 * The one line under the buttons saying what Skip keeps: the default pace by
 * name and the daily targets it gives, or that the plan starts from the goal.
 * Pure (exported for tests).
 */
export function skipDefaultsLine({
  goal,
  defaultRate,
  rateApplies,
  skipTargets,
}: {
  goal: TrainingGoal | null;
  defaultRate: NutritionGoal | null;
  rateApplies: boolean;
  skipTargets: { calories: number; protein: number } | null;
}): string {
  const rateName = rateOptionsForGoal(goal).find((r) => r.value === defaultRate)?.name ?? null;
  const plan = 'your first plan starts from your goal and experience.';
  if (rateApplies && rateName) {
    const targets = skipTargets
      ? ` (${skipTargets.calories.toLocaleString()} kcal · ${Math.round(skipTargets.protein)} g protein a day)`
      : '';
    return `Skip uses the default pace, ${rateName.toLowerCase()}${targets}, and ${plan} Change either any time.`;
  }
  return `Skip keeps your goal, and ${plan} Change it any time.`;
}
