/**
 * Tests for the SetLoggerRow feedback sheet restyle.
 *
 * The form chips in the feedback sheet must be styled exactly like the
 * effort (3/2/1/0) chips — same height and radius, neutral gray when
 * unselected, solid semantic tint only on the selected chip — and selection
 * must round-trip the exact same values through onLog as before.
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SetLoggerRow } from '../SetLoggerRow';
import { SELECTOR_CHIP_BASE, SELECTOR_CHIP_IDLE } from '../selectorChips';

// Map the geometry utility classes to real CSS so parity can be asserted via
// computed styles (jsdom applies stylesheet rules in getComputedStyle).
beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = `
    [class*="min-h-[52px]"] { min-height: 52px; }
    [class*="rounded-xl"] { border-radius: 12px; }
  `;
  document.head.appendChild(style);
});

const defaultProps = {
  setNumber: 1,
  weight: '100',
  reps: '8',
  onWeightChange: jest.fn(),
  onRepsChange: jest.fn(),
  targetRir: 2,
  onLog: jest.fn(),
};

/** Height/radius utility tokens — the parity contract between chip rows. */
const geometryTokens = (el: Element) =>
  Array.from(el.classList)
    .filter((c) => c.startsWith('min-h-') || c.startsWith('rounded'))
    .sort();

async function openFeedbackSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Add set feedback' }));
}

describe('SetLoggerRow feedback sheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('form chip parity with the effort chips', () => {
    it('renders form chips with the same height and radius as the effort chips', async () => {
      const user = userEvent.setup();
      render(<SetLoggerRow {...defaultProps} />);
      await openFeedbackSheet(user);

      const effortChip = screen.getByRole('button', { name: '2 reps in reserve (good)' });
      const formChip = screen.getByRole('button', { name: /Clean/ });

      // Identical geometry class tokens (both come from SELECTOR_CHIP_BASE).
      expect(geometryTokens(formChip)).toEqual(geometryTokens(effortChip));
      expect(geometryTokens(formChip)).toEqual(['min-h-[52px]', 'rounded-xl']);

      // Computed-style parity.
      const effortStyle = getComputedStyle(effortChip);
      const formStyle = getComputedStyle(formChip);
      expect(formStyle.minHeight).toBe(effortStyle.minHeight);
      expect(formStyle.borderRadius).toBe(effortStyle.borderRadius);
      expect(formStyle.minHeight).toBe('52px');
      expect(formStyle.borderRadius).toBe('12px');

      // Both rows are built from the same shared base class string.
      expect(effortChip.className).toContain(SELECTOR_CHIP_BASE);
      expect(formChip.className).toContain(SELECTOR_CHIP_BASE);
    });

    it('keeps unselected chips neutral gray; color enters only on the selected chip', async () => {
      const user = userEvent.setup();
      render(<SetLoggerRow {...defaultProps} />);
      await openFeedbackSheet(user);

      const clean = screen.getByRole('button', { name: /Clean/ });
      const breakdown = screen.getByRole('button', { name: /Some Breakdown/ });
      const ugly = screen.getByRole('button', { name: /Ugly/ });

      // Nothing selected: every chip is neutral, no semantic tint anywhere.
      for (const chip of [clean, breakdown, ugly]) {
        expect(chip.className).toContain(SELECTOR_CHIP_IDLE);
        expect(chip.className).not.toMatch(/bg-(success|warning|danger)-500/);
      }

      await user.click(clean);
      expect(clean.className).toContain('bg-success-500');
      expect(clean).toHaveAttribute('aria-pressed', 'true');
      expect(breakdown.className).toContain(SELECTOR_CHIP_IDLE);
      expect(ugly.className).toContain(SELECTOR_CHIP_IDLE);

      await user.click(breakdown);
      expect(breakdown.className).toContain('bg-warning-500');
      expect(clean.className).toContain(SELECTOR_CHIP_IDLE);

      await user.click(ugly);
      expect(ugly.className).toContain('bg-danger-500');
      expect(breakdown.className).toContain(SELECTOR_CHIP_IDLE);
    });
  });

  it('round-trips form, discomfort, and note into onLog with the same values as before', async () => {
    const user = userEvent.setup();
    const onLog = jest.fn();
    render(<SetLoggerRow {...defaultProps} onLog={onLog} />);
    await openFeedbackSheet(user);

    await user.click(screen.getByRole('button', { name: /Ugly/ }));

    // Discomfort: collapsed neutral row -> joint picker -> severity (two taps)
    await user.click(screen.getByText(/Log injury or discomfort/));
    await user.click(screen.getByTestId('joint-chip-knee'));
    await user.click(screen.getByTestId('joint-severity-chip-pain'));

    await user.type(screen.getByLabelText('Note'), 'felt heavy');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Log set' }));

    expect(onLog).toHaveBeenCalledWith(
      expect.objectContaining({
        weightKg: 100,
        reps: 8,
        note: 'felt heavy',
        feedback: expect.objectContaining({
          repsInTank: 2,
          form: 'ugly',
          discomfort: { bodyPart: 'knees', severity: 'pain' },
        }),
      })
    );
  });

  describe('RIR chip row (4+ through 0)', () => {
    it('renders the five effort chips in order with a 4+ chip at the far left and no bone icon', () => {
      render(<SetLoggerRow {...defaultProps} />);

      const chips = [
        screen.getByRole('button', { name: '4+ reps in reserve (cruise)' }),
        screen.getByRole('button', { name: '3 reps in reserve (easy)' }),
        screen.getByRole('button', { name: '2 reps in reserve (good)' }),
        screen.getByRole('button', { name: '1 reps in reserve (hard)' }),
        screen.getByRole('button', { name: '0 reps in reserve (maxed)' }),
      ];
      // DOM order matches the visual order: 4+ leftmost, 0 rightmost.
      for (let i = 1; i < chips.length; i++) {
        expect(
          chips[i - 1].compareDocumentPosition(chips[i]) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
      }

      // The bone (injury) shortcut is gone from the row; injury logging lives
      // in the feedback sheet.
      expect(screen.queryByRole('button', { name: 'Log joint pain' })).not.toBeInTheDocument();
    });

    it('stores a 4+ selection as integer 4 with RPE 6 in the logged set', async () => {
      const user = userEvent.setup();
      const onLog = jest.fn();
      render(<SetLoggerRow {...defaultProps} onLog={onLog} />);

      const cruiseChip = screen.getByRole('button', { name: '4+ reps in reserve (cruise)' });
      await user.click(cruiseChip);
      expect(cruiseChip).toHaveAttribute('aria-pressed', 'true');

      await user.click(screen.getByRole('button', { name: 'Log set' }));

      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({
          rpe: 6,
          feedback: expect.objectContaining({ repsInTank: 4 }),
        })
      );
      const logged = onLog.mock.calls[0][0];
      expect(logged.feedback.repsInTank).toBe(4);
      expect(typeof logged.feedback.repsInTank).toBe('number');
    });

    it('pre-selects a prescribed target RIR of 4 instead of clamping it to 3', () => {
      render(<SetLoggerRow {...defaultProps} targetRir={4} />);
      expect(
        screen.getByRole('button', { name: '4+ reps in reserve (cruise)' })
      ).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('shows a logged discomfort as a summary row with a Remove affordance', async () => {
    const user = userEvent.setup();
    render(<SetLoggerRow {...defaultProps} />);
    await openFeedbackSheet(user);

    await user.click(screen.getByText(/Log injury or discomfort/));
    await user.click(screen.getByTestId('joint-chip-shoulder'));
    await user.click(screen.getByTestId('joint-severity-chip-twinge'));

    expect(screen.getByText(/Shoulders — Twinge/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove discomfort' }));
    expect(screen.getByText(/Log injury or discomfort/)).toBeInTheDocument();
  });
});

describe('SetLoggerRow hold timer (duration exercises)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const durationProps = {
    ...defaultProps,
    reps: '45',
    isDurationBased: true,
    exerciseId: 'plank-1',
  };

  /** Tap Start and run out the 5s "get in position" lead-in. */
  async function startHold(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Start hold timer' }));
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
  }

  it('renders a Start hold button only for duration exercises', () => {
    const { rerender } = render(<SetLoggerRow {...defaultProps} />);
    expect(screen.queryByRole('button', { name: 'Start hold timer' })).not.toBeInTheDocument();

    rerender(<SetLoggerRow {...durationProps} />);
    expect(screen.getByRole('button', { name: 'Start hold timer' })).toBeInTheDocument();
  });

  it('start → stop commits the elapsed seconds into the seconds field', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onRepsChange = jest.fn();
    render(<SetLoggerRow {...durationProps} onRepsChange={onRepsChange} />);

    await startHold(user);
    act(() => {
      jest.advanceTimersByTime(32_000);
    });
    await user.click(screen.getByRole('button', { name: 'Stop hold timer' }));

    expect(onRepsChange).toHaveBeenCalledWith('32');
  });

  it('disables the seconds steppers and Log set while the hold is running', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SetLoggerRow {...durationProps} />);

    await startHold(user);

    expect(screen.getByRole('button', { name: 'Decrease seconds' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Increase seconds' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Log set/i })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Stop hold timer' }));
    expect(screen.getByRole('button', { name: 'Decrease seconds' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Log set/i })).toBeEnabled();
  });

  it('steppers adjust the committed time after stopping (±5s)', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onRepsChange = jest.fn();
    render(<SetLoggerRow {...durationProps} reps="32" onRepsChange={onRepsChange} />);

    await user.click(screen.getByRole('button', { name: 'Increase seconds' }));
    expect(onRepsChange).toHaveBeenCalledWith('37');

    await user.click(screen.getByRole('button', { name: 'Decrease seconds' }));
    expect(onRepsChange).toHaveBeenCalledWith('27');
  });

  it('does not wipe a running hold restored from localStorage on mount', () => {
    // Simulate a hold that was running when the app reloaded: useDurationTimer
    // restores it on mount, and the row's fresh-set reset must NOT clear it.
    localStorage.setItem(
      'workout_duration_timer',
      JSON.stringify({ startTime: Date.now() - 12_000, elapsed: 0, isRunning: true, exerciseId: 'plank-1' })
    );

    render(<SetLoggerRow {...durationProps} />);
    act(() => {
      jest.advanceTimersByTime(200); // let the restored interval tick
    });

    // Still running (Stop visible) with the pre-reload elapsed time intact.
    expect(screen.getByRole('button', { name: 'Stop hold timer' })).toBeInTheDocument();
    expect(localStorage.getItem('workout_duration_timer')).not.toBeNull();
  });

  it('offers Resume after a stop and Reset clears the run', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SetLoggerRow {...durationProps} />);

    await startHold(user);
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    await user.click(screen.getByRole('button', { name: 'Stop hold timer' }));

    expect(screen.getByRole('button', { name: 'Resume hold timer' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reset hold timer' }));
    expect(screen.getByRole('button', { name: 'Start hold timer' })).toBeInTheDocument();
  });
});

describe('SetLoggerRow hold lead-in countdown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const durationProps = {
    ...defaultProps,
    reps: '45',
    isDurationBased: true,
    exerciseId: 'plank-1',
  };

  it('counts down 5 seconds before the hold clock starts', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SetLoggerRow {...durationProps} />);

    await user.click(screen.getByRole('button', { name: 'Start hold timer' }));

    // Counting down, not holding: the countdown readout is showing and the
    // button offers cancel rather than stop.
    expect(screen.getByTestId('hold-countdown')).toHaveTextContent('5');
    expect(screen.getByRole('button', { name: 'Cancel hold countdown' })).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(3_000);
    });
    expect(screen.getByTestId('hold-countdown')).toHaveTextContent('2');

    act(() => {
      jest.advanceTimersByTime(2_000);
    });
    expect(screen.queryByTestId('hold-countdown')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop hold timer' })).toBeInTheDocument();
  });

  it('does not count the lead-in as held time', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onRepsChange = jest.fn();
    render(<SetLoggerRow {...durationProps} onRepsChange={onRepsChange} />);

    await user.click(screen.getByRole('button', { name: 'Start hold timer' }));
    act(() => {
      jest.advanceTimersByTime(5_000); // lead-in
      jest.advanceTimersByTime(20_000); // actual hold
    });
    await user.click(screen.getByRole('button', { name: 'Stop hold timer' }));

    expect(onRepsChange).toHaveBeenCalledWith('20');
  });

  it('cancelling the countdown returns to the idle Start state', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onRepsChange = jest.fn();
    render(<SetLoggerRow {...durationProps} onRepsChange={onRepsChange} />);

    await user.click(screen.getByRole('button', { name: 'Start hold timer' }));
    act(() => {
      jest.advanceTimersByTime(2_000);
    });
    await user.click(screen.getByRole('button', { name: 'Cancel hold countdown' }));

    expect(screen.getByRole('button', { name: 'Start hold timer' })).toBeInTheDocument();
    expect(screen.queryByTestId('hold-countdown')).not.toBeInTheDocument();
    expect(onRepsChange).not.toHaveBeenCalled();
  });

  it('"Start hold now" skips the remaining lead-in', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onRepsChange = jest.fn();
    render(<SetLoggerRow {...durationProps} onRepsChange={onRepsChange} />);

    await user.click(screen.getByRole('button', { name: 'Start hold timer' }));
    await user.click(screen.getByRole('button', { name: 'Start hold now' }));

    expect(screen.getByRole('button', { name: 'Stop hold timer' })).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(12_000);
    });
    await user.click(screen.getByRole('button', { name: 'Stop hold timer' }));
    expect(onRepsChange).toHaveBeenCalledWith('12');
  });

  it('keeps Log set and the seconds steppers locked during the lead-in', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SetLoggerRow {...durationProps} />);

    await user.click(screen.getByRole('button', { name: 'Start hold timer' }));

    expect(screen.getByRole('button', { name: /Log set/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Increase seconds' })).toBeDisabled();
  });
});

describe('SetLoggerRow duration exercises with no load', () => {
  const timedNoLoadProps = {
    ...defaultProps,
    weight: '',
    reps: '73',
    isDurationBased: true,
    exerciseId: 'dead-hang-1',
  };

  it('logs a timed set that has no load prescription', async () => {
    const user = userEvent.setup();
    const onLog = jest.fn();
    render(<SetLoggerRow {...timedNoLoadProps} onLog={onLog} />);

    const logButton = screen.getByRole('button', { name: /Log set/i });
    expect(logButton).toBeEnabled();

    await user.click(logButton);
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog.mock.calls[0][0]).toMatchObject({ weightKg: 0, reps: 73 });
  });

  it('logs a timed set entered as zero weight', async () => {
    const user = userEvent.setup();
    const onLog = jest.fn();
    render(<SetLoggerRow {...timedNoLoadProps} weight="0" onLog={onLog} />);

    await user.click(screen.getByRole('button', { name: /Log set/i }));
    expect(onLog.mock.calls[0][0]).toMatchObject({ weightKg: 0, reps: 73 });
  });

  it('still requires a load on non-duration exercises', () => {
    render(<SetLoggerRow {...defaultProps} weight="0" reps="8" />);
    expect(screen.getByRole('button', { name: /Log set/i })).toBeDisabled();
  });
});
