/**
 * UX panel round 19 (workout screen):
 *  - the pinned "Log set" bar carries the strip's reason and forecast (the
 *    Hevy switcher logged every set from the bar and never saw "Why:");
 *  - beginner wording: "Warm-up sets", no "failure";
 *  - "last session" / "last time" only for a lift with a completed logged set.
 */
import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import { SetLoggerRow, STICKY_LOG_SLOT_ID, stickyHintText } from '../SetLoggerRow';
import { WarmupProtocol } from '../WarmupProtocol';
import { claimsPastSession, withoutUnbackedHistoryClaims } from '../whyThisWeight';
import { useUserStore } from '@/stores/userStore';
import type { User } from '@/types/schema';

jest.mock('@/lib/integrations/notifications', () => ({
  lightHaptic: jest.fn(() => Promise.resolve()),
}));

type IOCallback = (entries: Partial<IntersectionObserverEntry>[]) => void;
let ioCallback: IOCallback | null = null;

beforeEach(() => {
  ioCallback = null;
  (global as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    constructor(cb: IOCallback) {
      ioCallback = cb;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  delete (global as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  document.getElementById(STICKY_LOG_SLOT_ID)?.remove();
  useUserStore.setState({ user: null });
});

function buttonBelowFold() {
  act(() => {
    ioCallback?.([
      {
        isIntersecting: false,
        intersectionRatio: 0,
        boundingClientRect: { top: 900, bottom: 952 } as DOMRectReadOnly,
        rootBounds: { top: 0, bottom: 844 } as DOMRectReadOnly,
      },
    ]);
  });
}

function withSlot() {
  const slot = document.createElement('div');
  slot.id = STICKY_LOG_SLOT_ID;
  document.body.appendChild(slot);
  return slot;
}

const baseProps = {
  setNumber: 2,
  weight: '135',
  reps: '10',
  onWeightChange: jest.fn(),
  onRepsChange: jest.fn(),
  targetRir: 2,
  unit: 'lb' as const,
  stickyLabel: 'Barbell Bench Press',
  onLog: jest.fn(),
};

describe('pinned Log set bar: why + forecast', () => {
  const why = 'Set 1 was 140 lbs × 9 at 1 left (harder than target) → back to 135 lbs';

  it('shows the strip’s reason line and the forecast under the numbers', () => {
    const slot = withSlot();
    render(<SetLoggerRow {...baseProps} stickyHint={{ why, expect: { repCount: 10, atWeight: '135' } }} />);
    buttonBelowFold();
    const bar = within(slot).getByTestId('sticky-log-set');
    expect(within(bar).getByTestId('sticky-log-why')).toHaveTextContent(why);
    expect(within(bar).getByTestId('sticky-log-hint')).toHaveTextContent(/^Why: /);
    expect(within(bar).getByTestId('sticky-log-expect')).toHaveTextContent('Expect ~10 reps');
    // Wraps to two lines instead of truncating, so 390 px / large text keep it.
    expect(within(bar).getByTestId('sticky-log-hint')).toHaveClass('line-clamp-2');
    expect(within(bar).getByTestId('sticky-log-hint')).not.toHaveClass('truncate');
  });

  it('drops the forecast once a different weight is entered (it was made for the suggested load)', () => {
    const slot = withSlot();
    render(
      <SetLoggerRow {...baseProps} weight="145" stickyHint={{ why, expect: { repCount: 10, atWeight: '135' } }} />
    );
    buttonBelowFold();
    const bar = within(slot).getByTestId('sticky-log-set');
    expect(within(bar).queryByTestId('sticky-log-expect')).not.toBeInTheDocument();
    expect(within(bar).getByTestId('sticky-log-why')).toBeInTheDocument();
  });

  it('renders no hint line without a hint', () => {
    const slot = withSlot();
    render(<SetLoggerRow {...baseProps} />);
    buttonBelowFold();
    expect(within(slot).queryByTestId('sticky-log-hint')).not.toBeInTheDocument();
  });

  it('stickyHintText', () => {
    expect(stickyHintText(null, '135')).toBeNull();
    expect(stickyHintText({ why: '  ', expect: null }, '135')).toBeNull();
    expect(stickyHintText({ why: 'x', expect: { repCount: 9, atWeight: '140' } }, '140')).toEqual({
      why: 'x',
      expect: 'Expect ~9 reps',
    });
    expect(stickyHintText({ why: null, expect: { repCount: 9, atWeight: '140' } }, '140.0')).toEqual({
      why: null,
      expect: 'Expect ~9 reps',
    });
    expect(stickyHintText({ why: null, expect: { repCount: 9, atWeight: '140' } }, '')).toBeNull();
  });
});

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

describe('Warm-up heading', () => {
  const warmupSets = [{ setNumber: 1, percentOfWorking: 50, targetReps: 8, purpose: 'Groove the pattern', restSeconds: 60 }];

  it('says "Warm-up sets" in beginner mode', () => {
    setUser('novice', true);
    render(<WarmupProtocol warmupSets={warmupSets} workingWeight={60} minIncrement={2.5} />);
    expect(screen.getByText('Warm-up sets')).toBeInTheDocument();
    expect(screen.queryByText(/protocol/i)).not.toBeInTheDocument();
  });

  it('keeps "Warmup protocol" otherwise', () => {
    setUser('intermediate');
    render(<WarmupProtocol warmupSets={warmupSets} workingWeight={60} minIncrement={2.5} />);
    expect(screen.getByText('Warmup protocol')).toBeInTheDocument();
  });
});

describe('"last session" only with a completed logged set', () => {
  const info = {
    source: 'From your last session: 45 lbs × 10 → one more rep',
    reason: 'matching set 1 from last session (45 lbs × 10) — go one more rep',
    explanation: ['Set-position matching: last session’s set 1 was 45 lbs × 10.', 'Target: 8–12 reps.'],
    why: { ref: 'last_session' as const, refSet: '45 lbs × 10', rule: 'add_rep' as const },
    weight: '45',
  };

  it('claimsPastSession', () => {
    expect(claimsPastSession('From your last session: 45 × 10')).toBe(true);
    expect(claimsPastSession('Last time 45 lbs × 10, 2 reps left → +1 rep')).toBe(true);
    expect(claimsPastSession('Set 1 was 140 lbs × 9 → back to 135 lbs')).toBe(false);
    expect(claimsPastSession('Starting guess — pick a weight you could lift ~12 times')).toBe(false);
    expect(claimsPastSession(null)).toBe(false);
  });

  it('strips every past-session claim from a lift never logged', () => {
    const out = withoutUnbackedHistoryClaims(info, false);
    expect(out.source).toBe('');
    expect(out.reason).toBe('');
    expect(out.explanation).toEqual(['Target: 8–12 reps.']);
    expect(out.why).toBeNull();
    expect(out.weight).toBe('45'); // numbers untouched
  });

  it('leaves a lift with logged history exactly as it was', () => {
    expect(withoutUnbackedHistoryClaims(info, true)).toBe(info);
  });

  it('keeps lines that make no past-session claim', () => {
    const cold = {
      source: 'Starting guess — pick a weight you could lift ~12 times, then adjust',
      reason: 'first time on this lift',
      explanation: ['No history yet.'],
      why: { ref: null, rule: 'start_guess' as const },
    };
    expect(withoutUnbackedHistoryClaims(cold, false)).toEqual(cold);
  });
});
