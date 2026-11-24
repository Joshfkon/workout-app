/**
 * The "Are you progressing?" card states the answer and keeps HOW the trends
 * are worked out behind one closed info toggle (UX panel r19: repeated,
 * wordy method text; "flat" threshold not stated).
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProgressSummaryCard } from '../ProgressSummaryCard';
import type { ProgressSummary } from '../progressSummary';

const summary: ProgressSummary = {
  weight: 'Weight is down 2.8 lb over the last 30 days.',
  weightMethod: 'Your weight trend uses all 8 weigh-ins from the last 30 days.',
  liftMethod: 'A lift is rising when its est. max goes up more than 0.15% a week.',
  strength: 'Over the last 12 weeks, your 2 tracked lifts are holding steady.',
  strengthContext: "You're on a cut, so lifts holding steady is a good result: you're keeping your strength while you lose fat.",
  strengthNames: null,
  lifts: [],
};

describe('ProgressSummaryCard', () => {
  it('shows the answer, the cut context, and the method only behind the info toggle', async () => {
    const user = userEvent.setup();
    render(<ProgressSummaryCard summary={summary} />);
    expect(screen.getByTestId('progress-summary-weight')).toHaveTextContent('Weight is down 2.8 lb');
    expect(screen.getByTestId('progress-summary-strength-context')).toHaveTextContent(/on a cut/);

    const help = screen.getByTestId('progress-trend-help');
    expect(help).not.toHaveAttribute('open');
    await user.click(within(help).getByText('How trends are worked out'));
    expect(help).toHaveAttribute('open');
    expect(screen.getByTestId('progress-summary-weight-method')).toHaveTextContent(/8 weigh-ins/);
    expect(screen.getByTestId('progress-summary-lift-method')).toHaveTextContent(/0\.15% a week/);
  });

  it('has no toggle when there is nothing to explain', () => {
    render(
      <ProgressSummaryCard
        summary={{ ...summary, weightMethod: null, liftMethod: null, strengthContext: null }}
      />
    );
    expect(screen.queryByTestId('progress-trend-help')).not.toBeInTheDocument();
    expect(screen.queryByTestId('progress-summary-strength-context')).not.toBeInTheDocument();
  });
});
