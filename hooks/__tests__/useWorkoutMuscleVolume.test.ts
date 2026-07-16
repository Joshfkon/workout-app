import { renderHook } from '@testing-library/react';
import { useWorkoutMuscleVolume } from '../useWorkoutMuscleVolume';
import { RESEARCH_VOLUME_BANDS } from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import type { ExerciseBlockWithExercise } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/types';
import type { SetLog } from '@/types/schema';

// The strip shares the readiness sheet's cached history query — mock it so we
// can feed controlled completed-session history without React Query / Supabase.
jest.mock('@/hooks/useMuscleReadiness', () => ({
  useRecoveryHistory: jest.fn(),
}));
import { useRecoveryHistory } from '@/hooks/useMuscleReadiness';
const mockUseRecoveryHistory = useRecoveryHistory as unknown as jest.Mock;

type HistoryRow = ReturnType<typeof useRecoveryHistory>['historyRows'][number];

function setHistory(historyRows: HistoryRow[], isLoading = false) {
  mockUseRecoveryHistory.mockReturnValue({
    historyRows,
    sessions: [],
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

const NOW = new Date();

describe('useWorkoutMuscleVolume', () => {
  beforeEach(() => {
    mockUseRecoveryHistory.mockReset();
  });

  it('returns no rows when the session has no blocks', () => {
    setHistory([]);
    const { result } = renderHook(() =>
      useWorkoutMuscleVolume({ liveBlocks: [], liveSets: [], now: NOW })
    );
    expect(result.current.rows).toEqual([]);
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

  it('lists a muscle the workout targets from the exercises even before any set is logged', () => {
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

  it('orders the strip by what this session works most (session sets first)', () => {
    setHistory([]);
    const liveBlocks = [block('curl', 'biceps'), block('twist', 'obliques')];
    const liveSets = [
      ...Array.from({ length: 6 }, () => workingSet('curl')),
      ...Array.from({ length: 2 }, () => workingSet('twist')),
    ];
    const { result } = renderHook(() =>
      useWorkoutMuscleVolume({ liveBlocks, liveSets, now: NOW })
    );
    const muscles = result.current.rows.map((r) => r.muscle);
    // Biceps (6 session sets) ranks ahead of abs (2 session sets).
    expect(muscles.indexOf('biceps')).toBeLessThan(muscles.indexOf('abs'));
  });
});
