/**
 * The effort line under the logger must not read as a contradiction of the
 * banner's target ("160 × 6 @ 2 RIR" next to "about 5 more in the tank",
 * synthetic panel 2026-11-22). When the entered reps fall well short of the
 * target effort it names the reps that would land on the target.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { SetLoggerRow } from '../SetLoggerRow';

jest.mock('@/lib/integrations/notifications', () => ({
  lightHaptic: jest.fn(() => Promise.resolve()),
}));

const baseProps = {
  setNumber: 1,
  weight: '160',
  reps: '6',
  onWeightChange: jest.fn(),
  onRepsChange: jest.fn(),
  onLog: jest.fn(),
  targetRir: 2,
};

const check = (extra: Record<string, unknown>) => ({
  predictedRir: 5,
  weightLabel: '160 lbs',
  reps: 6,
  softened: false,
  reasoning: [],
  ...extra,
});

describe('SetLoggerRow effort line vs the target', () => {
  it('names the reps that would leave the target reserve when the set is well short of it', () => {
    render(<SetLoggerRow {...baseProps} effortCheck={check({ repsForTarget: 8, targetRir: 2 })} />);
    expect(screen.getByTestId('predicted-rir')).toHaveTextContent(
      'At this weight: about 5 more in the tank (cruise) · ~8 reps would leave 2',
    );
  });

  it('says nothing extra when the set is close to the target', () => {
    render(<SetLoggerRow {...baseProps} effortCheck={check({ predictedRir: 2 })} />);
    expect(screen.getByTestId('predicted-rir')).not.toHaveTextContent('would leave');
  });
});
