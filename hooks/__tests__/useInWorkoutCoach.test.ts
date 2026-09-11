/**
 * useInWorkoutCoach.test.ts — Session spine generation stability
 *
 * Regression: the workout page passes `injuries` (and other inputs) built
 * inline, so their references change on every render. The spine effect used to
 * depend on the `injuries` array by reference, which re-triggered generation
 * on every re-render (the page re-renders each rest-timer tick) — the spine
 * flashed its text briefly, then reverted to loading skeletons, forever.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useInWorkoutCoach } from '../useInWorkoutCoach';
import { generateSessionSpine, generateRestTip } from '@/lib/actions/inWorkoutCoach';

jest.mock('@/lib/actions/inWorkoutCoach', () => ({
  generateSessionSpine: jest.fn(),
  generateExerciseWhisper: jest.fn(),
  polishSignalMessage: jest.fn(),
  generateRestTip: jest.fn(),
}));

const mockGenerateSessionSpine = generateSessionSpine as jest.MockedFunction<
  typeof generateSessionSpine
>;
const mockGenerateRestTip = generateRestTip as jest.MockedFunction<
  typeof generateRestTip
>;

const baseExercise = {
  blockId: 'block-1',
  name: 'Seated Calf Raise',
  primaryMuscle: 'calves',
  sets: 3,
  setsToday: [],
};

// Builds fresh option objects/arrays the way the workout page does inline.
const buildOptions = () => ({
  exercises: [{ ...baseExercise }],
  workoutType: 'Workout',
  weekInMeso: undefined,
  totalWeeks: undefined,
  injuries: [] as Array<{ area: string; severity: 1 | 2 | 3 }>,
  units: 'kg' as const,
  enabled: true,
});

describe('useInWorkoutCoach session spine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateSessionSpine.mockResolvedValue({
      spine: ['Hit your compounds first: Seated Calf Raise'],
      generated: true,
    });
  });

  it('generates the spine once on mount and exposes it', async () => {
    const { result } = renderHook((props) => useInWorkoutCoach(props), {
      initialProps: buildOptions(),
    });

    await waitFor(() => {
      expect(result.current.sessionSpine).toEqual([
        'Hit your compounds first: Seated Calf Raise',
      ]);
    });
    expect(result.current.spineLoading).toBe(false);
    expect(mockGenerateSessionSpine).toHaveBeenCalledTimes(1);
  });

  it('does not regenerate when re-rendered with fresh but identical inline props', async () => {
    const { result, rerender } = renderHook((props) => useInWorkoutCoach(props), {
      initialProps: buildOptions(),
    });

    await waitFor(() => {
      expect(result.current.sessionSpine.length).toBeGreaterThan(0);
    });

    // Simulate the workout page re-rendering (e.g. rest-timer ticks): every
    // render builds new array/object references with the same content.
    for (let i = 0; i < 5; i++) {
      rerender(buildOptions());
    }

    await waitFor(() => {
      expect(result.current.spineLoading).toBe(false);
    });
    expect(mockGenerateSessionSpine).toHaveBeenCalledTimes(1);
    expect(result.current.sessionSpine).toEqual([
      'Hit your compounds first: Seated Calf Raise',
    ]);
  });

  it('regenerates when injury content actually changes', async () => {
    const { result, rerender } = renderHook((props) => useInWorkoutCoach(props), {
      initialProps: buildOptions(),
    });

    await waitFor(() => {
      expect(result.current.sessionSpine.length).toBeGreaterThan(0);
    });

    rerender({
      ...buildOptions(),
      injuries: [{ area: 'knee', severity: 2 as const }],
    });

    await waitFor(() => {
      expect(mockGenerateSessionSpine).toHaveBeenCalledTimes(2);
    });
  });

  it('regenerates via refreshSpine and resets completed items', async () => {
    const { result } = renderHook((props) => useInWorkoutCoach(props), {
      initialProps: buildOptions(),
    });

    await waitFor(() => {
      expect(result.current.sessionSpine.length).toBeGreaterThan(0);
    });

    act(() => {
      result.current.toggleSpineItem(0);
    });
    expect(result.current.spineCompleted.has(0)).toBe(true);

    await act(async () => {
      await result.current.refreshSpine();
    });

    expect(mockGenerateSessionSpine).toHaveBeenCalledTimes(2);
    expect(result.current.spineCompleted.size).toBe(0);
  });
});

/**
 * Regression: `restSecondsRemaining` ticks DOWN every second while the rest
 * timer runs, and the workout page re-renders on each tick. The rest-tip
 * effect used to treat "the count changed" as "new rest period", so it called
 * generateRestTip every second — and each call rolled a new random fallback
 * tip, so the displayed tip flashed to a different one every tick.
 */
describe('useInWorkoutCoach rest tip', () => {
  const buildRestOptions = (overrides: {
    isRestTimerRunning?: boolean;
    restSecondsRemaining?: number;
  } = {}) => ({
    exercises: [{ ...baseExercise }],
    workoutType: 'Workout',
    weekInMeso: undefined,
    totalWeeks: undefined,
    injuries: [] as Array<{ area: string; severity: 1 | 2 | 3 }>,
    units: 'kg' as const,
    enabled: true,
    isRestTimerRunning: overrides.isRestTimerRunning ?? true,
    restSecondsRemaining: overrides.restSecondsRemaining ?? 180,
    // Fresh object every render, like the workout page builds it inline.
    nextExercise: { name: 'Seated Calf Raise', weight: 100, repRange: '8–12' },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateSessionSpine.mockResolvedValue({ spine: [], generated: false });
    mockGenerateRestTip.mockResolvedValue({ tip: 'Brace your core', generated: false });
  });

  it('generates one tip per rest period, not one per countdown tick', async () => {
    const { result, rerender } = renderHook((props) => useInWorkoutCoach(props), {
      initialProps: buildRestOptions({ restSecondsRemaining: 180 }),
    });

    await waitFor(() => {
      expect(result.current.restTip).toBe('Brace your core');
    });

    // Timer ticks down; every tick re-renders the page with fresh inline props.
    for (let s = 179; s >= 170; s--) {
      rerender(buildRestOptions({ restSecondsRemaining: s }));
    }

    await waitFor(() => {
      expect(result.current.restTip).toBe('Brace your core');
    });
    expect(mockGenerateRestTip).toHaveBeenCalledTimes(1);
  });

  it('generates a fresh tip when the timer restarts mid-rest (count jumps up)', async () => {
    const { result, rerender } = renderHook((props) => useInWorkoutCoach(props), {
      initialProps: buildRestOptions({ restSecondsRemaining: 180 }),
    });

    await waitFor(() => {
      expect(result.current.restTip).toBe('Brace your core');
    });

    rerender(buildRestOptions({ restSecondsRemaining: 150 }));

    // Logging the next set restarts the countdown while it is still running.
    mockGenerateRestTip.mockResolvedValue({ tip: 'Controlled negatives', generated: false });
    rerender(buildRestOptions({ restSecondsRemaining: 180 }));

    await waitFor(() => {
      expect(result.current.restTip).toBe('Controlled negatives');
    });
    expect(mockGenerateRestTip).toHaveBeenCalledTimes(2);
  });

  it('clears the tip when the timer stops and generates anew next period', async () => {
    const { result, rerender } = renderHook((props) => useInWorkoutCoach(props), {
      initialProps: buildRestOptions({ restSecondsRemaining: 180 }),
    });

    await waitFor(() => {
      expect(result.current.restTip).toBe('Brace your core');
    });

    rerender(buildRestOptions({ isRestTimerRunning: false, restSecondsRemaining: 0 }));
    await waitFor(() => {
      expect(result.current.restTip).toBeNull();
    });

    rerender(buildRestOptions({ restSecondsRemaining: 120 }));
    await waitFor(() => {
      expect(result.current.restTip).toBe('Brace your core');
    });
    expect(mockGenerateRestTip).toHaveBeenCalledTimes(2);
  });
});
