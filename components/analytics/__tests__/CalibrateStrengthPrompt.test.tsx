import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CalibrateStrengthPrompt, calibratePromptMode } from '../CalibrateStrengthPrompt';
import type { LiftTrendsSummary } from '@/app/(dashboard)/dashboard/_lib/liftTrends';

const empty: LiftTrendsSummary = {
  lifts: [],
  rising: 0,
  flat: 0,
  down: 0,
  rebuilding: 0,
  insufficientData: 0,
  earlyLifts: [],
  stalled: null,
  windowDays: 84,
};

describe('calibratePromptMode', () => {
  it('shows the full card when there is no strength data', () => {
    expect(
      calibratePromptMode({ liftTrends: empty, liftTrendsLoaded: true, muscleProgressionCount: 0 })
    ).toBe('card');
  });

  it('demotes to a small row once there are early-lift bests', () => {
    expect(
      calibratePromptMode({
        liftTrends: {
          ...empty,
          earlyLifts: [{ name: 'Bench Press', sessions: 1, bestWeightKg: 80, bestReps: 5 }],
        },
        liftTrendsLoaded: true,
        muscleProgressionCount: 0,
      })
    ).toBe('row');
  });

  it('demotes to a small row with trended lifts or muscle progression', () => {
    expect(
      calibratePromptMode({
        liftTrends: { ...empty, lifts: [{} as LiftTrendsSummary['lifts'][number]] },
        liftTrendsLoaded: true,
        muscleProgressionCount: 0,
      })
    ).toBe('row');
    expect(
      calibratePromptMode({ liftTrends: null, liftTrendsLoaded: false, muscleProgressionCount: 4 })
    ).toBe('row');
  });

  it('shows nothing until lift trends are known (no flash of the card)', () => {
    expect(
      calibratePromptMode({ liftTrends: null, liftTrendsLoaded: false, muscleProgressionCount: 0 })
    ).toBe('hidden');
  });
});

describe('CalibrateStrengthPrompt', () => {
  it('renders the card or the optional row by mode', async () => {
    const onStart = jest.fn();
    const { rerender, container } = render(<CalibrateStrengthPrompt mode="card" onStart={onStart} />);
    expect(screen.getByText('Calibrate your strength')).toBeInTheDocument();

    rerender(<CalibrateStrengthPrompt mode="row" onStart={onStart} />);
    expect(screen.queryByText('Calibrate your strength')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByText('Compare with other lifters (optional)'));
    expect(onStart).toHaveBeenCalled();

    rerender(<CalibrateStrengthPrompt mode="hidden" onStart={onStart} />);
    expect(container).toBeEmptyDOMElement();
  });
});
