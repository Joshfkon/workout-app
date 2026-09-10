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
import { generateSessionSpine } from '@/lib/actions/inWorkoutCoach';

jest.mock('@/lib/actions/inWorkoutCoach', () => ({
  generateSessionSpine: jest.fn(),
  generateExerciseWhisper: jest.fn(),
  polishSignalMessage: jest.fn(),
  generateRestTip: jest.fn(),
}));

const mockGenerateSessionSpine = generateSessionSpine as jest.MockedFunction<
  typeof generateSessionSpine
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
