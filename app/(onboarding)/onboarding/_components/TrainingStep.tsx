'use client';

import { useState } from 'react';
import { IconCheck } from '@tabler/icons-react';
import { Button, Input } from '@/components/ui';
import { OnboardingSteps } from '@/components/onboarding/OnboardingSteps';
import { ProTag } from '@/components/subscription/ProTag';
import type { Goal as NutritionGoal } from '@/lib/nutrition/macroCalculator';
import { DailyTargetsCard, type DailyTargetsCardProps } from './DailyTargetsCard';
import type { TrainingGoal } from '@/lib/onboarding/onboardingProgress';
import {
  SKIP_DEFAULT_DAYS,
  SKIP_DEFAULT_SPLIT_LABEL,
  SPLIT_OPTIONS,
  TRAINING_DAY_OPTIONS,
  cappedLossPercent,
  customChangeForGoal,
  formatRatePercent,
  formatWeeklyChange,
  parseCustomRate,
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
  /**
   * The cut guardrail at the user's body fat (lossCapFor), so a pace above
   * it says what the targets really use. Null = no cap to show (not a cut).
   */
  lossCap?: { percentBW: number; bodyFatPercent: number | null } | null;
  /** Daily targets with the current answers (null when they can't be worked out). */
  targets: { calories: number; protein: number } | null;
  /**
   * Daily targets Skip would create (no pace or days picked), for the line
   * that says what Skip uses. Null when none would be created.
   */
  skipTargets?: { calories: number; protein: number } | null;
  /**
   * The working and the Edit for the targets above (breakdown, overrides,
   * handlers). Null = show the plain line only.
   */
  targetsCard?: Pick<
    DailyTargetsCardProps,
    | 'calorieBasis'
    | 'proteinBasis'
    | 'goalName'
    | 'sex'
    | 'calorieOverride'
    | 'proteinOverride'
    | 'onCaloriesChange'
    | 'onProteinChange'
  > | null;
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
  lossCap = null,
  targets,
  skipTargets = null,
  targetsCard = null,
  busy,
  onBack,
  onSkip,
  onContinue,
}: TrainingStepProps) {
  const rates = rateOptionsForGoal(goal);
  // A typed pace (kg or lb a week) replaces the preset levels while set.
  const customKg = customChangeForGoal(goal, answers.weeklyChangeKg);
  const pickedRate = customKg !== null ? null : (answers.rate ?? defaultRate);
  const isBusy = busy !== null;
  // ONE figure on screen: the targets line is what Continue saves; Skip's
  // line quotes a number only when it's that same number.
  const answersChangeTargets =
    !!targets && !!skipTargets &&
    (targets.calories !== skipTargets.calories || Math.round(targets.protein) !== Math.round(skipTargets.protein));
  const skipLine = skipDefaultsLine({ goal, defaultRate, rateApplies, skipTargets, answersChangeTargets });
  const [customText, setCustomText] = useState(() =>
    customKg !== null
      ? String(Math.round(Math.abs(units === 'lb' ? customKg * 2.20462 : customKg) * 100) / 100)
      : ''
  );
  const custom = parseCustomRate(customText, units, goal, weightKg);

  return (
    <div className="max-w-md mx-auto space-y-6 animate-fade-in" data-testid="onboarding-training-step">
      <OnboardingSteps current="training" />

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
          Days a week you lift <span className="font-normal text-ink-2">(optional)</span>
        </p>
        {/* Why, one line, at the question (UX round 23). */}
        <p className="text-subhead text-ink-2" data-testid="training-days-why">
          {TRAINING_DAYS_WHY}
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
          Your split right now <span className="font-normal text-ink-2">(optional)</span>
        </p>
        <p className="text-subhead text-ink-2" data-testid="training-split-why">
          {TRAINING_SPLIT_WHY}
        </p>
        {/* What each split's days look like, in plain words (UX panel
            round 21: "split and days step uses jargon"). */}
        <div className="space-y-2">
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
                className={`w-full min-h-[44px] text-left px-3 py-2 rounded-xl border transition-colors active:scale-[0.99] ${
                  selected ? 'bg-action/10 border-action' : 'bg-card border-sep'
                }`}
              >
                <span className="block text-body font-semibold text-ink">{o.label}</span>
                <span className="block text-subhead text-ink-2">{o.description}</span>
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
              {goal === 'cut' && lossCap && rates.some((r) => cappedLossPercent(r.percentBW, lossCap) !== null) && (
                <p className="text-subhead text-ink-2" data-testid="training-rate-cap-note">
                  {lossCapNote(lossCap)}
                </p>
              )}
              <div role="radiogroup" aria-labelledby="training-rate-label" className="space-y-2">
                {rates.map((r) => {
                  const selected = pickedRate === r.value;
                  const amount = rateAmountPerWeek(r.percentBW, weightKg, units);
                  // Above the cap the targets use the cap: say so on the
                  // option, so it agrees with the working below (UX round
                  // 23: "about −0.43 kg" here, "about 0.26 kg" in the sum).
                  const held = goal === 'cut' ? cappedLossPercent(r.percentBW, lossCap) : null;
                  const heldAmount = held !== null ? rateAmountPerWeek(-held, weightKg, units) : null;
                  return (
                    <button
                      key={r.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      data-testid={`training-rate-${r.value}`}
                      onClick={() => {
                        setCustomText('');
                        onChange({ ...answers, rate: r.value, weeklyChangeKg: null });
                      }}
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
                          {held === null && amount ? ` (${amount})` : ''}
                        </span>
                        {held !== null && (
                          <span className="block text-subhead text-ink-2" data-testid={`training-rate-held-${r.value}`}>
                            Held to −{held}%{heldAmount ? ` (${heldAmount})` : ''} at your body fat
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* The pace in the user's own unit (UX round 21: "I wanted
                  0.25 kg/wk and couldn't set it directly"), % alongside. */}
              <div className="space-y-1" data-testid="training-rate-custom">
                <Input
                  label={`Or set your own pace (${units} a week)`}
                  type="number"
                  inputMode="decimal"
                  step="0.05"
                  min={0}
                  value={customText}
                  placeholder={units === 'lb' ? '0.5' : '0.25'}
                  onChange={(e) => {
                    const text = e.target.value;
                    setCustomText(text);
                    const parsed = parseCustomRate(text, units, goal, weightKg);
                    const next = parsed.ok ? parsed.weeklyChangeKg : null;
                    if (next !== answers.weeklyChangeKg) onChange({ ...answers, weeklyChangeKg: next });
                  }}
                  error={!custom.ok && custom.error ? custom.error : undefined}
                  data-testid="training-rate-custom-input"
                />
                {custom.ok && (
                  <p className="text-subhead text-ink-2" data-testid="training-rate-custom-percent">
                    {goal === 'bulk' ? 'Gain' : 'Lose'} {formatWeeklyChange(custom.weeklyChangeKg, units).replace(/^[+−]/, '')}
                    {' '}= {custom.percentBW}% of your body weight a week.
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="text-body text-ink-2" data-testid="training-rate-kept">
              Your current food targets are kept. Change your pace any time in Eat.
            </p>
          )}
        </div>
      )}

      {rateApplies && targets && targetsCard ? (
        <DailyTargetsCard
          {...targetsCard}
          calories={targets.calories}
          protein={targets.protein}
          units={units}
          heading={answersChangeTargets ? 'Your daily targets, updated for your answers' : 'Your daily targets'}
          footnote="This is what Continue saves. Change them any time in Eat."
          data-testid="training-rate-targets"
        />
      ) : rateApplies && targets ? (
        <p className="text-subhead text-ink-2" data-testid="training-rate-targets">
          Your daily targets:{' '}
          <span className="font-semibold text-ink tabular-nums">
            {targets.calories.toLocaleString()} kcal · {Math.round(targets.protein)} g protein
          </span>
          {answersChangeTargets ? ', updated for your answers above' : ''}. This is what Continue
          saves; change them any time in Eat.
        </p>
      ) : null}

      <div className="space-y-2 pt-2">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={onBack} disabled={isBusy}>
            Back
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
        {/* Skip names the default it uses (UX panel round 21). */}
        <Button
          variant="secondary"
          onClick={onSkip}
          disabled={isBusy}
          isLoading={busy === 'skip'}
          aria-busy={busy === 'skip'}
          data-testid="training-skip"
          className="w-full active:scale-[0.98]"
        >
          {busy === 'skip' ? 'Using defaults…' : skipButtonLabel()}
        </Button>
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

/** Why days a week is asked, under the question (UX round 23). */
export const TRAINING_DAYS_WHY =
  'Why we ask: your first plan is built for this many days, and your calorie target counts these workouts.';

/** Why the split is asked, under the question (UX round 23). */
export const TRAINING_SPLIT_WHY =
  'Why we ask: your first plan keeps the split you already run, so your week doesn’t change overnight. Not sure? Leave it.';

/**
 * One line above the cut paces when the guardrail holds some of them down:
 * faster options give the same target, and why. Pure.
 */
export function lossCapNote(cap: { percentBW: number; bodyFatPercent: number | null }): string {
  const at = cap.bodyFatPercent ? `At ${cap.bodyFatPercent}% body fat` : 'Without your body fat';
  return `${at} the app holds loss to ${cap.percentBW}% of body weight a week, so you keep muscle. Faster paces use that rate.`;
}

/** "Skip — use 4 upper/lower days": the plan default Skip leaves in place. Pure. */
export function skipButtonLabel(): string {
  return `Skip — use ${SKIP_DEFAULT_DAYS} ${SKIP_DEFAULT_SPLIT_LABEL} days`;
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
  answersChangeTargets = false,
}: {
  goal: TrainingGoal | null;
  defaultRate: NutritionGoal | null;
  rateApplies: boolean;
  skipTargets: { calories: number; protein: number } | null;
  /**
   * The answers on screen give different targets from Skip's. Skip then
   * names what it drops instead of quoting a second calorie figure (UX panel
   * round 20: "3,206 on the targets line but 3,158 in the skip text").
   */
  answersChangeTargets?: boolean;
}): string {
  const rateName = rateOptionsForGoal(goal).find((r) => r.value === defaultRate)?.name ?? null;
  const plan = `your first plan starts on ${SKIP_DEFAULT_DAYS} ${SKIP_DEFAULT_SPLIT_LABEL} days a week, from your goal and experience.`;
  if (answersChangeTargets) {
    const pace = rateName ? `the default pace (${rateName.toLowerCase()}) and ` : '';
    return `Skip drops your answers above: your targets go back to ${pace}4 workouts a week, and ${plan} Change either any time.`;
  }
  if (rateApplies && rateName) {
    const targets = skipTargets
      ? ` (${skipTargets.calories.toLocaleString()} kcal · ${Math.round(skipTargets.protein)} g protein a day)`
      : '';
    return `Skip uses the default pace, ${rateName.toLowerCase()}${targets}, and ${plan} Change either any time.`;
  }
  return `Skip keeps your goal, and ${plan} Change it any time.`;
}
