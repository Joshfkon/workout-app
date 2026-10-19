/**
 * After a wearable connects in the "Connect Wearable" modal, the
 * ActivityCard must reload past its 5-minute sessionStorage cache. It used
 * to keep showing "Connect" (the cached empty connection list) until the app
 * was restarted.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityCard } from '../ActivityCard';
import * as wearableActions from '@/lib/actions/wearable';

jest.mock('@/lib/actions/wearable', () => ({
  getActiveWearableConnections: jest.fn(),
  getDailyActivityData: jest.fn(),
}));
jest.mock('@/lib/actions/steps', () => ({ saveManualSteps: jest.fn() }));
jest.mock('@/lib/integrations', () => ({
  isHealthKitAvailable: jest.fn().mockResolvedValue(true),
}));
jest.mock('@/components/wearables/ActivitySettingsScreen', () => ({
  ActivitySettingsScreen: () => null,
}));

// Stand-in for the real connect screen: one button that reports a new
// connection the way WearableConnectionsScreen does after a connect.
const healthConnection = {
  id: 'c1',
  source: 'apple_healthkit',
  isConnected: true,
  deviceName: 'Apple Health',
};
jest.mock('@/components/wearables/WearableConnectionsScreen', () => ({
  WearableConnectionsScreen: ({
    onConnectionsChange,
  }: {
    onConnectionsChange?: (connections: unknown[]) => void;
  }) => (
    <button type="button" onClick={() => onConnectionsChange?.([healthConnection])}>
      Simulate Apple Health connected
    </button>
  ),
}));

describe('ActivityCard refresh after connecting a wearable', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    (wearableActions.getDailyActivityData as jest.Mock).mockResolvedValue(null);
  });

  it('reloads past the session cache when a connection is added', async () => {
    (wearableActions.getActiveWearableConnections as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValue([healthConnection]);

    render(<ActivityCard userId="user-1" />);

    const connect = await screen.findByRole('button', { name: /^connect$/i });
    expect(wearableActions.getActiveWearableConnections).toHaveBeenCalledTimes(1);

    await user.click(connect);
    await user.click(screen.getByRole('button', { name: /simulate apple health connected/i }));

    await waitFor(() => {
      expect(wearableActions.getActiveWearableConnections).toHaveBeenCalledTimes(2);
    });
    // The card switched to its connected state instead of offering Connect.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^connect$/i })).not.toBeInTheDocument();
    });
  });
});
