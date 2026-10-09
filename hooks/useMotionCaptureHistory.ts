'use client';

/**
 * Motion captures that are not in this page's memory:
 *
 *   - THIS session's persisted captures (after a reload / app relaunch):
 *       raw buffer available → reprocessed through the current pipeline
 *                              (trim → analyze → clean, PC1 recomputed);
 *       cleaning snapshot (v2) → coached from the snapshot (no chart);
 *       neither (pre-cleaning capture, no raw) → 'legacy': metrics only,
 *                              never coached — old-pipeline numbers must not
 *                              reach the coach.
 *   - the LAST SESSION's clean reps per calibration, for the coach's
 *     "vs last session at the same weight" comparison (cleaning v2 only).
 *
 * Lives OUTSIDE the motion feature dirs on purpose: the last-session load
 * comes from set_logs, which motion modules may not touch (importGuard).
 */

import { useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createUntypedClient } from '@/lib/supabase/client';
import { decompactSamples } from '@/lib/motion/motionPersistence';
import type { CaptureAnalysisMetrics } from '@/types/motion';
import type { RepsCarrier } from '@/services/shared/setModality';
import {
  cleanCapture,
  CLEANING_VERSION,
  trimCaptureTail,
  type CaptureAnalysis,
  type CleanedCapture,
} from '@/services/shared/motion';

export interface LoadedSetCapture {
  captureId: string;
  calibrationId: string;
  source: 'reprocessed' | 'stored' | 'legacy';
  analysis: CaptureAnalysis | null;
  cleaned: CleanedCapture | null;
  metrics: CaptureAnalysisMetrics | null;
}

export interface LastSessionSetVelocity {
  setNumber: number;
  weightKg: number;
  /** The logged set row; resolve its count with getSetReps (seconds for duration exercises). */
  loggedSet: RepsCarrier;
  reps: Array<{ n: number; meanW: number }>;
}

type RawRow = { t: number; g: [number, number, number]; a: [number, number, number] };

/**
 * Pure: decide how a stored capture is shown. Raw beats snapshot (it gets
 * the chart and a PC1 recompute); a snapshot from an older cleaning
 * version is NOT trusted.
 */
export function resolveStoredCapture(
  row: { id: string; calibration_id: string; analysis_metrics: CaptureAnalysisMetrics | null },
  raw: RawRow[] | null
): LoadedSetCapture {
  const base = { captureId: row.id, calibrationId: row.calibration_id, metrics: row.analysis_metrics };
  if (raw && raw.length > 30) {
    const { samples, analysis } = trimCaptureTail(decompactSamples(raw));
    return { ...base, source: 'reprocessed', analysis, cleaned: cleanCapture(analysis, samples) };
  }
  const m = row.analysis_metrics;
  if (m?.cleaningVersion === CLEANING_VERSION && m.cleaned) {
    return { ...base, source: 'stored', analysis: null, cleaned: m.cleaned };
  }
  return { ...base, source: 'legacy', analysis: null, cleaned: null };
}

async function fetchSessionCaptures(
  supabase: SupabaseClient,
  userId: string,
  setIds: string[]
): Promise<Record<string, LoadedSetCapture>> {
  const { data, error } = await supabase
    .from('motion_captures')
    .select('id, set_id, calibration_id, analysis_metrics')
    .eq('user_id', userId)
    .in('set_id', setIds);
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    id: string;
    set_id: string;
    calibration_id: string;
    analysis_metrics: CaptureAnalysisMetrics | null;
  }>;
  if (rows.length === 0) return {};

  const { data: raws } = await supabase
    .from('motion_capture_raw_buffers')
    .select('capture_id, samples')
    .in('capture_id', rows.map((r) => r.id));
  const rawById = new Map(
    ((raws ?? []) as Array<{ capture_id: string; samples: RawRow[] }>).map((r) => [r.capture_id, r.samples])
  );

  const out: Record<string, LoadedSetCapture> = {};
  for (const row of rows) {
    try {
      out[row.set_id] = resolveStoredCapture(row, rawById.get(row.id) ?? null);
    } catch {
      out[row.set_id] = resolveStoredCapture(row, null);
    }
  }
  return out;
}

async function fetchLastSession(
  supabase: SupabaseClient,
  userId: string,
  calibrationIds: string[],
  before: string
): Promise<Record<string, LastSessionSetVelocity[]>> {
  const { data, error } = await supabase
    .from('motion_captures')
    .select('set_id, calibration_id, started_at, analysis_metrics')
    .eq('user_id', userId)
    .in('calibration_id', calibrationIds)
    .lt('started_at', before)
    .order('started_at', { ascending: false })
    .limit(60);
  if (error) throw error;
  const rows = ((data ?? []) as Array<{
    set_id: string;
    calibration_id: string;
    started_at: string;
    analysis_metrics: CaptureAnalysisMetrics | null;
  }>).filter((r) => r.analysis_metrics?.cleaningVersion === CLEANING_VERSION && r.analysis_metrics.cleaned);
  if (rows.length === 0) return {};

  const { data: sets } = await supabase
    .from('set_logs')
    .select('id, set_number, weight_kg, reps')
    .in('id', rows.map((r) => r.set_id));
  const setById = new Map(
    ((sets ?? []) as Array<{ id: string; set_number: number; weight_kg: number; reps: number }>).map((s) => [s.id, s])
  );

  // Most recent calendar day per calibration = "last session".
  const out: Record<string, LastSessionSetVelocity[]> = {};
  const dayOf: Record<string, string> = {};
  for (const r of rows) {
    const day = r.started_at.slice(0, 10);
    dayOf[r.calibration_id] ??= day;
    if (dayOf[r.calibration_id] !== day) continue;
    const set = setById.get(r.set_id);
    if (!set) continue;
    (out[r.calibration_id] ??= []).push({
      setNumber: set.set_number,
      weightKg: Number(set.weight_kg),
      loggedSet: set,
      reps: r.analysis_metrics!.cleaned!.reps.map((rep) => ({ n: rep.n, meanW: rep.meanW })),
    });
  }
  return out;
}

export function useMotionCaptureHistory(args: {
  enabled: boolean;
  userId: string | null;
  sessionId: string | null;
  sessionStartedAt: string | null;
  setIds: string[];
  calibrationIds: string[];
}): {
  bySetId: Record<string, LoadedSetCapture>;
  lastSession: Record<string, LastSessionSetVelocity[]>;
} {
  const { enabled, userId, sessionId, sessionStartedAt } = args;
  // Only sets that existed when the page opened can have captures this page
  // doesn't already hold in memory — later sets' captures are live.
  const initialSetIds = useRef<string[] | null>(null);
  if (initialSetIds.current === null && args.setIds.length > 0) {
    initialSetIds.current = [...args.setIds].sort();
  }
  const setIds = initialSetIds.current ?? [];
  const calibrationIds = useMemo(() => [...args.calibrationIds].sort(), [args.calibrationIds]);

  const session = useQuery({
    queryKey: ['motion-session-captures', userId, sessionId, setIds],
    enabled: enabled && userId !== null && setIds.length > 0,
    staleTime: Infinity,
    queryFn: () => fetchSessionCaptures(createUntypedClient(), userId as string, setIds),
  });
  const last = useQuery({
    queryKey: ['motion-last-session', userId, calibrationIds, sessionStartedAt],
    enabled: enabled && userId !== null && calibrationIds.length > 0 && sessionStartedAt !== null,
    staleTime: 10 * 60 * 1000,
    queryFn: () =>
      fetchLastSession(createUntypedClient(), userId as string, calibrationIds, sessionStartedAt as string),
  });

  return useMemo(
    () => ({ bySetId: session.data ?? {}, lastSession: last.data ?? {} }),
    [session.data, last.data]
  );
}
