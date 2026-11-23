'use client';

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import Link from 'next/link';
import { IconWalk } from '@tabler/icons-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { WearableConnectionsScreen } from '@/components/wearables/WearableConnectionsScreen';
import { ActivitySettingsScreen } from '@/components/wearables/ActivitySettingsScreen';
import { getLocalDateString } from '@/lib/utils';
import {
  getActiveWearableConnections,
  getDailyActivityData,
} from '@/lib/actions/wearable';
import { saveManualSteps } from '@/lib/actions/steps';
import { isHealthKitAvailable } from '@/lib/integrations';
import type { WearableConnection, DailyActivityData } from '@/types/wearable';

interface ActivityCardProps {
  userId: string;
}

const ACTIVITY_CACHE_KEY = 'activity_card_data';
const ACTIVITY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CachedActivityData {
  connections: WearableConnection[];
  todayActivity: DailyActivityData | null;
  timestamp: number;
  date: string;
}

export const ActivityCard = memo(function ActivityCard({ userId }: ActivityCardProps) {
  const [connections, setConnections] = useState<WearableConnection[]>([]);
  const [todayActivity, setTodayActivity] = useState<DailyActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [manualSteps, setManualSteps] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [savingSteps, setSavingSteps] = useState(false);
  // Real device capability (Capacitor iOS + HealthKit plugin), not a promise
  // of future features: null while probing, then true only on capable iOS.
  const [healthKitCapable, setHealthKitCapable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    isHealthKitAvailable()
      .then((available) => {
        if (!cancelled) setHealthKitCapable(available);
      })
      .catch(() => {
        if (!cancelled) setHealthKitCapable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadData = useCallback(async (options: { force?: boolean } = {}) => {
    const today = getLocalDateString();

    // Check sessionStorage cache first (skipped, and cleared, when forced —
    // e.g. right after a wearable connects, when the cached copy is stale)
    try {
      if (options.force) sessionStorage.removeItem(ACTIVITY_CACHE_KEY);
      const cached = options.force ? null : sessionStorage.getItem(ACTIVITY_CACHE_KEY);
      if (cached) {
        const parsed: CachedActivityData = JSON.parse(cached);
        const isValid =
          parsed.date === today &&
          Date.now() - parsed.timestamp < ACTIVITY_CACHE_TTL;

        if (isValid) {
          setConnections(parsed.connections);
          setTodayActivity(parsed.todayActivity);
          setLoading(false);
          return;
        }
      }
    } catch (error) {
      // Cache read failed, proceed with fetch
      console.debug('[ActivityCard] Cache read failed:', error);
    }

    try {
      const [connectionsData, activityData] = await Promise.all([
        getActiveWearableConnections(),
        getDailyActivityData(today),
      ]);
      setConnections(connectionsData);
      setTodayActivity(activityData);

      // Cache the results
      try {
        const cacheData: CachedActivityData = {
          connections: connectionsData,
          todayActivity: activityData,
          timestamp: Date.now(),
          date: today,
        };
        sessionStorage.setItem(ACTIVITY_CACHE_KEY, JSON.stringify(cacheData));
      } catch (error) {
        // Cache write failed, non-critical
        console.debug('[ActivityCard] Cache write failed:', error);
      }
    } catch (error) {
      console.error('Failed to load activity data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // The launch/foreground HealthKit sync finishes after this card's first
  // read; reload past the session cache when it lands so today's steps show.
  useEffect(() => {
    const onSynced = () => void loadData({ force: true });
    window.addEventListener('healthkit:synced', onSynced);
    return () => window.removeEventListener('healthkit:synced', onSynced);
  }, [loadData]);

  const hasWearable = connections.length > 0;
  const steps = todayActivity?.steps.total || 0;
  const activityLevel = todayActivity?.calculated.activityLevel || 'sedentary';

  const getActivityColor = useCallback((level: string) => {
    switch (level) {
      case 'very_active': return 'text-status-bad';
      case 'active': return 'text-orange-400';
      case 'moderate': return 'text-status-ok';
      case 'light': return 'text-action';
      default: return 'text-ink-2';
    }
  }, []);

  const getActivityLabel = useCallback((level: string) => {
    const labels: Record<string, string> = {
      sedentary: 'Sedentary',
      light: 'Light',
      moderate: 'Moderate',
      active: 'Active',
      very_active: 'Very Active',
    };
    return labels[level] || 'Sedentary';
  }, []);

  const stepGoalProgress = useMemo(() => {
    const goal = 10000; // Default step goal
    return Math.min(100, (steps / goal) * 100);
  }, [steps]);

  const handleOpenConnectModal = useCallback(() => setShowConnectModal(true), []);
  // A connect/disconnect inside the modal changes what this card shows, so
  // reload past the session cache both when it happens and when the modal
  // closes (the first HealthKit sync may finish just after the connect).
  const refreshAfterConnectionChange = useCallback(() => {
    void loadData({ force: true });
  }, [loadData]);
  const handleCloseConnectModal = useCallback(() => {
    setShowConnectModal(false);
    void loadData({ force: true });
  }, [loadData]);
  const handleOpenSettingsModal = useCallback(() => setShowSettingsModal(true), []);
  const handleCloseSettingsModal = useCallback(() => setShowSettingsModal(false), []);
  const handleOpenManualInput = useCallback(() => setShowManualInput(true), []);
  const handleCloseManualInput = useCallback(() => setShowManualInput(false), []);
  const handleManualStepsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setManualSteps(e.target.value);
  }, []);

  const handleSaveManualSteps = useCallback(async () => {
    const stepsNum = parseInt(manualSteps, 10);
    if (isNaN(stepsNum) || stepsNum < 0) return;

    setSavingSteps(true);
    try {
      // Weight is only used for an approximate calorie-per-step estimate.
      // 70kg is the engine's reference weight, so it's a safe neutral default here.
      const result = await saveManualSteps(getLocalDateString(), stepsNum, 70);
      if (result.success) {
        // Invalidate the cache so reloaded data reflects the new entry.
        try {
          sessionStorage.removeItem(ACTIVITY_CACHE_KEY);
        } catch {
          // Non-critical
        }
        setManualSteps('');
        setShowManualInput(false);
        await loadData();
      } else {
        alert(result.error || 'Failed to save steps');
      }
    } catch (error) {
      console.error('Failed to save manual steps:', error);
      alert('Failed to save steps');
    } finally {
      setSavingSteps(false);
    }
  }, [manualSteps, loadData]);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-sep rounded w-1/3" />
            <div className="h-8 bg-sep rounded w-1/2" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <IconWalk size={16} className="text-ink-2" aria-hidden="true" /> Today&apos;s Activity
            </CardTitle>
            <div className="flex items-center gap-1">
              {hasWearable && (
                <button
                  onClick={handleOpenSettingsModal}
                  className="p-1.5 hover:bg-sep rounded-lg transition-colors"
                  title="Activity settings"
                >
                  <svg className="w-4 h-4 text-ink-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              )}
              <Link href="/dashboard/learn/wearable-integration">
                <button
                  className="p-1.5 hover:bg-sep rounded-lg transition-colors"
                  title="Learn more"
                >
                  <svg className="w-4 h-4 text-ink-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          {showManualInput ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                placeholder="Enter steps"
                value={manualSteps}
                onChange={handleManualStepsChange}
                className="flex-1 px-3 py-2 bg-fill border border-sep rounded-lg text-ink text-subhead focus:outline-none focus:ring-2 focus:ring-action"
                autoFocus
              />
              <Button
                size="sm"
                disabled={!manualSteps || savingSteps}
                onClick={handleSaveManualSteps}
              >
                {savingSteps ? 'Saving...' : 'Save'}
              </Button>
              <button
                onClick={handleCloseManualInput}
                className="p-2 text-ink-2 hover:text-ink-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : hasWearable && steps > 0 ? (
            <div className="space-y-3">
              {/* Steps Display */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-action/20 flex items-center justify-center">
                    <svg className="w-5 h-5 text-action" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-title font-bold text-ink">
                      {steps.toLocaleString()}
                    </p>
                    <p className="text-caption text-ink-3">steps today</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`text-subhead font-medium ${getActivityColor(activityLevel)}`}>
                    {getActivityLabel(activityLevel)}
                  </span>
                  <p className="text-caption text-ink-3">
                    {connections[0]?.deviceName || 'Connected'}
                  </p>
                </div>
              </div>

              {/* Progress Bar */}
              <div>
                <div className="flex items-center justify-between text-caption text-ink-3 mb-1">
                  <span>Daily goal</span>
                  <span>{steps.toLocaleString()} / 10,000</span>
                </div>
                <div className="h-2 bg-fill rounded-full overflow-hidden">
                  <div
                    className="h-full bg-action transition-all duration-500"
                    style={{ width: `${stepGoalProgress}%` }}
                  />
                </div>
              </div>

              {/* Calorie Burn Estimate */}
              {todayActivity?.calculated.totalActivityExpenditure && (
                <div className="flex items-center justify-between pt-2 border-t border-sep text-subhead">
                  <span className="text-ink-2">Est. activity burn</span>
                  <span className="text-ink font-medium">
                    +{todayActivity.calculated.totalActivityExpenditure} cal
                  </span>
                </div>
              )}
            </div>
          ) : hasWearable ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-fill flex items-center justify-center">
                <svg className="w-6 h-6 text-ink-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-ink-2 text-subhead">No steps synced yet today</p>
              <p className="text-ink-3 text-caption mt-1">
                {healthKitCapable
                  ? `Steps sync automatically from ${connections[0]?.deviceName || 'your wearable'} — open the app later today or enter them manually.`
                  : `Waiting on ${connections[0]?.deviceName || 'your wearable'} to sync. You can enter steps manually in the meantime.`}
              </p>
              <button
                onClick={handleOpenManualInput}
                className="mt-3 text-caption text-action transition-colors"
              >
                Enter steps manually
              </button>
            </div>
          ) : (
            // No wearable connected yet. The connect flow (WearableConnections
            // Screen) supports Apple Health on iOS, Fitbit on web, and Google
            // Fit on Android, so the Connect button stays available on every
            // platform — only the copy adapts to the device's likely provider.
            // Manual entry is always offered alongside it.
            <div className="space-y-3">
              <div className="flex items-center gap-4 p-4 bg-action/10 rounded-lg border border-action/20">
                <div className="w-12 h-12 rounded-xl bg-action/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-title">⌚</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-subhead font-medium text-ink">Track your steps</p>
                  <p className="text-caption text-ink-2 mt-0.5">
                    {healthKitCapable
                      ? 'Connect Apple Health to sync steps automatically and sharpen your estimated daily burn.'
                      : 'Connect Fitbit or Google Fit to sync steps automatically, or enter them manually.'}
                  </p>
                </div>
                <Button size="sm" onClick={handleOpenConnectModal}>
                  Connect
                </Button>
              </div>
              <button
                onClick={handleOpenManualInput}
                className="w-full text-center text-caption text-ink-3 hover:text-ink-2 transition-colors py-2"
              >
                Or enter steps manually
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Connect Wearable Modal */}
      <Modal
        isOpen={showConnectModal}
        onClose={handleCloseConnectModal}
        title="Connect wearable"
        size="lg"
      >
        <WearableConnectionsScreen onConnectionsChange={refreshAfterConnectionChange} />
      </Modal>

      {/* Settings Modal */}
      <Modal
        isOpen={showSettingsModal}
        onClose={handleCloseSettingsModal}
        title="Activity settings"
        size="lg"
      >
        <ActivitySettingsScreen />
      </Modal>
    </>
  );
});
