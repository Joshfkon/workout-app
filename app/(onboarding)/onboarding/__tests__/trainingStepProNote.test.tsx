import { render, screen, within } from '@testing-library/react';
import { TrainingStep } from '../_components/TrainingStep';
import { EMPTY_TRAINING_SETUP } from '@/lib/onboarding/trainingSetup';

describe('onboarding training step — Pro marked where the plan is offered (UX round 20)', () => {
  it('names the free path first and marks the block builder Pro, with the trial', () => {
    render(
      <TrainingStep
        answers={EMPTY_TRAINING_SETUP}
        onChange={jest.fn()}
        goal="bulk"
        defaultRate={null}
        rateApplies={false}
        weightKg={80}
        units="kg"
        targets={null}
        busy={null}
        onBack={jest.fn()}
        onSkip={jest.fn()}
        onContinue={jest.fn()}
      />
    );
    const note = screen.getByTestId('onboarding-pro-note');
    expect(note).toHaveTextContent(/^Logging workouts, your history and progress are free\./);
    expect(note).toHaveTextContent(/try free for your first 14 days/);
    expect(within(note).getByTestId('pro-tag')).toHaveAttribute('data-plan', 'pro');
  });
});
