import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HealthGlanceCard, baselineDetail } from '../HealthGlanceCard';
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
