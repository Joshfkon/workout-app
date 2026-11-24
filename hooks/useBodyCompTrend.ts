'use client';

/**
 * useBodyCompTrend
 *
 * Fetches weight_log + dexa_scans and builds the DEXA-anchored body
 * composition trend (services/bodyCompAnchor). This is the ONE data source
 * for every surface derived from the anchored series: the Body Composition
 * Trend chart AND the Analytics FFMI gauge (which must equal the last point
 * of the trend's FFMI series).
 *
 * The actual row→trend pipeline (unit conversion, waist-EWMA shaping,
 * personalized projection p-ratio) lives in
 * lib/body-composition/trendBuilder — SHARED with the Home card's server
 * action so both surfaces produce identical trends for identical data.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalUserId } from '@/lib/supabase/authState';
import { IMMUTABLE_GC_TIME } from '@/lib/query/queryClient';
import { type AnchoredTrendPoint } from '@/services/bodyCompAnchor';
import {
  buildPersonalizedBodyCompTrend,
  type TrendDexaRow,
  type TrendProfileRows,
  type TrendWaistRow,
  type TrendWeightRow,
} from '@/lib/body-composition/trendBuilder';
import { localDay, rollingWindowStart } from '@/lib/date/localDay';
import { cmToIn } from '@/lib/utils';

export interface WeightHistoryEntry {
  date: string;
  weight: number;
  unit: 'lb' | 'kg';
}

export interface WaistHistoryEntry {
  /** localDay YYYY-MM-DD */
  day: string;
  /** Waist in inches (stored cm, converted here like the trend builder). */
  waistIn: number;
}

export interface BodyCompTrendData {
  /** Anchored trend, sorted by date ascending; [] until scans exist. */
  trend: AnchoredTrendPoint[];
  /** Raw weigh-ins in their logged unit (for the weight chart). */
  weightHistory: WeightHistoryEntry[];
  /** Waist tape entries in inches (for the phase assessment). */
  waistHistory: WaistHistoryEntry[];
  isLoading: boolean;
}

/** The raw rows behind the trend (JSON-plain, so the cache can persist them). */
export interface BodyTrendRows {
  weightRows: TrendWeightRow[];
  scans: TrendDexaRow[];
  waistRows: TrendWaistRow[];
  profileRows: TrendProfileRows | null;
}

/**
 * Persisted ('analytics' prefix): Progress's "Are you progressing?" summary
 * and the weight chart wait on these rows, and as a fetch-in-useEffect
 * (behind a getUser() network round trip) they re-blocked the summary on a
 * skeleton on EVERY visit (UX panel r21: "showed a loading state before the
 * data"). Now a revisit or reload paints from cache and refetches behind it.
 */
export const BODY_TREND_QUERY_KEY = ['analytics', 'body-trend'] as const;

const EMPTY_ROWS: BodyTrendRows = { weightRows: [], scans: [], waistRows: [], profileRows: null };

export async function fetchBodyTrendRows(): Promise<BodyTrendRows> {
  const supabase = createUntypedClient();
  // Identity from the locally persisted session — no getUser() round trip
  // (RLS still checks the token on every read below).
  const userId = await getLocalUserId(supabase);
  if (!userId) return EMPTY_ROWS;

  const yearAgoDay = localDay(rollingWindowStart(365));
  const [weightsRes, scansRes, waistRes, userRes, volumeProfileRes] = await Promise.all([
    supabase
      .from('weight_log')
      .select('logged_at, weight, unit')
      .eq('user_id', userId)
      .gte('logged_at', yearAgoDay)
      .order('logged_at', { ascending: true }),
    supabase
      .from('dexa_scans')
      .select('scan_date, body_fat_percent, lean_mass_kg, fat_mass_kg, weight_kg, bone_mass_kg')
      .eq('user_id', userId)
      .order('scan_date', { ascending: true }),
    // Waist tape entries (cm) shape the estimated BF% interior between
    // scans. Non-fatal: if the read fails the trend just runs unbent.
    supabase
      .from('body_measurements')
      .select('logged_at, waist')
      .eq('user_id', userId)
      .gte('logged_at', yearAgoDay)
      .not('waist', 'is', null)
      .order('logged_at', { ascending: true }),
    // Profile slices feeding the personalized projection p-ratio.
    // Non-fatal: absent rows just leave the projection at the 0.5 default.
    supabase.from('users').select('height_cm, goal, sex, age').eq('id', userId).maybeSingle(),
    supabase.from('user_volume_profiles').select('training_age, is_enhanced').eq('user_id', userId).maybeSingle(),
  ]);
  // A failed weigh-in or scan read fails the query (React Query keeps the
  // last good rows on screen) — never cached and persisted as "no data".
  if (weightsRes.error) throw weightsRes.error;
  if (scansRes.error) throw scansRes.error;

  return {
    weightRows: (weightsRes.data ?? []) as TrendWeightRow[],
    scans: (scansRes.data ?? []) as TrendDexaRow[],
    waistRows: (waistRes.data ?? []) as TrendWaistRow[],
    profileRows: {
      user: (userRes.data ?? null) as TrendProfileRows['user'],
      volumeProfile: (volumeProfileRes.data ?? null) as TrendProfileRows['volumeProfile'],
    },
  };
}

/** Bump `refreshKey` to refetch after the log sheet saves something. */
export function useBodyCompTrend(refreshKey: number = 0): BodyCompTrendData {
  const query = useQuery({
    queryKey: BODY_TREND_QUERY_KEY,
    queryFn: fetchBodyTrendRows,
    // Weigh-ins can be logged from Home, so every visit revalidates — but
    // behind the cached rows, never in front of them.
    staleTime: 0,
    gcTime: IMMUTABLE_GC_TIME,
  });
  const { weightRows, scans, waistRows, profileRows } = query.data ?? EMPTY_ROWS;
  const isLoading = query.isPending && !query.isError;

  const { refetch } = query;
  const mountedKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === mountedKey.current) return;
    mountedKey.current = refreshKey;
    void refetch();
  }, [refreshKey, refetch]);

  const weightHistory = useMemo(
    () =>
      weightRows.map((row) => ({
        date: row.logged_at,
        weight: row.weight,
        unit: (row.unit ?? 'lb') as 'lb' | 'kg',
      })),
    [weightRows]
  );

  // Same cm→in conversion the trend builder applies to these rows.
  const waistHistory = useMemo(
    () =>
      waistRows
        .filter((row) => row.waist != null)
        .map((row) => ({
          day: row.logged_at.slice(0, 10),
          waistIn: cmToIn(Number(row.waist)),
        })),
    [waistRows]
  );

  const trend = useMemo(
    () =>
      buildPersonalizedBodyCompTrend({
        weights: weightRows,
        scans,
        waist: waistRows,
        profile: profileRows,
      }).trend,
    [weightRows, scans, waistRows, profileRows]
  );

  return { trend, weightHistory, waistHistory, isLoading };
}
