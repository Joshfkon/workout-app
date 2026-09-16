'use client';

/**
 * useVelocityRirProfiles — learned failure-velocity (MVT) profiles per
 * machine calibration, for the velocity → estimated-RIR line in the
 * workout logger's Observations block.
 *
 * THIS FILE IS THE SANCTIONED LABEL JOIN. The motion feature dirs may not
 * reference set-log tables (importGuard), so the one read that pairs a
 * motion capture with its set's logged RIR lives here, outside them. The
 * math stays in services/shared/motion/velocityRir.ts; this hook only
 * fetches and shapes rows. It is display-only telemetry: nothing on the
 * e1RM/prescription/volume path may import it.
 *
 * Label hygiene, per the schema's design (types/motion.ts):
 *  - captures flagged prior_observations_viewed_this_session are excluded —
 *    metrics seen before RIR entry can anchor the label;
 *  - the label is feedback.repsInTank; sets without structured feedback
 *    don't qualify.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createUntypedClient } from '@/lib/supabase/client';
import {
  buildMvtProfile,
  analysisRepsToVelocityReps,
  type LabeledVelocitySet,
  type MvtProfile,
} from '@/services/shared/motion';
import type { CaptureAnalysisMetrics, MachineCalibration } from '@/types/motion';
import type { SetFeedback } from '@/types/schema';

/** Most recent captures considered per fetch (bounds the join). */
const CAPTURE_FETCH_LIMIT = 200;

interface CaptureRow {
  set_id: string;
  calibration_id: string;
  analysis_metrics: CaptureAnalysisMetrics | null;
}

/** set_logs.feedback round-trips as jsonb or a JSON string; accept both. */
function parseLoggedRir(feedback: unknown): number | null {
  let parsed: unknown = feedback;
  if (typeof feedback === 'string') {
    try {
      parsed = JSON.parse(feedback);
    } catch {
      return null;
    }
  }
  const rir = (parsed as Partial<SetFeedback> | null)?.repsInTank;
  return typeof rir === 'number' ? rir : null;
}

/**
 * Past captures for the given calibrations, labeled with their sets' logged
 * RIR, keyed by calibration id. Captures whose set has no RIR are dropped.
 */
export async function fetchLabeledVelocityHistory(
  supabase: SupabaseClient,
  userId: string,
  calibrationIds: string[]
): Promise<Record<string, LabeledVelocitySet[]>> {
  if (calibrationIds.length === 0) return {};

  const { data: captures, error } = await supabase
    .from('motion_captures')
    .select('set_id, calibration_id, analysis_metrics')
    .eq('user_id', userId)
    .in('calibration_id', calibrationIds)
    .eq('prior_observations_viewed_this_session', false)
    .not('analysis_metrics', 'is', null)
    .order('started_at', { ascending: false })
    .limit(CAPTURE_FETCH_LIMIT);
  if (error) throw error;

  const rows = (captures ?? []) as CaptureRow[];
  const setIds = Array.from(new Set(rows.map((r) => r.set_id)));
  if (setIds.length === 0) return {};

  const { data: sets, error: setsError } = await supabase
    .from('set_logs')
    .select('id, feedback')
    .in('id', setIds);
  if (setsError) throw setsError;

  const rirBySetId = new Map<string, number>();
  for (const s of (sets ?? []) as Array<{ id: string; feedback: unknown }>) {
    const rir = parseLoggedRir(s.feedback);
    if (rir !== null) rirBySetId.set(s.id, rir);
  }

  const byCalibration: Record<string, LabeledVelocitySet[]> = {};
  for (const row of rows) {
    const loggedRir = rirBySetId.get(row.set_id);
    const metrics = row.analysis_metrics;
    if (loggedRir === undefined || !metrics?.reps?.length) continue;
    (byCalibration[row.calibration_id] ??= []).push({
      reps: analysisRepsToVelocityReps(metrics.reps),
      loggedRir,
      pc1VarianceShare: metrics.pc1VarianceShare ?? null,
    });
  }
  return byCalibration;
}

/**
 * MVT profiles for the user's calibrations, keyed by calibration id. Empty
 * until enough labeled history exists; consumers treat a missing key as
 * "no estimate".
 */
export function useVelocityRirProfiles(
  userId: string | null,
  calibrations: MachineCalibration[]
): Record<string, MvtProfile> {
  const calibrationIds = useMemo(
    () => calibrations.map((c) => c.id).sort(),
    [calibrations]
  );

  const query = useQuery({
    queryKey: ['velocity-rir-profiles', userId, calibrationIds],
    enabled: userId !== null && calibrationIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: () =>
      fetchLabeledVelocityHistory(createUntypedClient(), userId as string, calibrationIds),
  });

  return useMemo(() => {
    const profiles: Record<string, MvtProfile> = {};
    for (const [calibrationId, history] of Object.entries(query.data ?? {})) {
      const profile = buildMvtProfile(history);
      if (profile) profiles[calibrationId] = profile;
    }
    return profiles;
  }, [query.data]);
}
