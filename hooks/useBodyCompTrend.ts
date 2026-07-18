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

import { useEffect, useMemo, useState } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
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

/** Bump `refreshKey` to refetch after the log sheet saves something. */
export function useBodyCompTrend(refreshKey: number = 0): BodyCompTrendData {
  const [weightRows, setWeightRows] = useState<TrendWeightRow[]>([]);
  const [scans, setScans] = useState<TrendDexaRow[]>([]);
  const [waistRows, setWaistRows] = useState<TrendWaistRow[]>([]);
  const [profileRows, setProfileRows] = useState<TrendProfileRows | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchAll() {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const yearAgoDay = localDay(rollingWindowStart(365));
        const [weightsRes, scansRes, waistRes, userRes, volumeProfileRes] = await Promise.all([
          supabase
            .from('weight_log')
            .select('logged_at, weight, unit')
            .eq('user_id', user.id)
            .gte('logged_at', yearAgoDay)
            .order('logged_at', { ascending: true }),
          supabase
            .from('dexa_scans')
            .select(
              'scan_date, body_fat_percent, lean_mass_kg, fat_mass_kg, weight_kg, bone_mass_kg'
            )
            .eq('user_id', user.id)
            .order('scan_date', { ascending: true }),
          // Waist tape entries (cm) shape the estimated BF% interior between
          // scans. Non-fatal: if the read fails the trend just runs unbent.
          supabase
            .from('body_measurements')
            .select('logged_at, waist')
            .eq('user_id', user.id)
            .gte('logged_at', yearAgoDay)
            .not('waist', 'is', null)
            .order('logged_at', { ascending: true }),
          // Profile slices feeding the personalized projection p-ratio.
          // Non-fatal: absent rows just leave the projection at the 0.5
          // default.
          supabase
            .from('users')
            .select('height_cm, goal, sex, age')
            .eq('id', user.id)
            .maybeSingle(),
          supabase
            .from('user_volume_profiles')
            .select('training_age, is_enhanced')
            .eq('user_id', user.id)
            .maybeSingle(),
        ]);

        setWeightRows((weightsRes.data ?? []) as TrendWeightRow[]);
        setScans((scansRes.data ?? []) as TrendDexaRow[]);
        setWaistRows((waistRes.data ?? []) as TrendWaistRow[]);
        setProfileRows({
          user: (userRes.data ?? null) as TrendProfileRows['user'],
          volumeProfile: (volumeProfileRes.data ?? null) as TrendProfileRows['volumeProfile'],
        });
      } catch (err) {
        console.error('Failed to load body trend data:', err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchAll();
  }, [refreshKey]);

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
