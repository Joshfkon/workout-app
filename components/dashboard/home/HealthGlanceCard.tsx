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
 * after a connect and whenever a HealthKit sync stores data.
 *
 * Apple Health permission is per iPhone while "connected" is per account, so
 * a connected account can still need the OK on this phone (new phone,
 * reinstall, or a permission sheet that never showed). Then nothing syncs and
 * the card says so, with an Allow access button — otherwise that state is
 * invisible ("last synced 2 days ago" and no idea why).
 */

import { useCallback, useEffect, useState } from 'react';
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

/** "just now" / "4 min ago" / "3 h ago" / "2 days ago". */
export function formatSyncedAgo(lastSyncAt: Date | string | null | undefined, nowMs = Date.now()): string | null {
  if (!lastSyncAt) return null;
  const ms = typeof lastSyncAt === 'string' ? Date.parse(lastSyncAt) : lastSyncAt.getTime();
  if (!Number.isFinite(ms)) return null;
  const minutes = Math.floor((nowMs - ms) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

async function loadHealthGlance() {
  const [connections, activity, wellness] = await Promise.all([
    getActiveWearableConnections(),
    getDailyActivityData(getLocalDateString()),
    getWellnessHistory(21),
  ]);
  const connection = connections.find((c) => c.source !== 'manual') ?? null;
  return {
    source: connection?.source ?? null,
    lastSyncAt: connection?.lastSyncAt ?? null,
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

type HealthGlanceData = Awaited<ReturnType<typeof loadHealthGlance>>;

/** HRV detail: vs baseline, else resting HR, else why it's missing. */
function hrvDetail(data: HealthGlanceData | undefined): string | null {
  if (!data?.hrv) return 'needs a watch';
  return (
    baselineDetail(data.hrv) ??
    (data.restingHr ? `RHR ${Math.round(data.restingHr.value)} bpm` : null)
  );
}

function HealthStats({
  data,
  lastNight,
}: {
  data: HealthGlanceData | undefined;
  lastNight: SleepLogEntry | null;
}) {
  const syncedAgo = formatSyncedAgo(data?.lastSyncAt);
  return (
    <>
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
          detail={hrvDetail(data)}
        />
      </div>
      {syncedAgo && (
        <p className="mt-2 text-[11px] text-surface-500" data-testid="health-synced-ago">
          Updated {syncedAgo}
        </p>
      )}
    </>
  );
}

function PermissionBanner({ isSyncing, onAllow }: { isSyncing: boolean; onAllow: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-warning-500/10 border border-warning-500/20 p-3">
      <p className="text-xs text-surface-300">
        Apple Health needs your OK on this iPhone before anything can sync.
      </p>
      <button
        type="button"
        onClick={onAllow}
        disabled={isSyncing}
        className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-primary-500 hover:bg-primary-400 disabled:opacity-60"
      >
        {isSyncing ? 'Syncing…' : 'Allow access'}
      </button>
    </div>
  );
}

export function HealthGlanceCard({ lastNight }: { lastNight: SleepLogEntry | null }) {
  const queryClient = useQueryClient();
  const [showConnect, setShowConnect] = useState(false);
  const [healthKitCapable, setHealthKitCapable] = useState(false);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

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

  const refresh = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: HEALTH_GLANCE_QUERY_KEY }),
    [queryClient]
  );

  // Fresh numbers as soon as any sync (foreground, interval, Sync now) lands.
  useEffect(() => {
    let disposed = false;
    let removeListener: (() => void) | null = null;
    import('@/lib/integrations/healthkit-sync')
      .then(({ HEALTHKIT_SYNCED_EVENT }) => {
        if (disposed) return;
        window.addEventListener(HEALTHKIT_SYNCED_EVENT, refresh);
        removeListener = () => window.removeEventListener(HEALTHKIT_SYNCED_EVENT, refresh);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      removeListener?.();
    };
  }, [refresh]);

  const usesAppleHealth = healthKitCapable && data?.source === 'apple_healthkit';

  // Does this iPhone still need the Apple Health OK? (See the module doc.)
  useEffect(() => {
    if (!usesAppleHealth) {
      setNeedsPermission(false);
      return;
    }
    let cancelled = false;
    import('@/lib/integrations/healthkit')
      .then(({ healthKitNeedsAuthorizationRequest }) => healthKitNeedsAuthorizationRequest())
      .then((needs) => {
        if (!cancelled) setNeedsPermission(needs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [usesAppleHealth, data?.lastSyncAt]);

  const syncNow = async (withPermission: boolean) => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const sync = await import('@/lib/integrations/healthkit-sync');
      if (withPermission) {
        await sync.authorizeHealthKitAndSync();
        const { healthKitNeedsAuthorizationRequest } = await import('@/lib/integrations/healthkit');
        setNeedsPermission(await healthKitNeedsAuthorizationRequest());
      } else {
        await sync.runHealthKitSync({ force: true });
      }
    } catch (error) {
      console.warn('Health sync failed:', error);
    } finally {
      setIsSyncing(false);
      refresh();
    }
  };

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
            <div className="flex items-center gap-3 text-xs text-surface-500">
              {usesAppleHealth && !needsPermission && (
                <button
                  type="button"
                  onClick={() => void syncNow(false)}
                  disabled={isSyncing}
                  className="hover:text-surface-300 disabled:opacity-60"
                >
                  {isSyncing ? 'Syncing…' : 'Sync now'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowConnect(true)}
                className="hover:text-surface-300"
              >
                Manage
              </button>
            </div>
          )}
        </div>

        {connected && needsPermission && (
          <PermissionBanner isSyncing={isSyncing} onAllow={() => void syncNow(true)} />
        )}

        {connected ? (
          <>
          <HealthStats data={data} lastNight={lastNight} />
          </>
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
