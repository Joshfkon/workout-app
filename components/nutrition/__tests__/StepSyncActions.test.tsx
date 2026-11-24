import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let glance: { source?: string; sourceName?: string } | undefined;
let capable = false;
let needsAuth = false;
const runSync = jest.fn().mockResolvedValue({ status: 'synced' });
const authorizeAndSync = jest.fn().mockResolvedValue({ status: 'synced' });

jest.mock('@/components/dashboard/home/HealthGlanceCard', () => ({
  HEALTH_GLANCE_QUERY_KEY: ['health-glance'],
  useHealthGlance: () => ({ data: glance }),
}));
jest.mock('@/lib/integrations', () => ({ isHealthKitAvailable: () => Promise.resolve(capable) }));
jest.mock('@/lib/integrations/healthkit-sync', () => ({
  runHealthKitSync: (...a: unknown[]) => runSync(...a),
  authorizeHealthKitAndSync: () => authorizeAndSync(),
}));
jest.mock('@/lib/integrations/healthkit', () => ({ healthKitNeedsAuthorizationRequest: () => Promise.resolve(needsAuth) }));
jest.mock('@/components/wearables/WearableConnectionsScreen', () => ({ WearableConnectionsScreen: () => <div>connect screen</div> }));
jest.mock('@/components/nutrition/StepTracking', () => ({ StepTracking: () => <div>manual steps</div> }));

import { StepSyncActions, syncOutcomeMessage } from '@/components/nutrition/StepSyncActions';

function setup() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <StepSyncActions date="2026-11-24" userWeightKg={80} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  glance = undefined;
  capable = false;
  needsAuth = false;
  runSync.mockClear();
  authorizeAndSync.mockClear();
});

describe('StepSyncActions (no steps synced yet)', () => {
  it('on the web with nothing connected: connect a wearable, or enter steps', async () => {
    setup();
    expect(screen.getByTestId('step-sync-connect')).toHaveTextContent('Connect a wearable');
    await userEvent.setup().click(screen.getByTestId('step-sync-manual'));
    expect(screen.getByText('manual steps')).toBeInTheDocument();
  });

  it('on the iPhone with Apple Health connected: Sync now runs a forced sync', async () => {
    capable = true;
    glance = { source: 'apple_healthkit', sourceName: 'Apple Health' };
    setup();
    const btn = await screen.findByTestId('step-sync-now');
    await userEvent.setup().click(btn);
    await waitFor(() => expect(runSync).toHaveBeenCalledWith({ force: true }));
    expect(await screen.findByRole('status')).toHaveTextContent(/Synced/);
  });

  it('asks for the Apple Health OK first when it is still needed', async () => {
    capable = true;
    needsAuth = true;
    glance = { source: 'apple_healthkit', sourceName: 'Apple Health' };
    setup();
    await userEvent.setup().click(await screen.findByTestId('step-sync-now'));
    await waitFor(() => expect(authorizeAndSync).toHaveBeenCalled());
    expect(runSync).not.toHaveBeenCalled();
  });

  it('on the iPhone with nothing connected: Connect Apple Health', async () => {
    capable = true;
    setup();
    expect(await screen.findByText('Connect Apple Health')).toBeInTheDocument();
  });
});

describe('syncOutcomeMessage', () => {
  it('only says synced when the sync did, and says why otherwise', () => {
    expect(syncOutcomeMessage({ status: 'synced' })).toMatch(/^Synced/);
    expect(syncOutcomeMessage({ status: 'skipped', reason: 'error' })).toMatch(/Couldn't reach Apple Health/);
    expect(syncOutcomeMessage({ status: 'skipped', reason: 'needs_authorization' })).toMatch(/hasn't allowed/);
    expect(syncOutcomeMessage({ status: 'skipped', reason: 'not_connected' })).toMatch(/isn't connected/);
    expect(syncOutcomeMessage(undefined)).not.toMatch(/^Synced/);
  });

  it('shows a failed sync as a failure, not "Synced" (Codex review on #872)', async () => {
    capable = true;
    glance = { source: 'apple_healthkit', sourceName: 'Apple Health' };
    runSync.mockResolvedValueOnce({ status: 'skipped', reason: 'error' });
    setup();
    await userEvent.setup().click(await screen.findByTestId('step-sync-now'));
    expect(await screen.findByRole('status')).toHaveTextContent(/Couldn't reach Apple Health/);
  });
});
