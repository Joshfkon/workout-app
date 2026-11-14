import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HealthGlanceCard, baselineDetail, formatSyncedAgo } from '../HealthGlanceCard';
import * as wearable from '@/lib/actions/wearable';
import * as healthkit from '@/lib/actions/healthkit';
import * as integrations from '@/lib/integrations';
import type { SleepLogEntry } from '@/types/schema';

jest.mock('@/lib/actions/wearable', () => ({
  getActiveWearableConnections: jest.fn(),
  getDailyActivityData: jest.fn(),
}));
jest.mock('@/lib/actions/healthkit', () => ({ getWellnessHistory: jest.fn() }));
jest.mock('@/lib/integrations', () => ({ isHealthKitAvailable: jest.fn() }));
const mockNeedsAuthorization = jest.fn();
const mockRunSync = jest.fn();
const mockAuthorizeAndSync = jest.fn();
jest.mock('@/lib/integrations/healthkit', () => ({
  healthKitNeedsAuthorizationRequest: () => mockNeedsAuthorization(),
}));
jest.mock('@/lib/integrations/healthkit-sync', () => ({
  HEALTHKIT_SYNCED_EVENT: 'hypertrack:healthkit-synced',
  runHealthKitSync: (...args: unknown[]) => mockRunSync(...args),
  authorizeHealthKitAndSync: () => mockAuthorizeAndSync(),
}));
jest.mock('@/components/wearables/WearableConnectionsScreen', () => ({
  WearableConnectionsScreen: () => <div>Connect Wearable sheet</div>,
}));

const renderCard = (lastNight: SleepLogEntry | null = null) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <HealthGlanceCard lastNight={lastNight} />
    </QueryClientProvider>
  );

const wellness = [
  ...Array.from({ length: 10 }, (_, i) => ({
    date: `2026-11-${String(i + 1).padStart(2, '0')}`,
    hrvSdnnMs: 50,
    restingHrBpm: 60,
  })),
  { date: '2026-11-11', hrvSdnnMs: 44, restingHrBpm: 61 },
];

describe('HealthGlanceCard', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    jest.clearAllMocks();
    (integrations.isHealthKitAvailable as jest.Mock).mockResolvedValue(true);
    (wearable.getDailyActivityData as jest.Mock).mockResolvedValue(null);
    (healthkit.getWellnessHistory as jest.Mock).mockResolvedValue([]);
    mockNeedsAuthorization.mockResolvedValue(false);
    mockRunSync.mockResolvedValue({ status: 'synced' });
    mockAuthorizeAndSync.mockResolvedValue({ status: 'synced' });
  });

  it('offers to connect Apple Health when nothing is connected', async () => {
    (wearable.getActiveWearableConnections as jest.Mock).mockResolvedValue([]);
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'Connect Apple Health' }));
    expect(screen.getByText('Connect Wearable sheet')).toBeInTheDocument();
  });

  it('says "Connect a wearable" where Apple Health is not available', async () => {
    (integrations.isHealthKitAvailable as jest.Mock).mockResolvedValue(false);
    (wearable.getActiveWearableConnections as jest.Mock).mockResolvedValue([]);
    renderCard();

    expect(await screen.findByRole('button', { name: 'Connect a wearable' })).toBeInTheDocument();
  });

  it('shows sleep, steps and HRV once connected', async () => {
    (wearable.getActiveWearableConnections as jest.Mock).mockResolvedValue([
      { id: 'c1', source: 'apple_healthkit', isConnected: true },
    ]);
    (wearable.getDailyActivityData as jest.Mock).mockResolvedValue({ steps: { total: 8432 } });
    (healthkit.getWellnessHistory as jest.Mock).mockResolvedValue(wellness);
    renderCard({ hours: 7.5 } as SleepLogEntry);

    expect(await screen.findByText('8,432')).toBeInTheDocument();
    expect(screen.getByText('7.5h')).toBeInTheDocument();
    expect(screen.getByText('44 ms')).toBeInTheDocument();
    expect(screen.getByText('−12% vs your usual')).toBeInTheDocument();
    expect(screen.getByText(/Apple Health/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect/i })).not.toBeInTheDocument();
  });

  it('notes that HRV needs a watch when none has synced', async () => {
    (wearable.getActiveWearableConnections as jest.Mock).mockResolvedValue([
      { id: 'c1', source: 'apple_healthkit', isConnected: true },
    ]);
    renderCard();

    expect(await screen.findByText('needs a watch')).toBeInTheDocument();
  });
});

describe('baselineDetail', () => {
  it('describes the reading against the usual baseline', () => {
    expect(baselineDetail({ value: 44, date: 'd', baseline: 50, deltaPct: -12 })).toBe('−12% vs your usual');
    expect(baselineDetail({ value: 55, date: 'd', baseline: 50, deltaPct: 10 })).toBe('+10% vs your usual');
    expect(baselineDetail({ value: 51, date: 'd', baseline: 50, deltaPct: 2 })).toBe('your usual');
    expect(baselineDetail({ value: 51, date: 'd', baseline: null, deltaPct: null })).toBeNull();
    expect(baselineDetail(null)).toBeNull();
  });
});

describe('HealthGlanceCard — keeping Apple Health live', () => {
  const user = userEvent.setup();
  const appleHealth = (lastSyncAt: string | null = null) => [
    { id: 'c1', source: 'apple_healthkit', isConnected: true, lastSyncAt },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (integrations.isHealthKitAvailable as jest.Mock).mockResolvedValue(true);
    (wearable.getDailyActivityData as jest.Mock).mockResolvedValue(null);
    (healthkit.getWellnessHistory as jest.Mock).mockResolvedValue([]);
    mockRunSync.mockResolvedValue({ status: 'synced' });
    mockAuthorizeAndSync.mockResolvedValue({ status: 'synced' });
  });

  it('says when this iPhone still needs the Apple Health OK, and Allow access fixes it', async () => {
    (wearable.getActiveWearableConnections as jest.Mock).mockResolvedValue(appleHealth());
    mockNeedsAuthorization.mockResolvedValueOnce(true).mockResolvedValue(false);
    renderCard();

    expect(await screen.findByText(/needs your OK on this iPhone/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Allow access' }));

    expect(mockAuthorizeAndSync).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Sync now' })).toBeInTheDocument();
    expect(screen.queryByText(/needs your OK/i)).not.toBeInTheDocument();
  });

  it('Sync now forces a sync', async () => {
    (wearable.getActiveWearableConnections as jest.Mock).mockResolvedValue(appleHealth());
    mockNeedsAuthorization.mockResolvedValue(false);
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'Sync now' }));
    expect(mockRunSync).toHaveBeenCalledWith({ force: true });
  });

  it('shows when the numbers were last updated', async () => {
    (wearable.getActiveWearableConnections as jest.Mock).mockResolvedValue(
      appleHealth(new Date(Date.now() - 4 * 60000).toISOString())
    );
    mockNeedsAuthorization.mockResolvedValue(false);
    renderCard();

    expect(await screen.findByTestId('health-synced-ago')).toHaveTextContent('Updated 4 min ago');
  });
});

describe('formatSyncedAgo', () => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  it('reads like a person would say it', () => {
    expect(formatSyncedAgo('2026-11-14T11:59:40Z', now)).toBe('just now');
    expect(formatSyncedAgo('2026-11-14T11:50:00Z', now)).toBe('10 min ago');
    expect(formatSyncedAgo('2026-11-14T09:00:00Z', now)).toBe('3 h ago');
    expect(formatSyncedAgo('2026-11-13T11:00:00Z', now)).toBe('1 day ago');
    expect(formatSyncedAgo('2026-11-12T11:00:00Z', now)).toBe('2 days ago');
    expect(formatSyncedAgo(null, now)).toBeNull();
  });
});
