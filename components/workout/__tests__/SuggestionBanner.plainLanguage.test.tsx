/**
 * Beginner-facing copy on the suggestion strip (UX panel: "RIR" and
 * "predicted max" with no explanation). The technical term stays; plain
 * words ride next to it.
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { SuggestionBanner, rirPlainLabel, type EffortCheck } from '../SuggestionBanner';

const effort = (predictedRir: number, overrides: Partial<EffortCheck> = {}): EffortCheck => ({
  predictedRir,
  weightLabel: '90 lbs',
  reps: 11,
  softened: false,
  reasoning: [],
  ...overrides,
});

const base = {
  weightLabel: '90 lbs',
  repsLabel: '8–12',
  rir: 2,
  reason: 'starting point',
  explanation: [],
};

describe('rirPlainLabel', () => {
  it('says the target in plain words', () => {
    expect(rirPlainLabel(2)).toBe('stop 2 reps short of failure');
    expect(rirPlainLabel(1)).toBe('stop 1 rep short of failure');
    expect(rirPlainLabel(0)).toBe('go to failure');
  });
});

describe('SuggestionBanner plain language', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows the RIR target with a visible plain-words gloss next to the term', () => {
    render(<SuggestionBanner {...base} />);
    expect(screen.getByTestId('suggestion-rir-plain')).toHaveTextContent(
      '(stop 2 reps short of failure)'
    );
    // The term itself is still there.
    expect(screen.getByText('RIR')).toBeInTheDocument();
  });

  it('warns in plain words instead of "predicted max"', () => {
    render(<SuggestionBanner {...base} effortCheck={effort(0)} />);
    act(() => {
      jest.advanceTimersByTime(300);
    });
    const warning = screen.getByTestId('effort-warning');
    expect(warning).toHaveTextContent("90 lbs × 11 — likely all you've got (0 left in the tank)");
    expect(warning).not.toHaveTextContent(/predicted max/);
  });

  it('past max reads as "more reps than we think you can do"', () => {
    render(<SuggestionBanner {...base} effortCheck={effort(-2)} />);
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(screen.getByTestId('effort-warning')).toHaveTextContent(
      'more reps than we think you can do at this weight'
    );
  });

  it('a 0-RIR target (to failure) does not warn about a predicted 0 — that is the plan', () => {
    render(<SuggestionBanner {...base} rir={0} effortCheck={effort(0)} />);
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(screen.queryByTestId('effort-warning')).not.toBeInTheDocument();
    expect(screen.getByTestId('suggestion-rir-plain')).toHaveTextContent('(go to failure)');
  });

  it('a 0-RIR target still warns when the entry goes past max', () => {
    render(<SuggestionBanner {...base} rir={0} effortCheck={effort(-1)} />);
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(screen.getByTestId('effort-warning')).toBeInTheDocument();
  });
});
