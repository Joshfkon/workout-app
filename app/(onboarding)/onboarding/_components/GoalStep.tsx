'use client';

import { useEffect, useState } from 'react';
import { IconCheck, IconChevronDown, IconInfoCircle } from '@tabler/icons-react';
import { Button, Input, Toggle } from '@/components/ui';
import { BEGINNER_MODE_DESCRIPTION, BEGINNER_MODE_TITLE } from '@/lib/beginnerMode';
import type { TrainingGoal } from '@/lib/onboarding/onboardingProgress';
import { STANDING_INJURY_OPTIONS, type StandingInjuryArea } from '@/lib/training/standingInjuries';

// Plain labels first, the gym term in brackets, plus one plain line, so a
// beginner (or someone easing back after an injury) knows what they're
// picking. The stored values (users.goal) are unchanged.
const GOAL_OPTIONS: { value: TrainingGoal; label: string; term?: string; description: string }[] = [
  { value: 'cut', label: 'Lose fat', term: 'cut', description: 'Eat a little less than you burn, keeping your muscle.' },
  { value: 'maintenance', label: 'Maintain', description: 'Stay at about your weight. Good for getting back into it.' },
  { value: 'bulk', label: 'Build muscle', term: 'bulk', description: 'Eat a little more than you burn to gain muscle.' },
];

// Food-only users (said "No, food tracking" at sign-up): the same goals,
// labelled and described without muscle or training.
const FOOD_GOAL_LABELS: Record<TrainingGoal, string> = {
  cut: 'Lose weight',
  maintenance: 'Maintain',
  bulk: 'Gain weight',
};
const FOOD_GOAL_DESCRIPTIONS: Record<TrainingGoal, string> = {
  cut: 'Lose weight at a steady pace.',
  maintenance: 'Stay at about your weight.',
  bulk: 'Gain weight slowly.',
};

/** Where the daily numbers come from, in one plain line. */
export const TARGETS_SOURCE_COPY =
  'Calories: your estimated daily burn (from your weight, height, age, sex and a typical activity level), ' +
  'set a little lower to lose fat or a little higher to build muscle. Protein: scaled to your lean body mass.';

/** Daily targets shown under the goal: new ones for this goal, or ones the user already has. */
export interface GoalStepTargets {
  calories: number;
  protein: number;
  kind: 'new' | 'existing';
}

export interface GoalStepProps {
  /** null = nothing picked yet; Continue stays disabled until one is. */
  goal: TrainingGoal | null;
  onGoalChange: (goal: TrainingGoal) => void;
  /** Body-fat-based suggestion (never from a "Not sure" guess). */
  recommended: 'bulk' | 'cut' | null;
  bodyFatPercent: number;
  /** null = question not answered (optional); [] = "None". */
  injuryAreas: StandingInjuryArea[] | null;
  onInjuryAreasChange: (areas: StandingInjuryArea[] | null) => void;
  /** Calorie + protein targets for the picked goal; null when they can't be worked out. */
  dailyTargets?: GoalStepTargets | null;
  /** No targets yet and no age to calculate them from. */
  targetsNeedAge?: boolean;
  /** The age field's text (the same state the body-comp step's Age field uses). */
  ageDisplay?: string;
  onAgeChange?: (value: string) => void;
  /** Said "No, food tracking" at sign-up: training-only copy is hidden or softened. */
  foodFocus?: boolean;
  /**
   * Beginner mode switch, pre-set from experience (on for novices). Omitted
   * = not offered (food-only users, who don't log workouts).
   */
  beginnerMode?: boolean;
  onBeginnerModeChange?: (value: boolean) => void;
  isLoading: boolean;
  onBack: () => void;
  onContinue: () => void;
}

export function GoalStep({
  goal,
  onGoalChange,
  recommended,
  bodyFatPercent,
  injuryAreas,
  onInjuryAreasChange,
  dailyTargets = null,
  targetsNeedAge = false,
  ageDisplay = '',
  onAgeChange,
  foodFocus = false,
  beginnerMode,
  onBeginnerModeChange,
  isLoading,
  onBack,
  onContinue,
}: GoalStepProps) {
  // Once the age field is shown it stays, so typing a valid age swaps the
  // prompt for the targets without pulling the field out from under the user.
  const [askAge, setAskAge] = useState(targetsNeedAge && !!onAgeChange);
  useEffect(() => {
    if (targetsNeedAge && onAgeChange) setAskAge(true);
  }, [targetsNeedAge, onAgeChange]);

  return (
    <div className="max-w-md mx-auto space-y-6 animate-fade-in">
      {/* Progress indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-subhead font-medium ${
              s <= 2
                ? 'bg-action text-on-action'
                : 'bg-fill text-ink-3'
            }`}>
              {s}
            </div>
            {s < 4 && (
              <div className={`w-12 h-0.5 ${s < 2 ? 'bg-action' : 'bg-fill'}`} />
            )}
          </div>
        ))}
      </div>

      <div className="text-center mb-6">
        <h1 className="text-large-title font-bold text-ink mb-2">What&apos;s your goal right now?</h1>
        <p className="text-ink-2">
          {foodFocus
            ? 'This sets your daily food targets.'
            : 'This sets your daily food targets and how your training is planned.'}
        </p>
      </div>

      <div className="space-y-2" role="group" aria-label="Training goal">
        {GOAL_OPTIONS.map((option) => {
          const isSelected = goal === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onGoalChange(option.value)}
              aria-pressed={isSelected}
              data-testid={`goal-option-${option.value}`}
              className={`w-full text-left p-4 rounded-xl border-2 transition-all flex items-start gap-3 ${
                isSelected
                  ? 'bg-action/10 border-action'
                  : 'bg-card border-sep hover:border-sep'
              }`}
            >
              {/* Radio-style indicator: the one unmistakable "this is picked" cue. */}
              <span
                aria-hidden="true"
                data-testid={`goal-indicator-${option.value}`}
                className={`mt-0.5 w-5 h-5 flex-shrink-0 rounded-full border-2 flex items-center justify-center ${
                  isSelected ? 'border-action bg-action text-on-action' : 'border-sep'
                }`}
              >
                {isSelected && <IconCheck size={13} stroke={3} />}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-ink">
                  {foodFocus ? FOOD_GOAL_LABELS[option.value] : option.label}
                  {option.term && (
                    <span className="font-normal text-ink-2"> ({option.term})</span>
                  )}
                </span>
                <span className="block text-body text-ink-2 mt-1">
                  {foodFocus ? FOOD_GOAL_DESCRIPTIONS[option.value] : option.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* The body-fat suggestion is INFORMATION, not a second selection: plain
          neutral text under the options, no badge on an option card, so the
          picked card stays the only highlighted thing. */}
      {recommended && (
        <p className="flex items-start gap-2 text-subhead text-ink-2" data-testid="goal-body-fat-note">
          <IconInfoCircle size={16} className="mt-0.5 flex-shrink-0 text-ink-3" aria-hidden="true" />
          <span>
            At ~{bodyFatPercent.toFixed(0)}% body fat,{' '}
            {recommended === 'cut' ? 'losing fat (a cut)' : 'building muscle (a bulk)'} could also
            suit you. Have a plan, like a show? Go with that.
          </span>
        </p>
      )}

      {dailyTargets ? (
        <div className="rounded-card bg-card p-4 shadow-card" data-testid="goal-daily-targets">
          <p className="text-subhead text-ink-2">
            {dailyTargets.kind === 'new' ? 'Your daily targets' : 'Your current daily targets'}
          </p>
          <p className="text-title font-bold text-ink tabular-nums">
            {dailyTargets.calories.toLocaleString()} kcal · {Math.round(dailyTargets.protein)} g protein
          </p>
          <p className="text-caption text-ink-3 mt-1">
            {dailyTargets.kind === 'new'
              ? 'Worked out from your goal, weight, height and age. Change them any time in Eat.'
              : 'Kept as they are. Change them any time in Eat.'}
          </p>
          {dailyTargets.kind === 'new' && (
            <p className="text-caption text-ink-2 mt-1" data-testid="goal-targets-source">
              {TARGETS_SOURCE_COPY}
            </p>
          )}
        </div>
      ) : targetsNeedAge ? (
        <p className="text-subhead text-ink-2" data-testid="goal-targets-need-age">
          {onAgeChange
            ? 'Add your age to see your daily calorie and protein targets, or set them later in Eat.'
            : 'Set your daily calorie and protein targets later in Eat.'}
        </p>
      ) : null}

      {/* Age right here (not "go Back"): same field state and same save as
          the body-comp step's Age, so the targets above update as you type. */}
      {askAge && onAgeChange && dailyTargets?.kind !== 'existing' && (
        <div data-testid="goal-age-field">
          <Input
            label="Age"
            type="number"
            inputMode="numeric"
            value={ageDisplay}
            onChange={(e) => onAgeChange(e.target.value)}
            placeholder="30"
            min={13}
            max={100}
            hint="Used to set your daily calorie target."
          />
        </div>
      )}

      <p className="text-caption text-ink-3 text-center">
        You can change your goal anytime from the phase chip on your dashboard.
      </p>

      <InjuryQuestion
        foodFocus={foodFocus}
        injuryAreas={injuryAreas}
        onInjuryAreasChange={onInjuryAreasChange}
      />

      {beginnerMode !== undefined && onBeginnerModeChange && (
        <div
          className="flex items-center justify-between gap-3 rounded-card bg-card p-4"
          data-testid="onboarding-beginner-mode"
        >
          <div className="min-w-0">
            <p className="text-body font-medium text-ink">{BEGINNER_MODE_TITLE}</p>
            <p className="text-caption text-ink-2">{BEGINNER_MODE_DESCRIPTION}</p>
          </div>
          <Toggle checked={beginnerMode} onChange={onBeginnerModeChange} label={BEGINNER_MODE_TITLE} />
        </div>
      )}

      <div className="flex flex-col gap-2 pt-2">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={onBack} disabled={isLoading}>
            Back
          </Button>
          <Button
            size="lg"
            onClick={onContinue}
            disabled={goal === null || isLoading}
            isLoading={isLoading}
            aria-busy={isLoading}
            data-testid="goal-continue"
          >
            {isLoading ? (
              'Saving…'
            ) : (
              <>
                Continue
                <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </>
            )}
          </Button>
        </div>
        {goal === null && (
          <p className="text-caption text-ink-2 text-right" data-testid="goal-pick-hint">
            Pick one to continue
          </p>
        )}
      </div>
    </div>
  );
}

/** The optional "areas to go easy on" question; never blocks Continue. */
function InjuryQuestion({
  foodFocus,
  injuryAreas,
  onInjuryAreasChange,
}: Pick<GoalStepProps, 'injuryAreas' | 'onInjuryAreasChange'> & { foodFocus: boolean }) {
  const toggleArea = (area: StandingInjuryArea) => {
    const current = injuryAreas ?? [];
    const next = current.includes(area) ? current.filter((a) => a !== area) : [...current, area];
    // Un-tapping the last chip returns to "not answered" rather than "None".
    onInjuryAreasChange(next.length > 0 ? next : null);
  };
  const noneSelected = injuryAreas !== null && injuryAreas.length === 0;

  // Food-only users: the injuries question is collapsed behind a tap (open if
  // they already have areas saved). Lifters always see it.
  const [injuriesOpen, setInjuriesOpen] = useState(!foodFocus);
  const showInjuryChips = !foodFocus || injuriesOpen || (injuryAreas?.length ?? 0) > 0;

  const chipClass = (selected: boolean) =>
    `px-3 py-2 rounded-full border text-body transition-colors ${
      selected ? 'bg-action/10 border-action text-ink' : 'bg-card border-sep text-ink-2 hover:text-ink'
    }`;

  return (
    <>
      {/* Optional: never blocks Continue. */}
      {!showInjuryChips ? (
        <button
          type="button"
          onClick={() => setInjuriesOpen(true)}
          aria-expanded={false}
          data-testid="injury-question-toggle"
          className="flex w-full items-center justify-between pt-2 text-body text-ink-2 hover:text-ink"
        >
          <span>Any injuries or sore spots? (optional)</span>
          <IconChevronDown size={18} aria-hidden="true" />
        </button>
      ) : (
      <div className="space-y-3 pt-2" role="group" aria-labelledby="injury-question">
        <div>
          <h2 id="injury-question" className="text-headline font-semibold text-ink">
            {foodFocus ? 'Any injuries or sore spots?' : 'Any injuries or areas to go easy on?'}
          </h2>
          <p className="text-caption text-ink-3">
            {foodFocus
              ? 'Optional. Only used if you ever log a workout.'
              : 'Optional. Your pre-workout check-in will start with these marked as mild, so exercises that load them get swapped or flagged. You can remove them there any day.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {STANDING_INJURY_OPTIONS.map((option) => {
            const selected = injuryAreas?.includes(option.id) ?? false;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={selected}
                data-testid={`injury-chip-${option.id}`}
                onClick={() => toggleArea(option.id)}
                className={chipClass(selected)}
              >
                {option.label}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={noneSelected}
            data-testid="injury-chip-none"
            onClick={() => onInjuryAreasChange(noneSelected ? null : [])}
            className={chipClass(noneSelected)}
          >
            None
          </button>
        </div>
      </div>
      )}
    </>
  );
}
