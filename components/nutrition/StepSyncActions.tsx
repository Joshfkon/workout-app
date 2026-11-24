'use client';

/**
 * What a lifter can do about "No steps synced yet today" on the Eat screen.
 * The line used to offer only "Change" (step-adjustment settings), which can't
 * sync anything: the only sync control lived on Home's Health card, and only
 * on the iPhone with Apple Health connected (user report).
 *
 *  - iPhone, Apple Health connected → "Sync now" (asks for the Apple Health
 *    OK first if it's still needed)
 *  - iPhone, nothing connected     → "Connect Apple Health"
 *  - web / other                   → "Enter steps" (and "Connect a wearable")
 *
 * After a sync or a manual entry the step-adjusted target is refetched, so
 * the line updates on its own.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { WearableConnectionsScreen } from '@/components/wearables/WearableConnectionsScreen';
import { StepTracking } from '@/components/nutrition/StepTracking';
import { HEALTH_GLANCE_QUERY_KEY, useHealthGlance } from '@/components/dashboard/home/HealthGlanceCard';
import { STEP_ADJUSTMENT_KEY } from '@/hooks/useStepCalorieAdjustment';
import { isHealthKitAvailable } from '@/lib/integrations';

/** What to tell the lifter after Sync now, from the sync's own outcome. Pure. */
export function syncOutcomeMessage(outcome: { status: 'synced' | 'skipped'; reason?: string } | null | undefined): string {
  if (outcome?.status === 'synced') return 'Synced. If steps still show 0, Apple Health has none for today yet.';
  switch (outcome?.reason) {
    case 'needs_authorization':
      return "Apple Health hasn't allowed HyperTrack to read steps. In the Health app, go to Sharing → Apps → HyperTrack, turn on Steps, then try again.";
    case 'not_connected':
      return "Apple Health isn't connected yet. Connect it, then sync.";
    case 'not_available':
      return "Apple Health isn't available on this device. Enter steps instead.";
    case 'throttled':
      return 'Synced a moment ago. Try again in a minute.';
    default:
      return "Couldn't reach Apple Health. Try again, or enter steps.";
  }
}

export function StepSyncActions({ date, userWeightKg }: { date: string; userWeightKg: number }) {
  const queryClient = useQueryClient();
  const { data: health } = useHealthGlance();
  const [healthKitCapable, setHealthKitCapable] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    let cancelled = false;
    isHealthKitAvailable()
      .then((ok) => !cancelled && setHealthKitCapable(ok))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshSteps = () => {
    void queryClient.invalidateQueries({ queryKey: STEP_ADJUSTMENT_KEY });
    void queryClient.invalidateQueries({ queryKey: HEALTH_GLANCE_QUERY_KEY });
  };

  const usesAppleHealth = healthKitCapable && health?.source === 'apple_healthkit';
  const connected = !!health?.sourceName;

  const syncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    setStatus(null);
    try {
      const sync = await import('@/lib/integrations/healthkit-sync');
      const { healthKitNeedsAuthorizationRequest } = await import('@/lib/integrations/healthkit');
      // Report what actually happened: both helpers resolve (not throw) on a
      // failed sync or a missing permission (Codex review on #872).
      const outcome = (await healthKitNeedsAuthorizationRequest())
        ? await sync.authorizeHealthKitAndSync()
        : await sync.runHealthKitSync({ force: true });
      setStatus(syncOutcomeMessage(outcome));
    } catch {
      setStatus("Couldn't reach Apple Health. Try again, or enter steps.");
    } finally {
      setSyncing(false);
      refreshSteps();
    }
  };

  const link = 'font-semibold text-action disabled:opacity-60';
  return (
    <>
      <span className="inline-flex flex-wrap gap-x-3" data-testid="step-sync-actions">
        {usesAppleHealth ? (
          <button type="button" className={link} onClick={() => void syncNow()} disabled={syncing} data-testid="step-sync-now">
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        ) : !connected ? (
          <button type="button" className={link} onClick={() => setShowConnect(true)} data-testid="step-sync-connect">
            {healthKitCapable ? 'Connect Apple Health' : 'Connect a wearable'}
          </button>
        ) : null}
        <button type="button" className={link} onClick={() => setShowManual(true)} data-testid="step-sync-manual">
          Enter steps
        </button>
      </span>
      {status && (
        <span className="block text-caption text-ink-2" role="status">
          {status}
        </span>
      )}

      <Modal
        isOpen={showConnect}
        onClose={() => {
          setShowConnect(false);
          refreshSteps();
        }}
        title="Connect wearable"
        size="lg"
      >
        <WearableConnectionsScreen onConnectionsChange={refreshSteps} />
      </Modal>
      <Modal
        isOpen={showManual}
        onClose={() => {
          setShowManual(false);
          refreshSteps();
        }}
        title="Today's steps"
      >
        <StepTracking date={date} userWeightKg={userWeightKg} />
      </Modal>
    </>
  );
}
