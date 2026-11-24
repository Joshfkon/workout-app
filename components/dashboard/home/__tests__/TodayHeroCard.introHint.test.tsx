import { render, screen } from '@testing-library/react';
import { TodayHeroCard } from '../TodayHeroCard';

// The real FirstTimeHint waits on a hint queue and a delay before it shows;
// render its copy inline so the test can read exactly what a new user sees.
jest.mock('@/components/ui', () => ({
  ...jest.requireActual('@/components/ui'),
  FirstTimeHint: ({ id, title, description }: { id: string; title: string; description: string }) => (
    <div data-testid={`hint-${id}`}>
      <p>{title}</p>
      <p>{description}</p>
    </div>
  ),
}));

jest.mock('@/hooks/useStartEmptyWorkout', () => ({
  useStartEmptyWorkout: () => ({ start: jest.fn(), isStarting: false, error: null }),
}));

describe('TodayHeroCard — Home intro hint copy', () => {
  // A beginner on the UX panel didn't know the word "mesocycle"; the hint
  // that introduces programs must say it in plain language.
  it('explains programs without the word "mesocycle"', () => {
    render(
      <TodayHeroCard workout={null} scheduled={null} hasPlan={false} mesocycleName={null} meal={null} />
    );

    const hint = screen.getByTestId('hint-dashboard-mesocycle-intro');
    expect(hint).toHaveTextContent(/4–8 week program/);
    expect(hint.textContent).not.toMatch(/mesocycle/i);
  });
});
