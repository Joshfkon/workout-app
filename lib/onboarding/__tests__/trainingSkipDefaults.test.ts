import { recommendSplit } from '@/services/mesocycleBuilder';
import { SKIP_DEFAULT_DAYS, SKIP_DEFAULT_SPLIT_LABEL, SPLIT_OPTIONS } from '../trainingSetup';
import { skipButtonLabel } from '@/app/(onboarding)/onboarding/_components/TrainingStep';

describe('onboarding training step: what Skip uses (UX round 22)', () => {
  it('names the plan default on the Skip button', () => {
    expect(skipButtonLabel()).toBe('Skip — use 4 upper/lower days');
  });

  it('matches what the builder actually does with no answers: 4 days, Upper/Lower for everyone', () => {
    expect(SKIP_DEFAULT_DAYS).toBe(4);
    expect(SKIP_DEFAULT_SPLIT_LABEL).toBe('upper/lower');
    for (const experience of ['novice', 'intermediate', 'advanced'] as const) {
      for (const goal of ['bulk', 'cut', 'maintenance'] as const) {
        expect(recommendSplit(SKIP_DEFAULT_DAYS, goal, experience).split).toBe('Upper/Lower');
      }
    }
  });

  it('describes every split in plain words', () => {
    for (const option of SPLIT_OPTIONS) {
      expect(option.description.length).toBeGreaterThan(10);
    }
    expect(SPLIT_OPTIONS.find((o) => o.value === 'ppl')?.description).toMatch(/Chest, shoulders and triceps/);
  });
});
