'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserStore } from '@/stores';
import {
  assessVolumeStatus,
  type MuscleVolumeData,
} from '@/services/volumeTracker';
import { STANDARD_MUSCLE_GROUPS, type VolumeLandmarks } from '@/types/schema';
import {
  buildVolumeRows,
  coarseMevTiles,
  computeReachableMuscles,
  computeWeeklyMuscleVolume,
  isMuscleWarnable,
  round1Sets,
  roundWholeSets,
  setsByStandardMuscle,
  weeklyVolumeWindowStartISO,
  type CoarseMevTiles,
  type VolumeRow,
  type WeeklyVolumeBlockRow,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import { localDay, parseLocalDay } from '@/lib/date/localDay';

interface UseWeeklyVolumeOptions {
  /** `YYYY-MM-DD` window start; defaults to the shared rolling-7-day window. */
  weekStart?: string;
}

/** Everything the hook derives from one fetch of the week's blocks. */
export interface WeeklyVolumeDerived {
  /**
   * PER-HEAD volume (26 standard muscles), uncapped — a set may credit two
   * heads of the same group, which is correct for per-head programming
   * decisions. Do NOT sum this for a week total: use `tiles.totalSets`.
   */
  volumeData: MuscleVolumeData[];
  /** The shared coarse row model (same one the volume page renders). */
  rows: VolumeRow[];
  /** Glance-tile totals off `rows` — the canonical "sets this week". */
  tiles: CoarseMevTiles;
}

const EMPTY_TILES: CoarseMevTiles = {
  totalSets: 0,
  totalEffectiveSets: 0,
  totalTarget: 0,
  lowCount: 0,
};

/**
 * Blocks -> the shared volume model. Pure, so the parity between this hook's
 * numbers and the home glance tile's is testable without a DB.
 *
 * ONE accumulation pass (computeWeeklyMuscleVolume) feeds BOTH views: the
 * capped coarse rows the week total comes from, and the uncapped per-head
 * rollup the recovery/suggestion surfaces read. Before this, the hook ran its
 * own second pass and summed the 26 standard rows for its total — uncapped and
 * rounded per muscle, which reported ~15% more sets than the home tile for the
 * same week.
 */
export function deriveWeeklyVolume(
  blocks: WeeklyVolumeBlockRow[],
  getVolumeLandmarks: (muscle: string) => VolumeLandmarks
): WeeklyVolumeDerived {
  const stats = computeWeeklyMuscleVolume(blocks);
  const reachable = computeReachableMuscles(blocks);
  const rows = buildVolumeRows(stats, reachable);
  const byStandard = setsByStandardMuscle(stats);

  // Fine members the user's own exercise tagging can't feed are dropped (same
  // reachability gate as buildVolumeRows) so a coarse-only logger never sees an
  // un-clearable below-MEV row.
  const volumeData: MuscleVolumeData[] = STANDARD_MUSCLE_GROUPS.filter((muscle) =>
    isMuscleWarnable(muscle, reachable)
  ).map((muscle) => {
    const rollup = byStandard.get(muscle);
    // Round ONCE, off the full-precision total. Direct is rounded for display
    // and indirect is taken as the remainder, so direct + indirect === total
    // always holds (rounding the two apart is what inflated every row).
    const totalSets = roundWholeSets(rollup?.sets ?? 0);
    const directSets = Math.min(totalSets, roundWholeSets(rollup?.directSets ?? 0));
    const landmarks = getVolumeLandmarks(muscle);
    return {
      muscleGroup: muscle,
      totalSets,
      directSets,
      indirectSets: totalSets - directSets,
      effectiveVolumeSets: round1Sets(rollup?.effectiveSets ?? 0),
      landmarks,
      status: assessVolumeStatus(totalSets, landmarks),
      percentOfMrv:
        landmarks.mrv > 0 ? Math.round((totalSets / landmarks.mrv) * 100) : 0,
    };
  });

  // `buildVolumeRows` always emits all 13 coarse rows, so with no logged
  // volume its tiles would read "0 sets, 13 below MEV". Report the empty tiles
  // instead — same "no volume yet" semantics the home glance tile uses.
  return { volumeData, rows, tiles: stats.length > 0 ? coarseMevTiles(rows) : EMPTY_TILES };
}

/**
 * The week's training volume, derived from `set_logs` through the SHARED
 * pipeline (`app/(dashboard)/dashboard/_lib/weeklyVolume`) that the home glance
 * tile, volume page, readiness sheet and atrophy warning all render from — so
 * no surface can report a different number of sets for the same week.
 */
export function useWeeklyVolume(options: UseWeeklyVolumeOptions = {}) {
  const [blocks, setBlocks] = useState<WeeklyVolumeBlockRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { getVolumeLandmarks } = useUserStore();

  // The window lower bound is the SHARED local-day-anchored one: a bare
  // `YYYY-MM-DD` string compared against a timestamptz would be read as UTC
  // midnight and pull in part of an extra day in negative-offset timezones.
  const windowStartIso = useMemo(
    () =>
      options.weekStart
        ? parseLocalDay(options.weekStart).toISOString()
        : weeklyVolumeWindowStartISO(),
    [options.weekStart]
  );

  const fetchVolume = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const supabase = createUntypedClient();

      // ALWAYS derive from set_logs. The old weekly_muscle_volume stored-rows
      // fast-path is gone: no production code ever wrote that table, and any
      // rows an old build / migration / fixture might leave behind would
      // freeze stale-convention (pre-group-cap) numbers over live derivation.
      // The table itself is dropped (20260730000001) so the trap cannot be
      // re-armed by a future writer.
      //
      // Same select as the dashboard's weekly-volume query, `feedback`
      // included: without it there is no RIR to weight with and the effective
      // volume silently degrades to the raw count. Rows are scoped to the
      // signed-in user by RLS on workout_sessions.
      const { data, error: queryError } = await supabase
        .from('exercise_blocks')
        .select(`
          id,
          exercises (
            id,
            name,
            primary_muscle,
            secondary_muscles
          ),
          set_logs (
            id,
            is_warmup,
            feedback
          ),
          workout_sessions!inner (
            id,
            completed_at,
            user_id,
            state
          )
        `)
        .eq('workout_sessions.state', 'completed')
        .gte('workout_sessions.completed_at', windowStartIso);

      if (queryError) throw queryError;
      setBlocks((data ?? []) as WeeklyVolumeBlockRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch volume');
      setBlocks([]);
    } finally {
      setIsLoading(false);
    }
  }, [windowStartIso]);

  useEffect(() => {
    fetchVolume();
  }, [fetchVolume]);

  const { volumeData, rows, tiles } = useMemo(
    () => deriveWeeklyVolume(blocks, getVolumeLandmarks),
    [blocks, getVolumeLandmarks]
  );

  return {
    /** Per-head (26 standard muscles), uncapped — never sum for a week total. */
    volumeData,
    /** Shared coarse row model. */
    rows,
    /** Canonical week totals: totalSets / totalEffectiveSets / totalTarget / lowCount. */
    tiles,
    isLoading,
    error,
    /** Window start as a localDay string (`YYYY-MM-DD`). */
    weekStart: localDay(new Date(windowStartIso)),
    windowStartIso,
    refetch: fetchVolume,
  };
}
