'use client';

import { IconCheck, IconInfoCircle } from '@tabler/icons-react';
import { Button } from '@/components/ui';
import type { TrainingGoal } from '@/lib/onboarding/onboardingProgress';
import { STANDING_INJURY_OPTIONS, type StandingInjuryArea } from '@/lib/training/standingInjuries';

const GOAL_OPTIONS: { value: TrainingGoal; label: string; description: string }[] = [
  { value: 'cut', label: 'Cut', description: 'Lose fat while holding on to muscle. Calorie deficit.' },
  { value: 'maintenance', label: 'Maintain', description: 'Hold steady or recomp. Eat around maintenance.' },
  { value: 'bulk', label: 'Bulk', description: 'Build muscle. Calorie surplus.' },
];

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
  isLoading,
  onBack,
  onContinue,
}: GoalStepProps) {
  const toggleArea = (area: StandingInjuryArea) => {
    const current = injuryAreas ?? [];
    const next = current.includes(area) ? current.filter((a) => a !== area) : [...current, area];
    // Un-tapping the last chip returns to "not answered" rather than "None".
    onInjuryAreasChange(next.length > 0 ? next : null);
  };
  const noneSelected = injuryAreas !== null && injuryAreas.length === 0;

  const chipClass = (selected: boolean) =>
    `px-3 py-2 rounded-full border text-body transition-colors ${
      selected ? 'bg-action/10 border-action text-ink' : 'bg-card border-sep text-ink-2 hover:text-ink'
    }`;

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
          This sets your training phase — it shapes your program&apos;s volume, rep ranges, and nutrition targets.
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
                <span className="block font-semibold text-ink">{option.label}</span>
                <span className="block text-body text-ink-2 mt-1">{option.description}</span>
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
            At ~{bodyFatPercent.toFixed(0)}% body fat, {recommended === 'cut' ? 'a cut' : 'a bulk'} could also
            suit you. Have a plan, like a show? Go with that.
          </span>
        </p>
      )}

      <p className="text-caption text-ink-3 text-center">
        You can change this anytime from the phase chip on your dashboard.
      </p>

      {/* Optional: never blocks Continue. */}
      <div className="space-y-3 pt-2" role="group" aria-labelledby="injury-question">
        <div>
          <h2 id="injury-question" className="text-headline font-semibold text-ink">
            Any injuries or areas to go easy on?
          </h2>
          <p className="text-caption text-ink-3">
            Optional. Your pre-workout check-in will start with these marked as mild, so exercises that load them get swapped or flagged. You can remove them there any day.
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
