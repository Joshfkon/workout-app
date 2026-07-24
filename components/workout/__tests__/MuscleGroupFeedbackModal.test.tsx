import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MuscleGroupFeedbackModal } from '../MuscleGroupFeedbackModal';

/**
 * The "Finish Workout?" popup: asks pump + workload once per muscle group
 * trained (replacing the old per-exercise chip rows), doubles as the finish
 * confirmation, and never blocks finishing on an answer.
 */
describe('MuscleGroupFeedbackModal', () => {
  const baseProps = {
    isOpen: true,
    onClose: jest.fn(),
    onConfirm: jest.fn(),
    message: 'All 10 sets logged. Wrap up and rate your session.',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders a pump and workload chip row per trained muscle, with humanized labels', () => {
    render(
      <MuscleGroupFeedbackModal
        {...baseProps}
        muscles={['chest_upper', 'glute_med']}
      />
    );

    expect(screen.getByTestId('muscle-feedback-modal')).toBeInTheDocument();
    expect(screen.getByText('Finish Workout?')).toBeInTheDocument();
    expect(screen.getByText(/All 10 sets logged/)).toBeInTheDocument();

    // One section per muscle, humanized names, raw keys nowhere.
    expect(screen.getByText('Upper Chest')).toBeInTheDocument();
    expect(screen.getByText('Glute Med')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/chest_upper|glute_med/);

    // Each muscle gets both questions, workload with all four ratings —
    // 2 "pushed it" is the weekly engine's hold signal and must be offerable.
    expect(screen.getByTestId('finish-pump-chest_upper-2')).toBeInTheDocument();
    for (const value of [0, 1, 2, 3]) {
      expect(screen.getByTestId(`finish-workload-chest_upper-${value}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('finish-pump-glute_med-3')).toBeInTheDocument();
    expect(screen.getByTestId('finish-workload-glute_med-3')).toBeInTheDocument();
  });

  it('confirms with the tapped ratings — one tap per answer', async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn();
    render(
      <MuscleGroupFeedbackModal
        {...baseProps}
        onConfirm={onConfirm}
        muscles={['chest_upper', 'lats']}
      />
    );

    await user.click(screen.getByTestId('finish-pump-chest_upper-3'));
    await user.click(screen.getByTestId('finish-workload-chest_upper-0'));
    await user.click(screen.getByTestId('finish-workload-lats-3'));
    await user.click(screen.getByTestId('muscle-feedback-finish'));

    expect(onConfirm).toHaveBeenCalledWith({
      chest_upper: { pump: 3, workload: 0 },
      lats: { workload: 3 },
    });
  });

  it('finishing with everything skipped submits empty ratings (never blocked)', async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn();
    render(
      <MuscleGroupFeedbackModal
        {...baseProps}
        onConfirm={onConfirm}
        muscles={['quads']}
      />
    );

    await user.click(screen.getByTestId('muscle-feedback-finish'));
    expect(onConfirm).toHaveBeenCalledWith({});
  });

  it('"Keep Training" closes without confirming', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    const onConfirm = jest.fn();
    render(
      <MuscleGroupFeedbackModal
        {...baseProps}
        onClose={onClose}
        onConfirm={onConfirm}
        muscles={['quads']}
      />
    );

    await user.click(screen.getByRole('button', { name: /Keep Training/i }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('degrades to a plain confirm when no muscles were trained', () => {
    render(
      <MuscleGroupFeedbackModal
        {...baseProps}
        muscles={[]}
        message="No sets have been logged yet. Finish anyway?"
      />
    );

    expect(screen.getByText(/No sets have been logged yet/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Pump/);
    expect(screen.getByTestId('muscle-feedback-finish')).toBeInTheDocument();
  });

  it('seeds from initialRatings so prior answers show selected', async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn();
    render(
      <MuscleGroupFeedbackModal
        {...baseProps}
        onConfirm={onConfirm}
        muscles={['quads']}
        initialRatings={{ quads: { pump: 2 } }}
      />
    );

    // Seeded answer rides through confirm even with no new taps.
    await user.click(screen.getByTestId('muscle-feedback-finish'));
    expect(onConfirm).toHaveBeenCalledWith({ quads: { pump: 2 } });
  });
});
