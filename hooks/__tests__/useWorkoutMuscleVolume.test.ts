import { renderHook } from '@testing-library/react';
import { useWorkoutMuscleVolume } from '../useWorkoutMuscleVolume';
import { COARSE_MUSCLES, RESEARCH_VOLUME_BANDS } from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import { getLocalDateString } from '@/lib/utils';
import type { ExerciseBlockWithExercise } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/types';
import type { SetLog } from '@/types/schema';
import type { RecoverySession } from '@/services/muscleRecovery';

// The strip shares the readiness sheet's cached history query — mock it so we
// can feed controlled completed-session history without React Query / Supabase.
jest.mock('@/hooks/useMuscleReadiness', () => {
  const actual = jest.requireActual('@/hooks/useMuscleReadiness');
  return { rirFromSetLog: actual.rirFromSetLog, useRecoveryHistory: jest.fn() };
});
// Recovery-config inputs (learned multipliers, wearable, sleep, user profile)
// are all React Query / Supabase backed — neutral values keep the heuristic
// on its documented defaults.
jest.mock('@/hooks/useRecoveryMultipliers', () => ({
  useRecoveryMultipliers: () => ({ multipliers: {} }),
}));
jest.mock('@/hooks/useWearableRecovery', () => ({
  useWearableRecovery: () => ({ state: { scale: 1 } }),
}));
jest.mock('@/hooks/useSleepLog', () => ({
  useSleepLog: () => ({ entries: [] }),
}));
jest.mock('@/stores', () => ({
  useUserStore: (selector: (s: { user: null }) => unknown) => selector({ user: null }),
}));
import { useRecoveryHistory } from '@/hooks/useMuscleReadiness';
const mockUseRecoveryHistory = useRecoveryHistory as unknown as jest.Mock;

type HistoryRow = ReturnType<typeof useRecoveryHistory>['historyRows'][number];

function setHistory(historyRows: HistoryRow[], isLoading = false, sessions: RecoverySession[] = []) {
  mockUseRecoveryHistory.mockReturnValue({
    historyRows,
    sessions,
    isLoading,
    error: null,
    refetch: () => {},
  });
}

function block(id: string, primaryMuscle: string, secondaryMuscles: string[] = []): ExerciseBlockWithExercise {
  return {
    id,
    exercise: { id: `ex-${id}`, name: `Exercise ${id}`, primaryMuscle, secondaryMuscles },
  } as unknown as ExerciseBlockWithExercise;
}

function workingSet(exerciseBlockId: string): SetLog {
  return { exerciseBlockId, isWarmup: false, setType: 'working' } as unknown as SetLog;
}

function historyRow(primaryMuscle: string, workingSets: number, secondaryMuscles: string[] = []): HistoryRow {
  return {
    sessionId: `s-${primaryMuscle}`,
    completedAt: new Date().toISOString(),
    exercises: [
      {
        primaryMuscle,
        secondaryMuscles,
        sets: Array.from({ length: workingSets }, () => ({ repsInTank: 2 })),
      },
    ],
  };
}

/** A completed session for the recovery model, `hoursAgo` before NOW. */
function recoverySession(primaryMuscle: string, hoursAgo: number, setCount = 4): RecoverySession {
  return {
    performedAt: new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000),
    exercises: [
      {
        primaryMuscle,
        secondaryMuscles: [],
        sets: Array.from({ length: setCount }, () => ({ repsInTank: 3 })),
      },
    ],
  };
}

const NOW = new Date();

describe('useWorkoutMuscleVolume', () => {
  beforeEach(() => {
    mockUseRecoveryHistory.mockReset();
    window.localStorage.clear();
  });

  it('lists every coarse muscle group, even with no blocks in the session', () => {
    setHistory([]);
    const { result } = renderHook(() =>
      useWorkoutMuscleVolume({ liveBlocks: [], liveSets: [], now: NOW })
    );
    expect(result.current.rows).toHaveLength(COARSE_MUSCLES.length);
    expect(result.current.rows.every((r) => r.sets === 0)).toBe(true);
  });

  it('sums completed history + live session sets against the coarse MEV–MRV band', () => {
    setHistory([historyRow('biceps', 6)]);
    const liveBlocks = [block('b1', 'biceps')];
    const liveSets = Array.from({ length: 6 }, () => workingSet('b1'));

    const { result } = renderHook(() =>
      useWorkoutMuscleVolume({ liveBlocks, liveSets, now: NOW })
    );

    const biceps = result.current.rows.find((r) => r.muscle === 'biceps');
    expect(biceps).toBeDefined();
    // 6 from history + 6 logged this session.
    expect(biceps!.sets).toBe(12);
    expect(biceps!.sessionSets).toBe(6);
    expect(biceps!.band).toEqual(RESEARCH_VOLUME_BANDS.biceps);
    // 12 sits inside biceps' 6–20 band.
    expect(biceps!.zone).toBe('in_zone');
  });

  it('flags the coarse groups this session trains (primary + secondary)', () => {
    setHistory([]);
    const { result } = renderHook(() =>
      useWorkoutMuscleVolume({
        liveBlocks: [block('b1', 'biceps', ['forearms'])],
        liveSets: [],
        now: NOW,
      })
    );
    const trained = result.current.rows.filter((r) => r.trainedThisSession).map((r) => r.muscle);
    expect(trained.sort()).toEqual(['biceps', 'forearms']);
    expect(result.current.rows.find((r) => r.muscle === 'chest')!.trainedThisSession).toBe(false);
  });

  it('rolls a fine live-session muscle into its coarse row', () => {
    setHistory([]);
    const { result } = renderHook(() =>
      useWorkoutMuscleVolume({ liveBlocks: [block('b1', 'obliques')], liveSets: [], now: NOW })
    );
    // obliques rolls up into the coarse "abs" row; present with 0 weekly sets.
    const abs = result.current.rows.find((r) => r.muscle === 'abs');
    expect(abs).toBeDefined();
    expect(abs!.sets).toBe(0);
    expect(abs!.zone).toBe('below_mev');
  });

  it('reports full readiness for an untrained muscle and zero for a just-trained one', () => {
    setHistory([]);
    const liveBlocks = [block('curl', 'biceps'), block('twist', 'obliques')];
    const liveSets = Array.from({ length: 4 }, () => workingSet('curl'));

    const { result } = renderHook(() =>
      useWorkoutMuscleVolume({ liveBlocks, liveSets, now: NOW })
    );

    const abs = result.current.rows.find((r) => r.muscle === 'abs')!;
    expect(abs.readiness).toBe(1);
    expect(abs.readyInHours).toBe(0);

    // Biceps sets logged in the LIVE session read as just-trained.
    const biceps = result.current.rows.find((r) => r.muscle === 'biceps')!;
    expect(biceps.readiness).toBe(0);
    expect(biceps.readyInHours).toBeGreaterThan(0);
  });

  it('orders the strip by readiness descending', () => {
    // Biceps trained 6h ago (well inside its window) vs never-trained abs.
    setHistory([], false, [recoverySession('biceps', 6)]);
    const liveBlocks = [block('curl', 'biceps'), block('twist', 'obliques')];

    const { result } = renderHook(() =>
      useWorkoutMuscleVolume({ liveBlocks, liveSets: [], now: NOW })
    );

    const muscles = result.current.rows.map((r) => r.muscle);
    expect(muscles.indexOf('abs')).toBeLessThan(muscles.indexOf('biceps'));
  });

  it('breaks readiness ties by what this session works most (session sets first)', () => {
    setHistory([]);
    const liveBlocks = [block('curl', 'biceps'), block('twist', 'obliques')];
    const liveSets = [
      ...Array.from({ length: 6 }, () => workingSet('curl')),
      ...Array.from({ length: 2 }, () => workingSet('twist')),
    ];
    const { result } = renderHook(() =>
      useWorkoutMuscleVolume({ liveBlocks, liveSets, now: NOW })
    );
    // Both just trained live (readiness 0) → biceps (6 session sets) first.
    const muscles = result.current.rows.map((r) => r.muscle);
    expect(muscles.indexOf('biceps')).toBeLessThan(muscles.indexOf('abs'));
  });

  it('freezes the day-one order: readiness changes later the same day do not reshuffle', () => {
    // First loaded render of the day: abs fresh, biceps recovering → abs first.
    setHistory([], false, [recoverySession('biceps', 6)]);
    const liveBlocks = [block('curl', 'biceps'), block('twist', 'obliques')];

    const first = renderHook(() =>
      useWorkoutMuscleVolume({ liveBlocks, liveSets: [], now: NOW })
    );
    const frozenOrder = first.result.current.rows.map((r) => r.muscle);
    expect(frozenOrder.indexOf('abs')).toBeLessThan(frozenOrder.indexOf('biceps'));
    first.unmount();

    // Later the same local day the picture inverts (abs just trained live,
    // biceps now fully recovered) — a fresh mount still replays the frozen order.
    setHistory([], false, [recoverySession('biceps', 200)]);
    const liveSets = Array.from({ length: 4 }, () => workingSet('twist'));
    const second = renderHook(() =>
      useWorkoutMuscleVolume({ liveBlocks, liveSets, now: NOW })
    );
    const abs = second.result.current.rows.find((r) => r.muscle === 'abs')!;
    expect(abs.readiness).toBe(0); // live sets DID move the score…
    expect(second.result.current.rows.map((r) => r.muscle)).toEqual(frozenOrder); // …but not the order
  });

  it('appends muscles the frozen order has not seen (e.g. a partial stored order)', () => {
    // A stale/partial stored order (say, from a build before every group was
    // listed) must not hide the other groups — they append after it.
    const localDay = getLocalDateString(NOW);
    window.localStorage.setItem(`workout-volume-strip-order:${localDay}`, JSON.stringify(['abs', 'biceps']));

    setHistory([]);
    const { result } = renderHook(() =>
      useWorkoutMuscleVolume({ liveBlocks: [], liveSets: [], now: NOW })
    );

    const muscles = result.current.rows.map((r) => r.muscle);
    expect(muscles.slice(0, 2)).toEqual(['abs', 'biceps']);
    expect(muscles).toHaveLength(COARSE_MUSCLES.length);
    // The persisted order was extended with the appended muscles.
    const stored = JSON.parse(window.localStorage.getItem(`workout-volume-strip-order:${localDay}`)!);
    expect(stored).toEqual(muscles);
  });

  it('does not freeze an order from a still-loading render', () => {
    setHistory([], true);
    const loading = renderHook(() =>
      useWorkoutMuscleVolume({ liveBlocks: [block('curl', 'biceps')], liveSets: [], now: NOW })
    );
    loading.unmount();
    expect(
      Object.keys(window.localStorage).some((k) => k.startsWith('workout-volume-strip-order:'))
    ).toBe(false);
  });
});
