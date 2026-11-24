/**
 * Beginner mode on the workout screen: the same numbers, effort in plain
 * words, no "RIR" / "in the tank". Off = today's copy, unchanged.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SuggestionBanner, type EffortCheck } from '../SuggestionBanner';
import { SetLoggerRow } from '../SetLoggerRow';
import { useUserStore } from '@/stores/userStore';
import type { User } from '@/types/schema';

jest.mock('@/lib/integrations/notifications', () => ({
  lightHaptic: jest.fn(() => Promise.resolve()),
}));

function setUser(experience: User['experience'], beginnerMode?: boolean) {
  useUserStore.setState({
    user: {
      id: 'u1',
      email: '',
      createdAt: '',
      goal: 'maintenance',
      experience,
      enhancedAthleteMode: false,
      preferences: {
        units: 'kg',
        restTimerDefault: 180,
        showFormCues: true,
        showWarmupSuggestions: true,
        ...(beginnerMode === undefined ? {} : { beginnerMode }),
      },
      volumeLandmarks: {},
    } as User,
    isLoading: false,
  });
}

const effort = (predictedRir: number, extra: Partial<EffortCheck> = {}): EffortCheck => ({
  predictedRir,
  weightLabel: '60 kg',
  reps: 8,
  softened: false,
  reasoning: ['Rep-max curve (Epley): about 10 reps to failure (0 RIR).'],
  ...extra,
});

const banner = {
  weightLabel: '60 kg',
  repsLabel: '8–12',
  rir: 2,
  reason: '8 reps @ 2 RIR vs 2 target — holding load',
  explanation: ['Target: 8–12 reps leaving 2 in reserve (RIR 2).'],
};

afterEach(() => useUserStore.setState({ user: null }));

describe('SuggestionBanner in beginner mode', () => {
  it('says the target in words, with no RIR anywhere on the strip', () => {
    setUser('novice', true);
    const { container } = render(<SuggestionBanner {...banner} />);
    expect(screen.getByTestId('suggestion-rir-plain')).toHaveTextContent('· stop when you could still do 2 more');
    // No "failure" for a beginner (UX panel round 19).
    expect(container).not.toHaveTextContent(/failure/);
    expect(container).not.toHaveTextContent(/RIR/);
    // The jargon-dense engine reason moves off the strip.
    expect(container).not.toHaveTextContent(/holding load/);
  });

  it('rewrites the info sheet without RIR', async () => {
    setUser('novice', true);
    const user = userEvent.setup();
    render(<SuggestionBanner {...banner} />);
    await user.click(screen.getByRole('button', { name: 'How this suggestion works' }));
    const sheet = screen.getByRole('dialog');
    expect(sheet).not.toHaveTextContent(/RIR/);
    expect(sheet).toHaveTextContent('8 reps with 2 reps left vs 2 target — holding load');
    expect(sheet).toHaveTextContent('Target: 8–12 reps stopping when you could still do 2 more.');
    expect(sheet).not.toHaveTextContent(/failure/);
  });

  it('keeps the existing copy when beginner mode is off', () => {
    setUser('intermediate');
    render(<SuggestionBanner {...banner} />);
    expect(screen.getByText('RIR')).toBeInTheDocument();
    expect(screen.getByTestId('suggestion-rir-plain')).toHaveTextContent('(stop 2 reps short of failure)');
  });

  it('turns on by default for a novice with no saved choice', () => {
    setUser('novice');
    const { container } = render(<SuggestionBanner {...banner} />);
    expect(container).not.toHaveTextContent(/RIR/);
  });

  it('drops "in the tank" from the at-max warning', () => {
    setUser('novice', true);
    jest.useFakeTimers();
    try {
      render(<SuggestionBanner {...banner} effortCheck={effort(0)} />);
      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(screen.getByTestId('effort-warning')).toHaveTextContent("60 kg × 8 — likely all you've got");
      expect(screen.getByTestId('effort-warning')).not.toHaveTextContent(/tank/);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('SetLoggerRow in beginner mode', () => {
  const props = {
    setNumber: 1,
    weight: '60',
    reps: '8',
    onWeightChange: jest.fn(),
    onRepsChange: jest.fn(),
    onLog: jest.fn(),
    targetRir: 2,
  };

  it('says how many reps are left in plain words', () => {
    setUser('novice', true);
    render(<SetLoggerRow {...props} effortCheck={effort(1)} />);
    expect(screen.getByTestId('predicted-rir')).toHaveTextContent('At this weight: about 1 more rep in you');
    expect(screen.getByTestId('predicted-rir')).not.toHaveTextContent(/tank|RIR/);
    expect(screen.getByRole('button', { name: 'How this prediction works' })).toBeInTheDocument();
  });

  it('points at the target without "leave N"', () => {
    setUser('novice', true);
    render(<SetLoggerRow {...props} effortCheck={effort(5, { repsForTarget: 11, targetRir: 2 })} />);
    expect(screen.getByTestId('predicted-rir')).toHaveTextContent(
      'about 5 more reps in you · ~11 reps would hit your target'
    );
  });

  it('keeps the existing line when off', () => {
    setUser('advanced', false);
    render(<SetLoggerRow {...props} effortCheck={effort(1)} />);
    expect(screen.getByTestId('predicted-rir')).toHaveTextContent('about 1 more in the tank (hard)');
  });
});
