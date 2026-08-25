/**
 * Tests for RestTimer Component (Phase 2.3 slim bar)
 *
 * The component is fully controlled — countdown, persistence, sound, and
 * notifications live in hooks/useRestTimer (tested separately). These tests
 * cover the presentation contract: time display, elapsed-fraction progress,
 * finished state, and the +15s / Skip actions.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { RestTimer } from '../RestTimer';

const defaultProps = {
  seconds: 90,
  initialSeconds: 180,
  isRunning: true,
  isFinished: false,
  onAddTime: jest.fn(),
  onSkip: jest.fn(),
};

describe('RestTimer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('time display', () => {
    it('renders remaining time as m:ss', () => {
      render(<RestTimer {...defaultProps} seconds={90} />);
      expect(screen.getByText('1:30')).toBeInTheDocument();
    });

    it('formats single digit seconds with a leading zero', () => {
      render(<RestTimer {...defaultProps} seconds={9} />);
      expect(screen.getByText('0:09')).toBeInTheDocument();
    });

    it('renders 45 seconds as 0:45', () => {
      render(<RestTimer {...defaultProps} seconds={45} />);
      expect(screen.getByText('0:45')).toBeInTheDocument();
    });

    it('shows "Done" instead of a time when finished', () => {
      render(<RestTimer {...defaultProps} seconds={0} isRunning={false} isFinished={true} />);
      expect(screen.getByText('Done')).toBeInTheDocument();
      expect(screen.queryByText('0:00')).not.toBeInTheDocument();
    });
  });

  describe('progress bar', () => {
    it('reflects the elapsed fraction of the rest period', () => {
      render(<RestTimer {...defaultProps} seconds={45} initialSeconds={180} />);
      // 135 of 180 seconds elapsed = 75%
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');
    });

    it('is empty at the start of the rest period', () => {
      render(<RestTimer {...defaultProps} seconds={180} initialSeconds={180} />);
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    });

    it('is full when finished', () => {
      render(<RestTimer {...defaultProps} seconds={0} isFinished={true} />);
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    });

    it('handles a zero initialSeconds without dividing by zero', () => {
      render(<RestTimer {...defaultProps} seconds={0} initialSeconds={0} />);
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    });
  });

  describe('actions', () => {
    it('calls onAddTime(15) when +15s is clicked', () => {
      const onAddTime = jest.fn();
      render(<RestTimer {...defaultProps} onAddTime={onAddTime} />);

      fireEvent.click(screen.getByText('+15s'));

      expect(onAddTime).toHaveBeenCalledTimes(1);
      expect(onAddTime).toHaveBeenCalledWith(15);
    });

    it('calls onSkip when Skip is clicked', () => {
      const onSkip = jest.fn();
      render(<RestTimer {...defaultProps} onSkip={onSkip} />);

      fireEvent.click(screen.getByText('Skip'));

      expect(onSkip).toHaveBeenCalledTimes(1);
    });

    it('supports repeated +15s presses', () => {
      const onAddTime = jest.fn();
      render(<RestTimer {...defaultProps} onAddTime={onAddTime} />);

      fireEvent.click(screen.getByText('+15s'));
      fireEvent.click(screen.getByText('+15s'));

      expect(onAddTime).toHaveBeenCalledTimes(2);
    });
  });

  describe('adjustment note (effort-modulated rest)', () => {
    it('renders the modulation note while counting down', () => {
      render(
        <RestTimer {...defaultProps} adjustmentNote="+60s — last set at/near failure" />
      );
      expect(screen.getByTestId('rest-adjustment-note')).toHaveTextContent(
        '+60s — last set at/near failure'
      );
    });

    it('hides the note when finished (the countdown it explained is over)', () => {
      render(
        <RestTimer
          {...defaultProps}
          seconds={0}
          isRunning={false}
          isFinished={true}
          adjustmentNote="+60s — last set at/near failure"
        />
      );
      expect(screen.queryByTestId('rest-adjustment-note')).not.toBeInTheDocument();
    });

    it('renders nothing extra for stock rest (no note)', () => {
      render(<RestTimer {...defaultProps} />);
      expect(screen.queryByTestId('rest-adjustment-note')).not.toBeInTheDocument();
    });
  });

  describe('structure', () => {
    it('renders as a single slim bar with both action buttons', () => {
      render(<RestTimer {...defaultProps} />);
      // Two action buttons + the rest-rationale info tooltip trigger.
      const buttons = screen.getAllByRole('button');
      expect(buttons).toHaveLength(3);
      expect(screen.getByText('+15s')).toBeInTheDocument();
      expect(screen.getByText('Skip')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /learn more about rest between sets/i })
      ).toBeInTheDocument();
    });

    it('uses the success color for the finished state', () => {
      render(<RestTimer {...defaultProps} seconds={0} isFinished={true} />);
      expect(screen.getByText('Done').className).toContain('success');
    });
  });
});
