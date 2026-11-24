import { render, screen } from '@testing-library/react';
import { OnboardingSteps, onboardingStepKeys } from '../OnboardingSteps';

describe('OnboardingSteps (UX round 21: the indicator moves and says where you are)', () => {
  it('has five steps for lifters and three for food-only users', () => {
    expect(onboardingStepKeys(false)).toEqual(['units', 'body', 'goal', 'training', 'strength']);
    expect(onboardingStepKeys(true)).toEqual(['units', 'body', 'goal']);
  });

  it('names the current step in words', () => {
    const { rerender } = render(<OnboardingSteps current="units" />);
    expect(screen.getByTestId('onboarding-step-label')).toHaveTextContent('Step 1 of 5: Units');
    rerender(<OnboardingSteps current="training" />);
    expect(screen.getByTestId('onboarding-step-label')).toHaveTextContent('Step 4 of 5: How you train');
    rerender(<OnboardingSteps current="goal" foodFocus />);
    expect(screen.getByTestId('onboarding-step-label')).toHaveTextContent('Step 3 of 3: Goal');
    rerender(<OnboardingSteps current="strength" allDone />);
    expect(screen.getByTestId('onboarding-step-label')).toHaveTextContent('Setup complete');
  });

  it('says skipped answers can be filled in later only where asked', () => {
    const { rerender } = render(<OnboardingSteps current="body" />);
    expect(screen.queryByTestId('onboarding-later-note')).not.toBeInTheDocument();
    rerender(<OnboardingSteps current="body" showLaterNote />);
    expect(screen.getByTestId('onboarding-later-note')).toHaveTextContent(/profile and goal in Settings/);
  });
});
