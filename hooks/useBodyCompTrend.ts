'use client';

/**
 * useBodyCompTrend
 *
 * Fetches weight_log + dexa_scans and builds the DEXA-anchored body
 * composition trend (services/bodyCompAnchor). This is the ONE data source
 * for every surface derived from the anchored series: the Body Composition
 * Trend chart AND the Analytics FFMI gauge (which must equal the last point
 * of the trend's FFMI series). Weight → kg conversion happens here, once,
 * via inputWeightToKg.
 */

import { useEffect, useMemo, useState } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import {
  buildAnchoredBodyCompTrend,
  type AnchoredTrendPoint,
} from '@/services/bodyCompAnchor';
import { computeWaistTrend } from '@/services/waistTrend';
import { inputWeightToKg, cmToIn } from '@/lib/utils';

interface WeightLogRow {
  logged_at: string;
  weight: number;
  unit: 'lb' | 'kg' | null;
}

interface DexaRow {
  scan_date: string;
  body_fat_percent: number;
  lean_mass_kg: number;
  fat_mass_kg: number;
  weight_kg: number | null;
  bone_mass_kg: number | null;
}

export interface WeightHistoryEntry {
  date: string;
  weight: number;
  unit: 'lb' | 'kg';
}

export interface BodyCompTrendData {
  /** Anchored trend, sorted by date ascending; [] until scans exist. */
  trend: AnchoredTrendPoint[];
  /** Raw weigh-ins in their logged unit (for the weight chart). */
  weightHistory: WeightHistoryEntry[];
  isLoading: boolean;
}

/** Bump `refreshKey` to refetch after the log sheet saves something. */
export function useBodyCompTrend(refreshKey: number = 0): BodyCompTrendData {
  const [weightRows, setWeightRows] = useState<WeightLogRow[]>([]);
  const [scans, setScans] = useState<DexaRow[]>([]);
  const [waistRows, setWaistRows] = useState<Array<{ logged_at: string; waist: number | null }>>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchAll() {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const yearAgo = new Date();
        yearAgo.setDate(yearAgo.getDate() - 365);
        const [weightsRes, scansRes, waistRes] = await Promise.all([
          supabase
            .from('weight_log')
            .select('logged_at, weight, unit')
            .eq('user_id', user.id)
            .gte('logged_at', yearAgo.toISOString().slice(0, 10))
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
            .gte('logged_at', yearAgo.toISOString().slice(0, 10))
            .not('waist', 'is', null)
            .order('logged_at', { ascending: true }),
        ]);

        setWeightRows((weightsRes.data ?? []) as WeightLogRow[]);
        setScans((scansRes.data ?? []) as DexaRow[]);
        setWaistRows(
          (waistRes.data ?? []) as Array<{ logged_at: string; waist: number | null }>
        );
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

  const waistTrend = useMemo(
    () =>
      computeWaistTrend(
        waistRows
          .filter((r) => r.waist != null)
          .map((r) => ({ date: r.logged_at, waistIn: cmToIn(Number(r.waist)) }))
      )
        // Only valid (non-outlier) points shape the interior.
        .filter((p) => !p.isOutlier)
        .map((p) => ({ date: p.date, trendIn: p.trendIn })),
    [waistRows]
  );

  const trend = useMemo(
    () =>
      buildAnchoredBodyCompTrend(
        weightRows.map((row) => ({
          date: row.logged_at,
          weightKg: inputWeightToKg(row.weight, row.unit ?? 'lb'),
        })),
        scans.map((scan) => ({
          date: scan.scan_date,
          bodyFatPercent: Number(scan.body_fat_percent),
          leanMassKg: Number(scan.lean_mass_kg),
          fatMassKg: Number(scan.fat_mass_kg),
          // The recorded total (includes bone) anchors bodyweight deltas.
          weightKg: scan.weight_kg != null ? Number(scan.weight_kg) : undefined,
          // BMC feeds the FFMI series (FFM = lean + bone when logged).
          boneMassKg: scan.bone_mass_kg != null ? Number(scan.bone_mass_kg) : null,
        })),
        { waistTrend }
      ),
    [weightRows, scans, waistTrend]
  );

  return { trend, weightHistory, isLoading };
}
