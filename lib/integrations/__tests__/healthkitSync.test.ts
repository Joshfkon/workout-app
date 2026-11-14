import {
  authorizeHealthKitAndSync,
  planSyncWindow,
  runHealthKitSync,
  HEALTHKIT_SYNC,
  HEALTHKIT_SYNCED_EVENT,
  type HealthKitSyncDeps,
} from '@/lib/integrations/healthkit-sync';
import { WHILE_OPEN_INTERVAL_MS } from '@/hooks/useHealthKitSync';
import type { HealthKitDataType } from '@/lib/actions/healthkit';

const NOW = new Date('2026-07-13T09:00:00Z');
const HOUR = 3_600_000;

describe('planSyncWindow (anchored query semantics)', () => {
  it('first sync (no anchor) pulls the long seed window', () => {
    const { start, end } = planSyncWindow(null, NOW);
    expect(end).toEqual(NOW);
    expect(start.getTime()).toBe(NOW.getTime() - HEALTHKIT_SYNC.firstSyncDays * 24 * HOUR);
  });

  it('subsequent syncs pull from anchor minus the lookback only', () => {
    const anchor = '2026-07-12T22:00:00.000Z';
    const { start } = planSyncWindow(anchor, NOW);
    expect(start.getTime()).toBe(Date.parse(anchor) - HEALTHKIT_SYNC.lookbackHours * HOUR);
  });

  it('a clock-skewed future anchor never produces an inverted window', () => {
    const { start, end } = planSyncWindow(
      new Date(NOW.getTime() + 72 * HOUR).toISOString(),
      NOW
    );
    expect(start.getTime()).toBeLessThanOrEqual(end.getTime());
  });
});

/** Build injectable deps around fixtures, recording every call. */
function makeDeps(overrides: Partial<HealthKitSyncDeps> = {}) {
  const calls = {
    sleepWindows: [] as { start: Date; end: Date }[],
    savedSleep: [] as { date: string; hours: number }[][],
    savedWellness: [] as unknown[][],
    savedActivity: [] as unknown[][],
    savedAnchors: [] as { dataType: HealthKitDataType; lastSampleEndAt: string }[][],
  };

  const deps: HealthKitSyncDeps = {
    isAvailable: async () => true,
    getContext: async () => ({ connected: true, anchors: {} }),
    needsAuthorization: async () => false,
    requestAuthorization: async () => true,
    hasAutoRequested: () => false,
    markAutoRequested: () => {},
    fetchSleep: async (start, end) => {
      calls.sleepWindows.push({ start, end });
      return [
        {
          startDate: '2026-07-12T22:00:00Z',
          endDate: '2026-07-13T05:30:00Z',
          sleepState: 'deep',
          sourceName: 'Apple Watch',
          sourceId: 'watch',
        },
      ];
    },
    fetchHrv: async () => [{ date: '2026-07-13', value: 48 }],
    fetchRhr: async () => [{ date: '2026-07-13', value: 58 }],
    fetchSteps: async () => [
      { date: '2026-07-13', steps: 9200, source: 'apple_healthkit' as const, confidence: 'measured' as const },
    ],
    fetchEnergy: async () => [
      { date: '2026-07-13', activeCalories: 640, source: 'apple_healthkit' as const },
    ],
    saveSleep: async (days) => {
      calls.savedSleep.push(days);
      return { saved: days.length, success: true };
    },
    saveWellness: async (days) => {
      calls.savedWellness.push(days);
      return { saved: days.length, success: true };
    },
    saveActivity: async (days) => {
      calls.savedActivity.push(days);
      return { saved: days.length, success: true };
    },
    saveAnchors: async (anchors) => {
      calls.savedAnchors.push(anchors);
      return { success: true };
    },
    now: () => NOW,
    ...overrides,
  };

  return { deps, calls };
}

describe('runHealthKitSync', () => {
  it('skips cleanly when HealthKit is unavailable (web/Android) or not connected', async () => {
    const unavailable = makeDeps({ isAvailable: async () => false });
    expect(await runHealthKitSync({ force: true }, unavailable.deps)).toEqual({
      status: 'skipped',
      reason: 'not_available',
    });

    const disconnected = makeDeps({
      getContext: async () => ({ connected: false, anchors: {} }),
    });
    expect(await runHealthKitSync({ force: true }, disconnected.deps)).toEqual({
      status: 'skipped',
      reason: 'not_connected',
    });
  });

  it('first sync pulls the seed window, saves aggregates, and persists anchors', async () => {
    const { deps, calls } = makeDeps();
    const outcome = await runHealthKitSync({ force: true }, deps);

    expect(outcome.status).toBe('synced');
    expect(outcome.sleepDays).toBe(1);
    expect(outcome.wellnessDays).toBe(1);
    expect(outcome.activityDays).toBe(1);

    // Seed window (no anchor yet).
    expect(calls.sleepWindows[0].start.getTime()).toBe(
      NOW.getTime() - HEALTHKIT_SYNC.firstSyncDays * 24 * HOUR
    );

    // HRV + RHR merged into one wellness row per local day.
    expect(calls.savedWellness[0]).toEqual([
      { date: '2026-07-13', hrvSdnnMs: 48, restingHrBpm: 58 },
    ]);
    // Steps + energy merged per local day.
    expect(calls.savedActivity[0]).toEqual([
      { date: '2026-07-13', steps: 9200, activeCalories: 640 },
    ]);

    // Sleep anchor = newest sample end; daily types anchor at "now".
    const anchors = calls.savedAnchors[0];
    expect(anchors.find((a) => a.dataType === 'sleep')?.lastSampleEndAt).toBe(
      '2026-07-13T05:30:00Z'
    );
    expect(anchors.find((a) => a.dataType === 'steps')?.lastSampleEndAt).toBe(
      NOW.toISOString()
    );
  });

  it('second foreground pull queries only from the persisted anchor (minus lookback)', async () => {
    const first = makeDeps();
    await runHealthKitSync({ force: true }, first.deps);
    const persisted = first.calls.savedAnchors[0];

    // Feed the anchors saved by the first run into the second run's context.
    const second = makeDeps({
      getContext: async () => ({
        connected: true,
        anchors: Object.fromEntries(
          persisted.map((a) => [a.dataType, a.lastSampleEndAt])
        ),
      }),
    });
    await runHealthKitSync({ force: true }, second.deps);

    const sleepAnchorMs = Date.parse('2026-07-13T05:30:00Z');
    expect(second.calls.sleepWindows[0].start.getTime()).toBe(
      sleepAnchorMs - HEALTHKIT_SYNC.lookbackHours * HOUR
    );
    // Incremental: dramatically narrower than the 21-day seed window.
    expect(
      NOW.getTime() - second.calls.sleepWindows[0].start.getTime()
    ).toBeLessThanOrEqual(48 * HOUR);
  });

  it('throttles rapid un-forced foreground syncs', async () => {
    const { deps } = makeDeps();
    const first = await runHealthKitSync({ force: true }, deps);
    expect(first.status).toBe('synced');
    const second = await runHealthKitSync({}, deps);
    expect(second).toEqual({ status: 'skipped', reason: 'throttled' });
  });

  it('a failed write leaves its anchor behind so the window is re-pulled next sync', async () => {
    const { deps, calls } = makeDeps({
      saveActivity: async () => ({ saved: 0, success: false }),
    });
    const outcome = await runHealthKitSync({ force: true }, deps);
    expect(outcome.status).toBe('synced');

    const anchors = calls.savedAnchors[0];
    const advancedTypes = anchors.map((a) => a.dataType).sort();
    // Sleep + wellness writes succeeded and advance; steps/active_energy
    // must NOT advance past the unsaved data.
    expect(advancedTypes).toEqual(['hrv', 'resting_heart_rate', 'sleep']);
  });

  it('a fetch failure degrades to a skip, never a crash', async () => {
    const { deps } = makeDeps({
      fetchSleep: async () => {
        throw new Error('plugin exploded');
      },
    });
    expect(await runHealthKitSync({ force: true }, deps)).toEqual({
      status: 'skipped',
      reason: 'error',
    });
  });
});

describe('per-install authorization (connected account, unasked device)', () => {
  it('does not touch the permission sheet when this install is already decided', async () => {
    const requestAuthorization = jest.fn(async () => true);
    const { deps } = makeDeps({ needsAuthorization: async () => false, requestAuthorization });

    const outcome = await runHealthKitSync({ force: true }, deps);

    expect(outcome.status).toBe('synced');
    expect(requestAuthorization).not.toHaveBeenCalled();
  });

  it('asks once on an install that was never asked, then syncs', async () => {
    const requestAuthorization = jest.fn(async () => true);
    const markAutoRequested = jest.fn();
    const { deps, calls } = makeDeps({
      needsAuthorization: async () => true,
      hasAutoRequested: () => false,
      markAutoRequested,
      requestAuthorization,
    });

    const outcome = await runHealthKitSync({ force: true }, deps);

    expect(markAutoRequested).toHaveBeenCalledTimes(1);
    expect(requestAuthorization).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe('synced');
    expect(calls.savedActivity).toHaveLength(1);
  });

  it('never asks a second time on the same install', async () => {
    const requestAuthorization = jest.fn(async () => true);
    const { deps, calls } = makeDeps({
      needsAuthorization: async () => true,
      hasAutoRequested: () => true,
      requestAuthorization,
    });

    expect(await runHealthKitSync({ force: true }, deps)).toEqual({
      status: 'skipped',
      reason: 'needs_authorization',
    });
    expect(requestAuthorization).not.toHaveBeenCalled();
    expect(calls.savedActivity).toHaveLength(0);
  });

  it('never asks when the account is not connected', async () => {
    const needsAuthorization = jest.fn(async () => true);
    const requestAuthorization = jest.fn(async () => true);
    const { deps } = makeDeps({
      getContext: async () => ({ connected: false, anchors: {} }),
      needsAuthorization,
      requestAuthorization,
    });

    await runHealthKitSync({ force: true }, deps);

    expect(needsAuthorization).not.toHaveBeenCalled();
    expect(requestAuthorization).not.toHaveBeenCalled();
  });

  it('skips without writing when the sheet flow fails', async () => {
    const { deps, calls } = makeDeps({
      needsAuthorization: async () => true,
      requestAuthorization: async () => false,
    });

    expect(await runHealthKitSync({ force: true }, deps)).toEqual({
      status: 'skipped',
      reason: 'needs_authorization',
    });
    expect(calls.savedAnchors).toHaveLength(0);
  });
});

describe('out of the stuck state: Allow access from the Home card', () => {
  it('asks again on a deliberate tap, even after the one automatic ask, then syncs', async () => {
    const requestAuthorization = jest.fn(async () => true);
    let asked = false;
    const { deps, calls } = makeDeps({
      // Undecided until the sheet is answered.
      needsAuthorization: async () => !asked,
      hasAutoRequested: () => true,
      requestAuthorization: async () => {
        asked = true;
        return requestAuthorization();
      },
    });

    // The automatic path is stuck: already asked once, still undecided.
    expect(await runHealthKitSync({ force: true }, deps)).toEqual({
      status: 'skipped',
      reason: 'needs_authorization',
    });

    const outcome = await authorizeHealthKitAndSync(deps);

    expect(requestAuthorization).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe('synced');
    expect(calls.savedActivity).toHaveLength(1);
  });

  it('still tries to sync if the permission request throws', async () => {
    const { deps } = makeDeps({
      requestAuthorization: async () => {
        throw new Error('presentation failed');
      },
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect((await authorizeHealthKitAndSync(deps)).status).toBe('synced');
  });
});

describe('near-live syncing', () => {
  it('announces a completed sync so views can refetch', async () => {
    const listener = jest.fn();
    window.addEventListener(HEALTHKIT_SYNCED_EVENT, listener);
    const { deps } = makeDeps();

    await runHealthKitSync({ force: true }, deps);

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(HEALTHKIT_SYNCED_EVENT, listener);
  });

  it('does not announce a skipped sync', async () => {
    const listener = jest.fn();
    window.addEventListener(HEALTHKIT_SYNCED_EVENT, listener);
    const { deps } = makeDeps({ isAvailable: async () => false });

    await runHealthKitSync({ force: true }, deps);

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(HEALTHKIT_SYNCED_EVENT, listener);
  });

  it('syncs on open at most every 2 minutes, and every 5 while the app is open', () => {
    expect(HEALTHKIT_SYNC.minIntervalMs).toBe(2 * 60 * 1000);
    expect(HEALTHKIT_SYNC.whileOpenIntervalMs).toBe(5 * 60 * 1000);
    // The hook keeps its own literal (bundle safety) — it must match.
    expect(WHILE_OPEN_INTERVAL_MS).toBe(HEALTHKIT_SYNC.whileOpenIntervalMs);
  });
});
