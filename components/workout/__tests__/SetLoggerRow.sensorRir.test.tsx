/**
 * Motion-capture RIR prefill on the logger row: an untouched chip takes the
 * sensor estimate (logged with rirSource 'sensor'); a chip the lifter
 * already tapped is never overwritten — the estimate is offered instead.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SetLoggerRow } from '../SetLoggerRow';

jest.mock('@/lib/integrations/notifications', () => ({
  lightHaptic: jest.fn(() => Promise.resolve()),
}));

const baseProps = {
  setNumber: 2,
  weight: '220',
  reps: '8',
  onWeightChange: jest.fn(),
  onRepsChange: jest.fn(),
  targetRir: 3,
};

const chip = (name: RegExp) => screen.getByRole('button', { name });

describe('SetLoggerRow sensor RIR prefill', () => {
  it('preselects the estimate on an untouched chip and logs it as sensor-sourced', async () => {
    const user = userEvent.setup();
    const onLog = jest.fn();
    const { rerender } = render(<SetLoggerRow {...baseProps} onLog={onLog} />);
    expect(chip(/^3 reps in reserve/)).toHaveAttribute('aria-pressed', 'true');

    rerender(<SetLoggerRow {...baseProps} onLog={onLog} sensorRirPrefill={{ nonce: 1, rir: 2 }} />);
    expect(chip(/^2 reps in reserve/)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('sensor-rir-note')).toHaveTextContent('2 RIR estimated from bar speed');

    await user.click(screen.getByRole('button', { name: /^Log set/ }));
    expect(onLog.mock.calls[0][0].feedback).toMatchObject({ repsInTank: 2, rirSource: 'sensor' });
    expect(onLog.mock.calls[0][0].rpe).toBe(7.5);
  });

  it('a chip tap after the prefill makes the RIR the lifter’s own', async () => {
    const user = userEvent.setup();
    const onLog = jest.fn();
    render(<SetLoggerRow {...baseProps} onLog={onLog} sensorRirPrefill={{ nonce: 1, rir: 2 }} />);
    await user.click(chip(/^1 reps in reserve/));
    expect(screen.queryByTestId('sensor-rir-note')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Log set/ }));
    expect(onLog.mock.calls[0][0].feedback.repsInTank).toBe(1);
    expect(onLog.mock.calls[0][0].feedback).not.toHaveProperty('rirSource');
  });

  it('never overwrites a chip already tapped — offers the estimate instead', async () => {
    const user = userEvent.setup();
    const onLog = jest.fn();
    const { rerender } = render(<SetLoggerRow {...baseProps} onLog={onLog} />);
    await user.click(chip(/^0 reps in reserve/));

    rerender(<SetLoggerRow {...baseProps} onLog={onLog} sensorRirPrefill={{ nonce: 1, rir: 2 }} />);
    expect(chip(/^0 reps in reserve/)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('sensor-rir-offer')).toHaveTextContent('Bar speed suggests 2 RIR.');

    await user.click(screen.getByTestId('sensor-rir-offer-use'));
    expect(chip(/^2 reps in reserve/)).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /^Log set/ }));
    expect(onLog.mock.calls[0][0].feedback).toMatchObject({ repsInTank: 2, rirSource: 'sensor' });
  });

  it('a prescription change mid-set keeps the estimate; the next set clears it', () => {
    const onLog = jest.fn();
    const prefill = { nonce: 1, rir: 1 as const };
    const { rerender } = render(<SetLoggerRow {...baseProps} onLog={onLog} sensorRirPrefill={prefill} />);
    rerender(<SetLoggerRow {...baseProps} targetRir={2} onLog={onLog} sensorRirPrefill={prefill} />);
    expect(chip(/^1 reps in reserve/)).toHaveAttribute('aria-pressed', 'true');

    rerender(<SetLoggerRow {...baseProps} setNumber={3} targetRir={2} onLog={onLog} sensorRirPrefill={null} />);
    expect(chip(/^2 reps in reserve/)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('sensor-rir-note')).toBeNull();
  });
});
