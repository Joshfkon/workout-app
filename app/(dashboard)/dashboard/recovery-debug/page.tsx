'use client';

/**
 * Recovery debug — calibration view for the recovery models.
 *
 * Shows, side by side, the CURRENT state of:
 *   - the mover model (computeMuscleRecovery) for every standard muscle,
 *   - the stabilizer channel (computeStabilizerRecovery) for the tracked
 *     muscles, with its config (windows, thresholds) printed for reference,
 *   - the recent stabilizer warning log (stabilizer_warning_events) with the
 *     user's responses.
 *
 * Deliberately unlinked from the dashboard nav (reachable at
 * /dashboard/recovery-debug) and read-only: it renders the same pure
 * functions the workout page runs, over the same cached history query, so
 * what it shows IS what the warnings fired on. No flag gating — it only ever
 * reads the signed-in user's own data.
 */

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserStore } from '@/stores';
import { useRecoveryHistory } from '@/hooks/useMuscleReadiness';
import { useRecoveryMultipliers } from '@/hooks/useRecoveryMultipliers';
import { usePlannedFrequency } from '@/hooks/usePlannedFrequency';
import {
  computeMuscleRecovery,
  computeStabilizerRecovery,
  recoveryConfigFor,
  stabilizerTrackedMuscles,
  type MuscleRecoveryResult,
} from '@/services/muscleRecovery';
import {
  STANDARD_MUSCLE_GROUPS,
  STANDARD_MUSCLE_DISPLAY_NAMES,
  type StandardMuscleGroup,
} from '@/types/schema';

interface WarningEventRow {
  id: string;
  muscle_group: string;
  readiness_ratio: number;
  intensity_ratio: number;
  planned_load_kg: number | null;
  reference_load_kg: number | null;
  response: string;
  shown_at: string;
  responded_at: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  fresh: 'text-success-400',
  recovering: 'text-warning-400',
  fatigued: 'text-danger-400',
};

function ReadinessRowView({ label, result }: { label: string; result: MuscleRecoveryResult }) {
  return (
    <tr className="border-b border-surface-800/60">
      <td className="py-1.5 pr-3 text-surface-200">{label}</td>
      <td className={`py-1.5 pr-3 font-medium ${STATUS_COLOR[result.status] ?? ''}`}>
        {result.status}
      </td>
      <td className="py-1.5 pr-3 tabular-nums text-surface-300">
        {(result.readinessRatio * 100).toFixed(0)}%
      </td>
      <td className="py-1.5 pr-3 tabular-nums text-surface-400">
        {result.windowHours !== null ? `${result.windowHours.toFixed(0)}h` : '—'}
      </td>
      <td className="py-1.5 pr-3 tabular-nums text-surface-400">
        {result.hoursSinceLast !== null ? `${result.hoursSinceLast.toFixed(0)}h ago` : 'never'}
      </td>
      <td className="py-1.5 tabular-nums text-surface-400">
        {result.hoursUntilReady > 0 ? `${result.hoursUntilReady.toFixed(0)}h` : 'ready'}
      </td>
    </tr>
  );
}

export default function RecoveryDebugPage() {
  const { user } = useUserStore();
  // Visual/debug read of the wall clock — allowed per lib/clock rules; this
  // page persists nothing.
  const [now] = useState(() => new Date());
  const { sessions, isLoading } = useRecoveryHistory(now, true);
  const { multipliers } = useRecoveryMultipliers();
  const { plannedSessionsPerWeekByMuscle } = usePlannedFrequency();
  const [warningEvents, setWarningEvents] = useState<WarningEventRow[]>([]);

  const config = useMemo(
    () =>
      recoveryConfigFor(user?.enhancedAthleteMode === true, multipliers, undefined, undefined, {
        experienceForCapacity: user?.experience,
        plannedSessionsPerWeekByMuscle,
      }),
    [user?.enhancedAthleteMode, user?.experience, multipliers, plannedSessionsPerWeekByMuscle]
  );

  const moverResults = useMemo(
    () =>
      STANDARD_MUSCLE_GROUPS.map((muscle) => ({
        muscle,
        result: computeMuscleRecovery(sessions, muscle, now, config),
      })),
    [sessions, now, config]
  );

  const stabilizerResults = useMemo(
    () =>
      stabilizerTrackedMuscles(config).map((muscle) => ({
        muscle,
        result: computeStabilizerRecovery(sessions, muscle, now, config),
      })),
    [sessions, now, config]
  );

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const supabase = createUntypedClient();
    void supabase
      .from('stabilizer_warning_events')
      .select(
        'id, muscle_group, readiness_ratio, intensity_ratio, planned_load_kg, reference_load_kg, response, shown_at, responded_at'
      )
      .eq('user_id', user.id)
      .order('shown_at', { ascending: false })
      .limit(25)
      .then(({ data, error }: { data: WarningEventRow[] | null; error: unknown }) => {
        if (!cancelled && !error && data) setWarningEvents(data);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const header = (
    <tr className="text-left text-[11px] uppercase tracking-wide text-surface-500">
      <th className="py-1 pr-3">Muscle</th>
      <th className="py-1 pr-3">Status</th>
      <th className="py-1 pr-3">Ready</th>
      <th className="py-1 pr-3">Window</th>
      <th className="py-1 pr-3">Last loaded</th>
      <th className="py-1">Fresh in</th>
    </tr>
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-surface-100">Recovery debug</h1>
        <p className="text-[13px] text-surface-400">
          Live output of the mover model and the stabilizer channel over the last week of
          completed sessions{isLoading ? ' (history loading…)' : ''}.
        </p>
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-surface-200 mb-2">
          Stabilizer channel
          <span className="ml-2 font-normal text-[12px] text-surface-500">
            warn below {(config.stabilizerReadinessThreshold * 100).toFixed(0)}% ready at ≥
            {(config.stabilizerIntensityThreshold * 100).toFixed(0)}% intensity
          </span>
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>{header}</thead>
            <tbody>
              {stabilizerResults.map(({ muscle, result }) => (
                <ReadinessRowView
                  key={muscle}
                  label={`${STANDARD_MUSCLE_DISPLAY_NAMES[muscle as StandardMuscleGroup]} · ${
                    config.stabilizerWindowHoursByMuscle[muscle] ?? '—'
                  }h base`}
                  result={result}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-surface-200 mb-2">Mover model (all muscles)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>{header}</thead>
            <tbody>
              {moverResults.map(({ muscle, result }) => (
                <ReadinessRowView
                  key={muscle}
                  label={STANDARD_MUSCLE_DISPLAY_NAMES[muscle]}
                  result={result}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-surface-200 mb-2">
          Recent stabilizer warnings
        </h2>
        {warningEvents.length === 0 ? (
          <p className="text-[13px] text-surface-500">No warnings recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-surface-500">
                  <th className="py-1 pr-3">When</th>
                  <th className="py-1 pr-3">Muscle</th>
                  <th className="py-1 pr-3">Ready</th>
                  <th className="py-1 pr-3">Intensity</th>
                  <th className="py-1">Response</th>
                </tr>
              </thead>
              <tbody>
                {warningEvents.map((event) => (
                  <tr key={event.id} className="border-b border-surface-800/60">
                    <td className="py-1.5 pr-3 text-surface-400">
                      {new Date(event.shown_at).toLocaleString()}
                    </td>
                    <td className="py-1.5 pr-3 text-surface-200">{event.muscle_group}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-surface-300">
                      {(event.readiness_ratio * 100).toFixed(0)}%
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums text-surface-300">
                      {(event.intensity_ratio * 100).toFixed(0)}%
                    </td>
                    <td className="py-1.5 text-surface-300">{event.response}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
