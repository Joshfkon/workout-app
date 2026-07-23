/**
 * Tests for the SetLoggerRow feedback sheet restyle.
 *
 * The form chips in the feedback sheet must be styled exactly like the
 * effort (3/2/1/0) chips — same height and radius, neutral gray when
 * unselected, solid semantic tint only on the selected chip — and selection
 * must round-trip the exact same values through onLog as before.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
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

  describe('predicted RIR readout', () => {
    const baseEffortCheck = {
      predictedRir: 3,
      weightLabel: '100 kg',
      reps: 8,
      softened: false,
      reasoning: [
        'Capacity anchor: ~140 kg estimated 1RM — from your strongest set logged this session.',
        'Rep-max curve (Epley): at 100 kg, that capacity predicts about 11 reps to failure (0 RIR).',
      ],
    };

    it('renders nothing without an effortCheck', () => {
      render(<SetLoggerRow {...defaultProps} />);
      expect(screen.queryByTestId('predicted-rir')).not.toBeInTheDocument();
    });

    it('shows the predicted RIR with its effort label', () => {
      render(<SetLoggerRow {...defaultProps} effortCheck={baseEffortCheck} />);
      expect(screen.getByTestId('predicted-rir')).toHaveTextContent('Predicted: ~3 RIR (easy)');
    });

    it('shows the honest number above 4 with the cruise label', () => {
      render(
        <SetLoggerRow {...defaultProps} effortCheck={{ ...baseEffortCheck, predictedRir: 7 }} />
      );
      expect(screen.getByTestId('predicted-rir')).toHaveTextContent('Predicted: ~7 RIR (cruise)');
    });

    it('turns amber at 0 RIR and reads past-max below 0', () => {
      const { rerender } = render(
        <SetLoggerRow {...defaultProps} effortCheck={{ ...baseEffortCheck, predictedRir: 0 }} />
      );
      const readout = screen.getByTestId('predicted-rir');
      expect(readout).toHaveTextContent('Predicted: ~0 RIR (maxed)');
      expect(readout.querySelector('[aria-live]')!.className).toContain('text-amber-400');

      rerender(
        <SetLoggerRow {...defaultProps} effortCheck={{ ...baseEffortCheck, predictedRir: -2 }} />
      );
      expect(screen.getByTestId('predicted-rir')).toHaveTextContent(
        'Predicted: 2 reps past your max'
      );
    });

    it('marks a transferred (no own history) estimate as rough', () => {
      render(
        <SetLoggerRow {...defaultProps} effortCheck={{ ...baseEffortCheck, softened: true }} />
      );
      expect(screen.getByTestId('predicted-rir')).toHaveTextContent('rough estimate');
    });

    it('opens the reasoning sheet from the (i) with every reasoning line', async () => {
      const user = userEvent.setup();
      render(<SetLoggerRow {...defaultProps} effortCheck={baseEffortCheck} />);

      expect(screen.queryByTestId('predicted-rir-reasoning')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'How this RIR prediction works' }));

      expect(screen.getByText('Why 100 kg × 8 ≈ 3 RIR')).toBeInTheDocument();
      for (const line of baseEffortCheck.reasoning) {
        expect(screen.getByText(line)).toBeInTheDocument();
      }

      await user.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByTestId('predicted-rir-reasoning')).not.toBeInTheDocument();
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
