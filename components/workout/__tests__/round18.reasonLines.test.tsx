/**
 * UX panel round 18: each set's suggestion explains itself (including a load
 * that moves between sets), a beginner's empty-bar start says why, the
 * first-set guide, and the suggested-workout sheet's plain wording / honest
 * "last time" claims.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emptyBarStartLine, isEmptyBarLoad, setChangeLine } from '../whyThisWeight';
import { SuggestionBanner } from '../SuggestionBanner';
import { FirstSetGuide, firstSetGuideSteps } from '../FirstSetGuide';
import { hasCompletedLift, rirTargetLabel } from '../SuggestedWorkoutSheet';
import { useEducationStore } from '@/hooks/useEducationPreferences';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/dashboard/workout/s1',
}));

describe('setChangeLine', () => {
  it('names the set, its effort and the move — Sam’s 140 then 135', () => {
    expect(
      setChangeLine({
        setNo: 1,
        lastSet: '140 lbs × 9',
        lastRir: 1,
        cause: 'harder',
        direction: 'down',
        back: true,
        next: '135 lbs',
      })
    ).toBe('Set 1 was 140 lbs × 9 at 1 left (harder than target) → back to 135 lbs');
  });

  it('covers going up, failure, no logged effort and a fatigue drop', () => {
    expect(
      setChangeLine({ setNo: 2, lastSet: '60 kg × 12', lastRir: 4, cause: 'easier', direction: 'up', back: false, next: '62.5 kg' })
    ).toBe('Set 2 was 60 kg × 12 at 4+ left (easier than target) → up to 62.5 kg');
    expect(
      setChangeLine({ setNo: 1, lastSet: '100 kg × 6', lastRir: 0, cause: 'reps_under', direction: 'down', back: false, next: '95 kg' })
    ).toBe('Set 1 was 100 kg × 6 to failure (fewer reps than your range) → down to 95 kg');
    expect(
      setChangeLine({ setNo: 3, lastSet: '80 kg × 8', lastRir: null, cause: 'fatigue', direction: 'down', back: false, next: '75 kg' })
    ).toBe('Set 3 was 80 kg × 8 (you’re tiring — staying in your rep range) → down to 75 kg');
  });
});

describe('empty-bar start', () => {
  it('recognises the empty Olympic bar on a barbell lift only', () => {
    expect(isEmptyBarLoad(20, 'barbell')).toBe(true);
    expect(isEmptyBarLoad(45 / 2.20462, 'barbell')).toBe(true);
    expect(isEmptyBarLoad(20, 'dumbbell')).toBe(false);
    expect(isEmptyBarLoad(25, 'barbell')).toBe(false);
  });
  it('says why it is a good start and what to do next', () => {
    expect(emptyBarStartLine(10)).toBe('Empty bar — a safe start; add weight if 10 reps feel easy');
  });
});

describe('SuggestionBanner reason layout', () => {
  const base = { weightLabel: '135 lbs', repsLabel: '10', rir: 2, reason: 'engine reason', explanation: [] };

  it('puts the reason directly under the numbers, led by "Why:"', () => {
    render(<SuggestionBanner {...base} source="Set 1 was 140 lbs × 9 at 1 left (harder than target) → back to 135 lbs" />);
    const numbers = screen.getByTestId('suggestion-numbers');
    const reason = screen.getByTestId('suggestion-source');
    expect(numbers).toHaveTextContent(/^135 lbs × 10 @ 2 RIR/);
    // Next line, its own paragraph, high-contrast ink with a "Why:" lead.
    expect(numbers.nextElementSibling).toContainElement(reason);
    expect(reason.parentElement).toHaveTextContent(/^Why: Set 1 was 140 lbs × 9/);
    expect(reason.parentElement).toHaveClass('text-ink');
  });

  it('renders the prediction, score and next-time lines only when given', () => {
    const { rerender } = render(<SuggestionBanner {...base} source="x" />);
    expect(screen.queryByTestId('set-prediction')).not.toBeInTheDocument();
    expect(screen.queryByTestId('set-next-time')).not.toBeInTheDocument();
    rerender(
      <SuggestionBanner
        {...base}
        source="x"
        expect="Expect about 10 reps at 135 lbs"
        score="Set 1: You did 9 ✓ · Predictions within 1 rep today: 1 of 1 set"
        nextTime="Hit 135 lbs × 10 next time → 140 lbs"
      />
    );
    expect(screen.getByTestId('set-prediction')).toHaveTextContent(
      'Expect about 10 reps at 135 lbs · Set 1: You did 9 ✓ · Predictions within 1 rep today: 1 of 1 set'
    );
    expect(screen.getByTestId('set-next-time')).toHaveTextContent('Hit 135 lbs × 10 next time → 140 lbs');
  });
});

describe('FirstSetGuide', () => {
  beforeEach(() => {
    useEducationStore.setState({ showBeginnerTips: true, completedTours: [] });
  });

  it('builds the three steps from the card’s own lines', () => {
    const steps = firstSetGuideSteps({
      source: 'Empty bar — a safe start; add weight if 10 reps feel easy',
      nextTime: 'Hit 45 lbs × 12 next time → 50 lbs',
      topReps: 12,
    });
    expect(steps.map((s) => s.title)).toEqual([
      'Where this weight came from',
      'What “reps left” means',
      'What happens next time',
    ]);
    expect(steps[0].body).toMatch(/^Empty bar — a safe start/);
    expect(steps[2].body).toBe(
      'Reach the top of your range (12 reps) and the weight goes up: Hit 45 lbs × 12 next time → 50 lbs.'
    );
  });

  it('steps through, and is shown once per user', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<FirstSetGuide tourId="first-set-guide:u1" source="A guess" nextTime={null} topReps={10} />);
    expect(screen.getByText('First set · 1 of 3')).toBeInTheDocument();
    await user.click(screen.getByTestId('first-set-guide-next'));
    expect(screen.getByText('What “reps left” means')).toBeInTheDocument();
    await user.click(screen.getByTestId('first-set-guide-next'));
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByTestId('first-set-guide')).not.toBeInTheDocument();
    expect(useEducationStore.getState().completedTours).toContain('first-set-guide:u1');
    // Another user on this device still gets it.
    rerender(<FirstSetGuide tourId="first-set-guide:u2" source="A guess" nextTime={null} topReps={10} />);
    expect(screen.getByTestId('first-set-guide')).toBeInTheDocument();
  });

  it('is skippable', async () => {
    const user = userEvent.setup();
    render(<FirstSetGuide tourId="first-set-guide:u3" source={null} nextTime={null} topReps={10} />);
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.queryByTestId('first-set-guide')).not.toBeInTheDocument();
  });
});

describe('suggested-workout sheet wording', () => {
  it('beginner effort has no "failure" or RIR', () => {
    expect(rirTargetLabel(2, true)).toBe('stop when you could still do 2 more');
    expect(rirTargetLabel(2)).toBe('stop 2 reps short of failure');
    expect(rirTargetLabel(0, true)).toBe('go until you can’t do another rep');
  });

  it('"last time" only for a lift in a completed session', () => {
    const completed = new Map([['bench', Date.UTC(2026, 10, 17)]]);
    expect(hasCompletedLift('bench', completed)).toBe(true);
    // Planned / seeded / abandoned sessions never reach the completed map.
    expect(hasCompletedLift('rdl', completed)).toBe(false);
  });
});
