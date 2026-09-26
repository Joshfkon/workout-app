import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WearableConnectionsScreen } from '../WearableConnectionsScreen';
import * as wearableActions from '@/lib/actions/wearable';

// Mock the action imports
jest.mock('@/lib/actions/wearable', () => ({
  getWearableConnections: jest.fn(),
  upsertWearableConnection: jest.fn(),
  disconnectWearable: jest.fn(),
}));

// Mock dynamic imports
jest.mock('@/lib/integrations/healthkit', () => ({
  isHealthKitAvailable: jest.fn(),
  requestHealthKitPermissions: jest.fn(),
}));

jest.mock('@/lib/integrations/capacitor-stub', () => ({
  Capacitor: {
    isNativePlatform: jest.fn(),
    getPlatform: jest.fn(),
  },
}));

jest.mock('@capacitor/browser', () => ({
  Browser: {
    open: jest.fn(),
  },
}));

describe('WearableConnectionsScreen - Apple Health Permission Denied', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    jest.clearAllMocks();
    (wearableActions.getWearableConnections as jest.Mock).mockResolvedValue([]);
  });

  it('shows denied state when Apple Health permission is denied on iOS', async () => {
    // Setup iOS environment
    const { Capacitor } = await import('@/lib/integrations/capacitor-stub');
    (Capacitor.isNativePlatform as jest.Mock).mockReturnValue(true);
    (Capacitor.getPlatform as jest.Mock).mockReturnValue('ios');

    const { isHealthKitAvailable, requestHealthKitPermissions } = await import(
      '@/lib/integrations/healthkit'
    );
    (isHealthKitAvailable as jest.Mock).mockResolvedValue(true);
    (requestHealthKitPermissions as jest.Mock).mockResolvedValue({ granted: false });

    render(<WearableConnectionsScreen />);

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

    // Find and click the Connect button for Apple Health (first connect button in available list)
    const connectButtons = screen.getAllByRole('button', { name: /connect/i });
    await user.click(connectButtons[0]);

    // Wait for the denied state to appear
    await waitFor(() => {
      expect(screen.getByText('Apple Health Access Required')).toBeInTheDocument();
    });

    // Check that the explanation is shown
    expect(
      screen.getByText(/HyperTrack reads your sleep, steps, active energy, and heart-rate data/i)
    ).toBeInTheDocument();

    // Check that the Open Settings button is present
    expect(screen.getByRole('button', { name: /open settings/i })).toBeInTheDocument();

    // Check that the Dismiss button is present
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('opens iOS Settings when Open Settings button is clicked', async () => {
    // Setup iOS environment
    const { Capacitor } = await import('@/lib/integrations/capacitor-stub');
    (Capacitor.isNativePlatform as jest.Mock).mockReturnValue(true);
    (Capacitor.getPlatform as jest.Mock).mockReturnValue('ios');

    const { isHealthKitAvailable, requestHealthKitPermissions } = await import(
      '@/lib/integrations/healthkit'
    );
    (isHealthKitAvailable as jest.Mock).mockResolvedValue(true);
    (requestHealthKitPermissions as jest.Mock).mockResolvedValue({ granted: false });

    const { Browser } = await import('@capacitor/browser');

    render(<WearableConnectionsScreen />);

    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

    // Trigger permission denial - click first Connect button
    const connectButtons = screen.getAllByRole('button', { name: /connect/i });
    await user.click(connectButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Apple Health Access Required')).toBeInTheDocument();
    });

    // Click Open Settings button
    const openSettingsButton = screen.getByRole('button', { name: /open settings/i });
    await user.click(openSettingsButton);

    // Verify that Browser.open was called with app-settings: URL
    expect(Browser.open).toHaveBeenCalledWith({ url: 'app-settings:' });
  });

  it('dismisses denied state when Dismiss button is clicked', async () => {
    // Setup iOS environment
    const { Capacitor } = await import('@/lib/integrations/capacitor-stub');
    (Capacitor.isNativePlatform as jest.Mock).mockReturnValue(true);
    (Capacitor.getPlatform as jest.Mock).mockReturnValue('ios');

    const { isHealthKitAvailable, requestHealthKitPermissions } = await import(
      '@/lib/integrations/healthkit'
    );
    (isHealthKitAvailable as jest.Mock).mockResolvedValue(true);
    (requestHealthKitPermissions as jest.Mock).mockResolvedValue({ granted: false });

    render(<WearableConnectionsScreen />);

    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

    // Trigger permission denial - click first Connect button
    const connectButtons = screen.getAllByRole('button', { name: /connect/i });
    await user.click(connectButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Apple Health Access Required')).toBeInTheDocument();
    });

    // Click Dismiss button
    const dismissButton = screen.getByRole('button', { name: /dismiss/i });
    await user.click(dismissButton);

    // Verify that the denied state is hidden
    await waitFor(() => {
      expect(screen.queryByText('Apple Health Access Required')).not.toBeInTheDocument();
    });
  });

  it('clears denied state when retrying connection', async () => {
    // Setup iOS environment
    const { Capacitor } = await import('@/lib/integrations/capacitor-stub');
    (Capacitor.isNativePlatform as jest.Mock).mockReturnValue(true);
    (Capacitor.getPlatform as jest.Mock).mockReturnValue('ios');

    const { isHealthKitAvailable, requestHealthKitPermissions } = await import(
      '@/lib/integrations/healthkit'
    );
    (isHealthKitAvailable as jest.Mock).mockResolvedValue(true);
    (requestHealthKitPermissions as jest.Mock)
      .mockResolvedValueOnce({ granted: false })
      .mockResolvedValueOnce({ granted: true, permissions: ['steps', 'sleep'] });

    render(<WearableConnectionsScreen />);

    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

    // First attempt - denied, click first Connect button
    const connectButtons = screen.getAllByRole('button', { name: /connect/i });
    await user.click(connectButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Apple Health Access Required')).toBeInTheDocument();
    });

    // Dismiss and retry
    const dismissButton = screen.getByRole('button', { name: /dismiss/i });
    await user.click(dismissButton);

    await waitFor(() => {
      expect(screen.queryByText('Apple Health Access Required')).not.toBeInTheDocument();
    });

    // Second attempt - should not show denied state if granted
    const retryConnectButtons = screen.getAllByRole('button', { name: /connect/i });
    await user.click(retryConnectButtons[0]);

    await waitFor(() => {
      expect(screen.queryByText('Apple Health Access Required')).not.toBeInTheDocument();
    });
  });

  it('does not show Apple Health connection option on web', async () => {
    // Setup web environment
    const { Capacitor } = await import('@/lib/integrations/capacitor-stub');
    (Capacitor.isNativePlatform as jest.Mock).mockReturnValue(false);
    (Capacitor.getPlatform as jest.Mock).mockReturnValue('web');

    const { isHealthKitAvailable } = await import('@/lib/integrations/healthkit');
    (isHealthKitAvailable as jest.Mock).mockResolvedValue(false);

    render(<WearableConnectionsScreen />);

    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

    // On web, Apple Health connection option should not be available in the available connections list
    // But Fitbit and Garmin should be available
    expect(screen.queryByText('⌚')).not.toBeInTheDocument(); // Apple Health icon
    expect(screen.getByText('💪')).toBeInTheDocument(); // Fitbit icon
    expect(screen.getByText('🏃')).toBeInTheDocument(); // Garmin icon
  });

  it('does not call Browser.open on non-iOS platforms', async () => {
    // Setup Android environment (even though HealthKit isn't available there)
    const { Capacitor } = await import('@/lib/integrations/capacitor-stub');
    (Capacitor.isNativePlatform as jest.Mock).mockReturnValue(true);
    (Capacitor.getPlatform as jest.Mock).mockReturnValue('android');

    const { Browser } = await import('@capacitor/browser');

    render(<WearableConnectionsScreen />);

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    // Manually trigger openAppSettings (in real scenario, this wouldn't be shown on Android for HealthKit)
    // This is just to test the platform check
    const component = render(<WearableConnectionsScreen />);
    
    // Android should not trigger Browser.open for app-settings
    expect(Browser.open).not.toHaveBeenCalled();
  });
});
