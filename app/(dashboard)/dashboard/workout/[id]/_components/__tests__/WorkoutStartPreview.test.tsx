/**
 * The workout screen right after Start: the first exercise from the start's
 * preview, usable (UX panel round 21: "skeleton loaders after start, so I had
 * to wait before I could log").
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  WorkoutStartPreview,
  previewReasonLine,
  previewRepsInput,
  previewStatusLine,
  previewWeightInput,
} from '../WorkoutStartPreview';
import type { PendingWorkoutPreview } from '@/lib/training/pendingWorkoutStart';

jest.mock('@/lib/integrations/notifications', () => ({
  lightHaptic: jest.fn(() => Promise.resolve()),
}));

const preview: PendingWorkoutPreview = {
  exercises: [
    {
      exerciseId: 'ex-bench',
      name: 'Bench Press',
      targetSets: 3,
      repRange: [8, 12],
      targetRir: 2,
      weightKg: 60,
      loggable: true,
    },
    {
      exerciseId: 'ex-row',
      name: 'Cable Row',
      targetSets: 3,
      repRange: [10, 15],
      targetRir: 2,
      weightKg: 50,
      loggable: true,
    },
  ],
};

describe('WorkoutStartPreview', () => {
  it('shows the first exercise with its prefilled set, a reason and what comes next', () => {
    render(
      <WorkoutStartPreview preview={preview} stage="saving" unit="kg" earlySet={null} onLogFirstSet={jest.fn()} />
    );
    expect(screen.getByRole('heading', { name: 'Bench Press' })).toBeInTheDocument();
    expect(screen.getByText('3 sets × 8–12 reps')).toBeInTheDocument();
    expect(screen.getAllByText('60').length).toBeGreaterThan(0);
    expect(screen.getByTestId('preview-reason')).toHaveTextContent('Suggested starting weight');
    expect(screen.getByTestId('preview-up-next')).toHaveTextContent('Cable Row');
    // Set 1 can be logged right here, so the status leads with that, not a wait.
    expect(screen.getByRole('status')).toHaveTextContent('Set 1 is ready to log');
  });

  it('says what it is waiting for when there is nothing to log yet', () => {
    render(
      <WorkoutStartPreview preview={preview} stage="saving" unit={null} earlySet={null} onLogFirstSet={jest.fn()} />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saving your exercises');
  });

  it('logs the first set without waiting for the screen to load', async () => {
    const user = userEvent.setup();
    const onLogFirstSet = jest.fn();
    render(
      <WorkoutStartPreview preview={preview} stage="building" unit="kg" earlySet={null} onLogFirstSet={onLogFirstSet} />
    );
    await user.click(screen.getAllByRole('button', { name: /^Log set/ })[0]);
    expect(onLogFirstSet).toHaveBeenCalledTimes(1);
    expect(onLogFirstSet.mock.calls[0][0]).toMatchObject({
      exerciseId: 'ex-bench',
      weightKg: 60,
      repCount: 8,
      feedback: { repsInTank: 2 },
    });
  });

  it('confirms a set logged here instead of offering it again', () => {
    render(
      <WorkoutStartPreview
        preview={preview}
        stage={null}
        unit="kg"
        earlySet={{ exerciseId: 'ex-bench', weightKg: 60, repCount: 9, rpe: 8, feedback: { repsInTank: 2, form: 'clean' } }}
        onLogFirstSet={jest.fn()}
      />
    );
    expect(screen.getByTestId('preview-set-logged')).toHaveTextContent('Set 1 logged: 60 kg × 9');
    expect(screen.queryByRole('button', { name: /^Log set/ })).not.toBeInTheDocument();
  });

  it('does not offer logging for a bodyweight or timed first exercise', () => {
    render(
      <WorkoutStartPreview
        preview={{ exercises: [{ ...preview.exercises[0], name: 'Plank', loggable: false }] }}
        stage="saving"
        unit="kg"
        earlySet={null}
        onLogFirstSet={jest.fn()}
      />
    );
    expect(screen.getByRole('heading', { name: 'Plank' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Log set/ })).not.toBeInTheDocument();
  });

  it('words the reason without claiming history, and handles no suggestion', () => {
    expect(previewReasonLine({ weightKg: 60, repRange: [8, 12] }, 'kg')).not.toMatch(/last (session|time)/i);
    expect(previewReasonLine({ weightKg: 0, repRange: [8, 12] }, 'kg')).toMatch(/about 12 times/);
    expect(
      previewReasonLine({ weightKg: 62.5, repRange: [8, 12], lastTopSet: { weightKg: 60, repCount: 10 } }, 'kg')
    ).toMatch(/^Last time your best set was 60 kg × 10/);
    expect(previewRepsInput({ prefillReps: 9, repRange: [8, 12] })).toBe('9');
    expect(previewRepsInput({ repRange: [8, 12] })).toBe('8');
    expect(previewWeightInput(0, 'kg')).toBe('');
    expect(previewWeightInput(60, 'lb')).toBe('132.5');
    expect(previewStatusLine(null)).toMatch(/Getting the rest/);
    expect(previewStatusLine('building', true)).toMatch(/^Set 1 is ready to log/);
    expect(previewStatusLine(null, true, true)).toMatch(/^Your full workout is ready/);
  });

  it('once the full workout has loaded, stays put and offers it instead of swapping under the finger', async () => {
    const onShowFull = jest.fn();
    render(
      <WorkoutStartPreview preview={preview} stage={null} unit="kg" earlySet={null} onLogFirstSet={jest.fn()} onShowFull={onShowFull} />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Your full workout is ready');
    // The logger is still here to tap.
    expect(screen.getAllByRole('button', { name: /log set/i }).length).toBeGreaterThan(0);
    await userEvent.setup().click(screen.getByTestId('preview-show-full'));
    expect(onShowFull).toHaveBeenCalled();
  });
});
