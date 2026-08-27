import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PRCelebration, type PRCelebrationData } from '../PRCelebration';

const celebration: PRCelebrationData = {
  id: 'set-1',
  exerciseName: 'Iso-Lateral Incline Press',
  title: 'New e1RM PR',
  detail: '230 lbs est. 1RM · +4%',
};

describe('PRCelebration', () => {
  it('renders nothing when there is no celebration', () => {
    const { container } = render(<PRCelebration celebration={null} onDone={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the PR title, exercise name and detail', () => {
    render(<PRCelebration celebration={celebration} onDone={jest.fn()} />);
    expect(screen.getByText('New e1RM PR')).toBeInTheDocument();
    expect(screen.getByText('Iso-Lateral Incline Press')).toBeInTheDocument();
    expect(screen.getByText('230 lbs est. 1RM · +4%')).toBeInTheDocument();
  });

  it('dismisses when the badge is tapped', async () => {
    const onDone = jest.fn();
    const user = userEvent.setup();
    render(<PRCelebration celebration={celebration} onDone={onDone} />);
    await user.click(screen.getByRole('button'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses after the timeout', () => {
    jest.useFakeTimers();
    try {
      const onDone = jest.fn();
      render(<PRCelebration celebration={celebration} onDone={onDone} />);
      act(() => {
        jest.advanceTimersByTime(3000);
      });
      expect(onDone).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
