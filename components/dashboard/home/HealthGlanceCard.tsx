'use client';

/**
 * Home health card: connect a wearable, then see last night's sleep, today's
 * steps and the latest HRV / resting heart rate at a glance.
 *
 * Not connected: one "Connect Apple Health" action (on web, "Connect a
 * wearable") that opens the same Connect Wearable sheet as the Activity card.
 * Connected: the three numbers, HRV against the user's 14-day baseline
 * (services/healthGlance — the recovery engine's own baseline).
 *
 * Sleep comes from the caller (Home already loads it for the Sleep tile);
 * connections, steps and wellness load here through React Query and refresh
 * after a connect.
 */

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconActivityHeartbeat } from '@tabler/icons-react';
import { Modal } from '@/components/ui/Modal';
import { WearableConnectionsScreen } from '@/components/wearables/WearableConnectionsScreen';
import { getActiveWearableConnections, getDailyActivityData } from '@/lib/actions/wearable';
import { getWellnessHistory } from '@/lib/actions/healthkit';
import { isHealthKitAvailable } from '@/lib/integrations';
import { formatSleepHours } from '@/lib/sleep/formatSleep';
import { getLocalDateString } from '@/lib/utils';
import { latestWellnessReading, type WellnessReading } from '@/services/healthGlance';
import type { SleepLogEntry } from '@/types/schema';

export const HEALTH_GLANCE_QUERY_KEY = ['health-glance'] as const;

const SOURCE_NAMES: Record<string, string> = {
  apple_healthkit: 'Apple Health',
  fitbit: 'Fitbit',
  google_fit: 'Google Fit',
  garmin: 'Garmin',
  samsung_health: 'Samsung Health',
};

async function loadHealthGlance() {
  const [connections, activity, wellness] = await Promise.all([
    getActiveWearableConnections(),
    getDailyActivityData(getLocalDateString()),
    getWellnessHistory(21),
  ]);
  const connection = connections.find((c) => c.source !== 'manual') ?? null;
  return {
    sourceName: connection ? SOURCE_NAMES[connection.source] ?? connection.deviceName ?? 'Wearable' : null,
    stepsToday: activity?.steps.total ?? null,
    hrv: latestWellnessReading(wellness, 'hrvSdnnMs'),
    restingHr: latestWellnessReading(wellness, 'restingHrBpm'),
  };
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string | null }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-surface-500">{label}</div>
      <div className="text-lg font-semibold text-surface-100 tabular-nums">{value}</div>
      {detail && <div className="text-[11px] text-surface-500 truncate">{detail}</div>}
    </div>
  );
}

/** "−12% vs your usual" / "+5% vs your usual" / "your usual" (within ±2%). */
export function baselineDetail(reading: WellnessReading | null): string | null {
  if (!reading || reading.deltaPct === null) return null;
  if (Math.abs(reading.deltaPct) <= 2) return 'your usual';
  return `${reading.deltaPct > 0 ? '+' : '−'}${Math.abs(reading.deltaPct)}% vs your usual`;
}

export function HealthGlanceCard({ lastNight }: { lastNight: SleepLogEntry | null }) {
  const queryClient = useQueryClient();
  const [showConnect, setShowConnect] = useState(false);
  const [healthKitCapable, setHealthKitCapable] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: HEALTH_GLANCE_QUERY_KEY,
    queryFn: loadHealthGlance,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    let cancelled = false;
    isHealthKitAvailable()
      .then((available) => {
        if (!cancelled) setHealthKitCapable(available);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: HEALTH_GLANCE_QUERY_KEY });

  // Region-scoped placeholder on first load only (cached-first: a revisit
  // renders the cached numbers).
  if (isLoading && !data) {
    return <div className="h-[104px] rounded-2xl bg-surface-900 border border-surface-800 animate-pulse" />;
  }

  const connected = !!data?.sourceName;

  return (
    <>
      <div
        className="rounded-2xl p-4 bg-surface-900 border border-surface-800"
        data-testid="health-glance-card"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5 text-xs text-surface-500">
            <IconActivityHeartbeat size={14} aria-hidden="true" />
            <span>Health</span>
            {connected && <span className="text-surface-600">· {data?.sourceName}</span>}
          </div>
          {connected && (
            <button
              type="button"
              onClick={() => setShowConnect(true)}
              className="text-xs text-surface-500 hover:text-surface-300"
            >
              Manage
            </button>
          )}
        </div>

        {connected ? (
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Sleep" value={lastNight ? formatSleepHours(lastNight.hours) : '—'} detail="last night" />
            <Stat
              label="Steps"
              value={data?.stepsToday != null ? data.stepsToday.toLocaleString() : '—'}
              detail="today"
            />
            <Stat
              label="HRV"
              value={data?.hrv ? `${Math.round(data.hrv.value)} ms` : '—'}
              detail={
                data?.hrv
                  ? baselineDetail(data.hrv) ??
                    (data.restingHr ? `RHR ${Math.round(data.restingHr.value)} bpm` : null)
                  : 'needs a watch'
              }
            />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-surface-300">
              Sync sleep, steps and HRV automatically to sharpen recovery and calorie estimates.
            </p>
            <button
              type="button"
              onClick={() => setShowConnect(true)}
              className="shrink-0 px-3 py-2 rounded-xl text-sm font-semibold text-white bg-primary-500 hover:bg-primary-400 transition-colors"
            >
              {healthKitCapable ? 'Connect Apple Health' : 'Connect a wearable'}
            </button>
          </div>
        )}
      </div>

      <Modal
        isOpen={showConnect}
        onClose={() => {
          setShowConnect(false);
          refresh();
        }}
        title="Connect Wearable"
        size="lg"
      >
        <WearableConnectionsScreen onConnectionsChange={refresh} />
      </Modal>
    </>
  );
}
